# Travel-Agent

Hilda 旅行对话应用：用户认证、流式对话与历史管理已接入 API；行程、酒店、路线与热点面板展示示例数据。

- [前端运行与测试](clients/chat-web/README.md)
- [后端与数据库配置](services/chat/README.md)
- [前端设计](docs/superpowers/specs/2026-10-03-user-layer-frontend-design.md)
- [前端实现计划](docs/superpowers/plans/2026-10-03-user-layer-frontend.md)

仓库根可执行 `bun run typecheck`、`bun run lint`、`bun run build`。首次构建前安装依赖并在后端执行 `bun run db:generate`。
