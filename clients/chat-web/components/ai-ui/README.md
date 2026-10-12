# AI UI 渲染层

服务端根据行程状态生成全部组件（`services/chat/src/trip/view.ts`），客户端只负责渲染并发送领域命令。

```tsx
import { ComponentRenderer } from '@/components/ai-ui'

<ComponentRenderer component={component} onCommand={(command) => send(command)} disabled={false} />
```

- `component` 是 `unknown`：先用 `@autix/contracts` 的 `ComponentSchema` 校验。四种类型：`choice`（`ChoiceCard`）、`form`（`RequirementsForm`）、`buttons`（`ButtonsRow`）、`cards`（`ResultCard`）。
- 旧协议保存在历史消息里的组件无法通过校验，按文字只读显示，不提供控件。
- 组件直接发送自己的 `command`（如 `{ type: 'set_trip_type', value: 'family' }`），没有组件 ID；请求体为 `{ revision, command, locale }`，`revision` 不一致时服务端返回 409。
- 只有 `metadata.revision` 等于当前 `ui-state` revision 的消息里的组件可操作（见 `features/chat/MessageList.tsx`）。
- `ResultCard` 在聊天和行程面板里共用：`variant` 为 `full`、`compact` 或 `stay`。
- 实际 `/chat` 页面通过 `ChatScreen`、`useChatStream` 和 `features/chat/ui-stream-client.ts` 接入；基础样式集中在 `styles.ts`。
