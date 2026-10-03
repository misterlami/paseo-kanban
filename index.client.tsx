import type { PluginClientContext } from "@getpaseo/plugin/client";
import { BoardSurface } from "./client/BoardSurface";

export default function contribute(client: PluginClientContext) {
  const removeSurface = client.addSurface("board", BoardSurface);
  const removeSidebar = client.addSidebarItem({
    id: "board",
    title: "Kanban",
    icon: "Columns3",
    surface: "board",
  });
  const removeCommand = client.addCommandCenterItem({
    id: "open-board",
    title: "Open Kanban board",
    icon: "Columns3",
    keywords: ["cards", "tasks", "work"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("board");
    },
  });

  return () => {
    removeCommand();
    removeSidebar();
    removeSurface();
  };
}
