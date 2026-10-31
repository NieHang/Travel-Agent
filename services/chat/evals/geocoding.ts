import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { TurnOutput } from './turn.js';
import type { Cassette } from './replay/cassette.js';
import { distanceKm, routeMetrics, type Point } from './evaluators/geography.js';
import type { Score } from './schemas.js';

const PointSchema = z.object({ lat: z.number(), lon: z.number() });
const CandidateSchema = PointSchema.extend({ id: z.string() });
const CacheEntrySchema = z.object({
  name: z.string(), locale: z.enum(['zh', 'en']), anchor: PointSchema,
  placeId: z.string().nullable(), wikidata: z.array(CandidateSchema), nominatim: z.array(CandidateSchema),
  sourcesPending: z.literal(true).optional(),
}).strict();
const CacheSchema = z.object({ attribution: z.literal('© OpenStreetMap contributors'), entries: z.record(CacheEntrySchema) }).strict();
export type Geocache = z.infer<typeof CacheSchema>;
export type GeoTarget = Pick<z.infer<typeof CacheEntrySchema>, 'name' | 'locale' | 'anchor'>;
const cacheUrl = new URL('./geocache.json', import.meta.url);

export async function readGeocache(): Promise<Geocache> {
  return CacheSchema.parse(JSON.parse(await readFile(cacheUrl, 'utf8')));
}

export function geoKey(t: GeoTarget): string {
  return `${t.locale}|${t.name}|${t.anchor.lat.toFixed(1)},${t.anchor.lon.toFixed(1)}`;
}

export function geographyDays(out: TurnOutput, cassette: Cassette, scenarioId = ''): { anchor: Point | null; targets: GeoTarget[] }[] {
  const hotels: { id: string; name: string; point: Point }[] = [];
  const HotelSchema = z.object({ hotelId: z.union([z.string(), z.number()]), name: z.string(), latitude: z.number(), longitude: z.number() });
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const parsed = HotelSchema.safeParse(value);
    if (parsed.success) hotels.push({ id: String(parsed.data.hotelId), name: parsed.data.name, point: { lat: parsed.data.latitude, lon: parsed.data.longitude } });
    for (const child of Object.values(value)) visit(child);
  };
  for (const call of cassette.calls) {
    if (call.result.isError) continue;
    const content: unknown = JSON.parse(call.result.content);
    visit(content);
  }
  return out.next.days.map((day, index) => {
    const ref = day.stayRef ?? out.next.days.slice(0, index).findLast((d) => d.stayRef)?.stayRef;
    const stay = out.next.stays?.items.find((h) => h.ref === ref);
    const found = hotels.find((h) => h.id === stay?.id || h.name === stay?.title.original);
    // Fixed non-Google bases for the two cases intentionally having no hotel result.
    const noHotelBase = scenarioId.endsWith('day-trip') ? { lat: 34.6851, lon: 135.8048 }
      : scenarioId.endsWith('lodging-booked') ? { lat: 34.9858, lon: 135.7588 } : undefined;
    const anchor = found?.point ?? noHotelBase;
    if (!anchor) return { anchor: null, targets: [] };
    return { anchor, targets: day.stops.map((stop) => ({ name: stop.name, locale: out.next.locale, anchor })) };
  });
}

// Explicit request budgets are passed only after the operator approves the count and SKU.
export class GoogleCoordinates {
  private used = 0;
  private readonly points = new Map<string, Promise<Point>>();
  constructor(private readonly approvedDetails: number) {}

  get(placeId: string): Promise<Point> {
    const cached = this.points.get(placeId);
    if (cached) return cached;
    if (this.used >= this.approvedDetails) throw new Error('Google Place Details approval budget exhausted; ask for the next request count and SKU');
    this.used++;
    const pending = request(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, z.object({ location: z.object({ latitude: z.number(), longitude: z.number() }) }), {
      headers: { 'X-Goog-Api-Key': requireGoogleKey(), 'X-Goog-FieldMask': 'location' },
    }).then(({ location }) => ({ lat: location.latitude, lon: location.longitude }));
    this.points.set(placeId, pending);
    return pending;
  }
}

export async function gradeGeography(out: TurnOutput, cassette: Cassette, cache: Geocache, google: GoogleCoordinates, scenarioId = ''): Promise<Score[]> {
  if (out.effect !== 'itinerary') return [];
  const days = geographyDays(out, cassette, scenarioId);
  const routes: ReturnType<typeof routeMetrics>[] = [];
  const unverified: string[] = [];
  const conflicts: string[] = [];
  let placed = 0;
  let completeDays = 0;
  for (const day of days) {
    if (!day.anchor) continue;
    const points: Point[] = [];
    for (const target of day.targets) {
      const cached = cache.entries[geoKey(target)];
      if (!cached) throw new Error(`Geocache miss: ${geoKey(target)}; prepare cache with separate Google approval`);
      if (cached.sourcesPending) throw new Error('Geocache existence checks are incomplete; resume cache fill before scoring');
      if (!cached.wikidata.length && !cached.nominatim.length) unverified.push(target.name);
      if (!cached.placeId) continue;
      const point = await google.get(cached.placeId);
      points.push(point);
      placed++;
      if (cached.wikidata[0] && distanceKm(point, cached.wikidata[0]) > 3) conflicts.push(target.name);
    }
    if (points.length === day.targets.length) completeDays++;
    if (points.length || !day.targets.length) routes.push(routeMetrics(day.anchor, points));
  }
  const total = out.next.days.reduce((sum, d) => sum + d.stops.length, 0);
  return [
    ...(routes.length ? [
      { name: 'day_km_max', value: Math.max(...routes.map((r) => r.km)) },
      { name: 'route_detour', value: Math.max(...routes.map((r) => r.detour)) },
      { name: 'hotel_far', value: Math.max(...routes.map((r) => r.far)) },
    ] : []),
    { name: 'stop_unverified', value: unverified.length, comment: unverified.join(', ') },
    { name: 'geocode_conflict', value: conflicts.length, comment: conflicts.join(', ') },
    { name: 'geocode_coverage', value: total ? placed / total : 1 },
    { name: 'geography_day_coverage', value: days.length ? completeDays / days.length : 0 },
  ];
}

export async function fillGeocache(cache: Geocache, targets: GeoTarget[], approvedSearches: number): Promise<void> {
  const pending = [...new Map(targets.filter((t) => !cache.entries[geoKey(t)] || cache.entries[geoKey(t)].sourcesPending).map((t) => [geoKey(t), t])).values()];
  const missing = pending.filter((t) => !cache.entries[geoKey(t)]);
  if (!Number.isSafeInteger(approvedSearches) || approvedSearches < 0 || (missing.length && !approvedSearches) || approvedSearches > missing.length * 2) throw new Error(`Approval required: at most ${missing.length * 2} Text Search Essentials (IDs Only) requests (one initial + one empty-result retry per ${missing.length} stops), 0 Place Details`);
  const budget = { used: 0 };
  for (const t of pending) {
    const b = bounds(t.anchor);
    const search = () => {
      if (budget.used >= approvedSearches) throw new Error('Google Text Search approval budget exhausted');
      budget.used++;
      console.log(`Text Search Essentials (IDs Only) request ${budget.used}/${approvedSearches}; places.id`);
      return request('https://places.googleapis.com/v1/places:searchText', z.object({ places: z.array(z.object({ id: z.string() })).optional() }), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': requireGoogleKey(), 'X-Goog-FieldMask': 'places.id' },
      body: JSON.stringify({ textQuery: `${t.name} Japan`, regionCode: 'JP', languageCode: t.locale, pageSize: 1, locationRestriction: { rectangle: { low: { latitude: b.south, longitude: b.west }, high: { latitude: b.north, longitude: b.east } } } }),
      });
    };
    if (!cache.entries[geoKey(t)]) {
      const first = await search();
      const found = first.places?.length ? first : await search();
      cache.entries[geoKey(t)] = { ...t, placeId: found.places?.[0]?.id ?? null, wikidata: [], nominatim: [], sourcesPending: true };
      await writeFile(cacheUrl, JSON.stringify(cache, null, 2) + '\n');
    }
    const wikidata = await queryWikidata(t);
    const nominatim = await queryNominatim(t);
    cache.entries[geoKey(t)] = { ...t, placeId: cache.entries[geoKey(t)].placeId, wikidata, nominatim };
    await writeFile(cacheUrl, JSON.stringify(cache, null, 2) + '\n');
    console.log(`Cached ${geoKey(t)}`);
  }
}

function bounds(p: Point) {
  const dx = 80 / (111.195 * Math.cos(p.lat * Math.PI / 180));
  return { north: p.lat + 80 / 111.195, south: p.lat - 80 / 111.195, west: p.lon - dx, east: p.lon + dx };
}

async function queryNominatim(t: GeoTarget) {
  const b = bounds(t.anchor);
  // Cache construction is sequential; wait before every request, including failed requests.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const rows = await request(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=jp&bounded=1&viewbox=${b.west},${b.north},${b.east},${b.south}&q=${encodeURIComponent(t.name)}`, z.array(z.object({ place_id: z.number(), lat: z.coerce.number(), lon: z.coerce.number() })));
  return rows.map((r) => ({ id: String(r.place_id), lat: r.lat, lon: r.lon })).filter((r) => distanceKm(t.anchor, r) <= 80);
}

async function queryWikidata(t: GeoTarget) {
  const search = `${t.name} nearcoord:80km,${t.anchor.lat.toFixed(3)},${t.anchor.lon.toFixed(3)}`;
  const result = await request(`https://www.wikidata.org/w/api.php?action=query&list=search&srlimit=5&format=json&srsearch=${encodeURIComponent(search)}`, z.object({ query: z.object({ search: z.array(z.object({ title: z.string() })) }) }));
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const ids = result.query.search.map((r) => r.title);
  if (!ids.length) return [];
  const data = await request(`https://www.wikidata.org/w/api.php?action=wbgetentities&props=claims&format=json&ids=${ids.join('|')}`, z.object({ entities: z.record(z.object({ claims: z.object({ P625: z.array(z.object({ mainsnak: z.object({ datavalue: z.object({ value: z.object({ latitude: z.number(), longitude: z.number() }) }).optional() }) })).optional() }).optional() })) }));
  return ids.flatMap((id) => {
    const p = data.entities[id]?.claims?.P625?.[0]?.mainsnak.datavalue?.value;
    return p ? [{ id, lat: p.latitude, lon: p.longitude }] : [];
  }).filter((p) => distanceKm(t.anchor, p) <= 80);
}

function requireGoogleKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY is required');
  return key;
}

async function request<T>(url: string, schema: z.ZodType<T>, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('User-Agent', 'HildaItineraryEval/1.0 (Japan itinerary regression evaluation)');
  const wikidata = new URL(url).hostname === 'www.wikidata.org';
  for (const attempt of wikidata ? [0, 1, 2] : [0]) {
    if (wikidata) await new Promise((resolve) => setTimeout(resolve, attempt ? attempt * 15_000 : 3000));
    const response = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(30_000) });
    if (wikidata && response.status === 429 && attempt < 2) {
      await response.body?.cancel();
      console.log('Wikidata rate limited; waiting before retry (no Google retry)');
      continue;
    }
    // Do not include Google response bodies or request URLs/keys in errors or traces.
    if (!response.ok) throw new Error(`Geocoder request failed: HTTP ${response.status}`);
    const payload: unknown = await response.json();
    if (wikidata) {
      const error = z.object({ error: z.object({ code: z.string() }) }).safeParse(payload);
      if (error.success) throw new Error(`Wikidata API error: ${error.data.error.code}`);
    }
    return schema.parse(payload);
  }
  throw new Error('Wikidata retry limit reached');
}
