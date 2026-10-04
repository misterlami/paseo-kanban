import { z } from "zod";

export const AgentProfileSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    icon: z.string().optional(),
    color: z.string().optional(),
    provider: z.string().min(1),
    model: z.string().min(1).optional(),
    modeId: z.string().min(1).optional(),
    thinkingOptionId: z.string().min(1).optional(),
    featureValues: z.record(z.string(), z.unknown()).optional(),
    notes: z.string().optional(),
  })
  .passthrough();

export const AgentProfilesSchema = z.array(AgentProfileSchema);

export type AgentProfile = z.infer<typeof AgentProfileSchema>;

export interface MaterializedAgentProfile {
  provider: `${string}/${string}`;
  modeId?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
}

export function materializeAgentProfile(profile: AgentProfile): MaterializedAgentProfile {
  const provider = profile.provider.trim();
  const model = profile.model?.trim();
  const modeId = profile.modeId?.trim();
  const thinkingOptionId = profile.thinkingOptionId?.trim();
  const featureValues = profile.featureValues;

  const providerAndModel = provider.includes("/")
    ? provider
    : model
      ? `${provider}/${model}`
      : null;
  const separatorIndex = providerAndModel?.indexOf("/") ?? -1;
  if (
    !providerAndModel ||
    separatorIndex <= 0 ||
    separatorIndex === providerAndModel.length - 1
  ) {
    throw new Error(`Agent profile "${profile.name}" must specify a provider and model.`);
  }

  return {
    provider: providerAndModel as `${string}/${string}`,
    ...(modeId ? { modeId } : {}),
    ...(thinkingOptionId ? { thinkingOptionId } : {}),
    ...(featureValues && Object.keys(featureValues).length > 0 ? { featureValues } : {}),
  };
}
