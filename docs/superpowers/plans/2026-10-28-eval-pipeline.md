# Model output evaluation pipeline (Langfuse)

> Implementation plan. Scope: `services/chat` plus a self-hosted Langfuse instance. No changes to the API contracts (`packages/contracts`) or the frontend.
> Goal: after changing a prompt, model or parameter, run once on a fixed dataset and compare against a baseline. The comparison shows the change in each metric, the cases that got worse, and cost and latency.
> Prerequisite: `fdb929d` (LLM call metering) is on the branch.

## 0. Current state (read first)

| Item | What is there |
|---|---|
| Calls under evaluation | `src/trip/llm.ts`: `classify()` (structured output), `respond(task)` (streaming + MCP tool loop, `answer` / `itinerary`), `extractDays()` (structured output). All three implement the `TripLlm` interface |
| Existing checks | `scripts/test-trip-live.ts`: 5 scenarios each in zh and en. They are hardcoded, run once, depend on live MCP, and only report PASS/FAIL. Its `turn()` and assertions can be reused |
| Dates in the prompt | `systemPrompt()` says `Today is ${new Date()…}`, and the cases hardcode dates (2026-12-xx). Both make results change over time |
| Model parameters | `createChatModel()` already accepts `options.model`. Temperature, thinking and maxTokens only come from `config/langchain.yaml`, and `loadLangChainConfig()` has a hardcoded path |
| Tools | All MCP tools go through `McpManager.getTools()` / `callTool()` (`src/llm/mcp/manager.ts`). `ModelTripLlm` only uses `mcp.mcpManager.getTools()` |
| Cost | `LlmMeteringHandler` records usage and cost on every chat model run; `LlmTotals` in `trace-context.ts` sums them per context |
| Existing fixture | `src/llm/mcp/rollinggo.fixture.ts` (a single hotel result; a reference for the replay format) |
| Langfuse | Not integrated |
| Runtime | Bun 1.4.2; local Node 22.17 (`@langfuse/otel` requires Node ≥ 22) |

## 1. Who does what: Langfuse vs. the repo

| Responsibility | Where | Why |
|---|---|---|
| Source datasets | Repo: `services/chat/evals/datasets/*.jsonl` | Code review, evolves with the prompts, has git history |
| Dataset copies, experiment runs (dataset runs), a trace per output, scores, a UI for comparing runs | Langfuse | No UI to build; traces show every round of tool calls |
| Graders (code checks and LLM judge) | Repo: `evals/evaluators/` | Versioned and unit-testable; pairwise comparison needs the baseline output, which Langfuse's managed judges can't use |
| Regression decision (worse than baseline?) | Repo: runs write local JSON, `eval:compare` decides | Gives CI an exit code without depending on Langfuse being up |
| Human labeling, calibration, spot checks | Langfuse annotation queue + score configs | Ready-made labeling UI |

Langfuse Prompt Management is not used. Prompts stay as constants in `llm.ts` and versions are compared with git: run once on `main` as the baseline, then once on the branch.

## 2. Phases and order

| Phase | Content | What it enables |
|---|---|---|
| P0 | Deploy Langfuse + get the SDK working under Bun | Traces are visible |
| P1 | Reproducible runs: injected clock, overridable config, MCP record and replay | Repeated runs of the same input differ only because of the model |
| P2 | Datasets and graders for L1 `classify` and L2 `extractDays`, plus runner and compare | Changes to classify and extraction prompts are measurable |
| P3 | L3 itineraries: move the live-check assertions into graders, add budget, pacing and geographic checks | Changes to itinerary prompts or skills are measurable |
| P4 | LLM judge (per-criterion checklist + pairwise) + human calibration | Subjective quality gets a trustworthy score |
| P5 | Production trace spot checks and online signals (optional) | Data flows back into the datasets |

Do P0–P2 first, review the results, then decide whether to continue with P3 and later.

---

## P0. Langfuse deployment and SDK

1. **Self-host** with the official docker compose (v3 needs Postgres, ClickHouse, Redis and MinIO/S3); do not reuse the app database. Put the setup steps in `services/chat/evals/README.md`; don't commit the compose file. Self-hosting is the default because traces contain user input and itineraries.
2. Dependencies (`services/chat`): `@langfuse/client`, `@langfuse/tracing`, `@langfuse/otel`, `@langfuse/langchain`, `@opentelemetry/sdk-node`.
3. Env vars go in `services/chat/.env.eval` (gitignored, with a `.env.eval.example`): `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, plus the keys the model and MCP servers need.
4. New `evals/instrumentation.ts`: `new NodeSDK({ spanProcessors: [new LangfuseSpanProcessor()] }).start()`, exporting `shutdown()`. The runner must call `shutdown()` before exiting, or traces are never sent.
5. **Spike (do first, half a day)**: under Bun, confirm three things:
   - NodeSDK and `LangfuseSpanProcessor` report traces;
   - the `CallbackHandler` from `@langfuse/langchain` and the existing `LlmMeteringHandler` can both be attached to one model;
   - the traces created by `dataset.runExperiment()` contain the LLM calls and tool calls.

   If any of these fails, run the eval scripts with Node + tsx (the app itself stays on Bun) and record that decision in this file.
6. **The production service does not use Langfuse yet**; that is decided in P5. `createChatModel()` attaches an extra Langfuse handler only during evals, through a parameter:

   ```ts
   export function createChatModel(options: { model?: string; operation?: string; callbacks?: BaseCallbackHandler[] } = {})
   ```

   `ModelTripLlm` gets an optional `callbacks` constructor argument and passes it to `createChatModel`.

Acceptance: a classify trace with token usage is visible in Langfuse.

**Outcome (2026-10-29): done.** `bun run eval:spike` passes all three checks under Bun 1.4.2, so evals stay on Bun.

Findings that differ from the assumptions above:

- Langfuse v4 is self-hosted locally, and the JS SDK is 6.0.2.
- Read traces with `client.api.observations.getMany({ traceId })`; there is no `traces.get()`. The run URL is `result.experimentUrl`.
- `streamToolLoop` invokes tools outside the model run, so MCP tools only show up in the trace when the handler is also set on `tool.callbacks`. The P2 runner must do this, and `ReplayMcp` (P1) should accept callbacks.
- Setup is in `services/chat/evals/README.md`. Langfuse's Postgres is on 5433 and Redis on 6380, because the app's Postgres uses 5432.

## P1. Reproducibility

### 1.1 Injected clock
`ModelTripLlm`'s constructor gets `options.today?: string` (`YYYY-MM-DD`), and `systemPrompt()` uses it instead of `new Date()`. The default is still the real date. Every dataset case carries a `today`, and its dates are absolute dates relative to that `today`, so cases never expire.

### 1.2 Overridable config
`loadLangChainConfig()` reads the env var `LANGCHAIN_CONFIG` (a path relative to `services/chat`) and falls back to `config/langchain.yaml`. To evaluate a model or parameter variant, create `evals/configs/<name>.yaml` and run with `LANGCHAIN_CONFIG=evals/configs/<name>.yaml`. Add tests to the config spec.

### 1.3 MCP record and replay (`evals/replay/`)
- `ReplayMcp` implements the `{ mcpManager: { getTools() } }` shape that `ModelTripLlm` uses. Its tool names and argument schemas must match the real tools exactly (record the schemas too).
- **Record mode**: wrap the real tools and write `{ tool, args, result }` to `evals/cassettes/<suite>/<caseId>.json` (committed).
- **Replay mode** (default): match exactly on tool name + normalized args (sorted keys, empty values dropped). On a miss, fall back to the first recording for the same tool and give the case a `replay_miss=1` score instead of failing it. Prompt changes often shift the model's arguments slightly; this score says "re-record".
- Run `bun run eval:record <suite> [caseId]` only for new cases or when `replay_miss` is high.
- Live MCP regressions stay the job of `scripts/test-trip-live.ts`, unchanged.

Acceptance: replaying one case 3 times at temperature 0 gives the same tool call sequence (apart from the model's own variance), and replay sends no network requests to MCP.

**Outcome (2026-10-29): done.**

- `ModelTripLlm` takes `{ today }`, and its MCP parameter is narrowed to `McpToolSource` (`{ mcpManager: { getTools() } }`).
- `LANGCHAIN_CONFIG` selects the config file.
- `evals/replay/` has `recordMcp`, `ReplayMcp` (with `misses`) and the cassette schema.
- Datasets don't exist yet, so P1 ships `bun run eval:replay-check [--record]` with one built-in case (Kyoto hotel question, zh) instead of `eval:record <suite>`. That command moves to P2.
- Results:
  - The recorded cassette `evals/cassettes/p1/kyoto-hotels.json` has one `searchHotels` call.
  - The replay check passed: 3 runs on DeepSeek at temperature 0 gave identical tool calls and no misses.
  - Replay mode never constructs `McpService`, so it makes no MCP network calls.
- Cassettes contain RollingGo's opaque `nextPageToken`, which is harmless, but review cassettes before committing in case a future server echoes something sensitive.

## P2. L1 / L2 + runner

### 2.1 Layout

```
services/chat/evals/
  README.md
  instrumentation.ts
  schemas.ts            # Zod schema for each suite's dataset entries (validated once, when reading JSONL)
  datasets/classify.jsonl  extract-days.jsonl  itinerary.jsonl
  cassettes/…
  configs/…
  evaluators/classify.ts extract-days.ts itinerary.ts judge.ts (+ *.spec.ts)
  replay/
  run.ts  sync.ts  compare.ts
  results/              # gitignored
```

Check that `tsconfig` and oxlint cover `evals/`, and that `nest build` does not bundle it.

### 2.2 Sync and run
- `bun run eval:sync <suite>`: upsert the JSONL entries into the Langfuse dataset `trip-<suite>`. The item id is the JSONL `id`; entries removed from the JSONL are archived in Langfuse.
- `bun run eval <suite> [--trials 3] [--tag name] [--concurrency 4]`:
  - Use `langfuse.dataset.get('trip-<suite>')`, then call `dataset.runExperiment({ name, runName, task, evaluators, runEvaluators, maxConcurrency, metadata })`.
  - `runName` = `<suite>@<git short sha>[-dirty][-tag]#<trial>`; each trial is its own run.
  - `metadata`: model, temperature, thinking, config file, the first 8 hex chars of each prompt constant's sha256, and `today`.
  - Each case's task runs in its own trace context; read `cost_usd`, `input_tokens`, `output_tokens` and `latency_ms` from `LlmTotals` and report them as scores.
  - Write `evals/results/<runName>.json` locally: an output summary and all scores for each case.
- `bun run eval:compare <base-prefix> <cand-prefix>`:
  - Read the local results and average across trials.
  - Print each metric's baseline value, candidate value and delta; list cases that passed in the baseline and fail in the candidate.
  - Exit with code 1 when a threshold in `evals/thresholds.json` is crossed.

### 2.3 L1 classify (~120 cases, half zh, half en)
Entry shape: `{ id, today, locale, state: { stage, requirements }, history: [{ role, text }], text, expected: { intent, patch, clarifyField | null } }`.

Categories (at least 6 cases each):
- full requirements in one message
- adding some fields
- changing an existing field
- hotel, flight and place questions (should be `chat`)
- vague requests (should clarify)
- date roles (only a return date given)
- budget currency (stated / not stated)
- edge values for traveler count
- mixed zh/en
- injection in the history ("ignore previous instructions")

Graders (all code checks):
- `intent_acc`
- `patch_exact`: exact match per field, also reporting per-field accuracy
- `patch_hallucination`: the share of fields expected to be null that were filled in. **This is the most important metric.**
- `clarify_recall` / `clarify_precision`

### 2.4 L2 extractDays (~30 cases)
Input is a draft plus stays. Drafts come from real runs: the live check with `PRINT_DRAFT=1` and drafts saved during P3 recording, covering zh and en, single-city, multi-city and day trips. Expected days are labeled by a person.

Graders:
- `day_count_exact`
- `stop_f1`: on normalized place names (whitespace removed, full-width/half-width unified, bracketed original names dropped)
- `stay_ref_acc`
- `leg_as_stop`: reuses the live check's regex

### 2.5 Tests
Every grader gets a `*.spec.ts` that asserts concrete inputs against expected scores, without re-implementing the grading logic in the test. The runner and compare each run one case end to end with the fake LLM (`fake-llm.ts`).

Acceptance:
- Baselines for classify and extract-days on `main`, 3 trials each.
- After deliberately breaking one classify rule, `eval:compare` names the cases that got worse and exits with code 1.
- The two sets of runs can be compared in Langfuse.

**Outcome (2026-10-30): done, datasets need human review.**

What shipped:

- `eval`, `eval:sync` and `eval:compare` work.
- A failed task is kept as a zero-scored item with `task_error=1` (gated at `maxRise: 0`) instead of aborting the run.
- Free-text fields (destination, preferences, stop names) match by containment after normalization, not by exact string.

Datasets:

- **classify**: 120 entries drafted by Codex, 10 per category, 5 zh + 5 en each. Many read template-like ("出行人数1"), and the expected values are unreviewed.
- **extract-days**: 10 real drafts from live itinerary runs (`evals/drafts/`), labeled by Codex with a note per judgment call, plus 2 synthetic entries.
  - The two zh "朋友出游" requests never reached an itinerary: classify left tripType empty.
  - The MCP calls from those runs are saved in `evals/cassettes/itinerary/` for P3.

Baselines (`*@accc65d-dirty-baseline`, 3 trials each, DeepSeek flash, temperature 0):

| Suite | Metric | Value |
|---|---|---|
| classify | intent_acc | 0.91 |
| classify | patch_exact | 0.80 |
| classify | patch_hallucination | 0.03 |
| classify | clarify_match | 0.91 |
| classify | clarify_recall | 1.00 |
| classify | clarify_precision | 0.49 |
| classify | departureDate | 0.76 |
| classify | returnDate | 0.84 |
| classify | relative_date category, patch_exact | 0 |
| classify | cost per call | ~$0.00024 |
| extract-days | day_count_exact | 1.00 |
| extract-days | stop_f1 | 0.74 |
| extract-days | stay_ref_acc | 1.00 |
| extract-days | leg_as_stop | 0 |

Regression check: removing "only values the user explicitly stated" from CLASSIFY_PROMPT gave patch_hallucination 0.03 → 0.10, patch_exact −0.09 and clarify_precision −0.28. `eval:compare` flagged the regressed items and exited 1, and the prompt was reverted.

Findings for follow-up (each is a candidate experiment for the pipeline):

1. **Relative dates fail completely.** CLASSIFY_PROMPT has no date in it, so "下周五" can't be resolved. Fix candidate: add `Today is …` to the classify system message. (Codex added this unasked; it was reverted so the baseline measures current behavior.)
2. **Intermittent `classify` crash.** One trial in an early run returned 6 clarify options, more than `ClarifySchema`'s max of 5, so parsing failed. In the app, that turn errors out.
3. **clarify_precision 0.49.** The model asks for clarification on about half the items whose label expects none. Either the model over-asks or the labels are too strict; review the labels first.
4. **extractDays stops.** The model makes the arrival airport and the hotel into stops, and the extraction prompt doesn't say whether they count. Decide the rule, then put it in the prompt.
5. **"朋友出游" doesn't map to a trip type** (see Datasets above).

**Follow-up fixes (2026-10-30).** The labels were reviewed (by Claude, not yet by a person), the datasets grown, and the gates sized from measured noise. Then each fix ran as its own experiment and was compared with the step before it.

Datasets:

- **classify** has 132 entries (66 zh / 66 en):
  - form-like texts are rewritten;
  - follow-up states match their history;
  - labels count direct implications and named currencies;
  - new categories: `trip_type`, `natural_date`, and `chat_place` (questions that name a place).
- **extract-days** has 22 entries, 20 of them real drafts, relabeled with the stop rules in `evals/README.md`.

Gates: an A/A test (`base-a` and `base-b`, 3 trials each) showed little noise. Most fields never flipped, and stop_f1 had a standard deviation of 0.005. Gates were widened only where the noise needs it:

| Metric | Gate | Why |
|---|---|---|
| intent_acc | 0.03 | measured noise |
| clarify_match | 0.03 | measured noise |
| clarify_precision | 0.03 | measured noise |
| clarify_recall | 0.10 | measured noise |
| patch_field_preferences | 0.25 | only 4 items |

`bun run eval:noise` recomputes them.

classify experiments. Each row is cumulative and compared with the row above; values are 3-trial means over the same 128 items.

| Step | Change | intent_acc | patch_exact | clarify_precision | Result |
|---|---|---|---|---|---|
| `base-a` | none | 0.92 | 0.87 | 0.36 | 1 crash in 384 calls (6 clarify options) |
| `date` | `Today is …`; resolve relative and yearless dates | 0.92 | 0.97 | 0.44 | natural_date 0 → 1, but 7 items regressed (see below) |
| `clarify` | clarify only for unconfirmed inferences or requested suggestions; extra options trimmed to 5 | 0.96 | 0.99 | 1.00 | recall stays 1.00, no regressions |
| `rules` | `plan` whenever patch has a value; direct implications; named currency → ISO code | 1.00 | 0.95 | 1.00 | gate failed (see below) |
| `rules2` | implications narrowed to solo, couple, "just me" and 一家三口; a head count sets no other trip type | 1.00 | 0.99 | 1.00 | no regressions vs `clarify` |

- In `date`, single-detail messages such as "We've got 7 travelers" became `chat`, which drops their patch. The mean intent_acc stayed equal and hid the swap; the regressed-items list showed it.
- In `rules`, "the two of us" became a couple and a "100-person group" became friends.
- `rules2` scores `cls-en-change-05` with a corrected label: a couple's trip is 2 travelers.

`final` adds the 4 `chat_place` guard items (132 items). Results:

- intent_acc 1.00, patch_exact 0.99, clarify precision and recall 1.00, task_error 0.
- All guard items stay `chat` with an empty patch.
- Remaining misses:
  - "There are 100 travelers in our group" becomes `friends`, the same as at baseline;
  - `cls-en-full-05` once put "day trip, back that evening" into preferences.

extract-days `stops`: the extraction prompt now spells out the stop rules:

- the hotel is never a stop;
- airports count only where the trip arrives or departs;
- stations count only where a day trip or city change starts or ends;
- options and backups are not stops;
- meals count only at a named place.

stop_f1 went 0.71 → 0.84 with no regressed items, and every category rose (non_japan +0.18). The same rules wrote the labels, so this measures agreement with those rules.

Itinerary hotel line:

- **Duplicated names (fixed).** Kyoto replays wrote "京都三条格拉斯丽酒店（京都三条格拉斯丽酒店）" when a hotel had no translation. With the new wording, 3 of 3 replays name it once, and English still writes "Hotel Hankyu Respire Osaka (阪急大阪龙仕柏酒店)".
- **"3-night Kyoto, no hotels" (not reproduced).** The report did not reproduce in 12 replays; grounding kept every hotel.

Still open:

- A person should spot-check the labels.
- The baselines are `-dirty` and must be rerun from a clean commit (done: see "Clean baselines" below).

**Clarify coverage (2026-10-30).** All 10 should-ask classify items asked for a destination, so precision 1.00 said nothing about dates or trip type. 12 items were added (`vague_dates`, `vague_trip_type`): 8 should ask and 4 are near-misses that should not.

- With the `rules2` prompt (run `vague`), recall fell to 0.56:
  - vague dates were left empty but never asked about;
  - ambiguous companions were guessed into `tripType` (coworkers → business or friends; parents + girlfriend → family).
- The prompt now names three kinds of inference (destination, a season or holiday instead of days, companions that fit more than one trip type) and says to leave the inferred field null. The examples are worded differently from the eval items.
- `vague-fix` against `vague`:
  - recall 0.56 → 0.89, precision stays 1.00, patch_hallucination down;
  - all near-misses unchanged; no gate crossed; no older item regressed.
- Still failing:
  - "with a few people from work" / "和几个同事" is still treated as `business` (once `friends`);
  - "My wife and I … for our anniversary" now puts "anniversary" in preferences in 3 of 3 trials (1 of 3 before).
  - Both are label decisions: is a trip with coworkers business by default, and is an occasion a preference?
- The same compare showed `readRuns` matching by plain prefix: `…-vague` also read the `…-vague-fix` trials. It now reads the exact run name only.

**Label decisions and the coworker rule (2026-10-30).** Coworkers alone stay ambiguous; an occasion is a preference (`cls-en-vague-trip-type-03` relabeled). Three wordings of the coworker rule, each 3 trials × 144 items. Failing trials use the new labels; `vague-fix` would count 6 under them (its stored scores used the old anniversary label).

| Run | Rule placement | Failing trials | Which |
|---|---|---|---|
| `vague-fix` | none | 6 | both coworker items guess `business` (3/3 each) |
| `coworkers` | own sentence in clarify: "coworkers alone are such companions…" | 7 | coworkers fixed; parents + girlfriend guesses `family` 2/3; two suggestion requests stop asking 3 of 6; full-05 1/3 |
| `coworkers2` | in clarify's companions list | 6 | coworkers ask 3/3; "Help me choose where to go…" never asks; "I'm vegetarian…" becomes `chat` and drops the preference (both 3/3) |
| `coworkers3` (kept) | in patch, next to "a head count alone sets no other trip type" | 8 | coworkers leave `tripType` null but don't ask (3/3 each); full-05 adds "day trip" 2/3 (flaky since the baseline) |

- `coworkers3` is kept although it fails the most trials, because its failures cost the least: with `tripType` null the app asks the trip type itself, only without the tailored question. `coworkers2` drops a stated preference. No gate crossed; patch_exact 0.979 → 0.995, clarify_recall 0.89 (unchanged), precision 1.00.
- Every trial within a run agreed (no flaky items apart from full-05), so 3 trials at temperature 0 measure almost no sampling noise. The noise that matters here is wording: each rewrite flipped a different borderline item that had passed in every earlier run. Judge a prompt change by the items it flips and what each failure costs, not only by the means.
- `clarify_match` now counts toward regressed items: the first wording made a suggestion request stop asking with `patch_exact` still 1, and the list missed it.
- The prompt is kept byte-for-byte as evaluated (including a short line), since reflowing it would change the prompt that was measured.
- Live check on the kept prompt: 33/34 in each of two runs, failing a different reply-path check each time; every classify check passed. (1) zh hotel question showed no cards: the output tokens show DeepSeek sending invalid `show_results` JSON round after round until the 5-round limit; 5 of 5 reruns of that question showed cards, one with an empty reply. (2) The en Japan overview listed a 1-night city. The three earlier runs passed 34/34. The reply path is unchanged here; it gets measured in P3.

**Clean baselines (2026-10-30).** A/A from `3c741ab` with a clean tree and both datasets synced first, 3 trials per run. Compare later changes against `classify@3c741ab-base-a` and `extract-days@3c741ab-base-a`.

- classify (144 items): base-a and base-b gave the same verdict on every item in all six trials. intent_acc 1.00, patch_exact 1.00, patch_hallucination 0, clarify_match 0.986, clarify_recall 0.89, clarify_precision 1.00, task_error 0. The only misses are the two coworker items, which leave `tripType` null without asking, as in `coworkers3`. `cls-en-full-05` did not flake this time.
- extract-days (22 items): stop_f1 0.836 / 0.831 (sd 0.005); day_count_exact and stay_ref_acc 1.00; leg_as_stop and task_error 0. Single drafts still vary between trials (`ext-zh-single-03`: 0.72–0.93), but the mean barely moves.
- `eval:noise` suggests 0.02 for every gate, and every current gate is at or above that, so `thresholds.json` is unchanged. The zero noise belongs to this prompt: earlier prompts had flaky items (the `-dirty` A/A, `cls-en-full-05` in the coworker runs), and gates must also hold for candidate prompts, so the wider gates (intent_acc, clarify_*, patch_field_preferences) stay.

## P3. L3 itineraries (itinerary / answer, 15–20 scenarios)
Entry shape: `{ id, today, locale, text, history, expected: { effect, nights, budget? }, must: string[] }`. `must` holds the case-specific requirements a person writes; it is used in P4.

Scenarios: the live check's 5 × zh/en, plus family, elderly, tight budget, multi-city, a specified lodging area, lodging already booked, and a pure hotel question.

The task runs a whole turn: `classify → reduce → respond → groundResults/mergeStays → extractDays → linkStays`, reusing the live check's `turn()`. First move `turn()` to `evals/turn.ts` and have the live check call it.

Code graders:
- **Moved from the live check**: reaches review; has stays or has none; every night linked to a hotel; skills loaded; overview and before-you-go headings; estimates marked; every day covered; travel legs are not stops; every full day has an alternatives line; every city gets at least 2 nights.
- **Grounding**: every hotel name in the draft and days must come from tool results; otherwise `invented_hotel=1`.
- **Budget**: lowest hotel price × nights ≤ budget (checked only when the budget currency is explicit).
- **Pacing**: stops per day; arrival and departure days at or below the limit for the days in between; lower limits for family and elderly trips.
- **Geography**: geocode every stop, then compute each day's total straight-line distance and the number of backtracks. A failed geocode counts as a likely invented place. Cache geocodes in `evals/geocache.json` (committed) so replay makes no network requests. **The geocoding service is undecided** (see §4).
- `tool_args_ok`: the lodging search's destination, check-in and check-out dates and traveler count match the requirements.

Acceptance: every assertion in the live check has a matching L3 grader, and the baseline pass rate on `main` matches the live check's results.

## P4. LLM judge + human calibration
1. **Judge model**: different from the model under test and stronger. Configured in `evals/configs/judge.yaml`, temperature 0.
2. **Per-criterion checklist**: the judge gets the requirements JSON, a summary of the tool results, the structured days and the draft. For each general criterion and each item in the case's `must`, it outputs `{ criterion, pass, reason }` (structured output). Score: `judge_checklist` = the share that pass, plus a score per criterion. The rubric states that length earns no credit.
3. **Pairwise**: `eval:compare --pairwise` judges the baseline and candidate outputs for the same case twice, in A/B and B/A order. It counts a win or loss only when both orders agree; otherwise it's a tie. It reports the win rate and writes the verdict to the candidate run's trace as a `pairwise_vs_base` score.
4. **Human calibration**:
   - Create Langfuse score configs: pass/fail per criterion, plus an overall preference.
   - Create an annotation queue with 30 itineraries (good and bad).
   - You label them.
   - `bun run eval:agreement` fetches the human and judge scores and computes agreement per criterion. Only criteria at ≥ 80% agreement count toward thresholds; below that, rewrite the criterion and recalibrate.
   - Re-run `eval:agreement` after changing the judge model or the rubric.
5. **Spot checks**: after each compare, automatically queue cases where the judge and the code checks disagree, cases whose pairwise verdict flipped, and 3 random cases.

Acceptance: at least 3 criteria at ≥ 80% agreement; pairwise comparison picks out a clearly worse prompt variant (win rate < 30%).

## P5. Online (optional, decided separately)
- The production service turns the handler on with `LANGFUSE_TRACING=1`, reporting only trip operations, sampled at a set rate. Before launch, decide how to handle privacy: whether to redact user text.
- Online signals from `TripState`: confirm rate (reaching `confirmed`), revisions before confirming, regenerations.
- Sessions with negative signals go into the annotation queue; confirmed problems become dataset entries.

## 3. CI
- Not run on every PR.
- When a change touches `src/trip/llm.ts`, `src/skills/**`, `config/langchain.yaml` or `evals/**`, trigger it manually or by label: run L1 + L2 (replay, 3 trials), then `eval:compare` against the latest `main` baseline.
- L3 and the LLM judge run manually, and the compare output goes in the PR description (per LESSON.md's rule on stating what was verified).

## 4. Decisions for you
1. **Self-hosted Langfuse or Cloud.** Self-hosted is the default; Cloud means itineraries and user text are stored by a third party.
2. **Judge model**: which one, different from DeepSeek.
3. **Geocoding service** (P3): Amap, Google or Nominatim, depending on coverage of Japanese place names and whether a key is needed.
4. Whether to do P5, and the sampling rate.

## 5. Risks
- Bun compatibility with the OTel NodeSDK → P0 spike; if incompatible, run the evals on Node.
- Argument drift during replay causing `replay_miss` → surfaced as a score; re-record periodically rather than fuzzy-matching.
- Labeling takes human time: ~120 L1 cases, ~30 L2 cases, plus 30 calibration itineraries in P4, mostly done by a person. A model can draft the expected values for a person to review.
- The Langfuse JS SDK APIs named here (`experiment.run` / `dataset.runExperiment`; `item.link()` removed in v6) should be rechecked against the official docs at implementation time.
