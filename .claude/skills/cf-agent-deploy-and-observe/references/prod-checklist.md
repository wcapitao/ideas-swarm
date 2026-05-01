# Production checklist — 20 items with rationale

Don't flip the prod switch with any unchecked. Each item has a
sentence saying *why* — if you don't know why, you don't know whether
it's safe to skip.

---

**1. `compatibility_date` pinned to a date you've actually tested.**
Bumping the date can change `fetch` semantics, streams, or
`process.env` defaults. "Pin to today" in CI is a slow-motion
incident.

**2. `compatibility_flags` includes `"nodejs_compat"`.** Agents use
Node-flavored APIs (crypto, streams, async_hooks). Without this flag,
import resolution and runtime behavior differ subtly.

**3. All DO classes declared in `migrations` as `new_sqlite_classes`
(not `new_classes`).** KV-backed DOs are the legacy path with no
migration to SQLite. SQLite is Free-tier accessible and has a higher
per-object storage cap.

**4. `migrations` tags are sequential and the latest tag matches
what's been applied to staging.** Append-only — you cannot reorder or
remove. "Applied to staging but not in main" is how production deploys
500 on launch day.

**5. `observability.enabled = true`.** The default is off. Without it,
Workers Logs is empty, dashboard search returns nothing, and you debug
by adding `console.log` and waiting for a deploy.

**6. `head_sampling_rate < 1.0` if you expect more than ~100
requests/sec.** Otherwise you'll burn through the 20M/mo Paid quota
in days. Per-INVOCATION sampling: 0.1 = 10% of requests get all
their logs.

**7. `upload_source_maps: true`.** Free, async. Without it, prod
stack traces look like `at h (worker.js:1:14829)`. You will regret
not having this when an exception shows up at 3 AM.

**8. `placement.mode = "smart"` if you call a single backend region.**
Real latency win when an agent hits a single LLM region (e.g.
us-east-1). No-op when traffic is global or you have edge-only paths.

**9. `limits.cpu_ms` set (60_000 for chat agents).** Self-DoS guard.
A runaway turn loop will burn CPU until the 5-minute hard cap; setting
1 minute is a sane default that catches bugs early.

**10. All secrets set in target env via
`wrangler secret put --env production`.** The `--env` flag is critical;
without it, the secret lands in the default Worker, not
`<name>-production`. Sanity check by listing secrets after deploy.

**11. `secrets.required` manifest matches what's actually set.**
Keeps the docs (the manifest) in sync with reality. Catches "added a
new vendor, forgot to set the key in prod."

**12. `vars` contains nothing sensitive (verify in dashboard).**
`vars` are plaintext to anyone with Workers read access. Audit the
dashboard for keys that look secret-shaped.

**13. Custom domain attached via `routes[].custom_domain = true`.**
The `*.workers.dev` URL is fine for staging, leaks for production.
Custom domain also gets you proper TLS for OAuth callbacks.

**14. `workers_dev = false` in production env.** Kills the public
`*.workers.dev` URL so traffic only flows through your custom domain.
Otherwise customers (and bots) can find the bare URL.

**15. CI runs `wrangler types --check` + `wrangler deploy --dry-run`
on every PR.** Catches the two most common pre-deploy failure modes:
stale generated types, and bundling errors that only show up on a real
build.

**16. Analytics Engine dataset bound; SQL dashboard saved.** Workers
Logs is for events, Analytics Engine is for metrics. Per-run cost,
per-tool latency, p95 by model — all need AE.

**17. Logpush job OR Tail Worker shipping logs to long-term store.**
Workers Logs retains 7 days on Paid. Postmortems happen 2 weeks later.
Ship to S3 / R2 / Datadog so the trail survives.

**18. Alert on Workers Logs `outcome = "exception"` rate, AIG error
budget.** Silent failures are the worst kind. The exception rate
alert covers Worker-level crashes; the AIG error budget covers
upstream model failures.

**19. Cost ceiling alert from Analytics Engine
`SUM(cost_usd)` per day.** First-week cost regressions are when you
most need the alert. Set it to 1.5x your expected daily spend.

**20. Vectorize index dimension matches your embedding model; tested
with a known query.** Mismatch = silent garbage results. Run a sanity
query (e.g. "what's in the KB?") and verify top-1 looks right before
launch.

---

## Per-environment minimums

Some items relax in non-prod environments.

| Item | Staging | Production |
|---|---|---|
| 6. head_sampling_rate | 1.0 (full) | 0.1–0.5 |
| 7. upload_source_maps | optional | **required** |
| 13. Custom domain | optional | **required** |
| 14. workers_dev = false | optional | **required** |
| 17. Logpush | optional | **required** |
| 18. Exception alert | warn | **page** |
| 19. Cost ceiling | warn | **page** |

## Pre-deploy review (5-minute version)

Before clicking deploy, run through this:

```
[ ] git status: clean working tree
[ ] git log: last commit description matches deploy intent
[ ] wrangler types --check: no diff
[ ] npm test: green
[ ] wrangler deploy --dry-run: builds clean
[ ] secrets.required: every name actually exists in target env
       (`wrangler secret list --env production`)
[ ] migrations: latest tag matches staging, not edited
[ ] cost dashboard: open in another tab
[ ] tail: open in another terminal (`wrangler tail --env production`)
```

Then `wrangler deploy --env production`. Watch tail and the cost
dashboard for 10 minutes. If clean, leave the office.
