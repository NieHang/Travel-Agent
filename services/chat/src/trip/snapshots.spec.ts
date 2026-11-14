import { readFileSync, readdirSync } from 'node:fs';
import { z } from 'zod';
import { ComponentSchema } from '@autix/contracts';
import { copy } from './copy.js';
import { fromLegacySnapshot } from './legacy.js';
import { readState, toTripView, TripStateSchema } from './state.js';
import { render } from './view.js';

const directory = new URL('../../test/fixtures/snapshots/', import.meta.url);
const files = readdirSync(directory).filter((file) => file.endsWith('.json')).sort();
const v2Files = files.filter((file) => file.startsWith('trip-state.v2.'));
const v1Files = files.filter((file) => file.startsWith('trip-state.v1.'));
const metadataFiles = files.filter((file) => file.startsWith('message-metadata.'));

function readFixture(file: string): Record<string, unknown> {
  const raw: unknown = JSON.parse(readFileSync(new URL(file, directory), 'utf8'));
  return z.record(z.unknown()).parse(raw);
}

describe('frozen persisted snapshots', () => {
  it('discovers every JSON fixture and covers all persisted stages and component types', () => {
    expect(v1Files.length).toBeGreaterThan(0);
    expect([...v2Files, ...v1Files, ...metadataFiles].sort()).toEqual(files);
    expect([...new Set(v2Files.map((file) => readFixture(file).stage))].sort((left, right) => String(left).localeCompare(String(right)))).toEqual([
      'confirmed', 'idle', 'requirements', 'review', 'trip_type',
    ]);
    const components = metadataFiles.flatMap((file) =>
      z.array(ComponentSchema).parse(readFixture(file).components),
    );
    expect([...new Set(components.map((component) => component.type))].sort()).toEqual([
      'buttons', 'cards', 'choice', 'form',
    ]);
  });

  describe.each(v2Files)('%s', (file) => {
    it('still parses with the current TripStateSchema', () => {
      expect(TripStateSchema.safeParse(readFixture(file)).success).toBe(true);
    });

    it('reads all frozen fields without silently resetting, using the column revision', () => {
      const raw = readFixture(file);
      // Compare with the original JSON, not schema output that could strip lost data.
      expect(readState(raw, 91)).toMatchObject({ ...raw, revision: 91 });
    });

    it('renders components accepted by the frontend history contract', () => {
      const raw = readFixture(file);
      const state = readState(raw, 91);
      for (const component of render(state, copy(state.locale))) {
        expect(ComponentSchema.parse(component)).toEqual(component);
      }
    });
  });

  it.each(v1Files)('migrates %s through the real legacy entry point without losing the trip', (file) => {
    const raw = readFixture(file);
    const context = z.record(z.unknown()).parse(raw.context);
    const requirements = z.record(z.unknown()).parse(context.requirements);
    const trip = z.record(z.unknown()).parse(raw.trip);
    // The one-off migration uses fromLegacySnapshot; live v2 loads use readState.
    const state = fromLegacySnapshot(raw, 91);
    expect(TripStateSchema.safeParse(state).success).toBe(true);
    expect(state).toMatchObject({
      version: 2,
      revision: 91,
      requirements: {
        destination: requirements.destination,
        tripType: requirements.tripType,
        departureDate: requirements.departureDate,
        returnDate: requirements.returnDate,
        travelers: requirements.travelers,
      },
      itinerary: context.itinerary,
      days: trip.days,
    });
    expect(readState(state, 92)).toMatchObject({ ...state, revision: 92 });
  });

  it('preserves the legacy review, normalized requirements, days and tool history', () => {
    const state = fromLegacySnapshot(readFixture('trip-state.v1.reviewing-itinerary.json'), 91);
    expect(state).toMatchObject({
      stage: 'review',
      locale: 'en',
      itinerary: '# 草稿',
      days: [{ title: '第 1 天', stops: [{ name: '西湖', note: null, time: null }], stayRef: null }],
      toolResults: [{ callId: 'legacy-1', tool: 'searchHotels', args: {}, content: '{}', isError: false }],
    });
    expect(state?.requirements).toEqual({
      destination: '杭州', tripType: 'family', departureDate: '2026-12-01', returnDate: '2026-12-03', travelers: 4,
    });
  });

  it('restores a rich itinerary with linked stays and results in every panel', () => {
    const state = readState(readFixture('trip-state.v2.review-results.json'), 91);
    expect(state).toMatchObject({
      stage: 'review',
      requirements: { destination: 'Kyoto', travelers: 3, budget: 180000, budgetCurrency: 'JPY' },
    });
    expect(state.itinerary).toContain('## Day 3\nVisit a garden before departure.');
    expect(state.days).toHaveLength(3);
    expect(state.days.map((day) => day.stayRef)).toEqual(['h1', 'h1', null]);
    expect(state.toolResults.map((result) => [result.callId, result.tool])).toEqual([
      ['t1', 'searchHotels'], ['t2', 'searchRoutes'], ['t3', 'searchPlaces'],
    ]);
    expect(state.results.map((group) => group.panel)).toEqual(['hotels', 'routes', 'hotspots']);
    expect(toTripView(state)).toMatchObject({
      status: 'draft',
      days: [
        { title: 'Day 1: Higashiyama', stay: { ref: 'h1', title: { original: 'Kyoto Garden Hotel' } } },
        { title: 'Day 2: Arashiyama', stay: { ref: 'h1', title: { original: 'Kyoto Garden Hotel' } } },
        { title: 'Day 3: Gardens and departure', stay: null },
      ],
      hotels: [{ price: { amount: 24000, currency: 'JPY' }, amenities: [{ original: 'Family rooms' }, { original: 'Breakfast' }] }],
      routes: [{ title: { original: 'Kyoto Station to Arashiyama' } }],
      hotspots: [{ title: { original: 'Bamboo Grove', translation: '竹林小径' } }],
    });
  });

  it.each(metadataFiles)('still renders stored assistant components from %s', (file) => {
    const metadata = z.object({
      revision: z.number().int().nonnegative(),
      components: z.array(z.unknown()),
    }).strict().parse(readFixture(file));
    for (const component of metadata.components) {
      expect(ComponentSchema.parse(component)).toEqual(component);
    }
  });
});
