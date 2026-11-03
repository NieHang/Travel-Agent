import { Counter, Histogram, Registry } from 'prom-client';

export const registry = new Registry();

export const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
  registers: [registry],
});

export const llmCallDuration = new Histogram({
  name: 'llm_call_duration_seconds',
  help: 'LLM call duration in seconds',
  labelNames: ['model', 'operation', 'status'] as const,
  buckets: [0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120],
  registers: [registry],
});

export const llmTokens = new Counter({
  name: 'llm_tokens_total',
  help: 'LLM tokens, by kind',
  labelNames: ['model', 'operation', 'kind', 'source'] as const,
  registers: [registry],
});

export const llmCost = new Counter({
  name: 'llm_cost_usd_total',
  help: 'Estimated LLM spend in USD (list prices from token-estimator.ts)',
  labelNames: ['model', 'operation', 'source'] as const,
  registers: [registry],
});
