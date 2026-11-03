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

## Local-only data

These files are gitignored and live only on the machine that made them, so the
public repo holds no recorded hotel data:

| Path | What it is | On a fresh clone |
|---|---|---|
| `evals/cassettes/l3/` | Recorded hotel tools for the 20 L3 scenarios | `bun run eval:record-itinerary` (live model and hotel server, no Google), then curate as in P3 below |
| `evals/cassettes/p1/` | The P1 Kyoto hotel recording | `bun run eval:replay-check --record` |
| `evals/geocache.json` | Geocoding cache: Google place IDs, Wikidata and Nominatim results | Create it as `{"attribution":"© OpenStreetMap contributors","entries":{}}`; `eval itinerary` reads it at start. `eval:geography --fill` refills it and spends Google requests |
| `evals/geocode-labels.json` | Labeled geocoder results from the 2026-10-30 accuracy check | Cannot be regenerated; the labels were made by hand |
| `evals/drafts/` | Copies of the extract-days drafts | Not needed; the dataset holds the same drafts |

Git no longer keeps history for them, so back them up yourself. Runs on new
recordings are not comparable with the current baseline; run a new A/A pair.

## Replay

Record/replay fixes MCP tool definitions and results so repeated model runs can
be compared without changes in live hotel data. From `services/chat`:

```sh
bun run eval:replay-check --record
bun run eval:replay-check
```

Record mode uses the live model and MCP servers and writes
`evals/cassettes/p1/kyoto-hotels.json` (local only, see below).
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
hand-written, and 20 real drafts (local copies in `evals/drafts/`). Each entry
carries the hotels its draft used (`stays`), so the suite needs no MCP results.

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
L3 uses the scenario-scoped `itinerary-hybrid-v2` profile: hotel searches omit
free-text `originQuery` from the lookup key and canonicalize an explicit list
of same-place aliases. An alias is listed only if it returns the same hotels
live; v2 dropped "大阪 日本" and "大阪市 日本", which return Shanghai hotels while
"大阪" returns Osaka ones. City, station, neighborhood and attraction searches
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
destination clarification, review, destination checking, stays and Osaka
stays, media, at least one stay link, city skills, headings, mode-only legs,
day coverage, travel legs, full-day alternatives and minimum city nights.
`osaka_stays` uses the live check's own `hasOsakaStay` and also runs on
`l3-zh-tight-budget`, though only the family and multi-city scenarios count it
as a live check. `live_assertion_accuracy` is the assertion-weighted run
score over those 56 checks; failed tasks remain
in its denominator. `live_checks_pass` is per original scenario, while
`code_checks_pass` additionally includes the other applicable code checks.

Additional checks require every overnight day to link a grounded stay, no
lodging search for day trips/already-booked lodging, and matching lodging search
destinations, dates and traveler counts. Known English/Japanese/Chinese city
names are accepted. `searchHotels` takes `adultCount` per room and has no
room or child count (those are on `getHotelDetail`), so a party of three or
more may search anything from 2 per room to the whole party; parties of one or
two must search their own size. The budget fixture explicitly uses CNY: minimum shown hotel price ×
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
- a stop named just "Hotel" or "酒店";
- a meal, café or rest stop whose name contains another of the day's places
  ("Lunch in Gion" next to "Gion", "Café on Sannenzaka", "奈良公园一带午餐与休息"),
  because the skill says to eat at one of the day's places;
- a name repeated within a day.

Arrival/departure days cannot exceed the busiest interior day. A meal at any
other named place counts: "Lunch in Pontocho" is a new place.
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

The `pacing_ok` gate became 0.29, from an A/A SD of 0.0943 on the current pair
(0.32 after the follow-up below).
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

### Pacing follow-up and geography (2026-10-31)

**Grader.** A meal, café or rest stop that names one of the day's places is
now a repeat, and a stop named "酒店" is the hotel (see the pacing rule above).
On the places pair this alone moves `pacing_ok` from 80% to 85%. The skill did
not change.

**Two skill probes, both reverted.** Each ran two trials. The places pair's
first two trials, regraded, pass 85%; a control probe of the committed skill
passed 80%.

- Separating a neighbourhood from its streets ("Harajuku, Takeshita Street and
  Omotesando is 3"), "Higashiyama is 5 places: take at most 4", and a day-trip
  line: 60%. The examples anchored the model. Elderly and family headers
  listed four places on a "light" day, and the Harajuku day gained Omotesando
  and still walked Takeshita Street.
- "Swap a place for one in the header, never add one on top", plus a check
  before the next day: 55%.

Neither beat the control. Two-trial runs move by about ten points, so these
probes show no real change either way.

**Run-to-run variance.** Three A/A pairs of the same committed skill and
grader, three trials a side:

| Pair | Skill file | `pacing_ok` |
|---|---|---:|
| `itinerary@132ba8e-dirty-places-a` / `-b` | LF | 85% |
| `itinerary@ec53810-dirty-pacing-a` / `-b` | CRLF | 63% |
| `itinerary@ec53810-dirty-pacinglf-a` / `-b` | LF | 75% |

With the control probe that is 150/200 (75%). Single trials range from 5/10 to
10/10 at temperature 0. Judge a pacing change with full pairs, not two-trial
probes. On Windows, `git checkout` with `core.autocrlf` writes skill files
with CRLF, which adds 89 `\r` characters to the prompt. The CRLF runs scored
63% and 80%, so no effect is shown, but run evals from an LF checkout.

**Baseline and gates.** `itinerary@ec53810-dirty-pacinglf-a` / `-b` is the
baseline. `pacing_ok` is gated at 0.32, from an A/A SD of 0.1043. The pair
passes every current gate against itself, so the other gates are unchanged.
The three pairs disagree on several suggested gates: the coverage SDs are
0.0026 in one pair and 0.0333 in the others, and `route_detour` suggests
0.03–0.05 against the current 0.14. So the geography gates stay as they are.

**Geography.** Scored for all three pairs. "Old" is the hybrid pair before the
pace rule. The old and places pairs' `pacing_ok` are regraded under the
current rule; the other two pairs ran under it. Means over six trials:

| Metric | Old | Places | CRLF | LF |
|---|---:|---:|---:|---:|
| `pacing_ok` | 7% | 85% | 63% | 75% |
| `day_km_max` (km) | 89.5 | 85.4 | 87.0 | 89.0 |
| `route_detour` | 1.140 | 1.038 | 1.039 | 1.039 |
| `hotel_far` (km) | 41.2 | 41.6 | 41.5 | 42.6 |
| `geocode_conflict` | 0.53 | 0.22 | 0.23 | 0.25 |
| `stop_unverified` | 1.68 | 0.83 | 0.53 | 1.07 |
| `geocode_coverage` | 1.000 | 0.983 | 0.983 | 0.999 |

Fewer places a day make routes less roundabout: `route_detour` falls from
1.14 to 1.04 in every pair. Longest-day distance and hotel distance do not
change.

**Old → new comparison.** `eval:compare` of the old pair's run `-a` against
the baseline's run `-a` reports no regressed items. It fails three gates, all
on the hotel side:

- `replay_miss` +0.17: hotel-question searches no longer match the recorded
  keys, and one Chinese multi-city trial missed four times and had no Osaka
  hotels;
- `every_night_linked` −0.05, from that same trial;
- `invented_hotel` +0.03, from that trial, plus one tight-budget line that
  shortens two returned hotels ("BRACKETS HOTEL" for "BRACKETS HOTEL 大阪本町",
  "APA 难波站东" for "APA酒店〈难波站东〉"), which the detector cannot ground.

Re-record the cassettes (`eval:record-itinerary`) before relying on the hotel
gates.

**Google usage.** Filling the cache took 175 Text Search Essentials (IDs Only)
requests. Scoring took at most 182 Place Details Essentials requests,
`location` only, one per distinct place ID across the three pairs. The cache
stores place IDs only. Wikidata's "search too busy" reply stopped the fill
twice, so it is now retried like a 429.

### City areas resized (2026-10-31)

**Change.** Most remaining over-limit days followed a city skill's "Areas that
go together" line. Those lines named 4–6 places per area, and the core skill
said "One area per half day", so a two-area day could reach 8 places. Each area
now has at most 3 places, under one rule: a day is one area or parts of two
neighbouring areas, within the place limit, and an evening place counts as one
of the day's places.

- Kyoto: Higashiyama is split into Kiyomizu-dera (Kiyomizu-dera, Sannenzaka,
  Yasaka Shrine) and Central (Nishiki Market, Pontocho, Gion). Northern
  Higashiyama drops Eikan-do. The Sagano train replaces an Arashiyama place
  instead of adding one.
- Tokyo: Asakusa, Ueno, Akihabara, Harajuku and Shibuya are separate areas.
  Shinjuku's evening is Omoide Yokocho or Golden Gai, not both.
- Osaka: the Osaka Castle keep and its park are one place. Tennoji no longer
  "pairs with Minami".
- Nara: Nara Park is the park, Todai-ji and Kasuga Taisha. Kofuku-ji or
  Naramachi takes the place of one of them.
- Core skill: arrival and departure days take "only places near the hotel or
  on the way" (was "at most one easy area"). "One area per half day" became "A
  day stays in one area, or two neighbouring ones, within the place limit".

**Result.** Pair `itinerary@ec53810-dirty-areas-a` / `-b` against the
baseline:

| Pair | `pacing_ok` passes per trial (of 10) | Total |
|---|---|---:|
| `pacinglf` (baseline) | 9 8 7 5 8 8 | 45/60 (75%) |
| `areas` | 9 8 8 8 8 9 | 50/60 (83%) |

The 8-point gain is under one A/A SD (0.10), so it is not proven. The worst
trial went from 5/10 to 8/10.

**What still fails.** Ten items. Seven name places beyond the day's header in
the timeline, or split one header place into several stops:

- a Kiyomizu-dera walk that adds 八坂神社, 花见小路 or 祇园 (2);
- a four-place Harajuku day that ends at Shibuya Sky (2, both Chinese
  multi-city);
- the Osaka family day: Osaka Castle and its park as two stops, or a walk
  through 心斋桥 between 黑门市场 and 道顿堀 (3);

The other three:

- 梅田 split into its shopping streets, underground mall and winter lights (1);
- an English family trial whose arrival day (2 places) was busier than its only
  full day (1);
- a Nara stop "Kintetsu-Nara", a station named without "Station", which the
  grader counts as a place.

**Other metrics.** Over both pairs, every gate passes except
`every_night_linked`: 0.976 → 0.929, against a gate of 0.02. All three misses
are multi-city. Two are Chinese trials with 1 and 4 replay misses (stale
cassettes, as above). The third is an English trial that wrote 5 of 6 days,
which also costs `every_day_covered` 0.017. `eval:compare` of the baseline's
run `-a` against `areas-a` reports no regressed items. It fails the same two
gates (`every_day_covered` −0.033, `every_night_linked` −0.048), because that
run holds the 5-day trial and the 1-miss trial.

**Geography.** Means over six trials:

| Metric | Baseline | Areas |
|---|---:|---:|
| `day_km_max` (km) | 89.0 | 82.5 |
| `route_detour` | 1.039 | 1.026 |
| `hotel_far` (km) | 42.6 | 40.2 |
| `geocode_conflict` | 0.25 | 0.23 |
| `stop_unverified` | 1.07 | 0.37 |
| `geocode_coverage` | 0.999 | 0.998 |

Shorter days and fewer unverified stops, as expected from fewer places a day.
The pair's own A/A noise suggests `pacing_ok` 0.29 and `every_night_linked`
0.24. Replay misses drive most of the night-link noise, so the gates stay as
they are until the cassettes are re-recorded.

Google usage: 33 Text Search Essentials (IDs Only) to fill the cache, and at
most 103 Place Details Essentials, `location` only, to score.

**Live check.** In the first run, the English Osaka family one-shot kept no
hotels, failing 3 checks. Two reruns of that turn searched with the same
arguments and kept 4 hotels each. A second full run passed all 52 checks.

### Mode-only legs and suggestion-only city skills (2026-10-31)

**Change.** No tool gives location or transit facts yet, so hand-written
facts left the prompts:

- City skills keep only unchecked suggestions: sights (name and what it is),
  food, crowds and best times, rainy-day options, reservations, day-trip
  ideas and seasons. Area groupings, "next to" hints, getting-around and
  hotel-area advice, travel times and lines, and planning decisions ("a half
  day", "better as its own stay") are gone.
- Core skill: city skills are "unchecked suggestions, not facts" and never
  change the planning rules. A travel leg gives its mode only, with English
  and Chinese wording ("by subway", "乘地铁"). It names no line or operator
  (not even "JR") and gives no minutes, stops or transfers. The format sample
  and the airport legs follow suit. Time at a place may still be estimated.
- `SKILL_FACTS_RULE` in `src/trip/llm.ts` says the same.

**Grader.** `estimates_marked` is replaced by `legs_mode_only` (gate 0.02).
`legDetails` in `travel-leg.ts` checks every line from the first day heading
on, skipping hotel lines. A line fails if it:

- names a line, named train or operator used as transport;
- counts stops or transfers;
- or gives a travel time: minutes in the same clause as a mode, minutes in the
  stop part (before the description colon) of a line that names a mode, or
  hours beside a journey such as "Kyoto → Nara by train, approx. 1 h".

Hours elsewhere are the visit ("Osaka Castle by subway (approx. 1.5 h)").
Airport check-in buffers and "please check" reminders are not travel
details. The live check runs the same function.

All 120 itinerary drafts from the `pacinglf` and `areas` pairs fail it, as
they should: the old rule required lines, minutes and transfers.

**Result.** Pair `itinerary@ec53810-dirty-modeonly2-a` / `-b`:

| Pair | `pacing_ok` passes per trial (of 10) | Total |
|---|---|---:|
| `pacinglf` | 9 8 7 5 8 8 | 45/60 (75%) |
| `areas` | 9 8 8 8 8 9 | 50/60 (83%) |
| `modeonly2` | 9 9 9 10 9 10 | 56/60 (93%) |

- `legs_mode_only`: 56/60 (0.933), against 0/120 before. The four leaks are
  all Chinese, and none comes from a skill:
  - "乘地铁转乘前往" to Fushimi Inari (lodging-booked, 2);
  - "乘近铁" / "乘近铁或 JR" for the Nara return (day trip, 2).
- Mixed-language legs: 0 of 30 Chinese drafts. A first run with only the
  English "by subway" example had 4 of 15 ("浅草寺 by 地铁"). That run is
  kept in `results/stale-modeonly/` and excluded.
- Against `areas`:
  - `full_day_alternatives` 0.917 → 0.983;
  - `invented_hotel` 0.033 → 0.008;
  - `tool_args_ok` 0.800 → 0.817;
  - `replay_miss` 0.108 → 0.092.
- `every_night_linked` 0.929 → 0.905 (−0.024) breaks its gate. All four misses
  are Chinese multi-city trials whose Osaka nights have no hotel. In three of
  them, the recorded "大阪 日本" search returns Shanghai hotels and the model
  rightly refuses them; in the fourth, a replay miss fell back to Tokyo
  hotels. The live check, against the real hotel server, found Osaka stays.
  This is a replay problem, not the prompt (see the re-recording below).

**Live check.** The first run failed one check: `15:00 Osaka Castle by subway
(approx. 1.5 h)`, a visit time the grader then misread as a ride (fixed
above). On the final prompt, all 52 checks pass. Both drafts give every leg
by mode only, and the Chinese one writes "乘电车" and "乘新干线".

**Geography.** Means over six trials (Google usage: 35 Text Search
Essentials (IDs Only) to fill the cache, 94 Place Details Essentials,
`location` only, to score):

| Metric | `pacinglf` | `areas` | `modeonly2` | A/A SD | Gate |
|---|---:|---:|---:|---:|---:|
| `day_km_max` (km) | 89.0 | 82.5 | 92.2 | 12.3 | +30.07 |
| `route_detour` | 1.039 | 1.026 | 1.089 | 0.046 | +0.14 |
| `hotel_far` (km) | 42.6 | 40.2 | 42.4 | 5.3 | +10.6 |
| `geocode_conflict` | 0.25 | 0.23 | 0.32 | 0.080 | +0.33 |
| `stop_unverified` | 1.07 | 0.37 | 0.70 | | |
| `geocode_coverage` | 0.999 | 0.998 | 1.000 | 0 | −0.02 |

Every geography gate passes. Most of the rise is not planning:

- Chinese multi-city: `day_km_max` 105 → 202. Its 清水寺 geocodes about 240 km
  away in exactly the four trials whose Osaka nights have no hotel (the
  replay problem above), so the Kyoto day trip is measured from the wrong
  side of the country.
- Chinese day trip: two trials list the city "奈良" as a stop, which the
  geocoder cannot pin down (2 conflicts, 92 and 174 km, detour 1.92).
- 八坂神社 (Chinese lodging-booked) and Tokyo National Museum (English
  lodging-area) conflict in most trials of both pairs.

What is left is `route_detour`, up 1.4 A/A SD: single backtracking days in
one Chinese (1.75) and one English (1.67) family trial. Without area
groupings the model has only the core rule "keep each day's places close
together"; a place tool is the real fix.

### Re-recorded cassettes (2026-10-31)

**Recording.** `eval:record-itinerary` re-recorded all 20 L3 scenarios against
the live model and hotel server. `--refresh all` then added live responses for
the argument variants seen in `modeonly2` (9 calls) and in a first pair on the
new cassettes (6 calls). No Google requests and no traces.

**The hotel server, not staleness.** Every live "大阪 日本" search in this
recording returned Shanghai hotels (5 calls) or none (1). The same happened
in the old recording, and "大阪市 日本" behaves the same way. "大阪", "大阪 难波",
"难波 大阪 日本", "大阪市 大阪府 日本" and "Osaka Japan" return Osaka hotels. The
tool description asks for "城市 国家" for a city, so "大阪 日本" is the model's
usual first search (31 of 45 Chinese Osaka searches in `rec2`). Live Chinese
users get the same Shanghai results unless the model retries with another
name.

**Replay profile v2.** `itinerary-hybrid-v1` aliased "大阪 日本" and "大阪市
日本" to "大阪". The first Osaka snapshot answered all three, so a retry with
"大阪" replayed Shanghai, unlike live. `itinerary-hybrid-v2` keys those two
exactly.

**Curation.** As before, the first hotel search of each cassette must be a
nonempty Japan result, because a miss falls back to it. `l3-zh-family` and
`l3-zh-tight-budget` started with a Shanghai and an empty search. Their first
Osaka or Namba search was moved to the front; nothing else changed.

**Pairs.** The first pair (`rec`, kept in `results/stale-rec/`) still had
`every_night_linked` 0.905. Two of its four misses were replay misses (Namba
searches typed 区/县) that fell back to the Tokyo search. Those variants were
refreshed, and `itinerary@ec53810-dirty-rec2-a` / `-b` is the new baseline:

| Metric | `modeonly2` | `rec2` |
|---|---:|---:|
| `replay_miss` | 0.092 | 0.033 |
| `every_night_linked` | 0.905 | 0.929 |
| `has_stays` | 1.000 | 0.983 |
| `at_least_one_stay_link` | 1.000 | 0.976 |
| `tool_args_ok` | 0.817 | 0.850 |
| `legs_mode_only` | 0.933 | 0.883 |
| `full_day_alternatives` | 0.983 | 0.950 |
| `pacing_ok` | 0.933 | 0.833 |
| `live_checks_pass` | 1.000 | 0.979 |

(`legs_mode_only` for `modeonly2` is regraded with the current grader. Its
stored score, 0.917, predates a false-positive fix.)

- Unlinked nights in `rec2`: two Chinese trials (multi-city, family) searched
  only "大阪 日本" and got only Shanghai hotels, as live would; the family one
  has no stays at all. The third is a replay miss on "大阪 难波".
- `pacing_ok`: no prompt changed since `modeonly2`. `l3-zh-day-trip` makes no
  tool calls, yet failed 5 of 6 trials, against 2 of 6 before: four places on a
  standard Nara day. Session-to-session noise is larger than the
  `modeonly2` A/A pair showed.
- `legs_mode_only` leaks: 转乘 (3), "机场线" / "机场快线" (3) and "Taxi down to
  Yasaka Shrine, approx. 45 min" (1). The grader fails "机场快线" but not the
  English "airport express".

**Geography.** Means over six trials (Google usage: 35 Text Search
Essentials (IDs Only) to fill the cache, 112 Place Details Essentials,
`location` only, to score):

| Metric | `modeonly2` | `rec2` | `rec2` A/A SD |
|---|---:|---:|---:|
| `day_km_max` (km) | 92.2 | 82.3 | 12.0 |
| `route_detour` | 1.089 | 1.083 | 0.035 |
| `hotel_far` (km) | 42.4 | 37.8 | 5.2 |
| `geocode_conflict` | 0.32 | 0.32 | 0.086 |
| `stop_unverified` | 0.70 | 0.77 | |
| `geocode_coverage` | 1.000 | 0.983 | 0.033 |

`day_km_max` falls because fewer Chinese multi-city trials lose their Osaka
hotel to a replay miss, so fewer Kyoto day trips are measured from Tokyo.

**Gates.** `eval:compare` of `rec2-a` against `rec2-b` reports no regressed
items but fails five gates: `has_stays` (−0.033), `stays_have_media` and
`at_least_one_stay_link` (−0.048), `geocode_coverage` and
`geography_day_coverage` (−0.033). All five come from one trial,
`rec2-b_2` `l3-zh-family`, which searched only "大阪 日本", got only Shanghai
hotels and so has no stays to measure from. `thresholds.json` is unchanged:
the gates stay as they are until the app drops non-Japan hotels and the
baseline pair is re-run with that fix.

**Osaka hotel fix.** `compactToolContent` (`src/llm/mcp/compact.ts`) now
drops hotels whose `areaCode` is not `JP`. When none remain, it tells the
model to search again without the country ("大阪", not "大阪 日本"). Replay runs
through the same code, and the recorded Shanghai hotels carry `areaCode`
`CN`. The live check gained "Osaka stays" checks for both locales and passes
56/56.

The `osakafix` pair stopped on a model-provider 402 after two trials of run
`a`; run `b` made no progress. Those two trials (`results/stale-osakafix/`)
have `every_night_linked` 1.000 and `has_stays` 1.000. Every Chinese Osaka
trial retried "大阪" after "大阪 日本". `l3-zh-tight-budget` has no "大阪"
recording, so its retry is a replay miss (`replay_miss` 0.033 → 0.050). Two
trials are not a baseline. The "大阪" variant is now recorded for
`l3-zh-tight-budget` (10 Japan hotels; one live hotel call on 2026-11-01).

### Osaka stays baseline (2026-11-01)

**Grader.** `osaka_stays` passes when a family, tight-budget or multi-city
trip has a stay that names Osaka (大阪) in its title or address. The live check
uses the same `hasOsakaStay`, so every live-check assertion now has an L3
counterpart (56 checks). The live check passes 56/56.

**Recording.** The first pair (`osakastays`, kept in
`results/stale-osakastays/`) showed four new argument variants in
`l3-zh-multi-city` ("大阪 城市" with size 5 and 6, "大阪市 城市", "大阪 难波
区/县"). `--refresh` recorded them; all four return only Japan hotels.

**Baseline.** `itinerary@507790f-dirty-osakastays2-a` / `-b` is the new
baseline (model cost $0.39). Means over six trials against `rec2`:

| Metric | `rec2` | `osakastays2` |
|---|---:|---:|
| `osaka_stays` | | 1.000 |
| `every_night_linked` | 0.929 | 1.000 |
| `has_stays` | 0.983 | 1.000 |
| `replay_miss` | 0.033 | 0.008 |
| `live_checks_pass` | 0.979 | 1.000 |
| `legs_mode_only` | 0.883 | 0.883 |
| `pacing_ok` | 0.833 | 0.833 |
| `tool_args_ok` | 0.850 | 0.817 |
| `day_km_max` (km) | 82.3 | 76.3 |
| `route_detour` | 1.083 | 1.072 |
| `hotel_far` (km) | 37.8 | 35.5 |
| `geocode_conflict` | 0.32 | 0.35 |
| `geocode_coverage` | 0.983 | 1.000 |

Every Osaka trial has an Osaka stay and every night is linked. The one replay
miss ("大阪 城市" in `b_1` `l3-zh-multi-city`) still found Osaka stays.

**Gates.** `eval:compare` of `-a` against `-b` failed only `legs_mode_only`
(0.900 → 0.867), whose gate was still the 0.02 default. Its A/A SD is 0.083,
so the three-SD rule gives 0.25, which is now its gate. The pair passes every
other gate, so the others are unchanged, and `eval:noise` and `eval:compare`
pass. A 0.25 gate only catches a large leak; read the regressed items for
smaller ones.

**Google usage.** 14 Text Search Essentials (IDs Only) requests to fill the
cache and at most 87 Place Details Essentials, `location` only, to score.

**`tool_args_ok` per room (2026-11-02).** The grader required `adultCount` to
equal the party size, so a family of four searching two adults per room
failed; that was 10 of the 11 failures in this pair and 9 of 9 in `rec2`. It
now accepts 2 per room up to the whole party (see above). Regraded from the
saved outputs, with no model calls:

| Pair | `tool_args_ok` | `code_checks_pass` |
|---|---:|---:|
| `rec2` | 0.850 → 1.000 | 0.817 → 0.842 |
| `osakastays2` | 0.817 → 0.983 | 0.800 → 0.842 |

The remaining failure is `b_1` `l3-zh-multi-city`, a "大阪" search without
`checkInParam`. The result files still hold the old scores, which
`eval:compare` reads, so a candidate compared with `osakastays2` gains about
0.17 on `tool_args_ok` from the grader alone. The gate (0.11) is unchanged.

## P4: subjective quality, judged by Claude

The code checks above say whether a plan is well formed, not whether it is
good. P4 adds a checklist for that. There is no paid judge model: Claude
judges in a Claude Code session from a sheet written from a saved run, so
judging calls no model from the project and needs no rerun.

```sh
bun run eval:judge-pack itinerary@507790f-dirty-osakastays2-a_1    # run name plus trial
# The judge reads results/judge/<name>.md and fills results/judge/<name>.verdicts.json
bun run eval:judge-import itinerary@507790f-dirty-osakastays2-a_1  # needs Langfuse running
```

- **What is judged.** One trial per run: the 10 itinerary and 4 answer items.
  The 6 refusal and clarification items are fixed server copy and are skipped.
- **Criteria** (`judge/rubric.ts`). Plans get `fits_party`, `realistic_days`,
  `hotel_fit`, `no_unsupported_claims`, `useful_content` and
  `language_quality`. Answers get `answers_question`, `no_unsupported_claims`
  and `language_quality`. Every item also gets its own `must` lines.
- **Verdicts.** Each criterion is `pass`, `fail` or `na`, with a one-sentence
  reason. The sheet shows only what the model saw and wrote (request, tool
  calls, shown hotels, days, draft), and length earns no credit. Each hotel
  line adds the searched distance and tags from the raw tool result, since
  cards carry no room types and can leave out or misquote a distance. The
  model-written card summary is left out. A hotel fact must match its
  result. Every other real-world fact (opening hours, closing days, travel
  times, ticket and reservation rules) is checked with a web search, never
  from memory, and the reason names the source. A fact the search shows
  wrong fails even when the draft says to check it.
- **Scores.** `judge_<criterion>` is 1 or 0, with the reason as the comment.
  `judge_must` is the share of the item's `must` lines that pass, and
  `judge_checklist` is the share of everything that passes. `na` counts
  nowhere. The import replaces the item's earlier `judge_*` scores in the
  result file and writes the same scores to its Langfuse trace, with the
  judge and rubric hash as metadata. Langfuse overwrites a score only when
  its id (`<traceId>-<name>`) and timestamp both match, so a re-import reuses
  the earlier timestamps and deletes judge scores the new verdicts no longer
  produce. It uses the batch endpoint, because the SDK's queued
  `score.create` drops scores added during an automatic 10-score flush.
- **Rubric hash.** Changing any question changes `RUBRIC_HASH`, and old
  verdict files no longer import. Pack and judge again.
- **Cost.** About 35k tokens of the session's context per trial. A cheaper
  subagent can judge instead; write its model in `judge`.
- **Not gated.** One judge, not yet checked against a person. `judge_*` scores
  stay out of `thresholds.json` until they are calibrated: about 30 items
  labelled by hand, and only criteria at ≥ 80% agreement count. Blind
  pairwise comparison is a later P4 step.
- **Local only.** Sheets, verdicts and labels live in `results/judge/`, which
  is gitignored with the rest of `results/`.

### Labelling by hand

```sh
bun run eval:label       # http://127.0.0.1:4310; or start "eval-label" from .claude/launch.json
bun run eval:agreement   # after labelling
```

The labelling page lists every trial judged under the current rubric (or the
trials named on the command line) and shows each item as the judge saw it,
without the judge's verdicts, so the labels are blind. Each criterion takes
pass, fail or n/a and an optional note; clicking a chosen answer again clears
it. Each click saves to `results/judge/<trial>.labels.json`, so labelling can
stop and resume. It is a local page instead of a Langfuse annotation queue
because the queue works only in the Langfuse UI, which needs a login.

`eval:agreement` compares the labels with the verdicts of the same trials:
agreement per general criterion and for the `must` lines together, then every
disagreement with the judge's reason and the labeller's note. A criterion
needs at least 10 labels before its rate counts, and counts at ≥ 80%; below
that, rewrite the question, judge again and relabel. Labels record the rubric
hash, so a changed rubric needs new labels.

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
