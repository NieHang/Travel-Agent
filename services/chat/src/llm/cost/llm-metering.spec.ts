import { Writable } from 'node:stream';
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
} from '@langchain/core/messages';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import type { ChatGeneration, LLMResult } from '@langchain/core/outputs';
import { createLogger } from '../../observability/logger.js';
import { registry } from '../../observability/metrics.js';
import {
  createLlmTotals,
  runWithTrace,
} from '../../observability/trace-context.js';
import { LlmMeteringHandler } from './llm-metering.js';

const lines = vi.hoisted(() => [] as string[]);
vi.mock('../../observability/logger.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../observability/logger.js')>();
  const { default: pino } = await import('pino');
  return {
    ...actual,
    createLogger: vi.fn((module: string) =>
      pino(
        { ...actual.loggerOptions, level: 'info' },
        new Writable({
          write(chunk: Buffer, _encoding, callback) {
            lines.push(chunk.toString());
            callback();
          },
        }),
      ).child({ module }),
    ),
  };
});

const result = (message: AIMessage | AIMessageChunk): LLMResult => {
  const generation: ChatGeneration = { text: message.text, message };
  return { generations: [[generation]] };
};
const usage = {
  input_tokens: 1000,
  output_tokens: 200,
  total_tokens: 1200,
  input_token_details: { cache_read: 400 },
};
const serialized = {
  lc: 1 as const,
  type: 'not_implemented' as const,
  id: ['test'],
};
const start = (handler: LlmMeteringHandler, runId = 'run') =>
  handler.handleChatModelStart(
    serialized,
    [[new HumanMessage('a'.repeat(4000))]],
    runId,
    undefined,
    { invocation_params: { model: 'gpt-5.4' } },
  );
const records = (): Record<string, unknown>[] =>
  lines.map((line) => JSON.parse(line) as Record<string, unknown>);

beforeEach(() => {
  lines.length = 0;
  registry.resetMetrics();
});
afterEach(() => vi.restoreAllMocks());

describe('LlmMeteringHandler', () => {
  it.each([
    { name: 'message', Message: AIMessage },
    { name: 'chunk', Message: AIMessageChunk },
  ])(
    'records provider usage from $name and splits cache metrics',
    async ({ Message }) => {
      const handler = new LlmMeteringHandler({ operation: 'trip.classify' });
      start(handler);
      handler.handleLLMEnd(
        result(
          new Message({ content: 'private reply', usage_metadata: usage }),
        ),
        'run',
      );
      expect(records()[0]).toMatchObject({
        module: 'llm',
        msg: 'llm call',
        model: 'gpt-5.4',
        operation: 'trip.classify',
        status: 'ok',
        inputTokens: 1000,
        cachedInputTokens: 400,
        outputTokens: 200,
        usageSource: 'provider',
        costUsd: 0.0046,
      });
      expect(records()[0].durationMs).toEqual(expect.any(Number));
      expect(lines.join('')).not.toContain('private reply');
      expect(lines.join('')).not.toContain('aaaa');
      const tokens = await registry.getSingleMetricAsString('llm_tokens_total');
      expect(tokens).toContain('source="provider",kind="input"} 600');
      expect(tokens).toContain('source="provider",kind="cached_input"} 400');
      expect(tokens).toContain('source="provider",kind="output"} 200');
      expect(
        await registry.getSingleMetricAsString('llm_cost_usd_total'),
      ).toContain('operation="trip.classify",source="provider"} 0.0046');
      expect(
        await registry.getSingleMetricAsString('llm_call_duration_seconds'),
      ).toContain('operation="trip.classify",status="ok"} 1');
    },
  );

  it.each([undefined, { input_tokens: 0, output_tokens: 0, total_tokens: 0 }])(
    'estimates when usage is absent or zero (%s)',
    (usage_metadata) => {
      const handler = new LlmMeteringHandler();
      start(handler);
      handler.handleLLMEnd(
        result(new AIMessage({ content: 'b'.repeat(4000), usage_metadata })),
        'run',
      );
      expect(records()[0]).toMatchObject({
        operation: 'other',
        inputTokens: 1000,
        outputTokens: 1000,
        cachedInputTokens: 0,
        costUsd: 0.0175,
        usageSource: 'estimate',
      });
    },
  );

  it('estimates input tool schemas and structured output tool calls', () => {
    const handler = new LlmMeteringHandler();
    handler.handleChatModelStart(
      serialized,
      [[new HumanMessage('aaaa')]],
      'run',
      undefined,
      { invocation_params: { model: 'gpt-5.4', tools: [{ name: 'x' }] } },
    );
    handler.handleLLMEnd(
      result(
        new AIMessage({
          content: '',
          tool_calls: [
            {
              name: 'classify',
              args: { intent: 'chat' },
              id: 'c1',
              type: 'tool_call',
            },
          ],
        }),
      ),
      'run',
    );
    expect(records()[0]).toMatchObject({
      inputTokens: 5,
      cachedInputTokens: 0,
      usageSource: 'estimate',
    });
    expect(records()[0].outputTokens).toBeGreaterThan(0);
  });

  it.each([
    new DOMException('stopped', 'AbortError'),
    Object.assign(new Error('stopped'), { name: 'AbortError' }),
    new Error('failed'),
  ])('records errors and estimates input only (%s)', (err) => {
    const handler = new LlmMeteringHandler();
    start(handler);
    handler.handleLLMError(err, 'run');
    expect(records()[0]).toMatchObject({
      level: 40,
      status: err.name === 'AbortError' ? 'aborted' : 'error',
      inputTokens: 1000,
      outputTokens: 0,
      usageSource: 'estimate',
      err: { name: err.name, message: err.message },
    });
  });

  it('recognizes the installed LangChain streaming abort sentinel', () => {
    const handler = new LlmMeteringHandler();
    start(handler);
    handler.handleLLMError(new Error('AbortError'), 'run');
    expect(records()[0]).toMatchObject({
      status: 'aborted',
      inputTokens: 1000,
      outputTokens: 0,
      usageSource: 'estimate',
    });
  });

  it('ignores unknown or already completed run ids', () => {
    const handler = new LlmMeteringHandler();
    handler.handleLLMEnd(result(new AIMessage('hello')), 'missing');
    handler.handleLLMError(new Error('failed'), 'missing');
    expect(lines).toHaveLength(0);
    start(handler);
    handler.handleLLMEnd(result(new AIMessage('hello')), 'run');
    handler.handleLLMEnd(result(new AIMessage('hello')), 'run');
    handler.handleLLMError(new Error('failed'), 'run');
    expect(lines).toHaveLength(1);
  });

  it('does not fail a model run when logging and the warning fallback fail', () => {
    const logger = vi.mocked(createLogger).mock.results[0].value as ReturnType<
      typeof createLogger
    >;
    vi.spyOn(logger, 'info').mockImplementation(() => {
      throw new Error('log failed');
    });
    vi.spyOn(logger, 'warn').mockImplementation(() => {
      throw new Error('warn failed');
    });
    const handler = new LlmMeteringHandler();
    start(handler);
    expect(() =>
      handler.handleLLMEnd(result(new AIMessage('ok')), 'run'),
    ).not.toThrow();
  });

  it.each([
    {
      metadata: { ls_model_name: 'deepseek-flash' },
      extra: { invocation_params: { model: 'gpt-5.4' } },
      model: 'deepseek-flash',
    },
    {
      metadata: { ls_model_name: 1 },
      extra: { invocation_params: { model: 'gpt-5.4' } },
      model: 'gpt-5.4',
    },
    { metadata: {}, extra: { invocation_params: null }, model: 'unknown' },
  ])(
    'reads model metadata with invocation fallback ($model)',
    ({ metadata, extra, model }) => {
      const handler = new LlmMeteringHandler();
      handler.handleChatModelStart(
        serialized,
        [[]],
        'run',
        undefined,
        extra,
        undefined,
        metadata,
      );
      handler.handleLLMEnd(result(new AIMessage('ok')), 'run');
      expect(records()[0].model).toBe(model);
    },
  );

  it('preserves traceId and totals through real invoke and stream callbacks', async () => {
    const model = new FakeListChatModel({
      responses: ['hello'],
      callbacks: [new LlmMeteringHandler()],
    });
    const totals = createLlmTotals();
    await runWithTrace(
      't-1',
      async () => {
        await model.invoke('input');
        for await (const _chunk of await model.stream('input')) {
          /* consume the complete run */
        }
      },
      totals,
    );
    expect(records()).toEqual([
      expect.objectContaining({ traceId: 't-1' }),
      expect.objectContaining({ traceId: 't-1' }),
    ]);
    expect(totals).toMatchObject({
      calls: 2,
      estimated: true,
      inputTokens: 4,
      outputTokens: 4,
    });
  });

  it('captures request totals at start and isolates overlapping runs', () => {
    const handler = new LlmMeteringHandler();
    const first = createLlmTotals();
    const second = createLlmTotals();
    runWithTrace('first', () => start(handler, 'first'), first);
    runWithTrace('second', () => start(handler, 'second'), second);
    handler.handleLLMEnd(
      result(new AIMessage({ content: '', usage_metadata: usage })),
      'second',
    );
    handler.handleLLMError(new Error('failed'), 'first');
    expect(first).toMatchObject({
      calls: 1,
      inputTokens: 1000,
      outputTokens: 0,
      estimated: true,
    });
    expect(second).toMatchObject({
      calls: 1,
      inputTokens: 1000,
      cachedInputTokens: 400,
      outputTokens: 200,
      estimated: false,
    });
  });
});
