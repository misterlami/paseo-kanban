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
  provider: string;
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
}

export function materializeAgentProfile(profile: AgentProfile): MaterializedAgentProfile {
  const model = profile.model?.trim();
  const modeId = profile.modeId?.trim();
  const thinkingOptionId = profile.thinkingOptionId?.trim();
  const featureValues = profile.featureValues;

  return {
    provider: profile.provider.trim(),
    ...(model ? { model } : {}),
    ...(modeId ? { modeId } : {}),
    ...(thinkingOptionId ? { thinkingOptionId } : {}),
    ...(featureValues && Object.keys(featureValues).length > 0 ? { featureValues } : {}),
  };
}
