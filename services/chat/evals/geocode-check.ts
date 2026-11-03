// Reruns the 2026-10-30 geocoder accuracy check (eval plan, P3) against the hand labels in geocode-labels.json.
// Each stop is searched within its trip's region, as when it was labeled; the P3 grader will search around each
// night's hotel instead. A result that differs from the labeled one is listed for a person to relabel.
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

config({ path: fileURLToPath(new URL('../.env.eval', import.meta.url)), override: true });

const SOURCES = ['nominatim', 'wikidata', 'google'] as const;
type Source = (typeof SOURCES)[number];
const UA = 'HildaEvalGeocodeCheck/0.2 (regression check of hand-labeled itinerary stops)';
// A Nominatim or Wikidata candidate farther than this from every point of the trip's region does not count as found.
const RADIUS_KM = 80;

const RegionSchema = z.enum(['kanto', 'kansai', 'hokkaido']);
const POINTS: Record<z.infer<typeof RegionSchema>, [number, number][]> = {
  kanto: [[35.6812, 139.7671], [35.2324, 139.1069], [35.3192, 139.5467]], // Tokyo, Hakone, Kamakura
  kansai: [[35.0116, 135.7681], [34.6937, 135.5023], [34.6851, 135.8048]], // Kyoto, Osaka, Nara
  hokkaido: [[43.0618, 141.3545], [43.1907, 140.9947]], // Sapporo, Otaru
};

const LabeledSchema = z.object({
  // correct / near / wrong / missing for real stops; none / matched for made-up ones.
  label: z.enum(['correct', 'near', 'wrong', 'missing', 'none', 'matched']),
  // What the source returned: Nominatim's name, a Wikidata item id or a Google place id; absent when nothing was found.
  result: z.string().optional(),
}).strict();
// A list per source, because the same search can return different results between runs (Google especially).
const LabelsSchema = z.array(LabeledSchema).min(1);
const StopSchema = z.object({
  name: z.string().min(1), locale: z.enum(['zh', 'en']), regions: z.array(RegionSchema).min(1), invented: z.boolean(),
  nominatim: LabelsSchema, wikidata: LabelsSchema, google: LabelsSchema,
}).strict();
type Stop = z.infer<typeof StopSchema>;
type Place = { about: string; lat: number; lon: number };
type Candidate = Place & { result: string };
// describe() says what a result is, for a person labeling it; for Google it is a billed lookup.
type Found = { result: string; describe: () => Promise<string> };

const NominatimSchema = z.array(z.object({ name: z.string(), display_name: z.string(), lat: z.coerce.number(), lon: z.coerce.number() }));
const WikidataSearchSchema = z.object({
  query: z.object({ search: z.array(z.object({ title: z.string() })) }).optional(),
  error: z.object({ info: z.string() }).optional(),
});
const TextSchema = z.record(z.string(), z.object({ value: z.string() }));
const WikidataEntitiesSchema = z.object({
  entities: z.record(z.string(), z.object({
    labels: TextSchema.optional(),
    descriptions: TextSchema.optional(),
    claims: z.object({
      P625: z.array(z.object({ mainsnak: z.object({ datavalue: z.object({ value: z.object({ latitude: z.number(), longitude: z.number() }) }).optional() }) })).optional(),
    }).optional(),
  })),
});
const GoogleSearchSchema = z.object({ places: z.array(z.object({ id: z.string() })).optional() });
const GoogleDetailsSchema = z.object({
  displayName: z.object({ text: z.string() }).optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }),
});

try {
  await main();
} catch (error) {
  console.error('FAIL geocode check:', error);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const stops = z.array(StopSchema).parse(JSON.parse(readFileSync(new URL('./geocode-labels.json', import.meta.url), 'utf8')));
  const args = process.argv.slice(2);
  for (const source of args.length ? z.array(z.enum(SOURCES)).parse(args) : SOURCES) await check(source, stops);
}

async function check(source: Source, stops: Stop[]): Promise<void> {
  const key = source === 'google' ? requireGoogleKey() : '';
  const kept: { stop: Stop; label: z.infer<typeof LabeledSchema>['label'] }[] = [];
  const changed: string[] = [];
  const errors: string[] = [];
  for (const [index, stop] of stops.entries()) {
    const where = `${stop.locale}|${stop.name}|${stop.regions.join('+')}`;
    try {
      const found = source === 'google' ? await google(stop, key)
        : inRegion(stop, source === 'nominatim' ? await nominatim(stop) : await wikidata(stop));
      const labeled = stop[source].find((l) => l.result === found?.result);
      if (labeled) kept.push({ stop, label: labeled.label });
      else changed.push(`${where}: now ${found ? `${found.result} ${await found.describe()}` : 'nothing'}`);
    } catch (error) {
      errors.push(`${where}: ${(error as Error).message}`);
    }
    if ((index + 1) % 25 === 0) console.log(`${source}: ${index + 1}/${stops.length}`);
  }

  const isReal = (locale?: Stop['locale']) => (stop: Stop) => !stop.invented && (!locale || stop.locale === locale);
  const isInvented = (stop: Stop) => stop.invented;
  // Counts only stops whose result has a label; the rest are listed as changed.
  const count = (test: (stop: Stop) => boolean, labels: string[]) => kept.filter((k) => test(k.stop) && labels.includes(k.label)).length;
  const total = (test: (stop: Stop) => boolean) => stops.filter(test).length;
  console.log([
    `${source}: en correct ${count(isReal('en'), ['correct', 'near'])}/${total(isReal('en'))}`,
    `zh correct ${count(isReal('zh'), ['correct', 'near'])}/${total(isReal('zh'))}`,
    `wrong ${count(isReal(), ['wrong'])}`,
    `not found ${count(isReal(), ['missing'])}`,
    `made-up matched ${count(isInvented, ['matched'])}/${total(isInvented)}`,
    `changed ${changed.length}`,
    `errors ${errors.length}`,
  ].join(' · '));
  for (const line of changed) console.log(`  changed ${line}`);
  for (const line of errors) console.log(`  error ${line}`);
  if (errors.length) process.exitCode = 1;
}

async function nominatim(stop: Stop): Promise<Candidate[]> {
  const b = box(stop);
  const rows = await getJson(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=jp&accept-language=ja,en&bounded=1&viewbox=${b.west},${b.north},${b.east},${b.south}&q=${encodeURIComponent(stop.name)}`,
    NominatimSchema,
  );
  // Nominatim's usage policy allows one request per second.
  await sleep(1100);
  return rows.map((r) => ({ result: r.name || r.display_name.split(',')[0], about: r.display_name, lat: r.lat, lon: r.lon }));
}

async function wikidata(stop: Stop): Promise<Candidate[]> {
  const b = box(stop);
  const query = `${stop.name} nearcoord:${b.radiusKm}km,${b.center[0].toFixed(3)},${b.center[1].toFixed(3)}`;
  const searched = await getJson(
    `https://www.wikidata.org/w/api.php?action=query&list=search&srlimit=5&format=json&srsearch=${encodeURIComponent(query)}`,
    WikidataSearchSchema,
  );
  // A failed search still answers 200, with an error body instead of a query.
  if (!searched.query) throw new Error(`search error: ${searched.error?.info ?? 'no query in response'}`);
  await sleep(1000);
  const ids = searched.query.search.map((s) => s.title);
  if (ids.length === 0) return [];
  const { entities } = await getJson(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&props=claims|labels|descriptions&languages=ja|en|zh&format=json&ids=${ids.join('|')}`,
    WikidataEntitiesSchema,
  );
  await sleep(200);
  return ids.flatMap((id) => {
    const entity = entities[id];
    const coord = entity?.claims?.P625?.[0]?.mainsnak.datavalue?.value;
    if (!coord) return [];
    const label = entity.labels?.ja?.value ?? entity.labels?.en?.value ?? entity.labels?.zh?.value ?? id;
    const description = entity.descriptions?.en?.value ?? entity.descriptions?.ja?.value;
    return [{ result: id, about: description ? `${label} | ${description}` : label, lat: coord.latitude, lon: coord.longitude }];
  });
}

// Nominatim and Wikidata return coordinates with every candidate, so the answer is the first one near the trip's cities.
function inRegion(stop: Stop, candidates: Candidate[]): Found | undefined {
  const found = candidates.find((c) => kmFromRegions(stop, c) <= RADIUS_KM);
  return found && { result: found.result, describe: () => Promise.resolve(located(stop, found)) };
}

// Asking for place IDs only keeps the search on Text Search Essentials (IDs Only), which Google does not charge for;
// its top result in the region box is the answer. Only an unlabeled ID is looked up, with Place Details Pro
// (displayName), so a person can label it. Google's terms allow storing place IDs only: names and coordinates are
// printed, never written.
async function google(stop: Stop, key: string): Promise<Found | undefined> {
  const b = box(stop);
  const { places = [] } = await getJson('https://places.googleapis.com/v1/places:searchText', GoogleSearchSchema, {
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id' },
    body: JSON.stringify({
      textQuery: stop.name, regionCode: 'JP', languageCode: 'ja', pageSize: 1,
      locationRestriction: { rectangle: { low: { latitude: b.south, longitude: b.west }, high: { latitude: b.north, longitude: b.east } } },
    }),
  });
  const id = places[0]?.id;
  if (!id) return undefined;
  return {
    result: id,
    describe: async () => {
      const place = await getJson(`https://places.googleapis.com/v1/places/${id}?languageCode=ja`, GoogleDetailsSchema, {
        headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'displayName,location' },
      });
      return located(stop, { about: place.displayName?.text ?? '', lat: place.location.latitude, lon: place.location.longitude });
    },
  };
}

function located(stop: Stop, place: Place): string {
  return `${place.about}, ${Math.round(kmFromRegions(stop, place))} km from the region`;
}

function requireGoogleKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('Set GOOGLE_MAPS_API_KEY in .env.eval to check Google.');
  return key;
}

async function getJson<T>(url: string, schema: z.ZodType<T>, init: { headers?: Record<string, string>; body?: string } = {}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { method: init.body ? 'POST' : 'GET', headers: { 'User-Agent': UA, ...init.headers }, body: init.body })
      .catch((error: Error) => error);
    if (!(res instanceof Error) && res.ok) return schema.parse(await res.json());
    if (attempt === 5) throw new Error(res instanceof Error ? res.message : `${res.status} ${(await res.text()).slice(0, 200)}`);
    // Wikidata's search answers bursts with 429s; wait at least as long as Retry-After asks.
    const retryAfter = res instanceof Error ? 0 : Number(res.headers.get('retry-after') ?? 0);
    await sleep(Math.max(retryAfter * 1000, (res instanceof Error || res.status !== 429 ? 3000 : 20000) * attempt));
  }
}

// The region's points, padded by 0.7° (about 70 km), as a box and as a circle around its center.
function box(stop: Stop) {
  const points = stop.regions.flatMap((r) => POINTS[r]);
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  const [south, north, west, east] = [Math.min(...lats) - 0.7, Math.max(...lats) + 0.7, Math.min(...lons) - 0.7, Math.max(...lons) + 0.7];
  const center: [number, number] = [(south + north) / 2, (west + east) / 2];
  return { south, north, west, east, center, radiusKm: Math.ceil(km(center, [north, east])) };
}

function kmFromRegions(stop: Stop, place: Place): number {
  return Math.min(...stop.regions.flatMap((r) => POINTS[r]).map((p) => km(p, [place.lat, place.lon])));
}

function km(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((b[0] - a[0]) * rad) / 2) ** 2
    + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(((b[1] - a[1]) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
