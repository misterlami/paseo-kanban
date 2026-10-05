import { z } from "zod";

export const BOARD_DATA_VERSION = 5 as const;
export const DISPLAY_SETTINGS_VERSION = 2 as const;
export const AUTOMATION_SETTINGS_VERSION = 1 as const;

export const BOARD_COLUMNS = ["backlog", "todo", "in_progress", "in_review", "done"] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];
export const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const BOARD_COLUMN_LABELS: Record<BoardColumn, string> = {
  backlog: "Backlog",
  todo: "Ready",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

export const BoardColumnSchema = z.enum(BOARD_COLUMNS);

export const BoardSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    name: z.string().min(1),
    keyPrefix: z.string().regex(/^[A-Z0-9]{2,6}$/),
    nextCardNumber: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const CardSchema = z
  .object({
    id: z.string().min(1),
    boardId: z.string().min(1),
    key: z.string().min(1),
    title: z.string().min(1).max(160),
    description: z.string().max(20_000),
    column: BoardColumnSchema,
    position: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const RunSchema = z
  .object({
    id: z.string().min(1),
    cardId: z.string().min(1),
    agentId: z.string().min(1),
    workspaceId: z.string().min(1),
    provider: z.string().min(1),
    agentProfileId: z.string().min(1).nullable().default(null),
    agentProfileName: z.string().min(1).nullable().default(null),
    workspaceName: z.string().min(1).nullable().default(null),
    branchName: z.string().min(1).nullable().default(null),
    scheduledLocalDate: LocalDateSchema.nullable().default(null),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const DispatchClaimSchema = z
  .object({
    id: z.string().min(1),
    cardId: z.string().min(1),
    source: z.enum(["manual", "scheduled"]),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export const BoardDataSchema = z
  .object({
    version: z.literal(BOARD_DATA_VERSION).default(BOARD_DATA_VERSION),
    boards: z.array(BoardSchema).default([]),
    cards: z.array(CardSchema).default([]),
    runs: z.array(RunSchema).default([]),
    claims: z.array(DispatchClaimSchema).default([]),
  })
  .strict()
  .superRefine((data, context) => {
    const boardIds = new Set<string>();
    const projectIds = new Set<string>();
    for (const [index, board] of data.boards.entries()) {
      if (boardIds.has(board.id)) {
        context.addIssue({ code: "custom", message: "Duplicate board ID", path: ["boards", index, "id"] });
      }
      if (projectIds.has(board.projectId)) {
        context.addIssue({
          code: "custom",
          message: "A project can have only one board",
          path: ["boards", index, "projectId"],
        });
      }
      boardIds.add(board.id);
      projectIds.add(board.projectId);
    }

    const cardIds = new Set<string>();
    const cardKeys = new Set<string>();
    const positions = new Set<string>();
    for (const [index, card] of data.cards.entries()) {
      if (cardIds.has(card.id)) {
        context.addIssue({ code: "custom", message: "Duplicate card ID", path: ["cards", index, "id"] });
      }
      if (!boardIds.has(card.boardId)) {
        context.addIssue({
          code: "custom",
          message: "Card references an unknown board",
          path: ["cards", index, "boardId"],
        });
      }
      const key = `${card.boardId}\u0000${card.key}`;
      if (cardKeys.has(key)) {
        context.addIssue({ code: "custom", message: "Duplicate card key", path: ["cards", index, "key"] });
      }
      const position = `${card.boardId}\u0000${card.column}\u0000${card.position}`;
      if (positions.has(position)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate card position",
          path: ["cards", index, "position"],
        });
      }
      cardIds.add(card.id);
      cardKeys.add(key);
      positions.add(position);
    }

    const runIds = new Set<string>();
    const agentIds = new Set<string>();
    for (const [index, run] of data.runs.entries()) {
      if (runIds.has(run.id)) {
        context.addIssue({ code: "custom", message: "Duplicate run ID", path: ["runs", index, "id"] });
      }
      if (agentIds.has(run.agentId)) {
        context.addIssue({
          code: "custom",
          message: "An agent can be linked to only one run",
          path: ["runs", index, "agentId"],
        });
      }
      if (!cardIds.has(run.cardId)) {
        context.addIssue({
          code: "custom",
          message: "Run references an unknown card",
          path: ["runs", index, "cardId"],
        });
      }
      runIds.add(run.id);
      agentIds.add(run.agentId);
    }

    const claimIds = new Set<string>();
    const claimedCards = new Set<string>();
    for (const [index, claim] of data.claims.entries()) {
      if (claimIds.has(claim.id)) {
        context.addIssue({ code: "custom", message: "Duplicate dispatch claim ID", path: ["claims", index, "id"] });
      }
      if (claimedCards.has(claim.cardId)) {
        context.addIssue({
          code: "custom",
          message: "A card can have only one dispatch claim",
          path: ["claims", index, "cardId"],
        });
      }
      if (!cardIds.has(claim.cardId)) {
        context.addIssue({
          code: "custom",
          message: "Dispatch claim references an unknown card",
          path: ["claims", index, "cardId"],
        });
      }
      claimIds.add(claim.id);
      claimedCards.add(claim.cardId);
    }
  });

export const DisplaySettingsSchema = z
  .object({
    version: z.literal(DISPLAY_SETTINGS_VERSION).default(DISPLAY_SETTINGS_VERSION),
    selectedProjectId: z.string().nullable().default(null),
    filter: z.string().max(500).default(""),
    view: z.enum(["project", "all"]).default("project"),
  })
  .strict();

export const AutomationSettingsSchema = z
  .object({
    version: z.literal(AUTOMATION_SETTINGS_VERSION).default(AUTOMATION_SETTINGS_VERSION),
    enabled: z.boolean().default(false),
    dailyTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("09:00"),
    timezone: z.string().min(1).nullable().default(null),
    agentProfileId: z.string().min(1).nullable().default(null),
    baseRef: z.string().min(1).max(200).default("origin/main"),
    maxConcurrent: z.number().int().min(1).max(10).default(1),
    lastRunLocalDate: LocalDateSchema.nullable().default(null),
    leaseId: z.string().min(1).nullable().default(null),
    leaseLocalDate: LocalDateSchema.nullable().default(null),
    leaseExpiresAt: z.string().datetime().nullable().default(null),
    lastAttemptAt: z.string().datetime().nullable().default(null),
    lastOutcome: z.enum(["dispatched", "no_ready", "at_capacity", "failed"]).nullable().default(null),
    lastMessage: z.string().max(500).nullable().default(null),
  })
  .strict();

export type Board = z.infer<typeof BoardSchema>;
export type Card = z.infer<typeof CardSchema>;
export type Run = z.infer<typeof RunSchema>;
export type DispatchClaim = z.infer<typeof DispatchClaimSchema>;
export type BoardData = z.infer<typeof BoardDataSchema>;
export type DisplaySettings = z.infer<typeof DisplaySettingsSchema>;
export type AutomationSettings = z.infer<typeof AutomationSettingsSchema>;

export const EMPTY_BOARD_DATA: BoardData = {
  version: BOARD_DATA_VERSION,
  boards: [],
  cards: [],
  runs: [],
  claims: [],
};

export const EMPTY_DISPLAY_SETTINGS: DisplaySettings = {
  version: DISPLAY_SETTINGS_VERSION,
  selectedProjectId: null,
  filter: "",
  view: "project",
};

export const EMPTY_AUTOMATION_SETTINGS: AutomationSettings = {
  version: AUTOMATION_SETTINGS_VERSION,
  enabled: false,
  dailyTime: "09:00",
  timezone: null,
  agentProfileId: null,
  baseRef: "origin/main",
  maxConcurrent: 1,
  lastRunLocalDate: null,
  leaseId: null,
  leaseLocalDate: null,
  leaseExpiresAt: null,
  lastAttemptAt: null,
  lastOutcome: null,
  lastMessage: null,
};

export const AGENT_LABELS = {
  boardId: "kanban.boardId",
  cardId: "kanban.cardId",
  runId: "kanban.runId",
  agentProfileId: "kanban.agentProfileId",
  cardKey: "kanban.cardKey",
  scheduledLocalDate: "kanban.scheduledLocalDate",
} as const;
