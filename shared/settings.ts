import { defineSettings } from "@getpaseo/plugin";
import {
  AUTOMATION_SETTINGS_VERSION,
  AutomationSettingsSchema,
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
  if (
    (fromVersion === 1 || fromVersion === 2 || fromVersion === 3 || fromVersion === 4) &&
    values &&
    typeof values === "object"
  ) {
    const data = values as { claims?: unknown[]; runs?: unknown[] } & Record<string, unknown>;
    return {
      ...data,
      version: BOARD_DATA_VERSION,
      claims: fromVersion < 4 ? [] : data.claims ?? [],
      runs: (data.runs ?? []).map((run) =>
        run && typeof run === "object"
          ? {
              ...run,
              ...(fromVersion === 1
                ? { agentProfileId: null, agentProfileName: null }
                : {}),
              ...(fromVersion <= 2
                ? { workspaceName: null, branchName: null }
                : {}),
              scheduledLocalDate: null,
            }
          : run,
      ),
    };
  }
  return unsupported("board data", fromVersion);
}

export function migrateDisplaySettings(values: unknown, fromVersion: number): unknown {
  if (fromVersion === DISPLAY_SETTINGS_VERSION) return values;
  if (fromVersion === 1 && values && typeof values === "object") {
    return { ...values, version: DISPLAY_SETTINGS_VERSION, view: "project" };
  }
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

export const automationSettings = defineSettings({
  id: "automation",
  scope: "host",
  version: AUTOMATION_SETTINGS_VERSION,
  schema: AutomationSettingsSchema,
});
