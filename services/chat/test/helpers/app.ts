import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { RegisterRequestSchema, type User } from '@autix/contracts';
import { AppModule } from '../../src/app.module.js';
import { AppThrottlerGuard } from '../../src/auth/app-throttler.guard.js';
import { AuthService } from '../../src/auth/auth.service.js';
import { AUTH_CONFIG, type AuthConfig } from '../../src/config/auth.config.js';
import { applyTrustProxy } from '../../src/config/trust-proxy.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

/**
 * 完整的 AppModule 加真实测试库。只能在 test/setup-int.ts 加载 .env.test 之后调用。
 * 每次调用都是一个新应用，限流计数从零开始；默认关闭限流。
 */
export async function createTestApp(
  opts: { throttling?: boolean } = {},
): Promise<{ app: INestApplication; prisma: PrismaService; server: Server }> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (!opts.throttling) {
    // 它通过 @UseGuards 绑定，是 enhancer 而不是 provider：overrideProvider 换不掉它。
    builder.overrideGuard(AppThrottlerGuard).useValue({ canActivate: () => true });
  }
  const module = await builder.compile();
  const app = module.createNestApplication<NestExpressApplication>();
  // 与 main.ts 相同的代理信任设置，使测试应用里的 req.ip 与线上一致。
  applyTrustProxy(app, app.get<AuthConfig>(AUTH_CONFIG));
  await app.init();
  return { app, prisma: app.get(PrismaService), server: app.getHttpServer() as Server };
}

/** 直接调用 AuthService.register，不走 HTTP。未指定邮箱时每次生成一个不重复的。 */
export async function createUser(
  app: INestApplication,
  overrides: Partial<{ email: string; password: string; nickname: string }> = {},
): Promise<{ user: User; accessToken: string; refreshToken: string }> {
  const input = RegisterRequestSchema.parse({
    email: `user-${randomUUID()}@example.com`,
    password: 'abcdefg1',
    nickname: 'Tester',
    ...overrides,
  });
  const { user, accessToken, refreshToken } = await app.get(AuthService).register(input, {});
  return { user, accessToken, refreshToken };
}

export function bearer(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}
