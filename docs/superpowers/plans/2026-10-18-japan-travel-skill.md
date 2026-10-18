# Japan Travel Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a file-based skill mechanism to Hilda's trip LLM and a `japan-travel` skill that is force-loaded into the system prompt when the trip destination is in Japan.

**Architecture:** `src/skills/registry.ts` reads `services/chat/skills/*/SKILL.md` (YAML frontmatter + Markdown body) once at startup. `ModelTripLlm` gets the parsed skills. Each turn it decides from `requirements.destination`:
- A destination that matches a skill: the skill body goes into the system prompt, and the facts rule allows labelled travel-time estimates.
- No destination: the prompt lists the skills, and a local `load_skill` tool is bound. The tool loop runs it without recording it in `toolResults`.
- Any other destination: the prompt and tools stay byte-identical to today.

**Tech Stack:** Bun, NestJS 12, TypeScript ESM (`.js` relative imports), LangChain core 1.x (`tool()`), zod 3, js-yaml 5 (already a dependency), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-18-japan-travel-skill-design.md`

## Global Constraints

- Skill folder: `services/chat/skills/japan-travel/` containing `SKILL.md`, `scripts/traffic_routes.py`, `scripts/restaurants_info.py`.
- No changes to `packages/contracts`, the requirements form, panels, or `clients/chat-web`.
- `trip/state.ts`, `trip/commands.ts`, `trip/view.ts` must not import the skill registry, Nest, Prisma or LangChain.
- Force-load applies to the `answer` and `itinerary` tasks only. `classify` never loads a skill. `extractDays` gets only the travel-leg rule, not the skill body.
- `load_skill` and the skill list appear only when `requirements.destination` is empty. An on-demand load lasts for that model call only: it is never written to `state.toolResults`.
- With a skill loaded, travel times, walking distances and transfers may be estimated and must be marked "约" / "approx.". Prices, availability, addresses and specific opening hours are still never invented. General patterns ("most temples close around 17:00, please check") are allowed if hedged.
- The skill body targets ≤ ~3000 tokens. Enforced as ≤ 9000 characters.
- Python scripts are placeholders: comments only, never executed, and not mentioned in SKILL.md.
- `skills/` is resolved with `new URL('../../skills/', import.meta.url)`. This works from `src/skills/` and from `dist/skills/`, the same way as `src/config/load-langchain-config.ts`.
- Commits use conventional scopes (`feat(chat): …`). The body says what changed, why, and what was verified (and what was not). It carries exactly one `Co-Authored-By` trailer.

## Review Focus

1. **Destination with odd casing or whitespace** (`"  TOKYO "`, `"日本 关西"`). It must still match. Pinned in Task 1.
2. **Missing `skills/` dir, or one malformed `SKILL.md`.** Startup continues, and the other skills still load. Pinned in Task 1.
3. **Model calls `load_skill` with an unknown name.** It gets an error text that lists the available names. The loop continues and nothing throws. Pinned in Task 2.
4. **A skill body longer than `MAX_RESULT_LENGTH` (12 000), or one containing JSON-looking text.** `load_skill` output reaches the model unmodified: not compacted, not truncated. Pinned in Task 2.
5. **Destination changes from Japan to Hangzhou mid-conversation.** The next turn's prompt has no skill body. Pinned in Task 3.

---

### Task 1: Skill registry

**Files:**
- Create: `services/chat/src/skills/registry.ts`
- Test: `services/chat/src/skills/registry.spec.ts`

**Interfaces:**
- Produces:
  - `interface Skill { name: string; description: string; match: string[]; body: string }`
  - `parseSkill(text: string): Skill`. Throws on missing or invalid frontmatter.
  - `loadSkills(root?: URL | string): Skill[]`. `root` defaults to `SKILLS_ROOT`. Synchronous, so the Nest factory can call it.
  - `matchSkills(skills: Skill[], destination: string | undefined): Skill[]`
  - `export const SKILLS_ROOT: URL`

- [ ] **Step 1: Write failing tests** in `registry.spec.ts` (temp dirs via `fs.mkdtempSync(os.tmpdir())`):
  - `parses frontmatter and body`: for `---\nname: japan-travel\ndescription: Plan Japan trips\nmatch: [Japan, 东京]\n---\n# Rules\n`, `parseSkill(text)` returns `{ name: 'japan-travel', description: 'Plan Japan trips', match: ['Japan', '东京'], body: '# Rules\n' }`. Also check `body.trim()` is non-empty.
  - `rejects a file without frontmatter or with an empty name`: `expect(() => parseSkill('# no frontmatter')).toThrow()`, and the same for `name: ''`.
  - `loads every valid skill and skips a malformed one`: a temp root with `a/SKILL.md` (valid) and `b/SKILL.md` (`garbage`) gives `loadSkills(root).map(s => s.name)` equal to `['a']`.
  - `returns no skills when the root does not exist`: `loadSkills(join(tmp, 'missing'))` equals `[]`.
  - `matches destinations case- and whitespace-insensitively`: with `match: ['Japan', 'Tokyo', '日本']`, `'  TOKYO '`, `'日本 关西'` and `'japan'` each give one match. `'Hangzhou'`, `undefined` and `''` give `[]`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `bunx vitest run src/skills/registry.spec.ts` (in `services/chat`)
Expected: FAIL, cannot resolve `./registry.js`.

- [ ] **Step 3: Implement `registry.ts`**
  - Split the frontmatter on the leading `---\n…\n---\n` block. Accept `\r\n` too, because the repo is checked out on Windows.
  - Parse it with `js-yaml` `load`, then validate with a zod object: `name` non-empty, `description` non-empty, `match` an array of non-empty strings (default `[]`).
  - Matching: `destination.trim().toLowerCase().includes(term.toLowerCase())` for any term.
  - `loadSkills` reads each subdirectory's `SKILL.md`. On failure it logs with Nest `Logger` (`new Logger('Skills').warn(...)`) and skips that skill. A missing root returns `[]`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bunx vitest run src/skills/registry.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**: `feat(chat): load file-based skills from services/chat/skills`

---

### Task 2: `load_skill` tool and unrecorded tools in the loop

**Files:**
- Create: `services/chat/src/skills/load-skill-tool.ts`
- Modify: `services/chat/src/trip/tool-loop.ts` (`streamToolLoop` signature, plus the tool-call branch around the `byName.get` call)
- Test: `services/chat/src/skills/load-skill-tool.spec.ts`, `services/chat/src/trip/tool-loop.spec.ts`

**Interfaces:**
- Consumes: `Skill` (Task 1).
- Produces:
  - `export const LOAD_SKILL = 'load_skill'`
  - `loadSkillTool(skills: Skill[]): StructuredToolInterface`. Schema `{ name: z.string() }`. It returns the body. For an unknown name it returns `Unknown skill "<name>". Available: <comma-separated names>` and does not throw.
  - `streamToolLoop(model, tools, messages, signal, maxRounds = MAX_TOOL_ROUNDS, unrecorded: ReadonlySet<string> = new Set())`.

- [ ] **Step 1: Write failing tests**
  - `load-skill-tool.spec.ts`:
    - `returns the skill body`: `await loadSkillTool([skill]).invoke({ name: 'japan-travel' })` equals `skill.body`.
    - `names the available skills for an unknown name`: output contains `Unknown skill "x"` and `japan-travel`.
  - `tool-loop.spec.ts` (follow the file's existing fake-model style):
    - `runs an unrecorded tool without recording its result`: a fake model calls `load_skill` in round 1 and answers with text in round 2.
      - The events contain `{ type: 'tool_call', name: 'load_skill' }` and no `tool_results` event.
      - The ToolMessage the model sees in round 2 has `content` exactly equal to the tool's raw output.
    - Same test, a second body: a raw output of `'x'.repeat(13_000) + '{"a":1}'` arrives untruncated and uncompacted.

- [ ] **Step 2: Run them and confirm they fail**

Run: `bunx vitest run src/skills/load-skill-tool.spec.ts src/trip/tool-loop.spec.ts`
Expected: the new tests FAIL, existing tool-loop tests PASS.

- [ ] **Step 3: Implement**
  - Create `load-skill-tool.ts` with LangChain `tool()`, like `showResultsTool`.
  - In `streamToolLoop`, add a branch for a call whose name is in `unrecorded`. It yields `tool_call`, invokes the tool with the same try/catch as the existing branch, and pushes a `ToolMessage` with the raw string output. It skips `toResult`, `results.push` and the `tool_results` yield.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bunx vitest run src/skills src/trip/tool-loop.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**: `feat(chat): add load_skill tool, kept out of stored tool results`

---

### Task 3: Wire skills into `ModelTripLlm`

**Files:**
- Modify: `services/chat/src/trip/llm.ts` (`TripLlm.extractDays`, `systemPrompt`, `ModelTripLlm` constructor/`respond`/`extractDays`)
- Modify: `services/chat/src/trip/turn.ts:102` (pass the destination)
- Modify: `services/chat/src/trip/fake-llm.ts:45` (accept and ignore the new parameter)
- Modify: `services/chat/src/trip/trip.module.ts:15` (`new ModelTripLlm(mcp, loadSkills())`)
- Modify: `services/chat/scripts/test-trip-live.ts:12` (same constructor change)
- Test: `services/chat/src/trip/llm.spec.ts`

**Interfaces:**
- Consumes: `Skill`, `loadSkills`, `matchSkills` (Task 1); `loadSkillTool`, `LOAD_SKILL`, the `unrecorded` parameter (Task 2).
- Produces:
  - `new ModelTripLlm(mcp?: McpService, skills: Skill[] = [])`
  - `TripLlm.extractDays(draft, stays, locale, signal, destination?: string)`

- [ ] **Step 1: Write failing tests** in `llm.spec.ts`. Extend the mock so `bindTools(tools)` records the tool names in `model.bound`, and `withStructuredOutput().invoke` records its messages (it already does, via `model.classify.mock.calls`). Use a fixture skill `{ name: 'japan-travel', description: 'Japan trips', match: ['Japan', '东京'], body: 'JAPAN-RULES' }`.
  - `force-loads a matching skill for itinerary and answer`: `state.requirements.destination = '东京'`.
    - For both tasks, `model.seen[0][0].content` contains `JAPAN-RULES` and contains `approx`.
    - `model.bound` excludes `load_skill`.
  - `keeps the prompt and tools unchanged for another destination`: `destination = 'Hangzhou'`. The system content and bound tool names equal those from `new ModelTripLlm(undefined, [])` for the same state. Compare with `toEqual`. Build both within the same test, so `Today is` matches.
  - `drops the skill when the destination changes away from Japan`: run a turn with `'东京'`, then with `'Hangzhou'`. The second system content lacks `JAPAN-RULES`.
  - `lists skills and binds load_skill when no destination is set`: `initialState()`. The system content contains `japan-travel: Japan trips`, and `model.bound` contains `load_skill`.
  - `adds the travel-leg rule to extraction only for a skill destination`: the `extractDays` system message contains `Travel legs` with destination `'Tokyo'`, and does not with `'Hangzhou'` or `undefined`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `bunx vitest run src/trip/llm.spec.ts`
Expected: the new tests FAIL, the existing three PASS.

- [ ] **Step 3: Implement**
  - `systemPrompt(task, locale, loaded: Skill[], available: Skill[])`:
    - With `loaded` non-empty, replace the `Never invent prices…distances…` line with exactly: `Never invent prices, availability, addresses or opening hours; only state facts that come from tool results. Travel times, walking distances and transfers may be estimated when no tool gives them; mark every estimate as approximate ("约" in Chinese, "approx." in English).`
    - Append each body after the task block as `\n\nSkill ${name}:\n${body}`.
    - With `available` non-empty, append: `Skills (call load_skill with the name before planning a trip in that area):` followed by `- ${name}: ${description}` lines.
    - With both empty, the output is identical to today's.
  - `respond`:
    - `loaded = matchSkills(this.skills, destination)`.
    - `available = destination?.trim() ? [] : this.skills`.
    - Bind `loadSkillTool(this.skills)` and pass `new Set([LOAD_SKILL])` as `unrecorded` only when `available` is non-empty.
  - `extractDays`: when `matchSkills(this.skills, destination)` is non-empty, add the line `Travel legs (train, subway, bus, walking between places) are not stops; put them in the note of the stop they lead to.`
  - `turn.ts:102` passes `next.requirements.destination`.

- [ ] **Step 4: Run the service unit suite**

Run: `bun run test` (in `services/chat`), then `bun run typecheck` and `bun run lint` from the repo root.
Expected: all PASS.

- [ ] **Step 5: Run the integration tests that build the turn service**

Run: `bunx vitest run --config vitest.config.int.ts src/trip/turn.int.spec.ts`
Expected: PASS. It needs `.env.test` and the test DB. If the DB is unavailable, say so in the commit body.

- [ ] **Step 6: Commit**: `feat(chat): force-load matching skills into trip prompts`. Grep `new ModelTripLlm(` first; every site is changed in this commit.

---

### Task 4: The `japan-travel` skill

**Files:**
- Create: `services/chat/skills/japan-travel/SKILL.md`
- Create: `services/chat/skills/japan-travel/scripts/traffic_routes.py`, `scripts/restaurants_info.py`
- Test: `services/chat/src/skills/japan-travel.spec.ts`

**Interfaces:**
- Consumes: `loadSkills`, `matchSkills`, `SKILLS_ROOT` (Task 1).

- [ ] **Step 1: Write failing tests** in `japan-travel.spec.ts`, against the real `SKILLS_ROOT`:
  - `ships a valid japan-travel skill`: `loadSkills()` contains `name === 'japan-travel'`.
  - `stays within the prompt budget`: `body.length <= 9000`.
  - `matches Japanese destinations in zh, en and ja`: each of `日本`, `Japan`, `东京`, `東京`, `Tokyo`, `京都`, `Kyoto`, `大阪`, `Osaka`, `北海道`, `Hokkaido`, `冲绳`, `沖縄`, `Okinawa`, `奈良`, `箱根`, `福冈`, `Fukuoka`, `名古屋`, `札幌` matches.
  - `does not match other destinations`: `杭州`, `Hangzhou`, `Paris`, `首尔`, `Seoul`, `Bangkok` do not match.
  - `does not mention the placeholder scripts`: the body does not contain `.py`.
  - `uses the fixed section headings`: the body contains `总览`, `出发前要办`, `Overview` and `Before you go`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `bunx vitest run src/skills/japan-travel.spec.ts`
Expected: FAIL, no `japan-travel` skill.

- [ ] **Step 3: Write `SKILL.md`**
  - Frontmatter:
    - `name: japan-travel`
    - a one-line `description`
    - a `match` list covering at least the terms tested above, plus 日本/Japan/日本国 and major regions: 关西/関西/Kansai, 关东/Kanto, 九州/Kyushu, 广岛/広島/Hiroshima, 神户/神戸/Kobe, 横滨/横浜/Yokohama. Use no Latin term shorter than 4 letters.
  - Body in English, because the reply language comes from the existing locale line. It has three parts:
    - **(a) Output standard**: the spec's 8 items. Tell the model to use the headings `总览` / `出发前要办` in zh and `Overview` / `Before you go` in en.
    - **(b) Planning rules**: the spec's seven groups, including the opening-hours hedging rule and "hotels only from tool results".
    - **(c) Format sample**: a condensed version of the spec's 6-day example (Day 1 and Day 6 are enough), with the hotel line marked as a placeholder.
  - Python files: a module docstring only, saying what the script will fetch later (routes between two places / restaurants near a place) and the planned JSON stdin→stdout shape, plus `raise SystemExit("not implemented")`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bunx vitest run src/skills`
Expected: PASS.

- [ ] **Step 5: Commit**: `feat(chat): add japan-travel skill`

---

### Task 5: Live check

**Files:**
- Modify: `services/chat/scripts/test-trip-live.ts` (add Japan cases inside the `for (const locale …)` loop)
- Possibly modify: `services/chat/config/langchain.yaml` (`maxTokens`)

- [ ] **Step 1: Add the Japan case.**
  - Request:
    - zh: `帮我规划日本情侣游，东京进大阪出，2026-12-01 到 2026-12-06，2 个人`
    - en: `Plan a couple's trip to Japan, fly into Tokyo and out of Osaka, 2026-12-01 to 2026-12-06, 2 people`
  - Checks:
    - `${locale}: japan trip reaches review` (stage `review`, effect `itinerary`)
    - `${locale}: japan draft has overview and before-you-go`: the draft contains the locale's two headings.
    - `${locale}: japan draft marks estimates`: zh `/约/`, en `/approx/i`.
    - `${locale}: japan draft covers every day`: `next.days.length >= 6`.
    - `${locale}: travel legs are not stops`: no stop name matches `/(线|新干线|Line|Shinkansen|Skyliner|Haruka|→)/`.

- [ ] **Step 2: Run the live check**

Run: `bun run scripts/test-trip-live.ts` (in `services/chat`, real `.env`)
Expected: every check prints `PASS`, including the existing Hangzhou ones.

- [ ] **Step 3: If `covers every day` fails because the draft is cut off** (it ends mid-day), set `llm.maxTokens: 8192` in `config/langchain.yaml` and re-run Step 2. If it still fails, tighten SKILL.md's detail rules (for example, write full transit lines only for city changes and airport legs), then re-run Step 2 and the Task 4 tests.

- [ ] **Step 4: Manual review.** Print one zh Japan draft and check it against the spec's 8-item acceptance list. Record any item it misses in the commit body.

- [ ] **Step 5: Commit**: `test(chat): live-check Japan itineraries against the skill`. The body lists the live-check results, any `maxTokens` change, and the manual review notes.
