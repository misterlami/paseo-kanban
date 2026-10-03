declare module "@getpaseo/protocol/agent-types" {
  export type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | { [key: string]: JsonValue };

  export type AgentTimelineItem =
    | { type: "user_message"; text: string }
    | { type: "assistant_message"; text: string }
    | { type: "reasoning"; text: string }
    | { type: "tool_call"; [key: string]: unknown }
    | { type: "todo"; [key: string]: unknown }
    | { type: "error"; message: string }
    | { type: "notification"; [key: string]: unknown }
    | { type: "compaction"; [key: string]: unknown }
    | { type: "plugin"; [key: string]: unknown };
}

declare module "@getpaseo/client" {
  export interface PaseoProject {
    projectId: string;
    projectDisplayName: string;
    projectRootPath: string;
    projectKind: "git" | "non_git" | "directory";
  }

  export interface PaseoWorkspace {
    id: string;
    projectId: string;
    projectDisplayName: string;
    projectRootPath: string;
    workspaceDirectory?: string;
    name: string;
    title?: string | null;
    status: "needs_input" | "failed" | "running" | "attention" | "done";
  }

  export interface PaseoAgent {
    id: string;
    provider: string;
    workspaceId?: string;
    status: "initializing" | "idle" | "running" | "error" | "closed";
    title: string | null;
    model: string | null;
    labels: Record<string, string>;
    createdAt: string;
    updatedAt: string;
    archivedAt?: string | null;
    requiresAttention?: boolean;
    attentionReason?: "finished" | "error" | "permission" | null;
  }

  export interface PaseoAgentHandle {
    id: string;
    current(): PaseoAgent | null;
    send(text: string, options?: { messageId?: string }): Promise<void>;
  }

  export interface AgentProfile {
    id: string;
    name: string;
    icon?: string;
    color?: string;
    provider: string;
    model?: string;
    modeId?: string;
    thinkingOptionId?: string;
    featureValues?: Record<string, unknown>;
    notes?: string;
  }

  export interface AgentCreateOptions {
    config: {
      provider: string;
      model?: string;
      modeId?: string;
      thinkingOptionId?: string;
      featureValues?: Record<string, unknown>;
    };
    title?: string;
    labels?: Record<string, string>;
    prompt?: string;
  }

  export interface PaseoWorkspaceHandle {
    id: string;
    current(): PaseoWorkspace | null;
    agents: {
      create(options: AgentCreateOptions): Promise<PaseoAgentHandle>;
    };
  }

  export interface ProviderModel {
    provider: string;
    id: string;
    label: string;
    isSelectable?: boolean;
    isDefault?: boolean;
  }

  export interface ProviderSnapshotEntry {
    provider: string;
    status: "ready" | "loading" | "error" | "unavailable";
    enabled?: boolean;
    label?: string;
    models?: ProviderModel[];
  }

  export interface PaseoApi {
    config: {
      get(): Promise<{ config: { agentProfiles?: AgentProfile[] } }>;
    };
    projects: {
      list(): Promise<{ projects: PaseoProject[] }>;
    };
    workspaces: {
      create(options: {
        idempotencyKey?: string;
        title?: string;
        source: {
          kind: "worktree";
          projectId?: string;
          cwd?: string;
          action?: "branch-off" | "checkout";
          refName?: string;
          branchName?: string;
          worktreeSlug?: string;
        };
      }): Promise<PaseoWorkspaceHandle>;
      list(options?: {
        filter?: { projectId?: string };
        page?: { limit: number; cursor?: string };
      }): Promise<{
        entries: PaseoWorkspace[];
        pageInfo: { nextCursor: string | null; hasMore: boolean };
      }>;
      ref(workspaceId: string): {
        agents: {
          create(options: AgentCreateOptions): Promise<PaseoAgentHandle>;
        };
      };
    };
    agents: {
      list(options?: {
        filter?: {
          labels?: Record<string, string>;
          includeArchived?: boolean;
        };
        page?: { limit: number; cursor?: string };
        subscribe?: Record<string, never>;
      }): Promise<{
        entries: Array<{ agent: PaseoAgent; project: unknown }>;
        pageInfo: { nextCursor: string | null; hasMore: boolean };
        subscription?: {
          subscribe(observer: {
            snapshot(snapshot: {
              entries: Array<{ agent: PaseoAgent; project: unknown }>;
            }): void;
            update(message: unknown): void;
            error?(error: unknown): void;
          }): () => void;
          release(): Promise<void>;
        };
      }>;
      subscribe(
        handler: (
          update:
            | { kind: "upsert"; agent: PaseoAgent }
            | { kind: "remove"; agentId: string },
        ) => void,
      ): () => void;
      ref(agent: string | PaseoAgent): PaseoAgentHandle;
    };
    providers: {
      waitForReady(): Promise<{ entries: ProviderSnapshotEntry[] }>;
    };
    dispose(): Promise<void>;
  }
}
