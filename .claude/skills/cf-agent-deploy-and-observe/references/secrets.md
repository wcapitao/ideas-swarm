# Secrets

The single most important rule: **`vars` for non-secret config,
`wrangler secret put` for everything sensitive**. `vars` are stored
plaintext and visible in the dashboard; secret values become invisible
after they're set.

Source: https://developers.cloudflare.com/workers/configuration/secrets/

## `vars` vs secrets — when to use which

| Goes in `vars` | Goes in secrets |
|---|---|
| Log level (`info`, `debug`) | API keys (OpenAI, Anthropic, Stripe) |
| Default model name | JWT signing keys |
| Feature flags (`USE_NEW_RANKER=true`) | OAuth client secrets |
| Public URLs | Webhook signing secrets |
| Numeric tuning (`MAX_TURNS=12`) | Database passwords |
| Backend region hints | Vendor service tokens |

If in doubt: secret. The cost of treating a non-secret as a secret is
you can't see it in the dashboard. The cost of treating a secret as
a `var` is a security incident.

## Local dev

Put dev-time secrets in `.dev.vars` at the project root, gitignored:

```
# .dev.vars
OPENAI_API_KEY=sk-test-...
JWT_SIGNING_KEY=local-only-key
```

Per-environment dev files: `.dev.vars.staging`, `.dev.vars.production`.
`wrangler dev --env staging` reads `.dev.vars.staging` first, falling
back to `.dev.vars`.

```gitignore
# .gitignore
.dev.vars
.dev.vars.*
.env
.env.*
```

## Setting secrets in production

### Interactive

```bash
wrangler secret put OPENAI_API_KEY --env production
# (paste value when prompted; it doesn't echo)
```

### Piped (CI-friendly, headless)

```bash
echo "$OPENAI_API_KEY" | wrangler secret put OPENAI_API_KEY --env production
```

Or from a file:

```bash
cat openai-key.txt | wrangler secret put OPENAI_API_KEY --env production
```

### Bulk

```bash
wrangler secret bulk .env.production --env production
```

The file can be `.env`-style or JSON:

```json
{
  "OPENAI_API_KEY": "sk-prod-...",
  "JWT_SIGNING_KEY": "..."
}
```

### Atomic with code deploy

The cleanest pattern for CI: ship secrets and code in the same
operation.

```bash
wrangler deploy --env production --secrets-file .env.production
```

`--secrets-file` preserves any secrets not present in the file, so you
can rotate one without resending all of them.

## Declarative `secrets.required` manifest

Add to `wrangler.jsonc`:

```jsonc
"secrets": {
  "required": ["OPENAI_API_KEY", "JWT_SIGNING_KEY"]
}
```

`wrangler deploy` fails loudly if any listed secret isn't set in the
target env. This catches the most embarrassing failure mode:
"deployed without the API key, agent 500s on first request."

Ship this on day one. Update it whenever you add a new secret
dependency.

Source: https://developers.cloudflare.com/workers/wrangler/configuration/

## Reading secrets in code

```ts
// Inside a fetch handler, an alarm, or a DO method:
export default {
  async fetch(req: Request, env: Env) {
    const key = env.OPENAI_API_KEY;
    // ...
  },
};

// Outside any handler (top-level module init):
import { env } from "cloudflare:workers";
const key = env.OPENAI_API_KEY;
```

Both forms are correct. The `cloudflare:workers` import is the modern
ESM-friendly pattern.

**Never log a secret.** Pair this skill with
`cf-agent-auth-and-permissions`'s secret-redaction
hook for outbound tool calls.

## Secrets Store (cross-Worker sharing)

Cloudflare Secrets Store is an account-scoped vault. One secret value
bound to many Workers and AI Gateway. Rotating once propagates to
every binding.

When you have **3+ Workers sharing the same secret** (e.g. an OpenAI
key used by an agent, a background job, and an admin tool), Secrets
Store wins. Below that, per-Worker secrets are simpler.

Bind in `wrangler.jsonc`:

```jsonc
"secrets_store_secrets": [
  {
    "binding": "OPENAI_API_KEY",
    "store_id": "<store-id>",
    "secret_name": "openai-prod"
  }
]
```

Read in code identically:

```ts
const key = env.OPENAI_API_KEY;
```

**China gap:** Secrets Store is unavailable in the Cloudflare China
Network. If you serve customers behind JD Cloud's CN edge, fall back
to per-Worker `wrangler secret put`. Document the gap in your runbook.

Source: https://developers.cloudflare.com/secrets-store/

## Rotation runbook

### Hot rotation (immediate, all traffic flips)

```bash
echo "$NEW_KEY" | wrangler secret put OPENAI_API_KEY --env production
```

The next request after the deploy gets the new value. Use when the old
key is leaked / revoked and you cannot wait.

**Risk:** if the new key is wrong, every request breaks until you fix
it. Always verify the new key works (e.g. via a curl test) before
flipping.

### Canary rotation (versioned, gradual)

```bash
# 1. Bind the new secret to a NEW version, no traffic yet
wrangler versions secret put OPENAI_API_KEY --env production
# (paste new key)

# 2. Upload a new version with the new secret bound
wrangler versions upload --env production --tag rotate-openai \
  --message "rotate openai key 2026-04-30"

# 3. Send 10% of traffic to the new version
wrangler versions deploy --env production \
  --version-id=<new-id> --percentage=10

# 4. Watch tail / Workers Logs for errors for 5–15 minutes
wrangler tail --env production --format json --status error \
  | jq 'select(.outcome == "exception")'

# 5. If clean, promote to 100%
wrangler versions deploy --env production \
  --version-id=<new-id> --percentage=100

# 6. If broken, rollback
wrangler versions deploy --env production \
  --version-id=<previous-id> --percentage=100
```

### Rotation cadence

| Secret type | Cadence | Trigger |
|---|---|---|
| OAuth client secrets | 6 months | scheduled |
| API keys (OpenAI, etc.) | 90 days OR on personnel change | scheduled or event |
| JWT signing keys | 90 days | scheduled |
| Webhook signing secrets | 6 months OR on suspicion | scheduled or incident |
| Database passwords | 90 days | scheduled |

Run a quarterly rotation drill. If it's painful, fix the runbook.

## Common mistakes

1. **Putting an API key in `vars`.** Visible in the dashboard. Anyone
   with read-only Workers access gets your prod key. Move it to a
   secret.
2. **Committing `.dev.vars` to git.** Add it to `.gitignore` on day
   one. Audit history with `git log -p -- .dev.vars`.
3. **Forgetting `--env` on `wrangler secret put`.** Without
   `--env production`, the secret lands in the default environment
   (the top-level Worker, not `<name>-production`). Then you wonder
   why prod can't read it.
4. **Plain rotation in production.** Use canary. The 10% step buys you
   time to notice the new key is wrong.
5. **Not declaring `secrets.required`.** First deploy after a new key
   dependency: works locally with `.dev.vars`, breaks in prod.
6. **Logging secrets in `console.log`.** Workers Logs and Logpush ship
   logs to durable storage. A leaked key in a log is a leaked key
   forever. Add a redaction hook to your tool layer.
