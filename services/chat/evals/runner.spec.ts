import type { Score } from './schemas.js';

const mocks = vi.hoisted(() => ({
  create: vi.fn(), get: vi.fn(), flush: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn(), options: vi.fn(),
}));
vi.mock('@langfuse/client', () => ({ LangfuseClient: class {
  dataset = { get: mocks.get };
  flush = mocks.flush;
} }));
vi.mock('@langfuse/langchain', () => ({ CallbackHandler: class {} }));
vi.mock('node:child_process', () => ({ execFileSync: (_cmd: string, args: string[]) => args[0] === 'rev-parse' ? 'abc1234\n' : '' }));
vi.mock('node:fs/promises', async (original) => ({
  ...await original<typeof import('node:fs/promises')>(), writeFile: mocks.writeFile, mkdir: mocks.mkdir,
}));
vi.mock('../src/trip/llm.js', async (original) => {
  const actual = await original<typeof import('../src/trip/llm.js')>();
  const { FakeTripLlm } = await import('../src/trip/fake-llm.js');
  return { ...actual, ModelTripLlm: class extends FakeTripLlm {
    constructor(_mcp: unknown, _skills: unknown, options: unknown) { super(); mocks.options(options); }
  } };
});

import { run } from './runner.js';
import { ResultSchema } from './schemas.js';

it('runs trials through dataset.runExperiment, persists validated fake output and excludes archived items', async () => {
  const active = { status: 'ACTIVE', input: {
    id: 'cls-zh-partial-01', category: 'partial', today: '2026-10-30', locale: 'zh',
    text: '去杭州', state: { stage: 'idle', requirements: {} }, history: [],
  }, expectedOutput: { intent: 'plan', patch: { destination: '杭州' }, clarifyField: null } };
  const archived = { ...active, status: 'ARCHIVED', input: { ...active.input, id: 'removed' } };
  const items = [active, archived];
  const runExperiment = vi.fn(async (params: {
    task: (item: typeof active) => Promise<unknown>;
    evaluators: ((params: { input: unknown }) => Promise<Score[]>)[];
    runEvaluators: (() => Promise<Score[]>)[];
  }) => {
    const itemResults = await Promise.all(items.map(async (item) => {
      const output = await params.task(item);
      const evaluations = (await Promise.all(params.evaluators.map((evaluate) => evaluate({ input: item.input })))).flat();
      return { input: item.input, output, evaluations };
    }));
    return { itemResults, runEvaluations: (await Promise.all(params.runEvaluators.map((evaluate) => evaluate()))).flat(), experimentUrl: 'http://localhost/experiment/one' };
  });
  mocks.get.mockResolvedValue({ items, runExperiment });
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const table = vi.spyOn(console, 'table').mockImplementation(() => {});
  try {
    await run(['classify', '--trials', '2', '--tag', 'fake', '--concurrency', '1']);
    expect(mocks.get).toHaveBeenCalledWith('trip-classify');
    expect(runExperiment).toHaveBeenCalledTimes(2);
    expect(runExperiment.mock.calls[0][0]).toMatchObject({ name: 'trip-classify', runName: 'classify@abc1234-fake#1', maxConcurrency: 1 });
    expect(mocks.writeFile).toHaveBeenCalledTimes(2);
    const [path, content] = mocks.writeFile.mock.calls[0] as [URL, string];
    expect(path.pathname).toContain('classify@abc1234-fake_1.json');
    const result = ResultSchema.parse(JSON.parse(content));
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('cls-zh-partial-01');
    expect(result.items[0].scores).toContainEqual({ name: 'patch_exact', value: 1 });
    expect(result.scores).toEqual([{ name: 'clarify_recall', value: 1 }, { name: 'clarify_precision', value: 1 }]);
    expect(result.metadata).toMatchObject({ config: 'config/langchain.yaml', today: ['2026-10-30'], promptHash: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(mocks.options.mock.calls[0][0]).toMatchObject({ today: '2026-10-30', callbacks: [expect.anything()] });
    expect(mocks.flush).toHaveBeenCalledOnce();
  } finally {
    log.mockRestore(); table.mockRestore();
  }
});
