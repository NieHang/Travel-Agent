# Hilda 用户前端

Next.js App Router + HeroUI + Motion，支持中文和英文。登录态通过内存 access token 与 HttpOnly refresh Cookie 恢复；对话接入真实 API，右侧行程、酒店、路线、热点使用双语示例数据。保存和预订当前只展示提示。

## 页面

| 路由 | 内容 |
| --- | --- |
| `/` | 首页、示例提示、开始规划 |
| `/login`、`/register` | 认证、next 跳转、登录后消费暂存提示 |
| `/chat` | 新对话，需登录 |
| `/chat/[id]` | 消息历史、SSE 回复、停止生成、需求卡片、历史抽屉 |

桌面显示聊天与行程双栏；窄屏通过「查看行程」打开底部面板，拖动顶部手柄或点击关闭收起。

## 本地运行

仓库根执行 `bun install`，按 `services/chat/README.md` 配置数据库和认证环境变量，并生成 Prisma 客户端。分别启动后端（4001）和本前端（3002）：

```sh
# services/chat
bun run dev
# clients/chat-web
bun run dev
```

`NEXT_PUBLIC_API_BASE_URL` 默认 `http://localhost:4001`，可在本目录 `.env.local` 中覆盖；这是构建时变量，部署前设置。前端来源必须匹配后端 `CORS_ORIGIN`。

## 验证

在本目录执行：

```sh
bun run test        # Vitest：纯逻辑、组件与 MSW API 场景；不连接数据库
bun run typecheck
bun run build
```

浏览器验收使用独立端口：前端 3102、API 4101，仅 Chromium，单 worker，无重试。测试自动构建并启动后端，使用假模型；覆盖注册、登录恢复、双标签页退出、首页自动发送、消息刷新、重命名/删除、语言、移动端与 axe 严重无障碍检查。每轮唯一邮箱，不清库，注册与登录合计 6 次，低于认证限流。

首次运行前：

```sh
# services/chat：配置 .env.test，DATABASE_URL 必须指向以 _test 结尾的 PostgreSQL 库
bun run db:test:prepare
# clients/chat-web
bunx playwright install chromium
bun run test:e2e
```

`.env.test` 必须包含有效的 `JWT_ACCESS_SECRET`；数据库需要 pgvector。端口 3102/4101 必须空闲。失败 trace 保存在 `test-results`。Windows 运行测试需允许 Playwright 清理其启动的进程树。

## 部署约束

前端与 API **必须同站**：refresh Cookie 使用 `SameSite=Lax`，跨站部署无法可靠恢复登录。同站子域可用，但需要 HTTPS、正确的 `CORS_ORIGIN`、后端 `COOKIE_SECURE=true`，请求携带凭据。不要把 access token 放进 localStorage。

生产运行：构建时设置 `NEXT_PUBLIC_API_BASE_URL`，执行 `bun run build`，再 `bun run start`（3002）。生产后端不得启用 `LLM_FAKE`。
