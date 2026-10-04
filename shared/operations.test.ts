import assert from "node:assert/strict";
import test from "node:test";
import { BoardDataSchema, type BoardData, type Run } from "./model";
import {
  applyBoardOperation,
  boardForProject,
  boardKeyPrefix,
  cardsInColumn,
} from "./operations";
import { migrateBoardData } from "./settings";
import { materializeAgentProfile } from "./agentProfiles";
import { findCardAttachments, searchKanbanCards } from "./cardAttachments";
import { canContinueAgent, runStatus } from "./runState";

const NOW = "2026-10-02T12:00:00.000Z";

function boardData(): BoardData {
  let data = BoardDataSchema.parse({});
  data = applyBoardOperation(data, {
    type: "ensure-board",
    boardId: "board_1",
    projectId: "project_1",
    projectName: "Paseo Kanban",
    now: NOW,
  });
  return data;
}

function addCard(data: BoardData, id: string, column: "backlog" | "todo" = "backlog") {
  return applyBoardOperation(data, {
    type: "create-card",
    boardId: "board_1",
    cardId: id,
    title: `Card ${id}`,
    description: "",
    column,
    now: NOW,
  });
}

test("creates one board per project and assigns stable display keys", () => {
  let data = boardData();
  data = applyBoardOperation(data, {
    type: "ensure-board",
    boardId: "ignored",
    projectId: "project_1",
    projectName: "Paseo Kanban renamed",
    now: "2026-10-02T12:01:00.000Z",
  });
  data = addCard(data, "card_1");
  data = addCard(data, "card_2");

  assert.equal(data.boards.length, 1);
  assert.equal(boardForProject(data, "project_1")?.name, "Paseo Kanban renamed");
  assert.deepEqual(data.cards.map((card) => card.key), ["PK-1", "PK-2"]);
  assert.equal(boardKeyPrefix("API"), "API");
});

test("replaying a create operation after a settings conflict is idempotent", () => {
  const operation = {
    type: "create-card" as const,
    boardId: "board_1",
    cardId: "card_1",
    title: "Conflict-safe card",
    description: "",
    column: "backlog" as const,
    now: NOW,
  };
  let data = applyBoardOperation(boardData(), operation);
  data = applyBoardOperation(data, operation);

  assert.equal(data.cards.length, 1);
  assert.equal(data.boards[0]?.nextCardNumber, 2);
});

test("moves and reorders cards while normalizing positions", () => {
  let data = addCard(addCard(addCard(boardData(), "a"), "b"), "c");
  data = applyBoardOperation(data, {
    type: "move-card",
    cardId: "c",
    column: "backlog",
    index: 0,
    now: NOW,
  });
  data = applyBoardOperation(data, {
    type: "move-card",
    cardId: "a",
    column: "todo",
    index: 0,
    now: NOW,
  });

  assert.deepEqual(cardsInColumn(data, "board_1", "backlog").map((card) => card.id), ["c", "b"]);
  assert.deepEqual(cardsInColumn(data, "board_1", "backlog").map((card) => card.position), [0, 1]);
  assert.deepEqual(cardsInColumn(data, "board_1", "todo").map((card) => card.id), ["a"]);
});

test("deleting a card removes its runs", () => {
  let data = addCard(boardData(), "card_1");
  const run: Run = {
    id: "run_1",
    cardId: "card_1",
    agentId: "agent_1",
    workspaceId: "workspace_1",
    provider: "codex/gpt-6.1-sol",
    agentProfileId: null,
    agentProfileName: null,
    workspaceName: "main",
    branchName: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  data = applyBoardOperation(data, { type: "add-run", run });
  data = applyBoardOperation(data, { type: "delete-card", cardId: "card_1" });

  assert.equal(data.cards.length, 0);
  assert.equal(data.runs.length, 0);
});

test("reconciles a labeled agent idempotently", () => {
  let data = addCard(boardData(), "card_1");
  const agent = {
    agentId: "agent_1",
    workspaceId: "workspace_1",
    provider: "codex/gpt-6.1-sol",
    workspaceName: "main",
    createdAt: NOW,
    updatedAt: NOW,
    labels: {
      "kanban.boardId": "board_1",
      "kanban.cardId": "card_1",
      "kanban.runId": "run_1",
      "kanban.agentProfileId": "agent_profile_1",
    },
  };
  data = applyBoardOperation(data, { type: "reconcile-runs", agents: [agent] });
  data = applyBoardOperation(data, { type: "reconcile-runs", agents: [agent] });

  assert.equal(data.runs.length, 1);
  assert.equal(data.runs[0]?.agentId, "agent_1");
  assert.equal(data.runs[0]?.agentProfileId, "agent_profile_1");
  assert.equal(data.runs[0]?.workspaceName, "main");
});

test("does not rewrite a run when agent labels conflict", () => {
  let data = addCard(boardData(), "card_1");
  const run: Run = {
    id: "run_1",
    cardId: "card_1",
    agentId: "agent_1",
    workspaceId: "workspace_1",
    provider: "codex/gpt-6.1-sol",
    agentProfileId: null,
    agentProfileName: null,
    workspaceName: "main",
    branchName: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  data = applyBoardOperation(data, { type: "add-run", run });
  data = applyBoardOperation(data, {
    type: "reconcile-runs",
    agents: [
      {
        agentId: "agent_2",
        workspaceId: "workspace_2",
        provider: "codex/gpt-6.1-sol",
        workspaceName: "review",
        createdAt: NOW,
        updatedAt: NOW,
        labels: {
          "kanban.boardId": "board_1",
          "kanban.cardId": "card_1",
          "kanban.runId": "run_1",
        },
      },
    ],
  });

  assert.equal(data.runs.length, 1);
  assert.equal(data.runs[0]?.agentId, "agent_1");
  assert.equal(data.runs[0]?.workspaceId, "workspace_1");
});

test("reconciliation preserves when an existing run was attached", () => {
  let data = addCard(boardData(), "card_1");
  const attachedAt = "2026-10-02T14:00:00.000Z";
  data = applyBoardOperation(data, {
    type: "add-run",
    run: {
      id: "run_1",
      cardId: "card_1",
      agentId: "agent_1",
      workspaceId: "workspace_1",
      provider: "codex",
      agentProfileId: null,
      agentProfileName: null,
      workspaceName: "main",
      branchName: null,
      createdAt: attachedAt,
      updatedAt: attachedAt,
    },
  });
  data = applyBoardOperation(data, {
    type: "reconcile-runs",
    agents: [
      {
        agentId: "agent_1",
        workspaceId: "workspace_1",
        workspaceName: "main",
        provider: "codex",
        createdAt: NOW,
        updatedAt: NOW,
        labels: {
          "kanban.boardId": "board_1",
          "kanban.cardId": "card_1",
          "kanban.runId": "run_1",
        },
      },
    ],
  });

  assert.equal(data.runs[0]?.createdAt, attachedAt);
  assert.equal(data.runs[0]?.updatedAt, attachedAt);
});

test("rejects card content outside persistence limits", () => {
  assert.throws(
    () =>
      applyBoardOperation(boardData(), {
        type: "create-card",
        boardId: "board_1",
        cardId: "card_1",
        title: "x".repeat(161),
        description: "",
        column: "backlog",
        now: NOW,
      }),
    /160 characters or fewer/,
  );
});

test("migrates version 1 runs to current run metadata", () => {
  const old = {
    ...addCard(boardData(), "card_1"),
    version: 1,
    runs: [
      {
        id: "run_1",
        cardId: "card_1",
        agentId: "agent_1",
        workspaceId: "workspace_1",
        provider: "codex",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  };
  const migrated = BoardDataSchema.parse(migrateBoardData(old, 1));

  assert.equal(migrated.version, 3);
  assert.equal(migrated.runs[0]?.agentProfileId, null);
  assert.equal(migrated.runs[0]?.agentProfileName, null);
  assert.equal(migrated.runs[0]?.workspaceName, null);
  assert.equal(migrated.runs[0]?.branchName, null);
});

test("migrates version 2 runs with profile metadata", () => {
  const current = addCard(boardData(), "card_1");
  const old = {
    ...current,
    version: 2,
    runs: [
      {
        id: "run_1",
        cardId: "card_1",
        agentId: "agent_1",
        workspaceId: "workspace_1",
        provider: "codex",
        agentProfileId: "profile_1",
        agentProfileName: "Reviewer",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  };
  const migrated = BoardDataSchema.parse(migrateBoardData(old, 2));

  assert.equal(migrated.runs[0]?.agentProfileName, "Reviewer");
  assert.equal(migrated.runs[0]?.workspaceName, null);
});

test("presents agent states and only continues eligible idle agents", () => {
  assert.deepEqual(runStatus(undefined), { label: "Agent missing", tone: "warning" });
  assert.deepEqual(runStatus({ status: "idle" }), { label: "Idle", tone: "muted" });
  assert.deepEqual(
    runStatus({ status: "idle", attentionReason: "permission" }),
    { label: "Permission required", motion: "pulse", tone: "warning" },
  );
  assert.deepEqual(
    runStatus({ status: "error", attentionReason: "error" }),
    { label: "Error", tone: "danger" },
  );
  assert.deepEqual(
    runStatus({ status: "idle", attentionReason: "finished" }),
    { label: "Review suggested", tone: "success" },
  );
  assert.deepEqual(
    runStatus({ status: "initializing" }),
    { label: "Initializing", motion: "pulse", tone: "accent" },
  );
  assert.deepEqual(
    runStatus({ status: "running" }),
    { label: "Running", motion: "pulse", tone: "accent" },
  );
  assert.deepEqual(runStatus({ status: "closed" }), { label: "Closed", tone: "muted" });
  assert.deepEqual(
    runStatus({ status: "idle", archivedAt: NOW }),
    { label: "Archived", tone: "muted" },
  );
  assert.equal(canContinueAgent({ status: "idle", attentionReason: "finished" }), true);
  assert.equal(canContinueAgent({ status: "running" }), false);
  assert.equal(canContinueAgent({ status: "idle", archivedAt: NOW }), false);
});

test("builds searchable card attachment snapshots", () => {
  let data = addCard(boardData(), "card_1", "todo");
  data = applyBoardOperation(data, {
    type: "update-card",
    cardId: "card_1",
    title: "Repair reconciliation",
    description: "Keep agent links stable after reconnect.",
    now: NOW,
  });

  const items = findCardAttachments(data, "reconnect");
  assert.equal(items.length, 1);
  assert.equal(items[0]?.identifier, "PK-1");
  assert.match(items[0]?.text ?? "", /Status: Ready/);
  assert.match(items[0]?.url ?? "", /^paseo:\/\/kanban\/card\//);
  assert.equal(searchKanbanCards.output.safeParse({ items }).success, true);
  assert.equal(findCardAttachments(data, "missing").length, 0);
});

test("rejects unsupported settings versions instead of resetting data", () => {
  assert.throws(() => migrateBoardData({ version: 4 }, 4), /Cannot migrate/);
  assert.equal(BoardDataSchema.safeParse({ version: 4, boards: [], cards: [], runs: [] }).success, false);
});

test("rejects imports with broken record relationships", () => {
  const data = addCard(boardData(), "card_1");
  const invalid = { ...data, boards: [] };

  assert.equal(BoardDataSchema.safeParse(invalid).success, false);
});

test("materializes every agent profile execution option", () => {
  assert.deepEqual(
    materializeAgentProfile({
      id: "agent_profile_1",
      name: "Review",
      provider: "codex",
      model: "gpt-6.1-sol",
      modeId: "full-access",
      thinkingOptionId: "xhigh",
      featureValues: { review: true },
    }),
    {
      provider: "codex",
      model: "gpt-6.1-sol",
      modeId: "full-access",
      thinkingOptionId: "xhigh",
      featureValues: { review: true },
    },
  );
});
