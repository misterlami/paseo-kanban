import { settingsRpc } from "@getpaseo/plugin";
import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { AGENT_LABELS, BoardDataSchema } from "../shared/model";
import { boardDataSettings } from "../shared/settings";

const boardRpc = settingsRpc(boardDataSettings.id);

interface PillAgent {
  archivedAt?: string | null;
  id: string;
  labels: Record<string, string>;
  workspaceId?: string;
}

interface PillRegistration {
  cardKey: string;
  registration: PluginButtonRegistration;
  workspaceId: string;
}

export function registerKanbanComposerPills(client: PluginClientContext) {
  let active = true;
  const registrations = new Map<string, PillRegistration>();
  const cardsByAgent = new Map<string, { cardKey: string; workspaceId: string }>();

  const remove = (agentId: string) => {
    registrations.get(agentId)?.registration.remove();
    registrations.delete(agentId);
  };

  const syncAgent = (agent: PillAgent) => {
    const saved = cardsByAgent.get(agent.id);
    const cardKey = agent.labels[AGENT_LABELS.cardKey] ?? saved?.cardKey;
    const cardId = agent.labels[AGENT_LABELS.cardId];
    const runId = agent.labels[AGENT_LABELS.runId];
    const workspaceId = agent.workspaceId ?? saved?.workspaceId;
    if (agent.archivedAt || !workspaceId || (!saved && (!cardId || !runId))) {
      remove(agent.id);
      return;
    }

    const label = cardKey ?? "Kanban card";
    const current = registrations.get(agent.id);
    if (current && current.cardKey === label && current.workspaceId === workspaceId) return;
    remove(agent.id);
    const registration = client.addComposerPill({
      id: "kanban-card",
      workspaceId,
      agentId: agent.id,
      button: {
        title: `Open ${label}`,
        label,
        icon: "Columns3",
        behavior: {
          kind: "action",
          onPress() {
            client.openPanel("kanban-card", { workspaceId, agentId: agent.id });
          },
        },
      },
    });
    registrations.set(agent.id, { cardKey: label, registration, workspaceId });
  };

  const refresh = async () => {
    const result = await client.rpc(boardRpc.read, {});
    if (!active || result.status !== "ready") return;
    const data = BoardDataSchema.parse(result.values);
    cardsByAgent.clear();
    for (const run of data.runs) {
      const card = data.cards.find((candidate) => candidate.id === run.cardId);
      if (card) cardsByAgent.set(run.agentId, { cardKey: card.key, workspaceId: run.workspaceId });
    }

    const agents: PillAgent[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.paseo.agents.list({
        filter: { includeArchived: true },
        page: { limit: 200, ...(cursor ? { cursor } : {}) },
      });
      agents.push(...page.entries.map((entry) => entry.agent));
      cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
    } while (cursor);
    if (!active) return;
    agents.forEach(syncAgent);
    const agentIds = new Set(agents.map((agent) => agent.id));
    for (const agentId of registrations.keys()) {
      if (!agentIds.has(agentId)) remove(agentId);
    }
  };

  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (!active) return;
    if (update.kind === "remove") remove(update.agentId);
    else syncAgent(update.agent);
  });
  const refreshSafely = () => void refresh().catch(() => undefined);
  refreshSafely();
  const refreshTimer = setInterval(refreshSafely, 60_000);

  return () => {
    active = false;
    clearInterval(refreshTimer);
    unsubscribe();
    for (const { registration } of registrations.values()) registration.remove();
    registrations.clear();
  };
}
