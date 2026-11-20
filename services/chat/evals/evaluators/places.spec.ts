import { gradePlaces } from './places.js';
import { initialState } from '../../src/trip/state.js';
import type { ItineraryEntry } from '../schemas.js';

// The checks run against fixture records only, so the real library can change without touching these expectations.
vi.mock('../../src/places/records/kyoto.js', async () => ({ kyoto: (await import('../../test/fixtures/place-records.js')).records }));
vi.mock('../../src/places/records/nara.js', () => ({ nara: [] }));
vi.mock('../../src/places/records/osaka.js', () => ({ osaka: [] }));
vi.mock('../../src/places/records/tokyo.js', () => ({ tokyo: [] }));
const item: ItineraryEntry = { id: 'fixture', text: 'Plan a day', today: '2026-11-19', locale: 'en', category: 'itinerary',
  history: [], expected: { effect: 'itinerary', nights: 0 }, must: ['day plan'] };

it('scores each matched stop once and measures coverage over all stops', () => {
  const stops = ['Kofuku-ji', 'Tsukiji Outer Market', 'Unknown', 'Unknown', '东本愿寺'].map((name) => ({ name, time: '16:00', note: null }));
  const next = { ...initialState(), requirements: { departureDate: '2026-12-01' }, days: [{ title: '', body: '', stayRef: null, stops }] };
  expect(gradePlaces(item, { next, effect: 'itinerary' })).toEqual([
    { name: 'place_conflict_rate', value: 1 / 3 }, { name: 'place_caution_rate', value: 2 / 3 }, { name: 'place_unverified_share', value: 0.4 },
  ]);
});
it('scores nothing for a turn that drafted no itinerary', () => {
  const next = { ...initialState(), days: [{ title: '', body: '', stayRef: null, stops: [{ name: 'Kofuku-ji', time: '16:00', note: null }] }] };
  expect(gradePlaces(item, { next, effect: 'answer' })).toEqual([]);
  expect(gradePlaces(item, { next, effect: null })).toEqual([]);
});
it('leaves out a rate that has no denominator', () => {
  expect(gradePlaces(item, { next: initialState(), effect: 'itinerary' })).toEqual([]);
  const stops = ['Unknown', 'Unknown'].map((name) => ({ name, time: '16:00', note: null }));
  const next = { ...initialState(), days: [{ title: '', body: '', stayRef: null, stops }] };
  expect(gradePlaces(item, { next, effect: 'itinerary' })).toEqual([{ name: 'place_unverified_share', value: 1 }]);
});
