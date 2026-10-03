import { Logger } from '@nestjs/common';
import { LoginRequestSchema, RegisterRequestSchema } from '@autix/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestPrisma, resetDb } from '../../test/helpers/db.js';
import { AuditService } from '../audit/audit.service.js';
import { loadAuthConfig } from '../config/auth.config.js';
import { UsersService } from '../users/users.service.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { hashRefreshToken } from './refresh-token.js';

describe('AuthService', () => {
  const prisma = createTestPrisma();
  const config = loadAuthConfig({
    JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-chars-long',
  });
  const tokens = new AccessTokenService(config);
  const auth = new AuthService(
    prisma,
    new UsersService(prisma),
    new PasswordService(),
    tokens,
    new AuditService(prisma),
    config,
  );

  const input = { email: 'ann@example.com', password: 'abcdefg1', nickname: 'Ann', locale: 'zh' as const };
  const ctx = { ip: '1.1.1.1', userAgent: 'ua' };

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    // 只伪造 Date：真实的异步 I/O（数据库、argon2）照常工作。
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Prisma 在应用侧生成 @default(now())，而被伪造的时钟是静止的：
  // 要按 createdAt 排序的测试必须先拨动时钟，否则两行的 createdAt 相同、顺序不确定。
  const tick = (): void => {
    vi.setSystemTime(Date.now() + 1);
  };

  it('注册：建用户、发 token、记审计', async () => {
    const s = await auth.register(input, ctx);
    expect(s.user).toMatchObject({ email: 'ann@example.com', nickname: 'Ann' });
    expect(await tokens.verify(s.accessToken)).toEqual({ userId: s.user.id });
    const row = await prisma.refreshToken.findFirstOrThrow();
    expect(row.tokenHash).toBe(hashRefreshToken(s.refreshToken));
    expect(row.tokenHash).not.toBe(s.refreshToken);
    expect(row).toMatchObject({ ip: '1.1.1.1', userAgent: 'ua', revokedAt: null });
    expect(s.refreshExpiresAt.getTime() - Date.now()).toBeCloseTo(30 * 86_400_000, -4);
    expect(await prisma.auditLog.count({ where: { event: 'REGISTER', userId: s.user.id } })).toBe(1);
  });

  it('邮箱大小写与空白：规范化后的重复注册被拒，登录成功', async () => {
    await auth.register(RegisterRequestSchema.parse({ ...input, email: ' Ann@Example.com ' }), ctx);
    await expect(
      auth.register(RegisterRequestSchema.parse({ ...input, email: 'ANN@example.com' }), ctx),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
    await expect(
      auth.login(LoginRequestSchema.parse({ email: 'ann@EXAMPLE.com', password: 'abcdefg1' }), ctx),
    ).resolves.toBeDefined();
  });

  it('登录失败不区分原因，并记审计', async () => {
    await auth.register(input, ctx);
    for (const bad of [
      { email: input.email, password: 'wrongpw1' },
      { email: 'nobody@example.com', password: 'abcdefg1' },
    ]) {
      await expect(auth.login(bad, ctx)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
      tick();
    }
    const logs = await prisma.auditLog.findMany({
      where: { event: 'LOGIN_FAILURE' },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.map((l) => l.metadata)).toEqual([{ email: input.email }, { email: 'nobody@example.com' }]);
    expect(logs[1].userId).toBeNull();
  });

  it('每次登录是一条新链', async () => {
    await auth.register(input, ctx);
    await auth.login(input, ctx);
    const families = new Set((await prisma.refreshToken.findMany()).map((r) => r.familyId));
    expect(families.size).toBe(2);
    expect(await prisma.auditLog.count({ where: { event: 'LOGIN_SUCCESS' } })).toBe(1);
  });

  it('刷新：轮换并沿用 familyId', async () => {
    const s1 = await auth.register(input, ctx);
    tick();
    const s2 = await auth.refresh(s1.refreshToken, ctx);
    expect(s2.refreshToken).not.toBe(s1.refreshToken);
    const [old, fresh] = await prisma.refreshToken.findMany({ orderBy: { createdAt: 'asc' } });
    expect(old.revokedAt).not.toBeNull();
    expect(old.replacedBy).toBe(fresh.id);
    expect(fresh.familyId).toBe(old.familyId);
    expect(await prisma.auditLog.count({ where: { event: 'TOKEN_REFRESH' } })).toBe(1);
  });

  it.each([undefined, 'unknown-token'])('刷新：缺失或未知的 token %s', async (raw) => {
    await expect(auth.refresh(raw, ctx)).rejects.toMatchObject({ code: 'REFRESH_INVALID', clearCookie: true });
  });

  it('刷新：过期', async () => {
    const s = await auth.register(input, ctx);
    vi.setSystemTime(Date.now() + 31 * 86_400_000);
    await expect(auth.refresh(s.refreshToken, ctx)).rejects.toMatchObject({
      code: 'REFRESH_INVALID',
      clearCookie: true,
    });
  });

  it('刷新：宽限期内重复使用旧 token，不吊销链、不清 Cookie', async () => {
    const s1 = await auth.register(input, ctx);
    const s2 = await auth.refresh(s1.refreshToken, ctx);
    vi.setSystemTime(Date.now() + 9_000);
    await expect(auth.refresh(s1.refreshToken, ctx)).rejects.toMatchObject({
      code: 'REFRESH_INVALID',
      clearCookie: false,
    });
    await expect(auth.refresh(s2.refreshToken, ctx)).resolves.toBeDefined();
  });

  it('刷新：超出宽限期重复使用，吊销整条链并记审计', async () => {
    const s1 = await auth.register(input, ctx);
    const s2 = await auth.refresh(s1.refreshToken, ctx);
    vi.setSystemTime(Date.now() + 11_000);
    await expect(auth.refresh(s1.refreshToken, ctx)).rejects.toMatchObject({
      code: 'REFRESH_REUSED',
      clearCookie: true,
    });
    // 链已被整体吊销：链上其余 token 没有 replacedBy，按无效处理，不重复记盗用
    await expect(auth.refresh(s2.refreshToken, ctx)).rejects.toMatchObject({
      code: 'REFRESH_INVALID',
      clearCookie: true,
    });
    expect(await prisma.auditLog.count({ where: { event: 'TOKEN_REUSE' } })).toBe(1);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { event: 'TOKEN_REUSE' } });
    expect(log.metadata).toHaveProperty('familyId');
  });

  it('刷新：并发只有一个成功', async () => {
    const s = await auth.register(input, ctx);
    const results = await Promise.allSettled([
      auth.refresh(s.refreshToken, ctx),
      auth.refresh(s.refreshToken, ctx),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(1);
  });

  it('吊销只影响本条链', async () => {
    const a = await auth.register(input, ctx);
    const b = await auth.login(input, ctx);
    await auth.logout(a.refreshToken, ctx);
    await expect(auth.refresh(b.refreshToken, ctx)).resolves.toBeDefined();
  });

  it('登出：吊销整条链、记审计、幂等', async () => {
    const s1 = await auth.register(input, ctx);
    const s2 = await auth.refresh(s1.refreshToken, ctx);
    await auth.logout(s2.refreshToken, ctx);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { event: 'LOGOUT' } })).toBe(1);
    await expect(auth.logout(s2.refreshToken, ctx)).resolves.toBeUndefined();
    await expect(auth.logout(undefined, ctx)).resolves.toBeUndefined();
  });

  it('登录成功后清理过期超过 7 天的记录', async () => {
    const s = await auth.register(input, ctx);
    await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 8 * 86_400_000) } });
    await prisma.refreshToken.create({
      data: {
        userId: s.user.id,
        familyId: 'keep',
        tokenHash: 'k',
        expiresAt: new Date(Date.now() - 6 * 86_400_000),
      },
    });
    await auth.login(input, ctx);
    const left = await prisma.refreshToken.findMany();
    expect(left.map((r) => r.familyId)).toContain('keep');
    expect(left).toHaveLength(2); // 'keep' 与本次登录新发的
  });

  it('审计写入失败时登录仍成功', async () => {
    await auth.register(input, ctx);
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const createSpy = vi.spyOn(prisma.auditLog, 'create').mockRejectedValueOnce(new Error('db down'));
    await expect(auth.login(input, ctx)).resolves.toBeDefined();
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(await prisma.auditLog.count({ where: { event: 'LOGIN_SUCCESS' } })).toBe(0);
  });
});
