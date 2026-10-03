import type { PluginServerContext } from "@getpaseo/plugin/server";
import { boardDataSettings, displaySettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(boardDataSettings);
  server.registerSettings(displaySettings);
  return () => {};
}
