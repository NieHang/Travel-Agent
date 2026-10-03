import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { AccessTokenService } from '../src/auth/access-token.service.js';
import { loadAuthConfig } from '../src/config/auth.config.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    vi.stubEnv('JWT_ACCESS_SECRET', 'test-access-secret-at-least-32-chars-long');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET) needs no token', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ ok: true });
  });

  it('/hello (GET) without a token is 401 TOKEN_MISSING', () => {
    return request(app.getHttpServer())
      .get('/hello')
      .expect(401)
      .expect((res) => expect(res.body.code).toBe('TOKEN_MISSING'));
  });

  it('/hello (GET) with a token', async () => {
    const token = await new AccessTokenService(loadAuthConfig()).sign('test-user');
    return request(app.getHttpServer())
      .get('/hello')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect({ message: 'Hello World!' });
  });

  afterEach(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });
});
