import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../test/helpers/app.js';
import { resetDb } from '../../test/helpers/db.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const body = { email: 'ann@example.com', password: 'abcdefg1', nickname: 'Ann' };
/** 第一段是客户端伪造的，最后一段是反向代理追加的真实来源。 */
const forwarded = (forged: string) => `${forged}, 9.9.9.9`;
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

describe('TRUST_PROXY', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;

  const start = async (trustProxy: boolean, throttling = false) => {
    vi.stubEnv('TRUST_PROXY', trustProxy ? 'true' : 'false');
    ({ app, prisma, server } = await createTestApp({ throttling }));
    await resetDb(prisma);
  };

  afterEach(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  it('开启：只信任一跳代理，记录的 ip 是代理追加的那一段，不是客户端伪造的', async () => {
    await start(true);
    await request(server)
      .post('/api/auth/register')
      .set('X-Forwarded-For', forwarded('6.6.6.6'))
      .send(body)
      .expect(201);
    const token = await prisma.refreshToken.findFirstOrThrow();
    expect(token.ip).toBe('9.9.9.9');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { event: 'REGISTER' } });
    expect(audit.ip).toBe('9.9.9.9');
  });

  it('开启且限流：轮换伪造的第一段不会重置登录额度，第 11 次仍是 429', async () => {
    await start(true, true);
    const login = (i: number) =>
      request(server)
        .post('/api/auth/login')
        .set('X-Forwarded-For', forwarded(`6.6.6.${i}`))
        .send({ email: 'x@y.co', password: 'p' });
    for (let i = 0; i < 10; i++) await login(i).expect(401);
    const res = await login(10).expect(429);
    expect(res.body.code).toBe('RATE_LIMITED');
  });

  it('开启且限流：代理追加的来源不同则各自计数', async () => {
    await start(true, true);
    const login = (source: string) =>
      request(server)
        .post('/api/auth/login')
        .set('X-Forwarded-For', `6.6.6.6, ${source}`)
        .send({ email: 'x@y.co', password: 'p' });
    for (let i = 0; i < 10; i++) await login('9.9.9.9').expect(401);
    await login('9.9.9.9').expect(429);
    await login('8.8.8.8').expect(401);
  });

  it('关闭：完全忽略 X-Forwarded-For，记录的是 socket 地址', async () => {
    await start(false);
    await request(server)
      .post('/api/auth/register')
      .set('X-Forwarded-For', forwarded('6.6.6.6'))
      .send(body)
      .expect(201);
    const token = await prisma.refreshToken.findFirstOrThrow();
    expect(LOOPBACK).toContain(token.ip);
  });

  it('关闭且限流：变换 X-Forwarded-For 不会重置登录额度', async () => {
    await start(false, true);
    const login = (i: number) =>
      request(server)
        .post('/api/auth/login')
        .set('X-Forwarded-For', `6.6.6.${i}, 9.9.9.${i}`)
        .send({ email: 'x@y.co', password: 'p' });
    for (let i = 0; i < 10; i++) await login(i).expect(401);
    await login(10).expect(429);
  });
});
