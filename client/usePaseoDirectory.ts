import { usePaseo } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { AGENT_LABELS } from "../shared/model";
import { errorMessage } from "./errors";

export interface ModelChoice {
  id: string;
  label: string;
}

export interface ProjectSummary {
  projectId: string;
  projectDisplayName: string;
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
  workspaceId?: string;
  status: "initializing" | "idle" | "running" | "error" | "closed";
  labels: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  attentionReason?: "finished" | "error" | "permission" | null;
}

function isAgentForBoard(agent: AgentSummary, boardId: string): boolean {
  return agent.labels[AGENT_LABELS.boardId] === boardId;
}

function upsertAgent(current: AgentSummary[], next: AgentSummary): AgentSummary[] {
  const index = current.findIndex((agent) => agent.id === next.id);
  if (index < 0) return [...current, next];

  const copy = [...current];
  copy[index] = next;
  return copy;
}

export function usePaseoDirectory(projectId: string | null, boardId: string | null) {
  const paseo = usePaseo();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [error, setError] = useState(null as string | null);

  useEffect(() => {
    let active = true;

    void Promise.all([paseo.projects.list(), paseo.providers.waitForReady()])
      .then(([projectResult, providerResult]) => {
        if (!active) return;

        setProjects(projectResult.projects);
        setModels(
          providerResult.entries
            .filter((entry) => entry.enabled !== false && entry.status === "ready")
            .flatMap((entry) =>
              (entry.models ?? [])
                .filter((model) => model.isSelectable !== false)
                .map((model) => ({
                  id: `${entry.provider}/${model.id}`,
                  label: `${entry.label ?? entry.provider} · ${model.label}`,
                  default: model.isDefault === true,
                })),
            )
            .sort(
              (left, right) =>
                Number(right.default) - Number(left.default) || left.label.localeCompare(right.label),
            )
            .map(({ id, label }) => ({ id, label })),
        );
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });

    return () => {
      active = false;
    };
  }, [paseo]);

  useEffect(() => {
    let active = true;

    if (!projectId) {
      setWorkspaces([]);
      return () => {
        active = false;
      };
    }

    void paseo.workspaces
      .list({ filter: { projectId }, page: { limit: 200 } })
      .then((result) => {
        if (active) setWorkspaces(result.entries);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });

    return () => {
      active = false;
    };
  }, [paseo, projectId]);

  useEffect(() => {
    let active = true;
    let release: (() => void) | undefined;

    if (!boardId) {
      setAgents([]);
      return () => {
        active = false;
      };
    }

    const unsubscribe = paseo.agents.subscribe((update) => {
      if (!active) return;

      if (update.kind === "remove") {
        setAgents((current) => current.filter((agent) => agent.id !== update.agentId));
      } else if (isAgentForBoard(update.agent, boardId)) {
        setAgents((current) => upsertAgent(current, update.agent));
      }
    });

    void paseo.agents
      .list({
        filter: { labels: { [AGENT_LABELS.boardId]: boardId }, includeArchived: true },
        page: { limit: 200 },
        subscribe: {},
      })
      .then((result) => {
        if (!active) {
          void result.subscription?.release();
          return;
        }

        setAgents(result.entries.map((entry) => entry.agent));
        release = result.subscription ? () => void result.subscription!.release() : undefined;
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });

    return () => {
      active = false;
      unsubscribe();
      void release?.();
    };
  }, [paseo, boardId]);

  return { projects, workspaces, models, agents, error };
}
