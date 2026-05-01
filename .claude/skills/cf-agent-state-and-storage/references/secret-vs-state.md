# Secret vs state — the broadcast blast radius

The single most expensive class of bug in a Cloudflare Agent: putting a secret into `this.state`. This reference exists so you never do it.

Source: cf-mcp-auth-frontend §10 #1 (token leakage in client state); cf-agents-core §2 (setState semantics); SKILL_CATALOG.md cross-cutting non-negotiable #1.

---

## The rule

> Anything that goes through `this.setState(...)` is broadcast to every connected WebSocket client as a `cf_agent_state` JSON frame.
>
> Therefore: if it shouldn't be visible to the browser, it must not pass through `setState`.

There is no "private field" in `setState`. The whole state object is broadcast. There is no opt-out per field. There is no "broadcast a subset to only some clients" — there is `shouldSendProtocolMessages()` which suppresses the *whole* frame for *that* client. It's all-or-nothing.

---

## The blast radius

When `setState` runs (cf-agents-core §2):

1. Persist to SQLite (in the agent's own DB).
2. **Broadcast `cf_agent_state` to every connected WebSocket** (skipping clients where `shouldSendProtocolMessages()` returned false).
3. Best-effort call `onStateChanged()`.

The broadcast is between steps 1 and 3. There is no opportunity to scrub the payload between persist and broadcast.

Every browser tab that has a live `useAgent({ agent, name })` connection receives the state. If you're running a chat UI, that's every user currently looking at this agent.

---

## What MUST NEVER be in `setState`

- OAuth refresh tokens
- OAuth access tokens
- Upstream API keys (OpenAI, Anthropic, Stripe, Twilio, ...)
- Webhook signing secrets
- Database credentials of any kind
- HMAC keys
- JWT signing keys
- Server-side session IDs (only the user-facing public ID, if needed)
- PII you wouldn't show to other users connected to the same agent
- Content of system prompts (often contains business logic worth protecting)

If in doubt, **don't put it in `setState`**.

---

## What SHOULD be in `setState`

- UI-bound presentation data: counters, message lists (sanitized), status flags.
- Public per-instance data the UI renders directly.
- Non-secret config the UI cares about (theme, locale, current step in a flow).

The defining test: **would I be comfortable printing this to the browser console?** If yes, `setState` is fine. If no, use a private store.

---

## The right shapes for secrets

### Shape #1 — Private SQL table

```ts
// Write
this.sql`INSERT OR REPLACE INTO secrets (key, value)
         VALUES (${"oauth_refresh"}, ${token})`;

// Read
const [row] = this.sql<{ value: string }>`
  SELECT value FROM secrets WHERE key = ${"oauth_refresh"}
`;
const token = row?.value;
```

Stays inside the DO. Never broadcast. Survives hibernation.

### Shape #2 — Synchronous KV (`ctx.storage.kv`)

```ts
this.ctx.storage.kv.put("oauth_refresh", token);
const tok = this.ctx.storage.kv.get<string>("oauth_refresh");
```

Same persistence story. Sync API, no `await`.

### Shape #3 — McpAgent `props`

For MCP agents, `this.props` is the canonical place for per-session credentials:

```ts
// On OAuth completion, persist:
await this.updateProps({
  ...this.props,
  oauthRefreshToken: token,
  upstreamApiKey: env.SECRET,
});

// On every tool call, read:
const t = this.props.oauthRefreshToken;
```

`McpAgent.onStart()` restores `this.props` from `ctx.storage.get("props")` on every wake (cf-mcp-auth-frontend §10 #4). It is **not** broadcast.

⚠️ **Never assign `this.props = ...` directly without `updateProps`.** Direct assignment skips the persist step; hibernation drops them silently.

### Shape #4 — Wrangler secrets (build-time)

For values that don't need to live per-instance (provider API keys, signing secrets used the same way for every user):

```bash
wrangler secret put OPENAI_API_KEY
wrangler secret put HMAC_SIGNING_KEY
```

Read inside the agent as `this.env.OPENAI_API_KEY`. These are encrypted at rest, scoped to the Worker, not in code, not in state.

---

## What goes where — full taxonomy

| Thing | Where it lives | Why |
|---|---|---|
| Counter the UI binds to | `setState` | Public, broadcast wanted |
| Message list shown in chat | `setState` | Public, broadcast wanted |
| Current "step" in a wizard | `setState` | Public, broadcast wanted |
| User's display name | `setState` | Public |
| User's email | DO SQL (private) or `this.props` | PII; only show to that user |
| OAuth access/refresh tokens | `this.props` (MCP) or DO SQL | Secret; per-session |
| Provider API keys (per-user BYOK) | `this.props` or DO SQL | Secret; per-instance |
| Provider API keys (shared by all users) | `wrangler secret put` | Secret; not per-instance |
| HMAC signing keys | `wrangler secret put` | Secret; account-wide |
| Idempotency keys | DO SQL | Internal |
| Last-seen timestamps | sync KV | Internal hot path |
| Pending-tool-call cache | DO SQL | Survives hibernation |
| Per-WebSocket auth (small) | `serializeAttachment` (≤2KB) | Per-connection, survives hibernation |

---

## Detection — auditing your code

Search your DO source for these antipatterns:

```bash
# antipattern: setState with anything that looks secret
grep -nE "setState.*(token|key|secret|password|auth)" src/

# antipattern: direct this.props assignment
grep -nE "this\.props\s*=" src/

# antipattern: accept() instead of acceptWebSocket()
grep -nE "\.accept\s*\(\s*\)" src/

# antipattern: state mutation without setState
grep -nE "this\.state\.[a-zA-Z_]+\s*=" src/
```

The CI version of this check belongs in `cf-agent-deploy-and-observe`'s pre-deploy lint. The state-shape validator (`scripts/validate-do-state-shape.ts`) catches Zod-vs-table drift but doesn't classify by sensitivity — that's still a human review.

---

## Worked example — OAuth flow

A tool-using MCP agent finishes OAuth with the upstream provider. The wrong way:

```ts
// WRONG — leaks both tokens to every connected browser
async finishOAuth(refresh: string, access: string) {
  this.setState({
    ...this.state,
    oauth: { refresh, access }, // BROADCAST
  });
}
```

The right way:

```ts
async finishOAuth(refresh: string, access: string, expires: number) {
  // 1. Stash secrets server-only
  await this.updateProps({
    ...this.props,
    oauthRefresh: refresh,
    oauthAccess: access,
    oauthExpires: expires,
  });

  // 2. Optionally update UI-visible state with NON-secret hints
  this.setState({
    ...this.state,
    isAuthenticated: true,           // public
    authenticatedAs: "user@example", // public-ish — confirm with PM
    // NO tokens, no expiry, no refresh
  });
}
```

The UI now knows the user is authenticated and can render accordingly. The tokens never cross the WebSocket boundary.
