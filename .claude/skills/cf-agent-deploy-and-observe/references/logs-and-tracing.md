# Logs and tracing — the 5 surfaces

Cloudflare gives you 5 overlapping log surfaces for a Workers / Agent
deployment. Pick deliberately. Each has a different cost / latency /
shape.

| # | Surface | What it's for | Latency | Cost shape | Retention |
|---|---|---|---|---|---|
| 1 | Workers Logs (`observability.enabled`) | Default queryable JSONL store | seconds | $0.60/M after 20M Paid | 3 days Free / 7 days Paid |
| 2 | `wrangler tail` | Watching live, debugging now | seconds | Free | session lifetime |
| 3 | Tail Workers (`tail_consumers`) | Programmatic event ingest | seconds | Worker pricing | wherever you ship to |
| 4 | Logpush | Bulk shipping to S3 / R2 / Datadog / Splunk | minutes | Workers Paid only | wherever you ship to |
| 5 | Analytics Engine (`writeDataPoint`) | High-cardinality SQL metrics | seconds | $0.25/M data points + $1.50/M reads | varies by query window |

## 1. Workers Logs — your default

Enable in config:

```jsonc
"observability": {
  "enabled": true,
  "head_sampling_rate": 0.1
}
```

Captured fields per invocation: request method/URL/headers, response
status, every `console.log` call, uncaught exceptions, CPU time, wall
time. Query in the dashboard with a SQL-like UI. Retention: 3 days
Free, 7 days Paid. Volume: 200K/day Free, 20M/mo Paid + $0.60/M.
Single entry max: 256 KB.

For an agent: log structured objects, not strings. The dashboard
indexes object keys for fast filtering.

```ts
console.log({
  event: "agent.turn",
  run_id: ctx.runId,
  turn,
  model: env.MODEL_DEFAULT,
  input_tokens: usage.input,
  output_tokens: usage.output,
  cost_usd: usage.cost,
});
```

### `head_sampling_rate` — the per-INVOCATION trap

The number you set (0–1) is the fraction of *requests* that get
captured, not the fraction of log lines. `0.1` means 10% of requests
get **all** their logs, the other 90% get **none**.

**Why it matters:** if your agent has rare error paths, low sampling
hides them entirely (rather than showing a tenth of every error). For
high-traffic Workers tracking error rates, a low rate is fine because
errors are still distributed in the sample. For debugging a specific
class of bug, push it back to 1 temporarily and look for the smoking
gun.

Source: https://developers.cloudflare.com/workers/observability/logs/workers-logs/

### The 5B/day account-wide ceiling

When an account exceeds 5 billion log events in a day, Cloudflare
auto-samples to 1% to protect the fleet. This applies account-wide,
not per-Worker. A noisy agent on a busy account can poison
observability for sibling Workers.

Mitigations:
- Lower `head_sampling_rate` for the noisy Worker.
- Move per-turn metrics off Workers Logs and onto Analytics Engine
  `writeDataPoint` (no contribution to the 5B/day cap).
- Use Logpush to ship Workers Logs to a long-term store and rely on the
  external tool for queries.

## 2. `wrangler tail` — live stream

For watching a deployed agent live during a fix or rollout:

```bash
wrangler tail --env production --format json --search "error" \
  | jq 'select(.outcome == "exception")'
```

Filters: `--status ok|error|canceled`, `--method`, `--search`,
`--sampling-rate`, `--header`, `--ip`.

**Limits:**
- Max 10 concurrent tailers per Worker (shared with Tail Workers).
- High-traffic Workers get auto-sampled by tail; you'll see a warning.
- WebSocket `console.log` is buffered until the socket closes — your
  streaming agent's logs won't appear until the client disconnects.

Source: https://developers.cloudflare.com/workers/observability/logs/real-time-logs/

## 3. Tail Workers — programmatic event ingest

A Tail Worker is a separate Worker that consumes the producer's log
events. Use when you want custom processing (PII redaction, batching
to a SIEM, fan-out to multiple sinks).

In the producer's `wrangler.jsonc`:

```jsonc
"tail_consumers": [{ "service": "ai-ideator-tail" }]
```

In `tail-worker/src/index.ts`:

```ts
export default {
  async tail(events: TraceItem[]) {
    // Each event is a structured TraceItem with logs, exceptions,
    // diagnostics, scriptName, etc.
    const filtered = events.map(e => ({
      ...e,
      logs: e.logs.filter(l => !l.message.some(m => /sk-|Bearer/.test(String(m)))),
    }));

    await fetch("https://logs.example.com/cf-events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(filtered),
    });
  },
};
```

Available on Paid + Enterprise. Subject to the same 10-client cap as
`wrangler tail`.

Source: https://developers.cloudflare.com/workers/observability/logs/tail-workers/

## 4. Logpush — bulk ship to S3 / R2 / Datadog

For long-term archival or shipping to your SIEM. Configure once via
dashboard or API; events flow continuously.

In `wrangler.jsonc`:

```jsonc
"logpush": true
```

Then create a Logpush job (dashboard or API):

```bash
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/logpush/jobs" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "ai-ideator-prod-logs",
    "destination_conf": "r2://ai-ideator-logs/{DATE}",
    "dataset": "workers_trace_events",
    "output_options": {
      "field_names": ["Event", "EventTimestampMs", "Outcome", "Exceptions",
                      "Logs", "ScriptName", "Outcome", "DispatchNamespace"],
      "timestamp_format": "unixnano"
    },
    "enabled": true
  }'
```

**Limits:**
- Workers Paid plan only.
- Min Wrangler 2.2.0.
- Combined `Logs + Exceptions` field truncates at 16,384 chars. Long
  agent traces get cut. Mitigate with structured logging (one line per
  turn rather than full conversation dumps).

Source: https://developers.cloudflare.com/workers/observability/logs/logpush/

## 5. Analytics Engine — custom metrics with SQL

For high-cardinality metrics you want to query with SQL: per-user cost,
per-model latency, per-tool error rate. Cheap to write, cheap to query
when you weight by `_sample_interval`.

Bind:

```jsonc
"analytics_engine_datasets": [
  { "binding": "METRICS", "dataset": "ai_ideator_metrics" }
]
```

Write per-event:

```ts
env.METRICS.writeDataPoint({
  // Indexes: used for sampling key. Up to 1 per data point.
  indexes: [run.userId],
  // Blobs: up to 20 string fields. Searchable.
  blobs: [run.model, run.outcome, run.toolName ?? ""],
  // Doubles: up to 20 numeric fields. Aggregate-able.
  doubles: [run.costUsd, run.tokens, run.durationMs],
});
```

**Always weight by `_sample_interval` in queries** — Cloudflare
auto-samples writes when volume is high, and `_sample_interval`
captures how many real events each row represents.

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  --data "SELECT
            blob1 AS model,
            SUM(_sample_interval) AS calls,
            SUM(double1 * _sample_interval) AS cost_usd_total,
            quantile(0.95)(double3) AS p95_duration_ms
          FROM ai_ideator_metrics
          WHERE timestamp > NOW() - INTERVAL '1' DAY
          GROUP BY blob1
          ORDER BY cost_usd_total DESC"
```

**Pricing:** $0.25 per M data points written, $1.50 per M reads
(weighted by `_sample_interval`). Cheap. Great for dashboards.

Source: https://developers.cloudflare.com/analytics/analytics-engine/sql-api/

## Source maps

Set in `wrangler.jsonc`:

```jsonc
"upload_source_maps": true
```

Wrangler uploads the `.js.map` next to the bundle. Cloudflare remaps
stack traces in Workers Logs / tail / dashboard. Async, no runtime
cost. Min Wrangler 3.46.0; max 15 MB gzipped.

Without source maps, your agent's stack traces look like:
```
at h (worker.js:1:14829)
at u (worker.js:1:13201)
```

With source maps:
```
at maybeCallTool (src/agent.ts:142:18)
at IdeatorAgent.onMessage (src/agent.ts:87:5)
```

Worth the 0 cost.

## When to pick what

| Need | Surface |
|---|---|
| "I want to see what's happening RIGHT NOW" | `wrangler tail` |
| "I want to query last hour's errors by URL" | Workers Logs |
| "I want to ship every log to Datadog" | Logpush |
| "I want a per-tenant cost dashboard" | Analytics Engine |
| "I want to redact PII before logging" | Tail Worker |
| "My agent is dying, I need stack traces" | source maps + Workers Logs |

The default stack: `observability.enabled` + Analytics Engine for
metrics + source maps. Add Logpush when retention or SIEM matters.

## Common patterns for an agent

### Per-turn metric write

```ts
async onMessage(msg: string) {
  const start = Date.now();
  const usage = await this.runTurn(msg);
  this.env.METRICS.writeDataPoint({
    indexes: [this.ctx.id.toString()],
    blobs: [this.env.MODEL_DEFAULT, usage.subtype],
    doubles: [usage.costUsd, usage.tokens, Date.now() - start],
  });
}
```

### Structured agent_end log (Workers Logs)

```ts
console.log({
  event: "agent_end",
  run_id: ctx.runId,
  session_id: this.ctx.id.toString(),
  subtype: result.subtype, // "success" | "error_max_turns" | "error_max_budget"
  cost_usd: result.cost,
  turns: result.turns,
  latency_ms: Date.now() - ctx.startedAt,
});
```

### Outcome alert query (Workers Logs)

In the dashboard's Logs page, save a view with filter:

```
$.event = "agent_end" AND $.subtype != "success"
```

Set a notification when count > 0 in the last 5 minutes.
