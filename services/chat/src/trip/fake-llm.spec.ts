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
    expect(await llm.extractBrief(text, 'zh', signal)).toEqual({
      tip: '避开周末午后的人潮。', todos: [{ kind: 'on_arrival', title: '抵达后领取 IC 卡', note: null }],
    });
    expect(await llm.extractBrief('总览：轻松', 'zh', signal)).toEqual({ tip: null, todos: [] });
    expect(await llm.extractStops({ title: '第 1 天 | 市区漫步（轻松）', body: '' }, 'zh', signal)).toEqual([
      { name: '市区漫步', note: null, time: null, hours: null, closes: null, transit: null },
    ]);
  });
  it('rewrites the first target day on revise', async () => {
    const events = [];
    for await (const e of llm.respond('revise', { text: 'x', state: initialState(), history: [], target: { days: [1], nights: [] } }, signal)) events.push(e);
    expect(events.map((e) => e.type)).toEqual(['edit', 'text']);
    expect(events[0]).toMatchObject({ call: { name: 'write_day', args: { day: 2 } } });
  });
});
