import type { TripDay } from '../../src/trip/state.js';
import type { ExtractDaysEntry, Score } from '../schemas.js';
import { TRAVEL_LEG } from '../travel-leg.js';

export function gradeExtractDays(actual: TripDay[], expected: ExtractDaysEntry['expected']): Score[] {
  const count = Math.max(actual.length, expected.days.length);
  const positions = Array.from({ length: count }, (_, i) => ({ actual: actual[i], expected: expected.days[i] }));
  const f1 = positions.map(({ actual: day, expected: target }) => {
    if (!day || !target) return 0;
    const names = new Set(day.stops.map((stop) => normalizeName(stop.name)));
    const targets = new Set(target.stops.map(normalizeName));
    // "涩谷" and "涩谷十字路口" name the same stop; each label can be matched once.
    const unmatched = [...targets];
    const matched = [...names].filter((name) => {
      const exact = unmatched.indexOf(name);
      const i = exact >= 0 ? exact : unmatched.findIndex((t) => t.includes(name) || name.includes(t));
      if (i < 0) return false;
      unmatched.splice(i, 1);
      return true;
    }).length;
    return names.size + targets.size ? 2 * matched / (names.size + targets.size) : 1;
  });
  return [
    { name: 'day_count_exact', value: Number(actual.length === expected.days.length) },
    { name: 'stop_f1', value: count ? f1.reduce((sum, value) => sum + value, 0) / count : 1 },
    { name: 'stay_ref_acc', value: count ? positions.filter(({ actual: day, expected: target }) => day && target && day.stayRef === target.stayRef).length / count : 1 },
    { name: 'leg_as_stop', value: actual.flatMap((day) => day.stops).filter((stop) => TRAVEL_LEG.test(stop.name)).length },
  ];
}

function normalizeName(name: string): string {
  // Unicode punctuation covers CJK and mathematical brackets; repeat for nesting.
  const normalized = name.normalize('NFKC');
  const stripped = normalized.replace(/\p{Ps}[^\p{Ps}\p{Pe}]*\p{Pe}|<[^<>]*>/gu, '');
  return stripped !== normalized ? normalizeName(stripped) : stripped.replace(/\s/gu, '').toLowerCase();
}
