# UI Protocol 多语言语义与展示设计

## 已确认目标

用户当前面向中文、英文用户，未来可能增加其他语言。用户已选择：扩展现有 Structured Output 调用，同时返回结构化语义和 UI，不另增独立语义解析调用。

用户明确要求：budgetCurrency 不属于必填需求，用户不需要填写三位币种代码。

成功标准：等价中英文输入得到等价业务行为；服务端不从用户文本、组件标题或选项标签中提取业务关键词；模型提出语义和操作，服务端校验并掌控状态；服务端生成的文案支持中英文，增加语言不需要修改状态机。

这是对 `2026-10-04-ui-chat-design.md` 的增量修订，替代其中基于原始文本的语义推断。沿用会话隔离、串行执行、过期策略、失败回滚及无旅游供应商的限制。

## 模型输出与公开响应分离

单次模型输出为严格对象 `{ semantics, response }`。`response` 沿用 `{ message, intent, components }`；HTTP 不暴露内部 semantics。

semantics 必填字段如下，未提取信息使用 null，避免 Structured Output 中的隐式 optional：

| 字段 | 定义 |
| --- | --- |
| intent | trip_planning / hotel_search / flight_search / place_details / general |
| operation | answer / update_requirements / request_confirmation / cancel_confirmation / resume_planning |
| replyLanguage | 语言标记，例如 zh、en；允许未来语言标记，运行时规范化 |
| requirements | 明确的需求增量对象，字段见下文 |

requirements 字段：destination、tripType、departureDate、returnDate、travelers、budget、budgetCurrency、preferences。tripType 使用 business/family/solo/couple 的稳定枚举；人数为 1–100 的整数；预算为非负有限数；日期为合法 ISO 日期。budgetCurrency 是可选的内部语义信息：仅将用户明确表达且可确定的币种规范化为三位大写代码，否则使用 null；不要求用户输入代码。所有字段在模型 schema 中存在且可空，这是输出结构约束，不表示这些需求业务上必填。null 表示本轮未提供，不覆盖现有值；本次不引入自由文本删除需求的操作。

模型只提取用户当前明确表达的规划需求，不从历史中的查询补齐规划预算，不擅自猜测人数、币种或日期角色。输入含多个可能意图时依据本轮主要任务及会话判断；无法可靠判断时用 general + text 澄清，而非返回置信度阈值。

semantics.intent 与 response.intent 必须相同。查询/general 必须具有空的规划需求增量，operation 为 answer；其他规划操作不携带需求更新。update_requirements 允许空增量，用于初次启动规划。

replyLanguage 是语言理解结果，不是状态授权。模型不能输出目标 stage、已确认标记或任意按钮操作。

## 不依赖展示文案的组件用途

selection 新增必填 purpose：trip_type / query_filter / query_candidate。服务端旅游类型选择固定为 trip_type，选项 value 使用稳定枚举；查询不得包含 trip_type。其余字段和 Action 结构沿用现有协议。目的地等规划需求通过表单收集，本次不添加通用规划 selection。

所有业务判断依据 intent、operation、purpose、category、字段 name 和 Action，不检查自然语言标题、标签或 input。

validateUIResponse 拆分为公开 UI 结构/状态约束校验和内部模型结果校验；删除中文意图正则、详情关键词正则和旅游类型标签匹配。保留 ID 唯一性、确认摘要与当前草案一致、确认必须带 steps、预览必须有 itinerary card、无供应商不能使用 verified 等约束。

详情 intent 为 place_details 时要求 card；hotel_search/flight_search 可返回 card/table/form/查询 selection。服务端创建的 query 上下文仍约束后续查询 intent，模型不能自行切换。

## 处理流程

自由聊天先调用现有模型服务取得完整结果，再验证并根据 semantics 分流。移除 queryIntent、planningInput、collectExplicitRequirements 和中文确认匹配。

1. answer：展示经过验证的模型 UI。查询时保存原始输入作为 query.input，保留规划需求、阶段和草案，并按需添加恢复规划按钮；general 不改规划状态。
2. update_requirements：校验并合并非空字段，与既有字段组合校验日期；初次规划或实际需求变化才使草案失效。既有草案且无需求变化时恢复当前规划展示，避免随口谈论规划就删除草案。
3. request_confirmation：仅 reviewing_itinerary/awaiting_confirmation 且存在草案时进入 awaiting_confirmation，服务端生成 confirmation + steps；草案不变。没有可确认草案时返回本地化说明及当前规划组件，idle 时用 text，不生成空表单或虚构确认。
4. cancel_confirmation：仅 awaiting_confirmation 时恢复 reviewing_itinerary；其他阶段返回说明和当前视图，不清空草案。
5. resume_planning：存在规划流程时清除当前查询并恢复展示；idle 时返回说明 text。

自然语言请求确认只展示确认入口；最终 confirmed 状态继续仅由当前有效 confirmation Action 设置。模型确认组件仍须符合当前状态和摘要约束；当返回本地组件时，服务端拥有最终内容。

Action 的组件授权、状态、类型、值校验保持服务端确定性。规划类型 selection 必须 purpose=trip_type；查询 selection 按 purpose 处理，不借标题推断。

为避免新结构被第二次生成错误地覆盖，内部 generate 返回模型 envelope；查询/预览调用显式取得 response，忽略需求更新并校验它们应为空。预览继续使用受信任 context.operation=preview_itinerary，输入使用中立的操作描述和结构化需求，不承担再次解析用户需求的职责。

一次自由聊天的语义解析与 UI 生成共享一次模型调用。需求齐备时沿用额外的路线预览调用：它依赖服务器刚合并的需求，不是新增的独立解析调用。测试明确验证普通聊天不新增解析调用。

## 语言策略与服务端文案

chat/action 请求增加可选 locale，仅作为展示偏好，不影响身份和业务权限。支持规范化的语言标记；省略仍兼容既有调用。当前服务端文案资源注册 zh/en，其他语言输入也进入相同语义流程，固定组件文案缺少资源时回退 en，不宣称已提供完整其他语言界面。

语言优先级：请求显式 locale（会话保存） > 有明确新语言的当前输入识别结果 > 已有会话语言 > en。短回复、数字、日期和纯 Action 沿用会话语言。模型收到偏好和当前语言上下文；有显式偏好时模型 replyLanguage 必须遵循该偏好。模型生成的文本可使用其他语言；固定文案按注册资源回退。

UIFlowContext 增加 replyLanguage 与 preferredLocale；语言变化只更新成功提交的候选会话，失败回滚。服务端规划字段、类型选项、进度、确认、查询筛选及恢复按钮集中到 ui-localization.ts，按 key 使用 zh/en 字典，避免组件函数散布语言判断。内部 Action 补充数据用 JSON 表达，不用用户可见文案作为命令。

账号已具备 zh/en locale，但 CurrentUser 只有 userId；此次不扩展认证及账号查询。可选 locale 作为 UI Chat 的明确接口，未来调用端传递当前界面语言。前端当前尚未集成 ui-chat，此次不添加前端功能。

## 预算与需求校验

规划表单使用通用“总预算”文案，移除固定人民币假设，不添加 budgetCurrency 表单字段，不要求用户填写或选择币种。用户只提供预算金额即可满足预算收集要求；币种缺失不阻止生成路线、不触发补充表单或强制追问。

用户以“人民币”“美元”等自然语言明确表达币种时，模型可将其规范化保存到内部 budgetCurrency；含歧义的货币符号或未提供币种时保持未知。数值预算不隐含任何币种；币种未知时，路线草案不得自行补上币种或声称费用已经满足确定币种的预算。模型需求增量与表单提交共用规划字段值校验，拒绝无效日期、非法人数/预算和组合日期倒置；仅对模型实际提供的非空内部币种代码校验格式。

用户只提供 returnDate 时仅保存 returnDate；一个不明确角色的日期不自动写入 departureDate。缺失的必填需求通过现有本地化表单补齐，budgetCurrency 不参与必填字段判断。本次不引入汇率或货币转换。

## 兼容性与错误处理

HTTP 响应根结构保持不变，selection 增加 purpose。现有请求省略 locale 仍合法。内部 generateUIResponse 的返回类型变为 envelope，更新所有服务调用和测试替身；不添加旧模型输出兜底，否则语义缺失重新引入语言正则。

输出 schema、语义/UI 一致性或受信任预览/查询约束违反时，统一 502 并保留会话。非法 UI Action 继续 400/409，未知会话继续 404。无法执行的自然语言操作通过正常说明处理，而非删除草案。保持不泄露上游错误详情的现有行为。

## 验收与文件范围

修改 ui-types.ts、ui-schemas.ts、ui-response.service.ts、ui-flow.service.ts、ui-flow.components.ts、ui-form.validation.ts、ui-chat.controller.ts，新增 ui-localization.ts 和必要共享需求校验辅助函数，更新同目录测试及 services/chat/LANGCHAIN.md。

测试覆盖：

- 等价中文、英文、混合语言需求产生相同字段/阶段；至少一个第三语言结构化样例无需新增正则。
- solo、人数、目的地、预算及显式币种不会重复询问；未给币种也可生成路线，表单不出现币种代码输入项，不强制追问币种。
- 自然语言币种可规范化为内部信息；币种未知时不默认人民币或其他币种，输出不宣称已经满足确定币种的预算。
- 仅返程日期不会写为出发日期；非法及跨轮倒置日期拒绝并回滚。
- 英文确认保留旧草案；确认/取消/恢复/否定请求按语义推进，最终确认仍需要 UI Action。
- 查询不更改规划需求；英文 purpose=trip_type 被禁止用于查询；改写标题不改变行为。
- 需求无变化不清空草案；需求变化使待确认组件失效。
- 中英文所有固定组件文案、locale 优先级、短回复/Action 语言继承和未注册语言回退。
- 本地 OpenAI 兼容服务验证 strict envelope schema、单次解析调用、历史及上下文、无效语义及 UI 被拒绝。
- HTTP 验证新增可选 locale、原有身份隔离、重放保护和输入校验。

直接在 services/chat 运行相关 Vitest、typecheck 和现有单元测试回归，不修改 Turborepo 配置或命令。不接入实时模型、供应商或额外语言服务。

## 自审

模型输出的 operation 与受信任服务器 operation 分开，前者只是用户操作建议。公开 UI 不包含内部需求解析。语言资源与状态机分离；注册外语言有明确回退。空需求增量不会误删除草案。币种和日期角色不猜测。新增字段会更新测试 fixtures 和文档，无旧中文正则兼容路径。
