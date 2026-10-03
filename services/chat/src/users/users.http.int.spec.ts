import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createTestApp, createUser } from '../../test/helpers/app.js';
import { resetDb } from '../../test/helpers/db.js';
import type { PrismaService } from '../prisma/prisma.service.js';

describe('users HTTP', () => {
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

  it('GET /api/users/me', async () => {
    const { user, accessToken } = await createUser(app);
    await request(server).get('/api/users/me').set(...bearer(accessToken)).expect(200).expect(user);
  });

  it('GET /api/users/me 只返回自己', async () => {
    const ann = await createUser(app, { nickname: 'Ann' });
    const bob = await createUser(app, { nickname: 'Bob' });
    const res = await request(server).get('/api/users/me').set(...bearer(bob.accessToken)).expect(200);
    expect(res.body).toEqual(bob.user);
    expect(res.body.id).not.toBe(ann.user.id);
  });

  it('PATCH /api/users/me 改语言；空对象 400', async () => {
    const { accessToken } = await createUser(app);
    const res = await request(server)
      .patch('/api/users/me')
      .set(...bearer(accessToken))
      .send({ locale: 'en' })
      .expect(200);
    expect(res.body.locale).toBe('en');
    const bad = await request(server)
      .patch('/api/users/me')
      .set(...bearer(accessToken))
      .send({})
      .expect(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
  });

  it('PATCH /api/users/me 改昵称，响应是完整的 User', async () => {
    const { user, accessToken } = await createUser(app);
    const res = await request(server)
      .patch('/api/users/me')
      .set(...bearer(accessToken))
      .send({ nickname: '  New  ' })
      .expect(200);
    expect(res.body).toEqual({ ...user, nickname: 'New' });
  });

  it('未登录访问 /me 返回 TOKEN_MISSING', async () => {
    await request(server)
      .patch('/api/users/me')
      .send({ locale: 'en' })
      .expect(401)
      .expect((r) => expect(r.body.code).toBe('TOKEN_MISSING'));
  });

  it('用户被删除后旧 token 访问 /me 返回 TOKEN_INVALID', async () => {
    const { user, accessToken } = await createUser(app);
    await prisma.user.delete({ where: { id: user.id } });
    const get = await request(server).get('/api/users/me').set(...bearer(accessToken)).expect(401);
    expect(get.body.code).toBe('TOKEN_INVALID');
    const patch = await request(server)
      .patch('/api/users/me')
      .set(...bearer(accessToken))
      .send({ locale: 'en' })
      .expect(401);
    expect(patch.body.code).toBe('TOKEN_INVALID');
  });
});
