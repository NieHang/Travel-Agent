import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './app.module.js';
import { AccessTokenService } from './auth/access-token.service.js';
import { PrismaService } from './prisma/prisma.service.js';

const demoRoutes = [
  ['post', '/requirement/extract'],
  ['post', '/api/langchain/prompt-preview'],
  ['get', '/api/memory/history/test-session'],
  ['delete', '/api/memory/history/test-session'],
  ['post', '/api/files/chat'],
  ['post', '/api/embedding/embed'],
  ['post', '/api/agents/orchestrate'],
  ['post', '/api/advanced/analyze'],
] as const;

describe('app HTTP routes', () => {
  let app: INestApplication | undefined;

  const compileApp = () => Test.createTestingModule({ imports: [AppModule.register()] })
    .overrideProvider(PrismaService)
    .useValue({})
    .compile();

  beforeEach(() => {
    vi.stubEnv('JWT_ACCESS_SECRET', 'test-access-secret-at-least-32-chars-long');
    vi.stubEnv('LLM_FAKE', '1');
    vi.stubEnv('LLM_DEMO_ROUTES', undefined);
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.unstubAllEnvs();
  });

  async function startApp() {
    const module = await compileApp();
    app = module.createNestApplication();
    await app.init();
    return request(app.getHttpServer());
  }

  it('keeps health public and hello protected', async () => {
    const http = await startApp();
    await http.get('/health').expect(200);
    await http.get('/hello').expect(401);
    const token = await app!.get(AccessTokenService).sign('test-user');
    await http.get('/hello').auth(token, { type: 'bearer' })
      .expect(200, { message: 'Hello World!' });
  });

  it('does not register demo routes by default', async () => {
    const http = await startApp();
    for (const [method, path] of demoRoutes) {
      await http[method](path).expect(404);
    }
    const token = await app!.get(AccessTokenService).sign('test-user');
    await http.get('/api/memory/history/test-session').auth(token, { type: 'bearer' }).expect(404);
  });

  it('registers protected demo routes when enabled', async () => {
    vi.stubEnv('LLM_DEMO_ROUTES', 'TRUE');
    const http = await startApp();
    const token = await app!.get(AccessTokenService).sign('test-user');
    for (const [method, path] of demoRoutes) {
      await http[method](path).expect(401);
    }
    for (const path of ['/requirement/extract', '/api/langchain/structured']) {
      await http.post(path).auth(token, { type: 'bearer' }).send({ input: 'test' })
        .expect(201);
    }
    await http.get('/api/memory/history/test-session').auth(token, { type: 'bearer' })
      .expect(200, []);
  });

  it('refuses to start in production with demo routes enabled', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LLM_FAKE', undefined);
    vi.stubEnv('LLM_DEMO_ROUTES', '1');
    await expect(compileApp()).rejects.toThrow('LLM_DEMO_ROUTES must not be enabled in production');
  });
});
