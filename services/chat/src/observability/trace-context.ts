import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface TraceContext {
  traceId: string;
  startedAt: number;
}

const storage = new AsyncLocalStorage<TraceContext>();

export function newTraceId(): string {
  return randomUUID();
}

export function runWithTrace<T>(traceId: string, fn: () => T): T {
  return storage.run({ traceId, startedAt: performance.now() }, fn);
}

export function getTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}

export function getElapsedMs(): number | undefined {
  const context = storage.getStore();
  return context && Math.round(performance.now() - context.startedAt);
}
