# LangChain 模型调用基础

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
