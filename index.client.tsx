import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AgentCardPanel } from "./client/AgentCardPanel";
import { BoardSurface } from "./client/BoardSurface";
import { registerKanbanComposerPills } from "./client/registerCardIntegrations";
import { registerScheduledDispatcher } from "./client/registerScheduledDispatcher";
import { kanbanCardsAttachmentSource } from "./shared/cardAttachments";

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
  const removeAgentPanel = client.addWorkspacePanel({
    id: "kanban-card",
    title: "Kanban card",
    icon: "Columns3",
    context: "agent",
    locations: ["workspace", "explorer"],
    Component: AgentCardPanel,
  });
  const removeAgentCommand = client.addCommandCenterItem({
    id: "open-kanban-card",
    title: "Open linked Kanban card",
    icon: "Columns3",
    keywords: ["card", "task", "run"],
    context: "agent",
    onSelect({ openPanel }) {
      openPanel("kanban-card");
    },
  });
  const removeAttachmentSource = client.addAttachmentSource(kanbanCardsAttachmentSource);
  const removeComposerPills = registerKanbanComposerPills(client);
  const removeScheduledDispatcher = registerScheduledDispatcher(client);

  return () => {
    removeScheduledDispatcher();
    removeComposerPills();
    removeAttachmentSource();
    removeAgentCommand();
    removeAgentPanel();
    removeCommand();
    removeSidebar();
    removeSurface();
  };
}
