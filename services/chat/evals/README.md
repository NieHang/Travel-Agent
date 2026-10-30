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

## Trace rules

- For scripts that send traces to Langfuse, load env, then import `./instrumentation.js`, before importing LangChain or
  application modules. Call `shutdown()` in `finally`, or traces are lost.
- Pass the Langfuse `CallbackHandler` to `ModelTripLlm` through
  `{ callbacks }`. Tools need it too (`tool.callbacks`). `streamToolLoop`
  calls tools outside the model run, so they don't inherit the model's callbacks.
- Read traces back with `client.api.observations.getMany({ traceId })`. The
  installed SDK (6.0.2) has no `traces.get()`.
