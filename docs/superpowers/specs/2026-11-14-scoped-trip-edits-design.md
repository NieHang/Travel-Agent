# Scoped trip edits

Status: design (architect synthesis), 2026-11-14. Branch `feat/scoped-trip-edits`.

## Problem

A browser walkthrough of a Kyoto trip showed three problems in the planning flow:

- "Day 3 looks too tiring, can you make it lighter?" regenerated the whole trip. Day 3 got lighter, but the hotel silently changed (Gracery → MONday), days 1–2 changed, and Nishiki Market appeared twice.
- The full itinerary is the chat reply *and* the panel, and four competing hotel cards with Book buttons sit under the draft.
- Choosing a hotel in the panel only highlights it; the plan keeps the old one.

Cause: the itinerary is one markdown string (`TripState.itinerary`) that is also the chat reply; `days` and each day's hotel are re-inferred from it by a second LLM call (`extractDays`); `plan()` in `commands.ts` wipes `itinerary/days/stays` on any requirement change (pace edits are classified as a `preferences` patch), and clears `toolResults`, forcing a new hotel search. The model sees the current plan only through the previous chat reply. There is no stored unit an edit can replace while leaving the rest alone.

Constraints kept: the server owns the workflow and `render(state)` builds every component; `state/commands/view/copy` (and the new `itinerary.ts`) stay pure; hotel facts come only from cited tool results; the revision claim is released on success, stop and failure, and a failed turn keeps the old state; what is saved as assistant `content` is what the model sees next turn; stored v2 states still load; the skill-driven draft format that passes the live check today is not rewritten.

## Usage (caller's view)

```ts
// turn.ts — outer protocol unchanged
const { state: next, effect } = reduce(state, command, classified, place)
// "make day 3 lighter" → effect = { type: 'revise', target: { days: [2], nights: [] } }
const reply = effect ? yield* runEffect(this.llm, effect, { text, state: next, history }, signal) : null
await this.saveTurn(id, next, reply ?? stageMessage(next, c), render(next, c), user.createdAt)
// next.plan.days[0], [1], [3] are the same objects as before; every stayRef is unchanged
```

```tsx
// panel Hotels tab: one choice group per run of nights on the same hotel
<LiveTripPanels tab={tab} data={trip} draft={stream.draft} busy={generating} onCommand={sendCommand} />
onCommand({ type: 'choose_stay', ref: 'h3', nights: { from: 0, to: 2 } }) // ordinary turn: 409 if stale, claim, no LLM
```

```ts
// scripts/test-trip-live.ts — multi-turn
const draft = await turn(start, 'Plan a couple trip to Kyoto, 2026-11-22 to 2026-11-25, 2 people')
const lighter = await turn(draft.next, 'Day 3 looks too tiring, can you make it lighter?')
check('only day 3 changed', untouched(draft.next.plan, lighter.next.plan, [2]))
```

## Shape

**Data.** `TripState` v3 replaces `itinerary`, `days`, `stays` with `plan: Plan | null`:

```ts
type Plan = { preamble: string; days: PlanDay[]; stays: ResultItem[] }  // stays: grounded, refs h1.. stable
type PlanDay = { header: string; body: string; stops: Stop[]; stayRef: string | null } // stayRef = the night after this day
```

The full markdown is never stored. `renderPlan(plan)` derives it and writes each hotel line from `stayRef`, so a hotel chosen in the panel shows up in the text the model sees next turn (single source of truth).

**Draft (`itinerary` effect).** The model writes the same skill-format markdown as today, including the hotel line it already writes per night. `parseDraft` (pure, `itinerary.ts`) splits on the skill's day-header regex. Per section, the hotel line is found deterministically: the last line that names a grounded stay's title; it is removed from the body and becomes `stayRef`. No marker, no format change, no LLM inference of the link (replaces `linkStays` and `extractDays`'s `stayRef`). `extractDays` becomes `extractStops(section)`, run per section in parallel, so stops can't drift from their body. The draft streams to the panel as `draft` SSE events; the chat reply is `draftSummary(plan)` (the Overview paragraph, no extra LLM call).

**Targets.** `classify` gains `intent: 'revise'` and `revise: { days, hotel, hotelDays } | null` and sees a numbered outline of the plan. The pure `editTarget(plan, classified, changedKeys)` decides:

| Change | Result |
|---|---|
| destination, tripType, dates, travelers changed | full regeneration (today's `plan()` path) |
| revise with days | those days |
| revise with hotel | the named nights, or all nights |
| preferences changed, no day named | all days |
| budget changed | all nights |
| nothing in range | `answer` |

`preferences`/`budget` merge into requirements without wiping the plan. `Effect` becomes `{type:'answer'} | {type:'itinerary'} | {type:'revise', target} | null`.

**Revise (`revise` effect).** The model sees `serverContext.plan` (rendered, `[D3]`-tagged) and `serverContext.target`, and edits only through client tools handled like `show_results`:
- `write_day(day, markdown)`: accepted only for target days and only if the markdown parses to exactly one section.
- `write_preamble(markdown)`: overview / before-you-go.
- `use_stay(hotelId, days)`: accepted only for target nights and grounded ids (after this turn's `show_results`).

A rejected call is answered with the reason ("Day 4 is outside this edit") so the model corrects itself inside the loop (from candidate 1); an accepted one is answered "ok". A rewritten day keeps its old `stayRef` unless its night is a target. `splice` returns untouched days as the same objects, so "untouched stays exactly as it was" holds by construction. The text after the tools is the 1–3 sentence chat reply.

**Hotel choice.** `choose_stay { ref, nights }` is an ordinary command (load → 409 → `assertAllowed` → claim → `reduce` → commit), with no LLM. `nights` must equal one current segment (`segments(plan)`), and `ref` must be in `plan.stays`. The reply is canned copy. Review no longer renders stays cards: the panel is the only hotel list under a draft.

**Stage.** Any change to an existing plan (revise, choose_stay) sets the stage to `review`: a confirmed plan that changed is no longer the one the user confirmed.

**One fold.** New `effect.ts` `runEffect()` is the single LLM-event → state fold, used by `TurnService.run` and `evals/turn.ts` (today they duplicate the stays/days logic).

**Refs.** `mergeStays` keeps refs stable: dedupe by provider id (refresh facts, keep ref), new items get `h{max+1}`, at the cap of 20 drop the oldest stay no day uses.

**Migration.** `readState` accepts v3, or v2 transformed by `upgradeV2` (deterministic, for the claim's deep-equal re-read): the v2 markdown goes through the same `buildPlan` as a draft, stops come from the v2 `days` by index when the counts match. No script; rows become v3 on their next turn.

**Interface depth.** Callers still see `reduce` → `runEffect` → `render`. Section parsing, hotel-line matching, splicing, ref stability and target rules sit behind `itinerary.ts`, `editTarget` and `runEffect`. The frontend learns one command, one stream event, and `TripView.stayPlan`.

## Synthesis decision

Two runners: candidate 1 ("the structured plan is the state": the model writes typed `set_day/set_stay` calls, markdown dropped) and candidate 2 ("keep markdown generation, scope edits by section"). No cross-judge: the configured judge pool has only Claude models, and the parent is Claude.

Base: **candidate 2.** Both preserve untouched parts by construction (identity-preserving splice) and both put the plan in `serverContext`. Candidate 2 keeps the live-proven draft path, the japan-travel skill format and the markdown-based evaluators; candidate 1 needs 4–8 strict tool calls per draft from DeepSeek, a rewritten skill, rewritten evaluators and lossy migration. Per LESSON.md, the LLM contract that already passes live is the one to keep.

Grafted from candidate 1: client-tool rejections are answered with the reason inside the loop, not dropped silently.

Changed from candidate 2 during synthesis:
- **No `{stay:<id>}` marker.** The hotel line is matched against grounded stay titles instead. Removes candidate 2's top risk (marker compliance) and keeps the streamed draft readable.
- **No `covers` per stay.** It depended on the hotel MCP tool's argument names; v1 offers every grounded stay for every segment (see open questions).
- **Stage returns to review** after a plan change.

Rejected: candidate 1's per-night `nights[]` array (equivalent to per-day `stayRef` once `splice` takes a night range); `lastChange`/`days[].changed` highlighting (deferred, the reply says what changed).

## Tradeoffs accepted

- We accept a second LLM call per day (parallel `extractStops`) in exchange for stops that can't drift from their day body after an edit.
- We accept that a day body may mention a hotel in prose that goes stale after a swap; the hotel line itself is server-written.
- We accept that the overview may disagree with an edited day if the model skips `write_preamble`.
- We accept that edits can't change the number of days; that is a date change and regenerates.
- We accept that the draft no longer appears in the chat bubble; it streams into the panel.
- We accept the full rendered plan in `serverContext` on each call (more tokens) in exchange for the model knowing the plan regardless of compaction and panel edits.

## Alternatives considered

- **Structured plan as state (candidate 1).** Deepest model, but moves the whole draft contract onto many strict tool calls and rewrites the skill and evaluators; highest live risk for the same user-visible result.
- **Free-text revise re-split by the server.** Fewer tools, but the chat summary and rewritten sections share one text stream, and splitting them is fragile.
- **Regenerate with "keep everything else" in the prompt.** Smallest surface; preservation depends on the model, which is the failure the walkthrough showed.

## Open questions and risks

- Multi-city trips: should a segment's hotel options be filtered by city (Tokyo hotels offered for Osaka nights today)?
- Does classify separate `revise` from `plan` reliably in zh? The reducer fallback (preferences/budget-only change with a plan → revise) limits damage; the live check covers it.
- Hotel-line matching depends on the model naming a stay by its `title.original`; the live check fails on any overnight day without a `stayRef`.

## Next implementation step

`itinerary.ts` (`parseDraft`, `buildPlan`, `renderPlan`, `splice`, `segments`, `upgradeV2`) with specs against the live Kyoto draft, then state v3.
