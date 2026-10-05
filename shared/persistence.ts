import { BoardDataSchema, type BoardData } from "./model";
import { applyBoardOperations, type BoardOperation } from "./operations";

export type BoardSettingsReadResult =
  | { status: "ready"; revision: string; values: unknown }
  | { status: "invalid"; revision: string; error: string };

export type BoardSettingsWriteResult =
  | { status: "saved"; revision: string; values: unknown }
  | { status: "conflict"; error: string }
  | { status: "invalid"; error: string };

export interface BoardSettingsPort {
  read(): Promise<BoardSettingsReadResult>;
  write(revision: string, values: BoardData): Promise<BoardSettingsWriteResult>;
}

export async function readBoardData(port: BoardSettingsPort): Promise<BoardData> {
  const state = await port.read();
  if (state.status !== "ready") throw new Error(state.error);
  return BoardDataSchema.parse(state.values);
}

export async function persistBoardOperations(
  port: BoardSettingsPort,
  operations: readonly BoardOperation[],
): Promise<BoardData> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = await port.read();
    if (state.status !== "ready") throw new Error(state.error);
    const current = BoardDataSchema.parse(state.values);
    const next = BoardDataSchema.parse(applyBoardOperations(current, operations));
    const result = await port.write(state.revision, next);
    if (result.status === "saved") return BoardDataSchema.parse(result.values);
    if (result.status === "invalid") throw new Error(result.error);
  }
  throw new Error("Kanban board changed repeatedly while saving");
}
