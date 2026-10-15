import { estimateTextTokens, getModelPricing, PRICING } from './token-estimator.js';

describe('estimateTextTokens', () => {
  it('returns 0 for empty, null and undefined text', () => {
    expect(estimateTextTokens('')).toBe(0);
    expect(estimateTextTokens(null)).toBe(0);
    expect(estimateTextTokens(undefined)).toBe(0);
  });
  it('counts each Chinese character and Chinese punctuation mark as one token', () => {
    expect(estimateTextTokens('你好，世界。')).toBe(6);
  });
  it('counts other characters at four per token, rounded up', () => {
    expect(estimateTextTokens('abcdefgh')).toBe(2);
    expect(estimateTextTokens('hello world')).toBe(3);
  });
  it('adds both rates for mixed text before rounding', () => {
    expect(estimateTextTokens('去Tokyo')).toBe(3);
  });
});

describe('getModelPricing', () => {
  it('returns the per-1M-token USD price of a known model', () => {
    expect(getModelPricing('gpt-5.4')).toEqual({ input: 2.5, cachedInput: 0.25, output: 15 });
    expect(getModelPricing('claude-haiku-5-5')).toEqual({ input: 0.1, cachedInput: 0.01, output: 0.5 });
  });
  it('resolves dated snapshots to the longest matching model', () => {
    expect(getModelPricing('gpt-5.4-2026-03-05')).toEqual(PRICING['gpt-5.4']);
    expect(getModelPricing('gpt-5.4-mini-2026-03-17')).toEqual(PRICING['gpt-5.4-mini']);
  });
  it('falls back to gpt-5.4 pricing for unknown models', () => {
    expect(getModelPricing('some-other-model')).toEqual(PRICING['gpt-5.4']);
  });
});
