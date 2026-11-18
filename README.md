# Travel-Agent

Hilda 旅行对话应用（中文 / 英文）：用户在对话里说明出行需求，服务端按固定流程收集条件、生成逐日行程并查询酒店，右侧面板展示行程、酒店、路线与热点。目前只规划日本境内的目的地。服务端掌控流程状态，模型只负责理解和撰写文字。

- [前端运行与测试](clients/chat-web/README.md)
- [后端与数据库配置](services/chat/README.md)
- [行程流程设计](docs/superpowers/specs/2026-10-11-trip-flow-refactor-design.md)、[按天修改行程](docs/superpowers/specs/2026-11-14-scoped-trip-edits-design.md)
- [待办与已知问题](docs/ToDoList.md)
- 协作约定：[AGENTS.md](AGENTS.md)（代码风格与 UI 规则）、[LESSON.md](LESSON.md)（踩过的坑）

首次构建前在仓库根执行 `bun install`，再在 `services/chat` 执行 `bun run db:generate`。仓库根常用命令：

```sh
bun run dev        # 同时启动后端（4001）与前端（3002）
bun run check      # typecheck + lint + knip，与 CI 一致
bun run build
```

两个工作区的单元测试分别在 `services/chat` 与 `clients/chat-web` 下执行 `bun run test`。
