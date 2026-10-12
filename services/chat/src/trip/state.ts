import { z } from 'zod';
import {
  RequirementsSchema,
  ResultGroupSchema,
  type Panel,
  type ResultItem,
  type TripView,
} from '@autix/contracts';
import { ToolResultSchema } from './results.js';

export type Locale = 'zh' | 'en';
export const STAGES = ['idle', 'trip_type', 'requirements', 'review', 'confirmed'] as const;
export type Stage = (typeof STAGES)[number];

export const REQUIRED = ['destination', 'tripType', 'departureDate', 'returnDate', 'travelers'] as const;

export const ClarifySchema = z.object({
  field: z.enum(['destination', 'tripType', 'dates', 'other']),
  question: z.string().min(1).max(300),
  options: z.array(z.string().min(1).max(100)).max(5),
});
export type Clarify = z.infer<typeof ClarifySchema>;

export const TripDaySchema = z.object({
  title: z.string().min(1).max(200),
  stops: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        note: z.string().max(500).nullable(),
        time: z.string().max(50).nullable(),
      }),
    )
    .max(20),
  stayRef: z.string().nullable(),
});
export type TripDay = z.infer<typeof TripDaySchema>;

export const TripStateSchema = z.object({
  version: z.literal(2),
  revision: z.number().int().nonnegative(),
  stage: z.enum(STAGES),
  requirements: RequirementsSchema,
  clarify: ClarifySchema.nullable(),
  itinerary: z.string().nullable(),
  days: z.array(TripDaySchema).max(60),
  stays: ResultGroupSchema.nullable(),
  toolResults: z.array(ToolResultSchema).max(8),
  results: z.array(ResultGroupSchema).max(10),
  locale: z.enum(['zh', 'en']),
});
export type TripState = z.infer<typeof TripStateSchema>;

export function initialState(revision = 0, locale: Locale = 'zh'): TripState {
  return {
    version: 2,
    revision,
    stage: 'idle',
    requirements: {},
    clarify: null,
    itinerary: null,
    days: [],
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
  const stays = s.stays?.items ?? [];
  const r = s.requirements;
  return {
    revision: s.revision,
    status: s.stage === 'confirmed' ? 'confirmed' : s.itinerary ? 'draft' : 'collecting',
    destination: r.destination ?? null,
    departureDate: r.departureDate ?? null,
    returnDate: r.returnDate ?? null,
    travelers: r.travelers ?? null,
    budget: r.budget ?? null,
    budgetCurrency: r.budgetCurrency ?? null,
    itineraryMarkdown: s.itinerary,
    days: s.days.map((d) => ({
      title: d.title,
      stops: d.stops,
      stay: stays.find((h) => h.ref === d.stayRef) ?? null,
    })),
    hotels: stays.length ? stays : fromResults('hotels'),
    routes: fromResults('routes'),
    hotspots: fromResults('hotspots'),
  };
}
