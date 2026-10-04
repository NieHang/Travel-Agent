# UI 协议接入聊天与实时行程面板

## 目标

将现有八类 UI 组件及其操作接入实际 `/chat` 页面，保留身份验证、聊天历史、分页、停止生成和中英文界面。采用 text streaming + component batching：Markdown 从模型增量推送，JSON 静默收集、完整校验后批量下发。右侧和移动端行程面板读取当前会话的真实数据。

## 现状及实施边界

- `ChatScreen` 使用 `useChatStream` 调用 `POST /api/conversations/:id/messages`；`MessageList` 只显示文本及需求卡片。
- `AIChatContainer` 已实现 UI Action 与 `ComponentRenderer`，但没有挂载到实际页面。
- `UIFlowService` 包含旅游意图识别、确定性状态转移和组件操作校验；目前会话只有内存 Map 和 30 分钟 TTL。
- `agents/OrchestratorService` 的五个 Agent 是软件需求分析流程，其提示词不能直接用于旅游聊天。
- 行程面板使用 `TripMock`，没有供应商数据源。酒店、航班、地点不能显示为已验证价格、库存或搜索结果。

## 架构选择

采用现有 conversation 消息接口作为统一聊天入口，围绕 UIFlowService 增加轻量流式协调层。保留现有五个软件需求分析 Agent 及其 OrchestratorService，不让它们参与旅游聊天；本次不新增多 Agent 系统。JSON 静默生成与 Markdown 流式输出是两种输出方式，不意味着必须拆成独立 Agent。另建独立 UI 聊天入口会造成两套历史和状态；直接挂载 AIChatContainer 则不能满足真实文本流、持久化和面板联动，因此不作为接入方式。

## 统一协议

`StreamMessage` 使用以 `messageType` 区分的联合类型，并包含 ISO timestamp。后端 `ui-types.ts` 导出规范类型，共享 contracts 提供前后端运行时 Schema，避免仅靠类型断言解析网络数据。

| messageType | payload 与行为 |
| --- | --- |
| markdown | content、isChunk、messageId；增量追加或完整替换文本 |
| ui | messageId、完整 components、可选公开说明、interactionState；整批替换组件 |
| meta | 会话/消息标识、已保存用户消息、已校验的行程快照及版本 |
| progress | agent、step、totalSteps、status、可选展示标签；真实阶段进度 |
| done | 已保存的助手消息及最终快照；成功流的唯一终止标记 |
| error | 稳定错误码、可选已保存 partial/error 消息；失败终止标记 |

统一使用 `event: message`，data 为完整信封。`thinking` 如保留，只代表允许公开的简短状态说明，不传递模型内部推理。终止后不再接受当前请求的新事件。

## 后端编排与持久化

1. 鉴权、归属、请求体、Action 有效性和并发检查完成后建立 SSE；请求关闭联动 AbortSignal。
2. 文本与 Action 通过同一会话流程处理。Action 带来源助手 messageId、组件 ID 和操作载荷，服务端校验其属于当前有效组件。
3. UIResponseService 静默生成、解析和校验 JSON 语义、需求和组件。阶段开始/结束发送 progress，不输出 JSON 字符串片段。
4. 需要普通回答或生成行程正文时，复用模型工厂以真实 stream 输出 Markdown；确定性选择、表单和确认操作直接生成组件，不为了流式效果增加模型调用。不把完整文本切块伪装成模型流。
5. 组件依赖完整结果，经业务校验后一次发送 ui；纯文本内容避免在 Markdown 和 text 组件重复展示。
6. 用经过校验的结构化行程快照更新面板，禁止从任意 Markdown 猜测酒店价格、路线或地点。数据不足时显示已有草稿与空态。
7. 用户消息保存后发送 meta；助手正文、组件、interactionState、流程上下文、行程快照在结束时一起落库。成功保存后发送 done；中止保存 partial，失败保存 error，不把半截 JSON 存为有效组件。
8. 会话串行执行并控制重复操作。流程先在候选快照上运行，提交和恢复以持久化结果为准；取消/失败不能留下客户端未获知的内存状态推进。重启或 TTL 到期可从持久化消息恢复有效流程。

## 前端状态与交互

React Query 继续管理历史分页及已保存消息。新增 Zustand 管理当前请求的 streamingMessage、components、progress 和实时面板快照；token 不写入历史 messages 数组。完成时只将最终助手消息写入 Query 缓存一次，清理临时流状态。

使用 `@microsoft/fetch-event-source` 接收 POST SSE，保留现有 apiFetch 的身份验证、刷新令牌和错误语义；不自动重发可能产生重复消息的 POST。响应类型、信封和 payload 均校验；空流、缺少终止事件和异常断开按失败处理。

`MessageBubble` 复用 ComponentRenderer，组件操作回到统一发送入口。只允许当前可操作回复的组件交互，生成期间禁用，历史组件保留展示。账户切换、会话切换和卸载中止旧请求；按请求标识隔离迟到事件。

右侧和移动端面板读同一个当前会话快照；消息加载后恢复快照，切换会话立即隔离旧数据。去掉 getTripMock 和 sample 标签。保留现有标签页视觉；行程展示真实草稿及结构化日程，其余标签页在无数据时显示本地化空态。独立查询不清空已有规划草稿，修改需求使旧草稿失效时明确显示待更新状态。

## 进度视觉

在聊天回复附近显示圆形进度组件，采用参考图的紫色环、百分比及阶段标签，尺寸适配现有页面。阶段表示实际处理步骤（理解需求、生成回答/行程、更新面板、保存结果），不强行对应 Agent；不需要模型的操作跳过相应步骤。进度由已完成阶段/总阶段数计算，等待阶段不编造 token 百分比；直到收到已持久化的 done 之前最多显示 99%。

done 后先达到 100%，紫色背景从右下向左上快速填满圆形，同时对号弹出。用 CSS/SVG 与现有 motion 实现，建议填充约 350ms、对号约 200ms；完成后短暂保留再收起。失败和取消不播放成功动画。尊重 prefers-reduced-motion，提供 progressbar/status 语义和中英文标签。

## 验收与验证

- 文本首个 token 在模型结束前出现，JSON 片段不进入页面；ui 事件包含完整合法组件。
- 实际 /chat 页面能完成规划、选择、表单、预览、确认、取消确认和修改的多轮交互。
- 历史刷新和服务重启后可恢复组件、有效操作状态与行程面板；无 mock 回退或跨会话数据串扰。
- 验证鉴权、归属、过期/伪造 Action、并发提交、异常断流、模型失败、停止生成和账户切换。
- 验证 SSE 拆包/UTF-8、替换与增量语义、组件批次、最终落库一致性与重复 done 防护。
- 验证进度与 done 顺序、失败无对号动画、减少动态效果及桌面/移动布局。
- 运行受影响后端/前端单元和集成测试、contracts 构建及类型检查；本地浏览器验证完整链路。真实模型调用单独报告验证结果，不把模拟测试称为真实模型通过。

## 后续实施计划边界

实施按共享协议 → 持久化及状态恢复 → UIFlowService 流式协调/SSE → 前端流状态/Action → 面板 → 进度动画 → 集成验证展开。代码位置以仓库现有 `chat.controller.ts`、`ui-protocol/` 和 `ChatScreen` 为准，用户伪代码中的路径按实际结构映射。
