import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  materializeAgentProfile,
  type AgentProfile,
  type MaterializedAgentProfile,
} from "../shared/agentProfiles";

export interface ResolvedAgentExecution {
  config: MaterializedAgentProfile;
  profileId: string | null;
  profileName: string | null;
}

export async function resolveAgentExecution(
  paseo: PluginClientContext["paseo"],
  profiles: readonly AgentProfile[],
  preferredProfileId: string | null,
): Promise<ResolvedAgentExecution> {
  const profile =
    profiles.find((candidate) => candidate.id === preferredProfileId) ?? profiles[0];
  if (profile) {
    return {
      config: materializeAgentProfile(profile),
      profileId: profile.id,
      profileName: profile.name,
    };
  }

  const snapshot = await paseo.providers.waitForReady();
  const provider = snapshot.entries.find(
    (entry) =>
      entry.status === "ready" &&
      entry.enabled !== false &&
      entry.models?.some((model) => model.isSelectable !== false),
  );
  const model =
    provider?.models?.find((candidate) => candidate.isDefault && candidate.isSelectable !== false) ??
    provider?.models?.find((candidate) => candidate.isSelectable !== false);
  if (!provider || !model) {
    throw new Error("No configured agent profile or available provider model was found");
  }
  return {
    config: { provider: `${provider.provider}/${model.id}` },
    profileId: null,
    profileName: provider.label ?? provider.provider,
  };
}
