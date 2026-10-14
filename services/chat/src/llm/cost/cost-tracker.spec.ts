import { estimateCost } from './cost-tracker.js';
import { getModelPricing } from './token-estimator.js';

const SEARCH_HOTELS = {
  name: 'search_hotels',
  description: 'Search hotels by city and dates',
  parameters: { type: 'object', properties: { city: { type: 'string' }, checkIn: { type: 'string' } } },
};

describe('estimateCost', () => {
  it('returns zero for an empty call', () => {
    expect(estimateCost({ model: 'gpt-5.4', messages: [] })).toEqual({ inputTokens: 0, outputTokens: 0, cost: 0 });
  });
  it('counts tool schemas as input, so a call with tools costs more', () => {
    const messages = ['帮我找东京的酒店'];
    const without = estimateCost({ model: 'gpt-5.4', messages });
    const withTools = estimateCost({ model: 'gpt-5.4', messages, toolSchemas: [SEARCH_HOTELS] });
    expect(withTools.inputTokens).toBeGreaterThan(without.inputTokens);
    expect(withTools.cost).toBeGreaterThan(without.cost);
  });
  it('charges input tokens at pricing.input', () => {
    const { input } = getModelPricing('gpt-5.4');
    const estimate = estimateCost({ model: 'gpt-5.4', messages: ['a'.repeat(4000)] });
    expect(estimate.inputTokens).toBe(1000);
    expect(estimate.cost).toBeCloseTo((1000 * input) / 1_000_000, 10);
  });
  it('charges output tokens at pricing.output', () => {
    const { output } = getModelPricing('gpt-5.4');
    const estimate = estimateCost({ model: 'gpt-5.4', messages: [], output: 'a'.repeat(4000) });
    expect(estimate.outputTokens).toBe(1000);
    expect(estimate.cost).toBeCloseTo((1000 * output) / 1_000_000, 10);
  });
});
