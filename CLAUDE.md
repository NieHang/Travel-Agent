# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENT.md
@AGENTS.md
@LESSON.md

## Project

Hilda: a zh/en travel-planning chat app. Bun + Turborepo monorepo:

- `clients/chat-web` (`@autix/chat-web`): Next.js 16 App Router, React 19, HeroUI v3, Tailwind 4, next-intl, Zustand, React Query. Port 3002. Has its own `CLAUDE.md` (Next.js version warning).
- `services/chat` (`@autix/chat`): NestJS 12 on Bun, Prisma 7 + PostgreSQL with pgvector, LangChain (OpenAI-compatible), MCP client. Port 4001. ESM (`"type": "module"`): relative imports end in `.js`.
- `packages/contracts` (`@autix/contracts`): shared Zod schemas and types, consumed as TS source (no build step). Any API shape shared by both sides lives here.

READMEs and design docs are mostly in Chinese. Specs/plans live in `docs/superpowers/{specs,plans}`; `docs/superpowers/specs/2026-10-11-trip-flow-refactor-design.md` describes the current trip architecture. `services/chat/LANGCHAIN.md` still describes the removed `ui-protocol` / `/api/ui-chat` flow; trust `src/trip/` over it.

## Commands

From the repo root (Turbo): `bun install`, `bun run typecheck`, `bun run lint`, `bun run build`, `bun run dev` (backend + frontend; the `clean:ports` step uses `lsof`, so on Windows use `dev:chat` / `dev:chat-web` in separate shells). The frontend `dev` waits for tcp:4001.

`services/chat` (run inside that directory):

```sh
bun run db:generate                 # required before first build/typecheck; client goes to src/generated/prisma (gitignored)
bun run db:migrate                  # prisma migrate dev
bun run test                        # unit: **/*.spec.ts, excludes *.int.spec.ts, no DB
bun run test:int                    # *.int.spec.ts against real Postgres, files run serially
bun run test:e2e                    # *.e2e-spec.ts
bun run db:test:prepare             # create/migrate the test DB (re-run after schema changes)
bun run lint                        # oxlint --type-aware
bunx vitest run src/trip/state.spec.ts                                  # single unit test
bunx vitest run --config vitest.config.int.ts src/trip/turn.int.spec.ts # single integration test
bun run scripts/test-trip-live.ts   # live check of trip prompts against the real model + MCP servers
```

`clients/chat-web`:

```sh
bun run test                        # Vitest + jsdom + MSW, **/*.test.{ts,tsx}, no backend
bunx vitest run features/chat/sse.test.ts
bun run typecheck                   # `lint` is also just tsc --noEmit
bun run test:e2e                    # Playwright, Chromium only; builds/starts backend with fake LLM on 4101, web on 3102
```

Env: `services/chat/.env` needs `DATABASE_URL`, `JWT_ACCESS_SECRET` (≥32 chars, startup fails otherwise), `OPENAI_API_KEY`/`OPENAI_BASE_URL` for real models, `ROLLING_GO`/`ROLLING_GO_API_KEY` for the hotel MCP server. `LLM_FAKE=1` swaps in a fake model (refused when `NODE_ENV=production`). Integration/e2e tests read `services/chat/.env.test` (copy `.env.test.example`); its DB name must end in `_test` or tests refuse to run, because each test file truncates tables. Frontend API base is `NEXT_PUBLIC_API_BASE_URL` (build-time, default `http://localhost:4001`) and must match backend `CORS_ORIGIN`.

## Architecture

**Trip turn flow (the core of the app).** `POST /api/conversations/:id/messages` (`services/chat/src/chat/chat.controller.ts`) takes `{ revision, command, locale }` (`SendTurnRequestSchema` in contracts) and streams SSE from `TurnService.run()` (`src/trip/turn.ts`). The server owns the workflow; the LLM only does language work.

- `trip/state.ts`: `TripState` (stage `idle → trip_type → requirements → review → confirmed`, requirements, itinerary, days, stays, results, `revision`), stored once per conversation.
- `trip/commands.ts`: `reduce(state, command, classified)` is a pure reducer returning the next state plus an optional LLM effect (`'answer' | 'itinerary'`).
- `trip/view.ts`: `render(state)` builds every UI component (`choice`, `form`, `buttons`, `cards`) from state. The LLM never generates components.
- `trip/llm.ts`: `classify()` free text, `respond()` streams prose and drives the MCP tool loop (`tool-loop.ts`); `results.ts` grounds `show_results` calls against real tool results by `callId`.
- `trip/turn.ts` is the only trip file that touches Prisma. Keep `state`/`commands`/`view` free of Nest, Prisma and LangChain imports.
- Concurrency: a stale `revision` returns 409. A turn claims the revision while running and must release it on success, stop and failure. Errors before the first SSE event are plain JSON HTTP errors; once streaming, failures arrive as an `error` event and partial replies are saved.
- `GET /api/conversations/:id/ui-state` returns `{ revision, trip, components }` for restoring panels after a reload.
- `ChatService` (`src/chat/chat.service.ts`) is the older requirement-analysis path, used only when `TurnService` isn't provided.

**Frontend chat.** `features/chat/ChatScreen` → `use-chat-stream` → `ui-stream-client.ts`/`sse.ts` (fetch-event-source). The in-flight stream lives in Zustand (`stores/ai-ui.store.ts`); history and persisted UI state live in React Query; switching accounts clears both. `components/ai-ui/ComponentRenderer` validates each component with contracts' `ComponentSchema` and sends the component's `command` back. Only components in the message whose `metadata.revision` equals the current revision are interactive (`features/chat/MessageList.tsx`); components from old messages or the old protocol render read-only. `features/panels/` shows the live trip (plan, hotels, routes, hotspots), partly still from bilingual mock data.

**Auth.** Access token kept in memory only; refresh token in an HttpOnly `SameSite=Lax` cookie, so frontend and API must be same-site. A global `JwtAuthGuard` protects every route except `/api/auth/{register,login,refresh,logout}` and `/health`. The client refreshes only on error code `TOKEN_EXPIRED`, and retries once on `REFRESH_INVALID` if the cookie wasn't cleared (multi-tab race). Rate limits come from `AppThrottlerGuard`; 429s expose `Retry-After`.

**Other backend modules** under `src/llm/` (embedding, memory, filesystem tools over `services/chat/workspace/`, multi-agent orchestrator, `/api/langchain/*`) are earlier LangChain demos, not part of the travel chat. Model settings come from `services/chat/config/langchain.yaml`.

**i18n.** Frontend strings are in `clients/chat-web/messages/{en,zh}.json` (a test checks the key sets match); server-generated trip copy is in `services/chat/src/trip/copy.ts`.

## Conventions

- Commits use conventional scopes (`fix(chat-web): …`) with a body covering what broke, why, and what was verified (see LESSON.md).
- Before calling an LLM-facing change done, run `scripts/test-trip-live.ts`; fake-LLM tests alone have missed real failures.
