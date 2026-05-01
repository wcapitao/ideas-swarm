# Limits and pricing

Numbers as of April 2026. Cloudflare adjusts pricing periodically;
treat this as a reference, not a contract. Re-verify before signing
anything.

| Resource | Free | Paid (default) | Hard cap | Source |
|---|---|---|---|---|
| Worker requests | 100K/day | 10M/mo + $0.30/M | unlimited daily | [pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Worker CPU per invocation | 10 ms | 30s default, max 5 min | 5 min | [limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Worker CPU billing (Standard) | n/a | 30M CPU-ms/mo + $0.02/M | – | [pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Worker memory | 128 MB | 128 MB | 128 MB | [limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Worker subrequests per invocation | 50 | 1,000 (Standard) / 10,000 (Bundled) | 10,000 | [limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Script size compressed | 3 MB | 10 MB | 10 MB | [limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Env vars per Worker | 64 | 128 | 128 | [limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Workers per account | 100 | 500 | 500 | [limits](https://developers.cloudflare.com/workers/platform/limits/) |
| DO classes per account | 100 | 500 | 500 | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| DO requests/s per object | – | 1,000 (soft) | – | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| DO storage per object (SQLite) | 10 GB | 10 GB | 10 GB | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| DO requests pricing | 100K/day | 1M/mo + $0.15/M | – | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| DO duration pricing (Standard) | 13K GB-s/day | 400K GB-s/mo + $12.50/M GB-s | – | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| DO SQLite reads (from Jan 2026) | 5M/day | 25B/mo + $0.001/M rows | – | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| DO SQLite writes (from Jan 2026) | 100K/day | 50M/mo + $1.00/M rows | – | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| DO storage SQLite | 5 GB | 5 GB-mo + $0.20/GB-mo | – | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Workers AI | 10K Neurons/day | 10K free + $0.011/1K Neurons | – | [WAI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) |
| Vectorize queried dims | 30M/mo | 50M/mo + $0.01/M | – | [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/) |
| Vectorize stored dims | 5M total | 10M/mo + $0.05/100M | – | [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/) |
| Workers Logs retention | 3 days | 7 days | 7 days | [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) |
| Workers Logs volume | 200K/day | 20M/mo + $0.60/M | 5B/account/day | [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) |
| Workers Logs entry size | 256 KB | 256 KB | 256 KB | [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) |
| Tail concurrent clients | – | 10 per Worker | 10 | [real-time logs](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/) |
| Source map size | – | 15 MB gzipped | 15 MB | [source maps](https://developers.cloudflare.com/workers/observability/source-maps/) |

## Cost shape for a typical agent

For a chat agent that runs ~24/7 on a few thousand sessions per day,
DO duration GB-s is the dominant line item. The reasoning:

1. A DO is "alive" (and billed) whenever a WebSocket is connected, an
   alarm is firing, or it's processing a request.
2. With hibernation (the `acceptWebSocket()` API), the DO sleeps when
   the WebSocket is idle and is not billed during sleep — but it
   still bills for the active intervals.
3. Active duration is usually minutes per session × dozens of sessions
   per day, totaling hours of GB-s daily.

**Worked example:**

- 1,000 chat sessions/day
- Average active session time: 3 minutes (180 seconds)
- DO memory: 128 MB = 0.128 GB
- Daily GB-s: 1,000 * 180 * 0.128 = 23,040 GB-s/day
- Monthly GB-s: ~691K GB-s/mo
- Cost: (691K - 400K) * $12.50/M = $3.64/mo

That's cheap. Now scale to 100,000 sessions/day:

- Daily GB-s: 100,000 * 180 * 0.128 = 2.3M GB-s/day
- Monthly: 69M GB-s
- Cost: (69M - 400K) * $12.50/M = ~$857/mo

DO duration is the line to watch as you scale. Hibernation is what
keeps it tractable.

## Cost shape for Vectorize

Vectorize charges per dimension stored AND per dimension queried.

For a knowledge base with 100K concept embeddings at 1024 dimensions:

- Stored: 100K * 1024 = 102.4M dimensions
- Cost: (102.4M - 5M) * $0.05/100M = ~$0.05/mo (very cheap to store)

Query side, per request:

- Top-K query at 1024 dims = 1024 dims queried per request
- 1,000 queries/day = 1024 * 1000 * 30 = 30.7M dims/mo
- Cost: 0.7M * $0.01/M = ~$0.01/mo

Vectorize is dirt cheap unless you have very large indexes or very
high query volume. Favor smaller embedding models (`bge-base-en-v1.5`
at 768 dims is 25% cheaper to store and query than 1024-dim
alternatives, with similar retrieval quality on most KBs).

## Cost shape for Workers AI (Neurons)

A "Neuron" is Cloudflare's normalized unit. Roughly:

| Model | Approx Neurons per 1K tokens generated |
|---|---|
| `@cf/meta/llama-3.1-8b-instruct` | ~1 |
| `@cf/meta/llama-3.3-70b-instruct` | ~10–15 |
| `@cf/baai/bge-base-en-v1.5` (embedding) | ~0.05 |

For a chat agent doing 10 turns/session at 500 tokens/turn with
Llama 3.3 70B: 1 session ≈ 10 * 500 * 0.012 = 60 Neurons. At
$0.011/1K Neurons, that's $0.00066 per session. 1,000 sessions/day =
~$20/mo. Cheap relative to DO duration at the same scale.

## Workers Logs cost shape

Each `console.log` call ≈ 1 log event. A noisy agent logging per-turn
at 10 turns/session, 1,000 sessions/day:

- 10,000 events/day
- 300K events/mo
- Free quota: 200K/day, so well within Free.

Same agent at 100,000 sessions/day:
- 1M events/day = 30M events/mo
- 10M over the 20M Paid quota = $6/mo

Workers Logs is cheap at low/medium scale. The cost lever is
`head_sampling_rate` for high-volume Workers, plus Logpush to ship to
cheaper external storage (R2 at $0.015/GB-mo).

## Critical mental model

| Cost type | Charge for | What controls it |
|---|---|---|
| DO duration | Wall-clock time the DO is alive | Hibernation, session length |
| DO requests | Each `env.AGENT.get(id)` call | Aggregate request shape |
| DO SQLite writes | Each row written | Batching state writes |
| Workers AI Neurons | Tokens × model size | Smaller models, prompt caching |
| Vectorize dims | Index size × query rate | Embedding dimension, K |
| Workers Logs | Log events | Sampling, structured one-line-per-turn |

The lever-pulling order when costs spike:
1. Check DO duration first (always the biggest line)
2. Check Workers AI (model choice)
3. Check Workers Logs (sampling)
4. Check Vectorize (rare)

## Running the cost-tracker

The skill ships `scripts/cost-tracker.ts` that pulls Analytics Engine
SQL + AI Gateway logs API, rolls up to per-day / per-agent / total,
emits JSON for downstream tools and Markdown for Slack.

```bash
ts-node .claude/skills/cf-agent-deploy-and-observe/scripts/cost-tracker.ts \
  --account-id $CF_ACCOUNT_ID \
  --api-token $CF_API_TOKEN \
  --aig-id ai-ideator \
  --dataset ai_ideator_metrics \
  --since 1d \
  --format markdown
```

Run daily via cron / GitHub Actions schedule. Post Markdown output to
Slack.
