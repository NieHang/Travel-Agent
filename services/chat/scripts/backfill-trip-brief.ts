// One-off: drafts written before the trip view had a tip, a checklist, stop hours and transit were
// never read for them, so their panel shows none. This reads each such draft again with the model.
// Run with no turn in flight: `bun run scripts/backfill-trip-brief.ts` (DRY_RUN=1 only lists them).
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { ModelTripLlm } from '../src/trip/llm.js';
import { readState, type TripState } from '../src/trip/state.js';

const prisma = new PrismaService();
const llm = new ModelTripLlm();
const signal = new AbortController().signal;
let updated = 0;

const conversations = await prisma.conversation.findMany({
  where: { NOT: { tripState: { equals: Prisma.DbNull } } },
  select: { id: true, tripState: true, tripRevision: true },
});
for (const { id, tripState, tripRevision } of conversations) {
  const state = readState(tripState, tripRevision);
  const { preamble } = state;
  if (preamble === null || !neverRead(state)) continue;
  console.log(`${id}: ${state.days.length} days`);
  if (process.env.DRY_RUN) continue;
  const [brief, stops] = await Promise.all([
    llm.extractBrief(preamble, state.locale, signal),
    Promise.all(state.days.map((day) => llm.extractStops(day, state.locale, signal))),
  ]);
  const next: TripState = { ...state, ...brief, days: state.days.map((day, i) => ({ ...day, stops: stops[i] })) };
  const { count } = await prisma.conversation.updateMany({
    where: { id, tripRevision },
    data: { tripState: next as unknown as Prisma.InputJsonValue },
  });
  updated += count;
}
console.log(`updated=${updated}`);
await prisma.$disconnect();

/** A draft read by the current extraction has at least one of these; stored defaults leave them all empty. */
function neverRead(state: TripState): boolean {
  return state.tip === null && state.todos.length === 0
    && state.days.every((day) => day.stops.every((stop) => stop.hours === null && stop.transit === null));
}
