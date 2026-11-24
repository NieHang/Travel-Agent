import type { ResultGroup, ResultItem } from '@autix/contracts';
import { initialState, readState, toTripView, type TripState } from './state.js';

const hotel = (ref: string): ResultItem => ({
  ref,
  id: null,
  title: { original: `Hotel ${ref}`, translation: null },
  address: null,
  price: null,
  rating: null,
  url: null,
  image: null,
  details: [],
  amenities: [],
  summary: null,
});
const group = (panel: ResultGroup['panel'], refs: string[]): ResultGroup => ({ panel, items: refs.map(hotel) });
const state = (patch: Partial<TripState>): TripState => ({ ...initialState(4), ...patch });

describe('readState', () => {
  it('keeps legacy state data and defaults the destination check fields', () => {
    const { preamble: _, footer: __, ...fresh } = initialState(4);
    const saved: Record<string, unknown> = { ...fresh, version: 2, stage: 'review', requirements: { destination: 'Kyoto', travelers: 2 }, itinerary: '# Kyoto' };
    delete saved.checkedDestination;
    delete saved.outsideJapan;
    expect(readState(saved, 9)).toEqual({ ...initialState(9), stage: 'review', requirements: { destination: 'Kyoto', travelers: 2 }, preamble: '# Kyoto', checkedDestination: null, outsideJapan: null });
  });
  it('falls back to the initial state and always uses the column revision', () => {
    expect(readState(null, 7)).toEqual(initialState(7));
    expect(readState({ version: 1 }, 2).stage).toBe('idle');
    expect(readState(state({ stage: 'review' }), 9)).toMatchObject({ stage: 'review', revision: 9 });
  });
});

describe('toTripView', () => {
  it('is null for an idle conversation without results', () => {
    expect(toTripView(initialState())).toBeNull();
  });

  it('maps stage to status', () => {
    expect(toTripView(state({ stage: 'trip_type' }))!.status).toBe('collecting');
    expect(toTripView(state({ stage: 'review', preamble: '# 草稿' }))!.status).toBe('draft');
    expect(toTripView(state({ stage: 'confirmed', preamble: '# 草稿' }))!.status).toBe('confirmed');
  });

  it('takes hotels from stays, falling back to hotel results', () => {
    expect(toTripView(state({ stage: 'idle', results: [group('hotels', ['r1'])] }))!.hotels.map((h) => h.ref)).toEqual(['r1']);
    expect(
      toTripView(state({ stage: 'review', stays: group('hotels', ['h1']), results: [group('hotels', ['r1'])] }))!
        .hotels.map((h) => h.ref),
    ).toEqual(['h1']);
  });

  it('attaches each day to its stay card', () => {
    const view = toTripView(
      state({
        stage: 'review',
        preamble: '# 草稿',
        stays: group('hotels', ['h1']),
        days: [
          { title: '第 1 天', body: '', stops: [], stayRef: 'h1' },
          { title: '第 2 天', body: '', stops: [], stayRef: null },
        ],
      }),
    )!;
    expect(view.days.map((d) => d.stay?.ref ?? null)).toEqual(['h1', null]);
    expect(view.stayPlan).toEqual([{ nights: { from: 0, to: 0 }, stay: expect.objectContaining({ ref: 'h1' }), options: [expect.objectContaining({ ref: 'h1' })] }]);
    expect(view.itineraryMarkdown).toBe('# 草稿\n\n**第 1 天**\n- 今晚：Hotel h1\n\n**第 2 天**');
  });

  it('copies requirements and routes/hotspots groups', () => {
    const view = toTripView(
      state({
        stage: 'requirements',
        requirements: { destination: '杭州', travelers: 2 },
        results: [group('routes', ['r1']), group('hotspots', ['r2']), group(null, ['r3'])],
      }),
    )!;
    expect(view).toMatchObject({ destination: '杭州', travelers: 2, departureDate: null, revision: 4 });
    expect(view.routes.map((r) => r.ref)).toEqual(['r1']);
    expect(view.hotspots.map((r) => r.ref)).toEqual(['r2']);
  });
});

it('reads a pre-panel v3 draft with deterministic empty brief and stop fields', () => {
  const saved = {
    ...initialState(), stage: 'review', tip: undefined, todos: undefined, preamble: 'Draft',
    days: [{ title: 'Day 1', body: '- Park', stayRef: null, stops: [{ name: 'Park', note: null, time: null }] }],
  };
  const restored = readState(saved, 5);
  expect(restored).toMatchObject({
    stage: 'review', tip: null, todos: [],
    days: [{ stops: [{ name: 'Park', hours: null, closes: null, transit: null }] }],
  });
  expect(readState(saved, 5)).toEqual(restored);
});

it.each([
  ['Day 1 | A · B (light)', 'A · B', 'light'],
  ['Day 2 | A (standard)', 'A', 'standard'],
  ['Day 3 | B (tiring)', 'B', 'tiring'],
  ['第1天 | 甲（轻松）', '甲', 'light'],
  ['第 2 天｜甲 · 乙（标准）', '甲 · 乙', 'standard'],
  ['第3天：乙（较累）', '乙', 'tiring'],
  ['Day 2: Gardens (east)', 'Gardens (east)', null],
  ['Day 3', '', null],
  ['Free afternoon (light)', 'Free afternoon (light)', null],
])('derives the heading and pace of %s', (title, heading, pace) => {
  const view = toTripView(state({ stage: 'review', days: [{ title, body: '', stops: [], stayRef: null }] }));
  expect(view?.days[0]).toMatchObject({ title, heading, pace });
});

it.each([
  ['16:30', true], ['16:31', true], ['10:30', false], ['9:30', false], ['afternoon', false], [null, false],
] as const)('checks planned time %s against last entry', (time, late) => {
  const stop = { name: 'Castle', note: null, time, hours: 'Last entry 16:30', closes: '16:30', transit: 'Bus to station' };
  const todo = { kind: 'tickets', title: 'Buy exhibition tickets', note: null } as const;
  const view = toTripView(state({ stage: 'review', tip: 'Visit early.', todos: [todo], days: [{ title: 'Day 1', body: '', stops: [stop], stayRef: null }] }));
  expect(view?.days[0].stops).toEqual([{ name: 'Castle', note: null, time, hours: { text: 'Last entry 16:30', late }, transit: null, image: null }]);
  expect(view).toMatchObject({ tip: 'Visit early.', todos: [todo] });
});

it('keeps the leg between stops, drops one after the last stop and finds each stop its photo', () => {
  const stop = (name: string) => ({ name, note: null, time: null, hours: null, closes: null, transit: 'Walk' });
  const days = [{ title: 'Day 1', body: '', stops: [stop('Tofuku-ji'), stop('Kamo River')], stayRef: null }];
  const view = toTripView(state({ stage: 'review', days }), (name) => (name === 'Tofuku-ji' ? '/places/kyoto/tofuku-ji.webp' : null));
  expect(view?.days[0].stops.map(({ name, transit, image }) => ({ name, transit, image }))).toEqual([
    { name: 'Tofuku-ji', transit: 'Walk', image: '/places/kyoto/tofuku-ji.webp' },
    { name: 'Kamo River', transit: null, image: null },
  ]);
});
