import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TripStreamEventSchema, TripUIStateSchema } from '@autix/contracts';
import { bearer, createTestApp, createUser } from '../../test/helpers/app.js';
import { resetDb } from '../../test/helpers/db.js';
import type { PrismaService } from '../prisma/prisma.service.js';

function parseSse(text: string) {
  return text
    .split('\n\n')
    .filter((b) => b.trim())
    .map((b) => {
      const lines = b.split('\n');
      expect(lines[0]).toBe('event: message');
      return TripStreamEventSchema.parse(JSON.parse(lines[1].slice('data: '.length)));
    });
}

describe('trip turns over HTTP (LLM_FAKE)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let token: string;
  let id: string;
  let othersId: string;

  beforeAll(async () => ({ app, prisma, server } = await createTestApp()));
  beforeEach(async () => {
    await resetDb(prisma);
    const a = await createUser(app);
    const b = await createUser(app);
    token = a.accessToken;
    id = (await prisma.conversation.create({ data: { userId: a.user.id, title: '' } })).id;
    othersId = (await prisma.conversation.create({ data: { userId: b.user.id, title: '' } })).id;
  });
  afterAll(async () => app?.close());

  const post = (conversationId: string, body: object) =>
    request(server).post(`/api/conversations/${conversationId}/messages`).set(...bearer(token)).send(body);

  it('streams a planning turn and exposes the same state through ui-state', async () => {
    const res = await post(id, { revision: 0, command: { type: 'message', text: '杭州' }, locale: 'zh' }).expect(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = parseSse(res.text);
    expect(events[0].type).toBe('start');
    const done = events.at(-1)!;
    expect(done.type).toBe('done');
    if (done.type !== 'done') return;
    expect(done.message.metadata).toMatchObject({ revision: 1 });
    const state = TripUIStateSchema.parse((await request(server).get(`/api/conversations/${id}/ui-state`).set(...bearer(token)).expect(200)).body);
    expect(state).toEqual({ revision: 1, trip: done.trip, components: done.components });
  });

  it('answers validation, ownership and conflicts with JSON errors', async () => {
    await post(id, { content: 'old shape' }).expect(400);
    await post(othersId, { revision: 0, command: { type: 'message', text: 'x' } }).expect(404);
    await post(id, { revision: 3, command: { type: 'message', text: 'x' } }).expect(409);
    await post(id, { revision: 0, command: { type: 'confirm' } }).expect(409);
    await request(server).get(`/api/conversations/${othersId}/ui-state`).set(...bearer(token)).expect(404);
  });
});
