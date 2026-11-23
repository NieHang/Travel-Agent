import { z } from 'zod';
import { RequirementsSchema, TripTypeSchema, type Command, type Requirements } from '@autix/contracts';
import { ClarifySchema, REQUIRED, type Stage, type TripState } from './state.js';
import { nightsOf, segments, splice } from './itinerary.js';

/** Structured output of llm.classify; strict mode needs every key present and nullable. */
export const ClassifiedSchema = z
  .object({
    intent: z.enum(['plan', 'revise', 'chat']),
    locale: z.enum(['zh', 'en']),
    patch: z
      .object({
        destination: z.string().nullable(),
        tripType: TripTypeSchema.nullable(),
        departureDate: z.string().nullable(),
        returnDate: z.string().nullable(),
        travelers: z.number().nullable(),
        preferences: z.string().nullable(),
        budget: z.number().nullable(),
        budgetCurrency: z.string().nullable(),
      })
      .strict(),
    clarify: ClarifySchema.nullable(),
    /** For intent "revise": which parts of the current draft the message is about, as the user numbers them. */
    revise: z
      .object({
        days: z.array(z.number().int()),
        hotel: z.boolean(),
        hotelDays: z.array(z.number().int()),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type Classified = z.infer<typeof ClassifiedSchema>;

export const PlaceSchema = z.object({
  japan: z.string().max(200).nullable(),
  outside: z.array(z.string().max(200)),
}).strict();
export type Place = z.infer<typeof PlaceSchema>;

/** The destination locate() must check before this turn: a new one from the command, or a stored one saved before the Japan check. */
export function uncheckedDestination(state: TripState, command: Command, classified?: Classified): string | null {
  const given = command.type === 'message' && classified && classified.intent !== 'chat'
    ? classified.patch.destination
    : command.type === 'set_destination'
      ? command.value
      : command.type === 'submit_requirements'
        ? command.values.destination
        : undefined;
  const destination = given?.trim() || state.requirements.destination?.trim();
  return !destination || destination === state.checkedDestination ? null : destination;
}

/** What a revise may touch: 0-based day indices, and nights (night n is the night after day n + 1). */
export type EditTarget = { days: number[]; nights: number[] };

export type Effect = { type: 'answer' } | { type: 'itinerary' } | { type: 'revise'; target: EditTarget } | null;

/** Requirement keys whose change makes the draft wrong as a whole; any other change edits it in place. */
const REGENERATES: readonly string[] = ['destination', 'tripType', 'departureDate', 'returnDate', 'travelers'];

export class CommandError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

function isValidIsoDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

/** Applies each valid non-null field; an invalid field is dropped and so counts as missing. */
export function merge(
  existing: Requirements,
  patch: Record<string, unknown>,
): { requirements: Requirements; changed: string[] } {
  const next: Record<string, unknown> = { ...existing };
  const changed: string[] = [];
  for (const [key, raw] of Object.entries(patch)) {
    if (raw === null || raw === undefined) continue;
    const field = RequirementsSchema.shape[key as keyof Requirements];
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (!field || !field.safeParse(value).success) continue;
    if ((key === 'departureDate' || key === 'returnDate') && !isValidIsoDate(value as string)) continue;
    if (next[key] !== value) {
      next[key] = value;
      changed.push(key);
    }
  }
  const requirements = next as Requirements;
  if (requirements.departureDate && requirements.returnDate && requirements.departureDate > requirements.returnDate) {
    delete requirements.returnDate;
    changed.push('returnDate');
  }
  return { requirements, changed };
}

export function nextStage(r: Requirements): Stage {
  if (!r.tripType) return 'trip_type';
  return REQUIRED.some((key) => r[key] === undefined) ? 'requirements' : 'review';
}

export function assertAllowed(state: TripState, command: Command): void {
  const deny = (message: string) => {
    throw new CommandError(409, message);
  };
  switch (command.type) {
    case 'message':
      return;
    case 'set_trip_type':
      if (state.stage !== 'trip_type' && state.clarify?.field !== 'tripType') deny('Trip type is not being asked');
      return;
    case 'set_destination':
      if (state.clarify?.field !== 'destination' && !state.outsideJapan) deny('Destination is not being asked');
      return;
    case 'submit_requirements':
      if (state.stage !== 'requirements') deny('Requirements are not being collected');
      return;
    case 'confirm':
      if (state.stage !== 'review') deny('There is no draft to confirm');
      return;
    case 'edit':
      if (state.stage !== 'review' && state.stage !== 'confirmed') deny('There is no itinerary to edit');
      return;
    case 'resume':
      if (state.stage === 'idle') deny('There is no planning to resume');
      return;
    case 'choose_stay': {
      const { from, to } = command.nights;
      if (state.preamble === null) deny('There is no draft to change');
      if (!segments(state).some((s) => s.nights.from === from && s.nights.to === to)) deny('Those nights have changed');
      if (!state.stays?.items.some((h) => h.ref === command.ref)) deny('That hotel is not an option');
      return;
    }
    default:
      command satisfies never;
  }
}

function clearDraft(s: TripState) {
  s.preamble = null;
  s.tip = null;
  s.todos = [];
  s.days = [];
  s.footer = '';
  s.stays = null;
}

/**
 * Applies a requirements patch. A change to the trip's shape (REGENERATES) drafts again from scratch;
 * with a draft, anything else (preferences, budget, a named day or hotel) becomes a scoped revise.
 */
function plan(s: TripState, patch: Record<string, unknown>, clarify: TripState['clarify'], revise: Classified['revise'] = null) {
  const { requirements, changed } = merge(s.requirements, patch);
  s.requirements = requirements;
  s.clarify = clarify;
  if (s.preamble !== null && !changed.some((key) => REGENERATES.includes(key))) {
    const target = editTarget(s, revise, changed);
    if (target) {
      s.stage = 'review';
      return { state: s, effect: { type: 'revise', target } satisfies Effect };
    }
    return { state: s, effect: revise ? ({ type: 'answer' } satisfies Effect) : null };
  }
  if (changed.length) clearDraft(s);
  s.stage = !changed.length && s.stage === 'confirmed' ? 'confirmed' : nextStage(requirements);
  if (s.stage !== 'review' || s.preamble !== null) return { state: s, effect: null };
  // A new itinerary must search again instead of reusing a previous turn's results.
  s.toolResults = [];
  return { state: s, effect: { type: 'itinerary' } satisfies Effect };
}

/**
 * Which part of the draft a message is about. Pure; null when nothing in range is left.
 *   named days → those days; named hotel → those nights, or every night when none is named;
 *   preferences changed with no day named → every day; budget changed → every night.
 */
export function editTarget(
  s: Pick<TripState, 'days'>,
  revise: Classified['revise'],
  changed: string[],
): EditTarget | null {
  const nightCount = Math.max(s.days.length - 1, 0);
  const all = (n: number) => Array.from({ length: n }, (_, i) => i);
  const pick = (numbers: number[], count: number) =>
    [...new Set(numbers.map((n) => n - 1).filter((i) => i >= 0 && i < count))].sort((a, b) => a - b);
  const named = pick(revise?.days ?? [], s.days.length);
  const days = named.length || !changed.includes('preferences') ? named : all(s.days.length);
  const hotelNights = revise?.hotel ? (revise.hotelDays.length ? pick(revise.hotelDays, nightCount) : all(nightCount)) : [];
  const budget = changed.includes('budget') || changed.includes('budgetCurrency');
  const nights = hotelNights.length || !budget ? hotelNights : all(nightCount);
  return days.length || nights.length ? { days, nights } : null;
}

/** Pure workflow rules: what the command means for the trip and which LLM work it needs. */
export function reduce(
  state: TripState,
  command: Command,
  classified?: Classified,
  place?: { destination: string } & Place,
): { state: TripState; effect: Effect } {
  assertAllowed(state, command);
  const s: TripState = { ...structuredClone(state), revision: state.revision + 1, results: [], outsideJapan: null };
  // Outside Japan: the turn applies as if the destination had not been given, and nothing reaches the LLM.
  if (place && (place.japan === null || place.outside.length > 0)) {
    const patch = command.type === 'message' && classified && classified.intent !== 'chat'
      ? classified.patch
      : command.type === 'submit_requirements'
        ? command.values
        : command.type === 'set_trip_type' ? { tripType: command.value } : {};
    // A destination saved before the Japan check is dropped with everything planned for it.
    if (s.requirements.destination !== undefined && s.requirements.destination !== s.checkedDestination) {
      delete s.requirements.destination;
      clearDraft(s);
      s.stage = nextStage(s.requirements);
    }
    plan(s, { ...patch, destination: null }, null);
    if (command.type === 'submit_requirements' && command.values.preferences === '') delete s.requirements.preferences;
    s.outsideJapan = { places: place.outside.length ? place.outside : [place.destination], japan: place.japan };
    return { state: s, effect: null };
  }
  if (place) s.checkedDestination = place.destination;
  switch (command.type) {
    case 'message':
      if (!classified) throw new Error('A message command needs a classification');
      if (classified.intent === 'chat') return { state: s, effect: { type: 'answer' } };
      return plan(s, classified.patch, classified.clarify, classified.intent === 'revise' ? classified.revise : null);
    case 'set_trip_type':
      return plan(s, { tripType: command.value }, null);
    case 'set_destination':
      return plan(s, { destination: command.value }, null);
    case 'submit_requirements': {
      const result = plan(s, command.values, null);
      if (command.values.preferences === '') delete result.state.requirements.preferences;
      return result;
    }
    case 'confirm':
      s.stage = 'confirmed';
      return { state: s, effect: null };
    case 'edit':
      s.stage = 'requirements';
      clearDraft(s);
      return { state: s, effect: null };
    case 'resume':
      return { state: s, effect: null };
    case 'choose_stay':
      s.days = splice(s, { nights: nightsOf(command.nights, command.ref) }).days;
      s.stage = 'review';
      return { state: s, effect: null };
  }
}
