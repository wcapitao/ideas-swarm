# Cloudflare Workers + Agents: Production Deploy & Observability

> Audience: senior engineers building Cloudflare Agents (Durable Object–backed agents using `@cloudflare/agents`) who need to ship to production with the right observability, secrets, CI/CD, and migration discipline. Every claim is cited with the source URL it was extracted from.

## 0. ai-ideator `agent/` Worker (this repository)

The live MVP lives under **`agent/`** (not the large annotated `wrangler.jsonc` in §1 — that block is a production *template*).

| Field | Value in this repo |
|------|---------------------|
| Wrangler file | `agent/wrangler.jsonc` |
| Worker `name` | `ai-ideator` |
| `main` | `src/index.ts` |
| DO binding `name` | **`IDEATOR`** (→ `env.IDEATOR`); class **`IdeatorAgent`** |
| Secrets (typical) | `DEEPSEEK_API_KEY`, `CLOUDFLARE_ACCOUNT_ID` (see **`agent/README.md`**) |
| LLM path | DeepSeek via **AI Gateway**; second pass per idea in **`src/evaluator.ts`** (not a separate DO) |

CI does **not** auto-deploy this Worker on git push; use **`npm run deploy`** from **`agent/`**, or wire a GitHub Actions → Wrangler job yourself.

---

## 1. Reference `wrangler.jsonc` for an Agent (annotated)

The block below is the canonical shape we will use for any Cloudflare Agent. It mirrors the `agents-starter` template ([source](https://github.com/cloudflare/agents-starter/blob/main/wrangler.jsonc)) and adds the production hardening (observability, smart placement, source maps, vars/secrets split). Every line has a comment explaining what it does and why.

```jsonc
{
  // Pulls in IDE autocomplete + jsonc validation. Wrangler ships the schema in node_modules.
  "$schema": "node_modules/wrangler/config-schema.json",

  // Top-level Worker name. Used to build the *.workers.dev hostname when workers_dev:true.
  // Per environment, Cloudflare creates a separate Worker named "<name>-<env>" — e.g.
  // "ai-ideator-staging" — so don't include the env in this string.
  // Source: https://developers.cloudflare.com/workers/wrangler/environments/
  "name": "ai-ideator-agent",

  // Entrypoint that exports your `default` fetch handler AND your Durable Object classes.
  // For Agents this is typically the file that re-exports your Agent class.
  // Source: https://developers.cloudflare.com/workers/wrangler/configuration/
  "main": "src/server.ts",

  // Pins the runtime version. Bumping this date can change Web/Node API behavior.
  // Choose a date you've actually tested against; do not auto-bump in CI.
  // Source: https://developers.cloudflare.com/workers/wrangler/configuration/
  "compatibility_date": "2026-04-30",

  // Agents depend on Node-flavored APIs (crypto, streams, async_hooks). The Agents docs
  // explicitly call out nodejs_compat as required.
  // Source: https://developers.cloudflare.com/agents/api-reference/configuration/
  "compatibility_flags": ["nodejs_compat"],

  // Static assets bundled with the Worker (e.g. the SPA shell). The agents-starter sets
  // `run_worker_first` so /agents/* and /oauth/* skip the asset handler and go to the Worker.
  // Source: https://github.com/cloudflare/agents-starter/blob/main/wrangler.jsonc
  "assets": {
    "directory": "./public",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/agents/*", "/oauth/*"]
  },

  // === Bindings ===
  // Reminder: bindings and vars are NON-INHERITABLE between top-level and env.* — you must
  // re-declare them per environment.
  // Source: https://developers.cloudflare.com/workers/wrangler/environments/

  // Workers AI binding. `remote: true` means even `wrangler dev` (local mode) will hit
  // real Cloudflare AI inference. Workers AI has no local simulation.
  // Source: https://developers.cloudflare.com/workers/development-testing/
  "ai": {
    "binding": "AI",
    "remote": true
  },

  // Vectorize is similarly remote-only. Bind by index_name (created with `wrangler vectorize create`).
  // Source: https://developers.cloudflare.com/workers/wrangler/configuration/ ;
  // remote-only: https://developers.cloudflare.com/workers/development-testing/
  "vectorize": [
    {
      "binding": "VECTORIZE",
      "index_name": "ai-ideator-concepts",
      "remote": true
    }
  ],

  // KV for cheap shared cache. Use preview_id for `wrangler dev` if you want a separate namespace.
  // Source: https://developers.cloudflare.com/workers/wrangler/configuration/
  "kv_namespaces": [
    { "binding": "CACHE", "id": "<kv-id>", "preview_id": "<kv-preview-id>" }
  ],

  // R2 for blob storage (e.g. raw KB documents).
  "r2_buckets": [
    { "binding": "RAW", "bucket_name": "ai-ideator-raw" }
  ],

  // Analytics Engine for high-cardinality custom metrics (cost-per-run, tokens-per-call).
  // Source: https://developers.cloudflare.com/analytics/analytics-engine/
  "analytics_engine_datasets": [
    { "binding": "METRICS", "dataset": "ai_ideator_metrics" }
  ],

  // === Durable Objects ===
  // The Agent class. `name` is the binding identifier accessed via env.AGENT.
  // `class_name` must match the exported class symbol in src/server.ts.
  // Source: https://developers.cloudflare.com/workers/wrangler/configuration/
  "durable_objects": {
    "bindings": [
      { "name": "AGENT", "class_name": "IdeatorAgent" }
    ]
  },

  // === DO Migrations (top-level only, not per-environment by default) ===
  // Append-only. Tags must be unique and applied in order. The system tracks which migrations
  // have run per environment, so you can never reorder or delete an already-applied tag.
  // Source: https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["IdeatorAgent"]
    }
  ],

  // === Non-secret config ===
  // `vars` is plaintext, visible in dashboard. NEVER put API keys here.
  // Source: https://developers.cloudflare.com/workers/configuration/secrets/
  "vars": {
    "LOG_LEVEL": "info",
    "MAX_TURNS": 12,
    "MODEL_DEFAULT": "@cf/meta/llama-3.3-70b-instruct"
  },

  // === Observability ===
  // Enables the queryable JSONL log store (Workers Logs) accessible from the dashboard.
  // head_sampling_rate=1 captures everything; drop to 0.1 for high-traffic Workers.
  // Source: https://developers.cloudflare.com/workers/observability/logs/workers-logs/
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  },

  // Stack trace remapping for uncaught exceptions in Workers Logs / tail / dashboard.
  // Costs nothing at runtime; remapping is async post-invocation. Max 15MB gzipped.
  // Source: https://developers.cloudflare.com/workers/observability/source-maps/
  "upload_source_maps": true,

  // Smart Placement moves the Worker isolate closer to the heaviest backend (e.g. your
  // upstream model API). For agents that hit a single LLM region, this is a real latency win.
  // Source: https://developers.cloudflare.com/workers/wrangler/configuration/
  "placement": { "mode": "smart" },

  // CPU budget per invocation, in ms. The Standard model allows up to 300_000 (5 min);
  // setting a lower cap is a self-DoS guard for runaway agent loops.
  // Source: https://developers.cloudflare.com/workers/platform/limits/
  "limits": { "cpu_ms": 60000 },

  // === Per-environment overrides ===
  "env": {
    "staging": {
      "name": "ai-ideator-agent-staging",
      "vars": { "LOG_LEVEL": "debug", "MAX_TURNS": 12, "MODEL_DEFAULT": "@cf/meta/llama-3.3-70b-instruct" },
      "durable_objects": {
        "bindings": [{ "name": "AGENT", "class_name": "IdeatorAgent" }]
      },
      "vectorize": [{ "binding": "VECTORIZE", "index_name": "ai-ideator-concepts-staging", "remote": true }],
      "kv_namespaces": [{ "binding": "CACHE", "id": "<staging-kv-id>" }],
      "ai": { "binding": "AI", "remote": true },
      "observability": { "enabled": true, "head_sampling_rate": 1 }
    },
    "production": {
      "name": "ai-ideator-agent-production",
      "routes": [{ "pattern": "agent.example.com", "custom_domain": true }],
      "vars": { "LOG_LEVEL": "warn", "MAX_TURNS": 12, "MODEL_DEFAULT": "@cf/meta/llama-3.3-70b-instruct" },
      "durable_objects": {
        "bindings": [{ "name": "AGENT", "class_name": "IdeatorAgent" }]
      },
      "vectorize": [{ "binding": "VECTORIZE", "index_name": "ai-ideator-concepts", "remote": true }],
      "kv_namespaces": [{ "binding": "CACHE", "id": "<prod-kv-id>" }],
      "ai": { "binding": "AI", "remote": true },
      "observability": { "enabled": true, "head_sampling_rate": 0.1 }
    }
  }
}
```

Critical thing to internalize: **bindings and `vars` do not inherit from the top level into `env.staging` / `env.production`**. You must repeat them. ([source](https://developers.cloudflare.com/workers/wrangler/environments/)) The deployed Worker name becomes `<name>-<env>`, e.g. `ai-ideator-agent-staging`. ([source](https://developers.cloudflare.com/workers/wrangler/environments/))

---

## 2. Migrations cookbook (Durable Objects)

DO migrations are **append-only**, **atomic**, and **all-or-nothing**. Each migration `tag` must be unique. Once any migration tag has been applied to a Worker, every future deploy must include a migration block. You cannot reorder or remove a previously-applied tag. Migrations execute in order during deploy; if one fails, the deploy fails. ([source](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/))

The five directives:

| Directive | Effect |
|---|---|
| `new_sqlite_classes` | Create a new SQLite-backed DO class (the modern path). |
| `new_classes` | Create a new key-value-backed DO class (legacy). |
| `deleted_classes` | Drop a class **and all its data**. |
| `renamed_classes` | Move state from one class name to another in the same Worker. |
| `transferred_classes` | Move state to a class in a different Worker. |

Source for the table: https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/

### 2.1 Add a new SQLite-backed DO class

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "AGENT", "class_name": "IdeatorAgent" },
      { "name": "RANKER", "class_name": "RankerAgent" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["IdeatorAgent"] },
    { "tag": "v2", "new_sqlite_classes": ["RankerAgent"] }
  ]
}
```

### 2.2 Rename an existing class (preserves data)

Do not declare the destination class in `new_sqlite_classes` — the rename migration creates it.

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "AGENT", "class_name": "IdeatorAgentV2" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["IdeatorAgent"] },
    {
      "tag": "v3",
      "renamed_classes": [
        { "from": "IdeatorAgent", "to": "IdeatorAgentV2" }
      ]
    }
  ]
}
```

### 2.3 Delete a class (destroys data)

Remove the binding **first**, deploy, then add the deletion migration. Otherwise you get an orphaned binding error. ([source](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/))

```jsonc
{
  "durable_objects": { "bindings": [] },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["IdeatorAgent"] },
    { "tag": "v4", "deleted_classes": ["RankerAgent"] }
  ]
}
```

### 2.4 Transfer a class to a new Worker

Useful when you split an agent out of a monolith.

```jsonc
{
  "migrations": [
    {
      "tag": "v5",
      "transferred_classes": [
        {
          "from": "RankerAgent",
          "from_script": "ai-ideator-agent",
          "to": "RankerAgent"
        }
      ]
    }
  ]
}
```

### 2.5 Switching from KV-backed to SQLite-backed

There is currently **no automatic migration path** from `new_classes` (KV-backed) to `new_sqlite_classes` for existing data. Cloudflare states this is "available in the future." ([source](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)) For new agents, always start with `new_sqlite_classes` — it's the only forward-compatible option, has higher per-object storage caps (10 GB vs unlimited but billed differently), and is available on the Free plan, while KV-backed is Paid-only. ([source](https://developers.cloudflare.com/durable-objects/platform/limits/))

For existing KV-backed classes, the safe pattern today is:
1. Create a new SQLite-backed class with a different name.
2. Write a one-time data export job inside the old class that streams its state via fetch to the new class.
3. Once data has moved and is verified, retire the old binding via `deleted_classes`.

---

## 3. Wrangler CLI cheatsheet (15 commands you'll actually use)

All flag references: https://developers.cloudflare.com/workers/wrangler/commands/workers/

| # | Command | What it does | Example |
|---|---|---|---|
| 1 | `wrangler login` | OAuth flow into your Cloudflare account. | `wrangler login` |
| 2 | `wrangler whoami` | Show current account/email/account_id. | `wrangler whoami` |
| 3 | `wrangler dev` | Local dev server on `localhost:8787`. Press `D` for DevTools. | `wrangler dev --env staging` |
| 4 | `wrangler dev --remote` | Run code on Cloudflare preview infra; all bindings are real. Slower iteration. | `wrangler dev --remote` |
| 5 | `wrangler deploy` | Build + upload + activate. | `wrangler deploy --env production` |
| 6 | `wrangler deploy --dry-run` | Build/bundle but don't ship. Use in PR CI. | `wrangler deploy --dry-run --outdir=dist` |
| 7 | `wrangler tail` | Live log stream from a deployed Worker. Max 10 concurrent tailers per Worker. | `wrangler tail --env production --format json --status error` |
| 8 | `wrangler types` | Generate TS types for `Env` from your config. | `wrangler types --env-interface=Env` |
| 9 | `wrangler types --check` | Verify types are up to date without writing. CI gate. | `wrangler types --check` |
| 10 | `wrangler secret put` | Set a secret (interactive prompt or stdin). | `echo $OPENAI_KEY \| wrangler secret put OPENAI_KEY --env production` |
| 11 | `wrangler secret bulk` | Upload secrets in bulk from JSON / `.env`. | `wrangler secret bulk .env.production --env production` |
| 12 | `wrangler kv namespace create` | Create a KV namespace. Outputs the id to paste into wrangler config. | `wrangler kv namespace create CACHE` |
| 13 | `wrangler vectorize create` | Create a Vectorize index. | `wrangler vectorize create ai-ideator-concepts --dimensions=1024 --metric=cosine` |
| 14 | `wrangler versions upload` | Upload a version without promoting it. | `wrangler versions upload --tag canary --message "v0.4-canary"` |
| 15 | `wrangler versions deploy` | Promote a version with traffic split. | `wrangler versions deploy --version-id=<id> --percentage=10` |

Notable flags:
- `wrangler tail --format json --status error --search "max_turns" --sampling-rate 0.1` for filtered live logs ([source](https://developers.cloudflare.com/workers/wrangler/commands/workers/)).
- `wrangler deploy --keep-vars` is essential when secrets/vars are managed in the dashboard and you don't want a deploy to wipe them ([source](https://developers.cloudflare.com/workers/wrangler/commands/workers/)).
- `wrangler deploy --secrets-file .env.production` ships secrets in the same call as code ([source](https://developers.cloudflare.com/workers/configuration/secrets/)).

System env vars Wrangler reads in CI: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ENV`, `WRANGLER_LOG`, `WRANGLER_OUTPUT_FILE_PATH` (ND-JSON deploy summary), `WRANGLER_SEND_METRICS=false` to disable telemetry. ([source](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/))

---

## 4. Local dev workflow for Agents

`wrangler dev` runs your Worker on your laptop using **Miniflare**, which embeds the same `workerd` runtime that production uses. The default mode is local-with-simulated-bindings: KV, R2, D1, DO state, and Queues are all in-memory unless you point them at real resources. ([source](https://developers.cloudflare.com/workers/development-testing/))

### What is faked vs real

| Binding | Default in `wrangler dev` | Can talk to real Cloudflare? |
|---|---|---|
| Durable Objects | Local (Miniflare) | **No** — DOs cannot use `remote: true`. ([source](https://developers.cloudflare.com/workers/development-testing/)) |
| KV | Local in-memory | Yes, with `remote: true` |
| R2 | Local filesystem | Yes, with `remote: true` |
| Vectorize | **Always remote** (no local sim) | Yes, set `remote: true` to use prod index |
| Workers AI | **Always remote** (no local sim) | Yes |
| D1 | Local SQLite | Yes |
| Secrets / vars / Analytics Engine / Hyperdrive | **Always local** — cannot be `remote`. ([source](https://developers.cloudflare.com/workers/development-testing/)) | No |

### Recipe: local Agent talking to real Vectorize + real Workers AI

In `wrangler.jsonc`:

```jsonc
{
  "ai": { "binding": "AI", "remote": true },
  "vectorize": [
    { "binding": "VECTORIZE", "index_name": "ai-ideator-concepts-staging", "remote": true }
  ]
}
```

Then:

```bash
# Local code, local DO state, real AI inference, real Vectorize index.
wrangler dev --env staging --persist-to .wrangler/state/staging
```

`--persist-to <dir>` keeps your simulated KV/R2/DO state on disk between runs, so your agent's conversation history survives a restart. ([source](https://developers.cloudflare.com/workers/wrangler/commands/workers/))

For end-to-end tests against a fully-real environment (last-mile network behavior), use `wrangler dev --remote`, which deploys to Cloudflare's preview infrastructure. Slower iteration; use sparingly. ([source](https://developers.cloudflare.com/workers/wrangler/commands/workers/))

### DevTools

While `wrangler dev` is running, press `D` to open Chrome DevTools — console, breakpoints, CPU profiler, memory snapshots. Same DevTools UI is also reachable through the Cloudflare dashboard for deployed Workers. ([source](https://developers.cloudflare.com/workers/observability/dev-tools/))

---

## 5. Logs and tracing

Cloudflare gives you four overlapping log surfaces. Pick deliberately.

### 5.1 Workers Logs (the queryable JSONL store) — your default

Enable in config:

```jsonc
"observability": { "enabled": true, "head_sampling_rate": 0.1 }
```

`head_sampling_rate` is 0–1; 1 logs everything, 0.1 logs 10% of invocations. Captured fields: request/response metadata, every `console.log` call, uncaught exceptions. ([source](https://developers.cloudflare.com/workers/observability/logs/workers-logs/))

Retention: **3 days on Free, 7 days on Paid**. Per-account daily ceiling: 5 billion logs (after which Cloudflare auto-samples to 1%). Single log entry max: 256 KB. Pricing: Free tier gets 200K logs/day; Paid gets 20M logs/month included, then $0.60 per additional million. ([source](https://developers.cloudflare.com/workers/observability/logs/workers-logs/))

For agents specifically: log structured objects, not strings. The dashboard query UI indexes object keys.

```ts
console.log({
  event: "agent.turn",
  run_id: ctx.runId,
  turn: turn,
  model: env.MODEL_DEFAULT,
  input_tokens: usage.input,
  output_tokens: usage.output,
  cost_usd: usage.cost,
});
```

### 5.2 Real-time logs / `wrangler tail`

For watching a deployed agent live:

```bash
wrangler tail --env production --format json | jq 'select(.outcome == "exception")'
```

Filters: `--status ok|error|canceled`, `--method`, `--search "..."`, `--sampling-rate 0.1`, `--header`, `--ip`. ([source](https://developers.cloudflare.com/workers/wrangler/commands/workers/))

Limits: max 10 concurrent tailers per Worker. High-traffic Workers get auto-sampled and you get a warning. Console.log inside WebSocket handlers is buffered until the socket closes. ([source](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/))

### 5.3 Tail Workers (programmatic event ingest)

A Tail Worker is a separate Worker that consumes the producer's log events. Add to producer config:

```jsonc
"tail_consumers": [{ "service": "ai-ideator-tail" }]
```

Tail Worker code:

```ts
export default {
  async tail(events: TraceItem[]) {
    await fetch("https://logs.example.com/cf-events", {
      method: "POST",
      body: JSON.stringify(events),
    });
  },
};
```

Source: https://developers.cloudflare.com/workers/observability/logs/tail-workers/. Available on Paid + Enterprise.

### 5.4 Logpush (push to S3 / R2 / Datadog / Splunk)

Set `"logpush": true` in your wrangler config, then create a Logpush job via dashboard or API specifying destination and which fields to export (Event, EventTimestampMs, Outcome, Exceptions, Logs, ScriptName, etc.). Workers Paid plan only. Min Wrangler 2.2.0. Logs+exceptions field has a combined 16,384-char truncation limit. ([source](https://developers.cloudflare.com/workers/observability/logs/logpush/))

### 5.5 Custom metrics: Workers Analytics Engine

For high-cardinality metrics (per-user, per-run cost, per-model latency) that you want to query with SQL, use Analytics Engine.

Bind:

```jsonc
"analytics_engine_datasets": [
  { "binding": "METRICS", "dataset": "ai_ideator_metrics" }
]
```

Write:

```ts
env.METRICS.writeDataPoint({
  indexes: [run.userId],          // string, used as the sampling key
  blobs: [run.model, run.outcome], // up to 20 string fields
  doubles: [run.costUsd, run.tokens, run.durationMs], // up to 20 numeric fields
});
```

Source: https://developers.cloudflare.com/analytics/analytics-engine/

Query with the SQL API:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/analytics_engine/sql" \
  --header "Authorization: Bearer $CF_API_TOKEN" \
  --data "SELECT
            blob1 AS model,
            SUM(_sample_interval) AS calls,
            SUM(double1 * _sample_interval) AS cost_usd_total
          FROM ai_ideator_metrics
          WHERE timestamp > NOW() - INTERVAL '1' DAY
          GROUP BY blob1
          ORDER BY cost_usd_total DESC"
```

Always weight by `_sample_interval` to undo Cloudflare's automatic sampling. ([source](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/))

### 5.6 Source maps for stack traces

Set `"upload_source_maps": true`. Wrangler uploads the `.js.map` alongside the bundle and Cloudflare remaps stack traces in tail/Workers Logs/dashboard. Async, no runtime cost. Min Wrangler 3.46.0; max 15 MB gzipped. ([source](https://developers.cloudflare.com/workers/observability/source-maps/))

---

## 6. Secrets — the two-step pattern

Keep this rule in your bones: **`vars` for non-secret config, `wrangler secret put` for secrets**. `vars` are stored plaintext and visible in the dashboard; secret values become invisible after they're set. ([source](https://developers.cloudflare.com/workers/configuration/secrets/))

### Local dev

Put dev-time secrets in `.dev.vars` (or `.env`) at the project root, gitignored:

```
OPENAI_API_KEY=sk-test-...
JWT_SIGNING_KEY=local-only-key
```

Per-environment dev files: `.dev.vars.staging`, `.dev.vars.production`. ([source](https://developers.cloudflare.com/workers/configuration/secrets/))

### Production

Interactive:

```bash
wrangler secret put OPENAI_API_KEY --env production
# (paste value when prompted)
```

Piped (works headless):

```bash
echo "$OPENAI_API_KEY" | wrangler secret put OPENAI_API_KEY --env production
```

Bulk from a file (for CI):

```bash
wrangler secret bulk .env.production --env production
```

Or upload secrets together with code:

```bash
wrangler deploy --env production --secrets-file .env.production
```

`--secrets-file` preserves any secrets not present in the file, so you can rotate one without resending all of them. ([source](https://developers.cloudflare.com/workers/configuration/secrets/))

### Declarative validation

Add a `secrets.required` block in wrangler.jsonc to make `wrangler deploy` fail loudly when a required secret is missing:

```jsonc
"secrets": { "required": ["OPENAI_API_KEY", "JWT_SIGNING_KEY"] }
```

([source](https://developers.cloudflare.com/workers/wrangler/configuration/))

### Secrets Store (account-level, when you have many Workers)

Cloudflare Secrets Store is a centralized account-scoped vault. One secret value, bound to many Workers. Currently supports Workers + AI Gateway as binding consumers. Unavailable in the Cloudflare China Network. ([source](https://developers.cloudflare.com/secrets-store/)) Bind it the same way as a regular secret, but the value lives in the store, so rotating once propagates to every binding.

### Reading in code

```ts
// inside fetch handler
const key = env.OPENAI_API_KEY;

// or globally, outside a handler:
import { env } from "cloudflare:workers";
const key = env.OPENAI_API_KEY;
```

([source](https://developers.cloudflare.com/workers/configuration/secrets/))

---

## 7. CI/CD recipe — GitHub Actions deploy on push to main

You have two real options:

1. **Workers Builds** (Cloudflare-managed). Hook GitHub/GitLab to a Worker; Cloudflare runs your build command and deploys on push. Simpler. Auto-creates preview deployments per branch. Injects `CI=true`, `WORKERS_CI=1`, `WORKERS_CI_COMMIT_SHA`, `WORKERS_CI_BRANCH`. Worker name in dashboard must match `name` in wrangler config or it fails. ([source](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/))
2. **GitHub Actions with `cloudflare/wrangler-action@v3`**. More control; lives next to the rest of your CI. ([source](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/))

For Agents we recommend GitHub Actions — you want to run tests, type check, and gate deploy on `wrangler types --check`.

`.github/workflows/deploy.yml`:

```yaml
name: Deploy Agent

on:
  push:
    branches: [main, staging]

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false  # don't cancel a deploy mid-flight

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "npm" }
      - run: npm ci
      # Regenerate the Env type from wrangler config and fail if it changed.
      # This catches "you added a binding but forgot to commit the regen'd types".
      - run: npx wrangler types --env-interface Env
      - run: git diff --exit-code worker-configuration.d.ts
      - run: npx tsc --noEmit
      - run: npm test
      # Bundle without deploying — catches build errors in PRs.
      - run: npx wrangler deploy --dry-run --outdir=dist

  deploy:
    needs: test
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "npm" }
      - run: npm ci

      - name: Deploy
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          # Pick env from branch.
          command: >
            deploy --env
            ${{ github.ref == 'refs/heads/main' && 'production' || 'staging' }}
          # Bring secrets along atomically with the code deploy.
          secrets: |
            OPENAI_API_KEY
            JWT_SIGNING_KEY
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          JWT_SIGNING_KEY: ${{ secrets.JWT_SIGNING_KEY }}
```

Pattern notes:
- `wrangler types --check` followed by `git diff --exit-code` prevents the classic "I added a binding and forgot to regenerate types" failure mode.
- The `secrets` input on `cloudflare/wrangler-action@v3` reads each named secret from `env` and pipes it into `wrangler secret put`, so secrets are atomically updated alongside code. ([source](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/))
- `--dry-run` in the `test` job catches build errors in PRs without touching production.
- Required GitHub secrets: `CLOUDFLARE_API_TOKEN` (with Workers Edit + Workers KV Edit + Workers AI + Workers Vectorize permissions), `CLOUDFLARE_ACCOUNT_ID`. ([source](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/))

### Preview URLs per branch

If you use Workers Builds, Cloudflare gives you a unique preview URL for every branch push automatically ([source](https://developers.cloudflare.com/workers/ci-cd/builds/)). With GitHub Actions, use `wrangler versions upload --preview-alias <branch-name>` to get a per-version preview alias instead of promoting traffic ([source](https://developers.cloudflare.com/workers/wrangler/commands/workers/)).

---

## 8. Production checklist (20 lines)

Before you flip a production agent on:

1. `compatibility_date` pinned to a date you've actually tested (not "today").
2. `compatibility_flags: ["nodejs_compat"]` set.
3. All DO classes declared in `migrations` with `new_sqlite_classes` (not `new_classes`).
4. `migrations` tags are sequential and the latest one matches what's been applied to staging.
5. `observability.enabled = true`; `head_sampling_rate` at 1 for staging, 0.1–0.5 for high-volume prod.
6. `upload_source_maps: true` so production stack traces remap.
7. `placement.mode: "smart"` for agents that hit a single backend region.
8. `limits.cpu_ms` set to a sensible cap (60_000 for chat agents) — self-DoS guard.
9. All secrets set in production env via `wrangler secret put --env production` and listed in `secrets.required`.
10. `vars` contains nothing sensitive; double-check by viewing the deployed Worker in the dashboard.
11. Custom domain attached (`routes` with `custom_domain: true`); workers.dev disabled in prod (`workers_dev: false`).
12. CI runs `wrangler types --check` and `wrangler deploy --dry-run` on every PR.
13. CI deploy step uses `--env production` and surfaces `WRANGLER_OUTPUT_FILE_PATH` artifact.
14. Analytics Engine binding configured for cost/turn metrics; SQL dashboard saved.
15. Logpush job configured (or Tail Worker shipping to your SIEM) so logs survive the 7-day retention window.
16. Alerting on Workers Logs query: error rate > X%, exceptions per minute > Y. Use `outcome = "exception"` filter.
17. Cost dashboard pulls from Analytics Engine: rolling 24h cost_usd, with budget threshold alert.
18. Rollback plan: know your previous version-id (`wrangler versions list`) and how to `versions deploy --version-id=<id> --percentage=100`.
19. Vectorize index has been re-indexed against the same embedding model the agent uses; tested with a known query.
20. Per-DO request rate stays under the 1000 req/s soft limit ([source](https://developers.cloudflare.com/durable-objects/platform/limits/)) — shard if not.

---

## 9. Limits and pricing in one table

| Resource | Free | Paid (default) | Hard cap | Source |
|---|---|---|---|---|
| Worker requests | 100K/day | 10M/mo + $0.30/M | unlimited daily | [pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Worker CPU per invocation | 10 ms | 30s default, max 5 min | 5 min | [limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Worker CPU billing (Standard) | n/a | 30M CPU-ms/mo + $0.02/M | – | [pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Worker memory | 128 MB | 128 MB | 128 MB | [limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Worker subrequests | 50/req | 10,000/req | 10,000 | [limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Script size compressed | 3 MB | 10 MB | 10 MB | [limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Env vars per Worker | 64 | 128 | 128 | [limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Workers per account | 100 | 500 | 500 | [limits](https://developers.cloudflare.com/workers/platform/limits/) |
| DO classes per account | 100 | 500 | 500 | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| DO requests/s per object | – | 1,000 (soft) | – | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| DO storage per object (SQLite) | 10 GB | 10 GB | 10 GB | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| DO requests pricing | 100K/day | 1M/mo + $0.15/M | – | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| DO duration pricing | 13K GB-s/day | 400K GB-s/mo + $12.50/M GB-s | – | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| DO SQLite reads (from Jan 2026) | 5M/day | 25B/mo + $0.001/M rows | – | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| DO SQLite writes (from Jan 2026) | 100K/day | 50M/mo + $1.00/M rows | – | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| DO storage (SQLite) | 5 GB | 5 GB-mo + $0.20/GB-mo | – | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Workers AI | 10K Neurons/day | 10K free + $0.011/1K Neurons | – | [WAI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) |
| Vectorize queried dims | 30M/mo | 50M/mo + $0.01/M | – | [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/) |
| Vectorize stored dims | 5M total | 10M/mo + $0.05/100M | – | [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/) |
| Workers Logs retention | 3 days | 7 days | 7 days | [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) |
| Workers Logs volume | 200K/day | 20M/mo + $0.60/M | 5B/account/day | [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) |
| Workers Logs entry size | 256 KB | 256 KB | 256 KB | [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) |
| Tail concurrent clients | – | 10 per Worker | 10 | [real-time logs](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/) |
| Source map size | – | 15 MB gzipped | 15 MB | [source maps](https://developers.cloudflare.com/workers/observability/source-maps/) |

---

## 10. Gotchas

These are the foot-guns that have repeatedly bitten teams shipping Cloudflare Agents.

**Migrations are append-only.** Once any DO migration tag has been applied to a Worker, every future deploy must include a migration block. Never edit, reorder, or remove an applied tag. ([source](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)) Treat `migrations:` like a database migrations folder — additions only.

**Bindings and `vars` do not inherit into `env.*`.** This is the #1 newcomer trap. Top-level `kv_namespaces` are silently dropped when you run `--env staging` if `[env.staging]` doesn't repeat them. ([source](https://developers.cloudflare.com/workers/wrangler/environments/)) Always re-declare bindings in each environment block.

**Worker name vs env name.** The deployed Worker is named `<name>-<env>` automatically when you use `--env`. Do **not** hardcode the suffix into the top-level `name`. Putting `name: "ai-ideator-staging"` in `[env.staging]` creates a Worker called `ai-ideator-staging-staging`. ([source](https://developers.cloudflare.com/workers/wrangler/environments/))

**DO bindings cannot be `remote: true`.** You cannot point a local `wrangler dev` at a deployed DO instance. Workflows, secrets, vars, static assets, version metadata, Analytics Engine, Hyperdrive, and rate-limiting all share this restriction. ([source](https://developers.cloudflare.com/workers/development-testing/))

**Service binding to a different env requires the suffix.** If staging Worker A binds to staging Worker B, the binding must say `service: "worker-b-staging"`, not `worker-b`. ([source](https://developers.cloudflare.com/workers/wrangler/environments/))

**`wrangler deploy` overwrites dashboard-set vars by default.** If your team manages some `vars` from the dashboard (e.g. ops toggles), pass `--keep-vars` or every deploy resets them. ([source](https://developers.cloudflare.com/workers/wrangler/commands/workers/))

**Secret rotation needs `--secrets-file` or `wrangler versions secret put`.** Plain `wrangler secret put` without versions goes live to all current traffic instantly. For canary rotation use `wrangler versions secret put` so the new value is bound to a new version that you can ramp via `versions deploy --percentage`. ([source](https://developers.cloudflare.com/workers/configuration/secrets/))

**`head_sampling_rate` is per-invocation, not per-log-line.** Setting 0.1 means 10% of *requests* get **all** their logs captured; the other 90% get **none**. It's not a 10% slice of every console.log. Tune accordingly when tracking error rates. ([source](https://developers.cloudflare.com/workers/observability/logs/workers-logs/))

**Account daily 5B log ceiling triggers automatic 1% sampling.** A noisy agent on a large account can poison observability for everyone else. Consider Logpush to S3 for high-volume cases and keep `head_sampling_rate` modest. ([source](https://developers.cloudflare.com/workers/observability/logs/workers-logs/))

**WebSocket console.log is buffered until close.** If your agent uses WebSockets (the common case for streaming responses), don't expect to see logs in `wrangler tail` until the socket disconnects. Use Analytics Engine `writeDataPoint` for in-flight observability instead. ([source](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/))

**Tail Worker concurrent client limit is 10 per Worker.** A noisy team running multiple `wrangler tail` sessions plus dashboard tabs blocks each other. Use Logpush or Workers Logs for shared visibility. ([source](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/))

**KV-backed DOs are not the future.** `new_classes` (KV-backed) is paid-only, has no defined migration to SQLite, and the SQLite path is now the only one with full Free-tier access. Always use `new_sqlite_classes` for new agents. ([source](https://developers.cloudflare.com/durable-objects/platform/limits/), [source](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/))

**Per-DO 1000 req/s soft limit.** If an agent ID hot-spots (e.g. one team's run getting hammered), you'll silently saturate. Shard the DO key space. ([source](https://developers.cloudflare.com/durable-objects/platform/limits/))

**`wrangler types` output is gitignored by default in some templates.** Re-add `worker-configuration.d.ts` to git and gate CI on `git diff --exit-code worker-configuration.d.ts` after `wrangler types --check`. Otherwise developers run `wrangler types` locally, get types, but CI doesn't see them and TypeScript breaks in CI only.

**Secrets Store is unavailable in the China Network.** If you serve customers behind JD Cloud's CN edge, fall back to per-Worker `wrangler secret put`. ([source](https://developers.cloudflare.com/secrets-store/))

**Logpush truncates at 16,384 chars combined logs+exceptions.** Long agent traces get cut off mid-trace. Either prune with structured logging (one line per turn rather than dumping the full conversation) or ship to Tail Worker with custom batching. ([source](https://developers.cloudflare.com/workers/observability/logs/logpush/))

**`compatibility_date` controls behavior, not just APIs.** Bumping the date can change defaults like fetch behavior, streams semantics, or process.env handling. Pin it to a tested date and update deliberately, not as part of routine maintenance. ([source](https://developers.cloudflare.com/workers/wrangler/configuration/))

---

## Sources index

- Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
- Wrangler commands (workers): https://developers.cloudflare.com/workers/wrangler/commands/workers/
- Wrangler environments: https://developers.cloudflare.com/workers/wrangler/environments/
- Wrangler system env vars: https://developers.cloudflare.com/workers/wrangler/system-environment-variables/
- Wrangler API: https://developers.cloudflare.com/workers/wrangler/api/
- DO migrations: https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/
- DO limits: https://developers.cloudflare.com/durable-objects/platform/limits/
- DO pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/
- Workers Logs: https://developers.cloudflare.com/workers/observability/logs/workers-logs/
- Logpush: https://developers.cloudflare.com/workers/observability/logs/logpush/
- Tail Workers: https://developers.cloudflare.com/workers/observability/logs/tail-workers/
- Real-time logs: https://developers.cloudflare.com/workers/observability/logs/real-time-logs/
- DevTools: https://developers.cloudflare.com/workers/observability/dev-tools/
- Source maps: https://developers.cloudflare.com/workers/observability/source-maps/
- Analytics Engine: https://developers.cloudflare.com/analytics/analytics-engine/
- Analytics Engine SQL API: https://developers.cloudflare.com/analytics/analytics-engine/sql-api/
- Workers secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Secrets Store: https://developers.cloudflare.com/secrets-store/
- CI/CD overview: https://developers.cloudflare.com/workers/ci-cd/
- Workers Builds: https://developers.cloudflare.com/workers/ci-cd/builds/
- Workers Builds config: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- GitHub Actions: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- Local dev / testing: https://developers.cloudflare.com/workers/development-testing/
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Vectorize pricing: https://developers.cloudflare.com/vectorize/platform/pricing/
- Agents config: https://developers.cloudflare.com/agents/api-reference/configuration/
- agents-starter wrangler.jsonc: https://github.com/cloudflare/agents-starter/blob/main/wrangler.jsonc
