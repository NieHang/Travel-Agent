import { z } from 'zod';

const TracePhaseSchema = z.enum(['understanding', 'searching', 'writing', 'organizing']);
export type TracePhase = z.infer<typeof TracePhaseSchema>;

const LookupSchema = z.object({
  tool: z.string(),
  /** Localized one-line description of what was looked up, e.g. "大阪酒店 · 12/20–12/22". */
  subject: z.string().nullable(),
  /** When the result came back; the only freshness signal, since providers send no quote time. */
  at: z.string().datetime(),
  ok: z.boolean(),
  count: z.number().int().nonnegative().nullable(),
});
export type TraceLookup = z.infer<typeof LookupSchema>;

/**
 * Paid-tier detail. Kept in one field so a future tier check can drop it server-side
 * before the message leaves the API.
 */
const VerificationSchema = z.object({
  lookups: z.array(LookupSchema).max(20),
  /** Knowledge-base wiki pages the model read this turn, in reading order, titled in the trip's locale. */
  reading: z.array(z.object({ id: z.string().min(1), title: z.string().min(1) })).max(40).default([]),
  /** show_results items checked against tool results: kept vs dropped. Null when nothing was shown. */
  grounding: z.object({ kept: z.number().int().nonnegative(), dropped: z.number().int().nonnegative() }).nullable(),
});
export type TraceVerification = z.infer<typeof VerificationSchema>;

/**
 * How an assistant reply was produced. The outcome is Message.status; this only records the
 * phases the turn reached (consecutive repeats collapsed) and when each began.
 */
export const TurnTraceSchema = z.object({
  steps: z.array(z.object({ phase: TracePhaseSchema, at: z.string().datetime() })).max(40),
  endedAt: z.string().datetime(),
  verification: VerificationSchema.optional(),
});
export type TurnTrace = z.infer<typeof TurnTraceSchema>;
