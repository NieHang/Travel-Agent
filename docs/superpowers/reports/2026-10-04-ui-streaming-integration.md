# UI 协议接入聊天：交付与验证

实际 `/chat` 页面已接入统一 SSE 协议、组件动作和持久化行程快照。文字由真实模型增量输出，JSON 路由/日程静默收集，组件在完整校验并保存成功后整批发布。右侧及移动端行程面板使用同一会话快照，刷新恢复独立于历史消息分页。

## 实现决策

- 旅游编排复用 UIFlowService 状态机，新增轻量 UIStreamService、UIChatService。原有五个软件需求分析 Agent 保持原职责，未为旅游链路新增五阶段模型调用。
- 共用 `@autix/contracts` 的 UI、动作、行程和流式消息 schema；UI 状态机内部快照私有，公共消息仅包含 components、interactionState、trip。
- 现有 checkout 中使用 `codex/ui-streaming-integration` 功能分支，按用户要求在当前会话连续实施；不额外创建工作树。
- 流式消息单独存于 Zustand，完成消息存于 React Query，避免逐 token 改写历史消息数组；组件动作携带来源消息和版本。来源、阶段、选项及表单校验在 SSE 和用户消息落库前完成。
- `GET /api/conversations/:id/ui-state` 提供独立的最新持久化快照，失败或中止的消息不覆盖最近成功状态。旧组件禁用，生成中的组件不可操作。
- actual ChatScreen 移除 mock 行程回退；旧 JSON AIChatContainer 和样例面板仅保留为兼容示例/测试。Markdown 正文使用 react-markdown/remark-gfm；重复 text 和 itinerary card 正文在展示时去重，卡片标题及来源仍保留。
- done/error 立即释放内部 SSE 连接，不等待服务端 EOF；用户取消与正常连接清理分别处理。账户/会话切换忽略旧流并清理本次状态。
- 进度基于服务端实际执行阶段，运行中最高 99%，done 后 100%；完成时紫色从右下向左上填充 350ms，对号弹出，随后收起。失败和取消不显示成功动画，减少动态效果设置受尊重。
- 规划通常有静默意图路由、结构化日程、流式文字调用；已有信息充分时跳过重复询问。选择、表单及确认的确定性阶段不调用模型；酒店等独立查询保留规划草稿。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| 后端 `bun run test` | 38 文件、336 项通过 |
| 数据库 `bun run test:int` | 10 文件、104 项通过 |
| 前端 `bun run test` | 47 文件、358 项通过 |
| 前后端 `bun run typecheck` | 通过 |
| 后端 Nest 构建 | `node node_modules/@nestjs/cli/bin/nest.js build` 通过 |
| 新增桌面/移动端 Playwright 流程 | 2 项通过 |
| 完整 Playwright（无障碍、语言、登录恢复、历史管理、移动面板及 UI 流） | 9 项通过，44.3s |
| 后端 `bun run lint` | 无警告通过 |
| 真实模型多轮 smoke | 选择 → 表单 → 3 天草稿通过；751 块、1066 字符，首块 13406ms，生成轮总计 19071ms |

真实模型验证使用 `bun --env-file=.env scripts/test-ui-streaming-live.ts`，不使用 LLM_FAKE；不输出密钥。首次脚本硬编码表单字段遭校验拒绝，改为根据真实返回的 form.fields 构建提交后通过，业务校验未放宽。

浏览器测试通过真实 HTTP、登录和数据库完成规划 → 选择 → 表单 → 流式草稿 → 面板 → 刷新恢复 → 确认；移动端测试验证共享快照。测试服务使用非生产 LLM_FAKE 的确定性模型 fixture，不把它当作真实模型证据。

Windows 默认 Playwright webServer 的退出等待曾挂起。保留 `playwright.ui.config.ts` 供已运行的测试服务验证，完整退出命令：`bun run test:e2e --config playwright.ui.config.ts`。服务分别在 4101/3102 使用 `.env.test`、`LLM_FAKE=1`、相应 API/CORS 配置启动；本次创建的服务在验证完成后关闭。开发服务 4001/3002 不被修改。

旧落地页旅程测试改为验证规划 selection，旧移动端酒店示例改为验证无会话数据的空态。完整浏览器套件先复现旧 mock 断言失败，更新断言后 9/9 通过，没有为通过测试恢复 mock 行程。

## 独立审查与处理

按照 requesting-code-review 的最终审查要求，由独立只读 reviewer 审查全部工作树变更。发现均经失败回归复现后修复：

1. 原生 SSE reader 中断必须转换为带 streamOpened 的 NETWORK 错误，才能恢复部分回复并重拉历史；应用回调异常继续原样抛出。
2. 无效组件值必须在保存用户消息前拒绝；HTTP 测试验证 400、JSON 响应且消息条数不增加。
3. 最近成功行程可能落到第 20 条消息之外；新增独立 UI 状态接口，测试验证无需加载更早分页。
4. reviewer 原列为 Minor 的重复行程正文提升为本次应修问题：长行程会重复整篇；展示去重并保留卡片标题/来源。

前端三项 RED → GREEN（33 项通过），后端持久化校验/恢复回归通过；随后完整单元、数据库、类型与新浏览器流程通过。未增加第二轮独立审查。

## 边界与保留项

- 当前生成互斥是单进程 Set；多实例部署需要持久化/分布式锁，本次未扩展部署架构。
- 若断连发生在最终数据库提交期间，刷新以已提交结果为准；断连前未发布的组件不会变成前端可操作状态。
- 酒店、航线、景点是模型生成内容，尚未接入实时库存/报价验证；不把结构化卡片等同于可预订资源。
- 保留设计、计划和执行账本供检查与续作；将紧密关联的改造汇总交付，未按每个小任务重复提交。
