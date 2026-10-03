import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestPrisma, resetDb } from '../../test/helpers/db.js';
import { AuditService } from './audit.service.js';

describe('AuditService', () => {
  const prisma = createTestPrisma();
  const audit = new AuditService(prisma);

  beforeAll(async () => {
    await prisma.$connect();
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('写入一条记录，userAgent 截断到 255', async () => {
    await audit.record('LOGIN_FAILURE', {
      ip: '1.2.3.4',
      userAgent: 'u'.repeat(300),
      metadata: { email: 'a@b.co' },
    });
    const row = await prisma.auditLog.findFirstOrThrow();
    expect(row).toMatchObject({
      event: 'LOGIN_FAILURE',
      userId: null,
      ip: '1.2.3.4',
      metadata: { email: 'a@b.co' },
    });
    expect(row.userAgent).toHaveLength(255);
  });

  it('写入失败不抛错', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const broken = new AuditService({
      auditLog: { create: () => Promise.reject(new Error('db down')) },
    } as never);
    await expect(broken.record('LOGOUT', {})).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
