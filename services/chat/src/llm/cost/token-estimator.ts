export interface ModelPricing {
  input: number;
  output: number;
  cachedInput?: number;
}

/**
 * USD per 1M tokens, standard tier, from https://developers.openai.com/api/docs/pricing
 * (checked 2026-10-14) and https://api-docs.deepseek.com/quick_start/pricing (checked
 * 2026-10-18). Reference only: prices, context windows and vendor discounts change, so check
 * the vendor's site before going live. Not modelled: gpt-5.4 charges more once a request
 * exceeds 272K input tokens, batch/flex tiers are cheaper, and DeepSeek charges half outside
 * its peak hours (the figures below are peak, so estimates are an upper bound).
 */
export const PRICING: Record<string, ModelPricing> = {
  'gpt-5.4': { input: 2.5, cachedInput: 0.25, output: 15 },
  'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, cachedInput: 0.02, output: 1.25 },
  'gpt-5.5': { input: 5, cachedInput: 0.5, output: 30 },
  'deepseek-flash': { input: 0.3, cachedInput: 0.006, output: 1.2 },
  'deepseek-v4-pro': { input: 1.32, cachedInput: 0.044, output: 3.96 },
};

const DEFAULT_MODEL = 'gpt-5.4';

// CJK ideographs, CJK punctuation and full-width forms.
const CHINESE = /[一-鿿　-〿＀-￯]/g;

/**
 * Rough token count without a tokenizer: each Chinese character is one token, anything else is
 * a quarter token. Good enough for cost estimates, not for fitting a context window.
 */
export function estimateTextTokens(text: string | null | undefined): number {
  if (!text) return 0;
  const chinese = text.match(CHINESE)?.length ?? 0;
  const other = text.length - chinese;
  return Math.ceil(chinese + other * 0.25);
}

/**
 * Looks up a model by its longest matching prefix, so dated snapshots such as
 * `gpt-5.4-mini-2026-03-17` resolve to `gpt-5.4-mini`. Unknown models get gpt-5.4 pricing.
 */
export function getModelPricing(modelName: string): ModelPricing {
  const key = Object.keys(PRICING)
    .filter((name) => modelName.startsWith(name))
    .sort((a, b) => b.length - a.length)[0];
  return PRICING[key ?? DEFAULT_MODEL];
}
