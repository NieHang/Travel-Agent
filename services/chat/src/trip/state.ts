import { z } from 'zod';
import {
  RequirementsSchema,
  ResultGroupSchema,
  type Panel,
  type ResultItem,
  type TripView,
  type StopCheck,
} from '@autix/contracts';
import { checkPlan, levelOf, PLACE_POLICY, type StopCheck as PlaceStopCheck } from '../places/index.js';
import { findingText } from './copy.js';
import { ToolResultSchema } from './results.js';
import { PlanDaySchema, StopSchema, parseDraft, renderPlan, segments, type PlanDay } from './itinerary.js';

export type Locale = 'zh' | 'en';
export const STAGES = ['idle', 'trip_type', 'requirements', 'review', 'confirmed'] as const;
export type Stage = (typeof STAGES)[number];

export const REQUIRED = ['destination', 'tripType', 'departureDate', 'returnDate', 'travelers'] as const;

export const MAX_CLARIFY_OPTIONS = 5;
export const ClarifySchema = z.object({
  field: z.enum(['destination', 'tripType', 'dates', 'other']),
  question: z.string().min(1).max(300),
  options: z.array(z.string().min(1).max(100)).max(MAX_CLARIFY_OPTIONS),
});

const TripStateFields = {
  revision: z.number().int().nonnegative(),
  stage: z.enum(STAGES),
  requirements: RequirementsSchema,
  clarify: ClarifySchema.nullable(),
  checkedDestination: z.string().nullable().default(null),
  outsideJapan: z.object({
    places: z.array(z.string().min(1).max(200)),
    japan: z.string().min(1).max(200).nullable(),
  }).strict().nullable().default(null),
  stays: ResultGroupSchema.nullable(),
  toolResults: z.array(ToolResultSchema).max(8),
  results: z.array(ResultGroupSchema).max(10),
  locale: z.enum(['zh', 'en']),
};

/** v3: the draft is stored as days with their own markdown; the full markdown is derived (renderPlan). */
const TripStateV3Schema = z.object({
  version: z.literal(3),
  ...TripStateFields,
  /** Title, overview and before-you-go of the draft; null until there is one. */
  preamble: z.string().max(8000).nullable(),
  days: z.array(PlanDaySchema).max(60),
  footer: z.string().max(2000),
});
export type TripState = z.infer<typeof TripStateV3Schema>;

/** Stored before scoped edits: one markdown string plus days extracted from it. Read-only. */
const TripStateV2Schema = z.object({
  version: z.literal(2),
  ...TripStateFields,
  itinerary: z.string().nullable(),
  days: z
    .array(z.object({ title: z.string().min(1).max(200), stops: z.array(StopSchema).max(20), stayRef: z.string().nullable() }))
    .max(60),
});
type TripStateV2 = z.infer<typeof TripStateV2Schema>;

/**
 * Must be deterministic: the turn claim compares two independent reads of the same row.
 * A v2 draft is split like a new draft; stops come from the v2 days when the day counts match.
 */
function upgradeV2({ version, itinerary, days: v2Days, ...rest }: TripStateV2): TripState {
  void version;
  if (itinerary === null) return { ...rest, version: 3, preamble: null, days: [], footer: '' };
  const draft = parseDraft(itinerary, rest.stays);
  const days: PlanDay[] = draft.days.length === v2Days.length
    ? draft.days.map((day, i) => ({ ...day, ...v2Days[i], stayRef: day.stayRef ?? v2Days[i].stayRef }))
    : v2Days.map((day) => ({
      ...day,
      body: day.stops.map((s) => `- ${s.time ? `${s.time} ` : ''}${s.name}${s.note ? `: ${s.note}` : ''}`).join('\n'),
    }));
  return { ...rest, version: 3, preamble: draft.preamble, days, footer: draft.footer };
}

/** Any stored state, read as v3. */
export const TripStateSchema = z.union([TripStateV3Schema, TripStateV2Schema.transform(upgradeV2)]);

export function initialState(revision = 0, locale: Locale = 'zh'): TripState {
  return {
    version: 3,
    revision,
    stage: 'idle',
    requirements: {},
    clarify: null,
    checkedDestination: null,
    outsideJapan: null,
    preamble: null,
    days: [],
    footer: '',
    stays: null,
    toolResults: [],
    results: [],
    locale,
  };
}

/** The column revision is the source of truth; a missing or unreadable state starts over. */
export function readState(raw: unknown, revision: number): TripState {
  const parsed = TripStateSchema.safeParse(raw);
  return parsed.success ? { ...parsed.data, revision } : initialState(revision);
}

export function toTripView(s: TripState): TripView | null {
  if (s.stage === 'idle' && s.results.length === 0) return null;
  const fromResults = (panel: Panel): ResultItem[] =>
    s.results.filter((g) => g.panel === panel).flatMap((g) => g.items);
  const checked = checkPlan(s);
  const stays = s.stays?.items ?? [];
  const r = s.requirements;
  return {
    revision: s.revision,
    status: s.stage === 'confirmed' ? 'confirmed' : s.preamble !== null ? 'draft' : 'collecting',
    destination: r.destination ?? null,
    departureDate: r.departureDate ?? null,
    returnDate: r.returnDate ?? null,
    travelers: r.travelers ?? null,
    budget: r.budget ?? null,
    budgetCurrency: r.budgetCurrency ?? null,
    overview: s.preamble,
    itineraryMarkdown: renderPlan(s, s.locale),
    days: s.days.map((d, i) => ({
      title: d.title,
      stops: d.stops.map((stop, j) => ({ ...stop, check: stopCheckView(checked.days[i][j], s.locale) })),
      stay: stays.find((h) => h.ref === d.stayRef) ?? null,
    })),
    hotels: stays.length ? stays : fromResults('hotels'),
    stayPlan: s.preamble === null ? [] : segments(s).map((seg) => ({
      nights: seg.nights,
      stay: stays.find((h) => h.ref === seg.stayRef) ?? null,
      options: stays,
    })),
    routes: fromResults('routes'),
    hotspots: fromResults('hotspots'),
  };
}

function stopCheckView(check: PlaceStopCheck, locale: Locale): StopCheck | null {
  if (check.status === 'unmatched') return PLACE_POLICY.unmatched === 'hide' ? null : { level: 'unverified', notes: [] };
  const notes = check.findings.toSorted((a, b) => Number(b.severity === 'conflict') - Number(a.severity === 'conflict'))
    .slice(0, 6).map((f) => ({ text: findingText(f, locale), source: f.source, checkedOn: f.checkedOn }));
  return { level: levelOf(check), notes };
}
