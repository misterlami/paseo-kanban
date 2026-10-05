import { usePaseo } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentProfilesSchema, type AgentProfile } from "../shared/agentProfiles";
import { AGENT_LABELS } from "../shared/model";
import { errorMessage } from "./errors";

export interface ProjectSummary {
  projectId: string;
  projectDisplayName: string;
  projectRootPath: string;
  projectKind: "git" | "non_git" | "directory";
}

export interface WorkspaceSummary {
  id: string;
  projectId: string;
  name: string;
  title?: string | null;
}

export interface AgentSummary {
  id: string;
  provider: string;
  model: string | null;
  title: string | null;
  workspaceId?: string;
  status: "initializing" | "idle" | "running" | "error" | "closed";
  labels: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  attentionReason?: "finished" | "error" | "permission" | null;
}

function isAgentForBoard(agent: AgentSummary, boardId: string | null): boolean {
  return Boolean(boardId && agent.labels[AGENT_LABELS.boardId] === boardId);
}

function isAgentForProject(agent: AgentSummary, workspaceIds: ReadonlySet<string>): boolean {
  return Boolean(agent.workspaceId && workspaceIds.has(agent.workspaceId));
}

function upsertAgent(current: AgentSummary[], next: AgentSummary): AgentSummary[] {
  const index = current.findIndex((agent) => agent.id === next.id);
  if (index < 0) return [...current, next];

  const copy = [...current];
  copy[index] = next;
  return copy;
}

export function usePaseoDirectory(
  projectId: string | null,
  boardId: string | null,
  allProjects = false,
  hostId?: string,
) {
  const paseo = usePaseo();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [profilesSupported, setProfilesSupported] = useState<boolean | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [workspaceRefresh, setWorkspaceRefresh] = useState(0);
  const [loadedHostId, setLoadedHostId] = useState<string | null>(null);

  const refreshAgentProfiles = useCallback(async () => {
    try {
      const result = await paseo.config.get();
      const profiles = AgentProfilesSchema.parse(result.config.agentProfiles ?? []);
      setProfilesSupported(true);
      setAgentProfiles(profiles);
      return profiles;
    } catch (cause) {
      setProfilesSupported(false);
      setError(errorMessage(cause));
      setAgentProfiles([]);
      return [];
    }
  }, [paseo]);

  const refreshWorkspaces = useCallback(() => {
    setWorkspaceRefresh((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setProjects([]);
    setAgentProfiles([]);
    setProfilesSupported(null);
    setError(null);
    setLoadedHostId(null);

    void paseo.projects
      .list()
      .then((result) => {
        if (active) {
          setProjects(result.projects);
          setLoadedHostId(hostId ?? null);
        }
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    void refreshAgentProfiles();

    return () => {
      active = false;
    };
  }, [hostId, paseo, refreshAgentProfiles]);

  useEffect(() => {
    let active = true;
    setWorkspaces([]);

    if (!projectId && !allProjects) {
      return () => {
        active = false;
      };
    }

    void (async () => {
      const entries: WorkspaceSummary[] = [];
      let cursor: string | undefined;
      do {
        const result = await paseo.workspaces.list({
          ...(projectId && !allProjects ? { filter: { projectId } } : {}),
          page: { limit: 200, ...(cursor ? { cursor } : {}) },
        });
        entries.push(...result.entries);
        cursor = result.pageInfo.hasMore ? result.pageInfo.nextCursor ?? undefined : undefined;
      } while (cursor);
      if (active) setWorkspaces(entries);
    })().catch((cause) => {
      if (active) setError(errorMessage(cause));
    });

    return () => {
      active = false;
    };
  }, [paseo, projectId, allProjects, workspaceRefresh]);

  const workspaceIds = useMemo(() => new Set(workspaces.map((workspace) => workspace.id)), [workspaces]);
  const workspaceKey = useMemo(() => [...workspaceIds].sort().join("\u0000"), [workspaceIds]);

  useEffect(() => {
    let active = true;
    let release: (() => void) | undefined;
    setAgents([]);

    if (!projectId && !allProjects) {
      return () => {
        active = false;
      };
    }

    const belongsHere = (agent: AgentSummary) =>
      allProjects || isAgentForBoard(agent, boardId) || isAgentForProject(agent, workspaceIds);
    const unsubscribe = paseo.agents.subscribe((update) => {
      if (!active) return;

      if (update.kind === "remove") {
        setAgents((current) => current.filter((agent) => agent.id !== update.agentId));
      } else if (belongsHere(update.agent)) {
        setAgents((current) => upsertAgent(current, update.agent));
      } else {
        setAgents((current) => current.filter((agent) => agent.id !== update.agent.id));
      }
    });

    void (async () => {
      const entries: AgentSummary[] = [];
      let cursor: string | undefined;
      let firstSubscription: { release(): Promise<void> } | undefined;
      do {
        const result = await paseo.agents.list({
          filter: { includeArchived: true },
          page: { limit: 200, ...(cursor ? { cursor } : {}) },
          ...(!cursor ? { subscribe: {} } : {}),
        });
        entries.push(...result.entries.map((entry) => entry.agent).filter(belongsHere));
        firstSubscription ??= result.subscription;
        cursor = result.pageInfo.hasMore ? result.pageInfo.nextCursor ?? undefined : undefined;
      } while (cursor);

      if (!active) {
        await firstSubscription?.release();
        return;
      }
      setAgents(entries);
      release = firstSubscription ? () => void firstSubscription.release() : undefined;
    })().catch((cause) => {
      if (active) setError(errorMessage(cause));
    });

    return () => {
      active = false;
      unsubscribe();
      void release?.();
    };
  }, [paseo, projectId, boardId, allProjects, workspaceKey]);

  return {
    projects,
    workspaces,
    agentProfiles,
    profilesSupported,
    agents,
    loadedHostId,
    error,
    refreshAgentProfiles,
    refreshWorkspaces,
  };
}
