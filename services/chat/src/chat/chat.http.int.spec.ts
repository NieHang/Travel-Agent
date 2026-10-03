import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ChatStreamEventSchema } from '@autix/contracts';
import { bearer, createTestApp, createUser } from '../../test/helpers/app.js';
import { resetDb } from '../../test/helpers/db.js';
import { FAKE_REPLY_CHUNKS, FAKE_REQUIREMENTS } from '../llm/chat-reply/fakes.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/** 把 SSE 响应体解析成 `{ event, data }[]`。 */
function parseSse(text: string): { event: string; data: any }[] {
  return text
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((l) => l.startsWith('event: '))!.slice('event: '.length);
      const data = lines.find((l) => l.startsWith('data: '))!.slice('data: '.length);
      return { event, data: JSON.parse(data) };
    });
}

describe('chat HTTP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let token: string;
  let id: string;
  let othersId: string;

  beforeAll(async () => {
    ({ app, prisma, server } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDb(prisma);
    const a = await createUser(app);
    const b = await createUser(app);
    token = a.accessToken;
    id = (await prisma.conversation.create({ data: { userId: a.user.id, title: '' } })).id;
    othersId = (await prisma.conversation.create({ data: { userId: b.user.id, title: '' } })).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('SSE 响应头与事件格式', async () => {
    const res = await request(server)
      .post(`/api/conversations/${id}/messages`)
      .set(...bearer(token))
      .send({ content: '去里斯本' })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(res.headers['cache-control']).toBe('no-cache');
    const events = parseSse(res.text);
    expect(events[0].event).toBe('user_message');
    expect(
      events
        .filter((e) => e.event === 'delta')
        .map((e) => e.data.text)
        .join(''),
    ).toBe(FAKE_REPLY_CHUNKS.join(''));
    expect(events.find((e) => e.event === 'requirement')!.data).toEqual(FAKE_REQUIREMENTS);
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { message: { status: 'complete' } } });
    for (const e of events) expect(ChatStreamEventSchema.safeParse(e).success).toBe(true);

    // 每个事件都是 `event: <名>\ndata: <JSON>\n\n`。
    const blocks = res.text.split('\n\n');
    expect(blocks.pop()).toBe('');
    for (const block of blocks) expect(block).toMatch(/^event: [a-z_]+\ndata: \{.*\}$/);
    expect(events.at(-1)!.data.message.content).toBe(FAKE_REPLY_CHUNKS.join(''));
    expect(await prisma.message.count({ where: { conversationId: id } })).toBe(2);
  });

  it('流开始前的失败是普通 JSON 错误，且不落库', async () => {
    await request(server)
      .post(`/api/conversations/${id}/messages`)
      .send({ content: 'x' })
      .expect(401)
      .expect('Content-Type', /json/);
    await request(server)
      .post(`/api/conversations/${id}/messages`)
      .set(...bearer(token))
      .send({ content: '  ' })
      .expect(400)
      .expect('Content-Type', /json/)
      .expect((r) => expect(r.body.code).toBe('VALIDATION_FAILED'));
    await request(server)
      .post(`/api/conversations/${id}/messages`)
      .set(...bearer(token))
      .send({ content: 'a'.repeat(4001) })
      .expect(400)
      .expect('Content-Type', /json/);
    await request(server)
      .post(`/api/conversations/${othersId}/messages`)
      .set(...bearer(token))
      .send({ content: 'x' })
      .expect(404)
      .expect('Content-Type', /json/)
      .expect((r) => expect(r.body.code).toBe('CONVERSATION_NOT_FOUND'));
    expect(await prisma.message.count()).toBe(0);
  });

  it('发消息后会话出现在列表里', async () => {
    const list = () =>
      request(server)
        .get('/api/conversations')
        .set(...bearer(token))
        .expect(200);
    expect((await list()).body.items).toEqual([]);

    const content = '想去里斯本玩五天，预算一万左右，喜欢海鲜和老城区，不想太赶，求一份行程安排';
    expect(Array.from(content).length).toBeGreaterThan(30);
    await request(server)
      .post(`/api/conversations/${id}/messages`)
      .set(...bearer(token))
      .send({ content })
      .expect(200);

    const { items } = (await list()).body;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id, title: Array.from(content).slice(0, 30).join('') });

    // 消息列表按时间倒序：助手消息在前，用户消息在后。
    const page = await request(server)
      .get(`/api/conversations/${id}/messages`)
      .set(...bearer(token))
      .expect(200);
    expect(page.body.items.map((m: { role: string }) => m.role)).toEqual(['ASSISTANT', 'USER']);
  });

  it('限流：每用户每分钟 20 次，互不影响', async () => {
    const throttled = await createTestApp({ throttling: true });
    try {
      const a = await createUser(throttled.app);
      const b = await createUser(throttled.app);
      const convA = await prisma.conversation.create({ data: { userId: a.user.id, title: '' } });
      const convB = await prisma.conversation.create({ data: { userId: b.user.id, title: '' } });
      const send = (accessToken: string, conversationId: string) =>
        request(throttled.server)
          .post(`/api/conversations/${conversationId}/messages`)
          .set(...bearer(accessToken))
          .send({ content: 'x' });

      for (let i = 0; i < 20; i++) await send(a.accessToken, convA.id).expect(200);
      await send(a.accessToken, convA.id)
        .expect(429)
        .expect('Content-Type', /json/)
        .expect((r) => expect(r.body.code).toBe('RATE_LIMITED'))
        .expect((r) => expect(Number(r.headers['retry-after'])).toBeGreaterThan(0));
      await send(b.accessToken, convB.id).expect(200);
      // 被限流的那次请求没有落库：20 次 × 2 条。
      expect(await prisma.message.count({ where: { conversationId: convA.id } })).toBe(40);
    } finally {
      await throttled.app.close();
    }
  });
});
