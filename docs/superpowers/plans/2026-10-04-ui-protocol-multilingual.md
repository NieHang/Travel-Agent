# UI Protocol Multilingual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 使用现有模型调用返回结构化语义和 UI，使中英文及未来语言使用相同的确定性业务流程。

**Architecture:** 严格模型输出 `{ semantics, response }`，服务端验证语义增量及操作并推进状态，对外只返回 response。需求校验、本地化与组件构建独立；状态机不识别原始文本中的语言关键词。

**Tech Stack:** 现有 NestJS、TypeScript、LangChain、Zod、Vitest、Supertest；不新增依赖。

**Spec:** `docs/superpowers/specs/2026-10-04-ui-protocol-multilingual-design.md`（用户已确认，含 budgetCurrency 可选修订）。

## Global Constraints

- 内部输出为 `{ semantics, response }`，HTTP 仍返回 `{ message, intent, components }`；selection 增加必填 purpose。
- semantics.operation 使用 answer/update_requirements/request_confirmation/cancel_confirmation/resume_planning；不允许模型指定 stage 或 confirmed。
- tripType 使用 business/family/solo/couple；人数为 1–100 的整数；预算为非负有限数；日期为合法 ISO 日期。
- 所有模型需求字段必有键且可空；null 表示未提供，不覆盖现有值。budgetCurrency 不参与必填判断，不出现在规划表单，不要求用户填写三位代码。
- chat/action 可选 locale，省略兼容既有请求；资源注册 zh/en，其他语言固定文案回退 en。
- 所有业务判断不匹配原始输入、title 或 label 中的中英文关键词。
- 沿用 30 分钟 TTL、20 条历史、1000 会话容量、身份隔离、串行操作、UUID 和失败回滚。
- 保留已存在的路线预览调用，不增加独立语义解析调用。
- 不修改前端、账号语言契约、数据库、供应商、预订或 Turborepo 配置；使用现有 `.js` 导入方式。

## Review Focus

- 用户明确修改了需求但数值与已有值相同：保留草案和阶段，避免无效更新清空路线（Task 5）。
- 当前日期增量本身合法却与既有日期倒置：整轮回滚，旧组件仍有效（Task 2、5）。
- 显式 en 偏好配中文输入，后续仅发送数字/Action：保持 en，并拒绝模型违反明确偏好的结果（Task 3、4、6）。
- 无草案的确认、非确认阶段的取消、否定确认请求：返回正常说明，不虚构路线，不确认、不删除草案（Task 5）。
- 查询后的 form/selection/button 补充条件可能改变模型分类：既有 query.intent 约束后续调用，不能覆盖规划需求（Task 4、5）。

## Task 1: 严格语义协议及公开组件用途

**Files:** Modify `services/chat/src/llm/ui-protocol/ui-schemas.ts`, `ui-types.ts`, `ui-schemas.spec.ts`。

**Interfaces:** 导出 `uiModelOutputSchema`、`validatedUIModelOutputSchema`、`UIModelOutput`、`UISemantics`、`PlanningRequirements`。保留公开 `AIUIResponse`。selection.purpose 为 trip_type/query_filter/query_candidate；UIFlowContext 增加可选 replyLanguage/preferredLocale。chat/action schema 增加可选 locale。

- [x] 写 schema 测试：严格 envelope 接受全部可空需求键；缺失 semantics、未知操作、未知 tripType、缺少 purpose、重复 ID 被拒绝。断言 `validatedUIModelOutputSchema.safeParse({ semantics: hotelSemantics, response: tripResponse }).success === false`，查询带非空规划增量及非 answer 操作也失败。
- [x] 在 `services/chat` 执行 `bun run test -- src/llm/ui-protocol/ui-schemas.spec.ts`，确认新用例失败。
- [x] 实现独立严格对象 schema，将运行时 refinements 保留在 SDK schema 外；replyLanguage/locale 使用可被 Intl 规范化的有界语言标记，UIFlowContext.requirements 仍与现有表单值类型兼容。
- [x] 更新受影响的现有 selection fixtures：规划使用 trip_type，设施使用 query_filter；不引入通过 label 推断 purpose 的旧输出适配。
- [x] 重跑 schema 测试，确认新旧用例通过；检查 diff 只包含协议及 fixtures 的必要修改。

## Task 2: 共享规划需求校验

**Files:** Create `services/chat/src/llm/ui-protocol/ui-requirements.validation.ts`, `ui-requirements.validation.spec.ts`; modify `ui-form.validation.ts`。

**Interfaces:** `mergePlanningRequirements(existing: UIFlowContext['requirements'], patch: Partial<PlanningRequirements>): { requirements: UIFlowContext['requirements']; changed: boolean }`。辅助函数负责字段值及合并后日期关系。用户表单错误为 400；无效模型结果由调用方转为统一 502。

- [x] 写测试：null 不覆盖已有值；同值增量 changed=false；合法改变 changed=true；只给 returnDate 时结果没有 departureDate；人数 0/101/1.5、负预算、非法日期、合并后返程早于出发被拒绝。无币种预算接受，显式币种规范化信息接受，非空非法内部代码拒绝。
- [x] 运行 `bun run test -- src/llm/ui-protocol/ui-requirements.validation.spec.ts`，确认失败。
- [x] 实现合并与值校验；规划表单提交使用同一校验规则，保持通用查询表单现有 unknown/duplicate/required/select/bounds/date 校验。禁止危险对象键，不对原始文本提取信息。
- [x] 重跑需求测试及已有表单流程测试，确认没有放宽原有表单校验。

## Task 3: 本地化和语言继承

**Files:** Create `services/chat/src/llm/ui-protocol/ui-localization.ts`, `ui-localization.spec.ts`; modify `ui-flow.components.ts`。

**Interfaces:** `normalizeLocale(value: string): string`、`resolveReplyLanguage(preferredLocale: string | undefined, detectedLanguage: string | undefined, previousLanguage: string | undefined): string`、`getUICopy(language?: string): UICopy`；导出 zh/en 相同键结构。`getTripOptions(language?: string)`、`getPlanningFields(language?: string)`，替代固定文案数组。`planningResponse(context: UIFlowContext): AIUIResponse` 保留入口。

- [x] 写测试：显式 en 优先于检测 zh；没有新识别语言时继承会话语言；空会话缺省 en；zh-CN 文案回退 zh；fr 文案回退 en。遍历本地构建的 selection/form/card/confirmation/steps/action_buttons 验证英文文案，字段 name 和选项 value 在两种语言中相同，表单不包含 budgetCurrency，预算标签不含固定人民币。
- [x] 执行 `bun run test -- src/llm/ui-protocol/ui-localization.spec.ts`，确认失败。
- [x] 实现字典、规范化及 locale 回退；进度、查询筛选、无草案说明、恢复按钮文案集中管理。表单字段定义与必填集合不依赖语言。
- [x] 将组件构建切换为 context.replyLanguage，并为规划 selection 设置 purpose=trip_type；重跑本地化与 schema 测试。

## Task 4: 单次模型调用同时返回语义与 UI

**Files:** Modify `services/chat/src/llm/ui-protocol/ui-response.service.ts`, `ui-response.service.spec.ts`。

**Interfaces:** `UIResponseService.generateUIResponse(input: string, history?: BaseMessage[], context?: UIFlowContext): Promise<UIModelOutput>`。导出 `validateUIResponse(value: unknown, context?: UIFlowContext): AIUIResponse` 和 `validateUIModelOutput(value: unknown, context?: UIFlowContext): UIModelOutput`，不接收原始 input 做业务判断。

- [x] 修改本地 OpenAI 兼容测试服务器 fixtures 为 envelope。断言请求 schema 包含 semantics/response；一次 generate 仅发出一次 HTTP 请求；上下文/历史传递；中文、英文、混合语言及法文样例的相同语义输出均通过相同校验。
- [x] 写拒绝用例：intent 不一致、query 带规划增量、trip_type purpose 用于查询、伪造确认、verified card、详情没有 card、预览没有 itinerary card、后续 query.intent 漂移、违反显式 locale。展示标题改写不改变校验结论。
- [x] 执行 `bun run test -- src/llm/ui-protocol/ui-response.service.spec.ts`，确认新用例失败。
- [x] 提示词解释稳定语义字段、null 增量、自然语言币种、日期角色、否定与短回复语言继承；删除固定“使用中文”和所有用户文本/展示标签正则。使用 `withStructuredOutput(uiModelOutputSchema, { method: 'functionCalling', strict: true })`，外部校验 envelope 并统一 502。
- [x] 将需求值校验接入模型输出校验；保留来源、grounded confirmation、preview 和 query 状态约束。重跑模型服务、schema、需求测试。

## Task 5: 以结构化语义驱动状态机

**Files:** Modify `services/chat/src/llm/ui-protocol/ui-flow.service.ts`, `ui-flow.service.spec.ts`。

**Interfaces:** `chat(sessionId: string, input: string, locale?: string): Promise<AIUIResponse>`、`handleAction(sessionId: string, action: UIAction, locale?: string): Promise<AIUIResponse>`。内部 generate 返回 UIModelOutput；query/preview 取得其 response，并受 context.operation 约束。

- [x] 将流程测试替身改为按测试预设返回完整 envelope，不从输入关键词模拟分流。增加等价中英文需求跳步、第三语言语义、预算无币种也可预览、仅返程日期保留角色测试。
- [x] 写测试：request_confirmation 保存旧草案并产生 confirmation+steps；最终仍需 Action；不存在草案正常说明；取消恢复草案；否定确认的 answer 不改草案；恢复规划清除查询。只更新同值需求不失效草案，实际改变会失效旧确认组件。
- [x] 写隔离/回滚测试：查询不污染规划字段；非法跨轮日期回滚；改变 locale 后模型失败回滚语言与草案；短回复/Action 保持语言；后续查询选项/表单/按钮不得切换 query.intent。
- [x] 运行 `bun run test -- src/llm/ui-protocol/ui-flow.service.spec.ts`，确认新用例失败。
- [x] chat 取得并验证模型结果，再按 semantics.operation/intent 分流；移除 queryIntent、planningInput、collectExplicitRequirements、中文确认分支。仅在初次规划或需求 changed 时失效草案；操作状态约束由代码控制。
- [x] Action 依赖 purpose 和真实组件授权；本地组件使用语言字典，补充查询数据使用 JSON。preview 明确 operation=preview_itinerary，不把其语义需求合并回会话；保留候选副本提交与原有容量/并发机制。
- [x] 重跑流程、模型服务、需求及本地化测试；确认现有 TTL、容量、并发、重放、取消、编辑与查询恢复测试继续通过。

## Task 6: HTTP 边界、文档与完整验证

**Files:** Modify `services/chat/src/llm/ui-protocol/ui-chat.controller.ts`, `ui-chat.http.spec.ts`, `services/chat/LANGCHAIN.md`。

**Interfaces:** HTTP 可选 locale 传入 flow 第三参数；认证 scope 实现保持。公开响应不包含 semantics。

- [x] 更新 HTTP 替身为 envelope；写测试：省略 locale 成功；locale=en 配中文需求得到英文固定 UI；后续 Action 继承 en；不同用户同 session 隔离；未知语言合法并固定文案回退 en；无效语言标记和任意 semantics/stage 请求字段拒绝；响应没有 semantics。
- [x] 运行 `bun run test -- src/llm/ui-protocol/ui-chat.http.spec.ts`，确认新用例失败。
- [x] Controller 传递 locale，更新文档中的 envelope 内外区别、purpose、语言优先级、可选币种、返回日期角色和调用次数；保留旧请求示例，并增加英文及 locale 示例。
- [x] 在 `services/chat` 执行 `bun run test -- src/llm/ui-protocol`、`bun run typecheck`、`bun run test`；以实际输出为通过证据，只修复本次变更引入的失败。
- [x] 使用 `rg` 检查生产 ui-protocol 无业务中文正则/label 匹配；检查 diff 没有凭证或越界变更。复查无草案视图、操作权限、会话语言和 JSON Schema 严格要求。
- [x] 更新本计划完成状态，记录检查结果，并按选定执行方式完成代码审查；需要提交时只提交本次任务文件，不混入用户改动。

## 执行与自审

任务 1–5 共享协议和状态接口，按顺序实施。中间步骤可能需要同步测试 fixture 与调用类型，最终不得保留旧模型结构或语言关键词兜底。没有引入新的依赖或真实供应商调用。

六个任务覆盖批准设计；五类 Review Focus 均有对应测试。币种可选是需求、表单、模型提示词与验收的共同约束。新增语言标记可进入同一语义流程，但只有 zh/en 固定文案资源，不将法文替身测试解释为真实模型质量证明。

推荐在当前会话直接实施：任务共享接口较多，顺序修改便于统一协议并控制工作量。也可选择逐任务由子代理实施和审查；执行方式由用户选择。
