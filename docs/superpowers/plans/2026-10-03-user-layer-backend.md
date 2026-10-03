# 用户层后端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Hilda 后端加上注册、登录、token 刷新与登出、会话管理、带历史的流式对话，并让除白名单外的所有接口都需要登录。

**Architecture:** 所有请求/响应 schema 先落在 `packages/contracts`，后端用它校验入参。在 `services/chat/src` 下新增 `common`、`audit`、`users`、`auth`、`conversations`、`chat` 六个模块；鉴权用 `@nestjs/jwt` 加自写的全局 guard；对话模块通过 `ChatReplyPort` 依赖模型，默认实现与测试用假实现都放在现有 `llm` 模块里。

**Tech Stack:** NestJS 12（ESM，Bun 运行）、Prisma 7 + PostgreSQL（pgvector）、zod 3、`@nestjs/jwt`、`@nestjs/throttler`、`@node-rs/argon2`、`cookie-parser`、vitest 4 + supertest。

**Spec:** [docs/superpowers/specs/2026-10-03-user-layer-backend-design.md](../specs/2026-10-03-user-layer-backend-design.md)。执行者需同时阅读 spec；本计划只写 spec 没有定下的决定。

## Global Constraints

- 分支 `feat/user-layer`。每个任务结束时提交一次，提交信息沿用仓库风格（`fea:` / `chore:` / `docs:` 前缀）。
- 代码是 ESM：相对导入必须带 `.js` 后缀。依赖注入沿用现有写法，构造函数参数显式写 `@Inject(类或令牌)`。
- 路由前缀写在控制器上（如 `@Controller('api/auth')`），不设全局前缀。
- 安装依赖用 `bun add`（在 `services/chat` 目录下）。安装后先读该包自带的 README 或类型定义确认与 Nest 12 的用法，再写代码。
- 改动 Turborepo 配置或命令前，按仓库根 `AGENTS.md` 的要求先读已安装 `turbo` 包自带的文档。本计划不需要改 `turbo.json`。
- 错误体一律为 `{ code, message, details? }`，`code` 取自契约的 `ErrorCode`。
- 数值常量逐字取自 spec：access token 15 分钟；refresh token 30 天；重用宽限 10 秒；过期 refresh token 保留 7 天；历史上限 20 条；抽取等待 15 秒；标题 30 字符；Cookie 名 `hilda_rt`，`Path=/api/auth`，`SameSite=Lax`。
- 字段规则逐字取自 spec 6.4：邮箱最长 254；密码 8–72 且含字母与数字；昵称 1–20；会话标题 1–60；消息 1–4000；`limit` 1–50 默认 20。
- 限流：注册与登录每分钟 10 次（按 IP）；刷新与登出每分钟 60 次（按 IP）；发消息每分钟 20 次（按用户）；其余不限流。
- 依赖数据库的测试命名为 `*.int.spec.ts`，只连接名字以 `_test` 结尾的数据库，不模拟 Prisma。其余测试命名为 `*.spec.ts`，不得依赖数据库。
- 不改动 `llm` 模块里现有的控制器与服务方法。

### 运行测试的命令

均在 `services/chat` 目录下执行。

| 目的 | 命令 |
|---|---|
| 单个非数据库测试 | `bunx vitest run <文件路径>` |
| 单个数据库测试 | `bunx vitest run --config vitest.config.int.ts <文件路径>` |
| 全部非数据库测试 | `bun run test` |
| 全部数据库测试 | `bun run test:int` |
| 类型检查与静态检查 | `bun run typecheck`、`bun run lint` |

## 与 spec 的三处偏差

写计划时核对仓库后发现，需在任务 1 中同步修正 spec：

1. spec 第 13 节默认 compose 里已有 PostgreSQL，实际 `infra/compose` 里没有数据库服务。测试库改为：在开发库所在的同一台 PostgreSQL 上建 `travel_agent_test`，由脚本创建并迁移（任务 2）。
2. 现有控制器会抛 Nest 自带的 404/400，未知路由也是 404，spec 的错误码表缺一个通用的未找到。新增 `NOT_FOUND`（HTTP 404）。
3. spec 8.3 没有说明「随登出或整链吊销而失效的 token 再次出现」怎么处理。定为返回 `REFRESH_INVALID` 并清 Cookie，不算盗用（见任务 6）。

## Review Focus

spec 隐含、最可能在真实使用中出问题的五类输入，各自的测试已加到负责该代码的任务里：

1. **邮箱的大小写与首尾空白**：用 ` Ann@Example.com ` 注册后，用 `ann@example.com` 能登录；再用 `ANN@example.com` 注册得到 `EMAIL_TAKEN`。（任务 6）
2. **含表情或生僻字的首条消息**：自动标题按字符而非 UTF-16 码元截断，第 30 个字符是表情时不产生半个代理对。（任务 10）
3. **搜索词含 `%` 或 `_`**：按字面匹配，`q=%` 不会匹配所有会话。（任务 8）
4. **畸形的请求**：`Authorization: Bearer`（无 token）、`Authorization: Basic xxx`、非 JSON 的请求体，分别得到 `TOKEN_INVALID`、`TOKEN_MISSING`、`VALIDATION_FAILED`，都不是 500。（任务 3、7）
5. **生成过程中会话被删除**：另一个标签页删掉会话后，保存助手消息会失败；流应当正常结束，进程不崩溃，不留下孤立数据。（任务 10）

## File Structure

```
packages/contracts/src/
  index.ts            统一导出；APP_NAME = 'Hilda'；保留现有 Requirement schema
  errors.ts           ErrorCode、ApiError
  auth.ts             字段规则、注册/登录请求、User、AuthResult
  users.ts            UpdateMeRequest
  conversations.ts    Conversation、分页、列表查询、创建/重命名请求
  chat.ts             Message、MessageMetadata、SendMessageRequest、SSE 事件

services/chat/
  .env.test.example               测试环境变量样例
  vitest.config.int.ts            数据库测试配置（串行）
  scripts/prepare-test-db.ts      建测试库并迁移
  prisma/schema.prisma            新增 3 个模型、2 个枚举；改 Conversation、Message
  test/setup-int.ts               加载 .env.test，校验库名
  test/helpers/app.ts             createTestApp、resetDb、createUser
  src/common/
    app.exception.ts              AppException
    all-exceptions.filter.ts      全局异常过滤器
    zod-validation.pipe.ts        ZodValidationPipe
    cursor.ts                     游标编解码
  src/config/auth.config.ts       loadAuthConfig、AUTH_CONFIG
  src/audit/                      audit.module.ts、audit.service.ts
  src/users/                      users.module.ts、users.service.ts、users.controller.ts
  src/auth/
    auth.module.ts
    password.service.ts           argon2id
    access-token.service.ts       JWT 签发与校验
    refresh-token.ts              生成与哈希（纯函数）
    auth.service.ts               注册、登录、刷新、登出
    auth.controller.ts            四个接口与 Cookie
    jwt-auth.guard.ts             全局 guard
    decorators.ts                 Public、CurrentUser
    app-throttler.guard.ts        限流 guard（按用户或 IP）
  src/conversations/              conversations.module.ts、.service.ts、.controller.ts
  src/chat/
    chat.module.ts
    chat.service.ts               send() 生成器
    chat.controller.ts            SSE 输出
    derive-title.ts
  src/llm/chat-reply/
    chat-reply.port.ts            ChatReplyPort、ChatTurn、CHAT_REPLY_PORT
    model-chat-reply.ts           真实模型实现
    fakes.ts                      FakeChatReply、FakeRequirementService 及固定数据
  src/llm/llm.module.ts           按 LLM_FAKE 绑定实现（仅改 providers 与 exports）
  src/app.module.ts               挂载新模块、全局 guard/filter、cookie 解析
  src/main.ts                     CORS credentials、trust proxy、启动校验
```

---

### Task 1: 契约

**Files:**
- Create: `packages/contracts/src/errors.ts`、`auth.ts`、`users.ts`、`conversations.ts`、`chat.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `docs/superpowers/specs/2026-10-03-user-layer-backend-design.md`（三处偏差）
- Test: `services/chat/src/contracts.spec.ts`（契约包自身没有测试运行器，借用后端的 vitest）

**Interfaces:**
- Produces（均从 `@autix/contracts` 导出，每个 schema 同名导出推断类型，如 `User`）：
  - `errors.ts`：`ErrorCodeSchema`（spec 6.2 的全部码，另加 `NOT_FOUND`）、`ApiErrorSchema`
  - `auth.ts`：`LocaleSchema`、`EmailSchema`、`PasswordSchema`、`NicknameSchema`、`RegisterRequestSchema`、`LoginRequestSchema`、`UserSchema`、`AuthResultSchema`
  - `users.ts`：`UpdateMeRequestSchema`
  - `conversations.ts`：`ConversationSchema`、`CreateConversationRequestSchema`、`RenameConversationRequestSchema`、`ListConversationsQuerySchema`、`ListMessagesQuerySchema`、`pageSchema(item)`
  - `chat.ts`：`MessageSchema`、`MessageMetadataSchema`、`SendMessageRequestSchema`、`ChatStreamEventSchema`
  - `ChatStreamEvent` 是按 `event` 字段区分的联合：`{ event: 'user_message', data: { message } }`、`{ event: 'delta', data: { text } }`、`{ event: 'requirement', data: { requirements } }`、`{ event: 'done', data: { message } }`、`{ event: 'error', data: { code: 'MODEL_FAILED', message } }`

- [ ] **Step 1: 写失败的测试** `services/chat/src/contracts.spec.ts`

```ts
import {
  APP_NAME, EmailSchema, PasswordSchema, NicknameSchema, RegisterRequestSchema,
  LoginRequestSchema, UpdateMeRequestSchema, RenameConversationRequestSchema,
  ListConversationsQuerySchema, SendMessageRequestSchema, ErrorCodeSchema,
  ChatStreamEventSchema,
} from '@autix/contracts';

describe('contracts', () => {
  it('品牌名', () => expect(APP_NAME).toBe('Hilda'));

  it('邮箱去空白并转小写', () => {
    expect(EmailSchema.parse('  Ann@Example.COM ')).toBe('ann@example.com');
    expect(EmailSchema.safeParse('not-an-email').success).toBe(false);
    expect(EmailSchema.safeParse(`${'a'.repeat(250)}@b.co`).success).toBe(false);
  });

  it('密码规则', () => {
    expect(PasswordSchema.safeParse('abcdefg1').success).toBe(true);
    expect(PasswordSchema.safeParse('abcdef1').success).toBe(false); // 7 位
    expect(PasswordSchema.safeParse('abcdefgh').success).toBe(false); // 无数字
    expect(PasswordSchema.safeParse('12345678').success).toBe(false); // 无字母
    expect(PasswordSchema.safeParse(`a1${'x'.repeat(71)}`).success).toBe(false); // 73 位
  });

  it('昵称去空白后 1–20', () => {
    expect(NicknameSchema.parse('  安  ')).toBe('安');
    expect(NicknameSchema.safeParse('   ').success).toBe(false);
    expect(NicknameSchema.safeParse('a'.repeat(21)).success).toBe(false);
  });

  it('注册的 locale 缺省为 zh，登录密码只要求非空', () => {
    const r = RegisterRequestSchema.parse({ email: 'a@b.co', password: 'abcdefg1', nickname: 'A' });
    expect(r.locale).toBe('zh');
    expect(LoginRequestSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(LoginRequestSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });

  it('更新资料至少一项', () => {
    expect(UpdateMeRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateMeRequestSchema.safeParse({ locale: 'en' }).success).toBe(true);
    expect(UpdateMeRequestSchema.safeParse({ locale: 'fr' }).success).toBe(false);
  });

  it('标题与消息长度', () => {
    expect(RenameConversationRequestSchema.safeParse({ title: 'a'.repeat(61) }).success).toBe(false);
    expect(RenameConversationRequestSchema.parse({ title: '  行程  ' }).title).toBe('行程');
    expect(SendMessageRequestSchema.safeParse({ content: '   ' }).success).toBe(false);
    expect(SendMessageRequestSchema.safeParse({ content: 'a'.repeat(4001) }).success).toBe(false);
  });

  it('列表查询：limit 从字符串转换，默认 20，上限 50；空 q 视为未传', () => {
    expect(ListConversationsQuerySchema.parse({}).limit).toBe(20);
    expect(ListConversationsQuerySchema.parse({ limit: '5' }).limit).toBe(5);
    expect(ListConversationsQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(ListConversationsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(ListConversationsQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
  });

  it('错误码与事件', () => {
    for (const c of ['VALIDATION_FAILED','TOKEN_MISSING','TOKEN_EXPIRED','TOKEN_INVALID',
      'INVALID_CREDENTIALS','REFRESH_INVALID','REFRESH_REUSED','CONVERSATION_NOT_FOUND',
      'NOT_FOUND','EMAIL_TAKEN','RATE_LIMITED','MODEL_FAILED','INTERNAL_ERROR'])
      expect(ErrorCodeSchema.safeParse(c).success).toBe(true);
    expect(ChatStreamEventSchema.safeParse({ event: 'delta', data: { text: 'hi' } }).success).toBe(true);
    expect(ChatStreamEventSchema.safeParse({ event: 'nope', data: {} }).success).toBe(false);
  });
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `bunx vitest run src/contracts.spec.ts`
Expected: FAIL，导入的名字不存在。

- [ ] **Step 3: 实现契约文件**

按 Interfaces 列出的名字与 spec 6.3、6.4 实现。要点：`UserSchema`、`ConversationSchema`、`MessageSchema` 的时间字段是 ISO 字符串；`MessageSchema.metadata` 可为 `null`；`MessageMetadataSchema` 为 `{ requirements?: Requirement[], requirementError?: true }`；`pageSchema(item)` 返回 `{ items: item[], nextCursor: string | null }`；`index.ts` 保留现有 `RequirementSchema` 与 `RequirementResultSchema`，把 `APP_NAME` 改为 `'Hilda'`。

- [ ] **Step 4: 运行并确认通过**

Run: `bunx vitest run src/contracts.spec.ts`
Expected: PASS。再跑 `bun run typecheck`（仓库根目录），确认前端对 `APP_NAME` 的引用仍通过。

- [ ] **Step 5: 修正 spec**

在 spec 8.3 第 4 步后补一句：已吊销且 `replacedBy` 为空的记录（随登出或整链吊销而失效）返回 `REFRESH_INVALID` 并清除 Cookie，不记 `TOKEN_REUSE`；第 3、4 步只适用于 `replacedBy` 非空的记录。

在 spec 6.2 的表中加一行 `NOT_FOUND | 404 | 路由不存在或其他未找到`。把 spec 第 13 节最后一段里关于数据库的描述改为：测试库 `travel_agent_test` 建在开发库所在的 PostgreSQL 上，由 `bun run db:test:prepare` 创建并迁移。

- [ ] **Step 6: 提交**

```bash
git add packages/contracts services/chat/src/contracts.spec.ts docs/superpowers/specs/2026-10-03-user-layer-backend-design.md
git commit -m "fea: user layer contracts"
```

---

### Task 2: 数据模型与测试库

**Files:**
- Modify: `services/chat/prisma/schema.prisma`、`services/chat/package.json`、`services/chat/vitest.config.ts`
- Create: `services/chat/prisma/migrations/<时间戳>_user_layer/migration.sql`（由 Prisma 生成后手工加清表语句）
- Create: `services/chat/vitest.config.int.ts`、`services/chat/test/setup-int.ts`、`services/chat/scripts/prepare-test-db.ts`、`services/chat/.env.test.example`、`services/chat/test/helpers/db.ts`
- Test: `services/chat/test/schema.int.spec.ts`

**Interfaces:**
- Produces:
  - Prisma 模型 `User`、`RefreshToken`、`AuditLog`，枚举 `AuditEvent`、`MessageStatus`，`Message.status`，`Conversation.user` 关系（字段与索引见 spec 第 4 节）
  - `test/helpers/db.ts`：`createTestPrisma(): PrismaService`；`resetDb(prisma): Promise<void>`（清空 `audit_logs`、`refresh_tokens`、`messages`、`conversations`、`users`）
  - 脚本：`bun run db:test:prepare`、`bun run test:int`

- [ ] **Step 1: 搭测试库设施**

- `.env.test.example`：`DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/travel_agent_test`、`JWT_ACCESS_SECRET=test-secret-test-secret-test-secret-0000`、`LLM_FAKE=1`。复制为 `.env.test` 并填入真实连接信息；确认 `.env.test` 已被 git 忽略，没有就加进 `services/chat/.gitignore`。
- `test/setup-int.ts`：用 `dotenv` 加载 `.env.test`（`override: true`）；若 `DATABASE_URL` 的库名不以 `_test` 结尾则抛错 `Refusing to run: database name must end with _test`。
- `vitest.config.int.ts`：`include: ['**/*.int.spec.ts']`，`setupFiles: ['./test/setup-int.ts']`，`fileParallelism: false`（所有文件共用一个库）。
- `vitest.config.ts`：加 `exclude`，排除 `**/*.int.spec.ts`（保留 vitest 默认排除项）。
- `scripts/prepare-test-db.ts`：加载 `.env.test`；用 `pg` 连到同一服务器的 `postgres` 库，目标库不存在则 `CREATE DATABASE`；再以该 `DATABASE_URL` 运行 `prisma migrate deploy`。同样校验库名后缀。
- `package.json` 加脚本：`"db:test:prepare": "bun run scripts/prepare-test-db.ts"`、`"test:int": "vitest run --config vitest.config.int.ts"`。

- [ ] **Step 2: 写失败的测试** `test/schema.int.spec.ts`

```ts
import { createTestPrisma, resetDb } from './helpers/db.js';

describe('schema', () => {
  const prisma = createTestPrisma();
  beforeAll(async () => { await prisma.$connect(); await resetDb(prisma); });
  afterAll(() => prisma.$disconnect());

  it('邮箱唯一', async () => {
    const data = { email: 'a@b.co', passwordHash: 'h', nickname: 'A' };
    const u = await prisma.user.create({ data });
    expect(u.locale).toBe('zh');
    await expect(prisma.user.create({ data })).rejects.toThrow();
  });

  it('消息默认 complete；删除用户级联删除会话、消息、refresh token，审计日志保留', async () => {
    const u = await prisma.user.create({ data: { email: 'c@d.co', passwordHash: 'h', nickname: 'C' } });
    const c = await prisma.conversation.create({ data: { userId: u.id, title: '' } });
    const m = await prisma.message.create({ data: { conversationId: c.id, role: 'USER', content: 'hi' } });
    expect(m.status).toBe('complete');
    await prisma.refreshToken.create({ data: { userId: u.id, familyId: 'f', tokenHash: 'x', expiresAt: new Date() } });
    await prisma.auditLog.create({ data: { userId: u.id, event: 'REGISTER' } });
    await prisma.user.delete({ where: { id: u.id } });
    expect(await prisma.conversation.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.message.count({ where: { conversationId: c.id } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { userId: u.id } })).toBe(1);
  });

  it('会话必须属于存在的用户', async () => {
    await expect(prisma.conversation.create({ data: { userId: 'nope', title: '' } })).rejects.toThrow();
  });
});
```

- [ ] **Step 3: 运行并确认失败**

Run: `bun run db:test:prepare`，然后 `bunx vitest run --config vitest.config.int.ts test/schema.int.spec.ts`
Expected: FAIL，`prisma.user` 不存在。

- [ ] **Step 4: 改 schema 并生成迁移**

按 spec 第 4 节修改 `schema.prisma`。运行 `bunx prisma migrate dev --name user_layer --create-only`，在生成的 `migration.sql` 最前面加一行 `TRUNCATE TABLE "messages", "conversations";`（spec 4.3：加外键前清空），再运行 `bunx prisma migrate dev` 应用到开发库，`bun run db:generate` 重新生成客户端。实现 `test/helpers/db.ts`。

- [ ] **Step 5: 运行并确认通过**

Run: `bun run db:test:prepare && bunx vitest run --config vitest.config.int.ts test/schema.int.spec.ts`
Expected: PASS。再跑 `bun run test`，确认默认测试不再包含 `*.int.spec.ts` 且与改动前结果一致。

- [ ] **Step 6: 提交**

```bash
git add services/chat/prisma services/chat/package.json services/chat/vitest.config.ts services/chat/vitest.config.int.ts services/chat/test services/chat/scripts services/chat/.env.test.example services/chat/.gitignore
git commit -m "fea: user layer schema and test database"
```

---

### Task 3: 通用设施

**Files:**
- Create: `services/chat/src/common/app.exception.ts`、`all-exceptions.filter.ts`、`zod-validation.pipe.ts`、`cursor.ts`
- Test: `services/chat/src/common/cursor.spec.ts`、`services/chat/src/common/http.spec.ts`

**Interfaces:**
- Consumes: `ErrorCode`（任务 1）
- Produces:
  - `class AppException extends HttpException { readonly code: ErrorCode; readonly details?: unknown; constructor(code: ErrorCode, status: number, details?: unknown) }`
  - `class AllExceptionsFilter implements ExceptionFilter`
  - `class ZodValidationPipe implements PipeTransform { constructor(schema: ZodTypeAny) }`，用法 `@Body(new ZodValidationPipe(Schema))`、`@Query(new ZodValidationPipe(Schema))`
  - `encodeCursor(sortKey: Date, id: string): string`；`decodeCursor(raw: string): { sortKey: Date; id: string }`

- [ ] **Step 1: 写失败的测试**

`cursor.spec.ts`：

```ts
it('往返', () => {
  const d = new Date('2026-10-03T08:00:00.123Z');
  expect(decodeCursor(encodeCursor(d, 'abc'))).toEqual({ sortKey: d, id: 'abc' });
});
it('游标是 base64url', () => expect(encodeCursor(new Date(), 'a')).toMatch(/^[A-Za-z0-9_-]+$/));
it.each(['', '!!!', 'bm90LWpzb24', Buffer.from('{"t":"bad","id":"a"}').toString('base64url')])(
  '非法游标 %s 抛 VALIDATION_FAILED', (raw) => {
    expect(() => decodeCursor(raw)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });
```

`http.spec.ts`：在测试文件内定义一个临时控制器，挂上过滤器与管道后用 supertest 断言。

```ts
// 临时控制器的路由：
//  POST /t/body   @Body(new ZodValidationPipe(z.object({ n: z.number() })))  → 返回入参
//  GET  /t/app    抛 new AppException('EMAIL_TAKEN', 409)
//  GET  /t/boom   抛 new Error('secret detail')
//  GET  /t/nest   抛 new BadRequestException('x')
it('校验失败', async () => {
  const res = await request(server).post('/t/body').send({ n: 'x' }).expect(400);
  expect(res.body.code).toBe('VALIDATION_FAILED');
  expect(res.body.details.fieldErrors.n).toEqual(expect.any(Array));
});
it('业务异常', () => request(server).get('/t/app').expect(409).expect((r) => expect(r.body.code).toBe('EMAIL_TAKEN')));
it('未知异常不泄露细节', async () => {
  const res = await request(server).get('/t/boom').expect(500);
  expect(res.body.code).toBe('INTERNAL_ERROR');
  expect(JSON.stringify(res.body)).not.toContain('secret detail');
});
it('Nest 400 与非 JSON 请求体都是 VALIDATION_FAILED', async () => {
  await request(server).get('/t/nest').expect(400).expect((r) => expect(r.body.code).toBe('VALIDATION_FAILED'));
  await request(server).post('/t/body').set('Content-Type', 'application/json').send('{bad').expect(400)
    .expect((r) => expect(r.body.code).toBe('VALIDATION_FAILED'));
});
it('未知路由是 NOT_FOUND', () => request(server).get('/nope').expect(404).expect((r) => expect(r.body.code).toBe('NOT_FOUND')));
```

- [ ] **Step 2: 运行并确认失败**

Run: `bunx vitest run src/common`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

- 游标：对 `{ t: sortKey 的 ISO 字符串, id }` 做 JSON 后 base64url 编码；解码时任何解析失败、`t` 不是合法日期、`id` 非字符串，都抛 `AppException('VALIDATION_FAILED', 400)`。
- 管道：`safeParse` 失败时抛 `AppException('VALIDATION_FAILED', 400, { fieldErrors: error.flatten().fieldErrors })`。
- 过滤器的映射规则：

| 异常 | 状态码 | `code` |
|---|---|---|
| `AppException` | 自带 | 自带（含 `details`） |
| `ThrottlerException` 或其他状态 429 的 `HttpException` | 429 | `RATE_LIMITED` |
| 状态 404 的 `HttpException` | 404 | `NOT_FOUND` |
| 其他 4xx 的 `HttpException` | 原状态 | `VALIDATION_FAILED` |
| 其余一切 | 500 | `INTERNAL_ERROR`，用 Nest `Logger` 记录原始错误 |

响应头已发送时（SSE 进行中）过滤器不再写响应。`message` 字段：`AppException` 用 `code` 本身，其余用通用英文短语，不回传原始错误信息。

- [ ] **Step 4: 运行并确认通过**

Run: `bunx vitest run src/common`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add services/chat/src/common
git commit -m "fea: error filter, zod pipe and cursor helpers"
```

---

### Task 4: 鉴权基础件（配置、密码、token）

**Files:**
- Create: `services/chat/src/config/auth.config.ts`、`services/chat/src/auth/password.service.ts`、`access-token.service.ts`、`refresh-token.ts`
- Modify: `services/chat/package.json`（`bun add @nestjs/jwt @node-rs/argon2`）
- Test: `services/chat/src/config/auth.config.spec.ts`、`services/chat/src/auth/password.service.spec.ts`、`access-token.service.spec.ts`、`refresh-token.spec.ts`

**Interfaces:**
- Consumes: `AppException`（任务 3）
- Produces:
  - `interface AuthConfig { accessSecret: string; accessTtl: string; refreshTtlDays: number; cookieSecure: boolean; trustProxy: boolean; llmFake: boolean }`
  - `loadAuthConfig(env?: NodeJS.ProcessEnv): AuthConfig`；`const AUTH_CONFIG = Symbol('AUTH_CONFIG')`
  - `PasswordService`：`hash(plain: string): Promise<string>`、`verify(hash: string, plain: string): Promise<boolean>`、`verifyDummy(plain: string): Promise<void>`
  - `AccessTokenService`（注入 `AUTH_CONFIG`）：`sign(userId: string): Promise<string>`、`verify(token: string): Promise<{ userId: string }>`
  - `generateRefreshToken(): string`、`hashRefreshToken(raw: string): string`

- [ ] **Step 1: 写失败的测试**

```ts
// auth.config.spec.ts
const base = { JWT_ACCESS_SECRET: 's'.repeat(32) };
it('默认值', () => expect(loadAuthConfig(base)).toEqual({
  accessSecret: 's'.repeat(32), accessTtl: '15m', refreshTtlDays: 30,
  cookieSecure: false, trustProxy: false, llmFake: false }));
it('缺少或过短的密钥启动失败', () => {
  expect(() => loadAuthConfig({})).toThrow(/JWT_ACCESS_SECRET/);
  expect(() => loadAuthConfig({ JWT_ACCESS_SECRET: 's'.repeat(31) })).toThrow(/JWT_ACCESS_SECRET/);
});
it('生产环境禁止假模型', () => {
  expect(() => loadAuthConfig({ ...base, NODE_ENV: 'production', LLM_FAKE: '1' })).toThrow(/LLM_FAKE/);
  expect(loadAuthConfig({ ...base, LLM_FAKE: '1' }).llmFake).toBe(true);
});
it('读取覆盖值', () => {
  const c = loadAuthConfig({ ...base, JWT_ACCESS_TTL: '5m', REFRESH_TTL_DAYS: '7', COOKIE_SECURE: 'true', TRUST_PROXY: 'true' });
  expect(c).toMatchObject({ accessTtl: '5m', refreshTtlDays: 7, cookieSecure: true, trustProxy: true });
});

// password.service.spec.ts
it('argon2id 哈希并校验', async () => {
  const h = await svc.hash('abcdefg1');
  expect(h).toMatch(/^\$argon2id\$/);
  expect(await svc.verify(h, 'abcdefg1')).toBe(true);
  expect(await svc.verify(h, 'abcdefg2')).toBe(false);
});
it('损坏的哈希返回 false 而不抛错', async () => expect(await svc.verify('garbage', 'x')).toBe(false));
it('verifyDummy 不抛错', async () => { await expect(svc.verifyDummy('x')).resolves.toBeUndefined(); });

// access-token.service.spec.ts
it('签发后可校验', async () => expect(await svc.verify(await svc.sign('u1'))).toEqual({ userId: 'u1' }));
it('载荷只有 sub、iat、exp', async () => {
  const payload = JSON.parse(Buffer.from((await svc.sign('u1')).split('.')[1], 'base64url').toString());
  expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub']);
});
it('过期', async () => {
  const expired = new AccessTokenService({ ...config, accessTtl: '-1s' });
  await expect(svc.verify(await expired.sign('u1'))).rejects.toMatchObject({ code: 'TOKEN_EXPIRED', status: 401 });
});
it.each(['', 'abc', 'a.b.c'])('无效 token %s', async (t) =>
  expect(svc.verify(t)).rejects.toMatchObject({ code: 'TOKEN_INVALID' }));
it('其他密钥签发的 token 无效', async () => {
  const other = new AccessTokenService({ ...config, accessSecret: 'x'.repeat(32) });
  await expect(svc.verify(await other.sign('u1'))).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
});

// refresh-token.spec.ts
it('每次不同，43 个 base64url 字符', () => {
  const a = generateRefreshToken();
  expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(generateRefreshToken()).not.toBe(a);
});
it('哈希是确定的 64 位十六进制，且不等于原文', () => {
  expect(hashRefreshToken('x')).toBe(hashRefreshToken('x'));
  expect(hashRefreshToken('x')).toMatch(/^[0-9a-f]{64}$/);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `bunx vitest run src/config/auth.config.spec.ts src/auth`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

`AccessTokenService` 直接使用 `@nestjs/jwt` 的 `JwtService`（HS256），构造函数接收 `AuthConfig`，这样测试可以不经 Nest 容器直接 `new`。`verifyDummy` 对一个模块加载时预先算好的固定哈希执行一次 `verify`。

- [ ] **Step 4: 运行并确认通过**

Run: `bunx vitest run src/config/auth.config.spec.ts src/auth`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add services/chat/src/config/auth.config.ts services/chat/src/config/auth.config.spec.ts services/chat/src/auth services/chat/package.json bun.lock
git commit -m "fea: auth config, password hashing and token primitives"
```

---

### Task 5: 审计与用户服务

**Files:**
- Create: `services/chat/src/audit/audit.module.ts`、`audit.service.ts`、`services/chat/src/users/users.module.ts`、`users.service.ts`
- Test: `services/chat/src/audit/audit.int.spec.ts`、`services/chat/src/users/users.int.spec.ts`

**Interfaces:**
- Consumes: `createTestPrisma`、`resetDb`（任务 2）；`AppException`（任务 3）；契约类型 `User`（任务 1）
- Produces:
  - `interface ClientContext { ip?: string; userAgent?: string }`（定义在 `audit.service.ts` 并导出）
  - `AuditService.record(event: AuditEvent, input: ClientContext & { userId?: string; metadata?: object }): Promise<void>`，永不抛错
  - `UsersService.create(input: { email: string; passwordHash: string; nickname: string; locale: 'zh' | 'en' }): Promise<UserRow>`，邮箱冲突抛 `AppException('EMAIL_TAKEN', 409)`
  - `UsersService.findByEmail(email: string): Promise<UserRow | null>`、`findById(id: string): Promise<UserRow | null>`
  - `UsersService.update(id: string, patch: { nickname?: string; locale?: 'zh' | 'en' }): Promise<UserRow>`
  - `toUserContract(row: UserRow): User`（导出的纯函数，不含 `passwordHash`）
  - `UserRow` 即 Prisma 的 `User` 类型

- [ ] **Step 1: 写失败的测试**

```ts
// audit.int.spec.ts
it('写入一条记录，userAgent 截断到 255', async () => {
  await audit.record('LOGIN_FAILURE', { ip: '1.2.3.4', userAgent: 'u'.repeat(300), metadata: { email: 'a@b.co' } });
  const row = await prisma.auditLog.findFirstOrThrow();
  expect(row).toMatchObject({ event: 'LOGIN_FAILURE', userId: null, ip: '1.2.3.4', metadata: { email: 'a@b.co' } });
  expect(row.userAgent).toHaveLength(255);
});
it('写入失败不抛错', async () => {
  const broken = new AuditService({ auditLog: { create: () => Promise.reject(new Error('db down')) } } as never);
  await expect(broken.record('LOGOUT', {})).resolves.toBeUndefined();
});

// users.int.spec.ts
it('创建与查询', async () => {
  const u = await users.create({ email: 'a@b.co', passwordHash: 'h', nickname: 'A', locale: 'en' });
  expect(await users.findByEmail('a@b.co')).toMatchObject({ id: u.id });
  expect(await users.findById('missing')).toBeNull();
});
it('邮箱冲突', async () => {
  await expect(users.create({ email: 'a@b.co', passwordHash: 'h', nickname: 'B', locale: 'zh' }))
    .rejects.toMatchObject({ code: 'EMAIL_TAKEN', status: 409 });
});
it('更新', async () => {
  const u = await users.findByEmail('a@b.co');
  expect(await users.update(u!.id, { locale: 'zh' })).toMatchObject({ locale: 'zh', nickname: 'A' });
});
it('契约形状不含密码哈希', async () => {
  const c = toUserContract((await users.findByEmail('a@b.co'))!);
  expect(Object.keys(c).sort()).toEqual(['createdAt', 'email', 'id', 'locale', 'nickname']);
  expect(c.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `bunx vitest run --config vitest.config.int.ts src/audit src/users`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

`UsersService.create` 捕获 Prisma 唯一约束错误（`P2002`）转成 `EMAIL_TAKEN`，不要先查后插。两个模块各自导出其服务。

- [ ] **Step 4: 运行并确认通过**

Run: `bunx vitest run --config vitest.config.int.ts src/audit src/users`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add services/chat/src/audit services/chat/src/users
git commit -m "fea: audit and users services"
```

---

### Task 6: 认证服务

**Files:**
- Create: `services/chat/src/auth/auth.service.ts`
- Test: `services/chat/src/auth/auth.service.int.spec.ts`

**Interfaces:**
- Consumes: `UsersService`、`toUserContract`、`AuditService`、`ClientContext`（任务 5）；`PasswordService`、`AccessTokenService`、`generateRefreshToken`、`hashRefreshToken`、`AuthConfig`（任务 4）；`RegisterRequest`、`LoginRequest`、`User`（任务 1）
- Produces:
  - `interface AuthSession { accessToken: string; user: User; refreshToken: string; refreshExpiresAt: Date }`
  - `class RefreshException extends AppException { readonly clearCookie: boolean }`
  - `const REUSE_GRACE_MS = 10_000`、`const EXPIRED_RETENTION_DAYS = 7`
  - `AuthService.register(input: RegisterRequest, ctx: ClientContext): Promise<AuthSession>`
  - `AuthService.login(input: LoginRequest, ctx: ClientContext): Promise<AuthSession>`
  - `AuthService.refresh(raw: string | undefined, ctx: ClientContext): Promise<AuthSession>`
  - `AuthService.logout(raw: string | undefined, ctx: ClientContext): Promise<void>`

入参已由契约 schema 规范化（邮箱已转小写）。

- [ ] **Step 1: 写失败的测试** `auth.service.int.spec.ts`

测试直接构造服务（真实 Prisma、真实密码与 token 服务），每个 `it` 前 `resetDb`。用 `vi.useFakeTimers({ toFake: ['Date'] })` 推进时间。

```ts
const input = { email: 'ann@example.com', password: 'abcdefg1', nickname: 'Ann', locale: 'zh' as const };
const ctx = { ip: '1.1.1.1', userAgent: 'ua' };

it('注册：建用户、发 token、记审计', async () => {
  const s = await auth.register(input, ctx);
  expect(s.user).toMatchObject({ email: 'ann@example.com', nickname: 'Ann' });
  expect(await tokens.verify(s.accessToken)).toEqual({ userId: s.user.id });
  const row = await prisma.refreshToken.findFirstOrThrow();
  expect(row.tokenHash).toBe(hashRefreshToken(s.refreshToken));
  expect(row.tokenHash).not.toBe(s.refreshToken);
  expect(row).toMatchObject({ ip: '1.1.1.1', userAgent: 'ua', revokedAt: null });
  expect(s.refreshExpiresAt.getTime() - Date.now()).toBeCloseTo(30 * 86_400_000, -4);
  expect(await prisma.auditLog.count({ where: { event: 'REGISTER', userId: s.user.id } })).toBe(1);
});

it('邮箱大小写与空白：规范化后的重复注册被拒，登录成功', async () => {
  await auth.register(RegisterRequestSchema.parse({ ...input, email: ' Ann@Example.com ' }), ctx);
  await expect(auth.register(RegisterRequestSchema.parse({ ...input, email: 'ANN@example.com' }), ctx))
    .rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
  await expect(auth.login(LoginRequestSchema.parse({ email: 'ann@EXAMPLE.com', password: 'abcdefg1' }), ctx))
    .resolves.toBeDefined();
});

it('登录失败不区分原因，并记审计', async () => {
  await auth.register(input, ctx);
  for (const bad of [{ email: input.email, password: 'wrongpw1' }, { email: 'nobody@example.com', password: 'abcdefg1' }])
    await expect(auth.login(bad, ctx)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
  const logs = await prisma.auditLog.findMany({ where: { event: 'LOGIN_FAILURE' }, orderBy: { createdAt: 'asc' } });
  expect(logs.map((l) => l.metadata)).toEqual([{ email: input.email }, { email: 'nobody@example.com' }]);
  expect(logs[1].userId).toBeNull();
});

it('每次登录是一条新链', async () => {
  await auth.register(input, ctx);
  await auth.login(input, ctx);
  const families = new Set((await prisma.refreshToken.findMany()).map((r) => r.familyId));
  expect(families.size).toBe(2);
  expect(await prisma.auditLog.count({ where: { event: 'LOGIN_SUCCESS' } })).toBe(1);
});

it('刷新：轮换并沿用 familyId', async () => {
  const s1 = await auth.register(input, ctx);
  const s2 = await auth.refresh(s1.refreshToken, ctx);
  expect(s2.refreshToken).not.toBe(s1.refreshToken);
  const [old, fresh] = await prisma.refreshToken.findMany({ orderBy: { createdAt: 'asc' } });
  expect(old.revokedAt).not.toBeNull();
  expect(old.replacedBy).toBe(fresh.id);
  expect(fresh.familyId).toBe(old.familyId);
  expect(await prisma.auditLog.count({ where: { event: 'TOKEN_REFRESH' } })).toBe(1);
});

it.each([undefined, 'unknown-token'])('刷新：缺失或未知的 token %s', async (raw) => {
  await expect(auth.refresh(raw, ctx)).rejects.toMatchObject({ code: 'REFRESH_INVALID', clearCookie: true });
});

it('刷新：过期', async () => {
  const s = await auth.register(input, ctx);
  vi.setSystemTime(Date.now() + 31 * 86_400_000);
  await expect(auth.refresh(s.refreshToken, ctx)).rejects.toMatchObject({ code: 'REFRESH_INVALID', clearCookie: true });
});

it('刷新：宽限期内重复使用旧 token，不吊销链、不清 Cookie', async () => {
  const s1 = await auth.register(input, ctx);
  const s2 = await auth.refresh(s1.refreshToken, ctx);
  vi.setSystemTime(Date.now() + 9_000);
  await expect(auth.refresh(s1.refreshToken, ctx)).rejects.toMatchObject({ code: 'REFRESH_INVALID', clearCookie: false });
  await expect(auth.refresh(s2.refreshToken, ctx)).resolves.toBeDefined();
});

it('刷新：超出宽限期重复使用，吊销整条链并记审计', async () => {
  const s1 = await auth.register(input, ctx);
  const s2 = await auth.refresh(s1.refreshToken, ctx);
  vi.setSystemTime(Date.now() + 11_000);
  await expect(auth.refresh(s1.refreshToken, ctx)).rejects.toMatchObject({ code: 'REFRESH_REUSED', clearCookie: true });
  // 链已被整体吊销：链上其余 token 没有 replacedBy，按无效处理，不重复记盗用
  await expect(auth.refresh(s2.refreshToken, ctx)).rejects.toMatchObject({ code: 'REFRESH_INVALID', clearCookie: true });
  expect(await prisma.auditLog.count({ where: { event: 'TOKEN_REUSE' } })).toBe(1);
  const log = await prisma.auditLog.findFirstOrThrow({ where: { event: 'TOKEN_REUSE' } });
  expect(log.metadata).toHaveProperty('familyId');
});

it('刷新：并发只有一个成功', async () => {
  const s = await auth.register(input, ctx);
  const results = await Promise.allSettled([auth.refresh(s.refreshToken, ctx), auth.refresh(s.refreshToken, ctx)]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(1);
});

it('吊销只影响本条链', async () => {
  const a = await auth.register(input, ctx);
  const b = await auth.login(input, ctx);
  await auth.logout(a.refreshToken, ctx);
  await expect(auth.refresh(b.refreshToken, ctx)).resolves.toBeDefined();
});

it('登出：吊销整条链、记审计、幂等', async () => {
  const s1 = await auth.register(input, ctx);
  const s2 = await auth.refresh(s1.refreshToken, ctx);
  await auth.logout(s2.refreshToken, ctx);
  expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  expect(await prisma.auditLog.count({ where: { event: 'LOGOUT' } })).toBe(1);
  await expect(auth.logout(s2.refreshToken, ctx)).resolves.toBeUndefined();
  await expect(auth.logout(undefined, ctx)).resolves.toBeUndefined();
});

it('登录成功后清理过期超过 7 天的记录', async () => {
  const s = await auth.register(input, ctx);
  await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 8 * 86_400_000) } });
  await prisma.refreshToken.create({ data: { userId: s.user.id, familyId: 'keep', tokenHash: 'k',
    expiresAt: new Date(Date.now() - 6 * 86_400_000) } });
  await auth.login(input, ctx);
  const left = await prisma.refreshToken.findMany();
  expect(left.map((r) => r.familyId)).toContain('keep');
  expect(left).toHaveLength(2); // 'keep' 与本次登录新发的
});

it('审计写入失败时登录仍成功', async () => {
  await auth.register(input, ctx);
  vi.spyOn(prisma.auditLog, 'create').mockRejectedValueOnce(new Error('db down'));
  await expect(auth.login(input, ctx)).resolves.toBeDefined();
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `bunx vitest run --config vitest.config.int.ts src/auth/auth.service.int.spec.ts`
Expected: FAIL，`AuthService` 不存在。

- [ ] **Step 3: 实现 `AuthService`**

刷新按 spec 8.3 的四步写。吊销用条件更新来保证并发安全：

```ts
const { count } = await tx.refreshToken.updateMany({
  where: { id: row.id, revokedAt: null },
  data: { revokedAt: now },
});
// count === 1 → 轮换；count === 0 → 重新读取该行的 revokedAt，按 REUSE_GRACE_MS 区分并发与盗用
```

区分两种已吊销的记录：`replacedBy` 非空表示它是被轮换掉的，按 `revokedAt` 是否在 `REUSE_GRACE_MS` 内分为并发（`REFRESH_INVALID`，不清 Cookie）与盗用（吊销整条链，`REFRESH_REUSED`）；`replacedBy` 为空表示它是随登出或整链吊销而失效的，一律返回 `REFRESH_INVALID` 并清 Cookie，不记 `TOKEN_REUSE`。登录时邮箱不存在要调用 `verifyDummy`。

- [ ] **Step 4: 运行并确认通过**

Run: `bunx vitest run --config vitest.config.int.ts src/auth/auth.service.int.spec.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add services/chat/src/auth/auth.service.ts services/chat/src/auth/auth.service.int.spec.ts
git commit -m "fea: auth service with refresh token rotation"
```

---

### Task 7: 认证与用户接口、全局鉴权、应用装配

**Files:**
- Create: `services/chat/src/auth/auth.controller.ts`、`jwt-auth.guard.ts`、`decorators.ts`、`app-throttler.guard.ts`、`auth.module.ts`、`services/chat/src/users/users.controller.ts`、`services/chat/src/config/config.module.ts`、`services/chat/test/helpers/app.ts`
- Modify: `services/chat/src/users/users.module.ts`、`services/chat/src/app.module.ts`、`services/chat/src/main.ts`、`services/chat/src/app.controller.ts`（给 `health` 加 `@Public()`）、`services/chat/package.json`（`bun add @nestjs/throttler cookie-parser`，`bun add -d @types/cookie-parser`）
- Modify: `services/chat/src/llm/advanced.http.spec.ts`、`services/chat/test/requirement.spec.ts`、`services/chat/test/app.e2e-spec.ts`（这三个导入了 `AppModule`，会受全局 guard 影响；其余现有测试只导入 `LlmModule`，不受影响）
- Test: `services/chat/src/auth/auth.http.int.spec.ts`、`services/chat/src/users/users.http.int.spec.ts`

**Interfaces:**
- Consumes: `AuthService`、`AuthSession`、`RefreshException`（任务 6）；`AccessTokenService`、`AUTH_CONFIG`、`loadAuthConfig`（任务 4）；`UsersService`、`toUserContract`（任务 5）；过滤器与管道（任务 3）
- Produces:
  - `const REFRESH_COOKIE = 'hilda_rt'`
  - `Public()`：方法或类装饰器；`CurrentUser()`：参数装饰器，取值类型 `{ userId: string }`
  - `JwtAuthGuard`、`AppThrottlerGuard`（都作为普通 provider 注册，再用 `useExisting` 挂到 `APP_GUARD` / `@UseGuards`，这样测试可以 `overrideProvider`）
  - `test/helpers/app.ts`：
    - `createTestApp(opts?: { throttling?: boolean }): Promise<{ app: INestApplication; prisma: PrismaService; server: Server }>`，默认关闭限流；使用完整的 `AppModule` 与真实测试库
    - `createUser(app, overrides?: Partial<{ email: string; password: string; nickname: string }>): Promise<{ user: User; accessToken: string; refreshToken: string }>`，直接调用 `AuthService.register`，不走 HTTP
    - `bearer(token: string): [string, string]`，返回 `['Authorization', 'Bearer …']`

- [ ] **Step 1: 写失败的测试**

`auth.http.int.spec.ts`：

```ts
const body = { email: 'ann@example.com', password: 'abcdefg1', nickname: 'Ann' };
const cookieOf = (res: Response) => String(res.headers['set-cookie']?.[0] ?? '');

it('注册：201、AuthResult、Cookie 属性正确、响应体不含 refresh token', async () => {
  const res = await request(server).post('/api/auth/register').send(body).expect(201);
  expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'user']);
  const c = cookieOf(res);
  expect(c).toMatch(/^hilda_rt=[A-Za-z0-9_-]{43};/);
  expect(c).toContain('HttpOnly');
  expect(c).toContain('SameSite=Lax');
  expect(c).toContain('Path=/api/auth');
  expect(c).toMatch(/Max-Age=2592000/);
  expect(c).not.toContain('Secure');
});
it('注册：校验失败与邮箱已注册', async () => {
  const bad = await request(server).post('/api/auth/register').send({ ...body, password: 'short' }).expect(400);
  expect(bad.body.code).toBe('VALIDATION_FAILED');
  expect(bad.body.details.fieldErrors.password).toBeDefined();
  await request(server).post('/api/auth/register').send(body).expect(201);
  await request(server).post('/api/auth/register').send(body).expect(409)
    .expect((r) => expect(r.body.code).toBe('EMAIL_TAKEN'));
});
it('登录：成功 200，失败 401 INVALID_CREDENTIALS', async () => { /* 两种失败原因的响应体完全相同 */ });
it('刷新：用 Cookie 换新 token 并轮换 Cookie', async () => {
  const reg = await request(server).post('/api/auth/register').send(body);
  const res = await request(server).post('/api/auth/refresh').set('Cookie', cookieOf(reg)).expect(200);
  expect(res.body.user.email).toBe(body.email);
  expect(cookieOf(res).split(';')[0]).not.toBe(cookieOf(reg).split(';')[0]);
});
it('刷新：无 Cookie 返回 REFRESH_INVALID 并清除 Cookie', async () => {
  const res = await request(server).post('/api/auth/refresh').expect(401);
  expect(res.body.code).toBe('REFRESH_INVALID');
  expect(cookieOf(res)).toMatch(/hilda_rt=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/);
});
it('刷新：宽限期内的旧 Cookie 返回 REFRESH_INVALID 但不清除 Cookie', async () => {
  const reg = await request(server).post('/api/auth/register').send(body);
  await request(server).post('/api/auth/refresh').set('Cookie', cookieOf(reg)).expect(200);
  const res = await request(server).post('/api/auth/refresh').set('Cookie', cookieOf(reg)).expect(401);
  expect(res.body.code).toBe('REFRESH_INVALID');
  expect(res.headers['set-cookie']).toBeUndefined();
});
it('登出：204、清 Cookie、之后刷新失败；无 Cookie 也是 204', async () => { /* … */ });
it('refresh Cookie 不会被认证以外的路径接收（Path 限定）', async () => { /* 断言 Path=/api/auth 即可 */ });
```

同一文件里的 guard 行为：

```ts
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
it('过期的 access token → TOKEN_EXPIRED', async () => { /* 用 accessTtl 为 -1s 的 AccessTokenService 签发 */ });
it('白名单：/health 无需登录', () => request(server).get('/health').expect(200));
it('现有 demo 接口受保护', () =>
  request(server).post('/api/langchain/prompt-preview').send({ input: 'x' }).expect(401));
```

限流（单独的 `describe`，`createTestApp({ throttling: true })`）：

```ts
it('登录每分钟 10 次，第 11 次 429 并带 Retry-After', async () => {
  for (let i = 0; i < 10; i++) await request(server).post('/api/auth/login').send({ email: 'x@y.co', password: 'p' });
  const res = await request(server).post('/api/auth/login').send({ email: 'x@y.co', password: 'p' }).expect(429);
  expect(res.body.code).toBe('RATE_LIMITED');
  expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
});
it('刷新的额度是 60，不受登录额度影响', async () => {
  for (let i = 0; i < 11; i++) await request(server).post('/api/auth/refresh').expect(401);
});
it('未标注限流的接口不限流', async () => {
  for (let i = 0; i < 30; i++) await request(server).get('/health').expect(200);
});
```

`users.http.int.spec.ts`：

```ts
it('GET /api/users/me', async () => {
  const { user, accessToken } = await createUser(app);
  await request(server).get('/api/users/me').set(...bearer(accessToken)).expect(200).expect(user);
});
it('PATCH /api/users/me 改语言；空对象 400', async () => {
  const { accessToken } = await createUser(app);
  const res = await request(server).patch('/api/users/me').set(...bearer(accessToken)).send({ locale: 'en' }).expect(200);
  expect(res.body.locale).toBe('en');
  await request(server).patch('/api/users/me').set(...bearer(accessToken)).send({}).expect(400);
});
it('用户被删除后旧 token 访问 /me 返回 TOKEN_INVALID', async () => { /* 删除用户行后请求，期望 401 */ });
```

注释为 `/* … */` 的三处，断言内容已在用例名里写明，按相邻用例的写法补全。

- [ ] **Step 2: 运行并确认失败**

Run: `bunx vitest run --config vitest.config.int.ts src/auth/auth.http.int.spec.ts src/users/users.http.int.spec.ts`
Expected: FAIL，`test/helpers/app.ts` 与控制器不存在。

- [ ] **Step 3: 实现**

- `AuthController`（`@Controller('api/auth')`，类上 `@Public()` 与 `@UseGuards(AppThrottlerGuard)`）：四个接口。注册返回 201，登录与刷新显式 `@HttpCode(200)`，登出 204。响应体只含 `accessToken` 与 `user`。设置 Cookie：`httpOnly: true, sameSite: 'lax', path: '/api/auth', secure: config.cookieSecure, maxAge: refreshExpiresAt - now`。捕获 `RefreshException` 时按 `clearCookie` 决定是否清 Cookie，然后原样抛出。`ClientContext` 取自 `req.ip` 与 `user-agent` 头。
- 限流额度用 `@Throttle` 标在方法上：注册、登录 `{ limit: 10, ttl: 60_000 }`；刷新、登出 `{ limit: 60, ttl: 60_000 }`。`ThrottlerModule` 不注册为全局 guard，只在 `AuthController` 与（任务 10 的）发消息接口上用 `@UseGuards(AppThrottlerGuard)`，从而满足「其余接口不限流」。
- `AppThrottlerGuard extends ThrottlerGuard`：重写 `getTracker`，有 `req.user` 时返回 `user:${userId}`，否则返回 `req.ip`。
- `JwtAuthGuard`：`@Public()` 的路由放行；无 `Authorization` 头或方案不是 `Bearer` → `TOKEN_MISSING`；`Bearer` 后为空 → `TOKEN_INVALID`；其余交给 `AccessTokenService.verify`。成功后设置 `req.user = { userId }`。
- `UsersController`（`@Controller('api/users')`）：`GET me`、`PATCH me`。`findById` 为空时抛 `AppException('TOKEN_INVALID', 401)`。
- `AppModule`：导入新模块；注册 `{ provide: APP_GUARD, useExisting: JwtAuthGuard }`、`{ provide: APP_FILTER, useClass: AllExceptionsFilter }`、`{ provide: AUTH_CONFIG, useFactory: () => loadAuthConfig() }`（放在新建的 `@Global()` 模块 `src/config/config.module.ts` 里并导出，供各处注入）；实现 `configure(consumer)` 对所有路由应用 `cookie-parser`，这样测试里的应用也带 Cookie 解析。
- `main.ts`：`enableCors` 增加 `credentials: true`；`config.trustProxy` 为真时 `app.set('trust proxy', true)`。`loadAuthConfig()` 在容器创建时执行，配置错误会让启动失败。
- `test/helpers/app.ts`：`throttling` 为 `false` 时 `overrideProvider(AppThrottlerGuard).useValue({ canActivate: () => true })`。

- [ ] **Step 4: 运行并确认通过**

Run: `bunx vitest run --config vitest.config.int.ts src/auth src/users`
Expected: PASS。

- [ ] **Step 5: 修复三个受全局 guard 影响的现有测试**

在这三个文件里：模块编译前设置 `process.env.JWT_ACCESS_SECRET`（32 位以上）；用 `new AccessTokenService(loadAuthConfig()).sign('test-user')` 得到 token 并加到每个请求上。`test/app.e2e-spec.ts` 现在断言的 `GET /` 路由并不存在，改为两条断言：`GET /health` 无 token 返回 200；`GET /hello` 无 token 返回 401 且 `code` 为 `TOKEN_MISSING`。

Run: `bun run test` 与 `bun run test:e2e`
Expected: 全部 PASS，且用例数量不少于改动前。

- [ ] **Step 6: 提交**

```bash
git add services/chat/src services/chat/test services/chat/package.json bun.lock
git commit -m "fea: auth and user endpoints behind a global jwt guard"
```

---

### Task 8: 会话

**Files:**
- Create: `services/chat/src/conversations/conversations.module.ts`、`conversations.service.ts`、`conversations.controller.ts`
- Modify: `services/chat/src/app.module.ts`
- Test: `services/chat/src/conversations/conversations.http.int.spec.ts`

**Interfaces:**
- Consumes: `createTestApp`、`createUser`、`bearer`（任务 7）；`encodeCursor`、`decodeCursor`、`ZodValidationPipe`、`AppException`（任务 3）；契约（任务 1）
- Produces:
  - `ConversationsService.assertOwned(userId: string, id: string): Promise<ConversationRow>`，不存在或不属于该用户时抛 `AppException('CONVERSATION_NOT_FOUND', 404)`
  - `ConversationsService.list(userId, query: { cursor?: string; limit: number; q?: string }): Promise<Page<Conversation>>`
  - `ConversationsService.create(userId: string, title?: string): Promise<Conversation>`
  - `ConversationsService.rename(userId: string, id: string, title: string): Promise<Conversation>`
  - `ConversationsService.remove(userId: string, id: string): Promise<void>`
  - `ConversationsService.listMessages(userId, id, query: { cursor?: string; limit: number }): Promise<Page<Message>>`
  - `toConversationContract(row): Conversation`、`toMessageContract(row): Message`（导出的纯函数，任务 10 复用）

- [ ] **Step 1: 写失败的测试** `conversations.http.int.spec.ts`

辅助函数 `seed(userId, title, messageCount, updatedAt?)` 直接用 Prisma 造数据。

```ts
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
  expect(res.body.items.map((c) => c.title)).toEqual(['new', 'old']);
  expect(res.body.nextCursor).toBeNull();
});

it('列表：游标分页不重不漏，updatedAt 相同时按 id 稳定排序', async () => {
  const same = new Date('2026-05-01');
  for (let i = 0; i < 5; i++) await seed(me, `c${i}`, 1, same);
  const p1 = await api.get('/api/conversations?limit=2').expect(200);
  const p2 = await api.get(`/api/conversations?limit=2&cursor=${p1.body.nextCursor}`).expect(200);
  const p3 = await api.get(`/api/conversations?limit=2&cursor=${p2.body.nextCursor}`).expect(200);
  const ids = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((c) => c.id);
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
    (await api.get(`/api/conversations?q=${encodeURIComponent(q)}`)).body.items.map((c) => c.title);
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
  expect((await api.get('/api/conversations')).body.items.map((c) => c.title)).toEqual(['newer', 'renamed']);
  await api.patch(`/api/conversations/${older.id}`).send({ title: '' }).expect(400);
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
  const times = [...p1.body.items, ...p2.body.items].map((m) => m.createdAt);
  expect(times).toEqual([...times].sort().reverse());
});

it('他人的会话一律 404 CONVERSATION_NOT_FOUND，且不出现在列表里', async () => {
  const theirs = await seed(other, 'secret', 1);
  for (const req of [
    api.patch(`/api/conversations/${theirs.id}`).send({ title: 'x' }),
    api.delete(`/api/conversations/${theirs.id}`),
    api.get(`/api/conversations/${theirs.id}/messages`),
  ]) await req.expect(404).expect((r) => expect(r.body.code).toBe('CONVERSATION_NOT_FOUND'));
  expect((await api.get('/api/conversations')).body.items).toEqual([]);
  expect(await prisma.conversation.count({ where: { id: theirs.id, title: 'secret' } })).toBe(1);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `bunx vitest run --config vitest.config.int.ts src/conversations`
Expected: FAIL，路由不存在（404 `NOT_FOUND`）。

- [ ] **Step 3: 实现**

- 分页：取 `limit + 1` 条，多出的一条用来判断是否有下一页。游标条件：

```ts
where: { OR: [{ updatedAt: { lt: sortKey } }, { updatedAt: sortKey, id: { lt: id } }] }
orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }]
```

消息列表同理，排序键换成 `createdAt`。
- 列表过滤空会话：`messages: { some: {} }`。搜索：`title: { contains: q, mode: 'insensitive' }`；若 `%`、`_` 的测试不通过，说明当前 Prisma 版本没有转义通配符，改为手动转义后再传入。
- 重命名时在 `data` 里显式写回原 `updatedAt`，否则 `@updatedAt` 会自动更新它。
- 所有改写操作先 `assertOwned`。

- [ ] **Step 4: 运行并确认通过**

Run: `bunx vitest run --config vitest.config.int.ts src/conversations`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add services/chat/src/conversations services/chat/src/app.module.ts
git commit -m "fea: conversation endpoints with search and cursor pagination"
```

---

### Task 9: 带历史的回复端口与假模型

**Files:**
- Create: `services/chat/src/llm/chat-reply/chat-reply.port.ts`、`model-chat-reply.ts`、`fakes.ts`
- Modify: `services/chat/src/llm/llm.module.ts`（只改 `providers` 与 `exports`）
- Test: `services/chat/src/llm/chat-reply/chat-reply.spec.ts`

**Interfaces:**
- Consumes: 现有 `createChatModel()`、`RequirementService`
- Produces:
  - `type ChatTurn = { role: 'user' | 'assistant'; content: string }`
  - `interface ChatReplyPort { streamReply(history: ChatTurn[], signal: AbortSignal): AsyncIterable<string> }`
  - `const CHAT_REPLY_PORT = Symbol('CHAT_REPLY_PORT')`
  - `const TRAVEL_SYSTEM_PROMPT: string`
  - `class ModelChatReply implements ChatReplyPort`
  - `class FakeChatReply implements ChatReplyPort`；`const FAKE_REPLY_CHUNKS = ['好的，', '这是一段', '用于测试的回复。']`
  - `class FakeRequirementService { extract(input: string): Promise<RequirementResult> }`；`const FAKE_REQUIREMENTS = { requirements: [{ action: '规划行程', constraints: ['测试数据'], entities: ['行程'] }] }`
  - `LlmModule` 导出 `CHAT_REPLY_PORT`；`LLM_FAKE=1` 时 `CHAT_REPLY_PORT` 绑定 `FakeChatReply`，`RequirementService` 令牌绑定 `FakeRequirementService`；否则分别绑定 `ModelChatReply` 与真实的 `RequirementService`

前端端到端测试会断言 `FAKE_REPLY_CHUNKS` 拼接后的文本与 `FAKE_REQUIREMENTS`，这两个常量的值不得改动。

- [ ] **Step 1: 写失败的测试** `chat-reply.spec.ts`

真实实现的测试沿用现有 `filesystem.http.spec.ts` 的做法：起一个本地 HTTP 服务冒充模型接口，把 `OPENAI_BASE_URL` 指向它。

```ts
it('假实现依次输出固定分块', async () => {
  const out: string[] = [];
  for await (const c of new FakeChatReply().streamReply([], new AbortController().signal)) out.push(c);
  expect(out).toEqual(FAKE_REPLY_CHUNKS);
});
it('假实现在中止后停止输出', async () => {
  const ac = new AbortController();
  const out: string[] = [];
  for await (const c of new FakeChatReply().streamReply([], ac.signal)) { out.push(c); ac.abort(); }
  expect(out).toEqual([FAKE_REPLY_CHUNKS[0]]);
});
it('假抽取返回固定结果', async () =>
  expect(await new FakeRequirementService().extract('x')).toEqual(FAKE_REQUIREMENTS));

it('真实实现：系统提示词在最前，历史按顺序与角色传给模型，流式输出文本块', async () => {
  // 本地服务以 SSE 返回两个增量 '你' '好'，并记录收到的请求体
  const out: string[] = [];
  for await (const c of new ModelChatReply().streamReply(
    [{ role: 'user', content: '去里斯本' }, { role: 'assistant', content: '几天？' }, { role: 'user', content: '5 天' }],
    new AbortController().signal)) out.push(c);
  expect(out.join('')).toBe('你好');
  expect(received.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  expect(received.messages[0].content).toBe(TRAVEL_SYSTEM_PROMPT);
  expect(received.messages[3].content).toBe('5 天');
});
it('真实实现：不输出空文本块', async () => { /* 本地服务夹带一个空增量，断言 out 里没有空串 */ });

it.each([['1', FakeChatReply], [undefined, ModelChatReply]])(
  'LLM_FAKE=%s 时 LlmModule 绑定对应实现', async (flag, cls) => {
    vi.stubEnv('LLM_FAKE', flag as string);
    const mod = await Test.createTestingModule({ imports: [LlmModule] }).compile();
    expect(mod.get(CHAT_REPLY_PORT)).toBeInstanceOf(cls);
  });
```

- [ ] **Step 2: 运行并确认失败**

Run: `bunx vitest run src/llm/chat-reply`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

`TRAVEL_SYSTEM_PROMPT` 的内容固定为：

```
你是 Hilda，一位旅行规划助手。根据用户的目的地、天数、预算和偏好给出具体可执行的建议。信息不足时先提出最关键的一个问题。使用用户所用的语言回答，保持简洁。
```

`ModelChatReply` 用 `createChatModel().stream(messages, { signal })`，只产出非空的文本内容。`LlmModule` 的两个绑定用 `useFactory` 在模块初始化时读取 `process.env.LLM_FAKE`。现有的 `LlmService`、控制器和其他 provider 不动。

- [ ] **Step 4: 运行并确认通过**

Run: `bunx vitest run src/llm`
Expected: 新测试 PASS，`llm` 目录下原有测试结果不变。

- [ ] **Step 5: 提交**

```bash
git add services/chat/src/llm/chat-reply services/chat/src/llm/llm.module.ts
git commit -m "fea: history-aware chat reply port with fake implementations"
```

---

### Task 10: 对话

**Files:**
- Create: `services/chat/src/chat/chat.module.ts`、`chat.service.ts`、`chat.controller.ts`、`derive-title.ts`
- Modify: `services/chat/src/app.module.ts`、`services/chat/README.md`（新增环境变量与测试库的使用说明）
- Test: `services/chat/src/chat/derive-title.spec.ts`、`services/chat/src/chat/chat.service.int.spec.ts`、`services/chat/src/chat/chat.http.int.spec.ts`

**Interfaces:**
- Consumes: `CHAT_REPLY_PORT`、`ChatReplyPort`、`ChatTurn`、`FAKE_REPLY_CHUNKS`、`FAKE_REQUIREMENTS`（任务 9）；`RequirementService`（现有）；`ConversationsService.assertOwned`、`toMessageContract`（任务 8）；`AppThrottlerGuard`、`CurrentUser`、测试辅助（任务 7）；`ChatStreamEvent`、`SendMessageRequestSchema`（任务 1）
- Produces:
  - `deriveTitle(content: string): string`
  - `const HISTORY_LIMIT = 20`、`const REQUIREMENT_WAIT_MS = 15_000`、`const TITLE_LENGTH = 30`
  - `ChatService.send(conversationId: string, content: string, signal: AbortSignal): AsyncGenerator<ChatStreamEvent>`（归属校验由控制器在调用前完成）
  - `POST /api/conversations/:id/messages`

- [ ] **Step 1: 写失败的测试**

`derive-title.spec.ts`：

```ts
it('压缩连续空白并截取前 30 个字符', () => {
  expect(deriveTitle('  去\n\n里斯本   5 天  ')).toBe('去 里斯本 5 天');
  expect(deriveTitle('a'.repeat(40))).toBe('a'.repeat(30));
});
it('按字符而非码元截断，不切开表情', () => {
  const t = deriveTitle('a'.repeat(29) + '😀' + 'tail');
  expect(Array.from(t)).toHaveLength(30);
  expect(t.endsWith('😀')).toBe(true);
  expect(t.isWellFormed()).toBe(true);
});
```

`chat.service.int.spec.ts`：直接构造 `ChatService`，注入可编排的假端口与假抽取服务。辅助函数 `collect(gen)` 收集全部事件；`port(chunks, opts?)` 返回按 `chunks` 输出的端口，`opts.failAfter` 表示输出若干块后抛错，并把收到的 `history` 存到 `port.lastHistory`。

```ts
it('正常完成：事件顺序、落库、标题、updatedAt', async () => {
  const before = (await prisma.conversation.findUniqueOrThrow({ where: { id } })).updatedAt;
  const events = await collect(chat(port(['你', '好']), extractOk).send(id, '去里斯本 5 天', signal));
  expect(events.map((e) => e.event)).toEqual(expect.arrayContaining(['user_message', 'delta', 'delta', 'requirement', 'done']));
  expect(events[0].event).toBe('user_message');
  expect(events.at(-1)!.event).toBe('done');
  const [user, assistant] = await prisma.message.findMany({ where: { conversationId: id }, orderBy: { createdAt: 'asc' } });
  expect(user).toMatchObject({ role: 'USER', content: '去里斯本 5 天', status: 'complete' });
  expect(assistant).toMatchObject({ role: 'ASSISTANT', content: '你好', status: 'complete',
    metadata: { requirements: FAKE_REQUIREMENTS.requirements } });
  const conv = await prisma.conversation.findUniqueOrThrow({ where: { id } });
  expect(conv.title).toBe('去里斯本 5 天');
  expect(conv.updatedAt.getTime()).toBeGreaterThan(before.getTime());
});

it('已有标题时不覆盖', async () => { /* 会话标题预设为 '我的行程'，发送后仍是 '我的行程' */ });

it('历史：最近 20 条非空消息，按时间正序，含本条，角色映射正确', async () => {
  // 预置 25 条交替的用户/助手消息（内容 m0…m24），其中 m10 的内容为空串
  const p = port(['ok']);
  await collect(chat(p, extractOk).send(id, 'now', signal));
  expect(p.lastHistory).toHaveLength(20);
  expect(p.lastHistory.at(-1)).toEqual({ role: 'user', content: 'now' });
  expect(p.lastHistory.map((t) => t.content)).not.toContain('');
  expect(p.lastHistory[0].content).toBe('m5'); // now + m24…m5 去掉空的 m10，共 20 条
});

it('抽取失败不影响回复：无 requirement 事件，metadata 标记失败', async () => {
  const events = await collect(chat(port(['ok']), extractFails).send(id, 'x', signal));
  expect(events.map((e) => e.event)).not.toContain('requirement');
  expect(events.at(-1)!.event).toBe('done');
  expect((await lastAssistant()).metadata).toEqual({ requirementError: true });
});

it('抽取结果为空：无 requirement 事件，metadata 为 null', async () => { /* extract 返回 { requirements: [] } */ });

it('抽取超过 15 秒按失败处理', async () => {
  vi.useFakeTimers();
  const pending = collect(chat(port(['ok']), extractNeverResolves).send(id, 'x', signal));
  await vi.advanceTimersByTimeAsync(15_000);
  const events = await pending;
  expect(events.at(-1)!.event).toBe('done');
  expect((await lastAssistant()).metadata).toEqual({ requirementError: true });
});

it('上游出错：error 事件，已生成部分以 error 状态落库', async () => {
  const events = await collect(chat(port(['半', '句'], { failAfter: 2 }), extractOk).send(id, 'x', signal));
  const last = events.at(-1)!;
  expect(last).toMatchObject({ event: 'error', data: { code: 'MODEL_FAILED', message: { status: 'error', content: '半句' } } });
  expect(events.map((e) => e.event)).not.toContain('done');
});

it('上游在首个分块前出错：助手消息内容为空、状态 error', async () => { /* failAfter: 0 */ });

it('客户端中止：已生成部分以 partial 落库，不再产出事件', async () => {
  const ac = new AbortController();
  const gen = chat(port(['一', '二', '三']), extractOk).send(id, 'x', ac.signal);
  const seen: string[] = [];
  for await (const e of gen) { seen.push(e.event); if (e.event === 'delta') { ac.abort(); break; } }
  expect(seen).toEqual(['user_message', 'delta']);
  expect(await lastAssistant()).toMatchObject({ status: 'partial', content: '一' });
  expect(await prisma.message.count({ where: { conversationId: id } })).toBe(2);
});

it('生成过程中会话被删除：流正常结束，不抛错，不留孤立消息', async () => {
  const p = port(['一', '二'], { onChunk: (i) => i === 0 ? prisma.conversation.delete({ where: { id } }) : undefined });
  await expect(collect(chat(p, extractOk).send(id, 'x', signal))).resolves.toBeDefined();
  expect(await prisma.message.count({ where: { conversationId: id } })).toBe(0);
});
```

`chat.http.int.spec.ts`（`createTestApp()`，测试环境 `LLM_FAKE=1`）：辅助函数 `parseSse(text)` 把响应体解析成 `{ event, data }[]`。

```ts
it('SSE 响应头与事件格式', async () => {
  const res = await request(server).post(`/api/conversations/${id}/messages`).set(...bearer(token))
    .send({ content: '去里斯本' }).expect(200);
  expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
  expect(res.headers['cache-control']).toBe('no-cache');
  const events = parseSse(res.text);
  expect(events[0].event).toBe('user_message');
  expect(events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('')).toBe(FAKE_REPLY_CHUNKS.join(''));
  expect(events.find((e) => e.event === 'requirement')!.data).toEqual(FAKE_REQUIREMENTS);
  expect(events.at(-1)).toMatchObject({ event: 'done', data: { message: { status: 'complete' } } });
  for (const e of events) expect(ChatStreamEventSchema.safeParse(e).success).toBe(true);
});

it('流开始前的失败是普通 JSON 错误，且不落库', async () => {
  await request(server).post(`/api/conversations/${id}/messages`).send({ content: 'x' }).expect(401);
  await request(server).post(`/api/conversations/${id}/messages`).set(...bearer(token)).send({ content: '  ' })
    .expect(400).expect('Content-Type', /json/);
  await request(server).post(`/api/conversations/${othersId}/messages`).set(...bearer(token)).send({ content: 'x' })
    .expect(404).expect((r) => expect(r.body.code).toBe('CONVERSATION_NOT_FOUND'));
  expect(await prisma.message.count()).toBe(0);
});

it('发消息后会话出现在列表里', async () => { /* 发送前列表为空，发送后含该会话且标题为消息前 30 字 */ });

it('限流：每用户每分钟 20 次，互不影响', async () => {
  // createTestApp({ throttling: true })
  for (let i = 0; i < 20; i++) await send(tokenA).expect(200);
  await send(tokenA).expect(429).expect((r) => expect(r.body.code).toBe('RATE_LIMITED'));
  await send(tokenB).expect(200);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `bunx vitest run src/chat/derive-title.spec.ts` 与 `bunx vitest run --config vitest.config.int.ts src/chat`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

- `deriveTitle`：用 `Array.from` 按字符切分后取前 `TITLE_LENGTH` 个。
- `ChatService.send` 按 spec 7.4 的八个步骤实现。助手消息必须恰好保存一次，三条出口共用一个保存函数：

| 出口 | `status` | 之后 |
|---|---|---|
| 回复流正常结束 | `complete` | 产出 `done` |
| 回复流抛错且 `signal` 未中止 | `error` | 产出 `error` |
| `signal` 已中止，或调用方提前结束迭代 | `partial` | 不再产出 |

  用 `try / catch / finally` 加一个「已保存」标记实现：调用方 `break` 时生成器的 `finally` 会执行，在那里补存 `partial`。保存助手消息与更新会话 `updatedAt` 时，若会话已不存在（外键错误 `P2003` 或记录不存在 `P2025`），吞掉错误并结束。
- 抽取与回复并行启动。抽取的 Promise 一创建就挂上 `catch`，避免在回复流进行期间成为未处理的拒绝。抽取先于回复完成时立即产出 `requirement`；回复先完成时再等抽取，最长 `REQUIREMENT_WAIT_MS`。
- 传给 `streamReply` 的信号与传入的 `signal` 联动，中止时模型调用与等待抽取同时停止。
- `ChatController`（`@Controller('api/conversations')`，方法上 `@UseGuards(AppThrottlerGuard)` 与 `@Throttle({ default: { limit: 20, ttl: 60_000 } })`）：先用管道校验请求体，再 `assertOwned`，然后才写 SSE 响应头（`Content-Type: text/event-stream`、`Cache-Control: no-cache`、`Connection: keep-alive`）并 `flushHeaders`。每个事件写成 `event: <名>\ndata: <JSON>\n\n`。监听响应的 `close` 事件触发中止，写法参照现有 `LlmController.sendStream`。
- 因为全局 guard 先于限流 guard 执行，`AppThrottlerGuard` 此时能拿到 `req.user`，按用户计数。

- [ ] **Step 4: 运行并确认通过**

Run: `bunx vitest run src/chat/derive-title.spec.ts` 与 `bunx vitest run --config vitest.config.int.ts src/chat`
Expected: PASS。

- [ ] **Step 5: 补文档并做整体验证**

在 `services/chat/README.md` 加一节，列出 spec 第 11 节的环境变量、`.env.test` 的准备方式、`bun run db:test:prepare` 与 `bun run test:int`。

Run（`services/chat` 目录）：`bun run typecheck && bun run lint && bun run test && bun run test:int && bun run test:e2e`
Expected: 全部通过，无新增的 lint 警告。

再手动验证一次真实启动：在 `.env` 里加上 `JWT_ACCESS_SECRET`（32 位以上）后 `bun run dev`，确认服务正常启动；去掉该变量再启动，确认进程报出 `JWT_ACCESS_SECRET` 相关错误并退出。

- [ ] **Step 6: 提交**

```bash
git add services/chat/src/chat services/chat/src/app.module.ts services/chat/README.md
git commit -m "fea: streaming chat endpoint with persistence"
```
