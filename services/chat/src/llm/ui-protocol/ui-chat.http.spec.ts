import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { type INestApplication, type ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import { UIProtocolModule } from './ui-protocol.module.js';
import { UIResponseService } from './ui-response.service.js';
import { AllExceptionsFilter } from '../../common/all-exceptions.filter.js';

describe('UI chat HTTP', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [UIProtocolModule],
      providers: [
        {
          provide: APP_GUARD,
          useValue: {
            canActivate(context: ExecutionContext) {
              const req = context.switchToHttp().getRequest();
              req.user = { userId: req.headers['x-test-user'] ?? 'user-a' };
              return true;
            },
          },
        },
      ],
    })
      .overrideProvider(UIResponseService)
      .useValue({
        async generateUIResponse(input: string) {
          if (/旅游/.test(input))
            return {
              message: '选择类型',
              intent: 'trip_planning',
              components: [
                {
                  id: 'type',
                  type: 'selection',
                  title: '旅游类型',
                  mode: 'single',
                  options: [
                    { value: 'solo', label: '个人游', description: null },
                  ],
                },
              ],
            };
          return {
            message: '未验证',
            intent: 'place_details',
            components: [
              {
                id: 'detail',
                type: 'card',
                title: '地点详情',
                category: 'place',
                description: '暂无可信来源',
                details: [],
                sourceStatus: 'unverified',
              },
            ],
          };
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('registers chat/action and scopes sessions to the authenticated user', async () => {
    const start = await request(app.getHttpServer())
      .post('/api/ui-chat/chat')
      .send({ sessionId: 'same', input: '我要去日本旅游' })
      .expect(201);
    const componentId = start.body.components.find(
      (c: { type: string }) => c.type === 'selection',
    ).id;
    const action = { type: 'selection', componentId, values: ['solo'] };
    await request(app.getHttpServer())
      .post('/api/ui-chat/action')
      .set('x-test-user', 'user-b')
      .send({ sessionId: 'same', action })
      .expect(404);
    await request(app.getHttpServer())
      .post('/api/ui-chat/chat')
      .set('x-test-user', 'user-b')
      .send({ sessionId: 'same', input: '查看某某地点' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/ui-chat/action')
      .set('x-test-user', 'user-b')
      .send({ sessionId: 'same', action })
      .expect(409);
    const next = await request(app.getHttpServer())
      .post('/api/ui-chat/action')
      .send({ sessionId: 'same', action })
      .expect(201);
    expect(
      next.body.components.some((c: { type: string }) => c.type === 'form'),
    ).toBe(true);
    await request(app.getHttpServer())
      .post('/api/ui-chat/action')
      .send({ sessionId: 'same', action })
      .expect(409);
  });
  it.each([
    { sessionId: ' ', input: '你好' },
    { sessionId: 's', input: ' ' },
    { input: '你好' },
    { sessionId: 's', input: '你好', userId: 'other' },
  ])('rejects invalid chat %j', async (body) => {
    await request(app.getHttpServer())
      .post('/api/ui-chat/chat')
      .send(body)
      .expect(400);
  });
  it('rejects malformed actions', async () => {
    await request(app.getHttpServer())
      .post('/api/ui-chat/action')
      .send({
        sessionId: 's',
        action: {
          type: 'confirmation',
          componentId: 'c',
          confirmed: true,
          stage: 'confirmed',
        },
      })
      .expect(400);
  });
  it('accepts maximum length client session IDs', async () => {
    await request(app.getHttpServer())
      .post('/api/ui-chat/chat')
      .send({ sessionId: 'a'.repeat(200), input: '查看某某地点' })
      .expect(201);
  });
});
