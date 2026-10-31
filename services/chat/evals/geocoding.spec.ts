import { GoogleCoordinates, fillGeocache, gradeGeography, type Geocache } from './geocoding.js';
import { FakeTripLlm } from '../src/trip/fake-llm.js';
import { initialState } from '../src/trip/state.js';
import { turn } from './turn.js';
import { writeFile } from 'node:fs/promises';

vi.mock('node:fs/promises', async (original) => ({ ...await original<typeof import('node:fs/promises')>(), writeFile: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it('makes no Google requests without an approved budget', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  expect(() => new GoogleCoordinates(0).get('a')).toThrow('approval budget exhausted');
  expect(fetch).not.toHaveBeenCalled();
});

it('uses only the location mask, reuses in-memory coordinates, and enforces the approved count', async () => {
  vi.stubEnv('GOOGLE_MAPS_API_KEY', 'unit-test');
  const fetch = vi.fn(async () => Response.json({ location: { latitude: 35, longitude: 135 } }));
  vi.stubGlobal('fetch', fetch);
  const coordinates = new GoogleCoordinates(1);
  expect(await coordinates.get('a')).toEqual({ lat: 35, lon: 135 });
  expect(await coordinates.get('a')).toEqual({ lat: 35, lon: 135 });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(new Headers(init.headers).get('X-Goog-FieldMask')).toBe('location');
  expect(() => coordinates.get('b')).toThrow('approval budget exhausted');
});

it('reports the exact search ceiling and does not start an unapproved cache fill', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const cache: Geocache = { attribution: '© OpenStreetMap contributors', entries: {} };
  await expect(fillGeocache(cache, [{ name: 'Kyoto Tower', locale: 'en', anchor: { lat: 35, lon: 135 } }], 0)).rejects.toThrow('at most 2 Text Search Essentials (IDs Only)');
  expect(fetch).not.toHaveBeenCalled();
});

it('turns geocoder HTTP errors into a sanitized failure without response content', async () => {
  vi.stubEnv('GOOGLE_MAPS_API_KEY', 'unit-test');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('Google private content', { status: 429 })));
  await expect(new GoogleCoordinates(1).get('a')).rejects.toThrow('Geocoder request failed: HTTP 429');
});

it('stops a resumed fill at its remaining Google ceiling, including empty-result retries', async () => {
  vi.stubEnv('GOOGLE_MAPS_API_KEY', 'unit-test');
  const fetch = vi.fn(async () => Response.json({ places: [] }));
  vi.stubGlobal('fetch', fetch);
  const cache: Geocache = { attribution: '\u00a9 OpenStreetMap contributors', entries: {} };
  await expect(fillGeocache(cache, [{ name: 'Kyoto Tower', locale: 'en', anchor: { lat: 35, lon: 135 } }], 1)).rejects.toThrow('approval budget exhausted');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('retries a Wikidata 429 without repeating the Google search', async () => {
  vi.useFakeTimers();
  vi.stubEnv('GOOGLE_MAPS_API_KEY', 'unit-test');
  const calls = { google: 0, wikidata: 0 };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('places.googleapis.com')) {
      calls.google++;
      return Response.json({ places: [{ id: 'google-place' }] });
    }
    if (url.includes('wikidata.org')) {
      calls.wikidata++;
      return calls.wikidata === 1 ? new Response('', { status: 429 }) : Response.json({ query: { search: [] } });
    }
    return Response.json([]);
  }));
  const cache: Geocache = { attribution: '\u00a9 OpenStreetMap contributors', entries: {} };
  const filling = fillGeocache(cache, [{ name: 'Kyoto Tower', locale: 'en', anchor: { lat: 35, lon: 135 } }], 2);
  await vi.runAllTimersAsync();
  await filling;
  expect(calls).toEqual({ google: 1, wikidata: 2 });
  expect(Object.values(cache.entries)[0].placeId).toBe('google-place');
});

it('checkpoints a Google ID before an existence-service failure and resumes with zero Google approval', async () => {
  vi.useFakeTimers();
  vi.stubEnv('GOOGLE_MAPS_API_KEY', 'unit-test');
  const fetch = vi.fn(async (url: string) => url.includes('places.googleapis.com')
    ? Response.json({ places: [{ id: 'saved-id' }] }) : new Response('', { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  const cache: Geocache = { attribution: '\u00a9 OpenStreetMap contributors', entries: {} };
  const target = { name: 'Kyoto Tower', locale: 'en' as const, anchor: { lat: 35, lon: 135 } };
  const failure = expect(fillGeocache(cache, [target], 2)).rejects.toThrow('HTTP 503');
  await vi.runAllTimersAsync();
  await failure;
  expect(Object.values(cache.entries)[0]).toMatchObject({ placeId: 'saved-id', sourcesPending: true });
  expect(vi.mocked(writeFile).mock.calls.at(-1)?.[1]).toContain('saved-id');
  fetch.mockImplementation(async (url: string) => {
    expect(url).not.toContain('places.googleapis.com');
    return Response.json(url.includes('wikidata.org') ? { query: { search: [] } } : []);
  });
  const resumed = fillGeocache(cache, [target], 0);
  await vi.runAllTimersAsync();
  await resumed;
  expect(Object.values(cache.entries)[0].sourcesPending).toBeUndefined();
});

it('reports a Wikidata API error code when an HTTP 200 response contains an error envelope', async () => {
  vi.useFakeTimers();
  vi.stubEnv('GOOGLE_MAPS_API_KEY', 'unit-test');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('places.googleapis.com')
    ? Response.json({ places: [{ id: 'saved-id' }] })
    : Response.json({ error: { code: 'ratelimited', info: 'API response details' } })));
  const cache: Geocache = { attribution: '\u00a9 OpenStreetMap contributors', entries: {} };
  const failure = expect(fillGeocache(cache, [{ name: 'Kyoto Tower', locale: 'en', anchor: { lat: 35, lon: 135 } }], 2)).rejects.toThrow('Wikidata API error: ratelimited');
  await vi.runAllTimersAsync();
  await failure;
  expect(Object.values(cache.entries)[0].sourcesPending).toBe(true);
});

it('reports missing hotel geography as zero coverage, without fabricated zero-distance routes or Google calls', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const out = await turn(new FakeTripLlm(), initialState(0, 'en'), 'Hello');
  out.effect = 'itinerary';
  out.next.days = [{ title: 'Day 1', stayRef: null, stops: [{ name: 'Osaka Castle', note: null, time: null }] }];
  const scores = await gradeGeography(out, { tools: [], calls: [] }, { attribution: '© OpenStreetMap contributors', entries: {} }, new GoogleCoordinates(0), 'l3-en-family');
  expect(scores).toContainEqual({ name: 'geocode_coverage', value: 0 });
  expect(scores.some((s) => s.name === 'day_km_max')).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it('fills with IDs-only search, caches existence results, and never persists extra Google fields', async () => {
  vi.useFakeTimers();
  vi.stubEnv('GOOGLE_MAPS_API_KEY', 'unit-test');
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes('places.googleapis.com')) {
      expect(new Headers(init.headers).get('X-Goog-FieldMask')).toBe('places.id');
      return Response.json({ places: [{ id: 'google-place', displayName: { text: 'forbidden Google name' }, location: { latitude: 99, longitude: 99 } }] });
    }
    if (url.includes('wikidata.org')) return Response.json({ query: { search: [] } });
    expect(new Headers(init.headers).get('User-Agent')).toContain('HildaItineraryEval');
    return Response.json([{ place_id: 123, lat: '35', lon: '135' }]);
  });
  vi.stubGlobal('fetch', fetch);
  const cache: Geocache = { attribution: '© OpenStreetMap contributors', entries: {} };
  const filling = fillGeocache(cache, [{ name: 'Kyoto Tower', locale: 'en', anchor: { lat: 35, lon: 135 } }], 2);
  await vi.runAllTimersAsync();
  await filling;
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(cache)).not.toContain('forbidden');
  expect(JSON.stringify(cache)).not.toContain('99');
  expect(vi.mocked(writeFile).mock.calls.at(-1)?.[1]).toContain('google-place');
  await fillGeocache(cache, [{ name: 'Kyoto Tower', locale: 'en', anchor: { lat: 35, lon: 135 } }], 0);
  expect(fetch).toHaveBeenCalledTimes(3);
});
