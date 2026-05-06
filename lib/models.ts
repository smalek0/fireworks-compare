export type ModelTier = "fast" | "balanced" | "reasoning";

export type Model = {
  id: string;
  label: string;
  inputCostPer1M: number;
  outputCostPer1M: number;
  tier: ModelTier;
};

export const MODELS: Model[] = [
  {
    id: "accounts/fireworks/models/minimax-m2p7",
    label: "MiniMax M2.7",
    inputCostPer1M: 0.3,
    outputCostPer1M: 1.2,
    tier: "fast",
  },
  {
    id: "accounts/fireworks/models/kimi-k2p5",
    label: "Kimi K2.5",
    inputCostPer1M: 0.6,
    outputCostPer1M: 3.0,
    tier: "balanced",
  },
  {
    id: "accounts/fireworks/models/kimi-k2p6",
    label: "Kimi K2.6",
    inputCostPer1M: 0.95,
    outputCostPer1M: 4.0,
    tier: "balanced",
  },
  {
    id: "accounts/fireworks/models/glm-5",
    label: "GLM 5",
    inputCostPer1M: 1.0,
    outputCostPer1M: 3.2,
    tier: "balanced",
  },
  {
    id: "accounts/fireworks/models/glm-5p1",
    label: "GLM 5.1",
    inputCostPer1M: 1.4,
    outputCostPer1M: 4.4,
    tier: "balanced",
  },
  {
    id: "accounts/fireworks/models/deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    inputCostPer1M: 1.74,
    outputCostPer1M: 3.48,
    tier: "reasoning",
  },
];

export function findModel(id: string): Model | undefined {
  return MODELS.find((m) => m.id === id);
}

export function callCost(
  inputTokens: number,
  outputTokens: number,
  model: Model
): number {
  return (
    (inputTokens * model.inputCostPer1M + outputTokens * model.outputCostPer1M) /
    1_000_000
  );
}
