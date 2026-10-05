export type RunStatusTone = "accent" | "danger" | "muted" | "success" | "warning";

export interface AgentRunState {
  archivedAt?: string | null;
  attentionReason?: "finished" | "error" | "permission" | null;
  status: "initializing" | "idle" | "running" | "error" | "closed";
}

export interface RunStatusPresentation {
  label: string;
  motion?: "pulse";
  tone: RunStatusTone;
}

export function runStatus(agent: AgentRunState | null | undefined): RunStatusPresentation {
  if (!agent) return { label: "Unknown", tone: "warning" };
  if (agent.archivedAt) return { label: "Archived", tone: "muted" };
  if (agent.attentionReason === "permission") {
    return { label: "Needs input", motion: "pulse", tone: "warning" };
  }
  if (agent.attentionReason === "error" || agent.status === "error") {
    return { label: "Failed", tone: "danger" };
  }
  if (agent.attentionReason === "finished") {
    return { label: "Needs review", tone: "success" };
  }
  if (agent.status === "initializing") {
    return { label: "Initializing", motion: "pulse", tone: "accent" };
  }
  if (agent.status === "running") return { label: "Running", motion: "pulse", tone: "accent" };
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
