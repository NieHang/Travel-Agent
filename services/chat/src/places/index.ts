import type { Requirements } from '@autix/contracts';
import type { TripState } from '../trip/state.js';
import { checkStop, closureApplies, dateOffset, periodOn, railName, type StopCheck } from './check.js';
import { lintRecords } from './lint.js';
import { librarySchema, type PlaceRecordInput } from './record.js';
import { kyoto } from './records/kyoto.js';
import { nara } from './records/nara.js';
import { osaka } from './records/osaka.js';
import { tokyo } from './records/tokyo.js';

export type { Finding, StopCheck } from './check.js';

export const PLACE_POLICY: { unmatched: 'show' | 'hide'; staleAfterDays: number } = { unmatched: 'hide', staleAfterDays: 180 };
const records = librarySchema.parse([...kyoto, ...nara, ...osaka, ...tokyo]);
export const lintPlaces = (today: string) => lintRecords(records, today, PLACE_POLICY.staleAfterDays);
export const unpinnedPlaces = () => records.flatMap(({ slug, pin }) => pin.status === 'unpinned' ? [{ slug, query: pin.query }] : []);

export function levelOf(check: StopCheck) {
  if (check.status === 'unmatched') return 'unverified';
  if (check.findings.some((f) => f.severity === 'conflict')) return 'conflict';
  return check.findings.length ? 'caution' : 'ok';
}

export function checkPlan({ days, requirements }: Pick<TripState, 'days' | 'requirements'>) {
  const counts = { stops: 0, matched: 0, conflict: 0, caution: 0, unmatched: 0 };
  const checked = days.map(({ stops }, i) => {
    const date = requirements.departureDate ? dateOffset(requirements.departureDate, i) : null;
    return stops.map((stop, j) => {
      const result = checkStop(records, stop, stops[j + 1], date);
      counts.stops++;
      counts[result.status]++;
      const level = levelOf(result);
      if (level === 'conflict' || level === 'caution') counts[level]++;
      return result;
    });
  });
  return { days: checked, counts };
}

const cities = { kyoto: /\bkyoto\b|京都/i, osaka: /\bosaka\b|大阪/i, nara: /\bnara\b|奈良/i, tokyo: /\btokyo\b|东京|東京/i };

function factsOn(record: PlaceRecordInput, date: string | null) {
  const facts: string[] = [];
  if (record.hours.type === 'always_open') facts.push('open 24 hours');
  if (date && record.hours.type === 'schedule') {
    const period = periodOn(record.hours.periods, date);
    if (period) facts.push('open ' + period.open + '–' + period.close);
  }
  for (const { when, scope } of record.closures) {
    if (!date || !closureApplies(when, date)) continue;
    const subject = scope.type === 'part' ? scope.name.en + ' ' : scope.type === 'most_shops' ? 'most shops ' : '';
    facts.push(subject + (when.type === 'range' ? 'closed until ' + when.until : 'closed'));
  }
  return facts;
}

export function placeFacts({ destination, departureDate, returnDate }: Requirements, _locale: 'en'): string[] {
  const selected = records.filter((record) => cities[record.city].test(destination ?? ''));
  if (!selected.length) return [];
  const dates: string[] = [];
  const lastDate = returnDate ?? departureDate;
  if (departureDate && lastDate) {
    for (let instant = Date.parse(departureDate); instant <= Date.parse(lastDate); instant += 86_400_000) {
      dates.push(new Date(instant).toISOString().slice(0, 10));
    }
  }
  return selected.flatMap((record) => {
    const byFact = new Map<string, string[]>();
    for (const date of dates) {
      for (const fact of factsOn(record, date)) {
        const applicable = byFact.get(fact);
        if (applicable) applicable.push(date);
        else byFact.set(fact, [date]);
      }
    }
    const facts = dates.length ? [...byFact].map(([fact, applicable]) =>
      fact + (applicable.length === dates.length ? ' on your dates' : ' on ' + applicable.join(', '))) : factsOn(record, null);
    if (record.access) facts.push(record.access.rail.length ? 'rail access: ' + record.access.rail.map((r) => railName[r]).join(', ') : 'no rail access');
    return facts.length ? [record.name.en + ' (' + record.name.zh + '): ' + facts.join('; ')] : [];
  });
}
