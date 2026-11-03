import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface TraceContext {
  traceId: string;
  startedAt: number;
  llm: LlmTotals;
}

export interface LlmTotals {
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
  estimated: boolean;
  beginCall(): void;
  endCall(): void;
  whenIdle(): Promise<void>;
  add(rec: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    costUsd: number;
    usageSource: 'provider' | 'estimate';
  }): void;
}

export function createLlmTotals(): LlmTotals {
  const inFlight = { count: 0, waiters: [] as (() => void)[] };
  return {
    calls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    estimated: false,
    beginCall() {
      inFlight.count++;
    },
    endCall() {
      inFlight.count--;
      if (inFlight.count > 0) return;
      for (const resolve of inFlight.waiters.splice(0)) resolve();
    },
    whenIdle() {
      return inFlight.count === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => inFlight.waiters.push(resolve));
    },
    add(rec) {
      this.calls++;
      this.inputTokens += rec.inputTokens;
      this.cachedInputTokens += rec.cachedInputTokens;
      this.outputTokens += rec.outputTokens;
      this.costUsd += rec.costUsd;
      this.estimated ||= rec.usageSource === 'estimate';
    },
  };
}

export function getLlmTotals(): LlmTotals | undefined {
  return storage.getStore()?.llm;
}

const storage = new AsyncLocalStorage<TraceContext>();

export function newTraceId(): string {
  return randomUUID();
}

export function runWithTrace<T>(
  traceId: string,
  fn: () => T,
  llm = createLlmTotals(),
): T {
  return storage.run({ traceId, startedAt: performance.now(), llm }, fn);
}

export function getTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}

export function getElapsedMs(): number | undefined {
  const context = storage.getStore();
  return context && Math.round(performance.now() - context.startedAt);
}
