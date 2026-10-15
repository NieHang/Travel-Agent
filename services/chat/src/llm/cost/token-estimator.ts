export interface ModelPricing {
  input: number;
  output: number;
  cachedInput?: number;
}

/**
 * USD per 1M tokens, standard tier, from https://developers.openai.com/api/docs/pricing
 * (checked 2026-10-14). Reference only: prices, context windows and vendor discounts change,
 * so check the vendor's site before going live. Not modelled: gpt-5.4 charges more once a
 * request exceeds 272K input tokens, and batch/flex tiers are cheaper.
 */
export const PRICING: Record<string, ModelPricing> = {
  'gpt-5.4': { input: 2.5, cachedInput: 0.25, output: 15 },
  'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, cachedInput: 0.02, output: 1.25 },
  'gpt-5.5': { input: 5, cachedInput: 0.5, output: 30 },
  // From https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-10-15). Not modelled:
  // Haiku 5.5 charges $0.50 / $2.50 once a prompt exceeds 100K tokens.
  'claude-haiku-5-5': { input: 0.1, cachedInput: 0.01, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, cachedInput: 0.1, output: 10 },
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
