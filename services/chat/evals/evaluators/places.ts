import { checkPlan } from '../../src/places/index.js';
import type { ItineraryEntry, Score } from '../schemas.js';
import type { TurnOutput } from '../turn.js';

export function gradePlaces(_item: ItineraryEntry, out: Pick<TurnOutput, 'next'>): Score[] {
  const { matched, conflict, caution, unmatched, stops } = checkPlan(out.next).counts;
  return [
    { name: 'place_conflict_rate', value: matched ? conflict / matched : 0 },
    { name: 'place_caution_rate', value: matched ? caution / matched : 0 },
    { name: 'place_unverified_share', value: stops ? unmatched / stops : 0 },
  ];
}
