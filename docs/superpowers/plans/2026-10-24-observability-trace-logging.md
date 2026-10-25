# 可观测性：traceId + pino 结构化日志 + HTTP 时长指标

> 给 Codex 的实施计划。范围仅 `services/chat`。不改业务逻辑；`console.log` / Nest `Logger` 暂不全量替换。

## 0. 现状（与需求描述的差异，先读）

在 `feat/japan-travel-skill`（38099f1）上核对过：

| 需求里提到的 | 实际情况 | 本计划的处理 |
|---|---|---|
| `response.interceptor.ts` 的 traceId | **文件不存在**，项目里没有任何 traceId，也没有响应包裹（envelope） | 不新建拦截器。新建它等于改所有成功响应的形状，属于业务/契约变更。traceId 通过响应头 `x-trace-id` 回给客户端 |
| `all-exceptions.filter.ts` 的 traceId "改为" `getTraceId()` | 过滤器当前不输出 traceId；错误体是 `ApiErrorSchema = { code, message, details? }` | 错误体**不加** traceId（默认）；traceId 进错误日志和响应头。如要放进 body，需同时给 `packages/contracts/src/errors.ts` 的 `ApiErrorSchema` 加 `traceId: z.string().optional()`，见 §7 待定项 |
| `httpDuration.observe` | 没有 metrics 模块，也没装 `prom-client` | 新建 `observability/metrics.ts` 定义 `httpDuration`；**不**暴露 `/metrics` 端点（见 §7） |
| `forRoutes('*')` | Nest 12 + Express 5（path-to-regexp v8）下 `'*'` 是旧写法；现有 `cookieParser` 用的是 `'{*splat}'` | 用 `'{*splat}'`，与现有写法一致 |
| `pino` / `pino-pretty` | 未安装 | 新增依赖 |

## 1. 依赖

在 `services/chat` 下：

```sh
bun add pino prom-client
bun add -d pino-pretty
```

`pino-pretty` 放 devDependencies：只在本地 `LOG_PRETTY=1` 时用。

## 2. `src/observability/trace-context.ts`

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface TraceContext {
  traceId: string;
  startedAt: number; // performance.now()
}

const storage = new AsyncLocalStorage<TraceContext>();

export function newTraceId(): string {
  return randomUUID();
}

export function runWithTrace<T>(traceId: string, fn: () => T): T {
  return storage.run({ traceId, startedAt: performance.now() }, fn);
}

export function getTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}

export function getElapsedMs(): number | undefined {
  const ctx = storage.getStore();
  return ctx && Math.round(performance.now() - ctx.startedAt);
}
```

- 上下文外（启动期、定时任务）`getTraceId()` 返回 `undefined`，调用方不要假设一定有值。
- 不导出 `storage` 本身。

## 3. `src/observability/logger.ts`

```ts
import pino, { type Logger } from 'pino';
import { getTraceId } from './trace-context.js';

export function traceMixin(): { traceId?: string } {
  const traceId = getTraceId();
  return traceId ? { traceId } : {};
}

const options: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  mixin: traceMixin,
  redact: {
    paths: [
      'apiKey', '*.apiKey',
      'password', '*.password',
      'authorization', '*.authorization',
      'headers.authorization', 'req.headers.authorization',
      'headers.cookie', 'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },
};

// pino-pretty 以同步 stream 方式接入，不用 transport：transport 走 worker_threads，在 Bun 下不稳。
const logger: Logger =
  process.env.LOG_PRETTY === '1'
    ? pino(options, (await import('pino-pretty')).default({ colorize: true }))
    : pino(options);

export function createLogger(module: string): Logger {
  return logger.child({ module });
}
```

要点：
- 单例 `logger` 不导出，外部只用 `createLogger(module)`。
- `traceMixin` 导出（单测要用）。
- 顶层 `await` 在本包 ESM（`"type": "module"`、`module: nodenext`）下可用；若 `nest build` / vitest 报错，改为 `createRequire(import.meta.url)('pino-pretty')`。
- redact 里加了 `cookie`：refresh token 在 cookie 里，和 authorization 同级敏感。
- 测试环境：`vitest` 下若日志太吵，可在 `test/setup-unit.ts` 设 `process.env.LOG_LEVEL ??= 'silent'`（需在 logger 模块首次加载前生效；setupFiles 先于测试文件执行，满足）。

## 4. `src/observability/metrics.ts`

```ts
import { Histogram, Registry } from 'prom-client';

export const registry = new Registry();

export const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
  registers: [registry],
});
```

- 用独立 `registry`，不污染 prom-client 全局默认 registry（测试里多次 import 不会重复注册报错）。
- bucket 上限到 120s：SSE 的 trip turn 会持续整个模型流式输出。

## 5. `src/observability/trace.middleware.ts`

```ts
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { createLogger } from './logger.js';
import { httpDuration } from './metrics.js';
import { newTraceId, runWithTrace } from './trace-context.js';

const TRACE_HEADER = 'x-trace-id';
const accessLog = createLogger('http');

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const traceId = readTraceId(req) ?? newTraceId();
    res.setHeader(TRACE_HEADER, traceId);
    const startedAt = performance.now();
    let logged = false;
    const done = () => {
      if (logged) return;
      logged = true;
      const durationMs = Math.round(performance.now() - startedAt);
      const route = routeOf(req);
      // finish/close 回调不保证在请求的 AsyncLocalStorage 上下文里，traceId 显式传。
      accessLog.info(
        { traceId, method: req.method, route, path: req.path, status: res.statusCode, durationMs, aborted: !res.writableFinished },
        'request completed',
      );
      httpDuration.observe({ method: req.method, route, status_code: String(res.statusCode) }, durationMs / 1000);
    };
    res.on('finish', done);
    res.on('close', done);
    runWithTrace(traceId, () => next());
  }
}

/** 只复用形如 id 的入站 traceId；其他值（超长、带换行等）丢弃并新建。 */
function readTraceId(req: Request): string | undefined {
  const value = req.headers[TRACE_HEADER];
  return typeof value === 'string' && /^[\w-]{1,64}$/.test(value) ? value : undefined;
}

/** 用路由模板做 label，避免 conversation id 进 label 导致基数爆炸。 */
function routeOf(req: Request): string {
  return req.route?.path ? `${req.baseUrl}${req.route.path}` : 'unmatched';
}
```

说明（实现时保持）：
- **同时监听 `finish` 和 `close`，加 once 守卫**：用户点"停止"中断 SSE 时只有 `close` 没有 `finish`，只听 `finish` 会漏掉这类请求的 access 日志和指标。`aborted` 字段区分两者。
- EventEmitter 回调运行在触发方的异步上下文，不一定是请求的 ALS 上下文，所以 access 日志的时长在闭包里自己算、traceId 显式传；若 mixin 也注入了同值 traceId，pino 以显式字段为准，不会冲突。`getElapsedMs()` 留给业务代码（如 turn 内部）打阶段耗时用。
- access 日志**不记** query string、headers、body：`req.path` 不含 query。
- 响应头 `x-trace-id` 在 `next()` 之前设，SSE 首包前就已写出。

## 6. 接线与现有文件改动

### 6.1 `src/main.ts`（实施修订，2026-10-24）

实际验证发现：Nest 的默认 JSON / urlencoded 解析器先于 `AppModule.configure` 中的中间件执行。
因此 trace 必须在 `app.listen()` / `app.init()` 之前用 `app.use()` 注册，否则非法 JSON（400）与请求体超限（413）会漏掉响应头、access 日志和耗时指标。

```ts
import { TraceMiddleware } from './observability/trace.middleware.js';
// NestFactory.create(...) 之后，enableCors / listen 之前：
const traceMiddleware = new TraceMiddleware();
app.use(traceMiddleware.use.bind(traceMiddleware));
```

`src/app.module.ts` 保留原来的 `cookieParser()` 接线，不重复注册 TraceMiddleware。
后续 body parser、中间件、guard、filter 均在 trace 上下文中运行。

### 6.2 `src/config/cors.ts` + `cors.spec.ts`

前端与 API 跨源，`x-trace-id` 要能被前端读到（排查时从 devtools/错误上报取），`exposedHeaders` 改为 `['Retry-After', 'x-trace-id']`，同步更新 `cors.spec.ts` 的期望值。（前端本次不读它，只是放开。）

### 6.3 `src/common/all-exceptions.filter.ts`

- 删掉 Nest `Logger` 及 `private readonly logger`。
- 模块级：`export const errorLog = createLogger('AllExceptionsFilter');`（导出是为了测试 spy）。
- 把原来唯一的 `this.logger.error(exception)`（仅 INTERNAL_ERROR 分支）替换为：

  ```ts
  errorLog.error({ err: exception, method: req.method, path: req.path }, 'unhandled exception');
  ```

  `req` 来自 `host.switchToHttp().getRequest<Request>()`。traceId 由 mixin 自动带上，不手动传。
- **只在原来记日志的位置记**：AppException、4xx、413 等仍不记 error（access 日志已覆盖状态码），保持现有"413 不记错误日志"测试成立。
- 错误响应体不变（见 §0、§7）。
- 行为说明：原来 Nest Logger 会打印 message + stack，`err` 序列化器同样包含 message/stack，信息量与现在一致，不扩大也不缩小。

### 6.4 `src/common/http.spec.ts`

三处 `vi.spyOn(Logger.prototype, 'error')` 改为 `vi.spyOn(errorLog, 'error')`（从 `./all-exceptions.filter.js` 导入）。
"未知异常不泄露细节"一例的断言改为：

```ts
expect(spy.mock.calls[0][0]).toEqual(
  expect.objectContaining({ err: expect.objectContaining({ message: 'secret detail' }) }),
);
```

其余用 `Logger.prototype` spy 的测试（`chat.controller.spec.ts`、各 `*.int.spec.ts`）不涉及本过滤器，不动。

## 7. 待定项（默认值已选，用户可改）

1. **错误体是否带 `traceId`**：**已定（2026-10-24）：不带**。traceId 只通过 `x-trace-id` 响应头返回，`ApiErrorSchema` 与错误体保持不变。
2. **`/metrics` 端点**：默认不做。全局 `JwtAuthGuard` 下要暴露需 `@Public()`，而公开指标会泄露路由与流量信息，需另定鉴权/网络隔离方案，另起任务。
3. **入站 `x-trace-id` 校验**（`/^[\w-]{1,64}$/`）：这是边界校验，代价一行；若不需要可去掉直接复用。

## 8. 测试

新增（单测，`*.spec.ts`，无 DB）：

- `src/observability/trace-context.spec.ts`
  - 上下文外 `getTraceId()` / `getElapsedMs()` 为 `undefined`。
  - `runWithTrace('t1', ...)` 内同步与 `await` 之后都能取到 `'t1'`；嵌套 `runWithTrace` 内层覆盖、退出后恢复外层。
  - `newTraceId()` 是 UUID 格式且两次不同。
- `src/observability/logger.spec.ts`
  - `traceMixin()` 上下文外返回 `{}`，`runWithTrace('t1')` 内返回 `{ traceId: 't1' }`。
  - redact：用 `pino(options, destination)` 写入内存 stream 不方便测单例的话，至少断言 `createLogger('x')` 返回的 logger 有 `.child`、且输出含 `module: 'x'`（可通过把 options 抽成同文件内的 `const` 并在测试里用 `pino(options, stream)` 验证 `{ password: 'p' }` 输出为 `[REDACTED]`；若为此需导出 `options`，可以导出）。
- `src/observability/trace.middleware.spec.ts`（参照 `http.spec.ts` 用 `Test.createTestingModule` + supertest，创建应用后、listen/init 前通过 `app.use` 应用 `TraceMiddleware`）
  - 无入站头：响应有 `x-trace-id` 且为 UUID。
  - 入站 `x-trace-id: abc-123`：响应头原样回写；handler 里 `getTraceId()` 返回 `'abc-123'`（handler 把它作为 body 返回来断言）。
  - 入站非法值（如 65 个字符）：被替换为新 UUID。
  - 非法 JSON（400）与请求体超限（413）仍有 trace 响应头、保持原错误体，并各记录一次耗时。
  - 请求结束后 `httpDuration` 有一次 observe，label `route` 是模板（如 `/t/:id`）而非实际 id：`await registry.getSingleMetricAsString('http_request_duration_seconds')` 包含 `route="/t/:id"`。
  - 异步 handler（`await new Promise(r => setTimeout(r, 5))` 之后再取 `getTraceId()`）仍能取到。

修改：`http.spec.ts`（§6.4）、`cors.spec.ts`（§6.2）。

## 9. 验收命令（在 `services/chat`）

```sh
bun run typecheck
bun run lint
bun run test
bun run build
```

手动冒烟（本地起后端，`LOG_PRETTY=1 bun run dev`）：
- `curl -i http://localhost:4001/health` → 响应头有 `x-trace-id`，控制台有一条 `module: "http"` 的 access 日志，带同一 traceId。
- 带 `-H 'x-trace-id: smoke-1'` 再请求 → 响应头和日志都是 `smoke-1`。
- 不设 `LOG_PRETTY` → 输出为单行 JSON。
- 前端发一条消息后点停止 → 有一条 `aborted: true` 的 access 日志。

不需要跑 `test:int` / `test-trip-live.ts`：不改 trip/LLM 行为。若 Codex 改动波及 `src/trip/` 或 `src/chat/`，则需要补跑。

## 10. 提交

一个提交即可，例如 `feat(chat): add trace context, pino logger and http duration metric`。按 LESSON.md：正文写清做了什么、为什么（§0 差异与取舍）、验证了什么（上面的命令与冒烟结果）、没跑什么及原因；`Co-Authored-By` trailer 只加一次。
