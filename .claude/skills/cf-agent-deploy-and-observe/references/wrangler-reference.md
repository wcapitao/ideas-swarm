# Annotated `wrangler.jsonc` for a Cloudflare Agent

Every line is annotated with WHAT it does and WHY you'd set it that
way for an agent. Mirrors the `agents-starter` template plus production
hardening (observability, smart placement, source maps,
secrets.required).

```jsonc
{
  // ── Schema + IDE help ────────────────────────────────────────────────
  // Wrangler ships its config schema in node_modules so jsonc gets
  // autocomplete + lint in VSCode.
  "$schema": "node_modules/wrangler/config-schema.json",

  // ── Identity ────────────────────────────────────────────────────────
  // Top-level Worker name. Used to build the *.workers.dev hostname when
  // workers_dev:true. With --env staging the deployed Worker becomes
  // "<name>-staging" automatically; do NOT put "-staging" here.
  "name": "ai-ideator-agent",

  // Entrypoint: re-exports the default fetch handler AND every Durable
  // Object class.
  "main": "src/server.ts",

  // ── Runtime version pinning ─────────────────────────────────────────
  // Pins workerd's behavior. Bumping this can change Web/Node API
  // semantics (fetch, streams, process.env). Pin to a tested date; do
  // not auto-bump in CI.
  "compatibility_date": "2026-04-30",

  // Required for Agents — they use Node-flavored APIs (crypto, streams,
  // async_hooks). Do NOT remove.
  "compatibility_flags": ["nodejs_compat"],

  // ── Static assets (optional) ─────────────────────────────────────────
  // The SPA shell that ships with the Worker. run_worker_first lets
  // /agents/* and /oauth/* skip the asset handler and go straight to
  // the Worker fetch handler.
  "assets": {
    "directory": "./public",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/agents/*", "/oauth/*"]
  },

  // ── Bindings ─────────────────────────────────────────────────────────
  // BINDINGS DO NOT INHERIT INTO env.*. Whatever you define here must be
  // re-declared under env.staging / env.production.

  // Workers AI: model inference. remote:true means even `wrangler dev`
  // hits real Cloudflare AI — there's no local simulation.
  "ai": { "binding": "AI", "remote": true },

  // Vectorize: ANN index for embeddings. Always remote. Bind by
  // index_name (created with `wrangler vectorize create`).
  "vectorize": [
    {
      "binding": "VECTORIZE",
      "index_name": "ai-ideator-concepts",
      "remote": true
    }
  ],

  // KV: cheap shared cache. preview_id keeps `wrangler dev` from
  // poisoning your prod KV.
  "kv_namespaces": [
    { "binding": "CACHE", "id": "<kv-id>", "preview_id": "<kv-preview-id>" }
  ],

  // R2: blob storage (raw KB documents, exports).
  "r2_buckets": [
    { "binding": "RAW", "bucket_name": "ai-ideator-raw" }
  ],

  // Analytics Engine: high-cardinality SQL-queryable metrics. Use this
  // for per-run cost, per-model latency. Always local in `wrangler dev`.
  "analytics_engine_datasets": [
    { "binding": "METRICS", "dataset": "ai_ideator_metrics" }
  ],

  // ── Durable Objects ──────────────────────────────────────────────────
  // The Agent class. `name` is the binding (env.AGENT in code). Must
  // match the exported class symbol in src/server.ts.
  "durable_objects": {
    "bindings": [
      { "name": "AGENT", "class_name": "IdeatorAgent" }
    ]
  },

  // ── DO migrations (append-only) ─────────────────────────────────────
  // Each tag is unique and applied in order, tracked per-environment.
  // Once applied, NEVER reorder, edit, or delete a tag.
  // Always use new_sqlite_classes — never new_classes (the legacy
  // KV-backed path with no migration to SQLite).
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["IdeatorAgent"] }
  ],

  // ── Non-secret config ────────────────────────────────────────────────
  // Plaintext, visible in dashboard. NEVER put API keys here.
  "vars": {
    "LOG_LEVEL": "info",
    "MAX_TURNS": 12,
    "MODEL_DEFAULT": "@cf/meta/llama-3.3-70b-instruct"
  },

  // ── Declarative secret manifest ──────────────────────────────────────
  // Makes `wrangler deploy` fail loudly if a secret isn't set in the
  // target env. Catches "deployed without API key, agent 500s in prod".
  "secrets": {
    "required": ["OPENAI_API_KEY", "JWT_SIGNING_KEY"]
  },

  // ── Observability ────────────────────────────────────────────────────
  // Enables Workers Logs (the queryable JSONL store, dashboard search).
  // head_sampling_rate is 0–1; 1 logs every invocation, 0.1 logs 10%.
  // Per-INVOCATION (not per-line): 0.1 means 10% of requests get ALL
  // their logs; the other 90% get NONE.
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  },

  // Stack-trace remap for uncaught exceptions. Async, no runtime cost.
  // Min Wrangler 3.46.0; max 15 MB gzipped.
  "upload_source_maps": true,

  // ── Smart Placement ──────────────────────────────────────────────────
  // Moves the Worker isolate closer to its heaviest backend (e.g. an
  // upstream LLM in us-east-1). Real latency win when an agent hits a
  // single backend region. No-op when traffic is global.
  "placement": { "mode": "smart" },

  // ── Limits ──────────────────────────────────────────────────────────
  // CPU budget per invocation in ms. Standard model allows up to 300_000
  // (5 min). 60_000 is a sensible cap for a chat agent — self-DoS guard
  // against runaway turn loops.
  "limits": { "cpu_ms": 60000 },

  // ── Logpush (optional) ───────────────────────────────────────────────
  // Setting "logpush": true unlocks Logpush jobs (configure via
  // dashboard / API). Workers Paid only.
  // "logpush": true,

  // ── Tail Workers (optional) ──────────────────────────────────────────
  // Sends every TraceItem to a separate Worker for custom processing.
  // Available on Paid+. Useful for shipping to a custom SIEM.
  // "tail_consumers": [{ "service": "ai-ideator-tail" }],

  // ── Per-environment overrides ────────────────────────────────────────
  "env": {
    "staging": {
      "name": "ai-ideator-agent-staging",
      "vars": {
        "LOG_LEVEL": "debug",
        "MAX_TURNS": 12,
        "MODEL_DEFAULT": "@cf/meta/llama-3.3-70b-instruct"
      },
      // Re-declare every binding. Inheritance does NOT happen.
      "ai": { "binding": "AI", "remote": true },
      "vectorize": [
        { "binding": "VECTORIZE", "index_name": "ai-ideator-concepts-staging", "remote": true }
      ],
      "kv_namespaces": [{ "binding": "CACHE", "id": "<staging-kv-id>" }],
      "durable_objects": {
        "bindings": [{ "name": "AGENT", "class_name": "IdeatorAgent" }]
      },
      "analytics_engine_datasets": [
        { "binding": "METRICS", "dataset": "ai_ideator_metrics_staging" }
      ],
      "observability": { "enabled": true, "head_sampling_rate": 1 }
    },

    "production": {
      "name": "ai-ideator-agent-production",
      // Custom domain. workers_dev:false kills the public *.workers.dev
      // URL so prod traffic only flows through your domain.
      "routes": [{ "pattern": "agent.example.com", "custom_domain": true }],
      "workers_dev": false,
      "vars": {
        "LOG_LEVEL": "warn",
        "MAX_TURNS": 12,
        "MODEL_DEFAULT": "@cf/meta/llama-3.3-70b-instruct"
      },
      "ai": { "binding": "AI", "remote": true },
      "vectorize": [
        { "binding": "VECTORIZE", "index_name": "ai-ideator-concepts", "remote": true }
      ],
      "kv_namespaces": [{ "binding": "CACHE", "id": "<prod-kv-id>" }],
      "durable_objects": {
        "bindings": [{ "name": "AGENT", "class_name": "IdeatorAgent" }]
      },
      "analytics_engine_datasets": [
        { "binding": "METRICS", "dataset": "ai_ideator_metrics" }
      ],
      // Drop sampling for high-traffic prod. 0.1–0.5 typical.
      "observability": { "enabled": true, "head_sampling_rate": 0.1 }
    }
  }
}
```

## What's intentionally NOT here

- **`triggers.crons`** — schedule via the agent's DO `alarm()` instead
  (better state, fewer cold starts).
- **`workers_dev: true` in prod** — public default URL is a leak risk;
  always `false` in production.
- **`build.command`** — modern templates skip this; Wrangler bundles
  via esbuild automatically. Add only if you have a custom build step.
- **`node_compat`** — deprecated; use `compatibility_flags:
  ["nodejs_compat"]`.

## Validation

Run `scripts/wrangler-doctor.sh` to lint this file. It checks that
every DO binding has a migration tag, the date is recent, observability
is on, and no `wrangler.toml` is siding alongside a `wrangler.jsonc`
(mixed config silently breaks).

## Sources

- Wrangler config: https://developers.cloudflare.com/workers/wrangler/configuration/
- Environments: https://developers.cloudflare.com/workers/wrangler/environments/
- Agents config: https://developers.cloudflare.com/agents/api-reference/configuration/
- DO migrations: https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/
- Source maps: https://developers.cloudflare.com/workers/observability/source-maps/
- Smart Placement: https://developers.cloudflare.com/workers/configuration/smart-placement/
- agents-starter: https://github.com/cloudflare/agents-starter/blob/main/wrangler.jsonc
