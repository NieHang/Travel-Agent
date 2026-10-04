# 用户层前端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `clients/chat-web` 里做出 Hilda 的落地页、登录与注册、对话页（流式聊天、历史抽屉、四个静态面板），中英双语，桌面两栏、窄屏可用。

**Architecture:** 纯客户端鉴权：access token 放在一个模块级 store 里，API 客户端统一加头、单飞刷新、只重试一次。服务端状态交给 TanStack Query 的无限查询；流式对话由 `useChatStream` 用 `fetch` 读 SSE 并把结果写回查询缓存。Next 只负责路由、字体和按 Cookie 选词典，所有业务界面都是 Client Component。

**Tech Stack:** Next.js 16.3.6（App Router）、React 19.2、Tailwind 4、HeroUI 3（`@heroui/react` + `@heroui/styles`）、Motion 14（`motion/react`）、TanStack Query 5、next-intl 4、lucide-react；测试用 Vitest 5 + Testing Library + MSW 3、Playwright 1.63 + `@axe-core/playwright`。版本是写计划时 npm 上的最新版，以 `bun add` 实际解析到的为准。

**Spec:** [docs/superpowers/specs/2026-10-03-user-layer-frontend-design.md](../specs/2026-10-03-user-layer-frontend-design.md)（下称「前端 spec」），接口以 [后端 spec](../specs/2026-10-03-user-layer-backend-design.md) 和 `services/chat/README.md` 的「前端接入须知」为准。执行者需同时阅读；本计划只写 spec 没有定下的决定。元素编号（L1、A5、C7、D6、P8…）指前端 spec 里的表格行。

## Global Constraints

### 执行状态（2026-10-04）

任务 1–17 的核心实现和验收已完成。下方保留原始执行清单作为计划记录，当前进度以本段为准。

| 范围 | 当前结果 |
| --- | --- |
| 1–11 基础、认证、查询与 SSE 聊天 | 已实现；补齐账号切换与消息竞态回归 |
| 12 历史抽屉 | 浏览、搜索、防抖、分页、重命名、删除、键盘与焦点恢复 |
| 13 行程面板 | 双语示例数据、五天行程、酒店计价、路线、热点与提示 |
| 14 首页 | 双语首页、提示输入、注册/登录后的单次自动发送 |
| 15 移动端 | 全宽聊天/抽屉、92dvh 底部面板、手柄拖动关闭 |
| 16 端到端 | Chromium 7 个场景；覆盖真实 API 假模型、语言、会话、移动端、严重无障碍检查 |
| 17 收尾 | README、根目录 lint 任务注册、全量测试/类型检查/lint/构建 |

验证：前端 Vitest 338/338、后端 Vitest 204/204；根目录 `typecheck`、`lint`、`build` 通过。五条成功标准分别由 `journey.spec.ts`、`HistoryDrawer.test.tsx`、`session.spec.ts`、`locale.spec.ts`、`mobile.spec.ts` 与桌面截图覆盖。

最终审查的七项重要问题已通过失败回归测试后修复：会话失效缓存、退出后的旧流写入、跨账号重试、迟到语言响应、分页覆盖新消息、停止后的部分回复对齐、暂存输入目标会话。保留一项轻微差异：面板切换尚未添加旧内容淡出。

行程数据、保存与预订仍遵守设计中的示例范围。历史执行步骤的 RED 记录不因本次验收追溯补签。

- 分支 `feat/user-layer-frontend`。每个任务结束时提交一次，提交信息沿用仓库风格（`fea:` / `chore:` / `docs:` 前缀）。
- 除任务 1 外，所有命令在 `clients/chat-web` 目录下执行；装依赖用 `bun add` / `bun add -d`。
- **先读文档再写代码**：用到 Next 的任何约定前，读 `node_modules/next/dist/docs/` 里对应的页面（`clients/chat-web/AGENTS.md` 的要求）。HeroUI 3、Motion 14、MSW 3、next-intl 4、Vitest 5 都比常见示例新，装好后先读包内的 README、`llms.txt` 或类型定义确认导出名与用法。
- 所有请求与响应类型来自 `@autix/contracts`，前端不重复定义；表单校验直接用契约里的 `EmailSchema`、`PasswordSchema`、`NicknameSchema`。
- 界面上出现的每一段文案都走词典（`messages/zh.json`、`en.json`），文案逐字取自前端 spec；组件里不写中英文字面量。
- 弹簧参数只出现在 `lib/motion.ts`；组件引用预设名。
- 色值、字号、圆角、阴影逐字取自前端 spec 第 8 节，只通过 `globals.css` 里的 token 使用。
- 对比度规则：`lime` 与所有舞台色上的文字用 `ink`；白字只出现在 `ink` 底上。
- 所有图标按钮有读屏标签；可点击元素触摸区域不小于 44px。
- 数值常量逐字取自 spec：搜索防抖 300ms；`REFRESH_INVALID` 重试延迟 300ms；回到底部阈值 80px；输入上限 4000，3800 起显示计数；标题上限 60；昵称 1–20；暂存键 `hilda:pendingPrompt`；语言 Cookie `hilda_locale`；暂存内容预览截断 40 字；全程价 = 每晚价 × 5 × 0.88 四舍五入；断点 1024px；入场错开 40ms 最多 8 项；背景色过渡 450ms。
- 不用 `EventSource`；所有请求带 `credentials: 'include'`；只在 `TOKEN_EXPIRED` 时刷新。
- 单元与组件测试命名 `*.test.ts(x)`，与被测文件同目录；端到端测试放 `e2e/*.spec.ts`。组件测试的网络一律用 MSW，不直接桩 `fetch`。

### 运行测试的命令

| 目的 | 命令 |
|---|---|
| 单个测试文件 | `bunx vitest run <文件路径>` |
| 全部单元与组件测试 | `bun run test` |
| 类型检查 | `bun run typecheck` |
| 端到端（含无障碍） | `bun run test:e2e` |

## 与 spec 的六处偏差

写计划时核对仓库与已安装的 Next 文档后发现，需在任务 1 中同步修正前端 spec：

1. **`Retry-After` 读不到**：前端（3002）与后端（4001）跨源，`Retry-After` 不在 CORS 默认可读的响应头里，而 A5、R5、C9 的倒计时都依赖它。后端 `enableCors` 需加 `exposedHeaders: ['Retry-After']`（任务 1）。
2. **对话页的状态放在布局里**：spec 第 5 节把对话页放在 `app/(app)/chat/[[...id]]/`。首条消息发出后要把地址从 `/chat` 换成 `/chat/{id}` 且不能打断正在进行的流。Next 文档说明原生 `window.history.replaceState` 会同步 `usePathname` 而不触发导航，所以：界面与状态放在 `app/(app)/chat/layout.tsx` 渲染的 `ChatScreen` 里，会话 `id` 从 `usePathname()` 解析；`[[...id]]/page.tsx` 只返回 `null`。
3. **`conversationId` 变化即 `stop()` 有一个例外**（spec 6.3）：从「无」变成当前流所属的会话 `id`（即第 2 条的地址替换）不中止。
4. **`guest` 状态带原因**：spec 6.1 的状态只有三个值，但登录页要区分是否因 `REFRESH_REUSED` 被登出。`guest` 增加 `reason: 'reused' | null`。
5. **路径别名**：`tsconfig.json` 里 `@/*` 指向不存在的 `./src/*`，改为 `./*`，与 spec 第 5 节的目录结构（无 `src`）一致。
6. **spec 第 15 节漏掉的依赖**：图标用 `lucide-react`；测试另需 `jsdom`、`@vitejs/plugin-react`、`vite-tsconfig-paths`、`@testing-library/dom`、`@testing-library/user-event`、`@testing-library/jest-dom`。

## Review Focus

spec 隐含、最可能在真实使用中出问题的五类情况，各自的测试已加到负责该代码的任务里：

1. **一个汉字被拆在两个网络块里**：模型回复以中文为主，UTF-8 多字节字符跨块时不能出现乱码或丢字。（任务 10）
2. **流没有收到 `done` 或 `error` 就结束**（断网、服务重启）：按失败处理，已收到的文本标注「生成失败」，不能当成完整回复。（任务 10）
3. **`next` 参数的变体**：`/\evil.com`、`/%2F%2Fevil.com`、`https:/evil.com`、带换行或制表符的值都落到 `/chat`。（任务 5）
4. **`sessionStorage` 或 `BroadcastChannel` 不可用**（隐私模式、被禁用）：落地页提交、登录、登出都不抛错，只是失去暂存与多标签页同步。（任务 6、8、14）
5. **新对话里连按两次回车**：只创建一个会话、只发出一条消息。（任务 11）

## File Structure

```
services/chat/src/config/cors.ts          corsOptions()（任务 1）

clients/chat-web/
  vitest.config.mts、playwright.config.ts
  test/setup.ts                 jest-dom、MSW 生命周期、jsdom 缺失的浏览器 API 桩
  test/server.ts                MSW server 与 apiUrl()
  test/render.tsx               renderWithProviders()
  test/fixtures.ts              makeUser、makeConversation、makeMessage、sseBody
  i18n/request.ts               next-intl 的请求配置（读 Cookie 与 Accept-Language）
  i18n/locale.ts                LOCALE_COOKIE、resolveLocale、writeLocaleCookie
  messages/zh.json、en.json
  lib/motion.ts                 弹簧预设、入场变体
  lib/api-base.ts               API_BASE_URL
  lib/use-countdown.ts          useCountdown
  lib/use-media-query.ts        useIsDesktop
  app/layout.tsx                字体、<html lang>、词典、Providers
  app/providers.tsx             QueryClientProvider、鉴权启动、Toaster
  app/globals.css               token
  app/(public)/page.tsx                     落地页
  app/(auth)/layout.tsx                     已登录跳走；顶部 L1、L2
  app/(auth)/login/page.tsx、register/page.tsx
  app/(app)/layout.tsx                      AuthGate
  app/(app)/chat/layout.tsx                 渲染 ChatScreen
  app/(app)/chat/[[...id]]/page.tsx         返回 null
  components/ui/                PillButton、PillTabs、Chip、InfoCard、FloatingCard、Field、
                                LocaleSwitch、toast、ConfirmDialog、Skeleton、Avatar、Logo、BrandLoader
  features/auth/
    auth-store.ts               状态与 useAuth
    api-client.ts               ApiRequestError、apiFetch、api
    refresh.ts                  refreshSession（单飞）、bootstrapAuth
    session.ts                  login、register、logout、多标签页广播
    safe-next.ts                safeNext
    validation.ts               表单校验
    pending-prompt.ts           暂存的读写与 usePendingPrompt
    use-set-locale.ts           切换语言
    AuthGate.tsx、LoginForm.tsx、RegisterForm.tsx、AuthPanel.tsx
  features/landing/             LandingPage.tsx、PromptForm.tsx、floating-cards.tsx
  features/conversations/
    api.ts                      五个接口
    queries.ts                  查询键、无限查询、乐观的重命名与删除
    HistoryDrawer.tsx、ConversationItem.tsx
  features/chat/
    sse.ts                      createSseParser
    message-cache.ts            向消息缓存追加
    use-chat-stream.ts
    use-stick-to-bottom.ts
    ChatScreen.tsx、TopBar.tsx、UserMenu.tsx、MessageList.tsx、MessageBubble.tsx、
    RequirementCards.tsx、Composer.tsx
  features/panels/
    TripPanels.tsx              P1 对应的容器与 P3 头部
    PlanPanel.tsx、HotelsPanel.tsx、RoutesPanel.tsx、HotspotsPanel.tsx
    MobileSheet.tsx
    pricing.ts                  fullStayPrice
    mock/types.ts、zh.ts、en.ts、index.ts
  e2e/                          journey.spec.ts、session.spec.ts、locale.spec.ts、a11y.spec.ts、helpers.ts
```

---

### Task 1: 后端放开 `Retry-After`，修正 spec

**Files:**
- Create: `services/chat/src/config/cors.ts`、`services/chat/src/config/cors.spec.ts`
- Modify: `services/chat/src/main.ts`（`enableCors` 的参数换成 `corsOptions()`）
- Modify: `docs/superpowers/specs/2026-10-03-user-layer-frontend-design.md`（上面六处偏差）、`services/chat/README.md`（「前端接入须知」加一句：429 的 `Retry-After` 已对前端可读）

**Interfaces:**
- Produces: `corsOptions(env?: NodeJS.ProcessEnv): CorsOptions`（类型取自 `@nestjs/common/interfaces/external/cors-options.interface.js`）

- [ ] **Step 1: 建分支并写失败的测试** `services/chat/src/config/cors.spec.ts`

```bash
git checkout -b feat/user-layer-frontend
```

```ts
import { corsOptions } from './cors.js';

describe('corsOptions', () => {
  it('默认来源、带凭据、放开 Retry-After', () => {
    expect(corsOptions({})).toEqual({
      origin: 'http://localhost:3002',
      credentials: true,
      exposedHeaders: ['Retry-After'],
    });
  });
  it('来源取自 CORS_ORIGIN', () => {
    expect(corsOptions({ CORS_ORIGIN: 'https://hilda.example' }).origin).toBe('https://hilda.example');
  });
});
```

- [ ] **Step 2: 运行，确认失败**（在 `services/chat` 下）`bunx vitest run src/config/cors.spec.ts` → FAIL，找不到 `./cors.js`
- [ ] **Step 3: 实现 `corsOptions`，`main.ts` 改为 `app.enableCors(corsOptions())`**
- [ ] **Step 4: 运行** `bunx vitest run src/config/cors.spec.ts && bun run typecheck && bun run lint` → 全部通过
- [ ] **Step 5: 按「六处偏差」逐条修改前端 spec**（第 3、5、6.1、6.3、15 节各加一两句），更新后端 README
- [ ] **Step 6: 提交** `git commit -m "fea: expose Retry-After to the browser and align the frontend spec"`

---

### Task 2: 工程脚手架与测试设施

**Files:**
- Modify: `package.json`（依赖与脚本）、`tsconfig.json`（`paths` 改为 `"@/*": ["./*"]`；`e2e/` 与测试文件不排除，一并做类型检查）、`.gitignore`（加 `/test-results`、`/playwright-report`）
- Create: `vitest.config.mts`、`test/setup.ts`、`test/server.ts`、`test/render.tsx`、`test/fixtures.ts`、`lib/api-base.ts`、`lib/api-base.test.ts`
- Delete: `public/` 下五个模板 SVG

**Interfaces:**
- Produces:
  - `lib/api-base.ts`：`API_BASE_URL: string`（`NEXT_PUBLIC_API_BASE_URL` 去掉末尾 `/`，缺省 `http://localhost:4001`）
  - `test/server.ts`：`server`（MSW `setupServer()`）、`apiUrl(path: string): string`（= `API_BASE_URL + path`）
  - `test/render.tsx`：`renderWithProviders(ui, opts?: { locale?: 'zh' | 'en'; queryClient?: QueryClient }): RenderResult & { queryClient: QueryClient; user: UserEvent }`。任务 4 之前先不包词典 Provider，任务 4 补上。测试用的 `QueryClient` 关闭重试（`retry: false`）。
  - `test/fixtures.ts`：`makeUser(over?)`、`makeConversation(over?)`、`makeMessage(over?)`（返回契约类型，时间为合法 ISO 字符串）；`sseBody(events: ChatStreamEvent[], opts?: { chunkBytes?: number; close?: boolean }): ReadableStream<Uint8Array>`，按后端格式 `event: <名>\ndata: <JSON>\n\n` 编码，`chunkBytes` 给定时按该字节数切块（用于跨块测试），`close: false` 时不关闭流（用于中止测试）。

- [ ] **Step 1: 装依赖**

```bash
bun add @heroui/react @heroui/styles motion @tanstack/react-query next-intl lucide-react
```

```bash
bun add -d vitest vite @vitejs/plugin-react vite-tsconfig-paths jsdom @testing-library/react @testing-library/dom @testing-library/user-event @testing-library/jest-dom msw @playwright/test @axe-core/playwright
```

`@heroui/react` 若报缺少 React Aria 的 peer 依赖，按提示补装。装完后读各包文档（见 Global Constraints）。

- [ ] **Step 2: 写失败的测试** `lib/api-base.test.ts`

```ts
import { http, HttpResponse } from 'msw'
import { API_BASE_URL } from './api-base'
import { server, apiUrl } from '@/test/server'

it('API_BASE_URL 没有末尾斜杠', () => expect(API_BASE_URL).toBe('http://localhost:4001'))

it('MSW 拦截得到发往后端的请求', async () => {
  server.use(http.get(apiUrl('/health'), () => HttpResponse.json({ ok: true })))
  const res = await fetch(apiUrl('/health'))
  expect(await res.json()).toEqual({ ok: true })
})

it('未声明的请求让测试失败', async () => {
  await expect(fetch(apiUrl('/nope'))).rejects.toThrow()
})
```

（MSW 3 的导入路径以已安装版本为准，README 示例是 `msw/http`。）

- [ ] **Step 3: 运行，确认失败** `bunx vitest run lib/api-base.test.ts` → FAIL
- [ ] **Step 4: 写配置与辅助文件**
  - `vitest.config.mts`：按 Next 文档 `02-guides/testing/vitest.md`，插件 `tsconfigPaths()` + `react()`；`environment: 'jsdom'`、`globals: true`、`setupFiles: ['./test/setup.ts']`、`include: ['**/*.test.{ts,tsx}']`、`exclude` 含 `e2e/**`、`.next/**`、`node_modules/**`。
  - `test/setup.ts`：引入 `@testing-library/jest-dom/vitest`；`beforeAll(server.listen({ onUnhandledRequest: 'error' }))`、`afterEach(server.resetHandlers + cleanup + sessionStorage.clear())`、`afterAll(server.close)`；为 jsdom 补 `matchMedia`、`IntersectionObserver`、`ResizeObserver`、`Element.prototype.scrollTo` 的空实现。
  - `package.json` 脚本：`"test": "vitest run"`、`"test:watch": "vitest"`、`"test:e2e": "playwright test"`。
- [ ] **Step 5: 运行** `bun run test && bun run typecheck` → 通过
- [ ] **Step 6: 提交** `git commit -m "chore: frontend dependencies and test tooling"`

---

### Task 3: 视觉 token、字体、弹簧预设

**Files:**
- Modify: `app/globals.css`、`app/layout.tsx`
- Create: `lib/motion.ts`、`lib/motion.test.ts`、`lib/use-media-query.ts`

**Interfaces:**
- Produces:
  - `globals.css`：`@import "tailwindcss"` 与 `@import "@heroui/styles"`（顺序与写法以已安装的 `@heroui/styles` README 为准）；`@theme` 里定义颜色 `ink`、`lime`、`paper`、`stage-yellow`、`stage-orange`、`stage-purple`、`stage-green`、`stage-pink`、`danger`（生成 `bg-ink`、`text-ink`、`bg-stage-yellow` 等工具类），圆角 `--radius-card: 20px`、`--radius-panel: 40px`，阴影 `--shadow-float: 0 12px 32px rgba(27, 21, 53, 0.18)`，字体 `--font-sans`（Plus Jakarta Sans 在前，Noto Sans SC 在后）。删除模板里的深色模式媒体查询。全局 `:focus-visible` 为 2px 描边、外扩 2px、颜色 `ink`；带 `data-on-ink` 的容器内为 `lime`。`html:lang(zh)` 标题字距 `-0.02em`，其余 `-0.04em`。
  - `app/layout.tsx`：`next/font/google` 的 `Plus_Jakarta_Sans`（500、700、800）与 `Noto_Sans_SC`（500、700、900），以 CSS 变量挂到 `<html>`；`metadata.title = 'Hilda'`。
  - `lib/motion.ts`：

    ```ts
    export const springs = {
      snappy: { type: 'spring', stiffness: 500, damping: 30 },
      smooth: { type: 'spring', stiffness: 380, damping: 32 },
      drawer: { type: 'spring', stiffness: 300, damping: 34 },
      gentle: { type: 'spring', stiffness: 120, damping: 18 },
    } as const
    export const STAGGER_MS = 40
    export const STAGGER_MAX = 8
    export const BG_TRANSITION = 'background-color 450ms ease-out'
    /** 入场：上移 12px + 淡入；reduced 为 true 时只淡入。index 用于错开。 */
    export function enter(index?: number, reduced?: boolean): { initial: object; animate: object; transition: object }
    export function staggerDelay(index: number): number // 秒；min(index, STAGGER_MAX) * 0.04
    ```

  - `lib/use-media-query.ts`：`useIsDesktop(): boolean`（`min-width: 1024px`，服务端与首帧返回 `true`）。
  - 所有组件用 Motion 的 `useReducedMotion()` 取 `reduced`；悬停 1.03、按压 0.96 在 `reduced` 时不加。

- [ ] **Step 1: 写失败的测试** `lib/motion.test.ts`

```ts
import { springs, enter, staggerDelay } from './motion'

it('四个预设的参数与 spec 8.4 一致', () => {
  expect(springs.snappy).toMatchObject({ stiffness: 500, damping: 30 })
  expect(springs.smooth).toMatchObject({ stiffness: 380, damping: 32 })
  expect(springs.drawer).toMatchObject({ stiffness: 300, damping: 34 })
  expect(springs.gentle).toMatchObject({ stiffness: 120, damping: 18 })
})
it('错开 40ms，最多 8 项', () => {
  expect(staggerDelay(3)).toBeCloseTo(0.12)
  expect(staggerDelay(20)).toBeCloseTo(0.32)
})
it('入场上移 12px 并淡入', () => {
  expect(enter().initial).toEqual({ opacity: 0, y: 12 })
  expect(enter().animate).toEqual({ opacity: 1, y: 0 })
})
it('减少动态效果时没有位移', () => {
  expect(enter(0, true).initial).toEqual({ opacity: 0 })
  expect(enter(0, true).animate).toEqual({ opacity: 1 })
})
```

- [ ] **Step 2: 运行，确认失败** → FAIL
- [ ] **Step 3: 实现 `lib/motion.ts`、`lib/use-media-query.ts`，改 `globals.css` 与 `layout.tsx`**
- [ ] **Step 4: 运行** `bunx vitest run lib/motion.test.ts && bun run typecheck && bun run build` → 通过（`build` 用来确认字体与 HeroUI 样式接得上）
- [ ] **Step 5: 提交** `git commit -m "fea: design tokens, fonts and spring presets"`

---

### Task 4: 双语

**Files:**
- Create: `i18n/request.ts`、`i18n/locale.ts`、`i18n/locale.test.ts`、`messages/zh.json`、`messages/en.json`、`messages/messages.test.ts`
- Modify: `next.config.ts`（套上 next-intl 的插件）、`app/layout.tsx`（`<html lang>`、`NextIntlClientProvider`）、`test/render.tsx`（包上词典 Provider，默认 `zh`）

**Interfaces:**
- Produces:
  - `i18n/locale.ts`：`LOCALE_COOKIE = 'hilda_locale'`；`resolveLocale(cookie: string | undefined, acceptLanguage: string | null): Locale`；`writeLocaleCookie(locale: Locale): void`（`path=/; max-age=31536000; samesite=lax`）。
  - `i18n/request.ts`：next-intl 「不带 i18n 路由」的接法，用 `resolveLocale(cookies(), headers())` 定语言并加载对应词典。
  - 词典命名空间与键（值逐字取自前端 spec 对应编号；`{n}`、`{nickname}`、`{prompt}`、`{hotel}`、`{count}` 用 ICU 占位）：
    - `common`：`brand`、`localeZh`（中）、`localeEn`（EN）、`cancel`、`close`、`retry`、`loadFailed`（D9）、`sample`（示例）
    - `errors`：`generic`（7 节通用文案）、`network`（10.3 网络异常）、`INVALID_CREDENTIALS`、`EMAIL_TAKEN`、`RATE_LIMITED`（含 `{n}`）、`sessionEnded`（6.1）
    - `landing`：`signIn`、`openChat`（L3）、`badge`（L4）、`title`（L5）、`subtitle`（L6）、`placeholder`（L7）、`submit`（L8）、`chips.0`…`chips.3`（L9）
    - `auth`：`loginTitle`、`registerTitle`、`email`、`password`、`nickname`、`showPassword`、`hidePassword`、`loginSubmit`、`registerSubmit`、`toRegister`、`toLogin`、`goLogin`（去登录）、`ruleLength`、`ruleMixed`、`invalidEmail`、`required`、`nicknameTooLong`、`pendingHint`（含 `{prompt}`）
    - `chat`：`history`（T1）、`accountMenu`、`signOut`、`assistantName`、`online`、`typing`（C1）、`stopped`、`failed`（C3）、`jumpToLatest`（C5）、`chips.0`…`chips.3`（C6）、`placeholder`（C7）、`send`、`stop`（C8）、`rateLimited`（C9，含 `{n}`）、`greeting`（含 `{nickname}`）、`notFound`、`startNew`、`sendFailed`（11.3）、`viewTrip`（13 节）
    - `drawer`：`newChat`、`search`、`clear`、`noMatch`、`empty`、`more`、`rename`、`delete`、`renameFailed`、`deleteFailed`、`confirmTitle`、`confirmBody`
    - `panels`：`tabs.plan|hotels|routes|hotspots`（P1）、`saveTrip`、`saveTripSoon`（P2）、`kicker.plan|hotels|routes|hotspots`（P3 小标题）、`day`（含 `{n}`）、`stops`（含 `{count}`）、`perNight`、`fullStay`、`book`（含 `{hotel}`）、`bookSoon`、`walk`、`tram`、`mapAlt`（P10 的文字说明）、`filters.all|food|views|nightlife|hidden`、`add`、`added`、`emptyFilter`
  - 约定：后端错误 `code` 映射为 `errors.<code>`，词典里没有该键时用 `errors.generic`。

- [ ] **Step 1: 写失败的测试**

`i18n/locale.test.ts`：

```ts
import { resolveLocale } from './locale'

it.each([
  ['en', 'zh-CN,zh;q=0.9', 'en'],        // Cookie 优先
  ['zh', 'en-US', 'zh'],
  [undefined, 'en-US,en;q=0.9', 'en'],
  [undefined, 'zh-TW,zh;q=0.9,en;q=0.8', 'zh'],
  [undefined, 'fr-FR,en;q=0.5', 'en'],   // 按列表顺序取第一个认识的
  [undefined, 'fr-FR', 'zh'],            // 无法判断用中文
  [undefined, null, 'zh'],
  ['de', 'en-US', 'en'],                 // 非法 Cookie 当作没有
])('cookie=%s accept=%s → %s', (cookie, accept, expected) => {
  expect(resolveLocale(cookie, accept)).toBe(expected)
})
```

`messages/messages.test.ts`：

```ts
import zh from './zh.json'
import en from './en.json'

const keys = (o: object, p = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]))
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort()

it('zh 与 en 的键完全一致', () => expect(keys(zh).sort()).toEqual(keys(en).sort()))
it('没有空文案', () => {
  for (const dict of [zh, en]) for (const k of keys(dict)) expect(k.split('.').reduce((o: any, p) => o[p], dict)).not.toBe('')
})
it('同一个键的占位符一致', () => {
  for (const k of keys(zh)) {
    const get = (d: object) => k.split('.').reduce((o: any, p) => o[p], d) as string
    expect(placeholders(get(en))).toEqual(placeholders(get(zh)))
  }
})
it('抽查文案', () => {
  expect(zh.landing.title).toBe('下一站，去哪？')
  expect(en.landing.title).toBe('Where to next?')
  expect(en.errors.RATE_LIMITED).toBe('Too many attempts. Try again in {n}s')
})
```

- [ ] **Step 2: 运行，确认失败** → FAIL
- [ ] **Step 3: 实现**：写两份词典与 `i18n/locale.ts`；按已安装 next-intl 的文档接 `i18n/request.ts` 与 `next.config.ts`；根布局用 `getLocale()`、`getMessages()`。
- [ ] **Step 4: 运行** `bun run test && bun run typecheck && bun run build` → 通过
- [ ] **Step 5: 提交** `git commit -m "fea: zh and en dictionaries with cookie-based locale"`

---

### Task 5: 鉴权核心

**Files:**
- Create: `features/auth/auth-store.ts`、`api-client.ts`、`refresh.ts`、`safe-next.ts`，及各自的 `*.test.ts`

**Interfaces:**
- Produces:

  ```ts
  // auth-store.ts
  export type AuthState =
    | { status: 'loading' }
    | { status: 'authed'; accessToken: string; user: User }
    | { status: 'guest'; reason: 'reused' | null }
  export const authStore: {
    getState(): AuthState
    subscribe(listener: () => void): () => void
    setAuthed(result: AuthResult): void
    setUser(user: User): void          // 仅在 authed 时生效
    setGuest(reason?: 'reused' | null): void
    reset(): void                       // 回到 loading，测试用
  }
  export function useAuth(): AuthState  // useSyncExternalStore；服务端快照为 loading

  // api-client.ts
  export class ApiRequestError extends Error {
    constructor(
      readonly code: ErrorCode | 'NETWORK' | 'ABORTED',
      readonly status: number,          // NETWORK、ABORTED 为 0
      readonly details?: unknown,
      readonly retryAfter?: number,     // 秒，仅 RATE_LIMITED
    )
  }
  /** 成功返回原始 Response（供 SSE 读流）；非 2xx 抛 ApiRequestError。 */
  export function apiFetch(path: string, init?: RequestInit): Promise<Response>
  /** JSON 便捷封装；204 返回 undefined。body 传对象时自动序列化并加 Content-Type。 */
  export function api<T>(path: string, init?: Omit<RequestInit, 'body'> & { body?: unknown }): Promise<T>

  // refresh.ts
  export const REFRESH_RETRY_DELAY_MS = 300
  /** 单飞。成功置为 authed 并返回 true；失败置为 guest 并返回 false；不抛错。 */
  export function refreshSession(): Promise<boolean>
  export function bootstrapAuth(): Promise<void>   // 幂等，整个页面生命周期只真正刷新一次

  // safe-next.ts
  export function safeNext(raw: string | null | undefined): string
  ```

- 行为规定：
  - `apiFetch`：有 token 就加 `Authorization: Bearer`；一律 `credentials: 'include'`。响应为 `TOKEN_EXPIRED` 时调 `refreshSession()`，成功则用新 token 把原请求重发**一次**，第二次的任何错误原样抛出；刷新失败抛原来的 `TOKEN_EXPIRED`。其他 401 不刷新。
  - 错误体解析不了或 `code` 不在契约里：`code` 记为 `INTERNAL_ERROR`。`fetch` 自身抛错：`AbortError` → `ABORTED`，其余 → `NETWORK`。
  - `RATE_LIMITED` 的 `retryAfter` 取 `Retry-After` 头；缺失或不是正整数时取 `60`（后端窗口为一分钟）。
  - `refreshSession`：`REFRESH_INVALID` → 等 300ms 再试一次，仍失败置 `guest`（`reason: null`）；`REFRESH_REUSED` → 立即置 `guest`（`reason: 'reused'`）；网络错误或其他错误 → 置 `guest`（`reason: null`）。刷新请求自身不走 `apiFetch`。
  - `safeNext`：只接受以单个 `/` 开头、第二个字符不是 `/` 或 `\`、不含反斜杠与控制字符（含 `\t`、`\n`、`\r`）、先 `decodeURIComponent` 一次后仍满足以上条件的值；解码抛错或不满足时返回 `/chat`。返回原始（未解码）值。

- [ ] **Step 1: 写失败的测试**

`safe-next.test.ts`：

```ts
import { safeNext } from './safe-next'

it.each(['/chat', '/chat/abc123', '/chat?x=1', '/'])('接受站内路径 %s', (v) => expect(safeNext(v)).toBe(v))
it.each([
  null, undefined, '', 'chat', '//evil.com', 'https://evil.com', 'https:/evil.com', 'javascript:alert(1)',
  '/\\evil.com', '/%2F%2Fevil.com', '/%5Cevil.com', '/\tevil', '/a\nb', '/%E0%A4%A',
])('拒绝 %s', (v) => expect(safeNext(v)).toBe('/chat'))
```

`api-client.test.ts`（每个用例开头 `authStore.setAuthed({ accessToken: 'old', user: makeUser() })`；`expired = HttpResponse.json({ code: 'TOKEN_EXPIRED', message: '' }, { status: 401 })`）：

```ts
it('带上 Authorization 与凭据', /* 处理器里断言 request.headers.get('authorization') === 'Bearer old'、request.credentials === 'include' */)

it('TOKEN_EXPIRED：刷新后用新 token 重试一次并成功', async () => {
  // /api/things：Bearer old → expired；Bearer new → { ok: true }
  // /api/auth/refresh → { accessToken: 'new', user }
  await expect(api('/api/things')).resolves.toEqual({ ok: true })
  expect(refreshCalls).toBe(1)
  expect(authStore.getState()).toMatchObject({ status: 'authed', accessToken: 'new' })
})

it('并发的三个 TOKEN_EXPIRED 只触发一次刷新', async () => {
  await Promise.all([api('/api/things'), api('/api/things'), api('/api/things')])
  expect(refreshCalls).toBe(1)
})

it('重试后仍是 TOKEN_EXPIRED：不再刷新，抛出', async () => {
  // /api/things 永远返回 expired
  await expect(api('/api/things')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' })
  expect(thingCalls).toBe(2)
  expect(refreshCalls).toBe(1)
})

it('TOKEN_INVALID 不触发刷新', /* refreshCalls === 0，抛 code TOKEN_INVALID */)
it('RATE_LIMITED 带 retryAfter', /* Retry-After: 17 → retryAfter 17 */)
it('Retry-After 缺失或非法时取 60', /* 无头、'abc'、'0' 三种 */)
it('VALIDATION_FAILED 保留 details', /* details.fieldErrors.email */)
it('错误体不是 JSON → INTERNAL_ERROR，status 保留', /* 502 + text/html */)
it('网络失败 → NETWORK', /* HttpResponse.error() */)
it('中止 → ABORTED', /* AbortController，处理器里 delay('infinite') */)
it('204 返回 undefined', /* api('/api/x', { method: 'DELETE' }) */)
it('body 传对象时序列化并带 Content-Type: application/json')
```

`refresh.test.ts`（用 `vi.useFakeTimers()` 推进 300ms）：

```ts
it('成功：置为 authed，返回 true')
it('REFRESH_INVALID：300ms 后重试一次，第二次成功', async () => {
  // 第一次 401 REFRESH_INVALID，第二次 200
  const p = refreshSession()
  await vi.advanceTimersByTimeAsync(299); expect(calls).toBe(1)
  await vi.advanceTimersByTimeAsync(1);   expect(await p).toBe(true); expect(calls).toBe(2)
})
it('REFRESH_INVALID 两次：置为 guest，reason 为 null，共 2 次请求')
it('REFRESH_REUSED：不重试，guest 且 reason 为 reused，共 1 次请求')
it('网络错误：guest，不抛错')
it('并发调用共用一个请求', /* 两次 refreshSession() 是同一轮，calls === 1 */)
it('bootstrapAuth 调两次只刷新一次')
```

`auth-store.test.ts`：`subscribe` 在每次状态变化时通知一次；`setUser` 在 `guest` 时不改变状态；`useAuth` 在 `renderHook` 里随 `setAuthed` 更新。

- [ ] **Step 2: 运行，确认失败** `bunx vitest run features/auth` → FAIL
- [ ] **Step 3: 实现四个文件**
- [ ] **Step 4: 运行** `bunx vitest run features/auth && bun run typecheck` → 通过
- [ ] **Step 5: 提交** `git commit -m "fea: auth store, api client and single-flight refresh"`

---

### Task 6: 会话动作、多标签页同步、启动与语言切换

**Files:**
- Create: `features/auth/session.ts`、`session.test.ts`、`features/auth/use-set-locale.ts`、`use-set-locale.test.tsx`、`app/providers.tsx`、`features/auth/AuthGate.tsx`、`AuthGate.test.tsx`、`components/ui/BrandLoader.tsx`
- Modify: `app/layout.tsx`（包上 `Providers`）

**Interfaces:**
- Consumes: 任务 5 的全部导出；`writeLocaleCookie`
- Produces:

  ```ts
  // session.ts
  export function login(body: LoginRequest): Promise<User>         // 成功后 setAuthed
  export function register(body: RegisterRequest): Promise<User>
  /** 调登出接口（失败忽略）→ setGuest() → 清空查询缓存 → 广播。永不抛错。 */
  export function logout(queryClient: QueryClient): Promise<void>
  /** 订阅其他标签页的登出；返回取消订阅函数。BroadcastChannel 不存在时为空操作。 */
  export function listenForLogout(queryClient: QueryClient): () => void

  // use-set-locale.ts
  export function useSetLocale(): (locale: Locale) => void

  // AuthGate.tsx
  export function AuthGate(props: { children: ReactNode }): ReactNode
  ```

- 行为规定：
  - 广播频道名 `hilda:auth`，消息 `{ type: 'logout' }`。收到后 `setGuest()` 并清空查询缓存，不再转发。
  - `useSetLocale`：与当前语言相同则什么都不做；否则写 Cookie → `router.refresh()`；已登录时另发 `PATCH /api/users/me`，成功后 `authStore.setUser`，失败静默。
  - `Providers`：浏览器端复用同一个 `QueryClient`（写法见 Next 文档 `client-side-data-fetching/tanstack-query.md`）；挂载时 `bootstrapAuth()` 与 `listenForLogout()`；状态变为 `authed` 且 `user.locale` 与界面语言不同时，写 Cookie 并 `router.refresh()`；渲染 Toaster（任务 7 接入）。
  - `AuthGate`：`loading` → `<BrandLoader />`（全屏 `stage-yellow`，Logo 圆点脉动，`role="status"`）；`guest` → `router.replace('/login?next=' + encodeURIComponent(pathname))`，期间仍显示加载；`authed` → `children`。

- [ ] **Step 1: 写失败的测试**

`session.test.ts`：

```ts
it('login 成功后为 authed 并返回 user')
it('login 失败抛 ApiRequestError，状态不变')
it('logout：接口 500 也照常置为 guest、清空缓存', async () => {
  queryClient.setQueryData(['conversations', { q: '' }], { pages: [], pageParams: [] })
  await logout(queryClient)
  expect(authStore.getState()).toEqual({ status: 'guest', reason: null })
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
})
it('logout 广播给其他标签页', /* 桩一个 BroadcastChannel，断言 postMessage({ type: 'logout' }) */)
it('收到广播：置为 guest 并清空缓存，且不再广播')
it('BroadcastChannel 不存在时 logout 与 listenForLogout 都不抛错', /* vi.stubGlobal('BroadcastChannel', undefined) */)
```

`use-set-locale.test.tsx`（`next/navigation` 用 `vi.mock`）：

```ts
it('未登录：写 Cookie 并 refresh，不发请求')
it('已登录：另发 PATCH { locale: "en" }，成功后 store 里的 user.locale 更新')
it('PATCH 失败：Cookie 仍已写入，没有提示，不抛错')
it('选中当前语言：不写 Cookie、不 refresh、不发请求')
```

`AuthGate.test.tsx`：`loading` 时有 `role=status`、无子内容；`guest` 时 `router.replace` 以 `/login?next=%2Fchat%2Fabc` 调用；`authed` 时渲染子内容。

- [ ] **Step 2: 运行，确认失败** → FAIL
- [ ] **Step 3: 实现**
- [ ] **Step 4: 运行** `bun run test && bun run typecheck` → 通过
- [ ] **Step 5: 提交** `git commit -m "fea: session actions, cross-tab sign-out and locale switching"`

---

### Task 7: 基础组件

**Files:**
- Create: `components/ui/` 下 `PillButton.tsx`、`PillTabs.tsx`、`Chip.tsx`、`InfoCard.tsx`、`FloatingCard.tsx`、`Field.tsx`、`LocaleSwitch.tsx`、`toast.tsx`、`ConfirmDialog.tsx`、`Skeleton.tsx`、`Avatar.tsx`、`Logo.tsx`，及 `PillButton.test.tsx`、`PillTabs.test.tsx`、`Field.test.tsx`、`LocaleSwitch.test.tsx`、`ConfirmDialog.test.tsx`、`toast.test.tsx`
- Modify: `app/providers.tsx`（挂 `<Toaster />`）

**Interfaces:**
- Consumes: `springs`、`enter`；`useSetLocale`
- Produces（都是 Client Component）：

  ```ts
  PillButton(props: {
    variant?: 'ink' | 'lime' | 'pink' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'
    loading?: boolean; disabled?: boolean; iconOnly?: boolean; 'aria-label'?: string
    type?: 'button' | 'submit'; onClick?: () => void; children: ReactNode
  })
  PillTabs<T extends string>(props: {
    items: { value: T; label: string; badge?: string }[]; value: T; onChange(value: T): void
    'aria-label': string; layoutId: string; onInk?: boolean; scrollable?: boolean
  })
  Chip(props: { icon?: ReactNode; onClick(): void; children: ReactNode })
  InfoCard(props: { icon?: ReactNode; title: string; subtitle?: string; time?: string })
  FloatingCard(props: { rotate: number; delay: number; className?: string; children: ReactNode })
  Field(props: {
    label: string; name: string; type: 'text' | 'email' | 'password'; value: string
    onChange(value: string): void; onBlur?(): void; error?: ReactNode; hint?: ReactNode
    autoComplete?: string; autoFocus?: boolean; maxLength?: number; ref?: Ref<HTMLInputElement>
  })
  LocaleSwitch(props: { onInk?: boolean })
  toast(message: string, opts?: { tone?: 'default' | 'danger' }): void;  Toaster(): ReactNode
  ConfirmDialog(props: {
    open: boolean; title: string; body: string; confirmLabel: string; cancelLabel: string
    onConfirm(): void; onCancel(): void
  })
  Skeleton(props: { className?: string });  Avatar(props: { name: string; size?: number });  Logo()
  ```

- 行为规定：
  - `PillButton`：悬停、按压、聚焦、禁用、加载按 spec 8.6。加载时文案换成转圈、宽度不变（文字保留但 `visibility: hidden`）、`aria-busy`、点击无效。`danger` 变体是 spec 8.7 之外新增的，仅供 D8 使用。
  - `PillTabs`：`role="tablist"`，选中指示器是共享 `layoutId` 的 Motion 元素，用 `springs.smooth`；左右方向键移动并选中，首尾循环；`scrollable` 时横向可滚动。
  - `Field`：`ink` 底上的深色胶囊；`type="password"` 时带显隐按钮（A4），切换不改变光标位置与输入值；`error` 存在时输入框 `aria-invalid`，并经 `aria-describedby` 关联到错误文字。
  - `LocaleSwitch`：两段，当前语言 `aria-pressed="true"`，点击当前段无效果。
  - `toast` / `ConfirmDialog`：底层用 HeroUI 3 的对应部件（导出名以已安装版本为准；若该版本没有 toast 部件则自写，接口不变）。提示有 `role="status"`。`ConfirmDialog` 打开时默认聚焦取消按钮，确认按钮为 `danger`，Esc 等同取消。
  - `Avatar`：显示 `name` 的第一个字符（按字符而非 UTF-16 码元取，拉丁字母转大写）。

- [ ] **Step 1: 写失败的测试**

```ts
// PillButton.test.tsx
it('加载态：aria-busy，点击不触发 onClick，文案仍在 DOM 里以保持宽度')
it('禁用态：点击不触发 onClick')
it('iconOnly 必须能按 aria-label 找到', /* getByRole('button', { name: '发送' }) */)

// PillTabs.test.tsx
it('渲染 tablist，选中项 aria-selected')
it('右方向键选中下一项，末项再按回到首项；左方向键相反')
it('点击已选中项不触发 onChange')

// Field.test.tsx
it('标签与输入框关联', /* getByLabelText('邮箱') */)
it('错误：aria-invalid 且错误文字可由 aria-describedby 找到')
it('密码显隐：点击后 type 变为 text、按钮标签变为「隐藏密码」，值不变')

// LocaleSwitch.test.tsx（mock useSetLocale）
it('zh 界面：「中」aria-pressed，点击 EN 调用 setLocale("en")，点击「中」不调用')

// ConfirmDialog.test.tsx
it('打开时焦点在取消按钮上')
it('Esc 调用 onCancel；点确认调用 onConfirm')

// toast.test.tsx
it('toast("x") 后页面出现 role=status 的 x')
it('Avatar：「🧳旅行」显示 🧳，「ann」显示 A')
```

- [ ] **Step 2: 运行，确认失败** → FAIL
- [ ] **Step 3: 实现各组件**
- [ ] **Step 4: 运行** `bun run test && bun run typecheck` → 通过
- [ ] **Step 5: 提交** `git commit -m "fea: base ui components"`

---

### Task 8: 登录页与注册页

**Files:**
- Create: `features/auth/validation.ts`、`validation.test.ts`、`pending-prompt.ts`、`pending-prompt.test.tsx`、`lib/use-countdown.ts`、`AuthPanel.tsx`、`LoginForm.tsx`、`RegisterForm.tsx`、`LoginForm.test.tsx`、`RegisterForm.test.tsx`、`app/(auth)/layout.tsx`、`app/(auth)/login/page.tsx`、`app/(auth)/register/page.tsx`

**Interfaces:**
- Consumes: `login`、`register`、`useAuth`、`safeNext`、`Field`、`PillButton`、`LocaleSwitch`、`Logo`、`toast`
- Produces:

  ```ts
  // validation.ts（返回值是词典键，null 表示通过）
  export function validateEmail(v: string): 'auth.required' | 'auth.invalidEmail' | null
  export function validateRequired(v: string): 'auth.required' | null
  export function validateNickname(v: string): 'auth.required' | 'auth.nicknameTooLong' | null
  export function passwordRules(v: string): { length: boolean; mixed: boolean }   // 用 PasswordSchema 的同一组规则

  // pending-prompt.ts
  export const PENDING_KEY = 'hilda:pendingPrompt'
  export type PendingPrompt = { prompt: string; conversationId?: string }
  export function savePendingPrompt(p: PendingPrompt): void     // 存储不可用时静默
  export function peekPendingPrompt(): PendingPrompt | null      // 不清除；内容损坏返回 null
  export function takePendingPrompt(): PendingPrompt | null      // 读出并清除
  /** 挂载后把暂存内容交给 onReady 恰好一次（StrictMode 下也是一次）。enabled 为 false 时不消费。 */
  export function usePendingPrompt(enabled: boolean, onReady: (p: PendingPrompt) => void): void

  // lib/use-countdown.ts
  export function useCountdown(): { seconds: number; start(seconds: number): void }
  ```

- 行为规定：
  - `usePendingPrompt`：effect 里先 `take` 到一个 `ref`（先清后发），再用 `setTimeout(0)` 调 `onReady`，清理函数取消定时器；`ref` 在 StrictMode 的模拟重挂载之间保留，所以回调只触发一次，刷新页面也不会重复。
  - `(auth)/layout.tsx`：`loading` 显示 `BrandLoader`；`authed` 时 `router.replace(safeNext(next))`；`guest` 渲染顶部 L1、L2 与子页面。读 `useSearchParams` 的组件按 Next 文档包在 `<Suspense>` 里。
  - 表单按 spec 10.1–10.3 的每一行实现。提交流程：前端校验 → 有错则标出并聚焦第一个出错的输入框，不发请求 → 否则调接口。`VALIDATION_FAILED` 的 `details.fieldErrors` 中，字段名映射到对应输入框，文案用该字段的前端校验文案。`RATE_LIMITED` 用 `error.retryAfter` 启动 `useCountdown`。`NETWORK`、`INTERNAL_ERROR` 及未知码弹 `errors.network`。
  - 注册的 `locale` 传 `useLocale()` 的值。
  - `pendingHint` 的 `{prompt}`：按字符截到 40 个，超出加 `…`。

- [ ] **Step 1: 写失败的测试**

```ts
// validation.test.ts
it.each([['', 'auth.required'], ['  ', 'auth.required'], ['a@', 'auth.invalidEmail'], [' Ann@Example.com ', null]])('validateEmail(%j)', …)
it.each([['', 'auth.required'], ['x'.repeat(21), 'auth.nicknameTooLong'], ['旅'.repeat(20), null], [' a ', null]])('validateNickname(%j)', …)
it('passwordRules', () => {
  expect(passwordRules('abc')).toEqual({ length: false, mixed: false })
  expect(passwordRules('abcdefgh')).toEqual({ length: true, mixed: false })
  expect(passwordRules('abc12345')).toEqual({ length: true, mixed: true })
})

// pending-prompt.test.tsx
it('take 读出后清除，第二次为 null')
it('存储内容不是合法 JSON：peek 与 take 返回 null')
it('sessionStorage 抛错时 save、peek、take 都不抛错', /* vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error() }) */)
it('StrictMode 下 onReady 只调用一次，且调用时存储已清空', async () => {
  savePendingPrompt({ prompt: '里斯本 5 天' })
  const onReady = vi.fn(() => expect(sessionStorage.getItem(PENDING_KEY)).toBeNull())
  render(<StrictMode><Probe enabled onReady={onReady} /></StrictMode>)
  await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
  expect(onReady).toHaveBeenCalledWith({ prompt: '里斯本 5 天' })
})
it('enabled 为 false 时不消费，变为 true 后消费')

// LoginForm.test.tsx（next/navigation 用 vi.mock；next 取自 useSearchParams）
it('加载后焦点在邮箱框')
it('空表单提交：不发请求，两个框都显示「请填写此项」，焦点在邮箱框')
it('邮箱失焦校验：「请输入有效的邮箱」')
it('成功：router.replace 到 next；next 为 //evil.com 时到 /chat')
it('INVALID_CREDENTIALS：表单级错误「邮箱或密码不正确」，密码框被清空并获得焦点；修改任一输入后错误消失')
it('RATE_LIMITED（Retry-After: 3）：显示「…请 3 秒后再试」，按钮禁用，倒计时归零后可再次提交', /* fake timers */)
it('网络错误：弹提示「网络异常，请重试」，邮箱与密码保留')
it('请求进行中：按钮为加载态，再次点击不发第二个请求')
it('切换链接带上 next：/register?next=%2Fchat%2Fabc')
it('存在暂存输入：标题下显示提示；50 个字的内容截到 40 字加省略号')
it('store 为 guest 且 reason 为 reused：显示「登录状态已失效，请重新登录」')

// RegisterForm.test.tsx
it('加载后焦点在昵称框')
it('密码规则随输入逐条打勾；提交时未满足的条目变为 danger 色且不发请求')
it('昵称 21 个字：「昵称最多 20 个字」')
it('成功：请求体含 locale 为当前界面语言，之后跳 next')
it('EMAIL_TAKEN：邮箱框下「这个邮箱已注册」并有指向 /login?next=… 的链接')
it('VALIDATION_FAILED { fieldErrors: { nickname: […], email: […] } }：两个框下都有错误，焦点在昵称框')
it('RATE_LIMITED 倒计时')
```

- [ ] **Step 2: 运行，确认失败** → FAIL
- [ ] **Step 3: 实现**
- [ ] **Step 4: 运行** `bun run test && bun run typecheck` → 通过
- [ ] **Step 5: 起服务手动看一眼**：`bun run dev`（仓库根）后访问 `/login`、`/register`，确认面板为 `ink`、440px、`gentle` 入场、出错时晃动一次。
- [ ] **Step 6: 提交** `git commit -m "fea: login and register pages"`

---

### Task 9: 会话数据层

**Files:**
- Create: `features/conversations/api.ts`、`queries.ts`、`queries.test.tsx`

**Interfaces:**
- Consumes: `api`、`toast`
- Produces:

  ```ts
  // api.ts
  export function listConversations(p: { cursor?: string; q?: string }): Promise<Page<Conversation>>
  export function createConversation(): Promise<Conversation>
  export function renameConversation(id: string, title: string): Promise<Conversation>
  export function deleteConversation(id: string): Promise<void>
  export function listMessages(id: string, p: { cursor?: string }): Promise<Page<Message>>

  // queries.ts
  export const conversationsKey = (q: string) => ['conversations', { q }] as const
  export const messagesKey = (id: string) => ['messages', id] as const
  export function useConversations(q: string): UseInfiniteQueryResult<InfiniteData<Page<Conversation>>, ApiRequestError>
  export function useMessages(id: string | null): UseInfiniteQueryResult<InfiniteData<Page<Message>>, ApiRequestError>
  export function useRenameConversation(): UseMutationResult<Conversation, ApiRequestError, { id: string; title: string }>
  export function useDeleteConversation(): UseMutationResult<void, ApiRequestError, { id: string }>
  ```

- 行为规定：
  - 查询参数用 `URLSearchParams` 拼；`q` 去首尾空白，空串不传。`limit` 不传（用后端默认 20）。
  - `useMessages(null)` 不发请求。`CONVERSATION_NOT_FOUND` 不重试。消息查询 `staleTime: Infinity`（由流与失效驱动更新）。
  - 重命名、删除的乐观更新作用于**所有** `['conversations', *]` 缓存（含各搜索词）；失败时全部还原并 `toast`（`drawer.renameFailed` / `drawer.deleteFailed`，`tone: 'danger'`）。删除成功后移除 `messagesKey(id)`。重命名成功后不整表失效（后端不改 `updatedAt`，顺序不变）。

- [ ] **Step 1: 写失败的测试** `queries.test.tsx`（`renderHook` + `renderWithProviders` 的包装器）

```ts
it('列表：第一页不带 cursor；fetchNextPage 带上一页的 nextCursor；nextCursor 为 null 时 hasNextPage 为 false')
it('搜索词是查询键的一部分，请求带 q；空白搜索词不带 q')
it('消息：id 为 null 时不发请求')
it('消息：CONVERSATION_NOT_FOUND 只请求一次，error.code 可读')
it('重命名乐观更新：请求返回前标题已变；两份缓存（q="" 与 q="里"）都变', async () => {
  // 处理器 delay 后返回 200
  rename.mutate({ id: 'c1', title: '新标题' })
  await waitFor(() => expect(titleIn(conversationsKey(''), 'c1')).toBe('新标题'))
  expect(titleIn(conversationsKey('里'), 'c1')).toBe('新标题')
})
it('重命名失败：还原为旧标题并提示「重命名失败」')
it('删除乐观更新：条目立即从所有缓存消失；成功后 messagesKey(id) 被移除')
it('删除失败：条目回到原位置并提示「删除失败」')
```

- [ ] **Step 2: 运行，确认失败** → FAIL
- [ ] **Step 3: 实现**
- [ ] **Step 4: 运行** `bunx vitest run features/conversations && bun run typecheck` → 通过
- [ ] **Step 5: 提交** `git commit -m "fea: conversation queries with optimistic rename and delete"`

---

### Task 10: SSE 解析与 `useChatStream`

**Files:**
- Create: `features/chat/sse.ts`、`sse.test.ts`、`message-cache.ts`、`use-chat-stream.ts`、`use-chat-stream.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`、`ApiRequestError`、`messagesKey`、`ChatStreamEventSchema`、`sseBody`
- Produces:

  ```ts
  // sse.ts
  export function createSseParser(): { push(chunk: Uint8Array): ChatStreamEvent[] }

  // message-cache.ts
  /** 把消息放到缓存里最新的位置（pages[0].items 的开头，缓存为时间倒序）；已有同 id 则替换；缓存不存在时建一页。 */
  export function upsertMessage(queryClient: QueryClient, conversationId: string, message: Message): void

  // use-chat-stream.ts
  export type StreamPhase = 'idle' | 'sending' | 'streaming'
  export type SendOutcome = { ok: true } | { ok: false; error: ApiRequestError }
  export function useChatStream(conversationId: string | null): {
    phase: StreamPhase
    text: string
    requirements: Requirement[]
    activeConversationId: string | null
    send(conversationId: string, content: string): Promise<SendOutcome>
    stop(): void
  }
  ```

- 行为规定：
  - 解析器内部用 `TextDecoder('utf-8')` 的流式模式解码；按空行分事件，接受 `\n` 与 `\r\n`；忽略注释行（`:` 开头）与没有 `data` 的块；`data` 不是合法 JSON 或不符合 `ChatStreamEventSchema` 的事件丢弃，不抛错。
  - `send`：`phase` 立即变 `sending`；首个事件到达后变 `streaming`。`phase` 不是 `idle` 时再次调用直接返回 `{ ok: false, error: ABORTED }`，不发请求。
  - 事件处理：`user_message` → `upsertMessage`，并使 `['conversations']` 前缀的查询失效（标题可能刚生成）；`delta` → 追加到 `text`；`requirement` → 写入 `requirements`；`done` / `error` → `upsertMessage` 助手消息，清空本地状态，`phase` 回 `idle`，再使 `['conversations']` 失效（顺序变了）。
  - 流开始前失败（`apiFetch` 抛错）：不写缓存，`phase` 回 `idle`，返回 `{ ok: false, error }`。
  - 流正常关闭但没见到 `done` / `error`：把已累计的文本写成一条本地助手消息（`status: 'error'`），使 `messagesKey` 失效，返回 `{ ok: true }`。
  - `stop()`：中止请求。已收到 `user_message`：把已累计文本写成本地助手消息（`status: 'partial'`，可为空文本），使 `messagesKey` 失效，`send` 的返回值为 `{ ok: true }`。尚未收到 `user_message`：不写缓存，使 `messagesKey` 失效，返回 `{ ok: false, error: ABORTED }`。
  - 本地助手消息：`id` 为 `local-` 加 `crypto.randomUUID()`，`metadata` 在已有需求时为 `{ requirements }`，否则 `null`，`createdAt` 为当前时间。
  - 自动中止：组件卸载；或 `conversationId` 参数变为与 `activeConversationId` 不同的值。

- [ ] **Step 1: 写失败的测试**

`sse.test.ts`：

```ts
const enc = (s: string) => new TextEncoder().encode(s)
const delta = (text: string) => `event: delta\ndata: ${JSON.stringify({ text })}\n\n`

it('一块里的两个事件', () => {
  const p = createSseParser()
  expect(p.push(enc(delta('a') + delta('b')))).toEqual([
    { event: 'delta', data: { text: 'a' } }, { event: 'delta', data: { text: 'b' } },
  ])
})
it('事件被拆在任意位置：逐字节喂入，结果相同', () => {
  const p = createSseParser()
  const out = [...enc(delta('好的，') + delta('里斯本'))].flatMap((b) => p.push(Uint8Array.of(b)))
  expect(out.map((e) => e.event === 'delta' && e.data.text)).toEqual(['好的，', '里斯本'])
})
it('CRLF 换行')
it('忽略注释行与未知事件名', /* ': ping\n\n'、'event: ping\ndata: {}\n\n' → [] */)
it('data 不是 JSON、或形状不符：丢弃，后续事件照常解析')
it('没有结尾空行的半个事件不产出')
```

`use-chat-stream.test.tsx`（`POST /api/conversations/c1/messages` 由 MSW 返回 `sseBody(...)`；`u`、`a` 为 `makeMessage` 造的用户与助手消息）：

```ts
it('完成：缓存里先后出现用户消息与助手消息，本地状态清空', async () => {
  // 事件：user_message(u)、delta('好的，')、delta('这是')、requirement([r])、done(a)
  const outcome = await act(() => result.current.send('c1', '里斯本 5 天'))
  expect(outcome).toEqual({ ok: true })
  expect(cachedIds('c1')).toEqual([a.id, u.id])          // 缓存为倒序
  expect(result.current).toMatchObject({ phase: 'idle', text: '', requirements: [] })
})
it('流进行中：phase 依次为 sending → streaming，text 累计，requirements 可读', /* close: false，逐步断言 */)
it('请求带 Authorization 且 body 为 { content }')
it('一个汉字跨两个网络块：text 无乱码', /* sseBody(events, { chunkBytes: 1 }) → text === '好的，这是' */)
it('error 事件：助手消息以 status error 进缓存，返回 ok')
it('手动停止（已有 delta）：缓存里多一条 partial 本地消息，内容为已累计文本，随后重新拉取消息', async () => {
  // close: false；等到 text === '好的，' 后 stop()
  expect(cached('c1')[0]).toMatchObject({ role: 'ASSISTANT', status: 'partial', content: '好的，' })
  expect(cached('c1')[0].id).toMatch(/^local-/)
  await waitFor(() => expect(messageListCalls).toBe(1))
})
it('收到 user_message 之前停止：不写缓存，返回 ABORTED')
it('流没有 done 或 error 就结束：写入 status 为 error 的本地消息，内容为已累计文本')
it.each([
  ['网络错误', HttpResponse.error(), 'NETWORK'],
  ['404', json(404, 'CONVERSATION_NOT_FOUND'), 'CONVERSATION_NOT_FOUND'],
  ['429', json(429, 'RATE_LIMITED', { 'Retry-After': '9' }), 'RATE_LIMITED'],
  ['500', json(500, 'INTERNAL_ERROR'), 'INTERNAL_ERROR'],
])('流开始前失败（%s）：不写缓存，返回对应错误', …)
it('TOKEN_EXPIRED：刷新后重发，流照常完成')
it('生成中再次 send：不发第二个请求')
it('卸载时中止请求', /* 处理器里监听 request.signal 的 abort */)
it('conversationId 由 c1 变为 c2：中止', /* rerender */)
it('conversationId 由 null 变为当前流的 c1：不中止，流照常完成')
```

- [ ] **Step 2: 运行，确认失败** `bunx vitest run features/chat` → FAIL
- [ ] **Step 3: 实现 `sse.ts`、`message-cache.ts`、`use-chat-stream.ts`**
- [ ] **Step 4: 运行** `bunx vitest run features/chat && bun run typecheck` → 通过
- [ ] **Step 5: 提交** `git commit -m "fea: sse parser and chat stream hook"`

---

### Task 11: 对话页（顶部栏与聊天区）

**Files:**
- Create: `features/chat/ChatScreen.tsx`、`TopBar.tsx`、`UserMenu.tsx`、`MessageList.tsx`、`MessageBubble.tsx`、`RequirementCards.tsx`、`Composer.tsx`、`use-stick-to-bottom.ts`，及 `ChatScreen.test.tsx`、`Composer.test.tsx`、`MessageBubble.test.tsx`、`UserMenu.test.tsx`、`use-stick-to-bottom.test.ts`；`app/(app)/layout.tsx`、`app/(app)/chat/layout.tsx`、`app/(app)/chat/[[...id]]/page.tsx`

**Interfaces:**
- Consumes: `useChatStream`、`useMessages`、`createConversation`、`usePendingPrompt`、`logout`、`useAuth`、`useCountdown`、`AuthGate`、任务 7 的组件
- Produces:

  ```ts
  // ChatScreen.tsx
  export function conversationIdFromPath(pathname: string): string | null   // '/chat' → null；'/chat/abc' → 'abc'；多于一段取第一段
  export function ChatScreen(): ReactNode
  /** 留给任务 12–14 的插槽，本任务先渲染占位 */
  //   <TopBar onToggleDrawer drawerOpen center={…} right={…} />   center、right 由任务 13 填 P1、P2
  //   drawerOpen / setDrawerOpen 状态已在 ChatScreen 里

  // Composer.tsx
  export function Composer(props: {
    value: string; onChange(v: string): void
    generating: boolean; rateLimitSeconds: number
    onSend(): void; onStop(): void; ref?: Ref<HTMLTextAreaElement>
  }): ReactNode

  // use-stick-to-bottom.ts
  export const BOTTOM_THRESHOLD_PX = 80
  export function isNearBottom(el: { scrollTop: number; scrollHeight: number; clientHeight: number }): boolean
  export function useStickToBottom(dep: unknown): { ref: RefObject<HTMLDivElement | null>; atBottom: boolean; scrollToBottom(): void }
  ```

- 行为规定（spec 11.1–11.3 的每一行都要实现；下面只写 spec 没定的）：
  - `app/(app)/layout.tsx` 套 `AuthGate`；`app/(app)/chat/layout.tsx` 渲染 `<ChatScreen />` 与 `{children}`；`page.tsx` 返回 `null`。
  - 发送流程 `handleSend`：内容去空白后为空则忽略；立即清空输入框。无会话 `id` 时：用一个 `ref` 做互斥，`createConversation()` → `window.history.replaceState(null, '', '/chat/' + id)` → `stream.send(id, content)`。`createConversation` 失败按「流开始前失败」处理。
  - `send` 返回 `ok: false` 时：把文字放回输入框（输入框此时已有新内容则不覆盖）。`RATE_LIMITED` → 启动 C9 倒计时，不弹提示；`CONVERSATION_NOT_FOUND` → 显示「找不到这段对话」状态；`ABORTED` → 无提示；其余 → 弹 `chat.sendFailed`。
  - 暂存输入：`usePendingPrompt(status === 'authed', …)`。带 `conversationId` 且等于当前 `id` → 直接发送；不带且当前为新对话 → 走 `handleSend`；其余情况丢弃。
  - 消息展示：把各页 `items` 拼接后反转为时间正序。生成中在末尾追加一个「正在生成」的气泡：`text` 为空显示三点跳动，否则显示 `text`；其下是本地 `requirements` 的卡片。
  - C4 需求卡片：数据取自助手消息的 `metadata.requirements`。
  - 加载更早的消息：列表顶部放一个哨兵元素，用 `IntersectionObserver` 触发 `fetchNextPage`；加载前记下 `scrollHeight`，加载后把 `scrollTop` 加上高度差以保持阅读位置。
  - T6 退出：`await logout(queryClient)` 后 `router.replace('/')`。
  - 桌面布局：聊天区 42%、右侧 58%（右侧本任务放空的占位容器）。根容器背景色用内联样式加 `BG_TRANSITION`，默认 `stage-orange`。

- [ ] **Step 1: 写失败的测试**

```ts
// use-stick-to-bottom.test.ts
it.each([[920, true], [919, false]])('scrollTop=%i（scrollHeight 1500、clientHeight 500）→ %s', …)  // 距底 80 算在底部

// MessageBubble.test.tsx
it('用户消息保留换行', /* white-space: pre-wrap */)
it('partial：下方标注「已停止」；error：标注「生成失败」')
it('内容为空的 error 消息只显示标注')
it('metadata.requirements 两条：两张卡片，标题为 action，副标题为 constraints 用「 · 」连接')
it('constraints 为空：没有副标题')

// Composer.test.tsx
it('回车发送，Shift+回车换行')
it('输入法组字中的回车不发送', /* fireEvent.keyDown(el, { key: 'Enter', isComposing: true }) */)
it('空或全空白：发送按钮禁用，回车不触发 onSend')
it('generating：按钮读屏标签为「停止」，点击触发 onStop；输入框仍可输入')
it('3799 字不显示计数；3800 字显示「3800 / 4000」；输入框 maxLength 为 4000')
it('rateLimitSeconds 为 5：显示「发送太快了，请 5 秒后再试」且发送禁用；为 0 时不显示')

// UserMenu.test.tsx
it('头像按钮读屏标签「账号菜单」；菜单里有昵称、邮箱、语言切换、退出登录')
it('退出：接口 500 也清空缓存、置为 guest 并 router.replace("/")')

// ChatScreen.test.tsx（usePathname 由可变的 mock 提供；window.history.replaceState 用 spy 并同步更新 mock 的 pathname）
it('conversationIdFromPath', /* '/chat' → null；'/chat/abc' → 'abc'；'/chat/abc/x' → 'abc' */)
it('新对话：显示「嗨，Ann，想去哪？」与四个建议 chip')
it('点击 chip：文字填入输入框并聚焦，不发请求；输入框非空时 chip 隐藏')
it('新对话发出第一条：先 POST /api/conversations，再 replaceState 到 /chat/{id}，然后流式显示回复与需求卡片')
it('新对话里连按两次回车：只创建一个会话，只发一条消息')
it('已有会话：加载中显示三条骨架气泡，之后按时间正序显示')
it('会话不存在：显示「找不到这段对话」，按钮跳 /chat')
it('生成中：副标题为「正在输入…」，首个 delta 前显示三点；chip 隐藏')
it('流开始前失败（500）：弹提示「发送失败，请重试」，文字回到输入框')
it('发送返回 RATE_LIMITED（Retry-After: 4）：显示 C9 倒计时，文字回到输入框，不弹提示')
it('点击停止：已生成部分保留并标注「已停止」')
it('暂存输入 { prompt }（新对话）：自动创建会话并发送，只发一次')
it('暂存输入 { prompt, conversationId } 与当前会话一致：直接发送，不创建会话')
it('滚到顶部哨兵可见：请求下一页（带 cursor）')
it('距底部超过 80px：出现「回到最新」按钮，点击后调用 scrollToBottom；在底部时不出现')
```

- [ ] **Step 2: 运行，确认失败** → FAIL
- [ ] **Step 3: 实现**
- [ ] **Step 4: 运行** `bun run test && bun run typecheck` → 通过
- [ ] **Step 5: 联调**：后端 `LLM_FAKE=1` 启动（`services/chat/.env` 里临时加），`bun run dev` 后注册一个账号，发一条消息，确认：地址变为 `/chat/{id}` 且流没有中断；刷新后消息还在；生成中上滚不被拉回底部，出现 C5。
- [ ] **Step 6: 提交** `git commit -m "fea: chat screen with streaming replies"`

---

### Task 12: 历史抽屉

**Files:**
- Create: `features/conversations/HistoryDrawer.tsx`、`ConversationItem.tsx`、`HistoryDrawer.test.tsx`
- Modify: `features/chat/ChatScreen.tsx`（接入抽屉）

**Interfaces:**
- Consumes: 任务 9 的 hooks、`ConfirmDialog`、`Skeleton`、`springs.drawer`、`ChatScreen` 的 `drawerOpen`
- Produces:

  ```ts
  export function HistoryDrawer(props: {
    open: boolean; onClose(): void
    activeId: string | null
    /** 当前是否为还没发过消息的新对话 */
    isBlankNewChat: boolean
    /** 抽屉关闭后把焦点还给它（T1） */
    returnFocusRef: RefObject<HTMLElement | null>
  }): ReactNode
  ```

- 行为规定（spec 11.4 的每一行；下面只写 spec 没定的）：
  - 抽屉是 `role="dialog"`、`aria-modal`、标签为 `chat.history`。焦点限制与 Esc 用 HeroUI / React Aria 的对话框部件实现，不自写焦点陷阱。遮罩只盖聊天区。
  - 搜索词用 300ms 防抖后传给 `useConversations`；输入框立即响应。
  - 相对时间用 next-intl 的 `useFormatter().relativeTime(updatedAt, now)`。
  - 列表是 `role="listbox"` 式的漫游焦点：上下方向键在条目间移动，回车打开。
  - D5 在 `(hover: none)` 设备上常驻，其余在条目悬停或 `:focus-within` 时出现。
  - D6：输入框 `maxLength` 60，进入时全选；回车或失焦保存，Esc 取消；去空白后为空或与原标题相同视为取消，不发请求。
  - D4 的标题为空字符串时（会话已有消息但标题尚未生成的瞬间）显示 `drawer.newChat` 的文案。
  - D8 确认后：条目以 `smooth` 收起；删除的是当前会话时 `router.replace('/chat')`。
  - D9：列表底部哨兵触发 `fetchNextPage`；`isFetchNextPageError` 时显示 `common.loadFailed` 与 `common.retry`。
  - 打开会话、新对话都用 `router.push`。生成中的流由 `useChatStream` 的自动中止处理，不弹确认。

- [ ] **Step 1: 写失败的测试** `HistoryDrawer.test.tsx`

```ts
it('打开后焦点在抽屉内；Tab 不会离开抽屉')
it('Esc 关闭并把焦点还给 returnFocusRef；点击遮罩关闭')
it('列表：标题与相对时间；当前会话 aria-current')
it('列表为空且无搜索词：「还没有对话，从一个目的地开始吧」')
it('搜索：输入后 299ms 不请求，300ms 后带 q 请求；无结果显示「没有匹配的对话」', /* fake timers */)
it('清空按钮仅在搜索框非空时出现；点击后搜索词清空且焦点回到搜索框')
it('下方向键移到下一条，回车调用 router.push("/chat/{id}") 并关闭')
it('新对话：router.push("/chat") 并关闭；isBlankNewChat 时只关闭不跳转')
it('重命名：标题变为输入框且全选；回车保存，请求体为去空白后的标题')
it('重命名：Esc 取消；清空后失焦不发请求；未改动不发请求')
it('重命名失败：标题还原并提示「重命名失败」')
it('删除：确认框默认聚焦「取消」；确认后条目消失')
it('删除当前会话：router.replace("/chat")')
it('删除失败：条目恢复并提示「删除失败」')
it('滚到底部哨兵：请求下一页并显示三行骨架；失败时显示「加载失败」与「重试」，点击重试再次请求')
it('标题为空字符串的会话显示「新对话」')
```

- [ ] **Step 2: 运行，确认失败** → FAIL
- [ ] **Step 3: 实现并接入 `ChatScreen`**（T1 图标随 `drawerOpen` 在菜单与关闭之间切换）
- [ ] **Step 4: 运行** `bun run test && bun run typecheck` → 通过
- [ ] **Step 5: 提交** `git commit -m "fea: history drawer with search, rename and delete"`

---

### Task 13: 右侧静态面板

**Files:**
- Create: `features/panels/TripPanels.tsx`、`PlanPanel.tsx`、`HotelsPanel.tsx`、`RoutesPanel.tsx`、`HotspotsPanel.tsx`、`pricing.ts`、`mock/types.ts`、`mock/zh.ts`、`mock/en.ts`、`mock/index.ts`，及 `pricing.test.ts`、`mock/mock.test.ts`、`panels.test.tsx`
- Modify: `features/chat/ChatScreen.tsx`、`TopBar.tsx`（P1 放顶部中间，P2 放 T3 之前的右侧；背景色跟随 P1）

**Interfaces:**
- Consumes: `PillTabs`、`PillButton`、`InfoCard`、`toast`、`enter`、`springs`
- Produces:

  ```ts
  // mock/types.ts
  export type PanelTab = 'plan' | 'hotels' | 'routes' | 'hotspots'
  export const STAGE_COLOR: Record<PanelTab, string>   // plan→stage-orange、hotels→stage-purple、routes→stage-green、hotspots→stage-pink 的 CSS 变量
  export type HotspotCategory = 'food' | 'views' | 'nightlife' | 'hidden'
  export type TripMock = {
    city: string                                  // 里斯本 / Lisbon
    duration: string                              // 5 天 / 5 days
    facts: [string, string, string]               // 6 月 16–20 日、2 人、中等预算
    days: { title: string; stops: { icon: string; name: string; note: string; time: string }[] }[]   // 恰好 5 天，每天 3–5 站
    hotels: { id: string; name: string; area: string; perNight: number; imageLabel: string }[]       // 恰好 3 家，价格为欧元整数
    route: { steps: { name: string; note: string; walkMin: number; tramMin: number }[] }             // 恰好 6 步
    hotspots: { id: string; category: HotspotCategory; name: string; note: string; emoji: string; count: number; imageLabel: string }[]  // 8 个，四个分类各至少 1 个
  }
  // mock/index.ts
  export function getTripMock(locale: Locale): TripMock

  // pricing.ts
  export const NIGHTS = 5
  export function fullStayPrice(perNight: number): number   // Math.round(perNight * 5 * 0.88)

  // 组件
  export function TripPanels(props: { tab: PanelTab; data: TripMock }): ReactNode   // P3 头部 + 当前面板
  export function PanelTabs(props: { tab: PanelTab; onChange(t: PanelTab): void; scrollable?: boolean }): ReactNode  // P1
  export function SaveTripButton(): ReactNode                                       // P2
  export function PlanPanel(props: { data: TripMock }): ReactNode
  export function HotelsPanel(props: { data: TripMock }): ReactNode
  export function RoutesPanel(props: { data: TripMock }): ReactNode
  export function HotspotsPanel(props: { data: TripMock }): ReactNode
  ```

- 行为规定（spec 第 12 节的每一行；下面只写 spec 没定的）：
  - `tab` 状态放在 `ChatScreen`，默认 `plan`；各面板内部状态（当天、选中酒店、计价方式、出行方式、筛选、已添加）是各面板自己的 `useState`，切换面板即复位。
  - 示例内容由实现者按「里斯本 5 天」自拟，两种语言的结构（天数、每天站数、酒店 `id` 与价格、步骤数与用时、热点 `id`、分类、计数）必须一致。
  - 图片位置：条纹占位块里放 `imageLabel` 文字。P10 地图占位 `role="img"`，`aria-label` 为 `panels.mapAlt`。
  - P7 用 `role="radiogroup"`，方向键移动并选中。价格显示用 `useFormatter().number(value, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })`。
  - P11 总时长 = 所选方式下各步用时之和。
  - P13 用 Motion 的 `AnimatePresence` 加 `layout`，重排用 `springs.smooth`。
  - 右侧面板底为 `ink`、圆角 40px；面板内卡片不加阴影。

- [ ] **Step 1: 写失败的测试**

```ts
// pricing.test.ts
it.each([[120, 528], [145, 638], [89, 392], [1, 4]])('每晚 %i → 全程 %i', (n, total) => expect(fullStayPrice(n)).toBe(total))

// mock/mock.test.ts
it('两种语言结构一致', () => {
  const shape = (m: TripMock) => ({
    days: m.days.map((d) => d.stops.length),
    hotels: m.hotels.map((h) => [h.id, h.perNight]),
    steps: m.route.steps.map((s) => [s.walkMin, s.tramMin]),
    spots: m.hotspots.map((s) => [s.id, s.category, s.count]),
  })
  expect(shape(getTripMock('en'))).toEqual(shape(getTripMock('zh')))
})
it('5 天、3 家酒店、6 步、热点四个分类都有')

// panels.test.tsx
it('P1：默认「行程」；切到「酒店」后小标题为「住在哪」；城市名旁常驻「示例」徽标')
it('P2：点击后提示「保存行程即将上线」，按钮未禁用')
it('行程：默认第 1 天；点「第 3 天」后显示该天标题与站点数')
it('酒店：默认选中第一家；右方向键选中第二家，预订按钮文案随之变为「预订 {第二家}」')
it('酒店：切到「全程」显示 -12% 徽标，价格为 fullStayPrice(每晚价)')
it('酒店：点预订提示「预订功能即将上线」')
it('路线：地图占位有文字说明；切到「28 路电车」后总时长为各步 tramMin 之和')
it('热点：选「美食」只剩 food 类；选回「全部」恢复')
it('热点：某分类没有数据时显示「这个分类下暂时没有地点」', /* 传入去掉 nightlife 的 data */)
it('热点：点「+ 添加」变为「已添加 ✓」，再点还原')
it('切换面板后再切回：面板内状态复位')
it('ChatScreen：切到「路线」后根容器背景为 stage-green', /* 断言内联 backgroundColor */)
```

- [ ] **Step 2: 运行，确认失败** → FAIL
- [ ] **Step 3: 实现并接入 `ChatScreen`**
- [ ] **Step 4: 运行** `bun run test && bun run typecheck` → 通过
- [ ] **Step 5: 提交** `git commit -m "fea: static trip panels with sample data"`

---

### Task 14: 落地页

**Files:**
- Create: `features/landing/LandingPage.tsx`、`PromptForm.tsx`、`floating-cards.tsx`、`LandingPage.test.tsx`、`app/(public)/page.tsx`
- Delete: `app/page.tsx`（旧的演示页）

**Interfaces:**
- Consumes: `useAuth`、`createConversation`、`savePendingPrompt`、`Chip`、`PillButton`、`FloatingCard`、`LocaleSwitch`、`Logo`、`Skeleton`、`toast`、`enter`
- Produces: `LandingPage(): ReactNode`

- 行为规定（spec 第 9 节的每一行；下面只写 spec 没定的）：
  - L8 未登录或鉴权仍在 `loading`：`savePendingPrompt({ prompt })` → `router.push('/login?next=/chat')`（`loading` 时也这样做：登录页在已登录时会自己跳到 `/chat`，暂存内容照常被消费）。
  - L8 已登录：`createConversation()` → `savePendingPrompt({ prompt, conversationId })` → `router.push('/chat/' + id)`。失败弹 `chat.sendFailed`，输入保留。
  - L7 `maxLength` 4000；提交的是去首尾空白后的值。
  - L10 四张卡片内容取自示例数据（一天的一站、一家酒店的价格、一条路线的时长、一个热点），`aria-hidden`，容器 `hidden lg:block`；漂浮是唯一的循环动画，`useReducedMotion()` 为真时不漂浮。
  - 入场顺序用 `enter(index)`：L4=0、L5=1、L6=2、L7/L8=3、L9=4，L10 在其后只淡入。

- [ ] **Step 1: 写失败的测试** `LandingPage.test.tsx`

```ts
it('未登录：右上角是「登录」，指向 /login；已登录：「进入对话」，指向 /chat；loading：骨架胶囊')
it('输入为空或全空白：提交按钮禁用')
it('点击建议 chip：文案进入输入框并聚焦，不跳转')
it('未登录提交：sessionStorage 里是 { prompt }，router.push("/login?next=/chat")')
it('输入法组字中的回车不提交；普通回车等同点击提交')
it('已登录提交：创建会话，暂存 { prompt, conversationId }，router.push("/chat/{id}")；期间按钮为加载态')
it('已登录提交失败：弹提示，输入保留，不跳转，不留暂存')
it('sessionStorage 不可用：未登录提交仍然跳到登录页，不抛错')
it('浮动卡片对读屏隐藏且不可聚焦')
```

- [ ] **Step 2: 运行，确认失败** → FAIL
- [ ] **Step 3: 实现，删除旧的 `app/page.tsx`**
- [ ] **Step 4: 运行** `bun run test && bun run typecheck && bun run build` → 通过
- [ ] **Step 5: 提交** `git commit -m "fea: landing page with deferred prompt"`

---

### Task 15: 移动端

**Files:**
- Create: `features/panels/MobileSheet.tsx`、`MobileSheet.test.tsx`
- Modify: `features/chat/ChatScreen.tsx`、`TopBar.tsx`、`Composer.tsx`（上方加「查看行程」）、`features/conversations/HistoryDrawer.tsx`（窄屏全宽）、`features/panels/HotspotsPanel.tsx`（窄屏两列）、`features/landing/LandingPage.tsx`（chip 换行）

**Interfaces:**
- Consumes: `useIsDesktop`、`PanelTabs`、`SaveTripButton`、`TripPanels`、`springs.drawer`
- Produces:

  ```ts
  export const DISMISS_RATIO = 0.25
  export function shouldDismiss(dragOffsetY: number, sheetHeight: number): boolean   // dragOffsetY > sheetHeight * 0.25
  export function MobileSheet(props: { open: boolean; onClose(): void; children: ReactNode }): ReactNode
  ```

- 行为规定（spec 第 13 节；下面只写 spec 没定的）：
  - `useIsDesktop()` 为假时：`TopBar` 不渲染 P1、P2；右栏不渲染；`Composer` 上方出现 `chat.viewTrip` 胶囊；`MobileSheet` 内顶部一行是拖动条、`PanelTabs scrollable`、`SaveTripButton`、关闭按钮，下面是 `TripPanels`。
  - `MobileSheet` 高度 `92dvh`，`role="dialog"`、`aria-modal`；用 Motion 的 `drag="y"`，松手时按 `shouldDismiss` 决定收起或弹回；Esc 收起。
  - 纯样式的响应式（抽屉全宽、热点两列、chip 换行）用 Tailwind 的 `lg:` 前缀，不用 JS。

- [ ] **Step 1: 写失败的测试** `MobileSheet.test.tsx`

```ts
it.each([[149, 600, false], [150, 600, false], [151, 600, true]])('拖动 %i / 高 %i → %s', …)
it('打开时是 dialog；关闭按钮读屏标签「关闭」；Esc 调用 onClose')
it('窄屏的 ChatScreen：顶部栏没有主标签，输入框上方有「查看行程」；点击后底部面板里出现主标签与「保存行程」', /* mock useIsDesktop → false */)
it('底部面板里切到「酒店」：ChatScreen 根容器背景变为 stage-purple')
it('桌面的 ChatScreen：没有「查看行程」按钮')
```

- [ ] **Step 2: 运行，确认失败** → FAIL
- [ ] **Step 3: 实现**
- [ ] **Step 4: 运行** `bun run test && bun run typecheck` → 通过
- [ ] **Step 5: 用浏览器在 375×812 下走一遍**：落地页 chip 换行且无浮动卡片；对话页全屏聊天；底部面板可拖动收起；抽屉全宽；热点两列；所有按钮触摸区域不小于 44px。
- [ ] **Step 6: 提交** `git commit -m "fea: mobile layout with bottom sheet"`

---

### Task 16: 端到端与无障碍

**Files:**
- Create: `playwright.config.ts`、`e2e/helpers.ts`、`e2e/journey.spec.ts`、`e2e/session.spec.ts`、`e2e/locale.spec.ts`、`e2e/a11y.spec.ts`
- Modify: `clients/chat-web/README.md`（写明前置条件与命令）

**Interfaces:**
- Consumes: 后端的 `.env.test` 与测试库（`services/chat` 下 `bun run db:test:prepare` 已执行过）；假模型的固定输出：回复为 `好的，这是一段用于测试的回复。`，需求卡片标题 `规划行程`、副标题 `测试数据`（见 `services/chat/src/llm/chat-reply/fakes.ts`）
- Produces:

  ```ts
  // e2e/helpers.ts
  export function uniqueEmail(): string                       // `e2e-${Date.now()}-${random}@example.com`
  export async function registerViaUi(page: Page, opts?: { nickname?: string }): Promise<{ email: string; password: string }>
  export async function expectNoSeriousViolations(page: Page): Promise<void>   // axe；排除 Next 开发工具的 `nextjs-portal`；只看 impact 为 critical 或 serious
  ```

- 配置规定：
  - 端到端用独立端口，不与 `bun run dev` 冲突：后端 `4101`，前端 `3102`。
  - `webServer` 两项：
    1. `cwd: '../../services/chat'`，命令 `bun run db:generate && bun run build && bun --env-file=.env.test dist/main.js`，环境变量 `PORT=4101`、`CORS_ORIGIN=http://localhost:3102`、`LLM_FAKE=1`，就绪地址 `http://localhost:4101/health`。
    2. 命令 `bunx next dev --port 3102`，环境变量 `NEXT_PUBLIC_API_BASE_URL=http://localhost:4101`，就绪地址 `http://localhost:3102`。
  - `baseURL: 'http://localhost:3102'`；只跑 Chromium；`retries: 0`、`workers: 1`；`locale: 'zh-CN'`。注册与登录接口每 IP 每分钟合计 10 次，整套测试的注册加登录次数控制在 8 次以内（重试会撞限流）：`a11y.spec.ts` 的两个对话页用例共用一次注册，用 `storageState` 带上 refresh Cookie。
  - 不清库：每次运行用唯一邮箱。

- [ ] **Step 1: 写配置、辅助函数与四个用例文件**

```ts
// journey.spec.ts
test('落地页输入 → 注册 → 自动发送 → 回复与需求卡片 → 抽屉 → 重命名 → 删除 → 退出', async ({ page }) => {
  // 1. 打开 /，输入「里斯本 5 天」，点「开始规划」→ 地址为 /login?next=/chat，可见「登录后将为你规划：「里斯本 5 天」」
  // 2. 点「还没有账号？注册」→ /register?next=%2Fchat；填表提交
  // 3. 地址匹配 /chat/[a-z0-9]+；可见用户气泡「里斯本 5 天」、助手气泡「好的，这是一段用于测试的回复。」、卡片「规划行程」
  // 4. 刷新：消息仍在，且没有第二条用户消息（暂存只消费一次）
  // 5. 打开抽屉：有一条标题为「里斯本 5 天」的会话；重命名为「葡萄牙之旅」后列表显示新标题
  // 6. 点「新对话」：地址为 /chat，可见「嗨，…，想去哪？」
  // 7. 打开抽屉，删除该会话并确认：列表显示空状态
  // 8. 账号菜单 → 退出登录：地址为 /，右上角为「登录」；再访问 /chat 被带到 /login?next=%2Fchat
})

// session.spec.ts
test('刷新后登录态恢复', /* 注册 → /chat → reload → 仍在 /chat 且可见问候语，没有跳到 /login */)
test('两个标签页同步退出', /* 同一 context 两个 page 都在 /chat；A 退出 → B 自动到 /login */)
test('已登录访问 /login 跳到 /chat')

// locale.spec.ts
test('切换语言后文案变化且刷新后保持', /* / 上点 EN → 标题为 Where to next?、<html lang="en"> → reload 仍是英文 */)
test('浏览器语言为英文时首次访问是英文', /* test.use({ locale: 'en-US' }) */)
test('登录后以账号语言为准', /* 英文界面注册 → 退出 → 切到中文 → 登录 → 界面回到英文 */)

// a11y.spec.ts
for (const [name, go] of [落地页, 登录页, 注册页, 对话页, 打开抽屉的对话页])
  test(`${name} 无严重无障碍问题`, async ({ page }) => { await go(page); await expectNoSeriousViolations(page) })
test('减少动态效果时没有位移动画', async ({ browser }) => {
  // context 用 reducedMotion: 'reduce'；打开 /，在入场期间多次采样 L5 标题的 getBoundingClientRect().top，全程不变；
  // 采样浮动卡片 2 秒内的 transform，全程不变
})
```

- [ ] **Step 2: 装浏览器并运行**

```bash
bunx playwright install chromium
```

```bash
bun run test:e2e
```

Expected：全部通过。失败时先修实现，不放宽断言；axe 报出的 `critical` / `serious` 问题逐条修掉。

- [ ] **Step 3: 提交** `git commit -m "fea: end-to-end and accessibility tests"`

---

### Task 17: 收尾

**Files:**
- Modify: `clients/chat-web/README.md`（替换模板内容：页面与路由、环境变量 `NEXT_PUBLIC_API_BASE_URL`、三类测试的命令与前置条件、「前端与 API 必须同站」的部署约束）、`services/chat/README.md`（删去「演示页面在前端用户层做完之前会收到 401」那句）、根 `README.md`（如提到旧演示页则更新）

- [ ] **Step 1: 全量验证**（仓库根）

```bash
bun run typecheck
```

```bash
bun run lint
```

```bash
bun run build
```

再在 `clients/chat-web` 下 `bun run test` 与 `bun run test:e2e`，在 `services/chat` 下 `bun run test`。Expected：全部通过。

- [ ] **Step 2: 对照前端 spec 逐节自查**：第 1 节五条成功标准各自能指到一个通过的端到端或组件测试；第 9–13 节表格里每个编号的元素都在界面上，文案与 spec 逐字一致；第 2 节列出的「不做的事」一项都没做。
- [ ] **Step 3: 更新文档并提交** `git commit -m "docs: chat-web README for the user layer"`
