// One-off: copies each conversation's latest version-1 uiFlowSnapshot into Conversation.tripState.
// Run once after deploying the trip_state migration: `bun run scripts/migrate-trip-state.ts`.
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { fromLegacySnapshot } from '../src/trip/legacy.js';
import { Prisma } from '../src/generated/prisma/client.js';

const prisma = new PrismaService();
let migrated = 0;
let skipped = 0;
const conversations = await prisma.conversation.findMany({ where: { tripState: { equals: Prisma.DbNull } }, select: { id: true, tripRevision: true } });
for (const { id, tripRevision } of conversations) {
  const latest = await prisma.message.findFirst({
    where: { conversationId: id, role: 'ASSISTANT', status: 'complete', metadata: { path: ['uiFlowSnapshot', 'version'], equals: 1 } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { metadata: true },
  });
  const state = fromLegacySnapshot((latest?.metadata as { uiFlowSnapshot?: unknown } | null)?.uiFlowSnapshot, tripRevision);
  if (!state) {
    skipped++;
    continue;
  }
  await prisma.conversation.updateMany({
    where: { id, tripRevision },
    data: { tripState: state as unknown as Prisma.InputJsonValue },
  });
  migrated++;
}
console.log(`migrated=${migrated} skipped=${skipped}`);
await prisma.$disconnect();
