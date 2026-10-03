export type RunStatusTone = "accent" | "danger" | "muted" | "success" | "warning";

export interface AgentRunState {
  archivedAt?: string | null;
  attentionReason?: "finished" | "error" | "permission" | null;
  status: "initializing" | "idle" | "running" | "error" | "closed";
}

export interface RunStatusPresentation {
  label: string;
  tone: RunStatusTone;
}

export function runStatus(agent: AgentRunState | null | undefined): RunStatusPresentation {
  if (!agent) return { label: "Agent missing", tone: "warning" };
  if (agent.archivedAt) return { label: "Archived", tone: "muted" };
  if (agent.attentionReason === "permission") {
    return { label: "Permission required", tone: "warning" };
  }
  if (agent.attentionReason === "error" || agent.status === "error") {
    return { label: "Error", tone: "danger" };
  }
  if (agent.attentionReason === "finished") {
    return { label: "Review suggested", tone: "success" };
  }
  if (agent.status === "running" || agent.status === "initializing") {
    return { label: "Running", tone: "accent" };
  }
  if (agent.status === "closed") return { label: "Closed", tone: "muted" };
  return { label: "Idle", tone: "muted" };
}

export function canContinueAgent(agent: AgentRunState | null | undefined): boolean {
  if (!agent || agent.archivedAt) return false;
  if (agent.status !== "idle") return false;
  return agent.attentionReason !== "permission" && agent.attentionReason !== "error";
}

export function isActiveAgent(agent: AgentRunState | null | undefined): boolean {
  if (!agent || agent.archivedAt) return false;
  if (agent.attentionReason === "finished" || agent.attentionReason === "error") return false;
  return agent.status !== "error" && agent.status !== "closed";
}
