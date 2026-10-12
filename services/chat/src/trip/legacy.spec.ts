import { fromLegacySnapshot } from './legacy.js';

const legacy = (stage: string, extra: Record<string, unknown> = {}) => ({
  version: 1,
  revision: 3,
  context: {
    stage,
    requirements: { destination: '杭州', tripType: 'family', departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 4, budget: null },
    itinerary: stage === 'reviewing_itinerary' || stage === 'awaiting_confirmation' || stage === 'confirmed' ? '# 草稿' : null,
    query: { intent: 'hotel_search', input: '酒店', results: [{ tool: 'searchHotels', args: {}, content: '{}', isError: false }] },
    preferredLocale: 'en',
    ...extra,
  },
  response: {},
  trip: { days: [{ title: '第 1 天', stops: [{ name: '西湖', note: null, time: null }] }] },
});

describe('fromLegacySnapshot', () => {
  it.each([
    ['idle', 'idle'],
    ['choosing_trip_type', 'trip_type'],
    ['collecting_requirements', 'requirements'],
    ['reviewing_itinerary', 'review'],
    ['awaiting_confirmation', 'review'],
    ['confirmed', 'confirmed'],
  ])('maps stage %s → %s', (from, to) => {
    expect(fromLegacySnapshot(legacy(from), 7)!.stage).toBe(to);
  });

  it('keeps requirements, itinerary, days, tool results and locale', () => {
    const state = fromLegacySnapshot(legacy('reviewing_itinerary'), 7)!;
    expect(state.revision).toBe(7);
    expect(state.requirements).toEqual({ destination: '杭州', tripType: 'family', departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 4 });
    expect(state.itinerary).toBe('# 草稿');
    expect(state.days).toEqual([{ title: '第 1 天', stops: [{ name: '西湖', note: null, time: null }], stayRef: null }]);
    expect(state.toolResults[0]).toMatchObject({ callId: 'legacy-1', tool: 'searchHotels' });
    expect(state.locale).toBe('en');
  });

  it('returns null for anything else', () => {
    expect(fromLegacySnapshot(null, 1)).toBeNull();
    expect(fromLegacySnapshot({ version: 2 }, 1)).toBeNull();
    expect(fromLegacySnapshot(legacy('unknown_stage'), 1)).toBeNull();
  });
});
