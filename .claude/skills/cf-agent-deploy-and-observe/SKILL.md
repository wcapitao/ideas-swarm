---
name: cf-agent-deploy-and-observe
description: >
  Production deploy and observability for a Cloudflare Agent. Activates
  when the user asks about "wrangler config", "wrangler.jsonc", "deploy
  the agent", "deploy to staging", "deploy to production", "migration",
  "secret put", "wrangler tail", "logpush", "CI/CD for the agent",
  "production checklist", "observability for the agent", "source maps",
  "smart placement", or "custom domain". Encodes the canonical
  wrangler.jsonc, the append-only DO migrations cookbook, the secrets
  two-step, the 5 logging surfaces (Workers Logs, wrangler tail, Tail
  Workers, Logpush, Analytics Engine), the GitHub Actions deploy.yml
  with branch-to-env mapping, the 20-line pre-launch checklist, and
  scripts that doctor wrangler.jsonc, smoke-test a deploy, and roll up
  cost from Analytics Engine + AI Gateway logs.
---

# cf-agent-deploy-and-observe

## Overview

A Cloudflare Agent reaches production through five artifacts: a correct
`wrangler.jsonc`, applied DO migrations, secrets in the target env, a
log/metrics pipeline, and a CI/CD job that gates deploy on type and
test checks. This skill produces all five to a known spec and refuses
the foot-guns called out in the gotchas section.

## When to use

| Trigger | Use? |
|---|---|
| "Set up wrangler config" / "wrangler.jsonc" | YES |
| "Deploy to staging / production" | YES |
| "Add a DO migration" / "rename DO class" | YES |
| "Set a secret" / "rotate a secret" | YES |
| "Set up Workers Logs / Logpush / tail" | YES |
| "CI/CD for the agent" / "GitHub Actions" | YES |
| "Pre-launch checklist" | YES |
| Designing the agent's architecture | NO -> `cf-agent-architect` |
| Writing tests / evals | NO -> `cf-agent-tests-and-evals` |
| OAuth / scopes / `this.props` | NO -> `cf-agent-auth-and-permissions` |

## The reference wrangler.jsonc (short form)

This is the minimum shape an agent author needs. Annotated full version
in `references/wrangler-reference.md`.

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "ai-ideator-agent",
  "main": "src/server.ts",
  "compatibility_date": "2026-04-30",
  "compatibility_flags": ["nodejs_compat"],

  "ai": { "binding": "AI", "remote": true },
  "vectorize": [
    { "binding": "VECTORIZE", "index_name": "ai-ideator-concepts", "remote": true }
  ],
  "analytics_engine_datasets": [
    { "binding": "METRICS", "dataset": "ai_ideator_metrics" }
  ],

  "durable_objects": {
    "bindings": [{ "name": "AGENT", "class_name": "IdeatorAgent" }]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["IdeatorAgent"] }
  ],

  "vars": { "LOG_LEVEL": "info", "MAX_TURNS": 12 },
  "secrets": { "required": ["OPENAI_API_KEY", "JWT_SIGNING_KEY"] },

  "observability": { "enabled": true, "head_sampling_rate": 1 },
  "upload_source_maps": true,
  "placement": { "mode": "smart" },
  "limits": { "cpu_ms": 60000 },

  "env": {
    "staging":    { "name": "ai-ideator-agent-staging" },
    "production": {
      "name": "ai-ideator-agent-production",
      "routes": [{ "pattern": "agent.example.com", "custom_domain": true }],
      "observability": { "enabled": true, "head_sampling_rate": 0.1 }
    }
  }
}
```

The trap: bindings and `vars` do NOT inherit into `env.*`. Every
binding (`ai`, `vectorize`, `kv_namespaces`, `durable_objects`,
`analytics_engine_datasets`) must be repeated under `env.staging` and
`env.production`. The deployed Worker is named `<name>-<env>`
automatically — do NOT include the env in the top-level `name`.

Full annotation, every line explained: `references/wrangler-reference.md`.

## Migrations cookbook

DO migrations are append-only, atomic, applied in tag order, and
tracked per environment. Once a tag has been applied, you cannot
reorder, rename, or remove it. Treat `migrations:` like a database
migrations folder.

| Operation | Directive | Notes |
|---|---|---|
| Add new class | `new_sqlite_classes: ["X"]` | Always SQLite, never `new_classes` |
| Rename class | `renamed_classes: [{from, to}]` | Don't also list `to` in `new_sqlite_classes` |
| Delete class | `deleted_classes: ["X"]` | Remove the binding first, deploy, then add this migration |
| Transfer class | `transferred_classes: [{from, from_script, to}]` | Move to a different Worker |

```jsonc
"migrations": [
  { "tag": "v1", "new_sqlite_classes": ["IdeatorAgent"] },
  { "tag": "v2", "new_sqlite_classes": ["RankerAgent"] },
  { "tag": "v3", "renamed_classes": [{ "from": "IdeatorAgent", "to": "IdeatorAgentV2" }] },
  { "tag": "v4", "deleted_classes": ["RankerAgent"] }
]
```

The hard rules:

1. First-deploy migration tag is the most common failure. If you
   declare a `durable_objects.bindings` entry without a matching
   migration tag, deploy fails with "no migration found for class". Add
   `{ "tag": "v1", "new_sqlite_classes": [...] }` on the first deploy.
2. Never KV-backed. `new_classes` is paid-only and has no automated
   migration to SQLite. There is no retrofit path. Always start
   `new_sqlite_classes`.
3. Append-only. Adding `v2` is fine; editing `v1` after it has been
   applied to any environment is broken-by-design.
4. Delete is two deploys. Remove the binding first (so the runtime
   isn't holding a reference), deploy, then add the `deleted_classes`
   migration.

Full recipes for the four operations: `references/migrations-cookbook.md`.

## Local dev workflow

`wrangler dev` runs your Worker on `workerd` via Miniflare. Default is
local-with-simulated-bindings. The fakery matrix:

| Binding | Default | Can be remote? | Can be local? |
|---|---|---|---|
| Durable Objects | local | No | yes |
| KV | local | yes | yes |
| R2 | local | yes | yes |
| D1 | local | yes | yes |
| Workers AI | always remote | yes | no |
| Vectorize | always remote | yes | no |
| Secrets / vars | always local | No | yes |
| Analytics Engine | always local | No | yes |
| Hyperdrive | always local | No | yes |

For an Agent: DOs cannot be remote, so you always run a local DO during
dev; AI and Vectorize are always remote in dev. Use `--persist-to <dir>`
to keep DO state across restarts so the conversation history survives.

```bash
wrangler dev --env staging --persist-to .wrangler/state/staging
```

For end-to-end network behavior, `wrangler dev --remote` deploys to
preview infra. Slow iteration; sparingly.

DevTools: press `D` in the `wrangler dev` terminal for Chrome DevTools
(console, breakpoints, profiler).

## The 15 commands

| # | Command | Purpose |
|---|---|---|
| 1 | `wrangler login` | OAuth into your Cloudflare account |
| 2 | `wrangler whoami` | Show account / email / id |
| 3 | `wrangler dev --env staging` | Local dev server, simulated bindings |
| 4 | `wrangler dev --remote` | Local code, real Cloudflare preview infra |
| 5 | `wrangler deploy --env production` | Build + upload + activate |
| 6 | `wrangler deploy --dry-run --outdir=dist` | Build only, for PR CI |
| 7 | `wrangler tail --env production --format json --status error` | Live log stream, max 10 concurrent |
| 8 | `wrangler types --env-interface Env` | Generate TS types for `Env` |
| 9 | `wrangler types --check` | Verify types are up to date (CI gate) |
| 10 | `echo $K \| wrangler secret put OPENAI_API_KEY --env production` | Set one secret |
| 11 | `wrangler secret bulk .env.production --env production` | Upload many secrets |
| 12 | `wrangler kv namespace create CACHE` | Create KV namespace, prints id |
| 13 | `wrangler vectorize create ai-ideator-concepts --dimensions=1024 --metric=cosine` | Create Vectorize index |
| 14 | `wrangler r2 bucket create ai-ideator-raw` | Create R2 bucket |
| 15 | `wrangler versions list && wrangler versions deploy --version-id=<id> --percentage=10` | Canary / rollback |

Useful flags:
- `wrangler tail --search "max_turns" --sampling-rate 0.1` filters the live stream.
- `wrangler deploy --keep-vars` preserves dashboard-set vars.
- `wrangler deploy --secrets-file .env.production` ships secrets atomically with code.
- `WRANGLER_OUTPUT_FILE_PATH=deploy.ndjson` captures a structured deploy summary for CI.

Full cheatsheet with examples: `references/wrangler-cheatsheet.md`.

## Logs and tracing — the 5 surfaces

Pick deliberately. They overlap; each has a different cost / latency /
shape.

| # | Surface | What it's for | Cost shape | Gotcha |
|---|---|---|---|---|
| 1 | Workers Logs (`observability.enabled`) | Default queryable JSONL store, dashboard search | 200K/day Free, 20M/mo Paid + $0.60/M | `head_sampling_rate` is per-INVOCATION, not per-line |
| 2 | `wrangler tail` | Watching live, debugging now | Free | 10 concurrent max; WebSocket logs buffered until close |
| 3 | Tail Workers | Programmatic event ingest -> your service | Worker pricing | Paid+ only; 10 client cap shared with tail |
| 4 | Logpush | Bulk shipping to S3 / R2 / Datadog / Splunk | Workers Paid only | 16,384-char truncation on logs+exceptions combined |
| 5 | Analytics Engine | Custom metrics with SQL, high cardinality | $0.25/M data points, $1.50/M reads (sample-weighted) | Always weight queries by `_sample_interval` |

The `head_sampling_rate` semantics: `0.1` means 10% of *requests* get
all their logs; the other 90% get none. It is not "one in ten
console.log calls." When you tune for high-traffic Workers, this
matters: low rate hides full traces of selected requests rather than
slicing every trace.

The 5B/day account-wide ceiling: when an account exceeds 5 billion log
events in a day, Cloudflare auto-samples to 1% to protect the fleet. A
noisy agent on a large account can poison observability for everyone
else. Modulate `head_sampling_rate` for high-volume agents and ship
critical metrics to Analytics Engine instead.

WebSocket buffered logs: `console.log` from inside a WebSocket handler
is buffered until the socket closes. Don't expect to see streaming-agent
logs in `wrangler tail`. Use Analytics Engine `writeDataPoint` for
in-flight observability; ship per-turn metrics that show up immediately.

Source maps: `"upload_source_maps": true` makes Wrangler upload the
`.js.map` alongside the bundle; Cloudflare remaps stack traces in
Workers Logs / tail / dashboard. Async, no runtime cost. Min Wrangler
3.46.0; max 15 MB gzipped.

Full surface-by-surface breakdown with examples: `references/logs-and-tracing.md`.

## Secrets

The rule: `vars` for non-secret config, `wrangler secret put` for
everything sensitive. `vars` are plaintext in the dashboard; secrets
become invisible after set.

### Two-step put

```bash
# Interactive
wrangler secret put OPENAI_API_KEY --env production

# Piped (CI-friendly)
echo "$OPENAI_API_KEY" | wrangler secret put OPENAI_API_KEY --env production

# Bulk
wrangler secret bulk .env.production --env production

# Atomic with code deploy
wrangler deploy --env production --secrets-file .env.production
```

### Local dev secrets

`.dev.vars` at project root, gitignored. Per-env: `.dev.vars.staging`,
`.dev.vars.production`.

### Declarative `secrets.required`

```jsonc
"secrets": { "required": ["OPENAI_API_KEY", "JWT_SIGNING_KEY"] }
```

Makes `wrangler deploy` fail loudly when a required secret is missing.
Ship this on day one — it catches the "deployed without the key, agent
404s in prod" failure mode.

### Secrets Store (cross-Worker sharing)

Account-scoped vault: one secret value bound to many Workers. Rotate
once, propagates everywhere. Available for Workers and AI Gateway.
Unavailable in the Cloudflare China Network — fall back to per-Worker
`wrangler secret put` for CN deployments.

### Rotation runbook

Plain `wrangler secret put` flips immediately for all current traffic.
For canary rotation:

```bash
# Bind the new secret to a NEW version, no traffic yet
wrangler versions secret put OPENAI_API_KEY --env production
wrangler versions upload --tag canary --message "rotate openai key"

# Ramp 10% traffic
wrangler versions deploy --version-id=<new-id> --percentage=10

# Watch tail / Workers Logs for errors, then ramp to 100%
wrangler versions deploy --version-id=<new-id> --percentage=100
```

Full secrets playbook: `references/secrets.md`.

## CI/CD recipe

Branch-to-env mapping:

| Branch | Env | Action |
|---|---|---|
| PR (any) | preview | `wrangler deploy --dry-run`, no traffic |
| `staging` | staging | `wrangler deploy --env staging` |
| `main` | production | `wrangler deploy --env production` |

Skeleton (full file in `references/ci-cd.md`):

```yaml
name: Deploy Agent
on:
  push: { branches: [main, staging] }
  pull_request: { branches: [main] }

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "npm" }
      - run: npm ci
      - run: npx wrangler types --env-interface Env
      - run: git diff --exit-code worker-configuration.d.ts
      - run: npx tsc --noEmit
      - run: npm test
      - run: npx wrangler deploy --dry-run --outdir=dist

  deploy:
    needs: test
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "npm" }
      - run: npm ci
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: >
            deploy --env
            ${{ github.ref == 'refs/heads/main' && 'production' || 'staging' }}
          secrets: |
            OPENAI_API_KEY
            JWT_SIGNING_KEY
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          JWT_SIGNING_KEY: ${{ secrets.JWT_SIGNING_KEY }}
```

Pattern notes:
- `wrangler types --check` followed by `git diff --exit-code` catches
  the classic "added a binding, forgot to commit regenerated
  types" — TS green locally, red in CI only.
- The `secrets:` input on `wrangler-action@v3` reads each named secret
  from the job env and pipes it through `wrangler secret put`, so
  secrets are atomically set alongside code.
- Required GitHub secrets: `CLOUDFLARE_API_TOKEN` (Workers Edit +
  Workers KV Edit + Workers AI + Workers Vectorize permissions),
  `CLOUDFLARE_ACCOUNT_ID`.

Full deploy.yml + preview-alias-per-branch recipe: `references/ci-cd.md`.

## Production checklist

20 items. Don't flip the switch with any unchecked.

```
[ ] 1.  compatibility_date pinned to a date you've actually tested
[ ] 2.  compatibility_flags includes "nodejs_compat"
[ ] 3.  All DO classes declared in migrations as new_sqlite_classes (never new_classes)
[ ] 4.  migrations tags are sequential; latest matches what's applied to staging
[ ] 5.  observability.enabled = true
[ ] 6.  head_sampling_rate < 1.0 if requests/sec > ~100
[ ] 7.  upload_source_maps = true
[ ] 8.  placement.mode = "smart" if you call a single backend region
[ ] 9.  limits.cpu_ms set (60_000 for chat agents) — self-DoS guard
[ ] 10. All secrets set in target env via wrangler secret put --env production
[ ] 11. secrets.required manifest matches what's actually set
[ ] 12. vars contains nothing sensitive (verify in dashboard)
[ ] 13. Custom domain attached via routes[].custom_domain = true
[ ] 14. workers_dev = false in production env (kill the public *.workers.dev URL)
[ ] 15. CI runs wrangler types --check + wrangler deploy --dry-run on every PR
[ ] 16. Analytics Engine dataset bound; SQL dashboard saved
[ ] 17. Logpush job OR Tail Worker shipping logs to long-term store
[ ] 18. Alert on Workers Logs outcome = "exception" rate, AIG error budget
[ ] 19. Cost ceiling alert from Analytics Engine sum(cost_usd) per day
[ ] 20. Vectorize index dimension matches your embedding model; tested with known query
```

Same checklist with rationale per item: `references/prod-checklist.md`.

## Limits and pricing — short form

The numbers you should keep in your head:

| Resource | Critical number |
|---|---|
| DO duration (Standard) | $12.50/M GB-s — dominant cost for hibernating agents |
| DO requests | $0.15/M after 1M/mo free |
| DO SQLite reads | $0.001/M rows (cheap) |
| DO SQLite writes | $1.00/M rows (~1000x more expensive than reads) |
| Workers AI | $0.011 per 1K Neurons |
| Vectorize queried dims | $0.01 per M dimensions queried |
| Vectorize stored dims | $0.05 per 100M dimensions stored |
| Workers Logs | $0.60/M after 20M/mo Paid |
| Workers requests | $0.30/M after 10M/mo Paid |
| Worker CPU billing (Standard) | $0.02 per M CPU-ms |

For an agent: DO duration GB-s usually dominates because the DO is
alive whenever a WebSocket is connected (use hibernation), Vectorize is
priced per-dimension (favor compact embedding models), Workers AI
Neurons are model-specific (8B Llama is roughly 1 Neuron per token).

24-row pricing table with sources and edge cases:
`references/limits-and-pricing.md`.

## 16 gotchas

1. KV-backed DOs are dead-end. `new_classes` is paid-only and has no
   migration path to SQLite. Always `new_sqlite_classes`.
2. First-deploy migration tag is the most common failure. Declare a
   class binding without a matching migration -> deploy 500s.
3. Bindings don't inherit into `env.*`. Top-level `kv_namespaces` are
   silently dropped under `--env staging`. Re-declare every binding.
4. Worker name suffixing. `--env staging` -> `<name>-staging`
   automatically. Don't put `-staging` in the env's `name` or you get
   `<name>-staging-staging`.
5. DO bindings can't be `remote: true`. Ditto secrets, vars, Analytics
   Engine, Hyperdrive, Workflows, version metadata, static assets,
   rate-limiting.
6. `worker-configuration.d.ts` git-tracking trap. Many templates
   gitignore it. Re-add to git, gate CI on `git diff --exit-code` after
   `wrangler types --check`. Otherwise types green locally, red in CI.
7. `wrangler deploy` overwrites dashboard-set vars by default. Use
   `--keep-vars` if your team manages ops toggles in the dashboard.
8. Secret rotation flips instantly without versions. Use
   `wrangler versions secret put` + `versions deploy --percentage` for
   canary rotation.
9. `head_sampling_rate` is per-invocation. 0.1 = 10% of requests get
   all logs, not 10% of every console.log.
10. 5B/day account log ceiling triggers 1% auto-sampling. Noisy agent
    poisons observability for the whole account.
11. WebSocket `console.log` is buffered until socket close. Use
    Analytics Engine `writeDataPoint` for live streaming
    observability.
12. Tail concurrent client limit is 10 per Worker. Multiple devs +
    dashboard tabs starve each other. Use Logpush for shared
    visibility.
13. Logpush truncates at 16,384 chars combined logs+exceptions. Long
    agent traces get cut. Structured per-turn logs, not full
    conversation dumps.
14. Secrets Store unavailable in CN edge. Fall back to per-Worker
    secrets if you serve customers behind JD Cloud.
15. `compatibility_date` controls behavior, not just APIs. Bumping can
    change `fetch` semantics, streams, `process.env`. Pin to a tested
    date; update deliberately.
16. Service binding to a different env needs the suffix. Staging
    Worker A binds to staging Worker B as `service: "worker-b-staging"`,
    not `worker-b`.

## Hand-offs

| Need | Skill |
|---|---|
| CI test step / vitest pool / runInDurableObject | `cf-agent-tests-and-evals` |
| DO migration linter / when to add `new_sqlite_classes` | `cf-agent-state-and-storage` |
| OAuth on the agent / scopes / `this.props` | `cf-agent-auth-and-permissions` |
| AI Gateway dashboard wiring | `cf-agent-models-and-gateway` |
| Architecture decisions before any of this | `cf-agent-architect` |

## Scripts

- `scripts/wrangler-doctor.sh` — sanity-checks `wrangler.jsonc`: every
  `durable_objects.bindings` has a matching migration tag,
  `compatibility_date` is recent, `compatibility_flags` includes
  `nodejs_compat` if any node API is imported, `observability.enabled`
  is true, no `wrangler.toml` siding alongside (mixed config).
- `scripts/verify-deploy.sh` — post-deploy smoke test. Hits `/health`,
  `/.well-known/oauth-authorization-server` (if MCP), MCP `initialize`,
  sample tool call. Reports each step.
- `scripts/cost-tracker.ts` — pulls Workers Analytics Engine SQL
  ($1.50/M reads weighted by `_sample_interval`) + AIG logs API. Rolls
  up daily cost per agent. JSON + Markdown output for Slack.

## Reference index

| File | Purpose |
|---|---|
| `references/wrangler-reference.md` | Annotated `wrangler.jsonc`, every line explained |
| `references/migrations-cookbook.md` | Add / rename / delete / transfer recipes |
| `references/wrangler-cheatsheet.md` | 15 commands with concrete examples |
| `references/logs-and-tracing.md` | The 5 surfaces compared, with code |
| `references/secrets.md` | `vars` vs secret put, Secrets Store, rotation |
| `references/ci-cd.md` | Full GitHub Actions deploy.yml |
| `references/prod-checklist.md` | 20 items with rationale |
| `references/limits-and-pricing.md` | 24-row table |
