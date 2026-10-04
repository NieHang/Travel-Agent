import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { type INestApplication, type ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import { UIProtocolModule } from './ui-protocol.module.js';
import { UIResponseService } from './ui-response.service.js';
import { AllExceptionsFilter } from '../../common/all-exceptions.filter.js';
import { modelOutput } from './ui-test.fixtures.js';
import type { UIFlowContext } from './ui-types.js';

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
        async generateUIResponse(
          input: string,
          _history: unknown,
          context?: UIFlowContext,
        ) {
          if (['我要去日本旅游', 'I want to travel to Japan'].includes(input))
            return modelOutput(
              {
                message: '选择类型',
                intent: 'trip_planning',
                components: [
                  {
                    id: 'type',
                    type: 'selection',
                    purpose: 'trip_type',
                    title: '旅游类型',
                    mode: 'single',
                    options: [
                      { value: 'solo', label: '个人游', description: null },
                    ],
                  },
                ],
              },
              { destination: 'Japan' },
              'update_requirements',
              context?.preferredLocale ?? 'zh',
            );
          return modelOutput(
            {
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
            },
            {},
            'answer',
            context?.preferredLocale ?? context?.replyLanguage ?? 'zh',
          );
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
  it('passes locale preferences and returns only public UI, with action language inheritance', async () => {
    const start = await request(app.getHttpServer())
      .post('/api/ui-chat/chat')
      .send({ sessionId: 'english', input: '我要去日本旅游', locale: 'en' })
      .expect(201);
    expect(start.body).not.toHaveProperty('semantics');
    const selection = start.body.components.find(
      (c: { type: string }) => c.type === 'selection',
    );
    expect(selection.purpose).toBe('trip_type');
    expect(selection.title).toBe('What kind of trip is this?');
    const next = await request(app.getHttpServer())
      .post('/api/ui-chat/action')
      .send({
        sessionId: 'english',
        action: {
          type: 'selection',
          componentId: selection.id,
          values: ['solo'],
        },
      })
      .expect(201);
    expect(
      next.body.components.find((c: { type: string }) => c.type === 'form')
        .submitLabel,
    ).toBe('Generate itinerary draft');
  });
  it('accepts other language preferences with English fixed-copy fallback', async () => {
    const result = await request(app.getHttpServer())
      .post('/api/ui-chat/chat')
      .send({
        sessionId: 'french',
        input: 'I want to travel to Japan',
        locale: 'fr',
      })
      .expect(201);
    expect(
      result.body.components.find(
        (c: { type: string }) => c.type === 'selection',
      ).title,
    ).toBe('What kind of trip is this?');
  });
  it('accepts a new locale on an existing UI action', async () => {
    const start = await request(app.getHttpServer())
      .post('/api/ui-chat/chat')
      .send({ sessionId: 'switch', input: '我要去日本旅游' })
      .expect(201);
    const selection = start.body.components.find(
      (c: { type: string }) => c.type === 'selection',
    );
    const next = await request(app.getHttpServer())
      .post('/api/ui-chat/action')
      .send({
        sessionId: 'switch',
        locale: 'en',
        action: {
          type: 'selection',
          componentId: selection.id,
          values: ['solo'],
        },
      })
      .expect(201);
    expect(
      next.body.components.find((c: { type: string }) => c.type === 'form')
        .title,
    ).toBe('Travel requirements');
  });
  it.each([
    { sessionId: 's', input: 'hi', locale: 'not a language' },
    { sessionId: 's', input: 'hi', semantics: {} },
    { sessionId: 's', input: 'hi', stage: 'confirmed' },
  ])('rejects invalid locale or injected server data %j', async (body) => {
    await request(app.getHttpServer())
      .post('/api/ui-chat/chat')
      .send(body)
      .expect(400);
  });
});
