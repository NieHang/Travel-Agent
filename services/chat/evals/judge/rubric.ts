import { createHash } from 'node:crypto';
import type { ItineraryEntry } from '../schemas.js';

// Questions for subjective quality that the code checks cannot answer. Each is pass, fail or n/a, and
// length earns no credit. Changing a question changes RUBRIC_HASH, so old verdicts no longer import.
const ITINERARY = {
  fits_party: 'Do the activities and pace suit the stated travelers and trip type (children, elderly, couple, solo, budget)?',
  realistic_days: 'Is every day doable: the time given fits the places, the order avoids backtracking, and travel between them is plausible? Check opening hours, closing days and travel times with a web search, never from memory, and cite the source.',
  hotel_fit: 'Does the recommended hotel suit the plan: convenient for the days\' areas, within any budget, right for the party (a room the whole party fits, family facilities for children)? n/a when no hotel should be recommended.',
  no_unsupported_claims: 'Are specific facts (prices, distances, room types, opening hours, ticket and reservation rules, durations) right? A hotel fact must match its shown result. Check every other fact with a web search, never from memory, and cite the source: a fact the search shows wrong fails even if marked to check, and one it cannot confirm fails unless marked as an estimate or to be checked.',
  useful_content: 'Does each day say what to do and why it is worth it, without filler or repetition?',
  language_quality: 'Is it natural in the user\'s language, with place names as original plus translation where needed, and clean formatting? Leaked narration (e.g. "I\'ll search…"), duplicated names and internal rule text fail.',
} as const;
const ANSWER = {
  answers_question: 'Does the reply directly answer what the user asked?',
  no_unsupported_claims: ITINERARY.no_unsupported_claims,
  language_quality: ITINERARY.language_quality,
} as const;

export const RUBRIC_HASH = createHash('sha256').update(JSON.stringify({ ITINERARY, ANSWER })).digest('hex').slice(0, 8);

/** The criteria for one item: the general questions for its effect, then the item's own `must` lines. Refusals and clarifications are fixed server copy, so they get none. */
export function criteriaFor(entry: ItineraryEntry): { name: string; question: string }[] {
  if (!entry.expected.effect) return [];
  const general = entry.expected.effect === 'itinerary' ? ITINERARY : ANSWER;
  return [
    ...Object.entries(general).map(([name, question]) => ({ name, question })),
    ...entry.must.map((question, i) => ({ name: `must_${i + 1}`, question })),
  ];
}
