# Secret management for Cloudflare agents

The two-step rule: **`vars` for non-secret config, `wrangler secret put`
for secrets**. Plus `secrets.required` to make missing secrets break
deploys loudly.

Source: `cf-deploy-observe.md` §6, `developers.cloudflare.com/workers/configuration/secrets/`,
`developers.cloudflare.com/secrets-store/`.

---

## What goes where

| Value type | Lives in | Visible after set? | Notes |
|---|---|---|---|
| `MODEL` (string ID like `@cf/meta/llama-3.1-8b-instruct`) | `vars` in `wrangler.jsonc` | Yes (dashboard, code) | Plain config |
| `GITHUB_CLIENT_ID` (public OAuth ID) | `vars` | Yes | Public anyway |
| `GITHUB_CLIENT_SECRET` | `wrangler secret put` | No | Secret. |
| `OPENAI_API_KEY` | `wrangler secret put` | No | Secret. |
| `JWT_SIGNING_KEY` | `wrangler secret put` | No | Secret. |
| Database connection strings with passwords | `wrangler secret put` | No | Secret. |
| Per-environment URLs | `vars` per env | Yes | Plain config |

If you can publicly print it without consequence → `vars`. Otherwise →
`wrangler secret put`.

---

## Local dev

`.dev.vars` (gitignored) at the project root:

```
GITHUB_CLIENT_SECRET=local-only-test-secret
OPENAI_API_KEY=sk-test-...
JWT_SIGNING_KEY=local-only-key
```

Per-env files: `.dev.vars.staging`, `.dev.vars.production` if you want
to switch with `wrangler dev --env staging`.

`.gitignore` MUST include `.dev.vars*`. Confirm before first commit.

---

## Production — `wrangler secret put` recipes

### Interactive (one-off rotation)

```bash
wrangler secret put GITHUB_CLIENT_SECRET --env production
# (paste value when prompted)
```

### Piped (CI-friendly, headless)

```bash
echo "$GITHUB_CLIENT_SECRET" | wrangler secret put GITHUB_CLIENT_SECRET --env production
```

### Bulk from a file (CI bulk update)

```bash
# .env.production at the project root, gitignored
# GITHUB_CLIENT_SECRET=...
# OPENAI_API_KEY=...
# JWT_SIGNING_KEY=...

wrangler secret bulk .env.production --env production
```

### Atomic with deploy

```bash
wrangler deploy --env production --secrets-file .env.production
```

`--secrets-file` preserves any secrets not present in the file, so you
can rotate one without re-sending all of them. This is the safest
pattern for CI.

### Listing / deleting

```bash
wrangler secret list --env production
wrangler secret delete OLD_KEY --env production
```

---

## Declarative validation: `secrets.required`

Add to `wrangler.jsonc`:

```jsonc
{
  // ... rest of config
  "secrets": {
    "required": [
      "GITHUB_CLIENT_SECRET",
      "JWT_SIGNING_KEY",
      "OPENAI_API_KEY"
    ]
  }
}
```

`wrangler deploy` fails loudly with "missing required secret X" if any
listed value isn't set. This is the difference between "the deploy
succeeded but the agent crashes on the first request" and "the deploy
refused to ship". Always pick the second.

---

## Reading in code

```ts
// Inside fetch handler — env is the binding object
const key = env.OPENAI_API_KEY;

// Or globally, outside a handler:
import { env } from "cloudflare:workers";
const key = env.OPENAI_API_KEY;
```

Type these via `wrangler types`:

```bash
npx wrangler types --env-interface Env
```

Generates `worker-configuration.d.ts` with `interface Env { OPENAI_API_KEY: string; ... }`.
Commit that file. CI checks `git diff --exit-code worker-configuration.d.ts`
to catch "you added a binding and forgot to regenerate types".

---

## Cloudflare Secrets Store (cross-Worker sharing)

When multiple Workers need the same secret — e.g. five MCP servers all
using the same GitHub OAuth app, three Workers all calling the same
OpenAI API key — use **Secrets Store**, an account-scoped vault.

Bind the same way as a regular secret, but the value lives in the store:

```jsonc
{
  "secrets_store_secrets": [
    {
      "binding": "GITHUB_CLIENT_SECRET",
      "store_id": "abc123",
      "secret_name": "github-oauth-app-1"
    }
  ]
}
```

Rotate once at the store; every binding picks up the new value on next
deploy. Currently supports Workers + AI Gateway as binding consumers.
Not available in the Cloudflare China Network.

---

## Rotation runbook

Quarterly minimum. More often for high-blast-radius (root API keys,
JWT signing keys). The exact cadence belongs in your team calendar.

### Standard rotation (single Worker, single secret)

1. **Generate** new value at the IdP / vendor.
2. **Stage** — set the new value on the staging environment first:
   ```bash
   echo "$NEW_GITHUB_SECRET" | wrangler secret put GITHUB_CLIENT_SECRET --env staging
   ```
3. **Smoke test** staging:
   ```bash
   bash scripts/verify-oauth-flow.sh https://staging.example.com
   ```
4. **Promote** to production:
   ```bash
   echo "$NEW_GITHUB_SECRET" | wrangler secret put GITHUB_CLIENT_SECRET --env production
   ```
5. **Smoke test** production.
6. **Revoke** old value at the IdP / vendor.
7. **Log** the rotation in your audit trail (when, who, why).

### OAuth client-secret rotation

Same as standard, plus an extra decision point:

8. **Decide** whether to bulk-revoke existing access/refresh tokens in
   `OAUTH_KV`. The MCP-client-issued tokens don't change just because
   the upstream IdP secret changed. If your concern is "the old IdP
   secret might have leaked", you probably also want to invalidate
   downstream tokens. If your concern is "scheduled rotation hygiene",
   you can let them expire naturally.
9. **Document** which choice you made.

### JWT signing key rotation

JWT signing keys require key-versioning if you don't want to instantly
invalidate every issued token:

1. Add the new key as `JWT_SIGNING_KEY_NEW`.
2. Code accepts BOTH keys for verification (loop over the list).
3. Code signs new tokens with the NEW key only.
4. Wait for old tokens to expire naturally (use the longest TTL as
   your wait window).
5. Remove the old key.

Or, if you can tolerate "every user has to re-login":

1. `wrangler secret put JWT_SIGNING_KEY` with the new value.
2. Every existing token is now invalid; users get 401, re-login.

Pick based on UX tolerance.

### Cross-Worker rotation (Secrets Store)

When the secret is in Secrets Store, rotation is one operation:

```bash
wrangler secrets-store secret update github-oauth-app-1
# (or via dashboard)
```

Then trigger a redeploy on every Worker that binds it (Cloudflare
auto-fetches the new value on next instantiation).

---

## CI integration

`.github/workflows/deploy.yml` snippet:

```yaml
- name: Deploy
  uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    command: deploy --env production
    # Atomic secret push alongside code
    secrets: |
      GITHUB_CLIENT_SECRET
      OPENAI_API_KEY
      JWT_SIGNING_KEY
  env:
    GITHUB_CLIENT_SECRET: ${{ secrets.GITHUB_CLIENT_SECRET }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    JWT_SIGNING_KEY: ${{ secrets.JWT_SIGNING_KEY }}
```

The `secrets` input on `cloudflare/wrangler-action@v3` reads each named
GitHub secret from `env` and pipes it into `wrangler secret put`, so
secrets are atomically updated alongside code.

---

## Anti-patterns

| Anti-pattern | Why it bites |
|---|---|
| Putting a secret in `vars` because "it's just dev" | `vars` are visible in the dashboard. Anyone with read access sees it. |
| Hardcoding a secret in code "temporarily" | It's now in your git history. Treat as compromised; rotate. |
| Same secret across staging and production | One leaks → both compromised. Different values per env. |
| Sharing a secret over Slack / email / a doc | Not auditable; can't rotate. Use Secrets Store + dashboard ACL. |
| No `secrets.required` block | Deploy succeeds with missing secret; agent crashes on first request. |
| Logging the env binding to debug a problem | Logs go to Workers Logs / Logpush. Now your secret is in your log store. |

---

## What `workers-oauth-provider` itself stores

`workers-oauth-provider` is a token issuer. It stores hashes of the
tokens it issues (access + refresh) in the bound KV namespace
(conventionally `OAUTH_KV`). It does **not** store raw tokens or any
upstream IdP secrets.

| Thing | Where it lives | You manage rotation? |
|---|---|---|
| GitHub/Google client secret (your OAuth app secret) | `wrangler secret put` | YES — quarterly |
| JWT signing keys for issued tokens | Library-managed (configurable expiry) | The library rotates internally; configure `tokenExpiry` |
| Access tokens issued to MCP clients | `OAUTH_KV` (hashes only) | Library auto-expires per `tokenExpiry` |
| Refresh tokens issued to MCP clients | `OAUTH_KV` (hashes only) | Library handles rotation on use |
| Upstream IdP access token (`props.accessToken`) | `this.props` → `ctx.storage` (DO storage) | Refresh via your handler when expired |

The `props.accessToken` in `this.props` is an UPSTREAM token (e.g. a
GitHub access token). When it expires, you need to refresh-token-flow
against GitHub yourself and call `this.updateProps({ ...new })`. The
library handles its OWN tokens (the ones it issued to the MCP client),
not the upstream ones.
