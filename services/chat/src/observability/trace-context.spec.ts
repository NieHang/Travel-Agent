import {
  createLlmTotals,
  getLlmTotals,
  getElapsedMs,
  getTraceId,
  newTraceId,
  runWithTrace,
} from './trace-context.js';

describe('trace context', () => {
  it('waits for every in-flight call before finalizing a request summary', async () => {
    const totals = createLlmTotals();
    totals.beginCall();
    totals.beginCall();
    const settled = vi.fn();
    const waiting = totals.whenIdle().then(settled);
    totals.endCall();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    totals.endCall();
    await waiting;
    expect(settled).toHaveBeenCalledTimes(1);
    await totals.whenIdle();
  });
  it('creates an empty request summary by default', () => {
    expect(getLlmTotals()).toBeUndefined();
    runWithTrace('default', () => {
      expect(getLlmTotals()).toMatchObject({
        calls: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        estimated: false,
      });
    });
  });

  it('accumulates usage and keeps summaries isolated across nested contexts', () => {
    const totals = createLlmTotals();
    runWithTrace(
      'outer',
      () => {
        getLlmTotals()?.add({
          inputTokens: 100,
          cachedInputTokens: 40,
          outputTokens: 20,
          costUsd: 0.01,
          usageSource: 'provider',
        });
        runWithTrace('inner', () => expect(getLlmTotals()?.calls).toBe(0));
        getLlmTotals()?.add({
          inputTokens: 200,
          cachedInputTokens: 0,
          outputTokens: 30,
          costUsd: 0.02,
          usageSource: 'estimate',
        });
      },
      totals,
    );
    expect(totals).toMatchObject({
      calls: 2,
      inputTokens: 300,
      cachedInputTokens: 40,
      outputTokens: 50,
      costUsd: 0.03,
      estimated: true,
    });
    totals.add({
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      usageSource: 'provider',
    });
    expect(totals.estimated).toBe(true);
  });
  it('has no trace or elapsed time outside a context', () => {
    expect(getTraceId()).toBeUndefined();
    expect(getElapsedMs()).toBeUndefined();
  });

  it('preserves async context and restores the outer context after nesting', async () => {
    await runWithTrace('outer', async () => {
      expect(getTraceId()).toBe('outer');
      await Promise.resolve();
      expect(getTraceId()).toBe('outer');
      expect(getElapsedMs()).toEqual(expect.any(Number));
      expect(getElapsedMs()).toBeGreaterThanOrEqual(0);
      await runWithTrace('inner', async () => {
        await Promise.resolve();
        expect(getTraceId()).toBe('inner');
      });
      expect(getTraceId()).toBe('outer');
    });
    expect(getTraceId()).toBeUndefined();
  });

  it('isolates concurrent requests', async () => {
    const values = await Promise.all([
      runWithTrace('first', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return getTraceId();
      }),
      runWithTrace('second', async () => {
        await Promise.resolve();
        return getTraceId();
      }),
    ]);
    expect(values).toEqual(['first', 'second']);
  });

  it('creates distinct UUIDs', () => {
    const first = newTraceId();
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(newTraceId()).not.toBe(first);
  });
});
