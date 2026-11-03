const model = vi.hoisted(() => ({
  options: vi.fn(),
  classify: vi.fn(),
  respond: vi.fn(),
}));
vi.mock('../src/trip/llm.js', () => ({
  ModelTripLlm: class {
    constructor(_source: unknown, _skills: unknown, options: unknown) { model.options(options); }
    classify = model.classify;
    respond = model.respond;
  },
}));
vi.mock('../src/skills/registry.js', () => ({ loadSkills: () => [] }));
vi.mock('./replay/cassette.js', () => ({ readCassette: async () => ({ tools: [], calls: [] }) }));

import { initialState } from '../src/trip/state.js';

it('replays the fixed Chinese hotel question three times with the injected date', async () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  process.argv = ['bun', 'evals/replay-check.ts'];
  process.exitCode = undefined;
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  model.classify.mockResolvedValue({
    intent: 'chat', locale: 'zh', clarify: null,
    patch: { destination: null, tripType: null, departureDate: null, returnDate: null, travelers: null, preferences: null, budget: null, budgetCurrency: null },
  });
  model.respond.mockImplementation(async function* () {
    yield { type: 'tool_call', name: 'mcp_hotels_search', args: { city: 'Kyoto' } };
  });
  try {
    await import('./replay-check.js');
    expect(model.classify).toHaveBeenCalledTimes(3);
    for (const [input] of model.classify.mock.calls) {
      expect(input).toEqual({ text: '京都站附近 1000 元以内的酒店', state: initialState(0, 'zh'), history: [] });
    }
    expect(model.respond).toHaveBeenCalledTimes(3);
    for (const [task, input] of model.respond.mock.calls) {
      expect(task).toBe('answer');
      expect(input.text).toBe('京都站附近 1000 元以内的酒店');
    }
    expect(model.options.mock.calls).toEqual([[{ today: '2026-10-29' }], [{ today: '2026-10-29' }], [{ today: '2026-10-29' }]]);
    expect(log).toHaveBeenCalledWith('PASS: all 3 tool-call sequences are identical, with no replay misses.');
    expect(error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  } finally {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  }
});
