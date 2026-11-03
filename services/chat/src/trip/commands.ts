import { z } from 'zod';
import { RequirementsSchema, TripTypeSchema, type Command, type Requirements } from '@autix/contracts';
import { ClarifySchema, REQUIRED, type Stage, type TripState } from './state.js';

/** Structured output of llm.classify; strict mode needs every key present and nullable. */
export const ClassifiedSchema = z
  .object({
    intent: z.enum(['plan', 'chat']),
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
  const given = command.type === 'message' && classified?.intent === 'plan'
    ? classified.patch.destination
    : command.type === 'set_destination'
      ? command.value
      : command.type === 'submit_requirements'
        ? command.values.destination
        : undefined;
  const destination = given?.trim() || state.requirements.destination?.trim();
  return !destination || destination === state.checkedDestination ? null : destination;
}

export type Effect = 'answer' | 'itinerary' | null;

export class CommandError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

export function isValidIsoDate(value: string): boolean {
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
): { requirements: Requirements; changed: boolean } {
  const next: Record<string, unknown> = { ...existing };
  let changed = false;
  for (const [key, raw] of Object.entries(patch)) {
    if (raw === null || raw === undefined) continue;
    const field = RequirementsSchema.shape[key as keyof Requirements];
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (!field || !field.safeParse(value).success) continue;
    if ((key === 'departureDate' || key === 'returnDate') && !isValidIsoDate(value as string)) continue;
    if (next[key] !== value) {
      next[key] = value;
      changed = true;
    }
  }
  const requirements = next as Requirements;
  if (requirements.departureDate && requirements.returnDate && requirements.departureDate > requirements.returnDate) {
    delete requirements.returnDate;
    changed = true;
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
  }
}

function plan(s: TripState, patch: Record<string, unknown>, clarify: TripState['clarify']) {
  const { requirements, changed } = merge(s.requirements, patch);
  s.requirements = requirements;
  if (changed) {
    s.itinerary = null;
    s.days = [];
    s.stays = null;
  }
  s.clarify = clarify;
  s.stage = !changed && s.stage === 'confirmed' ? 'confirmed' : nextStage(requirements);
  const effect: Effect = s.stage === 'review' && !s.itinerary ? 'itinerary' : null;
  return { state: s, effect };
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
    const patch = command.type === 'message' && classified?.intent === 'plan'
      ? classified.patch
      : command.type === 'submit_requirements'
        ? command.values
        : command.type === 'set_trip_type' ? { tripType: command.value } : {};
    // A destination saved before the Japan check is dropped with everything planned for it.
    if (s.requirements.destination !== undefined && s.requirements.destination !== s.checkedDestination) {
      delete s.requirements.destination;
      s.itinerary = null;
      s.days = [];
      s.stays = null;
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
      if (classified.intent === 'chat') return { state: s, effect: 'answer' };
      return plan(s, classified.patch, classified.clarify);
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
      s.itinerary = null;
      s.days = [];
      s.stays = null;
      return { state: s, effect: null };
    case 'resume':
      return { state: s, effect: null };
  }
}
