# AI UI 渲染层

在需要展示 UI Chat 的页面中挂载：

```tsx
import { AIChatContainer } from '@/components/ai-ui'

<AIChatContainer sessionId="my-trip-session" locale="zh" className="h-[70vh]" />
```

- `sessionId` 可选；省略时容器首次请求生成会话 ID，挂载期间复用。修改此属性会清空本地历史并取消当前请求。历史保存在 React 状态中，刷新页面后不恢复。
- `locale` 可选，随文本与 UI 操作请求发送给后端。组件的基础提示文案使用中文，标题、选项和按钮标签使用服务端内容。
- 请求复用 `features/auth/api-client.ts`，包含现有 Bearer token、Cookie 和认证刷新逻辑；API 地址来自 `NEXT_PUBLIC_API_BASE_URL`（通过 `lib/api-base.ts`），默认 `http://localhost:4001`。使用前需完成项目现有登录流程。
- 文本请求体为 `{ sessionId, input, locale? }`，操作请求体为 `{ sessionId, action, locale? }`，响应为 `{ message, intent, components }`。
- 仅最新 AI 响应中的控件可操作；请求期间锁定控件，失败后保留输入与最新控件以便重试。
- 单选点击立即提交，多选勾选后点击“确认选择”。表单支持 input、textarea、date、number、select；数字发送 number，空可选值发送 null。
- `types.ts` 通过 **type-only** 导入复用后端规范，避免维护第二份协议和打包服务端代码。`FormField` 是后端 `UIFormField` 的导出别名。
- `text` 的 plain/markdown 均以 React 文本安全展示，不解析 HTML 或 Markdown。确认组件内嵌于聊天历史，不作为模态窗口打开。

也可单独使用 `ComponentRenderer`：传入 `component: UIResponse`、`onAction: (action: UIAction) => void` 和可选 `disabled`。每个基础组件均可从独立文件或本目录入口导入；基础样式集中在 `styles.ts`，便于替换。
