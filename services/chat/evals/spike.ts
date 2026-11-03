import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { LangfuseClient as Client } from '@langfuse/client';

// Bun preloads .env; let .env.eval take precedence over those preloaded values.
config({ path: fileURLToPath(new URL('../.env.eval', import.meta.url)), override: true });
config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
// Initialize OTel before importing the client, LangChain or application modules.
const { flush, shutdown } = await import('./instrumentation.js');

const meteringLogs: string[] = [];
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = (
  chunk: string | Uint8Array,
  encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
  callback?: (error?: Error | null) => void,
) => {
  const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
  if (text.includes('"msg":"llm call"') && text.includes('"operation":"trip.classify"')) meteringLogs.push(text);
  if (typeof encodingOrCallback === 'function') return write(chunk, encodingOrCallback);
  return write(chunk, encodingOrCallback, callback);
};
// Pino must use its JSON stdout stream so this spike can verify the actual metering line.
process.env.LOG_PRETTY = '0';
process.env.LOG_LEVEL = 'info';
process.env.LANGCHAIN_CALLBACKS_BACKGROUND = 'false';

try {
  await main();
} catch (error) {
  console.error('FAIL spike setup or cleanup:', error);
  process.exitCode = 1;
} finally {
  try {
    await shutdown();
  } finally {
    process.stdout.write = write;
  }
}

async function main(): Promise<void> {
  const { LangfuseClient } = await import('@langfuse/client');
  const { startActiveObservation } = await import('@langfuse/tracing');
  const { CallbackHandler } = await import('@langfuse/langchain');
  const { ModelTripLlm } = await import('../src/trip/llm.js');
  const { initialState } = await import('../src/trip/state.js');
  const { McpService } = await import('../src/llm/mcp/mcp.service.js');
  const { z } = await import('zod');

  const client = new LangfuseClient();
  const mcp = new McpService();
  try {
    const checks = [
      [
        'a. OTel trace can be read back',
        async () => {
          const traceId = await startActiveObservation('p0-spike-otel', async (span) => {
            span.update({ input: 'P0', output: 'OTel under Bun' });
            return span.traceId;
          });
          await readTrace(client, traceId, (observations) => observations.some((o) => o.name === 'p0-spike-otel'));
        },
      ],
      [
        'b. classify emits metering and a generation with token usage',
        async () => {
          const llm = new ModelTripLlm(undefined, [], { callbacks: [new CallbackHandler()] });
          const traceId = await startActiveObservation('p0-spike-classify', async (span) => {
            await llm.classify(
              { text: '你好', state: initialState(0, 'zh'), history: [] },
              AbortSignal.timeout(180_000),
            );
            return span.traceId;
          });
          if (!meteringLogs.some((line) => line.includes('"status":"ok"')))
            throw new Error('No successful trip.classify metering log line');
          await readTrace(client, traceId, (observations) =>
            observations.some(
              (o) => o.type === 'GENERATION' && Object.values(o.usageDetails ?? {}).some((tokens) => tokens > 0),
            ),
          );
        },
      ],
      [
        'c. dataset experiment traces LLM and MCP tool calls',
        async () => {
          await client.api.datasets.create({ name: 'p0-spike' });
          await client.dataset.createItem({
            datasetName: 'p0-spike',
            id: 'p0-spike-hotel',
            input: '京都站附近 1000 元以内的酒店',
          });
          await mcp.mcpManager.start();
          const callbacks = [new CallbackHandler()];
          const getTools = mcp.mcpManager.getTools.bind(mcp.mcpManager);
          // The custom loop invokes tools separately from the model; attach the eval handler to them too.
          mcp.mcpManager.getTools = () =>
            getTools().map((tool) => {
              tool.callbacks = callbacks;
              return tool;
            });
          const llm = new ModelTripLlm(mcp, [], { callbacks });
          const dataset = await client.dataset.get('p0-spike');
          const result = await dataset.runExperiment({
            name: 'P0 Bun SDK spike',
            runName: `p0-spike-${new Date().toISOString()}`,
            maxConcurrency: 1,
            task: async ({ input }: { input?: unknown }) => {
              const text = z.string().parse(input);
              const state = initialState(0, 'zh');
              const signal = AbortSignal.timeout(180_000);
              const classified = await llm.classify({ text, state, history: [] }, signal);
              const chunks: string[] = [];
              for await (const event of llm.respond('answer', { text, state, history: [] }, signal)) {
                if (event.type === 'text') chunks.push(event.delta);
              }
              return { classified, answer: chunks.join('') };
            },
            evaluators: [async () => ({ name: 'spike_completed', value: 1 })],
          });
          const url = result.experimentUrl ?? result.datasetRunUrl;
          if (url) console.log(`Experiment: ${url}`);
          const item = result.itemResults[0];
          if (result.itemResults.length !== 1 || !item?.traceId)
            throw new Error('Expected exactly one completed experiment item with a trace ID');
          if (!item.evaluations.some((evaluation) => evaluation.name === 'spike_completed' && evaluation.value === 1))
            throw new Error('Experiment evaluator score is missing');
          await client.flush();
          await readTrace(
            client,
            item.traceId,
            (observations) =>
              observations.some((o) => o.type === 'GENERATION') &&
              observations.some(
                (o) => o.type === 'TOOL' && observations.some((parent) => parent.id === o.parentObservationId),
              ),
          );
        },
      ],
    ] satisfies [string, () => Promise<void>][];

    for (const [label, check] of checks) {
      try {
        await check();
        console.log(`PASS ${label}`);
      } catch (error) {
        console.error(`FAIL ${label}:`, error);
        process.exitCode = 1;
      }
    }
  } finally {
    try {
      await mcp.mcpManager.close();
    } finally {
      await client.flush();
    }
  }
}

type Observations = Awaited<ReturnType<Client['api']['observations']['getMany']>>['data'];

async function readTrace(
  client: Client,
  traceId: string,
  ready: (observations: Observations) => boolean,
): Promise<void> {
  await flush();
  const deadline = Date.now() + 15_000;
  do {
    const { data } = await client.api.observations.getMany(
      { traceId, fields: 'core,basic,usage', limit: 1000 },
      { timeoutInSeconds: 3, maxRetries: 0 },
    );
    if (ready(data)) return;
    await delay(500);
  } while (Date.now() < deadline);
  throw new Error(`Trace ${traceId} did not contain the expected observations within 15s`);
}
