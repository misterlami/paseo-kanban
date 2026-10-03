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
    createdAt: NOW,
    updatedAt: NOW,
    labels: {
      "kanban.boardId": "board_1",
      "kanban.cardId": "card_1",
      "kanban.runId": "run_1",
    },
  };
  data = applyBoardOperation(data, { type: "reconcile-runs", agents: [agent] });
  data = applyBoardOperation(data, { type: "reconcile-runs", agents: [agent] });

  assert.equal(data.runs.length, 1);
  assert.equal(data.runs[0]?.agentId, "agent_1");
});

test("does not rewrite a run when agent labels conflict", () => {
  let data = addCard(boardData(), "card_1");
  const run: Run = {
    id: "run_1",
    cardId: "card_1",
    agentId: "agent_1",
    workspaceId: "workspace_1",
    provider: "codex/gpt-6.1-sol",
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

test("rejects unsupported settings versions instead of resetting data", () => {
  assert.throws(() => migrateBoardData({ version: 2 }, 2), /Cannot migrate/);
  assert.equal(BoardDataSchema.safeParse({ version: 2, boards: [], cards: [], runs: [] }).success, false);
});

test("rejects imports with broken record relationships", () => {
  const data = addCard(boardData(), "card_1");
  const invalid = { ...data, boards: [] };

  assert.equal(BoardDataSchema.safeParse(invalid).success, false);
});
