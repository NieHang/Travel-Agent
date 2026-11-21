import { readFileSync } from 'node:fs';
import { ResultGroupSchema } from '@autix/contracts';
import type { Effect } from './commands.js';
import { runEffect, type EffectObservation } from './effect.js';
import { parseDraft } from './itinerary.js';
import type { LlmTask, RespondInput, TripLlm } from './llm.js';
import { initialState, toTripView, type TripState } from './state.js';
import type { LoopEvent } from './tool-loop.js';

vi.mock('../places/records/kyoto.js', async () => ({ kyoto: (await import('../../test/fixtures/place-records.js')).records }));
vi.mock('../places/records/nara.js', () => ({ nara: [] }));
vi.mock('../places/records/osaka.js', () => ({ osaka: [] }));
vi.mock('../places/records/tokyo.js', () => ({ tokyo: [] }));

const fixture = (name: string) => readFileSync(new URL(`../../test/fixtures/drafts/${name}`, import.meta.url), 'utf8');
const kyoto = fixture('kyoto.en.md');
const stays = ResultGroupSchema.parse(JSON.parse(fixture('kyoto.stays.json')));
const signal = () => new AbortController().signal;

/** Plays back fixed loop events and records what the loop answered each edit with. */
function scripted(events: LoopEvent[], repair: LoopEvent[] = []) {
  const replies: (string | undefined)[] = [];
  const calls: { task: LlmTask; target: RespondInput['target']; text: string | null }[] = [];
  const llm: TripLlm = {
    locate: async () => ({ japan: null, outside: [] }),
    classify: async () => { throw new Error('unused'); },
    async *respond(task, { target, text }) {
      calls.push({ task, target, text });
      if (calls.length > 2) throw new Error('Unexpected third pass');
      for (const event of calls.length === 1 ? events : repair) {
        yield event;
        if (event.type === 'edit') replies.push(event.reply);
      }
    },
    extractStops: async (day) => [{ name: day.title.split('|')[1].trim(), note: null, time: day.body.includes('16:00') ? '16:00' : null }],
  };
  return { llm, replies, calls };
}

async function run(llm: TripLlm, effect: Exclude<Effect, null>, state: TripState) {
  const observed: EffectObservation[] = [];
  const events = runEffect(llm, effect, { text: 'x', state, history: [] }, signal(), (event) => observed.push(event));
  const streamed = [];
  for (let step = await events.next(); ; step = await events.next()) {
    if (step.done) return { reply: step.value, streamed, observed };
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
    const { llm, calls } = scripted([{ type: 'text', delta: kyoto.slice(0, 40) }, { type: 'text', delta: kyoto.slice(40) }]);
    const { reply, streamed } = await run(llm, { type: 'itinerary' }, state);
    expect(calls.map((call) => call.task)).toEqual(['itinerary']);
    expect(streamed.filter((e) => e.type === 'text')).toEqual([]);
    expect(streamed.filter((e) => e.type === 'draft').map((e) => e.type === 'draft' && e.delta).join('')).toBe(kyoto);
    expect(state.days.map((d) => [d.stayRef, d.stops[0]?.name])).toEqual([
      ['h1', 'Kyoto Station area · Nishiki Market (light)'],
      ['h1', 'Fushimi Inari Taisha · Tofuku-ji · Gion (standard)'],
      ['h1', 'Nijo Castle · Nishiki Market (light)'],
      [null, 'Departure (light)'],
    ]);
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
    expect(state.days[2]).toEqual({ title: 'Day 3 | Nijo Castle (light)', body: '- 09:30 Nijo Castle', stops: [{ name: 'Nijo Castle (light)', note: null, time: null }], stayRef: 'h1' });
    expect([state.days[0], state.days[1], state.days[3]]).toEqual([before.days[0], before.days[1], before.days[3]]);
    expect(state.preamble).toBe(before.preamble);
    expect(reply).toBe('Day 3 is lighter now.');
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

describe('place conflict repair', () => {
  const late = '**Day 2 | Higashi Hongan-ji**\n- 16:00 Higashi Hongan-ji';
  const fixed = '**Day 2 | Higashi Hongan-ji**\n- Morning visit';
  const draft = '**Day 1 | Kofuku-ji**\n- Morning walk\n\n' + late;
  const stateForRepair = () => ({ ...drafted(), requirements: { departureDate: '2026-12-01' } });
  const writeDay = (markdown: string): LoopEvent => ({
    type: 'edit', call: { name: 'write_day', args: { day: 2, markdown } }, results: [],
  });

  it('repairs just the conflicting draft day and streams only organizing during repair', async () => {
    const state = stateForRepair();
    const { llm, calls } = scripted([{ type: 'text', delta: draft }], [
      { type: 'text', delta: 'Repair narration' }, { type: 'discard_text' }, writeDay(fixed), { type: 'text', delta: 'Fixed' },
    ]);
    const { reply, streamed, observed } = await run(llm, { type: 'itinerary' }, state);
    expect(observed.slice(1)).toEqual([
      { type: 'text', delta: 'Repair narration' }, { type: 'discard_text' },
      { ...writeDay(fixed), reply: 'ok' }, { type: 'text', delta: 'Fixed' },
    ]);
    expect(calls).toEqual([
      { task: 'itinerary', target: undefined, text: 'x' },
      { task: 'revise', target: { days: [1], nights: [] }, text: null },
    ]);
    expect(state.days[1]).toMatchObject({ body: '- Morning visit', stops: [{ name: 'Higashi Hongan-ji', time: null, note: null }] });
    expect(reply).toContain('trip panel');
    expect(streamed.slice(0, 2)).toEqual([{ type: 'status', phase: 'writing' }, { type: 'draft', delta: draft }]);
    expect(streamed.slice(2)).toEqual([{ type: 'status', phase: 'organizing' }, { type: 'status', phase: 'organizing' }]);
  });

  it('keeps a sourced warning when one repair still leaves a conflict', async () => {
    const state = stateForRepair();
    const { llm, calls } = scripted([{ type: 'text', delta: draft }], [writeDay(late)]);
    await run(llm, { type: 'itinerary' }, state);
    expect(calls).toHaveLength(2);
    expect(toTripView(state)?.days[1].stops[0].warning).toEqual({ notes: [{
      text: 'At the estimated visit duration, the visit runs past closing at 16:30.',
      source: 'https://example.org/fixture', checkedOn: '2026-11-18',
    }] });
  });

  it('repairs only days actually rewritten by a revise and returns the original summary', async () => {
    const state = stateForRepair();
    const untouched = { ...state.days[0], stops: [{ name: 'Higashi Hongan-ji', time: '16:00', note: null }] };
    state.days[0] = untouched;
    const { llm, calls } = scripted([writeDay(late), { type: 'text', delta: 'Updated day two.' }], [
      writeDay(fixed), { type: 'text', delta: 'Repair summary' },
    ]);
    const { reply } = await run(llm, { type: 'revise', target: { days: [0, 1], nights: [] } }, state);
    expect(calls.map((call) => call.target)).toEqual([{ days: [0, 1], nights: [] }, { days: [1], nights: [] }]);
    expect(state.days[0]).toBe(untouched);
    expect(state.days[1].body).toBe('- Morning visit');
    expect(reply).toBe('Updated day two.');
  });
});
