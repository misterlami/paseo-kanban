import {
  AGENT_LABELS,
  BOARD_COLUMNS,
  type Board,
  type BoardColumn,
  type BoardData,
  type Card,
  type Run,
} from "./model";

export type BoardOperation =
  | {
      type: "ensure-board";
      boardId: string;
      projectId: string;
      projectName: string;
      now: string;
    }
  | {
      type: "create-card";
      cardId: string;
      boardId: string;
      title: string;
      description: string;
      column: BoardColumn;
      now: string;
    }
  | {
      type: "update-card";
      cardId: string;
      title: string;
      description: string;
      now: string;
    }
  | {
      type: "move-card";
      cardId: string;
      column: BoardColumn;
      index: number;
      now: string;
    }
  | { type: "delete-card"; cardId: string }
  | { type: "add-run"; run: Run }
  | { type: "reconcile-runs"; agents: AgentLink[] };

export interface AgentLink {
  agentId: string;
  workspaceId: string;
  provider: string;
  createdAt: string;
  updatedAt: string;
  workspaceName: string | null;
  labels: Record<string, string>;
}

export function createId(prefix: "board" | "card" | "run"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function boardKeyPrefix(name: string): string {
  const words = name.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  const initials = words.map((word) => word[0]).join("");
  const compact = words.join("");
  return (initials.length >= 2 ? initials : compact).slice(0, 6).padEnd(2, "X") || "KAN";
}

function clone(data: BoardData): BoardData {
  return {
    ...data,
    boards: data.boards.map((board) => ({ ...board })),
    cards: data.cards.map((card) => ({ ...card })),
    runs: data.runs.map((run) => ({ ...run })),
  };
}

function normalizeColumn(data: BoardData, boardId: string, column: BoardColumn): void {
  data.cards
    .filter((card) => card.boardId === boardId && card.column === column)
    .sort((left, right) => left.position - right.position || left.createdAt.localeCompare(right.createdAt))
    .forEach((card, position) => {
      card.position = position;
    });
}

function getCard(data: BoardData, cardId: string): Card {
  const card = data.cards.find((candidate) => candidate.id === cardId);
  if (!card) throw new Error(`Card ${cardId} does not exist`);
  return card;
}

export function applyBoardOperation(source: BoardData, operation: BoardOperation): BoardData {
  const data = clone(source);

  switch (operation.type) {
    case "ensure-board": {
      const existing = data.boards.find((board) => board.projectId === operation.projectId);
      if (existing) {
        if (existing.name !== operation.projectName) {
          existing.name = operation.projectName;
          existing.updatedAt = operation.now;
        }
        return data;
      }
      data.boards.push({
        id: operation.boardId,
        projectId: operation.projectId,
        name: operation.projectName,
        keyPrefix: boardKeyPrefix(operation.projectName),
        nextCardNumber: 1,
        createdAt: operation.now,
        updatedAt: operation.now,
      });
      return data;
    }

    case "create-card": {
      if (data.cards.some((card) => card.id === operation.cardId)) return data;
      const board = data.boards.find((candidate) => candidate.id === operation.boardId);
      if (!board) throw new Error(`Board ${operation.boardId} does not exist`);
      const title = operation.title.trim();
      if (!title) throw new Error("Card title is required");
      if (title.length > 160) throw new Error("Card title must be 160 characters or fewer");
      const description = operation.description.trim();
      if (description.length > 20_000) {
        throw new Error("Card description must be 20,000 characters or fewer");
      }
      const position = data.cards.filter(
        (card) => card.boardId === board.id && card.column === operation.column,
      ).length;
      data.cards.push({
        id: operation.cardId,
        boardId: board.id,
        key: `${board.keyPrefix}-${board.nextCardNumber}`,
        title,
        description,
        column: operation.column,
        position,
        createdAt: operation.now,
        updatedAt: operation.now,
      });
      board.nextCardNumber += 1;
      board.updatedAt = operation.now;
      return data;
    }

    case "update-card": {
      const card = getCard(data, operation.cardId);
      const title = operation.title.trim();
      if (!title) throw new Error("Card title is required");
      if (title.length > 160) throw new Error("Card title must be 160 characters or fewer");
      const description = operation.description.trim();
      if (description.length > 20_000) {
        throw new Error("Card description must be 20,000 characters or fewer");
      }
      card.title = title;
      card.description = description;
      card.updatedAt = operation.now;
      return data;
    }

    case "move-card": {
      const card = getCard(data, operation.cardId);
      const previousColumn = card.column;
      const destination = data.cards
        .filter(
          (candidate) =>
            candidate.boardId === card.boardId &&
            candidate.column === operation.column &&
            candidate.id !== card.id,
        )
        .sort((left, right) => left.position - right.position || left.createdAt.localeCompare(right.createdAt));
      const index = Math.max(0, Math.min(operation.index, destination.length));
      card.column = operation.column;
      destination.splice(index, 0, card);
      destination.forEach((candidate, position) => {
        candidate.position = position;
      });
      if (previousColumn !== operation.column) normalizeColumn(data, card.boardId, previousColumn);
      card.updatedAt = operation.now;
      return data;
    }

    case "delete-card": {
      const card = getCard(data, operation.cardId);
      data.cards = data.cards.filter((candidate) => candidate.id !== operation.cardId);
      data.runs = data.runs.filter((run) => run.cardId !== operation.cardId);
      normalizeColumn(data, card.boardId, card.column);
      return data;
    }

    case "add-run": {
      getCard(data, operation.run.cardId);
      const existing = data.runs.find(
        (run) => run.id === operation.run.id || run.agentId === operation.run.agentId,
      );
      if (existing) Object.assign(existing, operation.run);
      else data.runs.push({ ...operation.run });
      return data;
    }

    case "reconcile-runs": {
      for (const agent of operation.agents) {
        const boardId = agent.labels[AGENT_LABELS.boardId];
        const cardId = agent.labels[AGENT_LABELS.cardId];
        const runId = agent.labels[AGENT_LABELS.runId];
        if (!boardId || !cardId || !runId) continue;
        const card = data.cards.find((candidate) => candidate.id === cardId);
        if (!card || card.boardId !== boardId) continue;
        const byRunId = data.runs.find((run) => run.id === runId);
        const byAgentId = data.runs.find((run) => run.agentId === agent.agentId);
        if (byRunId && byRunId.agentId !== agent.agentId) continue;
        if (byAgentId && byAgentId.id !== runId) continue;
        if (byRunId && byAgentId && byRunId !== byAgentId) continue;
        const existing = byRunId ?? byAgentId;
        if (existing && existing.cardId !== cardId) continue;
        const reconciled: Run = {
          id: runId,
          cardId,
          agentId: agent.agentId,
          workspaceId: agent.workspaceId,
          provider: existing?.provider ?? agent.provider,
          agentProfileId:
            existing?.agentProfileId ?? agent.labels[AGENT_LABELS.agentProfileId] ?? null,
          agentProfileName: existing?.agentProfileName ?? null,
          workspaceName: existing?.workspaceName ?? agent.workspaceName,
          branchName: existing?.branchName ?? null,
          createdAt: existing?.createdAt ?? agent.createdAt,
          updatedAt:
            existing && existing.updatedAt.localeCompare(agent.updatedAt) > 0
              ? existing.updatedAt
              : agent.updatedAt,
        };
        if (existing) Object.assign(existing, reconciled);
        else data.runs.push(reconciled);
      }
      return data;
    }
  }
}

export function applyBoardOperations(
  source: BoardData,
  operations: readonly BoardOperation[],
): BoardData {
  return operations.reduce(applyBoardOperation, source);
}

export function cardsInColumn(data: BoardData, boardId: string, column: BoardColumn): Card[] {
  return data.cards
    .filter((card) => card.boardId === boardId && card.column === column)
    .sort((left, right) => left.position - right.position || left.createdAt.localeCompare(right.createdAt));
}

export function adjacentColumn(column: BoardColumn, offset: -1 | 1): BoardColumn | null {
  const index = BOARD_COLUMNS.indexOf(column);
  return BOARD_COLUMNS[index + offset] ?? null;
}

export function boardForProject(data: BoardData, projectId: string): Board | undefined {
  return data.boards.find((board) => board.projectId === projectId);
}
