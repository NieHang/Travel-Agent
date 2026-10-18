# Japan Travel Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a file-based skill mechanism to Hilda's trip LLM, plus a set of Japan skills:
- a core `japan-travel` skill, always in the prompt;
- one skill per city, which the model loads itself with `load_skill`.

**Architecture:** `src/skills/registry.ts` reads `services/chat/skills/*/SKILL.md` (YAML frontmatter + Markdown body) once at startup. `ModelTripLlm` gets the parsed skills. For the `answer` and `itinerary` tasks:
- Every `always: true` skill body goes into the system prompt, and the facts rule allows labelled travel-time estimates.
- Every other skill is listed as `name: description`, and a local `load_skill` tool is bound. The tool loop runs it without recording it in `toolResults`.

Hilda plans Japan trips only, so there is no destination matching and no "other destinations unchanged" guarantee.

**Tech Stack:** Bun, NestJS 12, TypeScript ESM (`.js` relative imports), LangChain core 1.x (`tool()`), zod 3, js-yaml 5 (already a dependency), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-18-japan-travel-skill-design.md`

## Global Constraints

- Skill folders: `services/chat/skills/japan-travel/` (with `scripts/traffic_routes.py`, `scripts/restaurants_info.py`), `japan-tokyo/`, `japan-kyoto/`, `japan-osaka/`, `japan-nara/`. Each has a `SKILL.md`.
- No changes to `packages/contracts`, the requirements form, panels, or `clients/chat-web`.
- `trip/state.ts`, `trip/commands.ts`, `trip/view.ts` must not import the skill registry, Nest, Prisma or LangChain.
- Skills apply to the `answer` and `itinerary` tasks only. `classify` never sees them. `extractDays` always gets the travel-leg rule, never a skill body.
- A `load_skill` result lasts for that model call only. It is never written to `state.toolResults`, never compacted, never truncated.
- With an always skill loaded, travel times, walking distances and transfers may be estimated and must be marked "约" / "approx.". Prices, availability, addresses and specific opening hours are still never invented.
- Size budget: the core body ≤ ~3000 tokens (enforced as ≤ 9000 characters), each city body ≤ ~1500 tokens (≤ 4500 characters).
- Python scripts are placeholders: comments only, never executed, and not mentioned in any SKILL.md.
- `skills/` is resolved with `new URL('../../skills/', import.meta.url)`. This works from `src/skills/` and from `dist/skills/`, the same way as `src/config/load-langchain-config.ts`.
- No Deep Agents or other agent framework. The existing `streamToolLoop` stays the only tool loop.
- Commits use conventional scopes (`feat(chat): …`). The body says what changed, why, and what was verified (and what was not). It carries exactly one `Co-Authored-By` trailer.

## Review Focus

1. **Missing `skills/` dir, or one malformed `SKILL.md`.** Startup continues, and the other skills still load. Pinned in Task 1.
2. **Model calls `load_skill` with an unknown name, or a mix of known and unknown names.** Known bodies are returned, and an error line lists the available names. Nothing throws. Pinned in Task 2.
3. **A skill body longer than `MAX_RESULT_LENGTH` (12 000), or one containing JSON-looking text.** The `load_skill` output reaches the model unmodified. Pinned in Task 2.
4. **`load_skill` crowding out hotel searches** (`MAX_TOOL_ROUNDS = 4`). The prompt asks for it in the first round alongside the searches. The live check asserts both happened. Pinned in Task 5.
5. **No skills at all** (empty registry). The system prompt and bound tools stay as they are today. Pinned in Task 3.

---

### Task 1: Skill registry

**Files:**
- Create: `services/chat/src/skills/registry.ts`
- Test: `services/chat/src/skills/registry.spec.ts`

**Interfaces:**
- Produces:
  - `interface Skill { name: string; description: string; always: boolean; body: string }`
  - `parseSkill(text: string): Skill`. Throws on missing or invalid frontmatter.
  - `loadSkills(root?: URL | string): Skill[]`. `root` defaults to `SKILLS_ROOT`. Synchronous, so the Nest factory can call it. Sorted by name.
  - `export const SKILLS_ROOT: URL`

- [ ] **Step 1: Write failing tests** in `registry.spec.ts` (temp dirs via `fs.mkdtempSync(os.tmpdir())`):
  - `parses frontmatter and body`: for `---\nname: japan-travel\ndescription: Plan Japan trips\nalways: true\n---\n# Rules\n`, `parseSkill(text)` returns `{ name: 'japan-travel', description: 'Plan Japan trips', always: true, body: '# Rules\n' }`.
  - `defaults always to false`: the same text without `always` gives `always: false`.
  - `accepts CRLF line endings`: the first test's text with `\n` replaced by `\r\n` parses to the same name.
  - `rejects a file without frontmatter or with an empty name`: `expect(() => parseSkill('# no frontmatter')).toThrow()`, and the same for `name: ''`.
  - `loads every valid skill and skips a malformed one`: a temp root with `a/SKILL.md` (valid), `b/SKILL.md` (`garbage`) and `c/` (no `SKILL.md`) gives `loadSkills(root).map(s => s.name)` equal to `['a']`.
  - `returns no skills when the root does not exist`: `loadSkills(join(tmp, 'missing'))` equals `[]`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `bunx vitest run src/skills/registry.spec.ts` (in `services/chat`)
Expected: FAIL, cannot resolve `./registry.js`.

- [ ] **Step 3: Implement `registry.ts`**
  - Split the frontmatter on the leading `---\n…\n---\n` block, accepting `\r\n` too, because the repo is checked out on Windows.
  - Parse it with `js-yaml` `load`, then validate with a zod object:
    - `name`: non-empty
    - `description`: non-empty
    - `always`: boolean, default `false`
  - `loadSkills` reads each subdirectory's `SKILL.md`. On failure it logs with Nest `Logger` (`new Logger('Skills').warn(...)`) and skips that skill. A missing root returns `[]`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bunx vitest run src/skills/registry.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**: `feat(chat): load file-based skills from services/chat/skills`

---

### Task 2: `load_skill` tool and unrecorded tools in the loop

**Files:**
- Create: `services/chat/src/skills/load-skill-tool.ts`
- Modify: `services/chat/src/trip/tool-loop.ts` (`LoopEvent`, `streamToolLoop` signature, the tool-call branch)
- Test: `services/chat/src/skills/load-skill-tool.spec.ts`, `services/chat/src/trip/tool-loop.spec.ts`

**Interfaces:**
- Consumes: `Skill` (Task 1).
- Produces:
  - `export const LOAD_SKILL = 'load_skill'`
  - `loadSkillTool(skills: Skill[]): StructuredToolInterface`. Schema `{ names: z.array(z.string()).min(1) }`.
    - It returns each known body as `Skill <name>:\n<body>`, joined by blank lines.
    - Unknown names add a line `Unknown skill "<name>". Available: <comma-separated names>`.
    - It never throws.
  - `LoopEvent` `tool_call` gains `args`: `{ type: 'tool_call'; name: string; args: Record<string, unknown> }`. `turn.ts` ignores it. The live check (Task 5) reads it to see which skills were loaded.
  - `streamToolLoop(model, tools, messages, signal, maxRounds = MAX_TOOL_ROUNDS, unrecorded: ReadonlySet<string> = new Set())`.

- [ ] **Step 1: Write failing tests**
  - `load-skill-tool.spec.ts`, with two fixture skills `japan-tokyo` and `japan-osaka`:
    - `returns the requested bodies`: `invoke({ names: ['japan-tokyo', 'japan-osaka'] })` contains both bodies, in that order.
    - `names the available skills for an unknown name`: `invoke({ names: ['japan-tokyo', 'x'] })` contains the Tokyo body, `Unknown skill "x"` and `japan-osaka`.
  - `tool-loop.spec.ts` (follow the file's existing fake-model style):
    - Update the existing expectation `{ type: 'tool_call', name: 'searchHotels' }` to include the call's `args`.
    - `runs an unrecorded tool without recording its result`: a fake model calls `load_skill` in round 1 and answers with text in round 2.
      - The events contain `{ type: 'tool_call', name: 'load_skill', args }` and no `tool_results` event.
      - The ToolMessage the model sees in round 2 has `content` exactly equal to the tool's raw output.
    - Same test, a second body: a raw output of `'x'.repeat(13_000) + '{"a":1}'` arrives untruncated and uncompacted.

- [ ] **Step 2: Run them and confirm they fail**

Run: `bunx vitest run src/skills/load-skill-tool.spec.ts src/trip/tool-loop.spec.ts`
Expected: the new tests and the updated `tool_call` expectation FAIL. The other existing tests PASS.

- [ ] **Step 3: Implement**
  - Create `load-skill-tool.ts` with LangChain `tool()`, like `showResultsTool`.
  - In `streamToolLoop`, yield `args: call.args` on every `tool_call`.
  - Add a branch for a call whose name is in `unrecorded`. It does three things:
    - invokes the tool with the same try/catch as the existing branch;
    - pushes a `ToolMessage` with the raw string output;
    - skips `toResult`, `results.push` and the `tool_results` yield.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bunx vitest run src/skills src/trip/tool-loop.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**: `feat(chat): add load_skill tool, kept out of stored tool results`

---

### Task 3: Wire skills into `ModelTripLlm`

**Files:**
- Modify: `services/chat/src/trip/llm.ts` (`systemPrompt`, `ModelTripLlm` constructor/`respond`/`extractDays`)
- Modify: `services/chat/src/trip/trip.module.ts:15` (`new ModelTripLlm(mcp, loadSkills())`)
- Modify: `services/chat/scripts/test-trip-live.ts:12` (same constructor change)
- Test: `services/chat/src/trip/llm.spec.ts`

`TripLlm`, `turn.ts` and `fake-llm.ts` do not change: no new parameter is needed now that nothing depends on the destination.

**Interfaces:**
- Consumes:
  - `Skill`, `loadSkills` (Task 1)
  - `loadSkillTool`, `LOAD_SKILL`, the `unrecorded` parameter (Task 2)
- Produces: `new ModelTripLlm(mcp?: McpService, skills: Skill[] = [])`

- [ ] **Step 1: Write failing tests** in `llm.spec.ts`.
  - Extend the mock so `bindTools(tools)` records the tool names in `model.bound`.
  - Use two fixture skills:
    - core: `{ name: 'japan-travel', description: 'Japan rules', always: true, body: 'JAPAN-RULES' }`
    - city: `{ name: 'japan-tokyo', description: 'Tokyo (东京)', always: false, body: 'TOKYO-NOTES' }`
  - Tests:
    - `puts always skills into the answer and itinerary prompts`: for both tasks, `model.seen[0][0].content` contains `JAPAN-RULES` and `approx`, and does not contain `TOKYO-NOTES`.
    - `lists on-demand skills and binds load_skill`: the system content contains `japan-tokyo: Tokyo (东京)`, and `model.bound` contains `load_skill`.
    - `keeps the prompt and tools unchanged without skills`: with `new ModelTripLlm(undefined, [])`,
      - the system content still contains `Never invent prices, availability, addresses or distances` and contains none of `Skill `, `load_skill`, `approx`;
      - `model.bound` equals `['show_results']`.
    - `does not bind load_skill when every skill is always`: with only the core skill, `model.bound` excludes `load_skill`.
    - `never gives skills to classify`: the classify system message lacks `JAPAN-RULES` and `japan-tokyo`.
    - `tells extraction that travel legs are not stops`: the `extractDays` system message contains `Travel legs`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `bunx vitest run src/trip/llm.spec.ts`
Expected: the new tests FAIL, the existing four PASS.

- [ ] **Step 3: Implement**
  - `systemPrompt(task, locale, always: Skill[], onDemand: Skill[])`:
    - With `always` non-empty, replace the `Never invent prices…distances…` line with exactly: `Never invent prices, availability, addresses or opening hours; only state facts that come from tool results. Travel times, walking distances and transfers may be estimated when no tool gives them; mark every estimate as approximate ("约" in Chinese, "approx." in English).`
    - Append each always body after the task block as `\n\nSkill ${name}:\n${body}`.
    - With `onDemand` non-empty, append the following, then one `- ${name}: ${description}` line per skill:

      ```
      Skills you can load with load_skill (load every skill for a city you plan in, including day trips, before writing about it; call it in your first round together with any searches):
      ```

    - With both empty, the output is identical to today's.
  - Constructor: split `skills` once into `always` / `onDemand`.
  - `respond`: bind `loadSkillTool(onDemand)` and pass `new Set([LOAD_SKILL])` as `unrecorded`, only when `onDemand` is non-empty. Also pass the tool in the `tools` array so the loop can invoke it.
  - `extractDays`: always add the line `Travel legs (train, subway, bus, walking between places) are not stops; put them in the note of the stop they lead to.`

- [ ] **Step 4: Run the service unit suite**

Run: `bun run test` (in `services/chat`), then `bun run typecheck` and `bun run lint` from the repo root.
Expected: all PASS.

- [ ] **Step 5: Run the integration tests that build the turn service**

Run: `bunx vitest run --config vitest.config.int.ts src/trip/turn.int.spec.ts`
Expected: PASS. It needs `.env.test` and the test DB. If the DB is unavailable, say so in the commit body.

- [ ] **Step 6: Commit**: `feat(chat): load skills into trip prompts`. Grep `new ModelTripLlm(` first; every site is changed in this commit.

---

### Task 4: The Japan skills

**Files:**
- Create:
  - `services/chat/skills/japan-travel/SKILL.md`
  - `services/chat/skills/japan-travel/scripts/traffic_routes.py`
  - `services/chat/skills/japan-travel/scripts/restaurants_info.py`
  - `services/chat/skills/japan-{tokyo,kyoto,osaka,nara}/SKILL.md`
- Test: `services/chat/src/skills/japan-travel.spec.ts`

**Interfaces:**
- Consumes: `loadSkills`, `SKILLS_ROOT` (Task 1).

- [ ] **Step 1: Write failing tests** in `japan-travel.spec.ts`, against the real `SKILLS_ROOT`:
  - `ships the core and city skills`: `loadSkills().map(s => s.name)` contains `japan-travel`, `japan-tokyo`, `japan-kyoto`, `japan-osaka`, `japan-nara`.
  - `only the core skill is always loaded`: `japan-travel` has `always: true`, and every `japan-` city has `always: false`.
  - `names match their folders`: the name of each skill equals its directory name.
  - `city descriptions name the city in Chinese and English`: e.g. the Tokyo description contains `Tokyo` and `东京`.
  - `stays within the prompt budget`: core `body.length <= 9000`, each city `<= 4500`.
  - `does not mention the placeholder scripts`: no body contains `.py`.
  - `uses the fixed section headings`: the core body contains `总览`, `出发前要办`, `Overview` and `Before you go`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `bunx vitest run src/skills/japan-travel.spec.ts`
Expected: FAIL, no Japan skills.

- [ ] **Step 3: Write the skills.** All bodies in English, because the reply language comes from the existing locale line.
  - **Core `japan-travel/SKILL.md`**:
    - Frontmatter: `name: japan-travel`, a one-line `description`, `always: true`.
    - Body, in three parts:
      - **(a) Output standard**: the spec's 8 items, with the headings `总览` / `出发前要办` in zh and `Overview` / `Before you go` in en.
      - **(b) Planning rules**: the spec's groups, including:
        - the opening-hours hedging rule
        - "hotels only from tool results"
        - "load the city skills for every city and day trip before planning it"
      - **(c) Format sample**: a condensed version of the spec's 6-day example (Day 1 and Day 6 are enough), with the hotel line marked as a placeholder.
    - No city-specific detail (areas, airport lines, local passes) beyond what the sample needs. That belongs in the city skills.
  - **City skills** (`japan-tokyo`, `japan-kyoto`, `japan-osaka`, `japan-nara`):
    - Frontmatter `description`: one line naming the city in English and Chinese and what it covers, e.g. `Tokyo (东京): areas, airports, transit, day trips, reservations, seasons`.
    - Body sections, as in the spec: areas and which go together, getting in and out, getting around, day trips, reservations and crowds, seasons.
    - Only what differs for that city; do not repeat core rules. No exact opening hours or prices. General patterns are hedged ("usually…, please check").
  - **Python files**: a module docstring only, saying what the script will fetch later (routes between two places / restaurants near a place) and the planned JSON stdin→stdout shape, plus `raise SystemExit("not implemented")`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bunx vitest run src/skills`
Expected: PASS.

- [ ] **Step 5: Commit**: `feat(chat): add japan-travel core and city skills`

---

### Task 5: Live check

**Files:**
- Modify: `services/chat/scripts/test-trip-live.ts`
- Possibly modify: `services/chat/config/langchain.yaml` (`maxTokens`), `services/chat/src/trip/tool-loop.ts` (`MAX_TOOL_ROUNDS`)

- [ ] **Step 1: Replace the Hangzhou cases with Japanese destinations.** Keep every existing check and its label:
  - overnight: zh `帮我规划大阪亲子游，2026-12-01 到 2026-12-03，4 个人` / en `Plan a family trip to Osaka, 2026-12-01 to 2026-12-03, 4 people`
  - same-day: zh `奈良一日游，2026-12-01 当天往返，1 个人，个人游` / en `Solo day trip to Nara on 2026-12-01, back the same day, 1 person`
  - hotel question: zh `京都站附近 1000 元以内的酒店` / en `Hotels near Kyoto Station under 1000 CNY`
  - the vague case stays as it is.

- [ ] **Step 2: Add the Tokyo-in, Osaka-out case.**
  - In `turn()`, collect the names from every `tool_call` event whose `name` is `load_skill` (from `args.names`) and return them as `loaded`.
  - Request:
    - zh: `帮我规划日本情侣游，东京进大阪出，2026-12-01 到 2026-12-06，2 个人`
    - en: `Plan a couple's trip to Japan, fly into Tokyo and out of Osaka, 2026-12-01 to 2026-12-06, 2 people`
  - Checks:
    - `${locale}: japan trip reaches review` (stage `review`, effect `itinerary`)
    - `${locale}: japan trip loads the city skills`: `loaded` contains `japan-tokyo` and `japan-osaka`
    - `${locale}: japan trip still finds stays`: `next.stays` has items
    - `${locale}: japan draft has overview and before-you-go`: the draft contains the locale's two headings
    - `${locale}: japan draft marks estimates`: zh `/约/`, en `/approx/i`
    - `${locale}: japan draft covers every day`: `next.days.length >= 6`
    - `${locale}: travel legs are not stops`: no stop name matches `/(线|新干线|Line|Shinkansen|Skyliner|Haruka|→)/`

- [ ] **Step 3: Run the live check**

Run: `bun run scripts/test-trip-live.ts` (in `services/chat`, real `.env`)
Expected: every check prints `PASS`.

- [ ] **Step 4: Fix by symptom, then re-run Step 3.**
  - `loads the city skills` fails: strengthen the `load_skill` instruction in the core skill and the list header. Do not add a server-side fallback.
  - `still finds stays` fails because the rounds ran out: set `MAX_TOOL_ROUNDS = 5` and update nothing else. The existing `stops after MAX_TOOL_ROUNDS` test reads the constant.
  - `covers every day` fails because the draft is cut off (it ends mid-day):
    1. Set `llm.maxTokens: 8192` in `config/langchain.yaml`.
    2. If it still fails, tighten the core skill's detail rules (for example, write full transit lines only for city changes and airport legs), then re-run the Task 4 tests too.

- [ ] **Step 5: Manual review.** Print one zh Tokyo→Osaka draft and check it against the spec's 8-item acceptance list. Record any item it misses in the commit body.

- [ ] **Step 6: Commit**: `test(chat): live-check Japan itineraries against the skills`. The body lists:
  - the live-check results
  - any `maxTokens` / `MAX_TOOL_ROUNDS` change
  - the manual review notes
