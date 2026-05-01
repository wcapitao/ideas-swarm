# Wrangler cheatsheet — 15 commands an agent author actually uses

All flag references: https://developers.cloudflare.com/workers/wrangler/commands/workers/

## 1. `wrangler login`

OAuth flow into your Cloudflare account. Stores creds in
`~/.wrangler/config/`. Use once per machine.

```bash
wrangler login
```

For headless / CI, skip login and use `CLOUDFLARE_API_TOKEN` +
`CLOUDFLARE_ACCOUNT_ID` env vars.

## 2. `wrangler whoami`

Sanity check before deploying. Confirms you're on the right account.

```bash
$ wrangler whoami
You are logged in with the following email: you@example.com
Account: ai-ideator (account_id: 1234567890abcdef)
```

## 3. `wrangler dev`

Local dev server on `localhost:8787`. Default mode is local-with-
simulated-bindings via Miniflare. Press `D` for Chrome DevTools.

```bash
wrangler dev --env staging --persist-to .wrangler/state/staging
```

Key flags:
- `--env staging` — use the staging env block.
- `--persist-to <dir>` — keep DO/KV/R2 state on disk between restarts.
- `--port 8788` — use a different port (default 8787).
- `--ip 0.0.0.0` — bind to all interfaces (for VM access).
- `--inspect` — open the inspector for breakpoints.

## 4. `wrangler dev --remote`

Run code on Cloudflare preview infra; all bindings are real production
or staging resources. Slower iteration loop (every change re-uploads).

```bash
wrangler dev --remote --env staging
```

Use sparingly: end-to-end last-mile network behavior, real DO
behavior, real WebSocket transport.

## 5. `wrangler deploy`

Build + bundle + upload + activate. The single most important command
in the workflow.

```bash
wrangler deploy --env production
```

Key flags:
- `--env <name>` — pick the env block.
- `--keep-vars` — preserve any vars set in the dashboard.
- `--secrets-file .env.production` — set/update secrets atomically with
  the deploy.
- `--minify` — minify the bundle (default).
- `--upload-source-maps` (or `upload_source_maps: true` in config) —
  ship source maps for stack-trace remap.

## 6. `wrangler deploy --dry-run`

Build the bundle, validate config, but DON'T ship. Use in PR CI to
catch build errors before merge.

```bash
wrangler deploy --dry-run --outdir=dist
```

Outputs the bundled `worker.js` and metadata. Doesn't touch the
account.

## 7. `wrangler tail`

Live log stream from a deployed Worker. Max 10 concurrent tailers per
Worker.

```bash
wrangler tail --env production --format json --status error
```

Filter flags:
- `--status ok|error|canceled`
- `--method GET|POST|...`
- `--search "max_turns"` — substring match in logs
- `--sampling-rate 0.1` — see only 10% of events
- `--header "x-debug=1"`
- `--ip <client-ip>`

Pipe through `jq` for structured filtering:

```bash
wrangler tail --env production --format json | jq 'select(.outcome == "exception")'
```

WebSocket caveat: `console.log` inside a WebSocket handler is buffered
until the socket closes. Use Analytics Engine for in-flight metrics.

## 8. `wrangler types`

Generate TypeScript types for `Env` from your wrangler config. Should
be run anytime bindings change.

```bash
wrangler types --env-interface Env
```

Writes `worker-configuration.d.ts`. **Commit this file to git.** Most
templates gitignore it; that's a footgun (TS green locally, red in CI).

## 9. `wrangler types --check`

Verify the generated types are up to date without writing. Use as a
CI gate.

```bash
wrangler types --check
git diff --exit-code worker-configuration.d.ts
```

The `git diff --exit-code` step catches "developer regenerated types
locally but didn't commit them."

## 10. `wrangler secret put`

Set one secret. Two-step: command, then paste value when prompted.

```bash
wrangler secret put OPENAI_API_KEY --env production
# (paste value)
```

CI-friendly piped form:

```bash
echo "$OPENAI_API_KEY" | wrangler secret put OPENAI_API_KEY --env production
```

## 11. `wrangler secret bulk`

Upload many secrets from a JSON or `.env` file. Ideal for CI.

```bash
wrangler secret bulk .env.production --env production
```

JSON form:

```json
{ "OPENAI_API_KEY": "sk-...", "JWT_SIGNING_KEY": "..." }
```

For atomic with-code rollout, use `wrangler deploy --secrets-file`
instead.

## 12. `wrangler kv namespace create`

Create a KV namespace. The output gives you the `id` to paste into
`wrangler.jsonc`.

```bash
wrangler kv namespace create CACHE
# Output: { binding = "CACHE", id = "abc123..." }
```

Add `--preview` to also create a preview namespace for `wrangler dev`.

## 13. `wrangler vectorize create`

Create a Vectorize index. Dimension must match your embedding model
exactly.

```bash
wrangler vectorize create ai-ideator-concepts \
  --dimensions=1024 \
  --metric=cosine
```

Common dimensions:
- `bge-base-en-v1.5` -> 768
- `bge-large-en-v1.5` -> 1024
- `text-embedding-3-small` (OpenAI) -> 1536
- `text-embedding-3-large` (OpenAI) -> 3072

Metric: `cosine` for normalized embeddings (most models),
`euclidean` if you have raw vectors, `dot-product` for unnormalized.

## 14. `wrangler r2 bucket create`

Create an R2 bucket for blob storage.

```bash
wrangler r2 bucket create ai-ideator-raw
```

Add `--location <hint>` to suggest a region (`weur`, `eeur`, `apac`,
`enam`, `wnam`). Cloudflare may override if capacity is constrained.

## 15. `wrangler versions list` + `wrangler versions deploy`

Canary rollout and rollback.

```bash
# See recent versions with their deploy state
wrangler versions list --env production

# Upload a new version without promoting it
wrangler versions upload --env production --tag canary --message "v0.5"

# Send 10% of traffic to it
wrangler versions deploy --env production --version-id=<id> --percentage=10

# After validation, promote to 100%
wrangler versions deploy --env production --version-id=<id> --percentage=100

# Rollback: re-promote the previous version
wrangler versions deploy --env production --version-id=<previous-id> --percentage=100
```

## System env vars Wrangler reads in CI

| Var | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Auth (replaces `wrangler login`) |
| `CLOUDFLARE_ACCOUNT_ID` | Target account |
| `CLOUDFLARE_ENV` | Default env (overridden by `--env`) |
| `WRANGLER_LOG` | Log verbosity (`debug`, `info`, `warn`, `error`) |
| `WRANGLER_OUTPUT_FILE_PATH` | Path to write structured deploy summary (ND-JSON) |
| `WRANGLER_SEND_METRICS` | `false` to disable Wrangler telemetry |

Source: https://developers.cloudflare.com/workers/wrangler/system-environment-variables/
