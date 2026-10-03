# 用户层 · 后端与契约设计

- 日期：2026-10-03
- 范围：`services/chat`、`packages/contracts`
- 配套文档：[前端设计](./2026-10-03-user-layer-frontend-design.md)
- 粒度：接口级

## 1. 目标

为 Hilda（原 `TravelAgent`）补上用户层：注册、登录、发起对话、保存需求与结果、查看历史会话。后端先行，前端基于本文定义的契约开发。

成功标准：

1. 用户能用邮箱和密码注册、登录、刷新登录态、登出。
2. 登录用户能创建会话、发送消息并收到流式回复，回复与结构化需求都被保存。
3. 登录用户能分页浏览、按标题搜索、重命名、删除自己的会话，且永远看不到他人的数据。
4. 除白名单外的所有接口都需要登录。

## 2. 不做的事

邮箱验证、找回密码、OAuth、单点登录、单设备互踢、账号锁定、审计日志查看界面、匿名试用、消息全文检索、重新生成回复、真实旅行数据（行程、酒店、路线、热点）的生成与存储、定时清理任务。

`Document`、`TaskEvent` 两张表的 `userId` 本期不加外键。

## 3. 已确认的决策

| 维度 | 决定 |
|---|---|
| 实现路线 | 契约先行；`@nestjs/jwt` + 自写全局 guard，不引入 Passport |
| 账号 | 邮箱 + 密码 + 昵称；注册即登录 |
| access token | JWT（HS256），15 分钟，前端放内存，经 `Authorization: Bearer` 发送 |
| refresh token | 随机串，30 天，HttpOnly Cookie；库里只存 SHA-256 哈希；每次刷新轮换；重用时吊销整条链 |
| 多设备 | 允许同时在线，每次登录一条独立的 token 链 |
| 审计 | 仅认证事件落库，只写不展示 |
| 保护范围 | 全局 guard，`@Public()` 白名单放行 |
| 限流 | `@nestjs/throttler`，内存计数 |
| 对话 | SSE 流式；流结束后落库；结构化需求存入助手消息的 `metadata` |
| 建会话与发消息 | 两个独立请求 |
| 品牌名 | `APP_NAME` 改为 `Hilda` |

## 4. 数据模型

### 4.1 新增

```prisma
enum AuditEvent {
  REGISTER
  LOGIN_SUCCESS
  LOGIN_FAILURE
  LOGOUT
  TOKEN_REFRESH
  TOKEN_REUSE
}

enum MessageStatus {
  complete
  partial
  error
}

model User {
  id            String         @id @default(cuid())
  email         String         @unique
  passwordHash  String
  nickname      String
  locale        String         @default("zh")
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  conversations Conversation[]
  refreshTokens RefreshToken[]

  @@map("users")
}

model RefreshToken {
  id         String    @id @default(cuid())
  userId     String
  familyId   String
  tokenHash  String    @unique
  expiresAt  DateTime
  revokedAt  DateTime?
  replacedBy String?
  userAgent  String?
  ip         String?
  createdAt  DateTime  @default(now())
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([familyId])
  @@map("refresh_tokens")
}

model AuditLog {
  id        String     @id @default(cuid())
  userId    String?
  event     AuditEvent
  ip        String?
  userAgent String?
  metadata  Json?
  createdAt DateTime   @default(now())

  @@index([userId, createdAt])
  @@map("audit_logs")
}
```

字段说明：

- `User.email`：入库前去首尾空白并转小写，最长 254 字符。
- `User.passwordHash`：argon2id。所选实现必须在 Bun（开发运行时）和 Node（vitest）下都能运行。
- `User.locale`：`zh` 或 `en`。
- `RefreshToken.familyId`：一次登录或注册生成一个，轮换时沿用。
- `RefreshToken.replacedBy`：轮换后指向新记录的 `id`。
- `AuditLog.userId`：可为空，且不设外键。登录失败时可能查无此人；用户被删除后日志仍需保留。
- `AuditLog.metadata`：`LOGIN_FAILURE` 记录尝试的邮箱；`TOKEN_REUSE` 记录 `familyId`。

### 4.2 修改

- `Conversation`：`userId` 增加指向 `User` 的外键（`onDelete: Cascade`）；`@@index([userId])` 改为 `@@index([userId, updatedAt])`；`title` 允许空字符串，表示尚未命名。
- `Message`：新增 `status MessageStatus @default(complete)`。

### 4.3 迁移

当前为开发库。迁移前清空 `conversations` 与 `messages`，再加外键。

## 5. 模块划分

全部位于 `services/chat/src`。

| 模块 | 职责 | 依赖 |
|---|---|---|
| `auth` | 注册、登录、刷新、登出；签发与轮换 token；`JwtAuthGuard`、`@Public()`、`@CurrentUser()` | `users`、`audit`、`prisma` |
| `users` | 创建与查询用户；`GET /users/me`、`PATCH /users/me` | `prisma` |
| `audit` | 单一方法 `record(event, context)`，只写 | `prisma` |
| `conversations` | 会话增删改查、搜索、分页；消息分页。所有查询强制带 `userId` | `prisma` |
| `chat` | 接收用户消息、驱动流式回复、落库 | `conversations`、`llm` |
| `common` | `ZodValidationPipe`、全局异常过滤器、游标编解码 | 无 |

`chat` 模块不直接依赖具体模型，而是依赖一个端口：

```ts
interface ChatReplyPort {
  streamReply(history: ChatTurn[], signal: AbortSignal): AsyncIterable<string>;
}
type ChatTurn = { role: 'user' | 'assistant'; content: string };
```

默认实现放在 `llm` 模块，用现有的 `createChatModel()` 加一段旅行助手的系统提示词，把 `history` 转成消息列表后流式输出。现有 `LlmService.stream` 只接受单个字符串，不带历史，因此不复用它，也不改它。结构化抽取直接调用现有的 `RequirementService.extract`。

`llm` 模块的现有控制器与服务不改动，只是受全局 guard 保护。

## 6. 契约

所有请求体、响应体、SSE 事件、错误码的 zod schema 定义在 `packages/contracts`，按领域拆成 `auth.ts`、`users.ts`、`conversations.ts`、`chat.ts`、`errors.ts`，由 `index.ts` 统一导出。后端用 `ZodValidationPipe` 校验入参，前端复用类型。

### 6.1 通用约定

- 统一前缀 `/api`。
- 错误体：`{ code: ErrorCode, message: string, details?: unknown }`。前端按 `code` 显示本地化文案，不展示 `message`。
- `VALIDATION_FAILED` 的 `details` 为 `{ fieldErrors: Record<string, string[]> }`。
- 时间一律为 ISO 8601 字符串。
- 429 响应带 `Retry-After` 头（秒）。

### 6.2 错误码

| `code` | HTTP | 含义 |
|---|---|---|
| `VALIDATION_FAILED` | 400 | 入参不符合 schema |
| `TOKEN_MISSING` | 401 | 未带 access token |
| `TOKEN_EXPIRED` | 401 | access token 过期；前端仅在此码下触发刷新 |
| `TOKEN_INVALID` | 401 | access token 签名或格式无效 |
| `INVALID_CREDENTIALS` | 401 | 邮箱或密码错误，不区分两者 |
| `REFRESH_INVALID` | 401 | refresh token 缺失、不存在、过期，或处于并发宽限期 |
| `REFRESH_REUSED` | 401 | 检测到 refresh token 被重用，整条链已吊销 |
| `CONVERSATION_NOT_FOUND` | 404 | 会话不存在或不属于当前用户 |
| `NOT_FOUND` | 404 | 路由不存在或其他未找到 |
| `EMAIL_TAKEN` | 409 | 邮箱已注册 |
| `RATE_LIMITED` | 429 | 触发限流 |
| `MODEL_FAILED` | 无（仅出现在 SSE `error` 事件中） | 上游模型出错 |
| `INTERNAL_ERROR` | 500 | 未预期的错误 |

### 6.3 数据形状

```ts
User         { id, email, nickname, locale: 'zh' | 'en', createdAt }
AuthResult   { accessToken, user: User }
Conversation { id, title, createdAt, updatedAt }
Message      { id, conversationId, role: 'USER' | 'ASSISTANT', content,
               status: 'complete' | 'partial' | 'error',
               metadata: MessageMetadata | null, createdAt }
MessageMetadata { requirements?: Requirement[]; requirementError?: true }
Page<T>      { items: T[], nextCursor: string | null }
```

`Requirement` 沿用现有的 `RequirementSchema`（`action`、`constraints`、`entities`）。

### 6.4 字段规则

| 字段 | 规则 |
|---|---|
| `email` | 去空白、转小写后校验邮箱格式，最长 254 |
| `password` | 8–72 字符，至少一个字母和一个数字 |
| `nickname` | 去首尾空白后 1–20 字符 |
| `locale` | `zh` 或 `en` |
| 会话 `title` | 去首尾空白后 1–60 字符 |
| 消息 `content` | 去首尾空白后 1–4000 字符 |
| `limit` | 1–50，默认 20 |

## 7. 接口

### 7.1 认证

均为 `@Public()`，按 IP 限流：注册与登录每分钟 10 次；刷新与登出每分钟 60 次（每次页面加载都会刷新一次，额度过低会误伤多标签页用户）。

| 接口 | 入参 | 成功 | 失败 |
|---|---|---|---|
| `POST /api/auth/register` | `{ email, password, nickname, locale? }` | 201 `AuthResult`，设置 refresh Cookie | `EMAIL_TAKEN`、`VALIDATION_FAILED` |
| `POST /api/auth/login` | `{ email, password }` | 200 `AuthResult`，设置 refresh Cookie | `INVALID_CREDENTIALS`、`VALIDATION_FAILED` |
| `POST /api/auth/refresh` | 无，读 Cookie | 200 `AuthResult`，轮换 Cookie | `REFRESH_INVALID`、`REFRESH_REUSED` |
| `POST /api/auth/logout` | 无，读 Cookie | 204，吊销该 token 所在的整条链并清除 Cookie | 幂等：无 Cookie 或 token 无效也返回 204 |

`locale` 缺省为 `zh`。

### 7.2 用户

| 接口 | 入参 | 成功 |
|---|---|---|
| `GET /api/users/me` | 无 | 200 `User` |
| `PATCH /api/users/me` | `{ nickname?, locale? }`，至少一项 | 200 `User` |

### 7.3 会话

所有查询都带当前用户的 `userId`。访问不存在或不属于自己的会话统一返回 404 `CONVERSATION_NOT_FOUND`，不泄露存在性。

| 接口 | 入参 | 成功 |
|---|---|---|
| `GET /api/conversations` | 查询参数 `cursor?`、`limit?`、`q?` | 200 `Page<Conversation>` |
| `POST /api/conversations` | `{ title? }` | 201 `Conversation` |
| `PATCH /api/conversations/:id` | `{ title }` | 200 `Conversation` |
| `DELETE /api/conversations/:id` | 无 | 204，消息级联删除 |
| `GET /api/conversations/:id/messages` | 查询参数 `cursor?`、`limit?` | 200 `Page<Message>` |

规则：

- 会话列表按 `updatedAt` 倒序、`id` 倒序。**不返回没有任何消息的会话**，这样建了会话但发消息失败留下的空会话对用户不可见。
- `q` 去首尾空白后对 `title` 做不区分大小写的包含匹配；空串等同于未传。
- 消息列表按 `createdAt` 倒序、`id` 倒序返回，前端反转后展示，向上滚动时用 `nextCursor` 取更早的消息。
- 游标是不透明字符串：把排序键与 `id` 做 base64url 编码。无法解析的游标返回 `VALIDATION_FAILED`。
- `POST` 未传 `title` 时存空字符串。
- 重命名不更新 `updatedAt`，避免改名导致会话在列表里跳到顶部。实现上显式保留原值。

### 7.4 对话

`POST /api/conversations/:id/messages`，入参 `{ content }`。按用户限流：每分钟 20 次。

流开始前的失败以普通 JSON 错误返回（`VALIDATION_FAILED`、`CONVERSATION_NOT_FOUND`、`RATE_LIMITED`、401 类）。校验通过后响应为 `text/event-stream`：

| 事件 | 数据 | 次数 | 时机 |
|---|---|---|---|
| `user_message` | `{ message: Message }` | 1 | 用户消息已落库 |
| `delta` | `{ text: string }` | 0 到多次 | 模型输出的增量文本 |
| `requirement` | `{ requirements: Requirement[] }` | 0 或 1 | 结构化抽取成功，可出现在 `done` 之前的任意位置 |
| `done` | `{ message: Message }` | 0 或 1 | 助手消息以 `complete` 落库 |
| `error` | `{ code: 'MODEL_FAILED', message: Message }` | 0 或 1 | 上游出错，助手消息以 `error` 落库 |

`done` 与 `error` 互斥，其一出现后流结束。

处理步骤：

1. 校验会话归属。
2. 保存用户消息，发 `user_message`。若会话 `title` 为空，取用户消息压缩连续空白后的前 30 个字符作为标题。
3. 取该会话最近 20 条 `content` 非空的消息（含刚保存的这条），按时间正序作为 `history`。
4. 并行启动两件事：`ChatReplyPort.streamReply(history, signal)` 与 `RequirementService.extract(content)`。
5. 每个文本块发一个 `delta`。
6. 抽取成功且结果非空时发 `requirement`；抽取失败不影响回复，只在 `metadata` 里记 `requirementError: true`。
7. 回复流结束后，最多再等抽取 15 秒；超时按抽取失败处理。
8. 保存助手消息，更新会话的 `updatedAt`，发 `done`。

异常路径：

| 情况 | 助手消息 `status` | `content` | 事件 |
|---|---|---|---|
| 正常完成 | `complete` | 完整文本 | `done` |
| 上游模型出错 | `error` | 已生成的部分，可为空 | `error` |
| 客户端断开或主动停止 | `partial` | 已生成的部分，可为空 | 无（连接已关闭） |

客户端断开时同时中止模型调用与抽取。三种情况下助手消息都会落库，保证每条用户消息之后都有一条对应的助手消息。

## 8. 鉴权流程

### 8.1 请求鉴权

全局 `JwtAuthGuard` 读取 `Authorization: Bearer <token>`，校验签名与过期时间，把 `{ userId }` 挂到请求上。`@Public()` 的路由跳过。access token 的载荷只有 `sub` 与 `exp`，校验时不查库。

白名单：四个认证接口，以及现有的根路径健康检查。

### 8.2 refresh token

- 原文：32 字节随机数的 base64url 编码。库里只存 SHA-256 哈希。
- Cookie：名称 `hilda_rt`，属性 `HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=<30 天>`，`COOKIE_SECURE=true` 时加 `Secure`。`Path` 限定后只有认证接口会收到它。

### 8.3 刷新

在一个事务内完成：

1. 读 Cookie，计算哈希，按 `tokenHash` 查库。无 Cookie、查不到或已过期：返回 `REFRESH_INVALID` 并清除 Cookie。
2. 以「`revokedAt` 为空」为条件把该记录标记为已吊销。更新行数为 1：签发同 `familyId` 的新 token，写旧记录的 `replacedBy`，设置新 Cookie，记 `TOKEN_REFRESH`，返回 `AuthResult`。
3. 更新行数为 0，且该记录的 `revokedAt` 距今不超过 10 秒：视为多标签页并发。返回 `REFRESH_INVALID`，不吊销链，不清除 Cookie（另一个请求已写入新 Cookie，前端重试即可）。
4. 更新行数为 0，且超出 10 秒：视为被盗用。吊销整个 `familyId`，记 `TOKEN_REUSE`，返回 `REFRESH_REUSED` 并清除 Cookie。

已吊销且 `replacedBy` 为空的记录（随登出或整链吊销而失效）：返回 `REFRESH_INVALID` 并清除 Cookie，不记 `TOKEN_REUSE`。第 3、4 步只适用于 `replacedBy` 非空的记录。

第 2 步的条件更新保证两个并发刷新不会都成功。

### 8.4 登录与注册

- 登录时邮箱不存在，也对一个固定的假哈希执行一次 argon2 校验，使响应时间与密码错误一致。
- 登录成功记 `LOGIN_SUCCESS`，失败记 `LOGIN_FAILURE`，注册成功记 `REGISTER`，登出记 `LOGOUT`。
- 注册的 `EMAIL_TAKEN` 会暴露邮箱是否已注册。这是不做邮箱验证的已知代价，由 IP 限流兜底。
- 登录成功后，删除该用户过期超过 7 天的 refresh token 记录。这是本期唯一的清理机制。

### 8.5 客户端信息

`ip` 取自请求，`userAgent` 取自请求头并截断到 255 字符。部署在反向代理之后时通过 `TRUST_PROXY` 开启代理信任。

## 9. 错误处理

- 一个全局异常过滤器把所有异常转成 6.1 的错误体。业务异常携带明确的 `code`；zod 校验失败转 `VALIDATION_FAILED`；限流异常转 `RATE_LIMITED`；其余转 `INTERNAL_ERROR`，原始错误只写日志，不返回给客户端。
- 审计写入失败不阻断主流程：写一条错误日志，认证操作照常成功。
- SSE 开始输出后发生的错误走 `error` 事件，不再修改状态码。

## 10. 限流

| 范围 | 键 | 额度 |
|---|---|---|
| `POST /api/auth/register`、`POST /api/auth/login` | IP | 每分钟 10 次 |
| `POST /api/auth/refresh`、`POST /api/auth/logout` | IP | 每分钟 60 次 |
| `POST /api/conversations/:id/messages` | 用户 `id` | 每分钟 20 次 |
| 其余接口 | 无 | 不限流 |

内存计数，仅适用于单实例。

## 11. 配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `JWT_ACCESS_SECRET` | 无 | 必填，至少 32 字符；缺失或过短时启动失败 |
| `JWT_ACCESS_TTL` | `15m` | access token 有效期 |
| `REFRESH_TTL_DAYS` | `30` | refresh token 有效期 |
| `COOKIE_SECURE` | `false` | 生产环境设为 `true` |
| `TRUST_PROXY` | `false` | 是否信任反向代理传来的客户端 IP |
| `LLM_FAKE` | 未设置 | 设为 `1` 时使用假模型，见第 12 节 |
| `CORS_ORIGIN` | `http://localhost:3002` | 已存在；继续使用显式白名单 |

CORS 增加 `credentials: true`。需要引入 Cookie 解析。

## 12. 测试用假模型

`LLM_FAKE=1` 时，`ChatReplyPort` 绑定到一个假实现：把一段固定文本分成若干块依次输出；`RequirementService` 同时被替换为返回固定结果的实现。此时不需要任何模型密钥。

`NODE_ENV=production` 且 `LLM_FAKE=1` 时启动失败，防止误用于生产。

## 13. 测试

沿用 vitest，按测试先行的方式开发。

| 层 | 覆盖 |
|---|---|
| 单元 | 密码哈希与校验；access token 签发与校验；刷新的四条分支及并发；会话归属校验；标题自动生成；游标编解码与非法游标；字段规则 |
| HTTP（supertest） | 每个接口的成功路径与第 7 节列出的每个错误码；未带 token 访问受保护接口返回 `TOKEN_MISSING`；访问他人会话返回 404；限流返回 429 并带 `Retry-After`；Cookie 属性正确 |
| 对话流 | 用假的 `ChatReplyPort` 驱动三种情况：正常完成、上游报错、客户端中途断开，分别断言事件序列与落库的 `status`、`content`、`metadata` |
| 审计 | 六种事件各在对应操作后写入；审计写入失败时主流程仍成功 |
| 现有测试 | `advanced.http.spec`、`filesystem.http.spec` 等补上鉴权后保持通过 |

数据库相关测试连接真实的 PostgreSQL，使用测试库 `travel_agent_test`（建在开发库所在的 PostgreSQL 上，由 `bun run db:test:prepare` 创建并迁移），每个测试文件开始前清表，不模拟 Prisma。测试启动时若数据库名不以 `_test` 结尾则拒绝运行，防止误清开发库。

## 14. 需要新增的依赖

`@nestjs/jwt`、`@nestjs/throttler`、一个 argon2id 实现、Cookie 解析中间件。具体包与版本在实施计划阶段依据已安装版本的文档确定。
