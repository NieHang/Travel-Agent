# Trip evals

`evals/` holds offline evaluation scripts for the trip model calls. The plan is
`docs/superpowers/plans/2026-10-28-eval-pipeline.md`. Production tracing is not
enabled; only eval scripts send data to Langfuse.

## Local Langfuse

Langfuse runs from the [official Docker Compose file](https://langfuse.com/self-hosting/deployment/docker-compose),
kept outside this repo in a sibling folder of Travel-Agent (`../../../langfuse`
from `services/chat`). It has its own Postgres, ClickHouse, Redis and MinIO; it
does not use the app database.

That folder has three files:

- `docker-compose.yml`: the official file, unchanged.
- `docker-compose.override.yml`:
  - binds every port to 127.0.0.1;
  - moves Langfuse's Postgres to 5433 and Redis to 6380, because the app's Postgres already uses 5432;
  - sets `LANGFUSE_DEFAULT_ORG_ID=hilda` and `LANGFUSE_DEFAULT_ORG_ROLE=OWNER`, so anyone who signs up in the UI joins the eval org.
- `.env`:
  - random values for every `CHANGEME` secret, plus `DATABASE_URL` and the three `LANGFUSE_S3_*_SECRET_ACCESS_KEY` values that must match them;
  - [headless-init](https://langfuse.com/self-hosting/administration/headless-initialization) variables that create the org `hilda`, the project `hilda-evals` and its API keys (`LANGFUSE_INIT_PROJECT_PUBLIC_KEY` / `_SECRET_KEY`). No user is created this way.

```sh
cd ../../../langfuse
docker compose up -d
curl http://localhost:3000/api/public/health
```

Open <http://localhost:3000> and sign up to see the `hilda-evals` project.
`eval` and `eval:sync` check that health endpoint first; when Docker or Langfuse is
not running they stop with that hint instead of the SDK's "Unable to connect".

## Running

Copy `.env.eval.example` to `.env.eval` (gitignored) and set the two keys to the
`LANGFUSE_INIT_PROJECT_*` values from the Langfuse `.env`. Model and MCP keys
still come from `.env`.

```sh
bun run eval:spike
```

The spike checks that, under Bun:

- OTel export works;
- the metering log and a Langfuse generation with token usage both appear for a `classify` call;
- a one-item dataset experiment records LLM generations and MCP tool calls in the item's trace.

It prints PASS/FAIL per check and the experiment URL, and exits non-zero on failure.

## Replay

Record/replay fixes MCP tool definitions and results so repeated model runs can
be compared without changes in live hotel data. From `services/chat`:

```sh
bun run eval:replay-check --record
bun run eval:replay-check
```

Record mode uses the live model and MCP servers and writes
`evals/cassettes/p1/kyoto-hotels.json`. Review and commit that cassette when ready.
The default check still calls the live model, but uses only recorded MCP results;
it runs the fixed Chinese Kyoto hotel question three times and passes only when
tool-call names and arguments match across runs with no replay misses. Both modes
load `.env` and need no Langfuse. Use temperature 0 in the model config.

`LANGCHAIN_CONFIG=evals/configs/<name>.yaml` selects a config relative to
`services/chat`; the default is `config/langchain.yaml`. A replay miss falls back
to the first recorded result for that tool and signals that the cassette may need
to be recorded again. Replay cannot catch live MCP regressions;
`scripts/test-trip-live.ts` remains responsible for those.

## Datasets, runs and compare

From `services/chat` (sync and eval use Langfuse; eval also calls the live model):

```sh
bun run eval:sync classify
bun run eval classify --trials 3 --tag baseline --concurrency 4
bun run eval:sync extract-days
bun run eval extract-days --trials 3 --tag baseline --concurrency 4
bun run eval:compare classify@abc1234 classify@def5678
```

Run names are `<suite>@<git short sha>[-dirty][-<tag>]#<trial>`. Local files use
`_` instead of `#`, under gitignored `evals/results/`. Compare and noise take the
run name without the trial and read exactly its trials: `classify@abc1234-dirty-date`
does not also read `classify@abc1234-dirty-date2`. Use a new tag for a rerun
at the same revision so earlier local trials and Langfuse runs remain distinct.
Metadata records model parameters, config path, dataset dates and an eight-digit
SHA-256 prompt hash. The extraction hash uses the English system prompt with no
stays, so hotel input and locale do not change the prompt version.

JSONL is the source of truth. Sync upserts entries by stable id and archives
removed items. The labels were reviewed on 2026-10-30 against the rules below, by
Claude rather than a person; spot-check an item before trusting a regression on
it. Classify has 144 entries (72 zh / 72 en). Extract-days has 22: two
hand-written, and 20 real drafts whose sources are in `evals/drafts/` and whose
MCP results are in `evals/cassettes/itinerary/`.

Classify labels:

- `patch` holds what the message states plus direct implications: a solo trip is
  1 traveler, a couple's trip is 2, "just me" is solo unless another type is
  stated, 一家三口 is a family of 3, a group of friends is `friends`. A head count
  alone sets no other trip type.
- A named currency sets `budgetCurrency` (euros → EUR, 人民币 → CNY); with none
  named it is null.
- Relative and yearless dates resolve from the entry's `today` to the next such
  date. Ambiguous ones such as "next weekend" are excluded.
- A follow-up's `state` already holds what its history settled.
- `clarifyField` is set only for an inference the user has not confirmed or a
  request for suggestions, never to ask for a detail the user did not mention.
  A season or holiday instead of days is a `dates` inference; companions that
  fit more than one trip type (coworkers, parents and a partner) are a
  `tripType` inference. Coworkers alone do not make a trip `business`; a stated
  purpose (出差) or relationship ("my wife and I") settles the type. The
  inferred field stays null in `patch` (`vague_dates`, `vague_trip_type`).
- An occasion such as an anniversary is a preference.
- A place or date the user only asks about is not a value (`chat_place`).

Extract-days stops are the places visited, one place per stop:

- Split "A and B", "A、B" and "A / B"; a walk through A → B → C makes each place
  a stop; an area named as a destination is a stop, and so are places within it.
- The hotel is never a stop (it is `stayRef`), including check-in, check-out and
  resting there.
- Meals, breaks and free time are stops only at a named place ("in X", not "near
  X" or "nearby").
- "A or B" options, backup plans and conditional add-ons are not stops.
- Travel legs go in the next stop's note. An airport is a stop where the trip
  arrives or departs and the draft names it. A station is a stop only where a day
  trip or a city change starts or ends, or where something is done there.
- Names follow the draft's wording, because the grader has no aliases.

Compare averages trials per item, then items per metric, and reports category
means, regressions and trial variation. An item regresses when its averaged
`patch_exact` or `clarify_match` (classify) or `stop_f1` (extract-days) drops by
0.5 or more, or when a candidate trial gets the intent wrong where every base
trial got it right. Run-level clarification scores are
averaged across trials and measure clarification presence; `clarify_match` checks
the field. A ratio with no positives is 1. Stop F1 treats normalized stop names
as sets within each day, aligns days by position, and gives missing days 0.
Stay accuracy also uses the longer day's list and gives missing days 0. Empty
lists on both sides match. `leg_as_stop` is a count, so lower is better.

`evals/thresholds.json` gates every quality metric with a maximum drop (or rise,
for hallucinations, travel legs and task errors). The gates come from an A/A
test, two runs of the same code:

```sh
bun run eval classify --trials 3 --tag base-a --concurrency 4
bun run eval classify --trials 3 --tag base-b --concurrency 4
bun run eval:noise classify@abc1234-base-a classify@abc1234-base-b
```

`eval:noise` estimates how far each metric moves between two 3-trial runs when
nothing changed (from each item's spread across all six trials) and suggests 3
standard deviations of that, rounded up to 0.01 and at least 0.02. With about 15
gates that keeps false alarms rare. Rerun it when the model, the datasets or the
trial count change. `task_error` stays at 0, because any error is a bug to read.
Small slices get loose gates: `patch_field_preferences` has 4 items, so one flaky
item moves it 0.08 and its gate is 0.25; add items to tighten it. A change
smaller than a gate passes unnoticed, so also read the category table and the
regressed items. Cost, token counts and latency are reported without gates and
are never listed as flaky. Latency is wall time through task completion and
`whenIdle()`; token counts and cost come from `LlmTotals`. Compare exits 1 on a
crossed threshold or invalid results. It needs no network.
The P1 `eval:replay-check` remains separate: neither P2 suite calls MCP, so this
pass does not add the later itinerary recording command.

## P3: whole-turn itineraries

`datasets/itinerary.jsonl` has 20 scenarios. The 16 original live-check cases
(eight per language, including Japan refusals) keep their exact messages. Four
additional cases cover the remaining requirements. Labels and `must` criteria
are authored fixtures, not human-calibrated judge scores.

| Required case | Scenario IDs |
| --- | --- |
| Family | `l3-zh-family`, `l3-en-family` (Osaka, four travelers) |
| Elderly | `l3-en-elderly` (slow-paced Kyoto) |
| Tight budget | `l3-zh-tight-budget` (1,200 CNY total lodging) |
| Multi-city | `l3-zh-multi-city`, `l3-en-multi-city` (Tokyo–Osaka) |
| Specified lodging area | `l3-en-lodging-area` (Ueno Station) |
| Lodging already booked | `l3-zh-lodging-booked` (Kyoto Station area) |
| Pure hotel question | `l3-zh-hotel-question`, `l3-en-hotel-question` (Kyoto Station) |

`turn.ts` is shared with `scripts/test-trip-live.ts`. It runs classification,
destination checking, reduction, the complete response/tool loop, grounding,
stay merging, extraction and stay linking. Each experiment item/trial has one
Langfuse trace, model/tool observations and code scores. Saved items retain that
trace ID so later geography scores attach to the same execution.

Record MCP cassettes before syncing and running:

```sh
bun run eval:record-itinerary                   # all 20, live model + MCP, no Google
bun run eval:record-itinerary l3-en-elderly      # replace one scenario's cassette
bun run eval:sync itinerary
bun run eval itinerary --trials 3 --tag base-a --concurrency 4 --defer-geography
bun run eval itinerary --trials 3 --tag base-b --concurrency 4 --defer-geography
```

Recording also saves local preview turns in gitignored `results/prepared/`.
P1's exact argument normalization, fallback and miss reporting are unchanged.
L3 uses the scenario-scoped `itinerary-hybrid-v1` profile: hotel searches omit
free-text `originQuery` from the lookup key and canonicalize an explicit list
of same-place aliases. City, station, neighborhood and attraction searches
remain distinct. Dates, nights, travelers, place type, price/tags, radius,
result count and other structured arguments remain in the key. Other tool
types still use exact normalized arguments. Raw tool arguments are retained
for grading. Canonically equivalent requests always select the first matching
snapshot, rather than selecting different snapshots by query prose.
`replay_miss` counts requests missing that profile's key; read it when
interpreting a run. A miss returns the first result for that tool, which can be
inappropriate for another city or an empty-results retry. Refresh observed
argument variants using live MCP without inventing or fuzzy-matching results:

```sh
bun run eval:record-itinerary --refresh l3-zh-family <run-prefix> <other-prefix>
bun run eval:record-itinerary --refresh all <run-prefix> <other-prefix>
```

Refresh appends real responses for observed structured argument variants
missing the L3 key. It never manufactures provider responses. Rerun both
baselines after changing cassettes. Each eval process freezes its cassettes
before trial 1 and records `replayProfile` plus `cassetteHash` in run metadata;
the A/A pair must use the same snapshot. Replay cannot replace the live check
for provider correctness.

The initial P3 recording includes provider searches that returned Shanghai for
the Chinese Osaka query, and empty price-capped searches followed by successful
retries. The curated cassettes retain every recorded argument/result pair but
put a nonempty Japan response first for P1's fallback. Exact matches still
return their original result, including empty or wrong-region responses.

Every assertion in the current live check has an L3 counterpart: refusals and
outside-city names, Japan-only suggestions, chat intent and hotel cards,
destination clarification, review, destination checking, stays and media,
at least one stay link, city skills, headings, estimates, day coverage, travel
legs, full-day alternatives and minimum city nights. `live_assertion_accuracy`
is the assertion-weighted run score over those 52 checks; failed tasks remain
in its denominator. `live_checks_pass` is per original scenario, while
`code_checks_pass` additionally includes the other applicable code checks.

Additional checks require every overnight day to link a grounded stay, no
lodging search for day trips/already-booked lodging, and matching lodging search
destinations, dates and traveler counts. Known English/Japanese/Chinese city
names are accepted. `adultCount` is compared with the stated traveler count;
the model sometimes searches two adults for a four-person family, which this
flags. The budget fixture explicitly uses CNY: minimum shown hotel price ×
nights must fit its total lodging budget. A missing comparable price emits
`budget_checkable=0` but no `budget_ok` score, and does not fail the aggregate
because of budget. Task errors still receive failed budget scores. No exchange
rate is guessed.

Pacing follows the `japan-travel` skill: at most four places a day, three for
families and the elderly fixture. Restaurants, cafés, markets and shopping
streets count as places. These do not count:

- stations and airports: names ending in a station or airport, optionally with
  a bracketed code;
- meals placed only by what they are near ("Lunch near the park", "东福寺附近"),
  which the skill allows;
- a stop named just "Hotel";
- a name repeated within a day.

Arrival/departure days cannot exceed the busiest interior day. A meal at a named
place counts when extraction names it as a stop.
`invented_hotel` checks explicit per-night choices (`Tonight:`, `今晚：`,
`Overnight:`, lodging lines inside a day block, and `Stay at …`) against the
grounded hotel catalog and successful tool hotel names. It uses the linked
stay's original/translation when available; a bilingual line can identify the
hotel by either name. Multiple alternatives must each be grounded. Generic
hotel references, overview lodging advice, already-booked placeholders,
unavailable-data notices and hotel-like extracted stops do not assert an
invented lodging choice. Arbitrary prose outside these choices belongs to the
P4 semantic judge.

### Google approval and geography

The deferred workflow allows approval using the exact outputs of all trials.
It makes **zero Google requests** until an explicit fill/score command. Runs
remain `geography_pending=1` and compare/noise refuse them until scoring finishes.
From `services/chat`, using the run prefixes printed by eval:

```sh
bun run eval:geography --plan <base-a-prefix> <base-b-prefix>
# Ask the operator to approve the printed search ceiling and SKU first:
bun run eval:geography --fill <approved-search-count> <base-a-prefix> <base-b-prefix>
bun run eval:geography --plan <base-a-prefix> <base-b-prefix>
# Ask again, with the now-exact details count and SKU:
bun run eval:geography --score <approved-details-count> <base-a-prefix> <base-b-prefix>
bun run eval:noise <base-a-prefix> <base-b-prefix>
bun run eval:compare <base-a-prefix> <base-b-prefix>
```

Fill's ceiling is twice the uncached stop count: one initial Text Search plus
one retry only when it returns nothing. Every Text Search mask is **`places.id`
only**, billed as Text Search Essentials (IDs Only). It never requests names,
addresses or locations. Scoring uses **`location` only**, Place Details
Essentials, once per distinct place ID across the supplied runs; coordinates
stay in memory. No Google calls are made by `--plan`. Existing complete caches
also allow direct evaluation with `--google-details N` after separate approval;
the shared request budget is enforced across all trials. Cache misses and API
failures cannot silently become zero-distance successes.

`geocache.json` stores the input stop name/locale, provider hotel anchor,
Google place ID and cached Wikidata/Nominatim candidates. It stores no Google
name, address or coordinates. Keys include locale, stop name and hotel region
(rounded to 0.1°) to distinguish identically named places across cities.
Google searches use an 80 km box around the night's provider hotel. Nightless
Nara cases use the declared Nara base; the already-booked fixture uses Kyoto
Station. These fixed bases and hotel coordinates are not Google data.

Each day is hotel → stops → hotel, using straight-line distances.
`day_km_max` is the longest day's kilometers; `route_detour` is the largest ratio
to the exact shortest ordering of those same stops (Held–Karp);
`hotel_far` is the largest stop-to-hotel distance in kilometers.
`stop_unverified` counts stops found by neither existence source, and
`geocode_conflict` counts Google/Wikidata matches more than 3 km apart.
`geocode_coverage` reports the fraction with Google coordinates, and
`geography_day_coverage` reports fully placed days. When no hotel/base can be
identified, that day's geography is unavailable and lowers coverage; it does
not become a zero-distance route. Unverified
stops are reported and never gate on their own. Geography does not check
travel times, opening hours or semantic suitability.

Nominatim runs only during a deliberate, sequential cache fill, with an
identifying User-Agent, at least 1.1 seconds between requests and cached
results, following its [usage policy](https://operations.osmfoundation.org/policies/nominatim/).
Attribution: **© OpenStreetMap contributors**, ODbL. Wikidata is CC0.

### Preliminary runs (2026-10-30; excluded from calibration)

The shared live check passed 52/52 assertions. Preliminary replay experiments
were diagnostic runs, not accepted baselines: they exposed the fallback issue
above, and concurrent A/A requests later hit the provider's concurrency limit.
The sequential replacement then received HTTP 402 (insufficient balance).
New runs stop issuing requests after that error and refuse to save a baseline;
noise calibration rejects failed L3 tasks.

These runs are historical diagnostics. The fresh hybrid pair below supplies
the completed baseline/A/A and measured P3 thresholds; provider-failed trials
were never used for calibration. `eval:noise` can print suggested metrics for
a new suite before gates have been configured.

### Review follow-up (2026-10-31)

Budget unknowns and hotel grounding were corrected as described above; trace
names and local tools were verified with the offline fixture. After the
operator confirmed model credit, these changes received fresh baseline/A/A tags.
The damaged `p3-cal-*` runs and trial 3 of `p3-final-*` remain excluded.

The offline replay audit covered all six `p3-base-*` trials plus trials 1–2 of
each `p3-final-*` run: 200 scenario-trials and 220 MCP calls. The saved runs
recorded 161 misses. Against the current refreshed cassettes, 139 calls still
miss exact matching: 59 differ only in `originQuery`; 130 include an
`originQuery` difference, 54 a place difference, 27 a radius difference, 10 a
traveler-count difference and two each a check-in or nights difference.
These nearest-record comparisons diagnose drift only; they are not fuzzy
replay matching. A city query and a station query are not interchangeable.
The operator approved L3 hybrid matching and confirmed restored provider
credit. The profile above is implemented; 13 remaining distinct structured
variants from the six `p3-base-*` trials were recorded through live RollingGo
before the new discovery/baseline runs. P1 matching is unchanged.

The hybrid discovery trial passed all 52 live assertions with no task errors
and one miss: a Ueno Station search with a 1,000 m radius. That distinct
structured variant was recorded before freezing the calibration snapshot.
The subsequent fresh pair is:

```text
itinerary@132ba8e-dirty-p3-hybrid-base-a
itinerary@132ba8e-dirty-p3-hybrid-base-b
```

Both sets have three trials, concurrency 2, and were run sequentially. All
120 scenario-trials completed with `task_error=0`, `replay_miss=0`, prompt hash
`93699087` and cassette hash `9470e68fe138`. Each set's live assertion counts
were 52/52, 51/52 and 52/52 (99.36% overall). Trial 2 missed the multi-city
minimum-night check: English in A, Chinese in B. Every overnight stay linked,
the explicit lodging budget was checkable and passed, and `invented_hotel=0`.
Pacing passed 20% of itinerary-trials under the unchanged caps.

Before geography, Langfuse v2 metrics verified all 2,484 numeric scores across
39 names against the local files, with 120 distinct trace IDs. A real
[family trace](http://localhost:3000/project/hilda-evals/traces/3d783b2c3d65ed76e415e516639753ec)
from discovery also verifies the named generations and skill/search/results
tools. The real live script passed 52/52 after these changes. Unit tests:
514 passing after the cache-resume regressions; typecheck and lint pass
(five existing warnings). No further model run was needed for geography-only
scoring and threshold configuration.

The six runs' geography is now scored. Their union contains 315 cached
contextual stops. The user approved 315 initial IDs-only Text Search requests
plus at most 315 empty-result retries (630 maximum), zero Place Details. The
fill is complete: all 315 contextual entries have finished their existence
checks, with no missing or pending entries. It used at most 326 of the approved
630 Text Search requests and zero Place Details. The first interrupted attempt
did not log individual request counts, so its seven attempted stops contribute
a conservative 7–14 requests; later attempts logged 1, 199 and 112 requests.
Wikidata interruptions exposed a need to checkpoint the
Google ID before existence checks. Saved entries marked `sourcesPending`
resume those checks without another Google request and cannot be scored yet.
The fill enforces a remaining request ceiling when resumed, and logs each
Google search; Wikidata alone has bounded HTTP 429 retries. The user separately
approved 177 Place Details Essentials requests, `location` only, and zero Text
Search to score all six trials. That scoring process completed successfully,
using one memory-only coordinate lookup per distinct ID. It did not fill the
cache, retry Google errors, or persist Google coordinates. Coordinates are
memory-only, so rerunning the same six trials in a fresh process again needs
177 Details requests. Running the three A trials together needs 123; running
the three B trials together needs 149. Individually, A trials 1/2/3 need
85/80/85 and B trials 1/2/3 need 92/103/85. These counts apply to the saved
outputs; changed outputs need a fresh zero-request plan and approval. Any new
Google request requires another approval; the 177-request batch is finished.

### Completed geography and gates (2026-10-31)

All 60 itinerary outputs across the six trials have `geography_pending=0`;
all 120 scenario-trials still have zero task errors and replay misses.
Langfuse readback verifies all 2,904 numeric scores across 46 names on the
120 original traces, including every numeric value within 1e-12 and all
pending markers cleared. One trace initially lacked four geography scores
and retained its pending marker; those five values were reattached from the
saved numeric results, with no additional Google requests. Aggregate metrics
and a second per-trace readback now match the local files.
`thresholds.json` now includes 38 L3 gates. Both the full `eval:noise` and
`eval:compare` commands pass, with no gate violations or regressed items.
Only the fresh hybrid pair is used. The code-only draft in `results/` is
historical; `results/p3-completion.json` contains the completed measurements.

| Geography metric | A mean | B mean | Allowed change |
|---|---:|---:|---:|
| `day_km_max` (km) | 83.109 | 95.832 | rise 30.07 |
| `route_detour` (ratio) | 1.1044 | 1.1756 | rise 0.14 |
| `hotel_far` (km) | 39.787 | 42.600 | rise 10.60 |
| `geocode_conflict` (count) | 0.5000 | 0.5667 | rise 0.33 |
| `geocode_coverage` | 1.0000 | 0.9991 | drop 0.02 |
| `geography_day_coverage` | 1.0000 | 0.9944 | drop 0.02 |
| `stop_unverified` (count) | 1.1667 | 2.2000 | report only |

These are means of per-itinerary metrics: `day_km_max` averages each
itinerary's longest day, and `hotel_far` averages its farthest stop. Routes
include arrivals/departures and are straight-line closed routes from the hotel;
they do not measure travel time or walking effort. Coverage prevents missing
coordinates from masquerading as shorter routes.

Gates follow P2's three-standard-deviation A/A rule, rounded up to 0.01 with
a 0.02 floor, using the three trials on each side. Higher error/distance
metrics gate rises; accuracy/coverage metrics gate drops. `task_error` permits
no rise. Usage, assertion counters, `budget_checkable`, `geography_pending`
and `stop_unverified` are not gated. The sample makes some gates loose: the
two-case `city_min_nights` slice allows 0.71, which gives little regression
sensitivity at this baseline; the assertion-weighted live accuracy gate is
0.03. `pacing_ok` was recalibrated under the pace rule below. These
thresholds do not establish itinerary quality; packing/extraction follow-up
and the P4 judge remain separate work.

Under the old caps (six stops a day, four for families, three for the elderly
fixture), pacing on the fresh hybrid pair passed 12/60 itinerary outputs (20%):
45 failed a daily cap and three failed solely on the arrival/departure rule.
Examples are `[2, 5, 5, 2]` for elderly travelers (cap 3), `[4, 5, 1]` for an
English family trip (cap 4), and `[4, 4, 10, 3]` for the tight-budget trip
(cap 6). The pace rule below replaced these caps. The older clean-run audit
passed 19/100, with 79 cap failures and two boundary-only failures; it is
diagnostic, not the current baseline.

Counting contributes to the failures: 22/60 outputs repeat an exact stop name
within a day. The family example repeats Kuromon Market; the 11-stop Nara trip
includes the station twice, lunch, and several parts of one temple complex.
Even after diagnostic exact-name deduplication, 40 of the 45 cap failures still
exceed their cap. This supports improving/reviewing extracted stops and draft
packing before changing the caps. Nearby sights still need effort/walking
assessment; no extraction or pacing behavior was changed for this audit.

### Pace rule (2026-10-31)

The `japan-travel` skill and `pacing_ok` share the rule above. Regrading the
saved hybrid outputs under it gives 4/60 (7%), with 6.1 places on the average
interior day.

**First attempt: one rule line.** Stating the cap in the skill barely moved the
drafts. An A/A pair (`itinerary@132ba8e-dirty-pace-a` / `-b`) passed 6/60
(10%), with 5.5 places on the average interior day. A typical Kyoto day still
listed 伏见稻荷大社, 清水寺, 三年坂, 二年坂, 八坂神社 and 祇园. A probe that asked
for a place count in each header showed that the model counts areas, not
places: "东山（标准 · 4 处）" covered five sights.

**Second attempt: headers list the places.** Each day header now names that
day's places: "Day 2 | Tokyo National Museum · Ameyoko · Yanaka Ginza
(standard)". The timeline may name only those places; otherwise meals are eaten
"nearby". The skill also:

- defines a place, with examples;
- ties intensity to the place count;
- shows a three-place standard day in the format sample.

At the same time, the grader stopped counting "nearby" meals and "Hotel" stops.
That grader change alone takes the first attempt from 8% to 10% and leaves the
old pair at 7%.

This A/A pair ran the current skill, three trials each, concurrency 4,
`--defer-geography`:

```text
itinerary@132ba8e-dirty-places-a
itinerary@132ba8e-dirty-places-b
```

All 120 scenario-trials completed with `task_error=0`. The live script passed
52/52. Unit tests: 519 passing; typecheck passes and lint shows the five
existing warnings.

| Metric | Old pair, regraded | Current pair |
|---|---:|---:|
| `pacing_ok` | 7% | 80% |
| Places on the average interior day | 6.1 | 3.2 |
| `code_checks_pass` | 0.525 | 0.808 |
| `full_day_alternatives` | 0.917 | 0.967 |
| `leg_as_stop` | 0.067 | 0 |
| Mean latency (ms) | 12,809 | 11,576 |

Families pass 12/12 and the elderly fixture 5/6. The 12 remaining failures fall
into two groups, about half each:

- **Real overshoots.** The timeline adds a place the header did not list, such
  as 祇园 after 八坂神社, or an evening in Dotonbori after a Nara day trip.
- **Extraction naming.** A meal at a listed place is extracted as a new stop
  ("Lunch in Gion" next to "Gion"), or an area and a street inside it count
  separately (Harajuku and Takeshita Street).

The `pacing_ok` gate is now 0.29, from an A/A SD of 0.0943 on the current pair.
`code_checks_pass` keeps 0.11: the pair compared against itself stays within
it. `eval:noise` and `eval:compare` refuse pending geography, so the gate and
the comparisons here come from `noiseGates` and `compareRuns`, run from a
script with `geography_pending` removed.

Other gates were not recalibrated from these pairs. Against the old pair,
`compareRuns` reports no regressed items. It flags only `replay_miss` (+0.125),
`every_night_linked` (−0.048) and `at_least_one_stay_link` (−0.024). Every
other gated metric is within its gate. Single-trial failures in the current
pair:

- **Replay misses.** The skill is part of every prompt, so a new skill text
  moves some hotel searches off the recorded keys. On a miss, replay returns
  the tool's first recorded result. In the current pair, 12 of 120
  scenario-trials miss (11 hotel-question trials and one Chinese multi-city
  trial), against none in the old pair. This left the multi-city trial with no
  Osaka hotels. Re-record the cassettes
  (`eval:record-itinerary`) before the next comparison.
- **Short extraction.** One extraction returned only day 1 of a complete
  three-day Chinese family draft, failing `every_day_covered` and the live
  checks. No other trial in the three pairs did this. One case cannot show whether
  the new headers contributed.
- **`invented_hotel` false positive.** The detector read "建议选本町一带的酒店"
  (pick a hotel around Honmachi) as a hotel name.
- **Dropped hotel cards (first attempt).** In one English lodging-area trial,
  `show_results` cited the search's callId with one letter in the wrong case,
  so grounding dropped every hotel. Short per-turn source ids fix this in
  NieHang/Travel-Agent#2, which is not merged and not in these runs.

Geography is not scored for these pairs: it would need new Google Place
Details requests, which need approval first.

## Geocoder accuracy check

`evals/geocode-labels.json` holds the stops from the 2026-10-30 accuracy check
that chose P3's geocoders (see the plan's P3 section). It has 213 real stops from
the 17 Japan extract-days items and 24 made-up names. For each of Nominatim,
Wikidata and Google it keeps every result a search has returned, each with
Claude's label; a person has not reviewed the labels. Real stops are `correct`, `near`
(the right spot but another feature, such as the station by a park), `wrong` or
`missing`; made-up names are `none` or `matched`. The result is Nominatim's
name, a Wikidata item id or a Google place id. Google's terms allow storing only
place ids, so no Google name, address or coordinate is kept. The Nominatim names
are OpenStreetMap data: © OpenStreetMap contributors, ODbL.

```sh
bun run eval:geocode-check                     # all three sources, about 10 minutes
bun run eval:geocode-check google wikidata
```

Each stop is searched within its trip's region, as when it was labeled. Nominatim
is paced at one request per second and Wikidata a little slower. Google needs
`GOOGLE_MAPS_API_KEY` in `.env.eval`. Its search asks for place IDs only, which
Google does not charge for (Text Search Essentials, IDs Only), and takes the top
result. Each unlabeled ID costs one Place Details Pro call (5,000 free a month)
to print its name and distance. Each source prints the plan's accuracy
table row, counted over stops that still return the labeled result; "correct"
includes `near`. Stops that return a result with no label yet are listed as
changed, with the distance from the region: check each one and add it, with its
label, to that source's list in the JSON. Keep the old entries, because results
flip back and forth. Google returned a new result for 4 to 9 of the 237 stops on
each of five runs on 2026-10-30, often the same place under another id and
sometimes nothing for a well-known stop (关西机场), so expect a few every run.
Nominatim and Wikidata changed 1 and 2 stops in one rerun. The check exits 1
only on request errors.

## Trace rules

- For scripts that send traces to Langfuse, load env, then import `./instrumentation.js`, before importing LangChain or
  application modules. Call `shutdown()` in `finally`, or traces are lost.
- Pass the Langfuse `CallbackHandler` to `ModelTripLlm` through `{ callbacks }`.
  The loop forwards callbacks and explicit tool run names to skill loads, MCP
  tools and the real `show_results` tool. A callback already registered on an
  MCP tool is not forwarded twice. `show_results` validates through the tool
  schema once, emits the grounding event, and still replies `shown`.
- Generations use `trip.classify`, `trip.locate`, `trip.respond` and
  `trip.extract_days` as run names. Every response round keeps its name,
  including the final text-only round.
- This deployment is Langfuse v4 in `events_only` mode. Read observations via
  `/api/public/v2/observations`, or
  `client.api.observations.getMany({ traceId, fields: 'core,basic,metadata,io' })`.
  Root metadata includes `experiment_run_name` and `dataset_item_id`.
- Read numeric score aggregates with `/api/public/v2/metrics` and
  `view: "scores-numeric"`. Retired v1 trace/observation/score listing and
  dataset-run listing endpoints return 404 here. The installed SDK's
  `client.api.scores.getMany` uses `/api/public/v3/scores`, not the retired v1
  route; its per-trace score-ID lookup was verified locally on 2026-10-31.
- An offline full-turn fixture trace verified all four generation names and
  skill/search/show-results tool observations on 2026-10-31, with zero external
  model, RollingGo or Google calls:
  [inspect the fixture trace](http://localhost:3000/project/hilda-evals/traces/a4d8f4fda64204297215891cbd3298b7).
