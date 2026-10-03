import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestPrisma, resetDb } from '../../test/helpers/db.js';
import { UsersService, toUserContract } from './users.service.js';

describe('UsersService', () => {
  const prisma = createTestPrisma();
  const users = new UsersService(prisma);

  beforeAll(async () => {
    await prisma.$connect();
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('创建与查询', async () => {
    const u = await users.create({ email: 'a@b.co', passwordHash: 'h', nickname: 'A', locale: 'en' });
    expect(await users.findByEmail('a@b.co')).toMatchObject({ id: u.id });
    expect(await users.findById('missing')).toBeNull();
  });

  it('邮箱冲突', async () => {
    await expect(
      users.create({ email: 'a@b.co', passwordHash: 'h', nickname: 'B', locale: 'zh' }),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN', status: 409 });
  });

  it('更新', async () => {
    const u = await users.findByEmail('a@b.co');
    expect(await users.update(u!.id, { locale: 'zh' })).toMatchObject({ locale: 'zh', nickname: 'A' });
  });

  it('契约形状不含密码哈希', async () => {
    const c = toUserContract((await users.findByEmail('a@b.co'))!);
    expect(Object.keys(c).sort()).toEqual(['createdAt', 'email', 'id', 'locale', 'nickname']);
    expect(c.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
