import { defineSettings } from "@getpaseo/plugin";
import {
  BOARD_DATA_VERSION,
  BoardDataSchema,
  DISPLAY_SETTINGS_VERSION,
  DisplaySettingsSchema,
} from "./model";

function unsupported(name: string, fromVersion: number): never {
  throw new Error(`Cannot migrate ${name} settings from version ${fromVersion}`);
}

export function migrateBoardData(values: unknown, fromVersion: number): unknown {
  if (fromVersion === BOARD_DATA_VERSION) return values;
  return unsupported("board data", fromVersion);
}

export function migrateDisplaySettings(values: unknown, fromVersion: number): unknown {
  if (fromVersion === DISPLAY_SETTINGS_VERSION) return values;
  return unsupported("display", fromVersion);
}

export const boardDataSettings = defineSettings({
  id: "board-data",
  scope: "host",
  version: BOARD_DATA_VERSION,
  schema: BoardDataSchema,
  migrate: migrateBoardData,
});

export const displaySettings = defineSettings({
  id: "display",
  scope: "host",
  version: DISPLAY_SETTINGS_VERSION,
  schema: DisplaySettingsSchema,
  migrate: migrateDisplaySettings,
});
