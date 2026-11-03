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
    const saved: Record<string, unknown> = { ...initialState(4), stage: 'review', requirements: { destination: 'Kyoto', travelers: 2 }, itinerary: '# Kyoto' };
    delete saved.checkedDestination;
    delete saved.outsideJapan;
    expect(readState(saved, 9)).toEqual({ ...initialState(9), stage: 'review', requirements: { destination: 'Kyoto', travelers: 2 }, itinerary: '# Kyoto', checkedDestination: null, outsideJapan: null });
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
    expect(toTripView(state({ stage: 'review', itinerary: '# 草稿' }))!.status).toBe('draft');
    expect(toTripView(state({ stage: 'confirmed', itinerary: '# 草稿' }))!.status).toBe('confirmed');
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
        itinerary: '# 草稿',
        stays: group('hotels', ['h1']),
        days: [
          { title: '第 1 天', stops: [], stayRef: 'h1' },
          { title: '第 2 天', stops: [], stayRef: null },
        ],
      }),
    )!;
    expect(view.days.map((d) => d.stay?.ref ?? null)).toEqual(['h1', null]);
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
