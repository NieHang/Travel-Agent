import { z } from 'zod';
import { merge } from './commands.js';
import { TripStateSchema, initialState, type Stage, type TripState } from './state.js';

const STAGE_MAP: Record<string, Stage> = {
  idle: 'idle',
  choosing_trip_type: 'trip_type',
  collecting_requirements: 'requirements',
  reviewing_itinerary: 'review',
  awaiting_confirmation: 'review',
  confirmed: 'confirmed',
};

const LegacySchema = z.object({
  version: z.literal(1),
  context: z.object({
    stage: z.string(),
    requirements: z.record(z.unknown()),
    itinerary: z.string().nullable(),
    query: z
      .object({
        results: z
          .array(z.object({ tool: z.string(), args: z.record(z.unknown()), content: z.string(), isError: z.boolean() }))
          .optional(),
      })
      .nullable()
      .optional(),
    replyLanguage: z.string().optional(),
    preferredLocale: z.string().optional(),
  }),
  trip: z
    .object({
      days: z
        .array(z.object({ title: z.string(), stops: z.array(z.object({ name: z.string(), note: z.string().nullable(), time: z.string().nullable() })) }))
        .optional(),
    })
    .nullable()
    .optional(),
});

/** Maps a version-1 uiFlowSnapshot to TripState; null when it cannot be read. */
export function fromLegacySnapshot(raw: unknown, revision: number): TripState | null {
  const parsed = LegacySchema.safeParse(raw);
  if (!parsed.success) return null;
  const { context, trip } = parsed.data;
  const stage = STAGE_MAP[context.stage];
  if (!stage) return null;
  const language = context.preferredLocale ?? context.replyLanguage ?? 'zh';
  const state: TripState = {
    ...initialState(revision, language.toLowerCase().startsWith('zh') ? 'zh' : 'en'),
    stage,
    requirements: merge({}, context.requirements).requirements,
    itinerary: context.itinerary,
    days: (trip?.days ?? []).map((d) => ({ ...d, stayRef: null })),
    toolResults: (context.query?.results ?? []).slice(-8).map((r, i) => ({ ...r, callId: `legacy-${i + 1}` })),
  };
  return TripStateSchema.safeParse(state).success ? state : null;
}
