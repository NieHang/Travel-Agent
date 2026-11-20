import { checkPlan } from '../../src/places/index.js';
import type { ItineraryEntry, Score } from '../schemas.js';
import type { TurnOutput } from '../turn.js';

// A rate is left out when it has nothing to measure, so refusals and chat turns do not pull the suite means to zero
// and "no stop matched" cannot read as "no conflicts".
export function gradePlaces(_item: ItineraryEntry, out: Pick<TurnOutput, 'next' | 'effect'>): Score[] {
  if (out.effect !== 'itinerary') return [];
  const { matched, conflict, caution, unmatched, stops } = checkPlan(out.next).counts;
  return [
    ...(matched ? [{ name: 'place_conflict_rate', value: conflict / matched }, { name: 'place_caution_rate', value: caution / matched }] : []),
    ...(stops ? [{ name: 'place_unverified_share', value: unmatched / stops }] : []),
  ];
}
