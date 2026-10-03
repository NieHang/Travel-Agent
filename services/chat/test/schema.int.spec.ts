import { createTestPrisma, resetDb } from './helpers/db.js';

describe('schema', () => {
  const prisma = createTestPrisma();
  beforeAll(async () => { await prisma.$connect(); await resetDb(prisma); });
  afterAll(() => prisma.$disconnect());

  it('邮箱唯一', async () => {
    const data = { email: 'a@b.co', passwordHash: 'h', nickname: 'A' };
    const u = await prisma.user.create({ data });
    expect(u.locale).toBe('zh');
    await expect(prisma.user.create({ data })).rejects.toThrow();
  });

  it('消息默认 complete；删除用户级联删除会话、消息、refresh token，审计日志保留', async () => {
    const u = await prisma.user.create({ data: { email: 'c@d.co', passwordHash: 'h', nickname: 'C' } });
    const c = await prisma.conversation.create({ data: { userId: u.id, title: '' } });
    const m = await prisma.message.create({ data: { conversationId: c.id, role: 'USER', content: 'hi' } });
    expect(m.status).toBe('complete');
    await prisma.refreshToken.create({ data: { userId: u.id, familyId: 'f', tokenHash: 'x', expiresAt: new Date() } });
    await prisma.auditLog.create({ data: { userId: u.id, event: 'REGISTER' } });
    await prisma.user.delete({ where: { id: u.id } });
    expect(await prisma.conversation.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.message.count({ where: { conversationId: c.id } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { userId: u.id } })).toBe(1);
  });

  it('会话必须属于存在的用户', async () => {
    await expect(prisma.conversation.create({ data: { userId: 'nope', title: '' } })).rejects.toThrow();
  });
});
