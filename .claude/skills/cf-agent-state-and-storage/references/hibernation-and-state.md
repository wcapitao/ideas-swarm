# Hibernation and state

The most cost-critical primitive in the entire Cloudflare stack. Get it right: idle WebSockets cost ~zero. Get it wrong: ~11k GB-s/day per connection.

Sources: cf-runtime-primitives §4; cf-agents-core §7, §15.

---

## What hibernation does

When a DO has no in-flight events for a brief idle period, the runtime "evicts it from memory while maintaining client connections through the Cloudflare network." On the next message, alarm, or request:

1. The DO **constructor re-runs** — keep it cheap.
2. `onStart()` runs again (in the Agents SDK).
3. The appropriate handler fires (`webSocketMessage` / `alarm` / `fetch`).

The eviction doesn't disconnect WebSockets. The clients see no interruption. The runtime keeps the TCP sockets open and routes incoming frames into the rehydrated DO.

---

## The survival matrix

What survives a hibernate-wake cycle:

| Thing | Survives? | Notes |
|---|---|---|
| `this.state` (set via `setState`) | YES | Persisted to SQLite |
| `this.sql` rows | YES | SQLite |
| `this.ctx.storage.kv.*` | YES | Hidden `__cf_kv` SQLite table |
| `this.ctx.storage.put(...)` | YES | Same SQLite |
| `this.props` (McpAgent) | YES | Persisted by `updateProps` to `ctx.storage.get("props")` |
| In-memory class field (`this.foo = ...`) | **NO** | Gone on wake |
| `setInterval` / `setTimeout` | **NO** | Use `schedule()` / `setAlarm()` |
| Open promises / closures / async iterators | **NO** | Re-issue on wake |
| `ws.serializeAttachment(value)` | YES | **2,048-byte cap**, structured-clone only |
| Tags passed to `acceptWebSocket(server, tags)` | YES | Re-readable via `ctx.getTags(ws)` |
| Connection objects (`ctx.getWebSockets()`) | YES | Lazy-rehydrated on first access |
| Outgoing WebSockets (DO → external) | **NO** | Only server-side WS hibernates |

(cf-runtime-primitives §4; cf-agents-core §15 — Hibernation.)

---

## The mental model

> Anything you write to `this.foo = ...` is a write to a temporary cache. It will vanish.
>
> Anything you write to `this.state`, `this.sql`, or `this.ctx.storage` is a write to durable storage. It survives.

If you find yourself caching computed values in class fields, ask: do I actually need this across hibernation? If yes → SQLite. If no → leave it; the cache will be rebuilt on wake.

---

## The 2 KB serializeAttachment ceiling

Per-WebSocket-connection state survives only via `serializeAttachment`, max **2,048 bytes**, structured-clone-compatible (cf-runtime-primitives §4).

```ts
this.ctx.acceptWebSocket(server, ["user:alice"]);
server.serializeAttachment({
  userId: "alice",
  joinedAt: Date.now(),
  // small JSON only — no big blobs!
});

// On wake:
async webSocketMessage(ws: WebSocket, msg: string) {
  const att = ws.deserializeAttachment() as { userId: string; joinedAt: number };
}
```

For anything bigger, store the body in SQL keyed by an attachment-resident ID:

```ts
const connId = crypto.randomUUID();
server.serializeAttachment({ connId });
this.sql`INSERT INTO conn_state (conn_id, blob)
         VALUES (${connId}, ${JSON.stringify(bigPayload)})`;

// On wake:
async webSocketMessage(ws: WebSocket, msg: string) {
  const { connId } = ws.deserializeAttachment() as { connId: string };
  const [row] = this.sql<{ blob: string }>`
    SELECT blob FROM conn_state WHERE conn_id = ${connId}
  `;
  const big = JSON.parse(row.blob);
}
```

---

## `acceptWebSocket()` not `accept()`

Cross-cutting non-negotiable (SKILL_CATALOG.md #2):

```ts
// WRONG — DO stays in memory forever, billed continuously
server.accept();

// RIGHT — DO can hibernate, clients stay connected
this.ctx.acceptWebSocket(server);
```

Cost differential, per cf-runtime-primitives §12:
- `accept()`: ~11,059 GB-s/day per idle connection (continuous billing).
- `acceptWebSocket()`: ~zero GB-s for idle, ~72 billable requests/day for ~1 msg/min traffic.

That's the difference between paying for a fleet vs paying for actual usage. Always `acceptWebSocket`.

---

## Auto-response — don't even wake for ping/pong

```ts
this.ctx.setWebSocketAutoResponse(
  new WebSocketRequestResponsePair("ping", "pong")
);
```

Lets the runtime handle ping/pong (and any fixed request/response pair) without waking the DO. Use this for client keepalive heartbeats.

(cf-runtime-primitives §4.)

---

## Long-running work in a hibernating agent

Don't:

```ts
// WRONG — setInterval is lost on hibernation
setInterval(() => this.flush(), 30_000);
```

Do (Agents SDK):

```ts
// Schedule yourself periodically — survives hibernation
async onStart() {
  await this.schedule("*/30 * * * *", "tick");
}

async tick() {
  await this.flush();
}
```

Or for one-shot work that *must* keep the DO awake until done:

```ts
async expensiveOp() {
  await this.keepAliveWhile(async () => {
    // long-running, hibernation deferred until this resolves
    await this.crunchNumbers();
  });
}
```

For very long work, hand off to a Workflow and let the agent hibernate:

```ts
async generateReport(topic: string) {
  const inst = await this.env.REPORT_WF.create({
    id: `report-${this.name}-${Date.now()}`,
    params: { topic, agentName: this.name },
  });
  // Agent can hibernate now; workflow will write back via step.updateAgentState
  return inst.id;
}
```

(cf-agents-core §15 — Hibernation; cf-runtime-primitives §6–7.)

---

## On-wake restoration patterns

The Agents SDK runs `onStart()` after every wake. Use it to:

1. Re-create idempotent SQL schema (`CREATE TABLE IF NOT EXISTS`).
2. Re-hydrate `this.props` for McpAgent (the SDK does this for you).
3. Re-issue any in-flight workflows / queue messages that were lost.
4. **NOT** to validate state — that's `validateStateChange`.
5. **NOT** to broadcast — that's `setState`.

```ts
async onStart() {
  this.sql`CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, body TEXT)`;
  // No need to "rehydrate" this.state — the SDK does it from SQLite.
}
```

---

## Identifying a hibernation bug

Symptoms:
- Field that "was set" is suddenly undefined.
- A `setInterval` callback never fires after some idle period.
- A timer / promise / closure-captured value is lost.
- An MCP agent's `props` are missing on the second tool call after idle.

Diagnose by:
1. Check class fields — anything stored only as `this.foo = ...` is lost.
2. Check `setInterval` / `setTimeout` — replace with `schedule()` / `setAlarm()`.
3. Check McpAgent: did you assign `this.props = ...` directly? Use `updateProps()`.
4. Check `serializeAttachment` payloads — over 2 KB? Spill to SQL.

Test with `vitest-pool-workers` + `runInDurableObject`:

```ts
// Simulate hibernation by re-creating the DO with the same name
import { runInDurableObject } from "cloudflare:test";

it("survives hibernation", async () => {
  const stub = env.AGENT.get(env.AGENT.idFromName("test"));
  await runInDurableObject(stub, async (instance) => {
    await instance.setSomething("x");
  });
  // Force a fresh invocation — the SDK will re-instantiate
  const stub2 = env.AGENT.get(env.AGENT.idFromName("test"));
  await runInDurableObject(stub2, async (instance) => {
    expect(instance.getSomething()).toBe("x"); // must come from storage
  });
});
```

(See `cf-agent-tests-and-evals` for the full vitest-pool-workers setup.)

---

## Pricing — why this matters

| State of DO | Billing |
|---|---|
| Active (in-memory, processing events) | Duration GB-s + requests |
| Hibernated (memory evicted, WS connected) | **No duration GB-s.** Only inbound WS messages count, at 20:1 ratio (100 messages = 5 billable requests). |

The math (cf-runtime-primitives §12):
- 10k DAU agent system, hibernating WS, ~5 min/day active per user, ~144/month duration cost.
- Same system with `accept()` instead of `acceptWebSocket()`: 11k GB-s × 30 days × 10k users × $12.50 / M GB-s = **~$41,000/month**.

That's two orders of magnitude. Hibernation is the difference between a viable product and an unfundable one.

---

## Connection limits

- Up to **32,768** concurrent hibernating connections per DO (cf-runtime-primitives §4).
- WebSocket inbound message max: 32 MiB.
- Outgoing WebSockets do NOT hibernate — only server-side sockets do.
