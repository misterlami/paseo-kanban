import type { PluginServerContext } from "@getpaseo/plugin/server";
import { findCardAttachments, searchKanbanCards } from "./shared/cardAttachments";
import { automationSettings, boardDataSettings, displaySettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  const boardSettings = server.registerSettings(boardDataSettings);
  server.registerSettings(displaySettings);
  server.registerSettings(automationSettings);
  server.handle(searchKanbanCards, async ({ query }) => {
    const state = await boardSettings.read();
    if (state.status !== "ready") throw new Error("Kanban board data is invalid");
    return { items: findCardAttachments(state.values, query) };
  });
  return () => {};
}
