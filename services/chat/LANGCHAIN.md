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
