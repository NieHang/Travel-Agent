import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { LangfuseClient } from '@langfuse/client';
import { CallbackHandler } from '@langfuse/langchain';
import { loadLangChainConfig } from '../src/config/load-langchain-config.js';
import { CLASSIFY_PROMPT, extractDaysPrompt, ModelTripLlm } from '../src/trip/llm.js';
import { gradeClarify } from './evaluators/classify.js';
import { executeItem, runName, type ItemResult } from './experiment.js';
import { ClassifyEntrySchema, ExtractDaysEntrySchema, SuiteSchema, type ClassifyEntry } from './schemas.js';
import { metricMeans } from './metrics.js';

export async function run(args: string[]): Promise<void> {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: {
    trials: { type: 'string', default: '3' }, tag: { type: 'string' }, concurrency: { type: 'string', default: '4' },
  } });
  const suite = SuiteSchema.parse(positionals[0]);
  const trials = positiveInteger(values.trials, 'trials');
  const maxConcurrency = positiveInteger(values.concurrency, 'concurrency');
  if (positionals.length !== 1 || (values.tag && !/^[\w.-]+$/.test(values.tag))) throw new Error('Usage: eval <suite> [--trials 3] [--tag name] [--concurrency 4]');
  const { llm } = loadLangChainConfig();
  const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim());
  const prompt = suite === 'classify' ? CLASSIFY_PROMPT : extractDaysPrompt('en', null);
  const metadata = {
    model: llm.model, temperature: llm.temperature, thinking: llm.thinking ?? null, maxTokens: llm.maxTokens ?? null,
    config: process.env.LANGCHAIN_CONFIG || 'config/langchain.yaml',
    promptHash: createHash('sha256').update(prompt).digest('hex').slice(0, 8),
  };
  const client = new LangfuseClient();
  try {
    const dataset = await client.dataset.get(`trip-${suite}`);
    // runExperiment closes over this array, rather than reading dataset.items again.
    dataset.items.splice(0, dataset.items.length, ...dataset.items.filter((item) => item.status === 'ACTIVE'));
    const schema = suite === 'classify' ? ClassifyEntrySchema : ExtractDaysEntrySchema;
    // Remote dataset JSON is a boundary too; retain typed entries for tasks and graders.
    const entries = new Map(dataset.items.map((item) => [item.input, schema.parse({ ...objectInput(item.input), expected: item.expectedOutput })]));
    if (!entries.size) throw new Error(`trip-${suite} has no active items; run eval:sync first`);
    const runMetadata = { ...metadata, today: [...new Set([...entries.values()].map((item) => item.today))] };
    for (const trial of Array.from({ length: trials }, (_, i) => i + 1)) {
      const name = runName(suite, sha, dirty, values.tag, trial);
      const completed = new Map<unknown, ItemResult>();
      const clarify = new Map<unknown, { expected: ClassifyEntry['expected']['clarifyField']; actual: ClassifyEntry['expected']['clarifyField'] }>();
      const result = await dataset.runExperiment({
        name: `trip-${suite}`, runName: name, maxConcurrency, metadata: runMetadata,
        task: async ({ input }: { input?: unknown }) => {
          const item = entries.get(input)!;
          const output = await executeItem(item, new ModelTripLlm(undefined, [], { callbacks: [new CallbackHandler()], today: item.today }));
          completed.set(input, output);
          if ('text' in item) clarify.set(input, { expected: item.expected.clarifyField, actual: output.output && !Array.isArray(output.output) ? output.output.clarify?.field ?? null : null });
          return output.output;
        },
        evaluators: [async ({ input }: { input: unknown }) => completed.get(input)!.scores],
        runEvaluators: suite === 'classify' ? [async () => gradeClarify([...clarify.values()])] : [],
      });
      // The SDK logs task/evaluator failures instead of throwing; incomplete runs cannot be baselines.
      if (completed.size !== entries.size || result.itemResults.some((item) => item.evaluations.length === 0)) throw new Error(`Incomplete experiment: ${name}`);
      const scores = suite === 'classify' ? gradeClarify([...clarify.values()]) : [];
      const output = { suite, runName: name, metadata: runMetadata, experimentUrl: result.experimentUrl, scores, items: [...completed.values()] };
      const folder = new URL('./results/', import.meta.url);
      await mkdir(folder, { recursive: true });
      await writeFile(new URL(`${name.replace('#', '_')}.json`, folder), `${JSON.stringify(output, null, 2)}\n`);
      console.log(`Experiment: ${result.experimentUrl}`);
      console.table([...metricMeans([...completed.values()].flatMap((item) => item.scores)), ...scores.map((score) => [score.name, score.value] as const)].map(([metric, mean]) => ({ metric, mean })));
    }
  } finally {
    await client.flush();
  }
}

function positiveInteger(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function objectInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Dataset input must be an object');
  return input as Record<string, unknown>;
}
