# 旅游 UI 响应协议与意图分流设计

## 目标与范围

在 `services/chat` 的 LangChain 层实现八类 UI 组件、Structured Output、确定性 UI Action 处理及两个 Nest HTTP 路由。协议服务于旅游路线规划，也支持独立酒店、地点和航班查询；用户不必经过统一的规划向导。

已认可的核心原则：模型理解意图并生成符合协议的组件，服务端校验操作并推进对应流程；确定性指有效操作有明确状态转移，不代表所有请求都走固定步骤。

本次实现后端协议与编排，不包含前端组件渲染、酒店供应商接入、支付或预订。仓库当前没有旅游搜索工具，不能把模型生成的信息宣称为真实搜索、实时房价或可订库存。

## 文件与职责

- `services/chat/src/llm/ui-protocol/ui-types.ts`：组件联合类型、AIUIResponse、UIAction、流程上下文。
- `services/chat/src/llm/ui-protocol/ui-schemas.ts`：八类组件及 Action 的 Zod discriminated union、响应及请求 Schema。
- `services/chat/src/llm/ui-protocol/ui-response.service.ts`：提示词、模型 Structured Output 调用、输出及业务约束校验。
- `services/chat/src/llm/ui-protocol/ui-flow.service.ts`：会话、待处理组件、历史及确定性状态转移。
- `services/chat/src/llm/ui-protocol/ui-chat.controller.ts`：请求校验、身份作用域与两个路由。
- `services/chat/src/llm/ui-protocol/ui-protocol.module.ts`：依赖注入注册，由现有 `LlmModule` 导入。
- 同目录 `*.spec.ts`：协议、模型服务、流程与 HTTP 测试。
- `services/chat/LANGCHAIN.md`：接口及 Action 示例、状态存储和数据来源限制。

## 响应协议

`UIResponse` 为基于 `type` 的八类组件联合，每个组件有非空 `id`。`AIUIResponse` 包含 `message`、`intent` 和非空 `components: UIResponse[]`；intent 为 `trip_planning | hotel_search | place_details | flight_search | general`。服务端保存当前流程状态，模型不直接写入状态。

| type | 字段与业务用途 |
| --- | --- |
| text | content、format（plain/markdown），解释与普通问答 |
| selection | title、mode（single/multiple）、options（value/label/description），旅游类型与候选目的地选择 |
| form | title、fields、submitLabel，收集缺失旅游需求 |
| confirmation | title、summary、confirmLabel、cancelLabel，确认当前路线摘要 |
| card | title、category（place/hotel/flight/itinerary）、description、details（label/value）、sourceStatus（verified/unverified），旅游详情 |
| steps | title、items（id/label/status），status 为 pending/current/completed |
| table | title、columns（key/label）、rows（id/cells），cells 为 key/value 列表，批量对比 |
| action_buttons | buttons（id/label/action），action 为明确允许的业务动作 |

表单字段各自以 `type` 区分 `input | select | textarea | date | number`，公共字段为 name、label、required。select 包含 options；number 可包含 min/max；文本字段可包含 placeholder。日期提交值为合法 `YYYY-MM-DD`，人数为正整数，预算非负，返程不能早于出发。可选字段使用模型 Structured Output 能接受的可空表示，避免任意对象映射导致 JSON Schema 不兼容。

`uiResponseSchema` 必须使用 `z.discriminatedUnion('type', ...)`。`aiUIResponseSchema` 包装该联合；所有组件 Schema 均单独导出。类型与 Schema 的结构保持一致，优先通过类型推导避免重复漂移。

## Structured Output 与场景指南

`generateUIResponse(input, history?, context?): Promise<AIUIResponse>` 复用 `createChatModel()`，调用 `model.withStructuredOutput(aiUIResponseSchema)`，再进行运行时校验。history 使用 LangChain 消息；context 为服务端流程快照与已收集需求。模型延迟初始化，Nest 启动无需模型凭证。

系统提示词必须包含八类组件的使用条件、意图分流原则和以下场景：

- “我要去日本旅游”：没有已知旅游类型时返回 selection，包含商务出差、亲子游、个人游等选项；已提供的需求不重复询问。
- “查看某某地点或者酒店”：返回 card。缺少可信来源时 sourceStatus 为 unverified，不编造地址、价格、库存或精确距离。
- “帮我找杭州西湖附近500米的酒店”：进入 hotel_search，保留地点与 500 米约束，直接返回 card/table；无查询来源时说明尚无经过验证的结果，不虚构满足半径的酒店。仅在用户要求日期相关房价、库存且日期缺失时询问入住日期。
- 确认已有旅游路线：同时返回 confirmation 和 steps，summary 来自会话中已有路线。没有路线时收集缺失内容，不制造“已确认”状态。
- 普通问答：text，不启动旅游规划向导。
- 单个结构化候选用 card，批量候选用 table；可点击的明确后续动作用 action_buttons。

语义校验阻止详情请求返回旅游类型向导、没有路线却进入路线确认，以及确认组件缺少 steps。输出失败返回通用 502；不静默回退为未经校验的自由文本。history/context 作为数据传递，不允许覆盖系统约束。

## 意图与确定性状态机

会话保存规划阶段、收集的需求、待处理组件、历史及当前展示意图。规划阶段为 `idle | choosing_trip_type | collecting_requirements | reviewing_itinerary | awaiting_confirmation | confirmed`；独立查询不清空规划草稿。

| 当前情况/操作 | 结果 |
| --- | --- |
| 自由输入规划请求且旅游类型缺失 | choosing_trip_type，展示 selection |
| 自由输入已包含旅游类型 | 跳过类型选择，按缺失需求展示 form 或路线预览 |
| 类型 selection 提交有效选项 | collecting_requirements，保存类型并收集缺失需求 |
| 需求 form 合法提交 | reviewing_itinerary，展示路线草案及确认入口 |
| reviewing_itinerary 请求确认 | awaiting_confirmation，展示 confirmation + steps |
| awaiting_confirmation 确认 | confirmed，展示已确认摘要及完成进度，不执行预订 |
| awaiting_confirmation 取消 | reviewing_itinerary，保留需求及路线，允许修改 |
| 任意阶段查询酒店/地点/航班 | 展示查询组件，保留规划阶段与草稿 |
| 查询详情或调整筛选 | 更新对应查询上下文，不提交或确认规划路线 |
| 返回规划 | 依据保存阶段恢复规划组件 |

Action 为基于 `type` 的联合：`selection`（componentId、values）、`form_submit`（componentId、values 字段列表）、`confirmation`（componentId、confirmed）、`button_click`（componentId、buttonId）。按钮 action 限定为 `view_details | refine_search | confirm_itinerary | edit_itinerary | resume_planning`。

`handleAction(sessionId, action): Promise<AIUIResponse>` 查找当前会话中实际展示的组件，再校验类型、选项、字段及当前阶段。Action 本身不携带目标状态，不允许调用方或模型自由指定状态转移。single 只能提交一个选项；未知选项、未知或重复字段、错误值类型、缺少必填字段均拒绝。确认操作只接受当前待确认路线对应的组件。

自由聊天与 Action 在同一会话内串行处理。成功生成并校验下一步响应后才提交状态和历史；失败保留之前状态。每轮为交互组件分配服务端唯一 ID，防止旧组件/重复提交再次推进；组件内容不是可信操作授权。

## 会话与 HTTP

`@Controller('api/ui-chat')`：

- `POST chat`：`{ sessionId, input }`，返回 AIUIResponse。
- `POST action`：`{ sessionId, action: UIAction }`，返回下一步 AIUIResponse。

请求经过现有 `ZodValidationPipe`，sessionId/input 禁止空白值。沿用 AppModule 全局登录保护，服务端使用认证 userId 与客户端 sessionId 组合建立会话作用域，防止不同用户访问同名会话；用户身份不从请求体读取。

状态使用进程内存，重启清空，不支持多实例共享。闲置会话 30 分钟过期，历史只保留最近 20 条消息；单实例最多保存 1000 个会话，清理过期条目后超过上限则拒绝创建新会话。未知或过期会话的 Action 返回 404；非法操作返回 400，过期组件或阶段冲突返回 409。日志/响应不泄露模型凭证或上游详细错误。

## 验证与验收

1. Schema 验证八类合法组件、五种字段及 Action；拒绝未知 type、字段缺失、无效状态和错误字段类型。
2. 使用本地 OpenAI 兼容测试服务执行真实 `withStructuredOutput` 链，验证请求包含输出 Schema，history/context 传递以及无效模型输出被拒绝。
3. 覆盖三个原始验收输入和“杭州西湖附近500米的酒店”意图分流，不依赖真实模型或酒店库存。
4. 流程测试覆盖选择、表单、确认、取消、直接详情查询、需求跳步、查询后恢复规划、错误和重复操作、失败回滚及同会话并发。
5. HTTP 测试覆盖两个路由、请求校验、用户会话隔离和服务注册。
6. 在 `services/chat` 执行新增 Vitest 测试及 TypeScript typecheck，再运行现有单元测试回归。直接使用工作区工具，不修改 Turborepo 配置或命令。

## 自审结果

八类组件、Structured Output、Action、路由与原始三个验收场景均有对应设计；酒店查询不依赖路线规划向导。真实旅游数据源明确不在本次范围，输出来源必须可辨识。状态存储、身份隔离、并发及失败处理均定义。后续实施计划需要按这里的字段和接口展开，不额外引入预订流程。
