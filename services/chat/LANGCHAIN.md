# LangChain 模型调用基础

## 旅游 UI Structured Output

`POST /api/ui-chat/chat` 与 `POST /api/ui-chat/action` 沿用全局 Bearer 登录保护。
返回 `{ message, intent, components }`，组件由 `type` 区分 text、selection、form、
confirmation、card、steps、table、action_buttons。所有组件都有服务端生成的 `id`。
模型通过 `withStructuredOutput(uiModelJsonSchema, { method: 'functionCalling', strict: true })`
在一次调用中生成 `{ semantics, response }`。内部 semantics 包含意图、操作建议、回复语言及
明确需求增量；HTTP 只返回 response，不暴露 semantics。自定义校验不传入 SDK 的严格
JSON Schema。服务端根据稳定字段推进状态，不从用户输入、标题或标签中匹配语言关键词。
`uiModelJsonSchema` 从同一份 Zod schema 生成，并展开本地引用，避免 SDK 生成的属性路径引用
被实际模型接口拒绝；模型返回值仍经过完整的 Zod 与业务校验。

selection 包含 `purpose: trip_type | query_filter | query_candidate`；规划类型选项 value
固定为 business/family/solo/couple，不随语言变化。独立查询不能返回 trip_type selection。

chat/action 都可传可选 `locale`（语言标记，例如 zh、en、en-US），省略仍有效。
显式 locale 会保存为会话偏好，优先于当前输入语言；没有偏好时由模型理解当前输入语言，
数字、日期或短回复沿用会话语言。纯 UI Action 继承会话语言。固定组件文案目前提供中英文，
其他语言固定文案回退英文；模型内容可使用其他语言，增加字典不需要修改状态机。

聊天请求：

```json
{ "sessionId": "travel-demo", "input": "我要去日本旅游" }
```

英文界面示例（输入语言与展示偏好可以不同）：

```json
{ "sessionId": "travel-demo-en", "input": "Plan a solo trip to Tokyo for 2 people, budget 5000", "locale": "en" }
```

模型将自然语言转换成结构化需求，已给出的需求不重复询问。预算币种可选，不出现在
规划表单，也不要求用户填写三位币种代码；只有预算金额仍可继续规划。明确提供币种时模型
可保存为内部信息，未明确时不默认人民币或其他币种。日期保留用户表达的角色：只提供返程
日期不会被当作出发日期，角色不明确的日期不自动写入需求。

该请求缺少旅游类型时返回 selection；选择后只展示尚未收集的旅游需求表单。
以下 Action 的 componentId 必须替换为最近一次响应中的真实组件 ID：

```json
{ "sessionId": "travel-demo", "action": { "type": "selection", "componentId": "返回的组件ID", "values": ["solo"] } }
```

表单只提交实际展示的字段。number 使用 JSON 数字，date 使用合法 YYYY-MM-DD。
下例适用于目的地已从原始输入收集、表单要求日期/人数/预算的情况：

```json
{ "sessionId": "travel-demo", "action": { "type": "form_submit", "componentId": "返回的表单ID", "values": [
  { "name": "departureDate", "value": "2026-11-01" },
  { "name": "returnDate", "value": "2026-11-03" },
  { "name": "travelers", "value": 1 },
  { "name": "budget", "value": 5000 }
] } }
```

完成需求后返回路线草案 card、steps 和操作按钮。可输入“确认旅游路线”，
或提交真实按钮 ID，进入 confirmation + steps：

```json
{ "sessionId": "travel-demo", "action": { "type": "button_click", "componentId": "返回的按钮组ID", "buttonId": "confirm" } }
```

```json
{ "sessionId": "travel-demo", "action": { "type": "confirmation", "componentId": "返回的确认ID", "confirmed": true } }
```

`confirmed: false` 返回路线预览。确认只保存会话中的路线，不进行预订或支付。
英文 `Confirm this itinerary` 等同样通过语义操作进入确认，不清空已有草案；自然语言确认
只展示确认入口，最终 confirmed 必须由有效的 confirmation Action 设置。实际需求改变才
使旧草案失效，重复同值需求不会重新生成。缺少草案时返回正常说明。

普通聊天的语义解析和 UI 生成不额外增加调用。首次需求齐备或实际需求改变后，沿用独立的
路线预览生成调用，基于服务端已经验证并合并的需求生成草案。

“查看某某地点或者酒店”返回详情 card；“帮我找杭州西湖附近500米的酒店”直接进入
hotel_search，不经过旅游类型向导，保留地点、距离、预算等完整原始查询条件。
独立查询不会覆盖规划需求；已有规划时返回 resume_planning 按钮恢复原阶段。
refine_search 展示筛选表单，view_details 继续查询详情。
查询中的 selection 支持单选、多选筛选或候选选择，所选 value 与 label 会连同原始条件
传入下一次查询，不改变路线规划阶段。普通旅游知识问答直接返回 text。

本模块没有接入旅游供应商，card 标记 `sourceStatus: unverified`；没有可信搜索结果时
table.rows 应为空。输出是说明、需求收集或建议，不能作为实时价格、库存或距离证明。

会话按认证 userId 和客户端 sessionId 隔离，同会话请求串行，生成失败不提交状态。
交互 ID 每轮更新，旧组件及重复提交返回 409；无效请求/字段返回 400，未知或过期会话的
Action 返回 404，模型/输出校验失败返回 502。最多 1000 个活动会话，超限返回 429。
会话闲置 30 分钟过期，历史仅保留最近 20 条消息。状态存于进程内存，重启清空，
不支持多实例共享。过期条目在请求时清理。

模型参数读取 `config/langchain.yaml` 的 `llm` 节点。模型工厂仅支持
`provider: openai`，也可通过环境变量连接 OpenAI 兼容服务。

启动服务前，向进程注入 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL`（完整 API
基础地址，包含服务要求的 `/v1` 等路径）。两项均必填；模型工厂不提供硬编码
服务地址。`.env` 已被 Git 忽略，代码通过 `process.env` 读取变量；使用 `.env`
时需由启动器加载，例如在 `services/chat` 目录执行：

```sh
node --env-file=.env dist/main.js
```

模型请求支持 `.env` 中的 HTTP 代理配置：

```dotenv
HTTPS_PROXY=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890
```

模型工厂优先读取非空的 `HTTPS_PROXY`，否则读取 `HTTP_PROXY`，并使用
Undici `ProxyAgent` 发送 invoke、stream、batch 请求。两项均未设置时直连。
代理仅作用于模型客户端；修改 `.env` 后需重启服务并加载该文件。

提示内容定义在 `src/llm/prompts/requirement.prompt.ts`，分别导出
`REQUIREMENT_SYSTEM_PROMPT` 和包含 `{input}` 的 `REQUIREMENT_USER_TEMPLATE`。
`src/llm/requirement.prompt-builder.ts` 使用
`ChatPromptTemplate.fromMessages()` 组装 system + human 消息。

最小渲染与模型调用示例（在 `src/llm` 下使用）：

```ts
import { buildRequirementPrompt } from './requirement.prompt-builder.js';
import { createChatModel } from './model.factory.js';

const input = '用户注册时必须绑定手机号，密码至少8位';
const prompt = buildRequirementPrompt();
const messages = await prompt.formatMessages({ input });
console.log(messages); // 仅渲染，无需模型配置

const result = await createChatModel().invoke(messages);
console.log(result.content);
```

两个示例路由无需请求体，统一使用上述测试输入：

| 路由                                  | 响应                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `POST /api/langchain/prompt-preview`  | `{ "messages": [{ "role": "system", "content": ... }, { "role": "human", "content": ... }] }`；只渲染，不创建或调用模型 |
| `POST /api/langchain/prompt-to-model` | `{ "content": ... }`；模板 → `formatMessages()` → `model.invoke()`                                                      |

```sh
curl -X POST http://localhost:4001/api/langchain/prompt-preview
curl -X POST http://localhost:4001/api/langchain/prompt-to-model
```

预览中的 human 内容为 `请逐步分析并输出结构化抽取结果：\n用户注册时必须绑定手机号，密码至少8位`。
预览无需 API Key；模型调用需要前述环境变量。

原有三种路由也复用同一模板，通过 JSON 请求体传入输入：invoke 和 stream
使用 `{ "input": "用户注册时必须绑定手机号，密码至少8位" }`，batch 使用
`{ "inputs": ["用户注册时必须绑定手机号，密码至少8位"] }`。

| 路由                         | 响应                                                         |
| ---------------------------- | ------------------------------------------------------------ |
| `POST /api/langchain/invoke` | `{ "content": ... }`                                         |
| `POST /api/langchain/stream` | SSE：`data: {"content":...}`，结束为 `data: [DONE]`          |
| `POST /api/langchain/batch`  | `[{ "content": ... }]`，对传入的输入列表调用 `model.batch()` |

流式客户端需使用支持 POST 的流读取方式。客户端断开时取消上游调用；开始传输后
上游异常通过 SSE `error` 事件报告。GPT-5 模型的 SDK 会将 `SystemMessage`
映射为 OpenAI 协议中的 `developer` 消息。

部署时保留服务目录中的 `config/langchain.yaml`；编译后的加载器仍从该位置读取。
集成测试连接本地 OpenAI 兼容测试服务器，不消耗真实模型令牌。

## 需求分析 Multi-Agent 固定编排

`POST /api/agents/orchestrate` 接收非空字符串 `input`：

```json
{
  "input": "开发一个面向需求分析师的会话记忆系统，支持多轮澄清并自动裁剪长对话上下文"
}
```

固定流程为 `extractAgent → clarifyAgent → 并行(analysisAgent + riskAgent) → summaryAgent`。
五个 Agent 均使用 `ChatPromptTemplate.pipe(model).pipe(StringOutputParser)`，
通过现有模型工厂读取模型、API Key、Base URL 和代理配置。
抽取 JSON 字段为 `goal`、`users`、`features`、`constraints`、`unknowns`；
澄清 JSON 字段为 `needsClarification` 和 `clarificationQuestions`。
两者经过 JSON 解析及 schema 校验；分析、风控、汇总输出非空 Markdown。

响应始终包含以下字段：

| 字段 | 说明 |
| --- | --- |
| `mode` | 固定为 `fixed` |
| `status` | `completed`、`needs_clarification` 或 `failed` |
| `clarificationQuestions` | 需要澄清时返回问题数组，否则为空数组 |
| `usedAgents` | 本次尝试执行的 Agent 名称，按工作流顺序排列 |
| `fallback` | 正常或待澄清时为 `null`；失败时为 `manual_review` |
| `steps` | 每步包含 `agent`、`status`、`output`；失败步增加通用 `error` |
| `report` | 成功时为最终 Markdown 报告，否则为 `null` |

需要澄清时在第二步立即终止，不执行分析、风控及汇总。
该接口不保存会话，调用方可将澄清答案合并到新的 `input` 后再次请求。
任一步模型调用、模型初始化或输出校验失败均返回 `failed` 和 `manual_review`，
供调用方转人工处理；非法请求输入返回 HTTP 400。

新增测试通过本地模型替身执行真实提示词、LCEL 链、编排服务和 HTTP 路由，
覆盖上述示例输入、澄清终止、并行执行、上下游数据传递及失败回退，不消耗真实模型令牌。

## 第四章统一 Nest 入口

`AdvancedModule` 统一注册会话记忆、Embedding、向量库、文件服务、多 Agent 编排
和 `AdvancedAnalysisService`。五个 Controller 定义在 `src/llm/advanced.controller.ts`，
原有 `/api/memory`、`/api/files`、`/api/embedding`、`/api/agents` 路由继续可用。
`AppModule` 导入该模块；`LlmModule` 也导入并导出该模块，复用同一组服务。

`POST /api/advanced/analyze` 接收 `{ sessionId, input }`。服务读取该 session 的完整
历史后执行固定多 Agent 流程，区分用户提供的信息与助手建议。需要澄清时直接返回
`status: needs_clarification` 和 `clarificationQuestions`，不保存报告或写回最终结论。
编排失败时保留 `failed` / `manual_review` 响应，也不写入报告或结论。

成功响应包含完整 Markdown `report`、相对于 workspace 的 `reportPath`，以及编排的
`steps`、`usedAgents` 等字段。报告保存为 `workspace/reports/{UUID}-analysis.md`，
随后用 `appendMessage(sessionId, input, report)` 写回原始第四轮输入和报告原文。
保存或写回均不调用模型；保存失败不会写回成功结论。UUID 文件名避免覆盖已有报告。
Memory HTTP 路由继续裁剪模型上下文至 2000 tokens，完整历史与统一分析服务共享。

四轮测试按相同 `sessionId` 依次请求：

| 轮次 | POST 路由 | input |
| --- | --- | --- |
| 1 | `/api/memory/chat` | 我们想做一个需求分析助手，希望它能记住多轮对话 |
| 2 | `/api/memory/chat` | 需求单号是 REQ-2026-001 |
| 3 | `/api/memory/chat` | 用户注册时必须绑定手机号，密码至少8位 |
| 4 | `/api/advanced/analyze` | 帮我判断这个需求是否完整，并产出一份需求分析报告 |

第四轮请求示例：

```json
{
  "sessionId": "requirement-demo",
  "input": "帮我判断这个需求是否完整，并产出一份需求分析报告"
}
```

可通过 `GET /api/memory/history/requirement-demo` 检查报告写回后的历史。
自动测试 `src/llm/advanced.http.spec.ts` 使用本地 OpenAI 兼容测试服务执行真实链和
HTTP 路由，验证前三轮上下文、session 隔离、报告文件内容、无额外模型调用、澄清、
编排失败、文件写入失败和参数校验。
