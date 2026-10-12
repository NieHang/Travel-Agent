import type { Command } from '@autix/contracts';
import { initialState, type TripState } from './state.js';
import { CommandError, assertAllowed, merge, nextStage, reduce, type Classified } from './commands.js';

const empty = {
  destination: null, tripType: null, departureDate: null, returnDate: null,
  travelers: null, preferences: null, budget: null, budgetCurrency: null,
};
const plan = (patch: Partial<typeof empty>, clarify: Classified['clarify'] = null): Classified => ({
  intent: 'plan', locale: 'zh', patch: { ...empty, ...patch }, clarify,
});
const chat: Classified = { intent: 'chat', locale: 'zh', patch: empty, clarify: null };
const full = { destination: '杭州', tripType: 'family' as const, departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 4 };
const at = (patch: Partial<TripState>): TripState => ({ ...initialState(5), ...patch });

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
    expect(merge({ destination: '杭州' }, { destination: '杭州' }).changed).toBe(false);
    expect(merge({ destination: '杭州' }, { destination: '苏州' }).changed).toBe(true);
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
    const before = at({ stage: 'requirements', results: [{ panel: 'hotels', items: [] }] });
    const { state, effect } = reduce(before, { type: 'message', text: '天气？' }, chat);
    expect(effect).toBe('answer');
    expect(state.stage).toBe('requirements');
    expect(state.revision).toBe(6);
    expect(state.results).toEqual([]);
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
    expect(effect).toBe('itinerary');
  });

  it('set_trip_type then submit_requirements reaches review', () => {
    const typed = reduce(at({ stage: 'trip_type', requirements: { destination: '杭州' } }), { type: 'set_trip_type', value: 'family' });
    expect(typed.state.stage).toBe('requirements');
    const done = reduce(typed.state, {
      type: 'submit_requirements',
      values: { departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 4, preferences: '' },
    });
    expect(done.effect).toBe('itinerary');
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
      at({ stage: 'review', requirements: full, itinerary: '# 草稿', days: [{ title: 'D1', stops: [], stayRef: 'h1' }], stays: { panel: 'hotels', items: [] } }),
      { type: 'message', text: '改成 5 人' },
      plan({ travelers: 5 }),
    );
    expect(state).toMatchObject({ itinerary: null, days: [], stays: null, stage: 'review' });
    expect(effect).toBe('itinerary');
  });

  it('an unchanged plan message keeps a confirmed trip confirmed', () => {
    const { state, effect } = reduce(at({ stage: 'confirmed', requirements: full, itinerary: '# 草稿' }), { type: 'message', text: '杭州' }, plan({ destination: '杭州' }));
    expect(state.stage).toBe('confirmed');
    expect(effect).toBeNull();
  });

  it('confirm, edit and resume', () => {
    const review = at({ stage: 'review', requirements: full, itinerary: '# 草稿', stays: { panel: 'hotels', items: [] } });
    expect(reduce(review, { type: 'confirm' }).state.stage).toBe('confirmed');
    expect(reduce(review, { type: 'edit' }).state).toMatchObject({ stage: 'requirements', itinerary: null, stays: null, requirements: full });
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
