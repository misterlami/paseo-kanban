import { settingsRpc } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AgentProfilesSchema } from "../shared/agentProfiles";
import {
  agentPrompt,
  dailyDispatchDue,
  dispatchBranchName,
  scheduledRunForDate,
} from "../shared/automation";
import {
  AGENT_LABELS,
  AutomationSettingsSchema,
  type AutomationSettings,
  type BoardData,
  type Run,
} from "../shared/model";
import { createId, nextReadyCard, type AgentLink, type BoardOperation } from "../shared/operations";
import {
  persistBoardOperations,
  readBoardData,
  type BoardSettingsPort,
} from "../shared/persistence";
import { isActiveAgent } from "../shared/runState";
import { automationSettings, boardDataSettings } from "../shared/settings";
import { resolveAgentExecution } from "./agentExecution";

const boardRpc = settingsRpc(boardDataSettings.id);
const automationRpc = settingsRpc(automationSettings.id);
const CLAIM_LIFETIME_MS = 30 * 60 * 1_000;
const LEASE_LIFETIME_MS = 45 * 60 * 1_000;
const FULL_RECONCILIATION_INTERVAL_MS = 5 * 60 * 1_000;
const RECONCILIATION_RETRY_INTERVAL_MS = 30 * 1_000;

type DispatchOutcome = AutomationSettings["lastOutcome"];

interface DispatchResult {
  message: string;
  outcome: Exclude<DispatchOutcome, null>;
}

async function listAgents(client: PluginClientContext) {
  const agents = [];
  let cursor: string | undefined;
  do {
    const page = await client.paseo.agents.list({
      filter: { includeArchived: true },
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    agents.push(...page.entries.map((entry) => entry.agent));
    cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
  } while (cursor);
  return agents;
}

type ListedAgent = Awaited<ReturnType<typeof listAgents>>[number];

function boardPort(client: PluginClientContext): BoardSettingsPort {
  return {
    read: () => client.rpc(boardRpc.read, {}),
    write: (revision, values) => client.rpc(boardRpc.write, { revision, values }),
  };
}

async function saveBoardOperation(
  client: PluginClientContext,
  operation: BoardOperation,
): Promise<BoardData> {
  return persistBoardOperations(boardPort(client), [operation]);
}

async function releaseClaim(client: PluginClientContext, claimId: string): Promise<void> {
  try {
    await saveBoardOperation(client, { type: "release-claim", claimId });
  } catch {
    // Expired claims are ignored by selection and can be removed by a later write.
  }
}

function agentLinks(agents: readonly ListedAgent[]): AgentLink[] {
  return agents.flatMap((agent) => {
    if (!agent.workspaceId) return [];
    return [{
      agentId: agent.id,
      workspaceId: agent.workspaceId,
      provider: agent.provider,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      workspaceName: null,
      labels: agent.labels,
    }];
  });
}

async function reconcileAgents(
  client: PluginClientContext,
  agents: readonly ListedAgent[],
): Promise<BoardData> {
  const port = boardPort(client);
  const current = await readBoardData(port);
  const links = agentLinks(agents);
  const needsReconciliation = links.some((link) => {
    const runId = link.labels[AGENT_LABELS.runId];
    if (!runId) return false;
    const run = current.runs.find(
      (candidate) => candidate.id === runId || candidate.agentId === link.agentId,
    );
    return (
      !run ||
      run.workspaceId !== link.workspaceId ||
      run.agentId !== link.agentId ||
      (!run.scheduledLocalDate && Boolean(link.labels[AGENT_LABELS.scheduledLocalDate]))
    );
  });
  return needsReconciliation
    ? persistBoardOperations(port, [{ type: "reconcile-runs", agents: links }])
    : current;
}

export async function dispatchOneReadyCard(
  client: PluginClientContext,
  settings: AutomationSettings,
  scheduledLocalDate: string,
): Promise<DispatchResult> {
  const [projectsResult, agents] = await Promise.all([
    client.paseo.projects.list(),
    listAgents(client),
  ]);
  const projects = projectsResult.projects.filter((project) => project.projectKind === "git");
  const projectById = new Map(projects.map((project) => [project.projectId, project]));
  const initialData = await reconcileAgents(client, agents);
  const existingScheduledRun = scheduledRunForDate(initialData, scheduledLocalDate);
  if (existingScheduledRun) {
    const existingCard = initialData.cards.find((card) => card.id === existingScheduledRun.cardId);
    return {
      outcome: "dispatched",
      message: existingCard
        ? `${existingCard.key} was already dispatched for ${scheduledLocalDate}.`
        : `A card was already dispatched for ${scheduledLocalDate}.`,
    };
  }

  const activeAgents = agents.filter(isActiveAgent);
  if (activeAgents.filter((agent) => AGENT_LABELS.boardId in agent.labels).length >= settings.maxConcurrent) {
    return { outcome: "at_capacity", message: "No card dispatched because the concurrency limit is reached." };
  }

  const eligibleBoardIds = new Set(
    initialData.boards
      .filter((board) => projectById.has(board.projectId))
      .map((board) => board.id),
  );
  const now = new Date();
  const persistedAgentIds = new Set(initialData.runs.map((run) => run.agentId));
  const card = nextReadyCard(initialData, {
    activeAgentIds: new Set(activeAgents.map((agent) => agent.id)),
    eligibleBoardIds,
    externallyLinkedCardIds: new Set(
      agents.flatMap((agent) => {
        const cardId = agent.labels[AGENT_LABELS.cardId];
        return cardId && !persistedAgentIds.has(agent.id) ? [cardId] : [];
      }),
    ),
    now: now.toISOString(),
  });
  if (!card) return { outcome: "no_ready", message: "No eligible Ready card was found." };
  const board = initialData.boards.find((candidate) => candidate.id === card.boardId);
  const project = board ? projectById.get(board.projectId) : undefined;
  if (!board || !project) return { outcome: "no_ready", message: "No eligible Git project was found." };

  const configResult = await client.paseo.config.get();
  const profiles = AgentProfilesSchema.parse(configResult.config.agentProfiles ?? []);
  const execution = await resolveAgentExecution(
    client.paseo,
    profiles,
    settings.agentProfileId,
  );

  const claimId = createId("run");
  await saveBoardOperation(client, {
    type: "claim-card",
    claimId,
    cardId: card.id,
    source: "scheduled",
    now: now.toISOString(),
    expiresAt: new Date(now.getTime() + CLAIM_LIFETIME_MS).toISOString(),
  });

  let agentCreated = false;
  try {
    const branchName = dispatchBranchName(card, claimId);
    const workspaceTitle = `${card.key}: ${card.title}`;
    const workspace = await client.paseo.workspaces.create({
      idempotencyKey: claimId,
      title: workspaceTitle,
      source: {
        kind: "worktree",
        projectId: project.projectId,
        cwd: project.projectRootPath,
        action: "branch-off",
        refName: settings.baseRef,
        branchName,
      },
    });
    const agent = await workspace.agents.create({
      config: execution.config,
      title: workspaceTitle,
      labels: {
        [AGENT_LABELS.boardId]: board.id,
        [AGENT_LABELS.cardId]: card.id,
        [AGENT_LABELS.runId]: claimId,
        [AGENT_LABELS.cardKey]: card.key,
        [AGENT_LABELS.scheduledLocalDate]: scheduledLocalDate,
        ...(execution.profileId ? { [AGENT_LABELS.agentProfileId]: execution.profileId } : {}),
      },
      prompt: agentPrompt(card),
    });
    agentCreated = true;
    const timestamp = new Date().toISOString();
    const snapshot = agent.current();
    const run: Run = {
      id: claimId,
      cardId: card.id,
      agentId: agent.id,
      workspaceId: workspace.id,
      provider: execution.config.provider,
      agentProfileId: execution.profileId,
      agentProfileName: execution.profileName,
      workspaceName: workspaceTitle,
      branchName,
      scheduledLocalDate,
      createdAt: snapshot?.createdAt ?? timestamp,
      updatedAt: snapshot?.updatedAt ?? timestamp,
    };
    await saveBoardOperation(client, {
      type: "complete-dispatch",
      claimId,
      run,
      moveToInProgress: true,
      now: timestamp,
    });
    return { outcome: "dispatched", message: `Started ${card.key} in a new worktree.` };
  } catch (error) {
    if (!agentCreated) await releaseClaim(client, claimId);
    throw error;
  }
}

async function acquireDailyLease(
  client: PluginClientContext,
  now: Date,
): Promise<{ date: string; leaseId: string; settings: AutomationSettings } | null> {
  const state = await client.rpc(automationRpc.read, {});
  if (state.status !== "ready") return null;
  const settings = AutomationSettingsSchema.parse(state.values);
  const due = dailyDispatchDue(settings, now);
  if (!due.due) return null;
  const leaseId = createId("run");
  const next: AutomationSettings = {
    ...settings,
    leaseId,
    leaseLocalDate: due.date,
    leaseExpiresAt: new Date(now.getTime() + LEASE_LIFETIME_MS).toISOString(),
  };
  const saved = await client.rpc(automationRpc.write, { revision: state.revision, values: next });
  return saved.status === "saved" ? { date: due.date, leaseId, settings } : null;
}

async function finishDailyLease(
  client: PluginClientContext,
  lease: { date: string; leaseId: string },
  result: DispatchResult,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = await client.rpc(automationRpc.read, {});
    if (state.status !== "ready") return;
    const settings = AutomationSettingsSchema.parse(state.values);
    if (settings.leaseId !== lease.leaseId) return;
    const next: AutomationSettings = {
      ...settings,
      lastRunLocalDate: lease.date,
      leaseId: null,
      leaseLocalDate: null,
      leaseExpiresAt: null,
      lastAttemptAt: new Date().toISOString(),
      lastOutcome: result.outcome,
      lastMessage: result.message,
    };
    const saved = await client.rpc(automationRpc.write, { revision: state.revision, values: next });
    if (saved.status === "saved" || saved.status === "invalid") return;
  }
}

export function registerScheduledDispatcher(client: PluginClientContext) {
  let active = true;
  let running = false;
  let reconciliation = Promise.resolve();
  let fullReconciliation: Promise<void> | null = null;
  let nextFullReconciliationAt = 0;
  const queueReconciliation = (agents: readonly ListedAgent[]) => {
    reconciliation = reconciliation
      .then(async () => {
        if (active) await reconcileAgents(client, agents);
      })
      .catch(() => undefined);
    return reconciliation;
  };
  const reconcileDirectory = () => {
    const now = Date.now();
    if (fullReconciliation) return fullReconciliation;
    if (now < nextFullReconciliationAt) return Promise.resolve();
    const task = listAgents(client)
      .then((agents) => queueReconciliation(agents))
      .then(() => {
        nextFullReconciliationAt = Date.now() + FULL_RECONCILIATION_INTERVAL_MS;
      })
      .catch(() => {
        nextFullReconciliationAt = Date.now() + RECONCILIATION_RETRY_INTERVAL_MS;
      })
      .finally(() => {
        if (fullReconciliation === task) fullReconciliation = null;
      });
    fullReconciliation = task;
    return task;
  };
  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "upsert") queueReconciliation([update.agent]);
  });
  void reconcileDirectory();
  const tick = async () => {
    if (!active || running) return;
    running = true;
    try {
      await reconcileDirectory();
      const lease = await acquireDailyLease(client, new Date());
      if (!lease) return;
      let result: DispatchResult;
      try {
        result = await dispatchOneReadyCard(client, lease.settings, lease.date);
      } catch (error) {
        result = {
          outcome: "failed",
          message: error instanceof Error ? error.message.slice(0, 500) : "Scheduled dispatch failed.",
        };
      }
      await finishDailyLease(client, lease, result);
    } catch {
      // Connection loss is expected; the next interval retries after reconnect.
    } finally {
      running = false;
    }
  };
  const initialTimer = setTimeout(() => void tick(), 5_000);
  const timer = setInterval(() => void tick(), 30_000);
  return () => {
    active = false;
    clearTimeout(initialTimer);
    clearInterval(timer);
    unsubscribe();
  };
}
