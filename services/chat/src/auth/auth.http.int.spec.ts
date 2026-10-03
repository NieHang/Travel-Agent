import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request, { type Response } from 'supertest';
import { createTestApp } from '../../test/helpers/app.js';
import { resetDb } from '../../test/helpers/db.js';
import { AUTH_CONFIG, type AuthConfig } from '../config/auth.config.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AccessTokenService } from './access-token.service.js';

const body = { email: 'ann@example.com', password: 'abcdefg1', nickname: 'Ann' };
const cookieOf = (res: Response) => String(res.headers['set-cookie']?.[0] ?? '');
/** 浏览器回传的只有 `name=value`，不带属性。 */
const pairOf = (res: Response) => cookieOf(res).split(';')[0]!;

describe('auth HTTP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;

  beforeAll(async () => {
    ({ app, prisma, server } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('注册：201、AuthResult、Cookie 属性正确、响应体不含 refresh token', async () => {
    const res = await request(server).post('/api/auth/register').send(body).expect(201);
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'user']);
    expect(Object.keys(res.body.user).sort()).toEqual([
      'createdAt',
      'email',
      'id',
      'locale',
      'nickname',
    ]);
    expect(res.body.user).toMatchObject({ email: body.email, nickname: 'Ann', locale: 'zh' });
    const c = cookieOf(res);
    expect(c).toMatch(/^hilda_rt=[A-Za-z0-9_-]{43};/);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Path=/api/auth');
    expect(c).toMatch(/Max-Age=2592000/);
    expect(c).not.toContain('Secure');
    expect(res.headers['set-cookie']).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain(pairOf(res).split('=')[1]);
  });

  it('注册：校验失败与邮箱已注册', async () => {
    const bad = await request(server)
      .post('/api/auth/register')
      .send({ ...body, password: 'short' })
      .expect(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    expect(bad.body.details.fieldErrors.password).toBeDefined();
    await request(server).post('/api/auth/register').send(body).expect(201);
    await request(server)
      .post('/api/auth/register')
      .send(body)
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('EMAIL_TAKEN'));
  });

  it('客户端信息：user-agent 截断到 255 字符后入库', async () => {
    await request(server)
      .post('/api/auth/register')
      .set('User-Agent', 'a'.repeat(300))
      .send(body)
      .expect(201);
    const token = await prisma.refreshToken.findFirstOrThrow();
    expect(token.userAgent).toBe('a'.repeat(255));
    expect(token.ip).toBeTruthy();
  });

  it('登录：成功 200，失败 401 INVALID_CREDENTIALS', async () => {
    await request(server).post('/api/auth/register').send(body).expect(201);

    const ok = await request(server)
      .post('/api/auth/login')
      .send({ email: body.email, password: body.password })
      .expect(200);
    expect(Object.keys(ok.body).sort()).toEqual(['accessToken', 'user']);
    expect(ok.body.user.email).toBe(body.email);
    expect(cookieOf(ok)).toMatch(/^hilda_rt=[A-Za-z0-9_-]{43};/);

    const wrongPassword = await request(server)
      .post('/api/auth/login')
      .send({ email: body.email, password: 'wrong-password1' })
      .expect(401);
    const unknownEmail = await request(server)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: body.password })
      .expect(401);
    expect(wrongPassword.body).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'INVALID_CREDENTIALS',
    });
    // 两种失败原因的响应体完全相同，且都不下发 Cookie。
    expect(unknownEmail.body).toEqual(wrongPassword.body);
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
    expect(unknownEmail.headers['set-cookie']).toBeUndefined();

    const invalid = await request(server).post('/api/auth/login').send({ email: 'x' }).expect(400);
    expect(invalid.body.code).toBe('VALIDATION_FAILED');
  });

  it('刷新：用 Cookie 换新 token 并轮换 Cookie', async () => {
    const reg = await request(server).post('/api/auth/register').send(body);
    const res = await request(server)
      .post('/api/auth/refresh')
      .set('Cookie', cookieOf(reg))
      .expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'user']);
    expect(res.body.user.email).toBe(body.email);
    expect(cookieOf(res).split(';')[0]).not.toBe(cookieOf(reg).split(';')[0]);
    expect(cookieOf(res)).toMatch(/^hilda_rt=[A-Za-z0-9_-]{43};/);
    expect(cookieOf(res)).toMatch(/Max-Age=2592000/);
  });

  it('刷新：无 Cookie 返回 REFRESH_INVALID 并清除 Cookie', async () => {
    const res = await request(server).post('/api/auth/refresh').expect(401);
    expect(res.body.code).toBe('REFRESH_INVALID');
    expect(cookieOf(res)).toMatch(/hilda_rt=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/);
    // 清除时的 Path 必须与设置时一致，否则浏览器不会删掉它。
    expect(cookieOf(res)).toContain('Path=/api/auth');
  });

  it('刷新：非字符串形态的 Cookie 按无效处理，不会 500', async () => {
    // cookie-parser 会把 `j:` 前缀的值解析成对象。
    const res = await request(server)
      .post('/api/auth/refresh')
      .set('Cookie', `hilda_rt=${encodeURIComponent('j:{"a":1}')}`)
      .expect(401);
    expect(res.body.code).toBe('REFRESH_INVALID');
  });

  it('刷新：宽限期内的旧 Cookie 返回 REFRESH_INVALID 但不清除 Cookie', async () => {
    const reg = await request(server).post('/api/auth/register').send(body);
    await request(server).post('/api/auth/refresh').set('Cookie', cookieOf(reg)).expect(200);
    const res = await request(server)
      .post('/api/auth/refresh')
      .set('Cookie', cookieOf(reg))
      .expect(401);
    expect(res.body.code).toBe('REFRESH_INVALID');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('刷新：宽限期之后重用旧 Cookie 返回 REFRESH_REUSED 并清除 Cookie', async () => {
    const reg = await request(server).post('/api/auth/register').send(body);
    await request(server).post('/api/auth/refresh').set('Cookie', pairOf(reg)).expect(200);
    await prisma.refreshToken.updateMany({
      where: { replacedBy: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
    const res = await request(server)
      .post('/api/auth/refresh')
      .set('Cookie', pairOf(reg))
      .expect(401);
    expect(res.body.code).toBe('REFRESH_REUSED');
    expect(cookieOf(res)).toMatch(/hilda_rt=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/);
  });

  it('登出：204、清 Cookie、之后刷新失败；无 Cookie 也是 204', async () => {
    const reg = await request(server).post('/api/auth/register').send(body).expect(201);

    const out = await request(server)
      .post('/api/auth/logout')
      .set('Cookie', pairOf(reg))
      .expect(204);
    expect(out.text).toBe('');
    expect(cookieOf(out)).toMatch(/hilda_rt=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/);
    expect(cookieOf(out)).toContain('Path=/api/auth');

    const after = await request(server)
      .post('/api/auth/refresh')
      .set('Cookie', pairOf(reg))
      .expect(401);
    expect(after.body.code).toBe('REFRESH_INVALID');

    await request(server).post('/api/auth/logout').expect(204);
    await request(server).post('/api/auth/logout').set('Cookie', 'hilda_rt=unknown').expect(204);
  });

  it('refresh Cookie 不会被认证以外的路径接收（Path 限定）', async () => {
    const reg = await request(server).post('/api/auth/register').send(body).expect(201);
    const login = await request(server)
      .post('/api/auth/login')
      .send({ email: body.email, password: body.password })
      .expect(200);
    const refreshed = await request(server)
      .post('/api/auth/refresh')
      .set('Cookie', pairOf(login))
      .expect(200);
    for (const res of [reg, login, refreshed]) {
      expect(cookieOf(res).split('; ')).toContain('Path=/api/auth');
    }
  });

  it('createTestApp 默认关闭限流', async () => {
    for (let i = 0; i < 12; i++) await request(server).post('/api/auth/register').send({}).expect(400);
  });

  describe('全局鉴权', () => {
    it.each([
      [undefined, 'TOKEN_MISSING'],
      ['Basic abc', 'TOKEN_MISSING'],
      ['Bearer', 'TOKEN_INVALID'],
      ['Bearer not.a.jwt', 'TOKEN_INVALID'],
    ])('受保护接口：Authorization=%s → 401 %s', async (header, code) => {
      const req = request(server).get('/api/users/me');
      if (header) req.set('Authorization', header);
      await req.expect(401).expect((r) => expect(r.body.code).toBe(code));
    });

    it('过期的 access token → TOKEN_EXPIRED', async () => {
      const config = app.get<AuthConfig>(AUTH_CONFIG);
      const expired = await new AccessTokenService({ ...config, accessTtl: '-1s' }).sign('user-1');
      const res = await request(server)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);
      expect(res.body).toEqual({ code: 'TOKEN_EXPIRED', message: 'TOKEN_EXPIRED' });
    });

    it('别的密钥签发的 access token → TOKEN_INVALID', async () => {
      const config = app.get<AuthConfig>(AUTH_CONFIG);
      const forged = await new AccessTokenService({
        ...config,
        accessSecret: 'another-secret-that-is-at-least-32-chars',
      }).sign('user-1');
      await request(server)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${forged}`)
        .expect(401)
        .expect((r) => expect(r.body.code).toBe('TOKEN_INVALID'));
    });

    it('白名单：/health 无需登录', () => request(server).get('/health').expect(200));

    it('现有 demo 接口受保护', () =>
      request(server).post('/api/langchain/prompt-preview').send({ input: 'x' }).expect(401));

    it.each([
      ['get', '/hello'],
      ['post', '/requirement/extract'],
    ] as const)('根控制器的其余接口受保护：%s %s', async (method, path) => {
      const res = await request(server)[method](path).expect(401);
      expect(res.body.code).toBe('TOKEN_MISSING');
    });

    it('不存在的路由是 404 NOT_FOUND，错误体形状统一', async () => {
      const res = await request(server).get('/api/nope').expect(404);
      expect(res.body).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
    });
  });
});

describe('auth HTTP 限流', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    let prisma: PrismaService;
    ({ app, prisma, server } = await createTestApp({ throttling: true }));
    await resetDb(prisma);
  });

  afterAll(async () => {
    await app?.close();
  });

  const hit = (path: string) => request(server).post(path);

  it('登录每分钟 10 次，第 11 次 429 并带 Retry-After', async () => {
    for (let i = 0; i < 10; i++)
      await request(server).post('/api/auth/login').send({ email: 'x@y.co', password: 'p' }).expect(401);
    const res = await request(server)
      .post('/api/auth/login')
      .send({ email: 'x@y.co', password: 'p' })
      .expect(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(60);
  });

  it('注册每分钟 10 次，独立于登录的计数', async () => {
    for (let i = 0; i < 10; i++) await hit('/api/auth/register').send({}).expect(400);
    const res = await hit('/api/auth/register').send({}).expect(429);
    expect(res.body.code).toBe('RATE_LIMITED');
  });

  it('刷新的额度是 60，不受登录额度影响', async () => {
    for (let i = 0; i < 11; i++) await request(server).post('/api/auth/refresh').expect(401);
    for (let i = 11; i < 60; i++) await hit('/api/auth/refresh').expect(401);
    const res = await hit('/api/auth/refresh').expect(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('登出的额度是 60', async () => {
    for (let i = 0; i < 60; i++) await hit('/api/auth/logout').expect(204);
    await hit('/api/auth/logout').expect(429);
  });

  it('未标注限流的接口不限流', async () => {
    for (let i = 0; i < 30; i++) await request(server).get('/health').expect(200);
  });
});
