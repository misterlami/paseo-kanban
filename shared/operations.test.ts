import assert from "node:assert/strict";
import test from "node:test";
import { AutomationSettingsSchema, BoardDataSchema, type BoardData, type Run } from "./model";
import {
  applyBoardOperation,
  boardForProject,
  boardKeyPrefix,
  cardsInColumn,
  nextReadyCard,
  persistedIndexForVisibleDrop,
} from "./operations";
import { agentPrompt, dailyDispatchDue, dispatchBranchName, scheduledRunForDate } from "./automation";
import { persistBoardOperations, type BoardSettingsPort } from "./persistence";
import { migrateBoardData, migrateDisplaySettings } from "./settings";
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

test("maps filtered drag positions back to persisted column positions", () => {
  const data = addCard(addCard(addCard(addCard(boardData(), "a"), "b"), "c"), "d");
  const allCards = cardsInColumn(data, "board_1", "backlog");
  const visibleCards = allCards.filter((card) => card.id === "b" || card.id === "d");

  assert.equal(persistedIndexForVisibleDrop(allCards, visibleCards, 0), 1);
  assert.equal(persistedIndexForVisibleDrop(allCards, visibleCards, 1), 3);
  assert.equal(persistedIndexForVisibleDrop(allCards, visibleCards, 2), 4);
  assert.equal(persistedIndexForVisibleDrop(allCards, [], 0), 4);
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
    scheduledLocalDate: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  data = applyBoardOperation(data, { type: "add-run", run });
  data = applyBoardOperation(data, { type: "delete-card", cardId: "card_1", now: NOW });

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
      "kanban.scheduledLocalDate": "2026-10-02",
    },
  };
  data = applyBoardOperation(data, { type: "reconcile-runs", agents: [agent] });
  data = applyBoardOperation(data, { type: "reconcile-runs", agents: [agent] });

  assert.equal(data.runs.length, 1);
  assert.equal(data.runs[0]?.agentId, "agent_1");
  assert.equal(data.runs[0]?.agentProfileId, "agent_profile_1");
  assert.equal(data.runs[0]?.workspaceName, "main");
  assert.equal(data.runs[0]?.scheduledLocalDate, "2026-10-02");
});

test("ignores an invalid scheduled date label during reconciliation", () => {
  let data = addCard(boardData(), "card_1");
  data = applyBoardOperation(data, {
    type: "reconcile-runs",
    agents: [{
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
        "kanban.scheduledLocalDate": "not-a-date",
      },
    }],
  });

  assert.equal(data.runs[0]?.scheduledLocalDate, null);
  assert.doesNotThrow(() => BoardDataSchema.parse(data));
});

test("reconciliation finalizes a claimed Ready card after an interrupted save", () => {
  let data = addCard(boardData(), "card_1", "todo");
  data = applyBoardOperation(data, {
    type: "claim-card",
    claimId: "run_1",
    cardId: "card_1",
    source: "scheduled",
    now: NOW,
    expiresAt: "2026-10-02T12:30:00.000Z",
  });
  data = applyBoardOperation(data, {
    type: "reconcile-runs",
    agents: [{
      agentId: "agent_1",
      workspaceId: "workspace_1",
      provider: "codex/gpt-6.1-sol",
      workspaceName: "PK-1",
      createdAt: NOW,
      updatedAt: NOW,
      labels: {
        "kanban.boardId": "board_1",
        "kanban.cardId": "card_1",
        "kanban.runId": "run_1",
      },
    }],
  });

  assert.equal(data.claims.length, 0);
  assert.equal(data.runs[0]?.agentId, "agent_1");
  assert.equal(data.cards[0]?.column, "in_progress");
});

test("reconciliation clears only the claim belonging to the recovered run", () => {
  let data = addCard(boardData(), "card_1", "todo");
  data = applyBoardOperation(data, {
    type: "claim-card",
    claimId: "new_run",
    cardId: "card_1",
    source: "manual",
    now: "2026-10-02T12:31:00.000Z",
    expiresAt: "2026-10-02T13:01:00.000Z",
  });
  data = applyBoardOperation(data, {
    type: "reconcile-runs",
    agents: [{
      agentId: "old_agent",
      workspaceId: "old_workspace",
      provider: "codex/gpt-6.1-sol",
      workspaceName: null,
      createdAt: NOW,
      updatedAt: "2026-10-02T12:31:00.000Z",
      labels: {
        "kanban.boardId": "board_1",
        "kanban.cardId": "card_1",
        "kanban.runId": "old_run",
      },
    }],
  });

  assert.equal(data.claims[0]?.id, "new_run");
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
    scheduledLocalDate: null,
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
      scheduledLocalDate: null,
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

  assert.equal(migrated.version, 5);
  assert.deepEqual(migrated.claims, []);
  assert.equal(migrated.runs[0]?.agentProfileId, null);
  assert.equal(migrated.runs[0]?.agentProfileName, null);
  assert.equal(migrated.runs[0]?.workspaceName, null);
  assert.equal(migrated.runs[0]?.branchName, null);
  assert.equal(migrated.runs[0]?.scheduledLocalDate, null);
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
  assert.deepEqual(migrated.claims, []);
});

test("migrates version 3 board data without discarding run metadata", () => {
  let current = addCard(boardData(), "card_1");
  current = applyBoardOperation(current, {
    type: "add-run",
    run: {
      id: "run_1",
      cardId: "card_1",
      agentId: "agent_1",
      workspaceId: "workspace_1",
      provider: "codex/gpt-6.1-sol",
      agentProfileId: "profile_1",
      agentProfileName: "Builder",
      workspaceName: "Feature worktree",
      branchName: "codex/feature",
      scheduledLocalDate: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
  const old = { ...current, version: 3 };
  delete (old as { claims?: unknown }).claims;
  delete (old.runs[0] as { scheduledLocalDate?: unknown }).scheduledLocalDate;

  const migrated = BoardDataSchema.parse(migrateBoardData(old, 3));

  assert.equal(migrated.version, 5);
  assert.deepEqual(migrated.claims, []);
  assert.equal(migrated.runs[0]?.workspaceName, "Feature worktree");
  assert.equal(migrated.runs[0]?.branchName, "codex/feature");
  assert.equal(migrated.runs[0]?.scheduledLocalDate, null);
});

test("migrates version 4 board data while preserving dispatch claims", () => {
  let current = addCard(boardData(), "card_1", "todo");
  current = applyBoardOperation(current, {
    type: "claim-card",
    claimId: "run_1",
    cardId: "card_1",
    source: "scheduled",
    now: NOW,
    expiresAt: "2026-10-02T12:30:00.000Z",
  });
  const old = { ...current, version: 4 };

  const migrated = BoardDataSchema.parse(migrateBoardData(old, 4));

  assert.equal(migrated.version, 5);
  assert.equal(migrated.claims[0]?.id, "run_1");
});

test("migrates display settings to the project view", () => {
  assert.deepEqual(
    migrateDisplaySettings({ version: 1, selectedProjectId: "project_1", filter: "ready" }, 1),
    { version: 2, selectedProjectId: "project_1", filter: "ready", view: "project" },
  );
});

test("presents agent states and only continues eligible idle agents", () => {
  assert.deepEqual(runStatus(undefined), { label: "Unknown", tone: "warning" });
  assert.deepEqual(runStatus({ status: "idle" }), { label: "Idle", tone: "muted" });
  assert.deepEqual(
    runStatus({ status: "idle", attentionReason: "permission" }),
    { label: "Needs input", motion: "pulse", tone: "warning" },
  );
  assert.deepEqual(
    runStatus({ status: "error", attentionReason: "error" }),
    { label: "Failed", tone: "danger" },
  );
  assert.deepEqual(
    runStatus({ status: "idle", attentionReason: "finished" }),
    { label: "Needs review", tone: "success" },
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
  assert.equal(canContinueAgent({ status: "idle" }), true);
  assert.equal(canContinueAgent({ status: "idle", attentionReason: "finished" }), true);
  assert.equal(canContinueAgent(undefined), false);
  assert.equal(canContinueAgent({ status: "idle", attentionReason: "permission" }), false);
  assert.equal(canContinueAgent({ status: "error", attentionReason: "error" }), false);
  assert.equal(canContinueAgent({ status: "running" }), false);
  assert.equal(canContinueAgent({ status: "closed" }), false);
  assert.equal(canContinueAgent({ status: "idle", archivedAt: NOW }), false);
});

test("claims and completes a Ready-card dispatch atomically", () => {
  let data = addCard(boardData(), "card_1", "todo");
  data = applyBoardOperation(data, {
    type: "claim-card",
    claimId: "run_1",
    cardId: "card_1",
    source: "scheduled",
    now: NOW,
    expiresAt: "2026-10-02T12:30:00.000Z",
  });
  assert.equal(data.claims[0]?.cardId, "card_1");
  assert.throws(
    () => applyBoardOperation(data, {
      type: "claim-card",
      claimId: "run_2",
      cardId: "card_1",
      source: "manual",
      now: NOW,
      expiresAt: "2026-10-02T12:30:00.000Z",
    }),
    /already being dispatched/,
  );
  assert.throws(
    () => applyBoardOperation(data, {
      type: "move-card",
      cardId: "card_1",
      column: "in_progress",
      index: 0,
      now: NOW,
    }),
    /being dispatched and cannot be moved/,
  );
  assert.throws(
    () => applyBoardOperation(data, { type: "delete-card", cardId: "card_1", now: NOW }),
    /being dispatched and cannot be deleted/,
  );

  const run: Run = {
    id: "run_1",
    cardId: "card_1",
    agentId: "agent_1",
    workspaceId: "workspace_1",
    provider: "codex/gpt-6.1-sol",
    agentProfileId: "profile_1",
    agentProfileName: "Builder",
    workspaceName: "PK-1",
    branchName: "codex/pk-1-work",
    scheduledLocalDate: "2026-10-02",
    createdAt: NOW,
    updatedAt: NOW,
  };
  const operation = {
    type: "complete-dispatch" as const,
    claimId: "run_1",
    run,
    moveToInProgress: true,
    now: NOW,
  };
  data = applyBoardOperation(data, operation);
  data = applyBoardOperation(data, operation);

  assert.equal(data.claims.length, 0);
  assert.equal(data.runs.length, 1);
  assert.equal(data.cards[0]?.column, "in_progress");
  assert.equal(scheduledRunForDate(data, "2026-10-02")?.id, "run_1");
});

test("does not treat an agent linked by another run as an idempotent completion", () => {
  let data = addCard(addCard(boardData(), "card_1", "todo"), "card_2", "todo");
  const existingRun: Run = {
    id: "run_1",
    cardId: "card_1",
    agentId: "agent_1",
    workspaceId: "workspace_1",
    provider: "codex/gpt-6.1-sol",
    agentProfileId: null,
    agentProfileName: null,
    workspaceName: null,
    branchName: null,
    scheduledLocalDate: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  data = applyBoardOperation(data, { type: "add-run", run: existingRun });
  data = applyBoardOperation(data, {
    type: "claim-card",
    claimId: "run_2",
    cardId: "card_2",
    source: "manual",
    now: NOW,
    expiresAt: "2026-10-02T12:30:00.000Z",
  });

  assert.throws(
    () => applyBoardOperation(data, {
      type: "complete-dispatch",
      claimId: "run_2",
      run: { ...existingRun, id: "run_2", cardId: "card_2" },
      moveToInProgress: true,
      now: NOW,
    }),
    /already linked to another card/,
  );
});

test("does not complete an expired claim or overwrite later workflow movement", () => {
  let data = addCard(boardData(), "card_1", "todo");
  data = applyBoardOperation(data, {
    type: "claim-card",
    claimId: "run_1",
    cardId: "card_1",
    source: "scheduled",
    now: NOW,
    expiresAt: "2026-10-02T12:30:00.000Z",
  });
  data = applyBoardOperation(data, {
    type: "move-card",
    cardId: "card_1",
    column: "in_review",
    index: 0,
    now: "2026-10-02T12:31:00.000Z",
  });
  const run: Run = {
    id: "run_1",
    cardId: "card_1",
    agentId: "agent_1",
    workspaceId: "workspace_1",
    provider: "codex/gpt-6.1-sol",
    agentProfileId: null,
    agentProfileName: null,
    workspaceName: null,
    branchName: null,
    scheduledLocalDate: "2026-10-02",
    createdAt: NOW,
    updatedAt: "2026-10-02T12:31:00.000Z",
  };

  assert.throws(
    () => applyBoardOperation(data, {
      type: "complete-dispatch",
      claimId: "run_1",
      run,
      moveToInProgress: true,
      now: "2026-10-02T12:31:00.000Z",
    }),
    /claim expired/,
  );
  data = applyBoardOperation(data, {
    type: "reconcile-runs",
    agents: [{
      agentId: "agent_1",
      workspaceId: "workspace_1",
      provider: "codex/gpt-6.1-sol",
      workspaceName: null,
      createdAt: NOW,
      updatedAt: "2026-10-02T12:31:00.000Z",
      labels: {
        "kanban.boardId": "board_1",
        "kanban.cardId": "card_1",
        "kanban.runId": "run_1",
        "kanban.scheduledLocalDate": "2026-10-02",
      },
    }],
  });
  assert.equal(data.cards[0]?.column, "in_review");
  assert.equal(data.runs[0]?.scheduledLocalDate, "2026-10-02");
});

test("persists sequential claim and completion against fresh revisions", async () => {
  let revision = 0;
  let stored = addCard(boardData(), "card_1", "todo");
  const port: BoardSettingsPort = {
    async read() {
      return { status: "ready", revision: String(revision), values: stored };
    },
    async write(expectedRevision, values) {
      if (expectedRevision !== String(revision)) {
        return { status: "conflict", error: "revision conflict" };
      }
      revision += 1;
      stored = values;
      return { status: "saved", revision: String(revision), values: stored };
    },
  };
  const run: Run = {
    id: "run_1",
    cardId: "card_1",
    agentId: "agent_1",
    workspaceId: "workspace_1",
    provider: "codex/gpt-6.1-sol",
    agentProfileId: null,
    agentProfileName: null,
    workspaceName: null,
    branchName: null,
    scheduledLocalDate: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  await persistBoardOperations(port, [{
    type: "claim-card",
    claimId: run.id,
    cardId: run.cardId,
    source: "manual",
    now: NOW,
    expiresAt: "2026-10-02T12:30:00.000Z",
  }]);
  await persistBoardOperations(port, [{
    type: "complete-dispatch",
    claimId: run.id,
    run,
    moveToInProgress: true,
    now: NOW,
  }]);

  assert.equal(revision, 2);
  assert.equal(stored.claims.length, 0);
  assert.equal(stored.runs[0]?.agentId, "agent_1");
  assert.equal(stored.cards[0]?.column, "in_progress");
});

test("reloads and replays a small operation after a revision conflict", async () => {
  let revision = 0;
  let stored = boardData();
  let firstWrite = true;
  const port: BoardSettingsPort = {
    async read() {
      return { status: "ready", revision: String(revision), values: stored };
    },
    async write(expectedRevision, values) {
      if (firstWrite) {
        firstWrite = false;
        stored = addCard(stored, "concurrent_card");
        revision += 1;
        return { status: "conflict", error: "revision conflict" };
      }
      if (expectedRevision !== String(revision)) {
        return { status: "conflict", error: "revision conflict" };
      }
      revision += 1;
      stored = values;
      return { status: "saved", revision: String(revision), values: stored };
    },
  };

  await persistBoardOperations(port, [{
    type: "create-card",
    boardId: "board_1",
    cardId: "requested_card",
    title: "Requested card",
    description: "",
    column: "backlog",
    now: NOW,
  }]);

  assert.deepEqual(stored.cards.map((card) => card.id), ["concurrent_card", "requested_card"]);
});

test("selects the next unclaimed Ready card without an active run", () => {
  let data = addCard(addCard(addCard(boardData(), "a", "todo"), "b", "todo"), "c", "todo");
  data = applyBoardOperation(data, {
    type: "add-run",
    run: {
      id: "run_a",
      cardId: "a",
      agentId: "agent_a",
      workspaceId: "workspace_a",
      provider: "codex/gpt-6.1-sol",
      agentProfileId: null,
      agentProfileName: null,
      workspaceName: null,
      branchName: null,
      scheduledLocalDate: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
  data = applyBoardOperation(data, {
    type: "claim-card",
    claimId: "run_b",
    cardId: "b",
    source: "scheduled",
    now: NOW,
    expiresAt: "2026-10-02T12:30:00.000Z",
  });

  assert.equal(
    nextReadyCard(data, {
      activeAgentIds: new Set(["agent_a"]),
      externallyLinkedCardIds: new Set(["c"]),
      now: NOW,
    }),
    undefined,
  );
  assert.equal(nextReadyCard(data, { activeAgentIds: new Set(["agent_a"]), now: NOW })?.id, "c");
});

test("evaluates daily dispatch timing and creates safe execution values", () => {
  assert.equal(
    dailyDispatchDue(AutomationSettingsSchema.parse({}), new Date("2026-10-02T10:00:00.000Z")).due,
    false,
  );
  const settings = AutomationSettingsSchema.parse({
    enabled: true,
    dailyTime: "09:00",
    timezone: "UTC",
  });
  assert.deepEqual(dailyDispatchDue(settings, new Date("2026-10-02T08:59:00.000Z")), {
    date: "2026-10-02",
    due: false,
  });
  assert.deepEqual(dailyDispatchDue(settings, new Date("2026-10-02T09:00:00.000Z")), {
    date: "2026-10-02",
    due: true,
  });
  assert.equal(
    dailyDispatchDue(
      { ...settings, lastRunLocalDate: "2026-10-02" },
      new Date("2026-10-02T10:00:00.000Z"),
    ).due,
    false,
  );
  assert.equal(
    dailyDispatchDue(
      {
        ...settings,
        leaseId: "lease_1",
        leaseLocalDate: "2026-10-02",
        leaseExpiresAt: "2026-10-02T10:30:00.000Z",
      },
      new Date("2026-10-02T10:00:00.000Z"),
    ).due,
    false,
  );
  assert.equal(
    dispatchBranchName({ key: "PK-42", title: "Fix RPC race!" }, "run_123456"),
    "codex/pk-42-fix-rpc-race-123456",
  );
  assert.match(
    agentPrompt({ key: "PK-42", title: "Fix RPC race", description: "Keep the operation atomic." }),
    /Keep the operation atomic/,
  );
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
  assert.match(items[0]?.subtitle ?? "", /Keep agent links stable after reconnect/);
  assert.match(items[0]?.text ?? "", /Status: Ready/);
  assert.match(items[0]?.url ?? "", /^paseo:\/\/kanban\/card\//);
  assert.equal(searchKanbanCards.output.safeParse({ items }).success, true);
  assert.equal(findCardAttachments(data, "missing").length, 0);
});

test("rejects unsupported settings versions instead of resetting data", () => {
  assert.throws(() => migrateBoardData({ version: 6 }, 6), /Cannot migrate/);
  assert.equal(BoardDataSchema.safeParse({ version: 6, boards: [], cards: [], runs: [], claims: [] }).success, false);
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
      provider: "codex/gpt-6.1-sol",
      modeId: "full-access",
      thinkingOptionId: "xhigh",
      featureValues: { review: true },
    },
  );
});

test("preserves an agent profile provider that already includes its model", () => {
  assert.deepEqual(
    materializeAgentProfile({
      id: "agent_profile_2",
      name: "Review",
      provider: "codex/gpt-6.1-sol",
      modeId: "full-access",
    }),
    {
      provider: "codex/gpt-6.1-sol",
      modeId: "full-access",
    },
  );
});

test("rejects an agent profile without a model", () => {
  assert.throws(
    () => materializeAgentProfile({
      id: "agent_profile_3",
      name: "Incomplete",
      provider: "codex",
    }),
    /must specify a provider and model/,
  );
});
