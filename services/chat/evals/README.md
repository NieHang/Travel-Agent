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

## Rules for eval scripts

- For scripts that send traces to Langfuse, load env, then import `./instrumentation.js`, before importing LangChain or
  application modules. Call `shutdown()` in `finally`, or traces are lost.
- Pass the Langfuse `CallbackHandler` to `ModelTripLlm` through
  `{ callbacks }`. Tools need it too (`tool.callbacks`). `streamToolLoop`
  calls tools outside the model run, so they don't inherit the model's callbacks.
- Read traces back with `client.api.observations.getMany({ traceId })`. The
  installed SDK (6.0.2) has no `traces.get()`.
