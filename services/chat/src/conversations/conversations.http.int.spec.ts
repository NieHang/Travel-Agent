import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createTestApp, createUser } from '../../test/helpers/app.js';
import { resetDb } from '../../test/helpers/db.js';
import { ConversationsService } from './conversations.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

describe('conversations HTTP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let token: string;
  let me: string;
  let other: string;

  const api = {
    get: (url: string) => request(server).get(url).set(...bearer(token)),
    post: (url: string) => request(server).post(url).set(...bearer(token)),
    patch: (url: string) => request(server).patch(url).set(...bearer(token)),
    delete: (url: string) => request(server).delete(url).set(...bearer(token)),
  };

  /** 直接用 Prisma 造会话与消息。消息的 createdAt 显式且互不相同。 */
  async function seed(userId: string, title: string, messageCount: number, updatedAt?: Date) {
    const c = await prisma.conversation.create({ data: { userId, title } });
    const base = Date.UTC(2026, 0, 1);
    for (let i = 0; i < messageCount; i++) {
      await prisma.message.create({
        data: {
          conversationId: c.id,
          role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
          content: `m${i}`,
          createdAt: new Date(base + i * 1000),
        },
      });
    }
    if (!updatedAt) return c;
    await prisma.$executeRaw`UPDATE "conversations" SET "updatedAt" = ${updatedAt} WHERE "id" = ${c.id}`;
    return prisma.conversation.findUniqueOrThrow({ where: { id: c.id } });
  }

  beforeAll(async () => {
    ({ app, prisma, server } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDb(prisma);
    const a = await createUser(app);
    const b = await createUser(app);
    token = a.accessToken;
    me = a.user.id;
    other = b.user.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('创建：未传标题存空串', async () => {
    const res = await api.post('/api/conversations').send({}).expect(201);
    expect(res.body).toMatchObject({ title: '' });
    expect(Object.keys(res.body).sort()).toEqual(['createdAt', 'id', 'title', 'updatedAt']);
  });

  it('列表：只含有消息的会话，按 updatedAt 倒序', async () => {
    await seed(me, 'old', 1, new Date('2026-01-01'));
    await seed(me, 'new', 1, new Date('2026-02-01'));
    await seed(me, 'empty', 0, new Date('2026-03-01'));
    const res = await api.get('/api/conversations').expect(200);
    expect(res.body.items.map((c: { title: string }) => c.title)).toEqual(['new', 'old']);
    expect(res.body.nextCursor).toBeNull();
  });

  it('列表：游标分页不重不漏，updatedAt 相同时按 id 稳定排序', async () => {
    const same = new Date('2026-05-01');
    for (let i = 0; i < 5; i++) await seed(me, `c${i}`, 1, same);
    const p1 = await api.get('/api/conversations?limit=2').expect(200);
    const p2 = await api.get(`/api/conversations?limit=2&cursor=${p1.body.nextCursor}`).expect(200);
    const p3 = await api.get(`/api/conversations?limit=2&cursor=${p2.body.nextCursor}`).expect(200);
    const ids = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((c: { id: string }) => c.id);
    expect(new Set(ids).size).toBe(5);
    expect(p3.body.nextCursor).toBeNull();
  });

  it('列表：非法游标与越界 limit 都是 400', async () => {
    await api.get('/api/conversations?cursor=garbage').expect(400);
    await api.get('/api/conversations?limit=51').expect(400);
  });

  it('搜索：不区分大小写的包含匹配；% 与 _ 按字面处理', async () => {
    await seed(me, 'Lisbon trip', 1);
    await seed(me, '100% fun', 1);
    await seed(me, 'a_b', 1);
    const titles = async (q: string) =>
      (await api.get(`/api/conversations?q=${encodeURIComponent(q)}`)).body.items.map(
        (c: { title: string }) => c.title,
      );
    expect(await titles('LISBON')).toEqual(['Lisbon trip']);
    expect(await titles('%')).toEqual(['100% fun']);
    expect(await titles('_')).toEqual(['a_b']);
    expect((await titles('   ')).length).toBe(3);
  });

  it('重命名：更新标题但不改变 updatedAt 与排序', async () => {
    const older = await seed(me, 'older', 1, new Date('2026-01-01'));
    await seed(me, 'newer', 1, new Date('2026-02-01'));
    const res = await api.patch(`/api/conversations/${older.id}`).send({ title: '  renamed  ' }).expect(200);
    expect(res.body).toMatchObject({ title: 'renamed', updatedAt: '2026-01-01T00:00:00.000Z' });
    expect((await api.get('/api/conversations')).body.items.map((c: { title: string }) => c.title)).toEqual([
      'newer',
      'renamed',
    ]);
    await api.patch(`/api/conversations/${older.id}`).send({ title: '' }).expect(400);
  });

  it('重命名：并发的 updatedAt 更新不会被回写旧值覆盖，标题照常更新', async () => {
    const c = await seed(me, 'before', 1, new Date('2026-01-01'));
    const newer = new Date('2026-06-01T00:00:00.000Z');
    // 模拟 rename 读到旧状态之后、写入之前，有消息发送把 updatedAt 推新。
    // 实现无关：旧实现在 findFirst 之后触发，新实现在原子语句之前触发。
    const bump = () =>
      prisma.$executeRaw`UPDATE "conversations" SET "updatedAt" = ${newer} WHERE "id" = ${c.id}`;
    const spied = new Proxy(prisma, {
      get(target, prop) {
        if (prop === 'conversation') {
          return new Proxy(target.conversation, {
            get(conv, key) {
              const v = (conv as never)[key] as unknown;
              if (key === 'findFirst') {
                return async (...a: unknown[]) => {
                  const r = await (v as (...x: unknown[]) => Promise<unknown>).apply(conv, a);
                  await bump();
                  return r;
                };
              }
              return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(conv) : v;
            },
          });
        }
        if (prop === '$queryRaw') {
          return async (...a: unknown[]) => {
            await bump();
            return (target.$queryRaw as (...x: unknown[]) => Promise<unknown>)(...a);
          };
        }
        const v = (target as never)[prop] as unknown;
        return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(target) : v;
      },
    });
    const svc = new ConversationsService(spied);
    const res = await svc.rename(me, c.id, 'after');
    expect(res).toMatchObject({ title: 'after', updatedAt: newer.toISOString() });
    const row = await prisma.conversation.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.title).toBe('after');
    expect(row.updatedAt.toISOString()).toBe(newer.toISOString());
  });

  it('删除：204，消息一并删除，再删是 404', async () => {
    const c = await seed(me, 'x', 3);
    await api.delete(`/api/conversations/${c.id}`).expect(204);
    expect(await prisma.message.count({ where: { conversationId: c.id } })).toBe(0);
    await api.delete(`/api/conversations/${c.id}`).expect(404);
  });

  it('消息：倒序分页，含 status 与 metadata', async () => {
    const c = await seed(me, 'x', 5);
    const p1 = await api.get(`/api/conversations/${c.id}/messages?limit=3`).expect(200);
    expect(p1.body.items).toHaveLength(3);
    expect(p1.body.items[0]).toMatchObject({ conversationId: c.id, status: 'complete', metadata: null });
    const p2 = await api.get(`/api/conversations/${c.id}/messages?limit=3&cursor=${p1.body.nextCursor}`).expect(200);
    expect(p2.body.items).toHaveLength(2);
    expect(p2.body.nextCursor).toBeNull();
    const times = [...p1.body.items, ...p2.body.items].map((m: { createdAt: string }) => m.createdAt);
    expect(times).toEqual([...times].sort().reverse());
    expect(new Set(times).size).toBe(5);
  });

  it('他人的会话一律 404 CONVERSATION_NOT_FOUND，且不出现在列表里', async () => {
    const theirs = await seed(other, 'secret', 1);
    // 惰性构造：supertest 在构造时就开始监听，同时构造多个会互相关掉服务。
    for (const req of [
      () => api.patch(`/api/conversations/${theirs.id}`).send({ title: 'x' }),
      () => api.delete(`/api/conversations/${theirs.id}`),
      () => api.get(`/api/conversations/${theirs.id}/messages`),
    ])
      await req().expect(404).expect((r) => expect(r.body.code).toBe('CONVERSATION_NOT_FOUND'));
    expect((await api.get('/api/conversations')).body.items).toEqual([]);
    expect(await prisma.conversation.count({ where: { id: theirs.id, title: 'secret' } })).toBe(1);
  });
});
