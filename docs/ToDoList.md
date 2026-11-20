# ToDoList：已知问题与待办

更新日期：2026-11-18（Asia/Shanghai）
分析基线：`origin/main` 806b283，加上分支 `chore/review-fixes` 的改动

本文整理认证、对话、行程流程与面板中仍未解决的问题。依据为代码静态检查与相关测试，未做线上复现。验收标准是待完成工作的目标，不代表已经验证。

优先级：P1 为对话可靠性与产品闭环；P2 为维护性与体验；P3 为规模扩大或需求明确后再实施的能力。

## 已解决

上一版（2026-10-04，基线 `35e1c4b`）的条目中，以下已由后续改动解决，编号保留以便对照：

- **TODO-01 实验接口越权**：LangChain 演示接口（`/requirement/extract`、`/api/langchain/*`、`/api/memory`、`/api/files`、`/api/embedding`、`/api/agents`、`/api/advanced`）默认不再注册，只有设置 `LLM_DEMO_ROUTES=1` 才挂载，生产环境开启该变量会拒绝启动。
- **TODO-02 发送幂等**、**TODO-03 同会话并发**：每次发送带上 `revision`，服务端在事务里认领该 revision（`services/chat/src/trip/turn.ts`）。重复提交、断线重试和多标签页并发都只有一个请求认领成功，其余返回 409；认领存在数据库里，多实例同样生效。
- **TODO-07 模型上下文**：`TurnService` 为每个会话维护 `ContextManager`，超出预算时压缩；出行条件保存在行程状态里，每轮都随状态传给模型，不依赖历史条数。
- **TODO-08 JSON 响应校验**：`api(path, schema, init)` 在 API 边界按 contracts 的 Schema 解析响应，不符合契约时抛 `INTERNAL_ERROR` 并保留 status。
- **TODO-10 需求抽取**：旧的需求分析发送路径（`ChatService`）已删除，消息只走行程流程。

## P1：对话可靠性与旅行产品闭环

### [ ] TODO-05 进程崩溃后的生成恢复

- **现状与影响**：停止和失败时，`TurnService.run()` 的 `finally` 会保存已流出的文字并结束认领。进程崩溃时 `finally` 不执行：revision 已加一但行程状态没写入，用户消息没有对应回复，已显示的文字丢失。重新加载后，最后一条助手消息的 revision 落后于当前 revision，它的按钮和表单都变成只读，用户只能输入文字继续。
- **建议**：定义失联认领的判定（如认领时间加超时），在下次读取状态时把它收敛为一条 `error` 助手消息并重新渲染当前组件；视需要为流出的文字保存检查点。
- **验收**：模拟进程在流式输出中终止并重启后，会话收敛到明确状态，当前步骤的组件可以操作，界面不会永久等待。
- **代码**：`services/chat/src/trip/turn.ts`、`services/chat/prisma/schema.prisma`。

### [ ] TODO-06 「保存行程」的含义

- **现状与影响**：行程面板已改为读取服务端行程状态，预订链接来自酒店结果。「保存行程」按钮仍只弹出“即将上线”提示；行程状态本来就随会话自动保存，按钮的用途对用户不明确。
- **建议**：先确定保存的含义（例如跨会话的行程列表、导出或分享），再设计接口；若短期没有计划，移除按钮。
- **验收**：按钮要么完成明确的动作并能在重新登录后找回结果，要么不再出现。
- **代码**：`clients/chat-web/features/panels/TripPanels.tsx`（`SaveTripButton`）、`clients/chat-web/features/chat/ChatScreen.tsx`。

## P2：接口一致性、体验与维护性

### [ ] TODO-04 本地消息与服务端消息的对应关系

- **现状与影响**：流式事件已直接返回落库后的用户消息（`start`）和助手消息（`done` / `error`）。但流进行中历史被重新拉取时，`useMessages` 仍按“下一条用户消息之前是否紧挨一条助手消息”判断本地临时消息是否已落库，并为此每秒轮询；数据库里助手消息也没有指向其用户消息的字段，只靠创建时间排序。
- **建议**：给助手消息记录它回复的用户消息 ID（或用 revision 关联），前端按 ID 替换临时消息，去掉按相邻位置的推断。
- **验收**：并发、重试和停止后再刷新，临时消息的替换不依赖消息相邻关系，并有对应测试。
- **代码**：`clients/chat-web/features/conversations/queries.ts`（`useMessages`）、`services/chat/prisma/schema.prisma`、`services/chat/src/trip/turn.ts`。

### [ ] TODO-09 区分认证刷新失败与临时网络故障

- **现状与影响**：`runRefresh()` 的任何失败都会把状态置为 guest，网络异常也一样。短暂断网或后端临时不可用会表现为退出登录。
- **建议**：区分凭证失效、Token 重用、网络故障和服务端临时故障；明确可恢复状态与重试策略，保持账号切换和登出优先于迟到请求的现有保证。
- **验收**：凭证失效或重用时正确退出；临时网络故障得到可恢复的反馈；重试不能覆盖用户主动登出或切换账号。
- **代码**：`clients/chat-web/features/auth/refresh.ts`、`clients/chat-web/features/auth/auth-store.ts`。

### [ ] TODO-11 拆分聊天流与缓存协调逻辑

- **现状与影响**：`ChatScreen.tsx`（约 400 行）同时负责创建会话、发送、错误反馈与视图协调；`use-chat-stream.ts`（约 290 行）同时处理读流、事件、认证变化、中止和缓存写入。新增恢复类功能时维护成本会继续增长。
- **建议**：按职责提取事件状态转换与缓存协调；保留现有 Hook 的入口，不按文件长度机械拆分。
- **验收**：拆分前后行为一致，继续覆盖停止、切换会话、切换账号、迟到分页和临时消息对齐。
- **代码**：`clients/chat-web/features/chat/use-chat-stream.ts`、`clients/chat-web/features/chat/ChatScreen.tsx`。

### [ ] TODO-12 加固长连接传输

- **现状与影响**：`ChatController.send()` 写 SSE 时没有心跳，也不等待 `res.write()` 的背压。模型调用工具时可能长时间没有输出，代理可能因空闲超时断开连接。
- **建议**：结合实际部署链路定义心跳、超时、背压及代理缓冲策略，保持连接关闭时取消模型调用的现有行为。
- **验收**：长时间无文本输出和慢客户端场景下，连接按规则保持或结束；在实际代理配置下验证流式输出。
- **代码**：`services/chat/src/chat/chat.controller.ts`。

## P3：按需求推进的能力与架构决策

### [ ] TODO-13 评估流断线后的续读能力

- **触发条件**：产品要求断线后继续同一次生成，而非停止后重新查询。
- **现状**：没有事件 ID、事件重放或续读接口；断线即中止本轮，已流出的文字作为 `partial` 保存。
- **建议**：基于生成 ID 定义事件序号、保留时间和续读协议；明确“主动停止”与“暂时掉线”是否采用不同规则。
- **依赖**：TODO-04、TODO-05。

### [ ] TODO-14 多实例部署

- **触发条件**：后端从单实例扩展到多实例。
- **现状**：限流计数在实例内存中（`ThrottlerModule.forRoot` 默认存储）。`TurnService` 也把每个会话的模型上下文缓存在实例内存（`contexts`），同一会话的轮次落在不同实例时，某个实例缓存的上下文会缺少其他实例处理的轮次。revision 认领在数据库里，不受影响。
- **建议**：限流改用共享存储；模型上下文改为每轮从数据库重建或按 revision 校验缓存。
- **验收**：同一用户跨实例请求遵守统一额度；同一会话在实例间交替处理时，模型看到的历史与重新加载一致。
- **代码**：`services/chat/src/app.module.ts`、`services/chat/src/auth/app-throttler.guard.ts`、`services/chat/src/trip/turn.ts`。

### [ ] TODO-15 明确 Access Token 撤销时效

- **触发条件**：产品需要退出登录、禁用用户或撤销会话后立即阻止已签发的 Access Token。
- **现状**：`JwtAuthGuard` 只验签名与过期时间；退出会吊销刷新链，但已签发的 Access Token 在过期前（默认 15 分钟）仍然有效。
- **建议**：明确是否接受短有效期策略；若要求立即撤销，再评估会话版本或撤销记录及其查询成本。
- **代码**：`services/chat/src/auth/jwt-auth.guard.ts`、`services/chat/src/auth/access-token.service.ts`、`services/chat/src/config/auth.config.ts`。

### [ ] TODO-16 私有页面的认证恢复体验

- **触发条件**：启动加载时间或私有页面首屏体验成为实际问题。
- **现状**：前端启动后先刷新认证，`AuthGate` 在登录态恢复前显示加载界面；浏览器直接调用后端，没有 BFF。
- **建议**：先测量认证恢复与首屏耗时，优先优化现有路径；收益明确时再评估同源代理或服务端会话。
- **代码**：`clients/chat-web/app/providers.tsx`、`clients/chat-web/features/auth/AuthGate.tsx`。

### [ ] TODO-17 Langfuse 追踪脱敏

- **触发条件**：正式环境开启 Langfuse 追踪（在 `services/chat/.env` 配置 `LANGFUSE_*`），或追踪数据需要给团队以外的人查看。
- **现状**：开启后每轮对话的用户消息、模型输入输出和工具返回会原文发送到 Langfuse 云端（美国区），没有脱敏。用户标识是内部用户 ID，不含邮箱。目前密钥只在 `.env.eval`，正式服务不发送。
- **建议**：先确定需要遮蔽的内容（姓名、联系方式、证件号等），再用 `LangfuseSpanProcessor` 的 `mask` 选项在导出前统一处理。
- **验收**：含上述信息的消息在 Langfuse 的追踪输入输出里已被遮蔽；模型实际收到的内容不变。
- **代码**：`services/chat/src/observability/langfuse.ts`、`services/chat/src/chat/chat.controller.ts`。

## 建议推进顺序

1. TODO-05、TODO-06：补齐崩溃恢复，确定「保存行程」的去留。
2. TODO-04、TODO-09、TODO-12：消息对应关系、认证故障区分和长连接。
3. TODO-11 在 TODO-04 之后做，避免先拆后改。
4. TODO-13～17 在需求或测量结果支持时再实施。
