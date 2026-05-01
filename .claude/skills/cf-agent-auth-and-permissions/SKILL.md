---
name: cf-agent-auth-and-permissions
description: >
  Designs the auth and permission posture of a Cloudflare Agents
  deployment — `workers-oauth-provider` wiring, MCP authorization
  metadata (RFC 9728 / RFC 8414), scope design, `this.props` vs
  `setState`, secret hygiene, and per-tool gating. Activates when the
  user mentions "OAuth on the agent", "MCP auth", "workers-oauth-provider",
  "scopes", "secret in agent", "this.props vs setState", "auth flow",
  "RFC 9728", "Cloudflare Access", "third-party OAuth", "BYO IdP",
  "secret rotation", or builds a public MCP server. Encodes the four
  auth postures, the broadcast-leak rule (NEVER put secrets in
  `setState`), the OAuthProvider-as-Worker-entrypoint surprise, and the
  five-line production checklist. Hands off to `cf-agent-tools-and-mcp`
  for per-tool gating and `cf-agent-deploy-and-observe` for CI secret
  rotation.
---

# Cloudflare Agent Auth & Permissions

## Overview

Auth on a Cloudflare agent has two layers that get conflated and
shouldn't:

1. **Inbound auth** — who is allowed to talk to your MCP server / agent
   at all (OAuth, Cloudflare Access, bearer header).
2. **Per-tool authorization** — once they're in, which tools can they
   call (scopes, role gating, `needsApproval`).

This skill covers both, plus the secret hygiene that surrounds them.
The non-negotiable rule across every section: **`setState` is broadcast
to all WebSocket clients on the agent — never put a token, key, or
identity claim there**. Use `this.props` (per-session, server-only) or
`this.ctx.storage` (server-only) instead.

## When to use

| Trigger | Use? |
|---|---|
| Choosing between Access / `workers-oauth-provider` / nothing | YES |
| Wiring `OAuthProvider` for a new MCP server | YES |
| Designing OAuth scopes for tool gating | YES |
| Putting a token, refresh token, or API key on the agent | YES |
| Reviewing where state vs props lives | YES |
| Rotating secrets / setting up `wrangler secret put` | YES |
| Pure tool implementation, no auth involved | NO → `cf-agent-tools-and-mcp` |
| Pure deploy/CI question, no secret involved | NO → `cf-agent-deploy-and-observe` |

## The auth posture decision (decide first, before any code)

| Posture | Use when | Implementation |
|---|---|---|
| **Internal-only** | Agent is only called from your own Workers / cron / private network | No OAuth at all. Secrets via `wrangler secret put`. Static bearer header verified in `fetch` if you need any check. |
| **Public, single SSO** | Public MCP server, but only your org's users — Cloudflare Access already protects everything else you own | Put **Cloudflare Access** in front of the Worker. Read the JWT from `Cf-Access-Jwt-Assertion`. No `workers-oauth-provider` needed. |
| **Public, third-party IdP** | Anyone-with-a-GitHub / Google account can use it | `workers-oauth-provider` as the Worker entrypoint, with a `defaultHandler` that bounces to GitHub / Google. Tokens flow into agent as `this.props`. |
| **Public, BYO IdP** | You have Stytch / Auth0 / WorkOS / Descope already | `workers-oauth-provider` configured for that provider's OAuth callback. Same shape as third-party. |

**Pick before you build.** Adding OAuth retroactively to a deployed
agent is painful — DO migrations, KV namespace, redirect URIs, and the
client population all change shape.

## `workers-oauth-provider` is a Worker entrypoint, not middleware

This is the surprising bit that catches everyone:

```ts
// src/index.ts — the ENTIRE Worker entrypoint
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { CalculatorMCP } from "./mcp.js";
import { GitHubHandler } from "./github-handler.js";

export default new OAuthProvider({
  apiHandlers: {
    "/sse": CalculatorMCP.serveSSE("/sse"),
    "/mcp": CalculatorMCP.serve("/mcp"),
  },
  defaultHandler: GitHubHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["read", "write", "profile"],
  allowImplicitFlow: false,
  allowPlainPKCE: false,
});
```

That `new OAuthProvider({...})` IS the fetch handler. It exposes
`fetch(req, env, ctx)` itself. There is no Hono router around it; the
provider routes by path. Everything under `apiHandlers` keys is
protected (token required); everything else falls through to
`defaultHandler` (your login UI + OAuth callback).

What it does for free:

- Serves `/.well-known/oauth-authorization-server` (RFC 8414) and
  `/.well-known/oauth-protected-resource` (RFC 9728).
- Handles `/authorize`, `/token`, `/register` (RFC 7591 dynamic client
  registration). PKCE S256 by default.
- Issues, refreshes, revokes tokens. Persists them in the bound KV
  namespace (conventionally `OAUTH_KV`). **Stores hashes, never raw
  tokens.**
- Threads upstream identity context to the protected handler via
  `ctx.props`, which `McpAgent` reads as `this.props`.

What it does NOT do:

- Per-tool authorization. Scopes are issued; gating is your job.
- Rate limiting. Wrap your `apiHandler` with the Workers Rate Limiting
  binding (see `references/oauth-flows.md`).
- Audit log. Wrap each tool handler.

## The grant flow (memorize the chokepoint)

```
MCP client                  Worker entrypoint                   Upstream IdP
   │                            │                                   │
   │  GET /.well-known/...      │                                   │
   ├───────────────────────────▶│ (auto, served by OAuthProvider)   │
   │  POST /register            │                                   │
   ├───────────────────────────▶│ (RFC 7591 dynamic registration)   │
   │  GET /authorize?code=...   │                                   │
   ├───────────────────────────▶│ defaultHandler.fetch              │
   │                            ├──────────────────────────────────▶│
   │                            │  user logs in, IdP redirects back │
   │                            ◀──────────────────────────────────┤
   │                            │ env.OAUTH_PROVIDER                │
   │                            │   .completeAuthorization({         │
   │                            │     userId, scope, props })        │
   │  302 → MCP client          │                                   │
   ◀───────────────────────────┤                                   │
   │  POST /token (code)        │                                   │
   ├───────────────────────────▶│ issues access + refresh tokens    │
   │                            │ → KV (hashed)                     │
   │  GET /mcp (Bearer ...)     │                                   │
   ├───────────────────────────▶│ apiHandler — props on this.props  │
```

`completeAuthorization({ request, userId, scope, props, metadata })` is
the **single chokepoint** where you decide:

- `userId` — stable subject for KV indexing and audit.
- `scope` — what the access token can do (drives tool gating).
- `props` — arbitrary JSON that flows to the agent as `this.props`.
  Typically `{ accessToken, refreshToken, accountId, claims, permissions }`.

Get this call right and the rest is mechanical. Get it wrong and
either the user has too much access or the agent can't reach the
upstream API on their behalf.

## `this.props` vs `setState` — the rule

This is the single highest-leverage rule in the entire skill. Memorize
the table.

| Surface | Scope | Visibility | Persistence | Use for |
|---|---|---|---|---|
| `this.props` | Per OAuth-authenticated client / session | Server-only | DO storage (`ctx.storage`) | OAuth tokens, refresh tokens, `userId`, scopes, upstream API keys |
| `this.state` / `this.setState` | One DO instance | **Broadcast to every connected WS client** via `cf_agent_state` | DO storage automatically | Chat history, presence, public counters, anything any tab can see |
| `this.ctx.storage.put()` | One DO instance | Server-only | DO storage | Anything you don't want broadcast and don't want re-sent on every state change |
| ``this.sql`...` `` | One DO instance | Server-only (raw SQLite) | DO storage | Big or queryable per-session data (audit logs, message histories with metadata) |

**The rule:**

1. If it's a secret, a token, or a per-user identity claim → `this.props`
   or `this.ctx.storage`. NEVER `setState`.
2. If every connected tab should see it → `setState`.
3. If you're not sure → `this.ctx.storage`. It's the safe default.

### Why `setState` is a leak surface

`setState` fires `cf_agent_state` to **every connected WebSocket
client** subscribed to that DO instance (`useAgent({ name })` with the
same `name`). If a user opens two tabs to the same conversation,
they're both subscribed. If they share the URL with a friend, the
friend connects to the same DO and gets the broadcast. Anything in
state — including a token you accidentally stuffed there — goes to
all of them.

Run `scripts/audit-state-for-secrets.ts` against any state snapshot
before deploy. CI failure if it finds anything token-shaped.

## Persisting `this.props` across hibernation

`McpAgent` already does this for you, but the pattern is worth
understanding so you don't re-implement it wrong:

```ts
// What McpAgent.onStart looks like internally (paraphrased)
async onStart(props?: Props) {
  if (props) {
    this.props = props;
    await this.ctx.storage.put("props", props);  // survive hibernation
  } else {
    // Hibernation recovery — no props on reconnect
    this.props = await this.ctx.storage.get("props");
  }
  await this.init();
}

// And updateProps for refresh-token rotation:
async updateProps(props: Props) {
  this.props = props;
  await this.ctx.storage.put("props", props);
}
```

If you ever assign `this.props = ...` directly without writing through
`ctx.storage`, hibernation will silently lose them and the next
WS reconnect will wake the DO with `this.props === undefined`. Symptom:
"my agent forgets the user after 30s of idle".

## Scope design

### One scope per tool family, plus `read:*` and `write:*`

Default pattern that scales:

| Scope | Grants |
|---|---|
| `read:account` | Tools that fetch user account / profile data |
| `write:account` | Tools that mutate account settings |
| `read:billing` | Read invoices, usage |
| `write:billing` | Charge, refund, change plan |
| `read:*` | All read-* scopes (sugar) |
| `write:*` | All write-* scopes (implies all read-*) |
| `admin` | Side-channel; only for your own staff tools |

`completeAuthorization({ scope })` accepts a space-separated string per
OAuth 2.1. Bind whatever the user consented to in the consent screen.

### Map scopes to tool gating in the agent

Two valid styles. **Prefer (b)** — the LLM can't attempt a tool that
isn't registered.

```ts
// (a) Runtime check — LLM sees the tool, can call it, gets an error
this.server.tool("refund", "...", { amount: z.number() }, async ({ amount }) => {
  if (!this.props.permissions?.includes("write:billing")) {
    return {
      isError: true,
      content: [{ type: "text", text: "Insufficient scope: write:billing required" }],
    };
  }
  // ... do the thing
});

// (b) Conditional registration — LLM never sees the tool. Safer.
async init() {
  if (this.props.permissions?.includes("read:billing")) {
    this.server.tool("listInvoices", "...", {}, async () => { /* ... */ });
  }
  if (this.props.permissions?.includes("write:billing")) {
    this.server.tool("refund", "...", {}, async ({ amount }) => { /* ... */ });
  }
}
```

For destructive tools (`refund`, `delete*`, `transfer`), add
`needsApproval: true` on top of scope check. The MCP client surfaces a
human-in-the-loop confirm. Source pattern: `agents-starter`'s
`calculate` tool with approval.

See `references/scope-design.md` for the full pattern.

## Secret hygiene

The two-step pattern: **`vars` for non-secret config, `wrangler secret put`
for secrets**. Plus `secrets.required` to make missing secrets break
deploys loudly.

### Local dev

```
# .dev.vars (gitignored)
GITHUB_CLIENT_SECRET=local-only-test-secret
OAUTH_KV_PREVIEW_ID=...
```

### Production

```bash
# Interactive
wrangler secret put GITHUB_CLIENT_SECRET --env production

# Piped (CI-friendly)
echo "$GITHUB_CLIENT_SECRET" | wrangler secret put GITHUB_CLIENT_SECRET --env production

# Bulk from a file (the CI shape)
wrangler secret bulk .env.production --env production

# Together with code (atomic)
wrangler deploy --env production --secrets-file .env.production
```

`--secrets-file` preserves any secrets not present in the file, so
rotating one doesn't require re-sending all of them.

### Declarative validation

```jsonc
// wrangler.jsonc
"secrets": {
  "required": ["GITHUB_CLIENT_SECRET", "JWT_SIGNING_KEY", "OPENAI_API_KEY"]
}
```

`wrangler deploy` fails loudly if any are missing. Make this the wall
between dev habits and production.

### Secrets Store (cross-Worker sharing)

When you have multiple Workers that need the same secret (e.g. five
MCP servers all using the same GitHub OAuth app), use Cloudflare
**Secrets Store** — one secret value, bound to many Workers, rotate
once. Currently supports Workers + AI Gateway as binding consumers.

### Rotation runbook

Quarterly minimum. More often for high-blast-radius secrets.

1. Generate new value at the IdP / vendor.
2. `wrangler secret put GITHUB_CLIENT_SECRET --env production` with new value.
3. Verify deploy + smoke test (run `scripts/verify-oauth-flow.sh`).
4. Revoke old value at the IdP.
5. For OAuth client secrets specifically: `workers-oauth-provider` issues
   its own access/refresh tokens to MCP clients — you also need to
   decide whether to bulk-revoke those (force re-login) or wait for
   refresh-token natural expiry.

See `references/secret-management.md` for the full runbook.

## Production MCP server checklist

The 5-line checklist. If any line is "no", you're not ready.

1. **Rate limits** — `env.RATE_LIMITER.limit({ key: props.userId })` wrapping the apiHandler.
2. **Scope-based tool gating** — conditional registration in `init()` for any sensitive tool.
3. **Audit log** — every tool call writes `{ ts, userId, tool, args, ok }` to Analytics Engine or Logpush. Tokens redacted.
4. **Observability** — `observability.enabled = true`, `wrangler tail` works, MCP tracing wired (`packages/agents/src/observability/mcp.ts`).
5. **Secret rotation** — quarterly cadence on the calendar; runbook tested.

## Footguns

In rough order of how often they bite, worst first:

1. **Tokens in `setState` → leak to every connected client.** Top of the list, every time. Use `this.props` or `ctx.storage`. Run `scripts/audit-state-for-secrets.ts` in CI.
2. **Sharing one OAuthProvider instance across multiple Workers without sharing the KV namespace** — each Worker gets its own token universe. Multiple clients can't even discover each other's tokens. Always bind the SAME `OAUTH_KV` namespace.
3. **`mcp-session-id` header stripped by a proxy / Workers Routes / middleware** — multi-turn streamable HTTP breaks silently. Add `mcp-session-id` to `corsOptions.headers` and any rewriting middleware allow-list.
4. **First-deploy migration tag missing** — `migrations: [{ tag: "v1", new_sqlite_classes: ["YourMcpClass"] }]` must be in `wrangler.jsonc` at first deploy. Without it, deploy succeeds but no DO instance can be created. With the WRONG tag (`new_classes` instead of `new_sqlite_classes`), you get a KV-backed DO that you can NEVER convert to SQLite-backed without wiping data — entire DO class wipe.
5. **Hibernation drops `this.props`** if you bypass `updateProps` and assign `this.props = ...` directly without writing through `ctx.storage`. Symptom: agent forgets the user after ~30s idle.
6. **Registering a tool unconditionally and assuming the LLM will respect a `// TODO: check scope` comment.** It won't. Either don't register it or check inside on every call.
7. **`completeAuthorization({ scope: "" })` issues a token with no scope** — and your tool gates allow it through if you're checking `permissions?.includes(x)` without a baseline. Always require at least one scope.
8. **`disallowPublicClientRegistration: true`** — turning this on means MCP Inspector, Claude Desktop, and the Cloudflare AI playground can't dynamically register. Only do this if you're managing client IDs out-of-band.
9. **Plain PKCE allowed (`allowPlainPKCE: true`)** — never. S256 only. The default is correct; don't flip it.
10. **Confusing `workers-oauth-provider` tokens with upstream IdP tokens** — the library issues its own tokens to MCP clients (in `OAUTH_KV`). The `props.accessToken` is the UPSTREAM token (GitHub/Google/etc.) that your tools use to call those APIs on behalf of the user. They live in different stores and rotate on different cadences.

## Hand-offs

| Symptom / next step | Skill |
|---|---|
| "Now I need to gate this tool by scope" | `cf-agent-tools-and-mcp` |
| "I need to test the OAuth flow end-to-end" | `cf-agent-tests-and-evals` |
| "How do I `wrangler secret put` in CI?" | `cf-agent-deploy-and-observe` |
| "I need to add Cloudflare Access in front" | `cf-agent-deploy-and-observe` |
| "I'm building a sub-agent that needs its own auth" | `cf-agent-multi-agent-orchestration` |

## References in this skill

- `references/oauth-flows.md` — the four `workers-oauth-provider` patterns side-by-side: Cloudflare Access, third-party (GitHub/Google), BYO (Stytch/Auth0/WorkOS), self-hosted. Code for each.
- `references/props-vs-state.md` — the per-session vs broadcast surface, with worked examples of right and wrong placement.
- `references/scope-design.md` — naming patterns, scope hierarchies, mapping to tool gating, scope-bumping flow.
- `references/secret-management.md` — `wrangler secret put`, Secrets Store, rotation runbook, declarative validation.

## Scripts

- `scripts/audit-state-for-secrets.ts` — reads a JSON snapshot of agent state, regex-greps for token-shaped strings (JWT, `Bearer `, `sk_live_`, `gho_`, `xoxb-`, AWS keys, long base64). Exits non-zero if any are inside the `state` field. Wire it into CI.
- `scripts/verify-oauth-flow.sh` — curl-driven smoke test of an OAuth-protected MCP server: hits `/.well-known/oauth-authorization-server`, walks `/authorize` → `/token`, then calls a protected MCP method. Reports each step.

## Critical rules

- **NEVER put a secret, token, or identity claim in `setState`.** It broadcasts.
- **`this.props` for per-session secrets, persisted via `ctx.storage`.** Survives hibernation.
- **Conditional tool registration > runtime scope check.** The LLM can't try what it can't see.
- **`secrets.required` in `wrangler.jsonc` for every required secret.** Loud failures > silent ones.
- **Same `OAUTH_KV` namespace across every Worker that shares an OAuth realm.**
- **Run `scripts/audit-state-for-secrets.ts` in CI on a state dump.** One leak ruins the deployment.
