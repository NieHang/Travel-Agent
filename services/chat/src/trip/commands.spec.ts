import type { Command } from '@autix/contracts';
import { initialState, type TripState } from './state.js';
import { CommandError, PlaceSchema, assertAllowed, editTarget, merge, nextStage, reduce, uncheckedDestination, type Classified } from './commands.js';

const empty: Classified['patch'] = {
  destination: null, tripType: null, departureDate: null, returnDate: null,
  travelers: null, preferences: null, budget: null, budgetCurrency: null,
};
const plan = (patch: Partial<Classified['patch']>, clarify: Classified['clarify'] = null): Classified => ({
  intent: 'plan', locale: 'zh', patch: { ...empty, ...patch }, clarify, revise: null,
});
const chat: Classified = { intent: 'chat', locale: 'zh', patch: empty, clarify: null, revise: null };
const full = { destination: '杭州', tripType: 'family' as const, departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 4 };
const at = (patch: Partial<TripState>): TripState => ({ ...initialState(5), ...patch });
const toolResults: TripState['toolResults'] = [{ callId: 't1', tool: 'searchHotels', args: {}, content: '{"hotels":[{"hotelId":"h1","name":"Hotel"}]}', isError: false }];

describe('Japan destinations', () => {
  const command = { type: 'message', text: 'plan' } as const;
  it.each(['Lisbon', '成都'])('refuses %s while keeping the other requirements', (destination) => {
    const result = reduce(initialState(), command, plan({ ...full, destination, travelers: 3 }), { destination, japan: null, outside: [destination] });
    expect(result.effect).toBeNull();
    expect(result.state.requirements).toEqual({ tripType: 'family', departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 3 });
    expect(result.state).toMatchObject({ stage: 'requirements', outsideJapan: { places: [destination], japan: null }, checkedDestination: null, clarify: null });
  });
  it('offers the Japan part of a mixed destination', () => {
    const result = reduce(initialState(), command, plan({ destination: 'Seoul then Fukuoka' }), { destination: 'Seoul then Fukuoka', japan: 'Fukuoka', outside: ['Seoul'] });
    expect(result.effect).toBeNull();
    expect(result.state.outsideJapan).toEqual({ places: ['Seoul'], japan: 'Fukuoka' });
  });
  it('refuses an unlocatable destination by its original name', () => {
    const result = reduce(initialState(), command, plan({ destination: 'somewhere imaginary' }), { destination: 'somewhere imaginary', japan: null, outside: [] });
    expect(result.effect).toBeNull();
    expect(result.state.outsideJapan).toEqual({ places: ['somewhere imaginary'], japan: null });
  });
  it('records a checked Kyoto destination and generates the completed trip', () => {
    const result = reduce(initialState(), command, plan({ ...full, destination: 'Kyoto' }), { destination: 'Kyoto', japan: 'Kyoto', outside: [] });
    expect(result.effect).toEqual({ type: 'itinerary' });
    expect(result.state.checkedDestination).toBe('Kyoto');
    expect(result.state.requirements.destination).toBe('Kyoto');
  });
  it('keeps a checked confirmed Kyoto itinerary after refusing Paris', () => {
    const before = at({ stage: 'confirmed', checkedDestination: 'Kyoto', requirements: { ...full, destination: 'Kyoto' }, preamble: '# Kyoto', days: [{ title: 'Day 1', body: '', stops: [], stayRef: null }], stays: { panel: 'hotels', items: [] } });
    const result = reduce(before, command, plan({ destination: 'Paris' }), { destination: 'Paris', japan: null, outside: ['Paris'] });
    expect(result.effect).toBeNull();
    expect(result.state).toMatchObject({ stage: 'confirmed', requirements: { destination: 'Kyoto' }, preamble: '# Kyoto', days: [{ title: 'Day 1', body: '', stops: [], stayRef: null }], stays: { panel: 'hotels', items: [] }, checkedDestination: 'Kyoto' });
  });
  it('clears an unchecked legacy Lisbon trip even on a chat turn', () => {
    const before = at({ stage: 'review', requirements: { ...full, destination: 'Lisbon' }, preamble: '# Lisbon', days: [{ title: 'Day 1', body: '', stops: [], stayRef: null }], stays: { panel: 'hotels', items: [] } });
    const result = reduce(before, command, chat, { destination: 'Lisbon', japan: null, outside: ['Lisbon'] });
    expect(result.effect).toBeNull();
    expect(result.state.requirements.destination).toBeUndefined();
    expect(result.state).toMatchObject({ stage: 'requirements', preamble: null, days: [], stays: null });
  });
  it('keeps a trip type picked while a legacy destination is refused', () => {
    const before = at({ stage: 'trip_type', requirements: { destination: 'Lisbon' } });
    const result = reduce(before, { type: 'set_trip_type', value: 'solo' }, undefined, { destination: 'Lisbon', japan: null, outside: ['Lisbon'] });
    expect(result.effect).toBeNull();
    expect(result.state.requirements).toEqual({ tripType: 'solo' });
    expect(result.state.stage).toBe('requirements');
  });
  it('keeps refused form values and removes explicit empty preferences', () => {
    const result = reduce(at({ stage: 'requirements', requirements: { tripType: 'family', preferences: 'food' } }), { type: 'submit_requirements', values: { destination: 'Paris', departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 3, preferences: '' } }, undefined, { destination: 'Paris', japan: null, outside: ['Paris'] });
    expect(result.effect).toBeNull();
    expect(result.state.requirements).toEqual({ tripType: 'family', departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 3 });
  });
  it('allows destination buttons after refusal and resets the refusal next turn', () => {
    const refused = reduce(initialState(), command, plan({ destination: 'Paris' }), { destination: 'Paris', japan: null, outside: ['Paris'] }).state;
    const next = reduce(refused, { type: 'set_destination', value: 'Kyoto' }, undefined, { destination: 'Kyoto', japan: 'Kyoto', outside: [] });
    expect(next.state.outsideJapan).toBeNull();
    expect(next.state.requirements.destination).toBe('Kyoto');
    expect(reduce(refused, command, chat).state.outsideJapan).toBeNull();
    expect(() => assertAllowed(initialState(), { type: 'set_destination', value: 'Kyoto' })).toThrow(CommandError);
  });
  it('caps place strings and rejects unknown keys without limiting the place count', () => {
    expect(PlaceSchema.safeParse({ japan: 'a'.repeat(201), outside: [] }).success).toBe(false);
    expect(PlaceSchema.safeParse({ japan: null, outside: ['a'.repeat(201)] }).success).toBe(false);
    expect(PlaceSchema.safeParse({ japan: null, outside: [], extra: true }).success).toBe(false);
    expect(PlaceSchema.parse({ japan: 'Japan', outside: Array.from({ length: 20 }, () => 'Paris') }).outside).toHaveLength(20);
  });
  it('selects only a new or unchecked destination, ignoring chat patches and blank inputs', () => {
    const stored = at({ requirements: { destination: 'Lisbon' } });
    expect(uncheckedDestination(initialState(), command, plan({ destination: ' Kyoto ' }))).toBe('Kyoto');
    expect(uncheckedDestination(stored, command, { ...chat, patch: { ...empty, destination: 'Paris' } })).toBe('Lisbon');
    expect(uncheckedDestination(initialState(), { type: 'set_destination', value: ' Kyoto ' })).toBe('Kyoto');
    expect(uncheckedDestination(initialState(), { type: 'submit_requirements', values: { destination: ' Kyoto ' } })).toBe('Kyoto');
    expect(uncheckedDestination(stored, { type: 'resume' })).toBe('Lisbon');
    expect(uncheckedDestination(at({ requirements: { destination: 'Kyoto' }, checkedDestination: 'Kyoto' }), command, chat)).toBeNull();
    expect(uncheckedDestination(at({ requirements: { destination: 'Kyoto' }, checkedDestination: 'Kyoto' }), command, plan({ destination: 'Paris' }))).toBe('Paris');
    expect(uncheckedDestination(stored, command, plan({ destination: '  ' }))).toBe('Lisbon');
    expect(uncheckedDestination(initialState(), command, chat)).toBeNull();
  });
});

describe('merge', () => {
  it('drops invalid fields instead of failing', () => {
    expect(merge({}, { travelers: 0, departureDate: '2026-02-30', destination: '  ' }).requirements).toEqual({});
    expect(merge({}, { travelers: 3.5 }).requirements).toEqual({});
  });
  it('drops a return date before the departure date', () => {
    expect(merge({}, { departureDate: '2026-12-05', returnDate: '2026-12-01' }).requirements).toEqual({
      departureDate: '2026-12-05',
    });
  });
  it('reports whether anything changed', () => {
    expect(merge({ destination: '杭州' }, { destination: '杭州' }).changed).toEqual([]);
    expect(merge({ destination: '杭州' }, { destination: '苏州' }).changed).toEqual(['destination']);
  });
});

describe('nextStage', () => {
  it.each([
    [{}, 'trip_type'],
    [{ tripType: 'solo' }, 'requirements'],
    [full, 'review'],
  ] as const)('%j → %s', (r, stage) => expect(nextStage(r)).toBe(stage));
});

describe('reduce', () => {
  it('chat messages answer without changing the stage, bump revision and clear results', () => {
    const before = at({ stage: 'requirements', results: [{ panel: 'hotels', items: [] }], toolResults });
    const { state, effect } = reduce(before, { type: 'message', text: '天气？' }, chat);
    expect(effect).toEqual({ type: 'answer' });
    expect(state.stage).toBe('requirements');
    expect(state.revision).toBe(6);
    expect(state.results).toEqual([]);
    expect(state.toolResults).toEqual(toolResults);
    expect(before.revision).toBe(5);
  });

  it('plan messages merge, keep clarify and move to the next stage', () => {
    const clarify = { field: 'destination' as const, question: '想去哪里？', options: ['巴厘岛', '曼谷'] };
    const { state, effect } = reduce(at({}), { type: 'message', text: '暖和的地方' }, plan({ tripType: 'couple' }, clarify));
    expect(effect).toBeNull();
    expect(state.stage).toBe('requirements');
    expect(state.clarify).toEqual(clarify);
  });

  it('one-shot planning goes straight to review with an itinerary effect', () => {
    const { state, effect } = reduce(at({}), { type: 'message', text: '…' }, plan(full));
    expect(state.stage).toBe('review');
    expect(effect).toEqual({ type: 'itinerary' });
  });

  it('set_trip_type then submit_requirements reaches review', () => {
    const typed = reduce(at({ stage: 'trip_type', requirements: { destination: '杭州' } }), { type: 'set_trip_type', value: 'family' });
    expect(typed.state.stage).toBe('requirements');
    const done = reduce(typed.state, {
      type: 'submit_requirements',
      values: { departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 4, preferences: '' },
    });
    expect(done.effect).toEqual({ type: 'itinerary' });
    expect(done.state.requirements.preferences).toBeUndefined();
  });

  it('set_destination clears clarify', () => {
    const { state } = reduce(
      at({ stage: 'requirements', requirements: { tripType: 'solo' }, clarify: { field: 'destination', question: 'q', options: ['巴厘岛'] } }),
      { type: 'set_destination', value: '巴厘岛' },
    );
    expect(state.clarify).toBeNull();
    expect(state.requirements.destination).toBe('巴厘岛');
  });

  it('a changed requirement clears the draft, days and stays', () => {
    const { state, effect } = reduce(
      at({ stage: 'review', requirements: full, preamble: '# 草稿', days: [{ title: 'D1', body: '', stops: [], stayRef: 'h1' }], stays: { panel: 'hotels', items: [] } }),
      { type: 'message', text: '改成 5 人' },
      plan({ travelers: 5 }),
    );
    expect(state).toMatchObject({ preamble: null, days: [], stays: null, stage: 'review' });
    expect(effect).toEqual({ type: 'itinerary' });
  });

  it('an unchanged plan message keeps a confirmed trip confirmed', () => {
    const { state, effect } = reduce(at({ stage: 'confirmed', requirements: full, preamble: '# 草稿' }), { type: 'message', text: '杭州' }, plan({ destination: '杭州' }));
    expect(state.stage).toBe('confirmed');
    expect(effect).toBeNull();
  });

  it.each(['review', 'confirmed'] as const)('clears previous tool results when resubmitting unchanged requirements after editing a %s trip', (stage) => {
    const before = at({ stage, requirements: full, preamble: '# Draft', toolResults });
    const edited = reduce(before, { type: 'edit' });
    expect(edited.state.toolResults).toEqual(toolResults);
    const result = reduce(edited.state, { type: 'submit_requirements', values: full });
    expect(result.effect).toEqual({ type: 'itinerary' });
    expect(result.state.toolResults).toEqual([]);
    expect(before.toolResults).toEqual(toolResults);
  });

  it('confirm, edit and resume', () => {
    const review = at({ stage: 'review', requirements: full, preamble: '# 草稿', stays: { panel: 'hotels', items: [] } });
    expect(reduce(review, { type: 'confirm' }).state.stage).toBe('confirmed');
    expect(reduce(review, { type: 'edit' }).state).toMatchObject({ stage: 'requirements', preamble: null, stays: null, requirements: full });
    expect(reduce(review, { type: 'resume' }).state.stage).toBe('review');
  });
});

describe('assertAllowed', () => {
  const cases: [Partial<TripState>, Command][] = [
    [{ stage: 'idle' }, { type: 'confirm' }],
    [{ stage: 'requirements' }, { type: 'confirm' }],
    [{ stage: 'idle' }, { type: 'edit' }],
    [{ stage: 'idle' }, { type: 'resume' }],
    [{ stage: 'review' }, { type: 'set_trip_type', value: 'solo' }],
    [{ stage: 'review' }, { type: 'submit_requirements', values: {} }],
    [{ stage: 'requirements', clarify: null }, { type: 'set_destination', value: 'x' }],
  ];
  it.each(cases)('rejects %j with %j', (patch, command) => {
    expect(() => assertAllowed(at(patch), command)).toThrow(CommandError);
    try {
      assertAllowed(at(patch), command);
    } catch (error) {
      expect((error as CommandError).status).toBe(409);
    }
  });
  it('always allows messages', () => {
    for (const stage of ['idle', 'trip_type', 'requirements', 'review', 'confirmed'] as const)
      expect(() => assertAllowed(at({ stage }), { type: 'message', text: 'hi' })).not.toThrow();
  });
});

describe('scoped edits', () => {
  const day = (n: number, stayRef: string | null) => ({ title: `Day ${n} | Place`, body: `- 10:00 Place ${n}`, stops: [], stayRef });
  const hotel = (ref: string, id: string) => ({
    ref, id, title: { original: `Hotel ${id}`, translation: null }, address: null, price: null, rating: null,
    url: null, image: null, details: [], amenities: [], summary: null,
  });
  const drafted = (stage: 'review' | 'confirmed' = 'review') => at({
    stage, requirements: { ...full, preferences: 'food' }, toolResults,
    preamble: '**Overview**: 3 nights', footer: '',
    days: [day(1, 'h1'), day(2, 'h1'), day(3, 'h1'), day(4, null)],
    stays: { panel: 'hotels', items: [hotel('h1', '100'), hotel('h2', '200')] },
  });
  const revise = (r: NonNullable<Classified['revise']>, patch: Partial<Classified['patch']> = {}): Classified => ({
    ...plan(patch), intent: 'revise', revise: r,
  });

  it.each([
    ['a named day', { days: [3], hotel: false, hotelDays: [] }, [], { days: [2], nights: [] }],
    ['a hotel for named nights', { days: [], hotel: true, hotelDays: [2, 3] }, [], { days: [], nights: [1, 2] }],
    ['a hotel for every night', { days: [], hotel: true, hotelDays: [] }, [], { days: [], nights: [0, 1, 2] }],
    ['out-of-range numbers', { days: [0, 9], hotel: true, hotelDays: [4] }, [], null],
    ['a pace change for the whole trip', null, ['preferences'], { days: [0, 1, 2, 3], nights: [] }],
    ['a budget change', null, ['budget'], { days: [], nights: [0, 1, 2] }],
    ['a named day plus a pace change', { days: [3], hotel: false, hotelDays: [] }, ['preferences'], { days: [2], nights: [] }],
  ] as const)('targets %s', (_, r, changed, expected) => {
    expect(editTarget(drafted(), r && { ...r, days: [...r.days], hotelDays: [...r.hotelDays] }, [...changed])).toEqual(expected);
  });

  it('revises one day without touching the draft, stays or tool results', () => {
    const before = drafted('confirmed');
    const { state, effect } = reduce(before, { type: 'message', text: 'day 3 lighter' }, revise({ days: [3], hotel: false, hotelDays: [] }));
    expect(effect).toEqual({ type: 'revise', target: { days: [2], nights: [] } });
    expect(state).toMatchObject({ stage: 'review', preamble: before.preamble, days: before.days, stays: before.stays, toolResults });
  });

  it('merges a preference change into the requirements and revises every day', () => {
    const { state, effect } = reduce(drafted(), { type: 'message', text: 'slower please' }, plan({ preferences: 'food, slow pace' }));
    expect(effect).toEqual({ type: 'revise', target: { days: [0, 1, 2, 3], nights: [] } });
    expect(state.requirements.preferences).toBe('food, slow pace');
    expect(state.days).toEqual(drafted().days);
  });

  it('drafts again when the dates change', () => {
    const { state, effect } = reduce(drafted(), { type: 'message', text: 'a day later' }, revise({ days: [], hotel: false, hotelDays: [] }, { returnDate: '2026-12-04' }));
    expect(effect).toEqual({ type: 'itinerary' });
    expect(state).toMatchObject({ preamble: null, days: [], stays: null, toolResults: [] });
  });

  it('answers a revise request that names nothing it can change', () => {
    const { state, effect } = reduce(drafted(), { type: 'message', text: 'nicer?' }, revise({ days: [], hotel: false, hotelDays: [] }));
    expect(effect).toEqual({ type: 'answer' });
    expect(state.days).toEqual(drafted().days);
  });

  it('chooses a stay for one run of nights without the LLM', () => {
    const before = drafted('confirmed');
    const { state, effect } = reduce(before, { type: 'choose_stay', ref: 'h2', nights: { from: 0, to: 2 } });
    expect(effect).toBeNull();
    expect(state.days.map((d) => d.stayRef)).toEqual(['h2', 'h2', 'h2', null]);
    expect(state.stage).toBe('review');
    expect(state.days[3]).toEqual(before.days[3]);
  });

  it.each([
    ['nights that are not one current run', { type: 'choose_stay', ref: 'h2', nights: { from: 0, to: 1 } }],
    ['a hotel that is not an option', { type: 'choose_stay', ref: 'h9', nights: { from: 0, to: 2 } }],
  ] as const)('refuses %s', (_, command) => {
    expect(() => assertAllowed(drafted(), { ...command, nights: { ...command.nights } })).toThrow(CommandError);
  });

  it('refuses choose_stay without a draft', () => {
    expect(() => assertAllowed(at({ stage: 'requirements' }), { type: 'choose_stay', ref: 'h1', nights: { from: 0, to: 0 } })).toThrow(CommandError);
  });
});
