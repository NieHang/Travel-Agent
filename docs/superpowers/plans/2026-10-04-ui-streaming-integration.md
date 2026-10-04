# UI Streaming Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在真实聊天页面接入 UI 协议、真实文本流、组件批次、会话行程面板和完成进度动画。

**Architecture:** React Query 保存消息历史，Zustand 保存当前流；现有 conversation 消息入口输出统一 SSE 信封。UIFlowService 保留旅游业务规则，以候选流程快照执行，ChatService 负责持久化，轻量协调层负责阶段及文本事件。原五 Agent 和软件需求分析编排保持现有用途。

**Tech Stack:** TypeScript、NestJS、LangChain、Zod、Prisma/PostgreSQL、Next.js、React Query、Zustand、@microsoft/fetch-event-source、motion、Vitest、Playwright；Bun 工作区。

**Spec:** `docs/superpowers/specs/2026-10-04-ui-streaming-integration-design.md`（已按用户确认移除五 Agent 改造）。

## Global Constraints

- 采用 text streaming + component batching：Markdown 从模型增量推送，JSON 静默收集、完整校验后批量下发。
- 保留身份验证、聊天历史、分页、停止生成和中英文界面。
- 保留现有五个软件需求分析 Agent 及其 OrchestratorService，不让它们参与旅游聊天；本次不新增多 Agent 系统。
- 成功保存后发送 done；中止保存 partial，失败保存 error，不把半截 JSON 存为有效组件。
- 不自动重发可能产生重复消息的 POST。
- 直到收到已持久化的 done 之前最多显示 99%。
- 酒店、航班、地点不能显示为已验证价格、库存或搜索结果。
- 按仓库 AGENTS.md 读取安装版本文档后修改 Next.js/Turborepo 配置或命令；只使用 PowerShell 安全文件操作。

## Review Focus

- 历史分页不包含最近有效流程快照：服务端恢复不能依赖前端已加载页数（Task 2）。
- 输入修改需求使旧草稿失效后模型失败：保留已提交快照，不留下半推进状态（Task 3）。
- 浏览器标签隐藏后恢复：SSE 客户端不能重发 POST 或生成重复用户消息（Task 4）。
- 独立酒店查询穿插规划：更新查询展示不能清空规划草稿（Task 5）。
- 取消后的迟到 done：不能切换成成功进度或污染新会话（Tasks 4、6）。

## 文件和接口约定

共享协议归 `packages/contracts/src/ui.ts`、`stream.ts`、`trip.ts`，后端 UI 类型与基础 Schema 从 contracts 引用，业务校验仍留在后端。私有流程记录放 `services/chat/src/llm/ui-protocol/ui-session.ts`，不能从公共 Message.metadata 直接泄露。不修改 Prisma 表结构，使用现有 Message.metadata JSON 字段。

Task 1 固定公共类型：`UIResponse`、`UIAction`、`ComponentInteractionState`、`TripSnapshot`、`ProgressPayload`、`StreamMessage`。Task 2 固定 `UIFlowSnapshot` 和 `PreparedUITurn`。后续任务只消费这些接口。

### Task 1: 共享 UI、行程与流式协议

**Files:** Create `packages/contracts/src/ui.ts`, `stream.ts`, `trip.ts`; modify `chat.ts`, `index.ts`, backend `ui-schemas.ts`, `ui-types.ts`, frontend `components/ai-ui/types.ts`; test `services/chat/src/stream-contracts.spec.ts` and existing `ui-schemas.spec.ts`.

**Interfaces:**
- `ComponentInteractionState = { sourceMessageId: string; revision: number; active: boolean }`。
- `TripSnapshot = { revision: number; status: 'collecting' | 'draft' | 'confirmed' | 'updating'; destination: string | null; departureDate: string | null; returnDate: string | null; travelers: number | null; budget: number | null; budgetCurrency: string | null; itineraryMarkdown: string | null; days: TripDay[]; hotels: UIResponse[]; routes: UIResponse[]; hotspots: UIResponse[] }`。TripDay 含 title 及 stops（name、note、time 可空）；列表只接受对应合法详情组件，数据均标记 unverified。
- `ProgressPayload = { agent: string; step: number; totalSteps: number; status: 'started' | 'completed' | 'failed'; label: string }`；agent 表示阶段标识，不新增 Agent。
- `StreamMessageSchema`/`StreamMessage`：markdown、ui、meta、progress、done、error discriminated union；所有消息含 timestamp。done 为 `{ message: Message; trip: TripSnapshot | null }`，error 为 `{ code: string; message?: Message }`，meta 为 `{ conversationId: string; userMessage?: Message; trip?: TripSnapshot | null }`。markdown/UI 字段遵循 spec。
- `SendMessageRequest` 保持旧 `{content}` 合法，新增可选 locale；Action 请求为 `{ action: UIAction; sourceMessageId: string; revision: number; locale?: string }`，与 content 互斥。
- 公共 `Message.metadata` 增加 components、interactionState、trip；保持旧 requirements/requirementError 兼容。

- [ ] 写协议失败测试：六种信封解析成功；错误 payload、NaN、step 超出 totalSteps、同时 content/action、伪造组件类型解析失败；旧消息合法。
- [ ] 在 services/chat 运行 `bun run test src/stream-contracts.spec.ts src/llm/ui-protocol/ui-schemas.spec.ts`，确认新增协议断言失败。
- [ ] 迁移基础组件及 Action Schema 到 contracts；业务 refinements 保留后端；避免 contracts/ui → chat → stream 的循环引用，stream 可引用 MessageSchema。
- [ ] 重跑上述测试及 `bun run typecheck`，确认通过；前端 type-only 引用改为 contracts。
- [ ] 仅提交本任务文件，提交信息 `feat: define shared UI streaming contracts`。

### Task 2: 候选流程与持久化恢复

**Files:** Create backend `ui-session.ts`, `ui-session.spec.ts`; modify `ui-flow.service.ts`, `ui-flow.service.spec.ts`, `conversations.service.ts`, `conversations.http.int.spec.ts`.

**Interfaces:**
- `UIFlowSnapshot = { version: 1; revision: number; context: UIFlowContext; response: AIUIResponse; trip: TripSnapshot | null }`，以服务端 Schema 校验。
- `PreparedUITurn = { response: AIUIResponse; snapshot: UIFlowSnapshot; markdownInput: string | null }`。
- `UIFlowService.prepareTurn(snapshot: UIFlowSnapshot | null, request: SendMessageRequest, history: BaseMessage[], signal: AbortSignal): Promise<PreparedUITurn>`；在传入快照副本上执行，不能提交内存状态。现有 chat/handleAction 作为其内存会话适配器保留原接口。
- `readUIFlowSnapshot(metadata: unknown): UIFlowSnapshot | null`、`toPublicMessageMetadata(metadata: unknown): MessageMetadata | null`；私有记录 key 为 `uiFlowSnapshot`，公共转换明确剔除该字段。

- [ ] 写失败测试：从快照恢复 Action、过期 revision/来源消息拒绝、原快照不可变、私有快照不出现在 HTTP 消息、缺省旧 metadata 正常、最新快照查询不受 20 条历史裁剪限制。
- [ ] 在 services/chat 运行 `bun run test src/llm/ui-protocol/ui-session.spec.ts src/llm/ui-protocol/ui-flow.service.spec.ts`，确认新行为失败。
- [ ] 提取可复用的快照业务操作，保留原旅游语义约束、语言规则和随机组件 ID；刷新后沿用已保存组件 ID。取消检查贯穿模型调用和候选状态推进。
- [ ] 修改 toMessageContract，仅输出公共元数据；补充查询最新有效快照的方法，不采用 partial/error 中未提交候选。
- [ ] 重跑单测；用 `bun run test:int src/conversations/conversations.http.int.spec.ts` 验证私有字段过滤。
- [ ] 提交 `refactor: prepare and restore durable UI turns`。

### Task 3: 真实文本流与 SSE 落库协调

**Files:** Create `ui-stream.service.ts`, `ui-stream.service.spec.ts`; modify `ui-response.service.ts`, `ui-response.service.spec.ts`, `ui-model.schema.ts`, `ui-protocol.module.ts`, `chat.service.ts`, `chat.controller.ts`, `chat.controller.spec.ts`, `chat.service.int.spec.ts`, `chat.http.int.spec.ts`.

**Interfaces:**
- `UIResponseService.streamMarkdown(input: string, history: BaseMessage[], context: UIFlowContext, signal: AbortSignal): AsyncGenerator<string>`；模型工厂真实 stream，AbortSignal 传到模型。
- `UIStreamService.streamTurn(snapshot: UIFlowSnapshot | null, request: SendMessageRequest, history: BaseMessage[], signal: AbortSignal): AsyncGenerator<UIStreamEvent>`。
- `UIStreamEvent = { type: 'progress'; payload: ProgressPayload } | { type: 'markdown'; content: string } | { type: 'final'; turn: PreparedUITurn }`。
- `ChatService.send(conversationId: string, request: SendMessageRequest, signal: AbortSignal): AsyncGenerator<StreamMessage>`；源消息查验、单会话并发拒绝、落库和最终信封都由此层负责。

- [ ] 写失败测试：首 token 可在 final 前读取；结构化 JSON 片段不输出；确定性确认不调用 Markdown 模型；每个成功/失败/取消只保存一条助手记录；保存失败无 done；取消或生成失败不更新已提交流程快照。
- [ ] 在 services/chat 运行 `bun run test src/llm/ui-protocol/ui-stream.service.spec.ts src/chat/chat.controller.spec.ts`。
- [ ] 在 UIResponseService 按意图决定输出方式：选择/表单/确认直接批量输出；普通回答、完整行程使用 Markdown stream。删除这两种场景中重复的全文 JSON 生成，结构化步骤只产出语义及面板所需数据。行程结构化数据与流式正文共享同一校验后的候选数据，不能另外编造一条路线。
- [ ] 实现协调层阶段：理解需求、按需生成文本、更新面板、保存结果；阶段无需全部执行。完整组件校验后输出 final，UI 状态确认摘要使用完整行程正文。
- [ ] 改造 ChatService：用户消息先落库；稳定助手 ID 提前分配；最终文本、组件、公共交互状态和私有候选快照一次保存。中止/失败保留上次已提交快照及已输出文本，失效未完成操作组件。保存结果后封装 ui/meta/done。
- [ ] Controller 完成前置校验后 flushHeaders，统一 `event: message`；关闭连接中止生成，失败使用稳定错误码，不暴露上游异常。旧 SSE 事件仅保留历史测试迁移所需，不设第二聊天主链路。
- [ ] 运行上述单测及 `bun run test:int src/chat/chat.service.int.spec.ts src/chat/chat.http.int.spec.ts`；核对跨用户 Action、并发、刷新恢复和最终事件顺序。
- [ ] 提交 `feat: stream durable UI chat turns over SSE`。

### Task 4: 前端临时流状态与身份验证传输

**Files:** Create `stores/ai-ui.store.ts`, `stores/ai-ui.store.test.ts`, `features/chat/ui-stream-client.ts`, `ui-stream-client.test.ts`; modify `package.json`, workspace lockfile, `features/chat/use-chat-stream.ts`, `use-chat-stream.test.tsx`.

**Interfaces:**
- `createAIUIStore()` 返回 Zustand vanilla store，每个 useChatStream 实例独立持有；无跨账户全局单例。
- actions `begin(requestId: string, conversationId: string): void`, `receive(requestId: string, message: StreamMessage): void`, `cancel(requestId: string): void`, `reset(): void`；state 含 streamingMessage、progress、trip、phase。
- `streamUIChat(path: string, request: SendMessageRequest, signal: AbortSignal, onMessage: (message: StreamMessage) => void): Promise<void>`。
- hook 保留 phase/stop/activeConversationId，新增 components、interactionState、progress、trip；send 接受 SendMessageRequest。

- [ ] 写失败测试：Unicode 与拆包、isChunk=false 替换、ui 批次覆盖、缺失 done/error 拒绝、重复 done 幂等、错误 Schema 中止、旧 requestId 忽略、历史缓存不随 token 写入。
- [ ] 在 clients/chat-web 运行 `bun run test features/chat/ui-stream-client.test.ts stores/ai-ui.store.test.ts features/chat/use-chat-stream.test.tsx`。
- [ ] 安装 zustand 与 @microsoft/fetch-event-source；通过其 fetch 注入调用 apiFetch，保留 credentials/令牌刷新及账户检查。onerror 抛出终止重试，onclose 无终止事件按失败；openWhenHidden=true 避免隐藏恢复重发 POST。
- [ ] 接入 store：meta 写用户消息缓存，done/error 写已保存助手消息一次；token 只更新临时流。停止后同步服务端历史，清理当前流，账户/会话变更隔离旧结果。
- [ ] 重跑测试，包含隐藏标签恢复请求次数为 1、取消后迟到 done 不写缓存和新流。
- [ ] 提交 `feat: consume UI streams with isolated frontend state`。

### Task 5: 真实聊天组件与行程面板

**Files:** Modify `features/chat/ChatScreen.tsx`, `MessageList.tsx`, `MessageBubble.tsx`, respective tests, `features/panels/TripPanels.tsx`, panel components and `panels.test.tsx`, `messages/zh.json`, `messages/en.json`; create `features/panels/trip-snapshot.ts`, `trip-snapshot.test.ts`; adapt `components/ai-ui/AIChatContainer.tsx`, README and tests to common transport if retained。

**Interfaces:**
- `MessageBubble`/`MessageList` 接受 components、interactionState 和 `onAction(sourceMessageId: string, revision: number, action: UIAction): void`。
- `TripPanels({ tab, data }: { tab: PanelTab; data: TripSnapshot | null })`；废除页面上的 TripMock 依赖，保留 mock 文件仅作为测试素材。
- `latestTripSnapshot(messages: Message[]): TripSnapshot | null`，返回时间顺序中最新公共快照；null 不回退到更早的已失效草稿。

- [ ] 写失败测试：实际 ChatScreen 显示 selection/form/confirmation 并向同一消息 API 提交；生成中/历史组件禁用；刷新恢复有效操作；桌面和移动共用快照；无数据为空态；独立酒店查询保留规划草稿。
- [ ] 在 clients/chat-web 运行 `bun run test features/chat/ChatScreen.test.tsx features/panels/trip-snapshot.test.ts features/panels/panels.test.tsx`。
- [ ] MessageBubble 接入 ComponentRenderer；Markdown 正文和 text 组件去重；历史组件靠 sourceMessageId/revision 判定可操作性，不仅按数组位置。
- [ ] ChatScreen 移除 getTripMock，流快照优先于历史快照；会话切换立即清空。面板展示 itineraryMarkdown 和合法结构化列表，不猜测 Markdown 中的价格/地点；无结果显示本地化空态，移除 sample 标签。
- [ ] AIChatContainer 若保留为复用入口，使用共同信封处理与传输，不再维护第三种流状态逻辑。
- [ ] 重跑测试及原组件测试，确认已有认证、分页、首次发消息、停止和需求卡片历史不回归。
- [ ] 提交 `feat: connect UI actions and live trip panels to chat`。

### Task 6: 阶段进度与完成动画

**Files:** Create `features/chat/StreamProgress.tsx`, `StreamProgress.test.tsx`; modify `ChatScreen.tsx` and中英文 messages。

**Interfaces:** `StreamProgress({ progress, outcome }: { progress: ProgressPayload | null; outcome: 'running' | 'completed' | 'failed' | 'cancelled' })`。

- [ ] 写失败测试：运行中最高 99%、只有 done 后 100%、失败/取消无成功对号、正确 progressbar/status、reduced-motion 跳过动画、旧请求 done 不显示成功。
- [ ] 在 clients/chat-web 运行 `bun run test features/chat/StreamProgress.test.tsx`。
- [ ] 用 SVG 环和 CSS/motion 实现紫色进度；右下到左上填充 350ms，对号弹出 200ms，完成后保留 1200ms 收起；UI 标签本地化，不把 agent ID 原样显示给用户。
- [ ] 重跑测试，浏览器检查完成动画方向、桌面/移动布局和减少动态效果。
- [ ] 提交 `feat: show streamed task progress and completion animation`。

### Task 7: 全链路回归与交付

**Files:** Create `clients/chat-web/e2e/ui-streaming.spec.ts`; modify `e2e/helpers.ts`, existing chat HTTP integration fixtures, `services/chat/LANGCHAIN.md`; create `docs/superpowers/reports/2026-10-04-ui-streaming-integration.md`。

- [ ] 写端到端测试：真实 /chat 路由，通过可控模型 fixture 完成规划 → 选择 → 表单 → 文本流/面板更新 → 确认；刷新和会话切换后仍正确，取消/失败不显示成功动画。fixture 通过同一后端接口走持久化，不只 mock 浏览器组件。
- [ ] 在 clients/chat-web 运行 `bun run test:e2e e2e/ui-streaming.spec.ts`，先确认新链路缺失时失败，再在全部任务完成后通过。
- [ ] 在 services/chat 运行 `bun run test`、`bun run test:int`、`bun run typecheck`；在 clients/chat-web 运行 `bun run test`、`bun run typecheck`。contracts 无独立 build 脚本，依赖两工作区类型检查及协议测试验证，不调用不存在的构建命令。
- [ ] 浏览器检查用户参考动画、文本真实增量、组件整批显示、空态与行程联动；若模型配置可用，补一次真实模型多轮验证，单独记录结果与局限。
- [ ] 更新文档和报告：协议示例、恢复规则、模型调用次数、验证证据；自审 diff 中没有软件需求分析 Agent 改动、mock 面板回退或私有字段外泄。
- [ ] 提交 `test: verify integrated UI streaming chat journey`，完成整体代码审查后交付。

## 执行方式

建议 Native：由当前会话逐任务实现，接口变动能连续验证，不为每个互相依赖的步骤重建上下文。若用户选择子代理执行，再按 subagent-driven-development 分派。计划审阅与执行方式确认后进入实现，不在计划阶段修改业务代码。
