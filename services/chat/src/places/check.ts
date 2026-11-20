import type { Stop } from '../trip/itinerary.js';
import { aliasesOf, inSeason, normalize, seasonDay, type PlaceRecordInput, type Sourced } from './record.js';
import { holidays } from './records/holidays.js';

type Closure = PlaceRecordInput['closures'][number];
type Rail = NonNullable<PlaceRecordInput['access']>['rail'][number];
export type Finding = Sourced & { severity: 'caution' | 'conflict' } & (
  | { kind: 'before_opening'; opens: string }
  | { kind: 'past_closing'; closes: string; endsBy: 'stated' | 'next_stop' | 'visit_minutes' }
  | { kind: 'closed_day'; scope: Closure['scope'] }
  | { kind: 'works'; until: string; part: PlaceRecordInput['name'] | null }
  | { kind: 'wrong_rail'; stated: Rail; served: Rail[] }
);
export type StopCheck =
  | { status: 'unmatched'; reason: 'ambiguous' | 'no_match' }
  | { status: 'matched'; record: PlaceRecordInput; date: string | null; findings: Finding[] };

const railTerms: Record<Rail, RegExp> = {
  subway: /地[铁鐵]|地下鉄|\b(?:subway|metro)\b/i,
  jr: /\bJR\b|ＪＲ/i,
  private_rail: /私[铁鉄鐵]|\bprivate rail(?:way)?\b/i,
};
export const railName: Record<Rail, string> = { subway: 'subway', jr: 'JR', private_rail: 'private rail' };

export function dateOffset(date: string, offset: number) {
  const instant = Date.parse(date) + offset * 86_400_000;
  return Number.isFinite(instant) ? new Date(instant).toISOString().slice(0, 10) : null;
}

export function closureApplies(when: Closure['when'], date: string): boolean {
  const covered = (d: string) => holidays.coverage && holidays.coverage.from <= d && d <= holidays.coverage.until;
  switch (when.type) {
    case 'range': return when.from <= date && date <= when.until;
    case 'dates': return when.dates.includes(date);
    case 'holidays': return Boolean(covered(date)) && holidays.dates.includes(date);
    case 'weekly': {
      const weekday = new Date(date).getUTCDay();
      // Without holiday data for this date the shift cannot be judged, so the plain weekday rule applies.
      if (!when.holidayShift || !covered(date)) return when.days.includes(weekday);
      if (holidays.dates.includes(date)) return false;
      if (when.days.includes(weekday)) return true;
      // A holiday closure moves to the first subsequent non-holiday.
      for (let offset = 1; offset <= 7; offset++) {
        const previous = dateOffset(date, -offset);
        if (!previous || !covered(previous) || !holidays.dates.includes(previous)) return false;
        if (when.days.includes(new Date(previous).getUTCDay())) return true;
      }
      return false;
    }
  }
}
export function periodOn(periods: Extract<PlaceRecordInput['hours'], { type: 'schedule' }>['periods'], date: string) {
  const day = seasonDay(date.slice(5), periods);
  return periods.find((period) => inSeason(day, period));
}

const minutes = (clock: string) => Number(clock.split(':')[0]) * 60 + Number(clock.split(':')[1]);
function visitTime(time: string | null) {
  const match = /^(?:约\s*|approx\.?\s*|~\s*)?((?:[01]?\d|2[0-3]):[0-5]\d)(?:\s*[-–—~至到]\s*((?:[01]?\d|2[0-3]):[0-5]\d))?$/i.exec(time?.normalize('NFKC').trim() ?? '');
  return match && { start: minutes(match[1]), end: match[2] ? minutes(match[2]) : null };
}
function sourceOf({ source, quote, checkedOn }: Sourced): Sourced {
  return { source, quote, checkedOn };
}

function findingsFor(record: PlaceRecordInput, stop: Stop, next: Stop | undefined, date: string | null) {
  const findings: Finding[] = [];
  const { access, hours } = record;
  if (access && stop.note) {
    for (const stated of Object.keys(railTerms) as Rail[]) {
      if (railTerms[stated].test(stop.note) && !access.rail.includes(stated))
        findings.push({ ...sourceOf(access), severity: 'conflict', kind: 'wrong_rail', stated, served: access.rail });
    }
  }
  if (!date) return findings;
  for (const closure of record.closures) {
    const { scope, when } = closure;
    if (!closureApplies(when, date)) continue;
    const mentioned = scope.type === 'part' && [...Object.values(scope.name), ...scope.aliases].some((alias) =>
      [stop.name, stop.note ?? ''].some((text) => normalize(text).includes(normalize(alias))));
    const severity = scope.type === 'whole' || mentioned ? 'conflict' : 'caution';
    findings.push(when.type === 'range' && scope.type !== 'most_shops'
      ? { ...sourceOf(closure), severity, kind: 'works', until: when.until, part: scope.type === 'part' ? scope.name : null }
      : { ...sourceOf(closure), severity, kind: 'closed_day', scope });
  }
  const time = visitTime(stop.time);
  if (!time || hours.type !== 'schedule') return findings;
  const period = periodOn(hours.periods, date);
  if (!period) return findings;
  if (time.start < minutes(period.open)) findings.push({ ...sourceOf(hours), severity: 'conflict', kind: 'before_opening', opens: period.open });
  const nextStart = visitTime(next?.time ?? null)?.start;
  // Legs carry no durations (the prompt forbids them), so a duration in the note is the time spent at the stop.
  const stay = /(?:approx\.?|约)\s*(\d+(?:\.\d+)?)\s*(h\b|hours?|hrs?|小时|min\b|mins?|minutes?|分钟)/i.exec(stop.note?.normalize('NFKC') ?? '');
  const end = time.end !== null
    ? { minutes: time.end < time.start ? time.end + 24 * 60 : time.end, by: 'stated' as const }
    : stay
      ? { minutes: time.start + Math.round(Number(stay[1]) * (/^(?:h|小)/i.test(stay[2]) ? 60 : 1)), by: 'stated' as const }
    // The gap to the next stop includes travel, so it only shortens the estimated visit, never lengthens it.
    : nextStart !== undefined && nextStart >= time.start && nextStart < time.start + record.visitMinutes
      ? { minutes: nextStart, by: 'next_stop' as const }
      : { minutes: time.start + record.visitMinutes, by: 'visit_minutes' as const };
  if (time.start >= minutes(period.close) || end.minutes > minutes(period.close))
    findings.push({ ...sourceOf(hours), severity: 'conflict', kind: 'past_closing', closes: period.close, endsBy: end.by });
  return findings;
}

export function checkStop(records: PlaceRecordInput[], stop: Stop, next: Stop | undefined, date: string | null): StopCheck {
  const key = normalize(stop.name);
  const ranked = records.map((record) => ({
    record, score: Math.max(0, ...aliasesOf(record).filter((alias) => key.includes(alias)).map((alias) => alias.length)),
  }));
  const best = Math.max(0, ...ranked.map(({ score }) => score));
  if (!best) return { status: 'unmatched', reason: 'no_match' };
  const matches = ranked.filter(({ score }) => score === best);
  if (matches.length > 1) return { status: 'unmatched', reason: 'ambiguous' };
  const { record } = matches[0];
  return { status: 'matched', record, date, findings: findingsFor(record, stop, next, date) };
}
