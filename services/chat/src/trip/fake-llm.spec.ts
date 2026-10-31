import { initialState } from './state.js';
import { FakeTripLlm } from './fake-llm.js';

const signal = new AbortController().signal;

describe('FakeTripLlm', () => {
  const llm = new FakeTripLlm();
  it('treats every destination as in Japan for e2e flows', async () => {
    expect(await llm.locate('杭州 / 里斯本', signal)).toEqual({ japan: '杭州 / 里斯本', outside: [] });
  });
  it('plans when a known city is mentioned, otherwise chats', async () => {
    const plan = await llm.classify({ text: '我想去杭州', state: initialState(), history: [] }, signal);
    expect(plan).toMatchObject({ intent: 'plan', patch: { destination: '杭州' } });
    expect((await llm.classify({ text: '你好', state: initialState(), history: [] }, signal)).intent).toBe('chat');
  });
  it('writes a titled itinerary draft and one day per night', async () => {
    const state = { ...initialState(), requirements: { destination: '杭州' } };
    let text = '';
    for await (const e of llm.respond('itinerary', { text: null, state, history: [] }, signal))
      if (e.type === 'text') text += e.delta;
    expect(text).toContain('杭州行程草稿');
    expect(await llm.extractDays(text, null, 'zh', signal)).toEqual([
      { title: '第 1 天', stops: [{ name: '杭州市区漫步', note: null, time: null }], stayRef: null },
    ]);
  });
});
