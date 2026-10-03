import { PrismaService } from '../../src/prisma/prisma.service.js';

/** Call only after test/setup-int.ts has loaded .env.test. */
export function createTestPrisma(): PrismaService {
  return new PrismaService();
}

export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "audit_logs", "refresh_tokens", "messages", "conversations", "users" RESTART IDENTITY CASCADE',
  );
}
