# 需求分析助手 Memory

`RunnableMemoryService` 使用 `RunnableWithMessageHistory` 和 `InMemoryChatMessageHistory` 保存完整多轮对话。`TrimmedMemoryService` 在此基础上使用 `trimMessages`，配置为 `maxTokens: 2000`、`strategy: 'last'`。两个服务均由 `LlmModule` 注册并导出，分别维护自己的会话集合。

两个版本均支持：

- `chat(sessionId, input)`：返回 `{ content }`，成功后追加本轮 Human/AI 消息。
- `getHistory(sessionId)`：返回 `BaseMessage[]` 快照；不存在的会话返回空数组。
- `appendMessage(sessionId, human, ai)`：追加一对消息，无需调用模型。
- `clearSession(sessionId)`：删除指定会话；重复清除也是安全的。

HTTP 默认使用裁剪版本：

| 方法   | 路由                             | 返回                                   |
| ------ | -------------------------------- | -------------------------------------- |
| POST   | `/api/memory/chat`               | `{ content }`                          |
| GET    | `/api/memory/history/:sessionId` | `[{ role: 'human' \| 'ai', content }]` |
| DELETE | `/api/memory/history/:sessionId` | `{ cleared: true }`                    |

会话按原始 `sessionId` 隔离，同一会话的操作按调用顺序执行。空白或非字符串参数返回 400。模型沿用 `config/langchain.yaml` 及 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 配置。

裁剪作用于模型输入，包含系统指令、历史与本轮输入；保留系统指令，并从最近的完整 Human 轮次开始。历史查询仍返回完整存储的对话。当前输入加系统指令超过预算时返回 400，避免静默丢弃本轮输入。token 计数使用 LangChain 已安装的 `js-tiktoken` 及本地编码表，不下载编码表；计数包括模型消息格式开销。2000 是输入上下文预算，输出上限仍由 YAML 的 `llm.maxTokens` 决定。

记忆仅存于当前进程，重启后消失；不同服务实例不共享。裁剪不会限制存储总量，较长历史可通过 DELETE 主动清除。

## 三轮场景

在已配置模型并启动 chat 服务后，通过 PowerShell 依次发送：

```powershell
$memoryBase = 'http://localhost:4001/api/memory'
Invoke-RestMethod -Method Delete -Uri "$memoryBase/history/s1"
$memoryInputs = @(
  '我们想做一个需求分析助手，希望它能记住多轮对话',
  '需求单号是 REQ-2026-001',
  '帮我判断这个需求是否完整'
)
foreach ($memoryInput in $memoryInputs) {
  $memoryBody = @{ sessionId = 's1'; input = $memoryInput } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri "$memoryBase/chat" `
    -ContentType 'application/json; charset=utf-8' `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($memoryBody))
}
Invoke-RestMethod -Uri "$memoryBase/history/s1"
```

第三轮应依据已知业务目标和需求单号判断完整性，指出仍缺失的信息（如功能范围、异常处理、验收标准）并提出补充问题。三轮成功后历史包含六条消息。

自动测试：在 `services/chat` 执行 `bun run test src/llm/memory/memory.spec.ts`。测试使用本地 OpenAI 兼容服务器，验证实际发送的多轮上下文、session 隔离、裁剪、并发顺序、失败处理及 HTTP 契约；不验证真实模型生成内容的质量。
