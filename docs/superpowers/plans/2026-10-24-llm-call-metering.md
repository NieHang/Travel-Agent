# LLM 调用计量：耗时 + 真实 token 用量 + 成本（缺用量时估算）

> 给 Codex 的实施计划。范围仅 `services/chat`。不改业务逻辑、不改 API 契约（`packages/contracts` 不动）、不改前端。
> 前置：`c728645`（traceId / pino / `httpDuration`）已在 `main` 上。

## 0. 现状（先读）

在 `main`（c728645）上核对过：

| 项 | 实际情况 |
|---|---|
| `src/llm/cost/cost-tracker.ts` `estimateCost()` | 纯函数，按文本估算 token 和 USD；**没有任何调用方**（只有 spec） |
| `src/llm/cost/token-estimator.ts` | `PRICING`（含 `cachedInput`，但 `estimateCost` 不用它）、`getModelPricing()`（最长前缀匹配，未知模型按 gpt-5.4）、`estimateTextTokens()`。只被 `compact.ts` 用来估上下文长度 |
| 模型创建 | 全部经过 `src/llm/model.factory.ts` `createChatModel()`，返回 `ChatOpenAI` |
| trip 流程的模型调用 | `src/trip/llm.ts`：`classify()`（`withStructuredOutput().invoke()`）、`respond()`（`bindTools()` 后交给 `tool-loop.ts` 的 `model.stream()`，最多 `MAX_TOOL_ROUNDS` 轮）、`extractDays()`（`withStructuredOutput().invoke()`）；另有 `src/llm/compact.ts` 的摘要调用 |
| 用量读取 | 没有任何地方读 `usage_metadata`；`withStructuredOutput` 默认只返回解析后的对象，调用处拿不到用量 |
| 可观测性 | `observability/metrics.ts` 只有 `httpDuration`；`logger.ts` 的 `createLogger(module)` 通过 mixin 自动带 `traceId`；`trace-context.ts` 用 `AsyncLocalStorage` |
| 依赖版本 | `@langchain/core` 1.2.14、`@langchain/openai` 1.6.1。`ChatOpenAI.streamUsage` 默认 `true`（流式请求会带 `stream_options.include_usage`）；`invocationParams` / `ls_model_name` 可在回调里拿到模型名 |
| 当前 provider | `config/langchain.yaml`：`deepseek` / `deepseek-flash`（OpenAI 兼容网关） |

**核心思路**：不改调用点的返回值，而是在 `createChatModel()` 里给每个 `ChatOpenAI` 挂一个 LangChain callback handler。`invoke`、`stream`、`withStructuredOutput`、`bindTools` 最终都走同一个 chat model run，都会触发 `handleChatModelStart` → `handleLLMEnd` / `handleLLMError`，因此一个地方就能覆盖全部调用（包括 `src/llm/` 下的旧 demo）。

## 1. 产出

每次模型调用（一个 chat model run）产出一条记录：

```ts
interface LlmCallRecord {
  model: string;          // 实际请求的模型名
  operation: string;      // 调用方标签，见 §4；默认 'other'
  status: 'ok' | 'error' | 'aborted';
  durationMs: number;
  inputTokens: number;    // 含 cachedInputTokens
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
  usageSource: 'provider' | 'estimate';
}
```

记录去向：
1. pino 日志：`createLogger('llm')`，每次调用一条 `info`，消息 `'llm call'`，字段即 `LlmCallRecord`（`traceId` 由 mixin 自动加上，见 §5 的注意点）。`status !== 'ok'` 时用 `warn`，并带 `err.name` / `err.message`（不带 stack 以外的请求内容；**不要记录 prompt 或回复正文**）。
2. Prometheus 指标（§6）。
3. 请求级汇总：同一个 HTTP 请求内所有调用的合计，写进 `request completed` 访问日志（§7）。

## 2. 成本计算：`src/llm/cost/cost-tracker.ts`

保留 `estimateCost()` 不变（已有 spec）。新增一个按真实用量计价的函数：

```ts
export interface UsageCostInput {
  model: string;
  inputTokens: number;       // provider 返回的 input_tokens，含缓存命中部分
  cachedInputTokens?: number;
  outputTokens: number;
}

/** Prices provider-reported usage; cache hits are billed at cachedInput when the model has one. */
export function costFromUsage({ model, inputTokens, cachedInputTokens = 0, outputTokens }: UsageCostInput): number {
  const pricing = getModelPricing(model);
  const cached = Math.min(cachedInputTokens, inputTokens);
  return (
    (inputTokens - cached) * pricing.input +
    cached * (pricing.cachedInput ?? pricing.input) +
    outputTokens * pricing.output
  ) / 1_000_000;
}
```

spec（`cost-tracker.spec.ts` 追加，断言具体数字，不要在测试里复刻公式）：
- `gpt-5.4`，input 1_000_000、cached 0、output 0 → `2.5`
- `gpt-5.4`，input 1_000_000、cached 1_000_000、output 0 → `0.25`
- `gpt-5.4`，input 0、output 1_000_000 → `15`
- cached 大于 input 时按 input 封顶：input 100、cached 500 → 等于全部按 `cachedInput` 计价的结果（`100 * 0.25 / 1e6`）
- `deepseek-flash` 的一组数字（用 `PRICING` 里的单价手算后写死）

## 3. Callback handler：新建 `src/llm/cost/llm-metering.ts`

```ts
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
```

类 `LlmMeteringHandler extends BaseCallbackHandler`：

- `name = 'llm-metering'`。
- **`awaitHandlers = true`**：让回调在调用方的 async 上下文内同步执行，保证 `getTraceId()` 和 §7 的请求级汇总可用。handler 内只做内存计算 + 写日志，不做 I/O，阻塞代价可忽略。
- 构造参数：`{ operation?: string }`，默认 `'other'`。
- 内部 `Map<runId, { startedAt: number; model: string; inputTexts: string[]; toolSchemas: unknown[]; totals: LlmTotals | undefined }>`。

方法：

**`handleChatModelStart(llm, messages, runId, parentRunId, extraParams, tags, metadata)`**
- `model`：优先 `metadata?.ls_model_name`（string），其次 `extraParams?.invocation_params?.model`，都没有则 `'unknown'`。用类型守卫读取，不用 `any`。
- `inputTexts`：`messages[0]` 每条消息的 `.text`（只给估算兜底用，不进日志）。
- `toolSchemas`：`extraParams?.invocation_params?.tools`，是数组就存，否则 `[]`。
- `totals`：`getLlmTotals()`（§7），在此刻捕获。
- `startedAt = performance.now()`。

**`handleLLMEnd(output, runId)`**
- 取出并删除 Map 条目；找不到就直接返回（例如 handler 被挂在非 chat 模型上）。
- 从 `output.generations[0]?.[0]` 读 message：用 `AIMessage.isInstance` / `AIMessageChunk.isInstance` 判断（`ChatGeneration` 的 `message` 字段），取 `usage_metadata`。
- 有 `usage_metadata` 且 `input_tokens + output_tokens > 0` → `usageSource: 'provider'`，`cachedInputTokens = usage_metadata.input_token_details?.cache_read ?? 0`，`costUsd = costFromUsage(...)`。
- 否则 → `usageSource: 'estimate'`，用 `estimateCost({ model, messages: inputTexts, toolSchemas, output })`，`output` 为生成消息的 `.text` 加上 `JSON.stringify(tool_calls)`（有 tool_calls 时；结构化输出走 function calling，正文是空的，token 都在 tool_calls 里）。`cachedInputTokens = 0`。
- `status: 'ok'`，交给 `record()`。

**`handleLLMError(err, runId)`**
- 取出并删除 Map 条目；找不到就返回。
- `status`：`err.name === 'AbortError'` 或 `err` 是 `DOMException` 且 name 为 `AbortError` → `'aborted'`，否则 `'error'`。
- 用量：provider 不会在报错时返回用量，按 `estimateCost({ model, messages: inputTexts, toolSchemas })` 只估输入（output 记 0），`usageSource: 'estimate'`。原因：用户点「停止」时输入已经被计费，记 0 会低估。
- 交给 `record()`，日志级别 `warn`。

**`record(entry, rec)`**（私有）
- 写日志、更新指标、`entry.totals?.add(rec)`。
- 整个方法包在 `try/catch` 里，失败只 `logger.warn`：计量绝不能让模型调用失败。（`awaitHandlers = true` 下 handler 抛错会冒泡到调用方。）

## 4. 接入 `createChatModel()`：`src/llm/model.factory.ts`

- `options` 增加 `operation?: string`：`createChatModel(options: { model?: string; operation?: string } = {})`。
- `new ChatOpenAI({ ..., callbacks: [new LlmMeteringHandler({ operation: options.operation })] })`。
- 不改 `streamUsage`（默认 true 即可）。

调用点只加 `operation`，其他不动：

| 位置 | operation |
|---|---|
| `src/trip/llm.ts` `classify()` | `'trip.classify'` |
| `src/trip/llm.ts` `respond()` | `'trip.respond'`（工具循环的每一轮各记一条，同一个 operation） |
| `src/trip/llm.ts` `extractDays()` | `'trip.extract_days'` |
| `src/llm/compact.ts` | `'compact'` |

`src/llm/` 下其他旧 demo 调用点不改，记为 `'other'`。

`operation` 取值固定为上表，是指标 label，**不要**放用户输入或动态内容。

## 5. traceId 的注意点

- 日志 `traceId` 来自 `logger.ts` 的 mixin（`getTraceId()`），依赖 handler 在请求的 async 上下文内执行，这就是 §3 设 `awaitHandlers = true` 的原因。
- 必须用测试验证（§8 的「traceId 透传」用例）；如果测出来拿不到，在 `handleChatModelStart` 里把 `getTraceId()` 存进 Map 条目，`record()` 时显式写 `traceId` 字段，不要依赖 mixin。
- 模块顶层创建的模型（如 `requirement.chain.ts:6`）不在请求上下文里也没关系：调用发生在请求内时 handler 仍在请求上下文执行。

## 6. 指标：`src/observability/metrics.ts`

追加，注册到同一个 `registry`：

```ts
export const llmCallDuration = new Histogram({
  name: 'llm_call_duration_seconds',
  help: 'LLM call duration in seconds',
  labelNames: ['model', 'operation', 'status'] as const,
  buckets: [0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120],
  registers: [registry],
});

export const llmTokens = new Counter({
  name: 'llm_tokens_total',
  help: 'LLM tokens, by kind',
  labelNames: ['model', 'operation', 'kind', 'source'] as const, // kind: input | cached_input | output; source: provider | estimate
  registers: [registry],
});

export const llmCost = new Counter({
  name: 'llm_cost_usd_total',
  help: 'Estimated LLM spend in USD (list prices from token-estimator.ts)',
  labelNames: ['model', 'operation', 'source'] as const,
  registers: [registry],
});
```

- `kind: 'input'` 记**未命中缓存**的输入（`inputTokens - cachedInputTokens`），`cached_input` 记命中部分，避免两者相加重复。
- 仍然**不**暴露 `/metrics` 端点（沿用 `2026-10-24-observability-trace-logging.md` 的决定）。

## 7. 请求级汇总

目标：一次 `POST /api/conversations/:id/messages` 花了多少钱，在一条访问日志里能看到。

`src/observability/trace-context.ts`：
- 新增

  ```ts
  export interface LlmTotals {
    calls: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    costUsd: number;
    estimated: boolean; // 任一调用用了估算即为 true
    add(rec: Pick<LlmCallRecord, 'inputTokens' | 'cachedInputTokens' | 'outputTokens' | 'costUsd' | 'usageSource'>): void;
  }
  export function createLlmTotals(): LlmTotals
  export function getLlmTotals(): LlmTotals | undefined
  ```

  `LlmCallRecord` 类型定义放在 `llm-metering.ts`；为避免 `observability` 反向依赖 `llm`，`add` 的参数在 `trace-context.ts` 里用结构类型直接写出字段，不 import。
- `TraceContext` 增加 `llm: LlmTotals`。
- `runWithTrace(traceId, fn, llm = createLlmTotals())`：新增可选第三参，原有调用和 spec 不受影响。

`src/observability/trace.middleware.ts`：
- `const llm = createLlmTotals()`，`runWithTrace(traceId, () => next(), llm)`。
- `done()` 里（它可能在上下文之外执行，所以用闭包里的 `llm`，不要调 `getLlmTotals()`）：`llm.calls > 0` 时在 `request completed` 日志对象里加 `llm: { calls, inputTokens, cachedInputTokens, outputTokens, costUsd, estimated }`；为 0 时不加该字段。
- SSE 请求在流结束时才 `finish`，此时所有调用都已记账，汇总是完整的。

## 8. 测试

单元测试（`bun run test`，无 DB）：

1. `cost-tracker.spec.ts`：§2 的用例。
2. 新建 `src/llm/cost/llm-metering.spec.ts`，直接调 handler 方法（构造 `LLMResult` / `AIMessage`），并 `vi.spyOn` 日志或注入一个可替换的 logger：
   - provider 用量：`usage_metadata = { input_tokens: 1000, output_tokens: 200, total_tokens: 1200, input_token_details: { cache_read: 400 } }`，model `gpt-5.4` → 记录的 `inputTokens 1000 / cachedInputTokens 400 / outputTokens 200 / usageSource 'provider'`，`costUsd` 断言写死的数字。
   - 无用量 → `usageSource 'estimate'`，token 数断言写死的数字（用纯 ASCII 文本便于手算：4000 个字符 = 1000 tokens）。
   - 结构化输出：正文空、`tool_calls` 非空且无用量 → `outputTokens > 0`。
   - `handleLLMError` 传 `AbortError` → `status 'aborted'`，`outputTokens 0`，`inputTokens` 为估算值；普通 `Error` → `'error'`。
   - 未知 `runId` 的 `handleLLMEnd` / `handleLLMError` 不抛错、不记录。
   - `record` 内部抛错（例如让 logger 抛）不会冒泡出 handler。
   - 模型名读取：`metadata.ls_model_name` 优先；只有 `invocation_params.model` 时用它。
   - 指标：调用后用 `registry.getSingleMetricAsString('llm_tokens_total')` 或 `llmTokens.get()` 断言对应 label 的值。每个用例前 `registry.resetMetrics()`。
3. `model.factory.spec.ts`：`createChatModel({ operation: 'trip.classify' }).callbacks` 里有一个 `LlmMeteringHandler`。
4. traceId 透传 + 请求汇总（单测即可，不需要真实模型）：用 `@langchain/core/utils/testing` 的 `FakeListChatModel`（或 `FakeStreamingChatModel`），构造时挂 `new LlmMeteringHandler()`，在 `runWithTrace('t-1', ..., totals)` 内分别跑一次 `invoke` 和一次 `stream`（消费完），断言：
   - 日志记录带 `traceId: 't-1'`；
   - `totals.calls === 2`，`estimated === true`（fake 模型没有用量）。
   这个用例就是 §5 要求的验证；fake 模型若不支持 `callbacks` 构造参数，用 `.withConfig({ callbacks: [...] })`。
5. `trace.middleware.spec.ts`：在 `next` 里往 `getLlmTotals()` 加一笔，`finish` 后访问日志含 `llm` 字段；不加时不含。
6. `trace-context.spec.ts`：`runWithTrace` 不传第三参时 `getLlmTotals()` 返回一个空汇总。

全量：`bun run test`、`bun run lint`、根目录 `bun run typecheck`。按 LESSON.md「constructor gains a dependency」一条，grep `createChatModel(` 确认现有 spec 没有因为多了 callbacks 而断言失败（例如对构造参数做了 `toEqual` 的用例）。

集成测试：`bun run test:int` 跑一遍确认无回归（`TurnService` 在测试里用 fake LLM，不经过 `createChatModel`，预期不受影响）。

**Live 验证（必须，CLAUDE.md 约定）**：`bun run scripts/test-trip-live.ts`，带 `LOG_LEVEL=info`，确认：
- 每次 `trip.classify` / `trip.respond` / `trip.extract_days` 都有一条 `llm call` 日志；
- **DeepSeek 流式调用的 `usageSource` 是否为 `'provider'`**。这是本方案唯一依赖外部行为的点：如果网关不返回流式用量，会全部落到 `'estimate'`。结果写进提交说明；若为 `'estimate'`，不要自行加修复，报告给用户决定。
- 日志中没有 prompt 或回复正文。

## 9. 不做（明确排除）

- 不把成本写进数据库、不加 Prisma 模型、不加 API 字段、不在前端展示。
- 不按用户/会话做预算或限流。
- 不加 `/metrics` 端点。
- 不引入 tokenizer（tiktoken 等）改进估算精度。
- 不处理 DeepSeek 错峰半价、gpt-5.4 超 272K 加价、batch/flex 档（`token-estimator.ts` 注释已说明，按上限估）。
- 不改 `src/llm/` 旧 demo 的调用点。

## 10. 提交

一个提交即可，scope `feat(chat)`，例如：

```
feat(chat): meter LLM calls (duration, provider usage, cost)
```

正文按 LESSON.md：说明加了什么、为什么用 callback 而不是改调用点（`withStructuredOutput` 丢用量）、跑了哪些测试、live run 中 DeepSeek 流式用量是 provider 还是 estimate，以及没跑什么、为什么。`Co-Authored-By` 只加一次。
