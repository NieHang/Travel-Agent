import {
  getElapsedMs,
  getTraceId,
  newTraceId,
  runWithTrace,
} from './trace-context.js';

describe('trace context', () => {
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
