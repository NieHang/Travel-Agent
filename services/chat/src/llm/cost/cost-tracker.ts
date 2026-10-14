import { estimateTextTokens, getModelPricing } from './token-estimator.js';

export interface CostEstimateInput {
  model: string;
  /** Prompt texts sent to the model: system prompt, history and the new user message. */
  messages: string[];
  /** Tool definitions sent with the request; the model is billed for them as input. */
  toolSchemas?: unknown[];
  output?: string;
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  /** USD. */
  cost: number;
}

/** Estimates one model call. Treats all input as uncached, so it errs on the high side. */
export function estimateCost({ model, messages, toolSchemas = [], output }: CostEstimateInput): CostEstimate {
  const pricing = getModelPricing(model);
  const inputTokens =
    messages.reduce((sum, message) => sum + estimateTextTokens(message), 0) +
    (toolSchemas.length ? estimateTextTokens(JSON.stringify(toolSchemas)) : 0);
  const outputTokens = estimateTextTokens(output);
  const cost = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  return { inputTokens, outputTokens, cost };
}
