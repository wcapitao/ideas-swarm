# `this.props` vs `setState` — surfaces, scope, and the leak rule

The single highest-frequency bug class in Cloudflare agents is "I put
a token in `setState` and now it's broadcast to every connected
client". This reference is the long-form version of the SKILL.md table,
with worked examples of right and wrong placement.

Source: `cloudflare/agents/packages/agents/src/mcp/index.ts`,
`cloudflare/agents/packages/agents/src/index.ts` (Agent base class),
`cf-mcp-auth-frontend.md` §10 gotcha #1.

---

## The four state surfaces

| Surface | Scope | Visibility | Persistence | Use for |
|---|---|---|---|---|
| `this.props` | Per OAuth-authenticated client | Server-only | DO storage (`ctx.storage`) via `onStart`/`updateProps` | Tokens, refresh tokens, userId, scopes, upstream API keys |
| `this.state` / `this.setState` | One DO instance | **BROADCAST** to every connected WS client via `cf_agent_state` | DO storage automatic | Public state: chat history, presence, public counters |
| `this.ctx.storage.put(k,v)` | One DO instance | Server-only | DO storage | Anything you don't want broadcast and don't want re-sent on state change |
| ``this.sql`...` `` | One DO instance | Server-only (raw SQLite) | DO storage | Big or queryable data: audit logs, message rows with metadata |

---

## Why `setState` broadcasts (and what that means for you)

The agent SDK's `setState` does three things:

1. Writes the new value to `this.state` (in-memory).
2. Persists it to DO storage (via the base `Agent` class).
3. Sends a `cf_agent_state` WebSocket message to **every currently
   connected client** subscribed to this DO instance.

That third step is what makes it a leak surface. Multiple WebSocket
clients connect to the same DO when they call `useAgent({ name })` with
the same `name`. Two tabs in one browser — same DO, both subscribed.
A user shares the URL — friend connects, same DO, third subscriber.
Multi-user collaborative agent — every collaborator subscribed.

Whatever you put in state goes to all of them. Including tokens.

### Worked example — the leak

```ts
// WRONG — token broadcasts to every connected tab / user
export class ChatAgent extends AIChatAgent<Env, { history: Msg[]; githubToken: string }> {
  async onConnect(conn: Connection, ctx: ConnectionContext) {
    // Bug: stuffing the token into state so "the agent can use it later"
    this.setState({
      ...this.state,
      githubToken: this.props.githubAccessToken,
    });
  }
}
```

When the second tab connects, it gets a `cf_agent_state` message
containing `githubToken`. So does any other connected client.

### The fix

```ts
// RIGHT — token lives on this.props (server-only), state holds only public data
export class ChatAgent extends AIChatAgent<Env, { history: Msg[] }> {
  // No githubToken in State<>!  this.props.githubAccessToken is the source of truth.

  async onChatMessage() {
    // Use the token from this.props inline, never copy it to state.
    const githubResp = await fetch("https://api.github.com/user/repos", {
      headers: { Authorization: `Bearer ${this.props.githubAccessToken}` },
    });
    // ...
  }
}
```

If you need the token "later" — it's already there, on `this.props`.
That's the whole point of props.

---

## The persistence pattern for `this.props`

`McpAgent` does this for you. If you write a custom subclass of `Agent`
(not `McpAgent`), implement the same shape:

```ts
import { Agent } from "agents";

export class CustomAgent extends Agent<Env, MyState, MyProps> {
  async onStart(props?: MyProps) {
    if (props) {
      this.props = props;
      await this.ctx.storage.put("props", props);
    } else {
      // Hibernation recovery — DO woke up without props on the call
      const stored = await this.ctx.storage.get<MyProps>("props");
      if (stored) this.props = stored;
    }
  }

  async updateProps(props: MyProps) {
    this.props = props;
    await this.ctx.storage.put("props", props);
  }
}
```

### Why this matters

DOs hibernate. When a WS connection drops and a new one opens later
(or a new HTTP request arrives), the DO wakes up. `onStart` is called
**without** props on hibernation recovery — the props arg is only
populated when an OAuth-authenticated request flowed in fresh.

If you assigned `this.props = newValue` once and never wrote to
`ctx.storage`, the next hibernation drops them. The agent suddenly
"forgets" the user — UID is gone, tokens are gone, scopes are gone. The
symptom is "my agent works for ~30 seconds then loses auth".

`McpAgent.onStart` does the right thing automatically. Don't override
it without preserving the persist-and-restore pattern.

---

## When to use `ctx.storage` directly

Use it for:

- Per-session data that's NOT a token but ALSO not safe to broadcast
  (e.g. a list of audit-log row IDs, the last upstream-API rate-limit
  reset time, an internal feature-flag override for this user).
- Data too big for `state` (state has a 128KB limit per write — past
  that, use storage or `sql`).
- Anything you'd otherwise put in `props` if `props` weren't only set
  at OAuth time.

Pattern:

```ts
async onChatMessage() {
  const lastResetMs = (await this.ctx.storage.get<number>("rateLimitReset")) ?? 0;
  if (Date.now() < lastResetMs) {
    return errorResponse("Rate limited");
  }
  // ... do the work
  await this.ctx.storage.put("rateLimitReset", Date.now() + 60_000);
}
```

---

## When to use `this.sql`

Use it for queryable, structured per-session data: audit logs with
filters, chat message tables with user-id FKs, attachments. The
SQLite-backed DO is FREE for storage up to the DO storage budget
(currently 10GB per DO).

```ts
async init() {
  this.sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      ts INTEGER, user_id TEXT, tool TEXT, ok INTEGER, args TEXT
    );
  `;
}

async logToolCall(tool: string, ok: boolean, args: unknown) {
  this.sql`
    INSERT INTO audit_log (ts, user_id, tool, ok, args)
    VALUES (${Date.now()}, ${this.props.userId}, ${tool}, ${ok ? 1 : 0}, ${JSON.stringify(args)});
  `;
}
```

Same scope as `ctx.storage` — server-only, never broadcast.

---

## Decision tree (laminate this)

```
Need to store something on the agent.
│
├─ Is it a secret / token / API key / refresh token?
│  └─ YES → this.props (set once at OAuth, persisted via ctx.storage)
│
├─ Is it a per-user identity claim (userId, email, scopes)?
│  └─ YES → this.props
│
├─ Should every connected tab / collaborator see it?
│  └─ YES → setState (broadcast is the feature)
│
├─ Is it big (>10KB) or needs queries?
│  └─ YES → this.sql with a real table
│
└─ Otherwise → this.ctx.storage.put / get
```

When in doubt, `ctx.storage`. It's never wrong; it's just sometimes not
the most ergonomic choice.

---

## CI guardrail

Run `scripts/audit-state-for-secrets.ts` against a state dump in CI.
The script regex-greps for tokens and exits non-zero if any are found
inside the broadcast `state` field. Do this before every deploy.

```bash
# In CI:
node --import tsx scripts/audit-state-for-secrets.ts test/fixtures/agent-state.json
```

If the audit fires, the fix is always the same: move the field from
`state` to `props` (or to `ctx.storage`). Never the other way around.
