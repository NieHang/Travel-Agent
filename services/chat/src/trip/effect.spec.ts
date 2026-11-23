import { readFileSync } from 'node:fs';
import { ResultGroupSchema } from '@autix/contracts';
import type { Effect } from './commands.js';
import { runEffect } from './effect.js';
import { parseDraft } from './itinerary.js';
import type { LlmTask, RespondInput, TripLlm } from './llm.js';
import { initialState, type TripState } from './state.js';
import type { LoopEvent } from './tool-loop.js';

const fixture = (name: string) => readFileSync(new URL(`../../test/fixtures/drafts/${name}`, import.meta.url), 'utf8');
const kyoto = fixture('kyoto.en.md');
const stays = ResultGroupSchema.parse(JSON.parse(fixture('kyoto.stays.json')));
const signal = () => new AbortController().signal;

/** Plays back fixed loop events and records what the loop answered each edit with. */
function scripted(events: LoopEvent[]) {
  const replies: (string | undefined)[] = [];
  const llm = {
    locate: async () => ({ japan: null, outside: [] }),
    classify: async () => { throw new Error('unused'); },
    async *respond(_task: LlmTask, _input: RespondInput) {
      for (const event of events) {
        yield event;
        if (event.type === 'edit') replies.push(event.reply);
      }
    },
    extractBrief: vi.fn(async () => ({ tip: 'Visit early.', todos: [{ kind: 'reserve' as const, title: 'Reserve entry', note: null }] })),
    extractStops: async (day) => [{ name: day.title.split('|')[1].trim(), note: null, time: null, hours: null, closes: null, transit: null }],
  } satisfies TripLlm;
  return { llm, replies };
}

async function run(llm: TripLlm, effect: Exclude<Effect, null>, state: TripState) {
  const events = runEffect(llm, effect, { text: 'x', state, history: [] }, signal());
  const streamed = [];
  for (let step = await events.next(); ; step = await events.next()) {
    if (step.done) return { reply: step.value, streamed };
    streamed.push(step.value);
  }
}

function drafted(): TripState {
  const draft = parseDraft(kyoto, stays);
  return {
    ...initialState(4, 'en'), stage: 'review', stays,
    preamble: draft.preamble, footer: draft.footer, days: draft.days.map((d) => ({ ...d, stops: [] })),
  };
}

describe('runEffect: itinerary', () => {
  it('streams the draft to the panel, splits it into days and replies with the overview', async () => {
    const state = { ...initialState(4, 'en'), stays };
    const { llm } = scripted([{ type: 'text', delta: kyoto.slice(0, 40) }, { type: 'text', delta: kyoto.slice(40) }]);
    const { reply, streamed } = await run(llm, { type: 'itinerary' }, state);
    expect(streamed.filter((e) => e.type === 'text')).toEqual([]);
    expect(streamed.filter((e) => e.type === 'draft').map((e) => e.type === 'draft' && e.delta).join('')).toBe(kyoto);
    expect(state.days.map((d) => [d.stayRef, d.stops[0]?.name])).toEqual([
      ['h1', 'Kyoto Station area · Nishiki Market (light)'],
      ['h1', 'Fushimi Inari Taisha · Tofuku-ji · Gion (standard)'],
      ['h1', 'Nijo Castle · Nishiki Market (light)'],
      [null, 'Departure (light)'],
    ]);
    expect(llm.extractBrief).toHaveBeenCalledWith(state.preamble, 'en', expect.any(AbortSignal));
    expect(state).toMatchObject({ tip: 'Visit early.', todos: [{ kind: 'reserve', title: 'Reserve entry', note: null }] });
    expect(reply).toMatch(/^Kyoto 3 nights, one base[\s\S]*The full itinerary is in the trip panel\.$/);
  });

  it('fails on an empty draft so the old state is kept', async () => {
    const { llm } = scripted([{ type: 'text', delta: 'narration' }, { type: 'discard_text' }]);
    await expect(run(llm, { type: 'itinerary' }, initialState(4, 'en'))).rejects.toThrow('Empty itinerary');
  });
});

describe('runEffect: revise', () => {
  const day3 = '**Day 3 | Nijo Castle (light)**\n- 09:30 Nijo Castle\n- Tonight: Miyako Hotel Kyoto Hachijo';

  it('rewrites only the target day and keeps its hotel when its night is not a target', async () => {
    const before = drafted();
    const state = structuredClone(before);
    const { llm, replies } = scripted([
      { type: 'edit', call: { name: 'write_day', args: { day: 2, markdown: '**Day 2 | Gion (light)**\n- 17:00 Gion' } }, results: [] },
      { type: 'edit', call: { name: 'write_day', args: { day: 3, markdown: day3 } }, results: [] },
      { type: 'edit', call: { name: 'use_stay', args: { hotelId: '13249', days: [3] } }, results: [] },
      { type: 'text', delta: 'Day 3 is lighter now.' },
    ]);
    const { reply } = await run(llm, { type: 'revise', target: { days: [2], nights: [] } }, state);
    expect(replies).toEqual([
      'Day 2 is not part of this edit. Only rewrite day 3.',
      'ok',
      'The nights after day 3 are not part of this edit. Only change the nights after day (none).',
    ]);
    expect(state.days[2]).toEqual({ title: 'Day 3 | Nijo Castle (light)', body: '- 09:30 Nijo Castle', stops: [{ name: 'Nijo Castle (light)', note: null, time: null, hours: null, closes: null, transit: null }], stayRef: 'h1' });
    expect([state.days[0], state.days[1], state.days[3]]).toEqual([before.days[0], before.days[1], before.days[3]]);
    expect(state.preamble).toBe(before.preamble);
    expect(llm.extractBrief).not.toHaveBeenCalled();
    expect(reply).toBe('Day 3 is lighter now.');
  });

  it('replaces the brief when the preamble is rewritten', async () => {
    const state = drafted();
    const markdown = 'Overview: Visit early.\n\nBefore you go\n- Reserve entry';
    const { llm } = scripted([{ type: 'edit', call: { name: 'write_preamble', args: { markdown } }, results: [] }]);
    await run(llm, { type: 'revise', target: { days: [], nights: [] } }, state);
    expect(llm.extractBrief).toHaveBeenCalledWith(markdown, 'en', expect.any(AbortSignal));
    expect(state).toMatchObject({ preamble: markdown, tip: 'Visit early.', todos: [{ kind: 'reserve', title: 'Reserve entry', note: null }] });
  });

  it('moves a target night to a grounded hotel and refuses one it never showed', async () => {
    const state = drafted();
    const { llm, replies } = scripted([
      { type: 'edit', call: { name: 'use_stay', args: { hotelId: 'nope', days: [1] } }, results: [] },
      { type: 'edit', call: { name: 'use_stay', args: { hotelId: '13249', days: [1, 2, 3] } }, results: [] },
    ]);
    const { reply } = await run(llm, { type: 'revise', target: { days: [], nights: [0, 1, 2] } }, state);
    expect(replies).toEqual(['Hotel nope is not among the hotels you showed. Show it with show_results first.', 'ok']);
    expect(state.days.map((d) => d.stayRef)).toEqual(['h3', 'h3', 'h3', null]);
    expect(reply).toBeNull();
  });

  it('asks for exactly one day when write_day gets several', async () => {
    const state = drafted();
    const { llm, replies } = scripted([
      { type: 'edit', call: { name: 'write_day', args: { day: 3, markdown: `${day3}\n\n**Day 4 | Extra (light)**` } }, results: [] },
    ]);
    await run(llm, { type: 'revise', target: { days: [2], nights: [] } }, state);
    expect(replies).toEqual(['Write exactly one day, starting with its "Day N | …" header line.']);
    expect(state.days).toEqual(drafted().days);
  });
});
