# Cloudflare Runtime Primitives for the Agents SDK

A technical brief on Durable Objects, Workflows, and Queues — the three Cloudflare runtime primitives the Cloudflare Agents SDK is built on. This is the substrate. Get it wrong and your agent will leak money, drop messages, or fail to coordinate. Get it right and you have a globally-distributed, single-threaded, persistent compute model that no other vendor offers.

Audience: an engineer writing skills (LLM playbooks) for building Cloudflare Agents.

Sources: every claim is cited inline against the Cloudflare developer docs (retrieved 2026-04-30).

---

## 1. DO core mental model — single-threaded, located, persistent, transactional

A Durable Object (DO) is "a specialized Cloudflare Worker that combines serverless compute with persistent storage" — it "uniquely combines compute with storage" and exists as a globally-unique, named instance you can target from anywhere ([durable-objects/](https://developers.cloudflare.com/durable-objects/)). Three things make it different from a normal Worker:

1. **Persistent identity.** A DO has a name (or unique ID) that addresses *one specific instance* worldwide. Two requests addressed to `Room#42` always hit the same instance, on the same physical machine, with the same in-memory state — until that instance is evicted ([api/namespace](https://developers.cloudflare.com/durable-objects/api/namespace/)).

2. **Single-threaded execution per instance.** Only one event runs at a time inside a given DO. This is enforced by the runtime; concurrency control inside the DO is unnecessary because there *is* no concurrency. `blockConcurrencyWhile(callback)` exists to extend the same property across the constructor — it "executes an async callback while preventing other events from reaching the Durable Object … the runtime enforces a 30-second timeout; exceeding it resets the object" ([api/state](https://developers.cloudflare.com/durable-objects/api/state/)).

3. **Transactional, co-located storage.** Each DO has its own private SQLite database (or, on the legacy backend, its own KV namespace). The storage lives on the same physical node as the compute, so reads and writes are sub-millisecond. "All storage operations are implicitly wrapped inside a transaction ensuring atomicity and isolation across concurrent operations" ([api/storage-api](https://developers.cloudflare.com/durable-objects/api/storage-api/)).

### When you want a DO

- **Per-entity state with strong consistency.** A chat room, a multiplayer game session, a per-user inbox, a per-document collaborative editing buffer, a per-org rate limiter, a per-conversation Agent. The defining test: *is there one logical thing whose state mutations must be serializable?* If yes — DO.
- **WebSocket fan-in.** "A single Durable Object instance can coordinate communication between thousands of clients simultaneously, making it ideal for chat rooms or multiplayer games" ([best-practices/websockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)).
- **Long-running stateful agents.** The Cloudflare Agents SDK uses a DO per agent because the agent's memory, tool history, and pending alarms all need to live inside one transactional coordinate space.

### When you don't want a DO

- **Stateless request handling** — use a plain Worker. DOs add latency (the request may have to hop to wherever the DO lives) and cost (duration GB-s charges).
- **Fan-out parallel work** — use Queues. DOs are *single-threaded*; pushing parallel jobs through a single DO serializes them.
- **Long deterministic multi-step pipelines** — use Workflows. DOs do not give you free retries, durable step caching, or weeks-long sleeps.

### Throughput ceiling

A DO can handle roughly "1,000 requests/second per object (soft limit)" ([platform/limits](https://developers.cloudflare.com/durable-objects/platform/limits/)). That is *per instance*. If your single hot DO needs more, shard it (e.g. `Room#42-shard-0`, `Room#42-shard-1`).

### Locating a DO

When you call `env.MY_DO.idFromName("foo")` followed by `env.MY_DO.get(id)`, the system creates the object lazily. You can pass a `locationHint` to push placement closer to a region, or scope an entire namespace to a `jurisdiction` (e.g. `"eu"`) to keep data resident in that region ([api/namespace](https://developers.cloudflare.com/durable-objects/api/namespace/)):

```js
const id = env.MY_DO.idFromName("room-42");
const stub = env.MY_DO.get(id, { locationHint: "weur" });
const euId = env.MY_DO.newUniqueId({ jurisdiction: "eu" });
```

The three ID-construction methods are not interchangeable ([api/id](https://developers.cloudflare.com/durable-objects/api/id/)):

- `idFromName(name)` — deterministic from a string. Two callers anywhere in the world get the same ID. This is what the Agents SDK uses (one DO per agent name).
- `newUniqueId()` — a fresh 64-hex random ID. Lower latency on creation because no global consistency check is required, but you must persist the hex string yourself if you want to find the object again.
- `idFromString(hexString)` — rehydrate a previously serialized ID.

---

## 2. DO storage API summary — old API vs new SQLite-backed

Cloudflare now offers two storage backends. **Use SQLite for all new namespaces.** Per the docs, SQLite "is the recommended approach and available on both plans. Key-value storage requires the Paid plan" ([platform/pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)). Crucially, "you cannot enable a SQLite storage backend on an existing, deployed Durable Object class" ([reference/durable-objects-migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)) — the choice is permanent at namespace creation.

### KV-backed (legacy) — `new_classes`

```
ctx.storage.get(key | string[]): Promise<value | Map>
ctx.storage.put(key, value): Promise
ctx.storage.delete(key | string[]): Promise<boolean | number>
ctx.storage.list(options?): Promise<Map<string, value>>
```

All async. List options: `start`, `startAfter`, `end`, `prefix`, `reverse`, `limit`, `allowConcurrency`, `noCache` ([api/storage-api](https://developers.cloudflare.com/durable-objects/api/storage-api/)). Key max 2 KiB, value max 128 KiB ([platform/limits](https://developers.cloudflare.com/durable-objects/platform/limits/)).

### SQLite-backed (recommended) — `new_sqlite_classes`

You get *three* APIs on top of the same SQLite database:

1. **Synchronous KV** — `ctx.storage.kv.get/put/delete/list`. Synchronous! No promises. Stored in a hidden `__cf_kv` table. This is the per-row read/write fast path.
2. **Asynchronous KV** — same shape as the legacy API.
3. **SQL** — `ctx.storage.sql.exec(query, ...bindings)`.

Plus you get **Point-in-Time Recovery** (rewind the entire DB up to 30 days back) and SQLite extensions: FTS5, JSON, math ([api/sql-storage](https://developers.cloudflare.com/durable-objects/api/sql-storage/)).

### SQL API in detail

```ts
const cursor = ctx.storage.sql.exec(
  "SELECT * FROM artist WHERE artistid = ?;",
  123,
);
for (const row of cursor) console.log(row.artistname);
// or: cursor.toArray(); cursor.one(); cursor.raw().toArray();
```

Cursor properties: `columnNames`, `rowsRead`, `rowsWritten` (the last two drive billing) ([api/sql-storage](https://developers.cloudflare.com/durable-objects/api/sql-storage/)).

You **cannot** issue `BEGIN` or `SAVEPOINT` via `exec()`. Use `ctx.storage.transactionSync(() => { ... })` for sync transactions or `ctx.storage.transaction(async (txn) => { ... })` for async ([api/sql-storage](https://developers.cloudflare.com/durable-objects/api/sql-storage/)).

Because writes are auto-coalesced, "explicit transactions are no longer necessary … any sequence of writes without intervening awaits submits atomically" ([api/storage-api](https://developers.cloudflare.com/durable-objects/api/storage-api/)). The single-threaded model makes this safe.

### Schema migrations

There is no built-in `wrangler db migrate` for DO SQLite. The convention is to gate schema work in the DO constructor via `blockConcurrencyWhile`:

```ts
constructor(ctx, env) {
  super(ctx, env);
  ctx.blockConcurrencyWhile(async () => {
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY,
        body TEXT NOT NULL,
        created_at INTEGER
      );
    `);
  });
}
```

This runs once per cold-start, before any request is admitted, and the 30-second cap protects you from runaway migrations ([api/state](https://developers.cloudflare.com/durable-objects/api/state/)).

### Point-in-Time Recovery

```ts
const bookmark = await ctx.storage.getCurrentBookmark();
// later, after damage:
const past = await ctx.storage.getBookmarkForTime(Date.now() - 3600_000);
await ctx.storage.onNextSessionRestoreBookmark(past);
ctx.abort(); // restart triggers restore
```

Bookmarks are lexically ordered strings, valid for 30 days. Recovery applies to "the entire SQLite database contents, including both the object's stored SQL data and stored key-value data" ([api/storage-api](https://developers.cloudflare.com/durable-objects/api/storage-api/)). PITR is unique to the SQLite backend.

### Key limits

- Per-object SQLite storage cap: **10 GB** ([platform/limits](https://developers.cloudflare.com/durable-objects/platform/limits/))
- Row size / BLOB / string: 2 MB max
- SQL statement: 100 KB
- Bound parameters per query: 100
- Free tier: account-wide 5 GB

When the cap is hit, "read operations will continue to work" but writes fail with `SQLITE_FULL` ([platform/limits](https://developers.cloudflare.com/durable-objects/platform/limits/)).

---

## 3. DO alarms — exact API, single alarm per DO

A DO can schedule itself to wake up at a future timestamp. **One alarm per DO**, full stop. "Each object can maintain a single alarm at a time by calling `setAlarm()`" ([api/alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)). Calling `setAlarm` again overrides the existing one.

### API surface

```ts
ctx.storage.setAlarm(scheduledTimeMs: number): Promise<void>
ctx.storage.getAlarm(): Promise<number | null>
ctx.storage.deleteAlarm(): Promise<void>

// On the DO class:
async alarm(alarmInfo?: { retryCount: number; isRetry: boolean }) {
  // ...
}
```

`getAlarm()` returns the scheduled time in ms-since-epoch, or `null` while the handler is running (unless you re-armed during execution) ([api/alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)).

### Retry semantics

"The `alarm()` handler has guaranteed at-least-once execution and will be retried upon failure using exponential backoff, starting at 2 second delays for up to 6 retries" ([api/alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)). Retries fire only on uncaught exceptions. After 6 failures, the alarm is dropped — so wrap risky work in try/catch and `setAlarm` again on failure if you need indefinite retry.

The handler has a wall-clock cap: "Wall time (alarms): 15 minutes maximum" ([platform/limits](https://developers.cloudflare.com/durable-objects/platform/limits/)).

### Pattern: self-rescheduling tick

```ts
async alarm() {
  await this.processPending();
  await this.ctx.storage.setAlarm(Date.now() + 60_000); // tick every minute
}
```

### When to use a DO alarm vs Workflows vs Queues

| Need | Pick |
|------|------|
| One DO needs to wake itself in N seconds/days to do per-instance work | DO alarm |
| One job has 10+ deterministic steps, may sleep for hours, must survive restarts | Workflows |
| You need to fan out N independent tasks, with retries, batching, DLQ | Queues |
| You need a single periodic tick across a fleet of DOs | Each DO sets its own alarm; do **not** try to fan out from a coordinator |

The single-alarm-per-DO restriction is the biggest gotcha: if you want multiple wake-ups, store a *priority queue of wake-up times* in storage and always set the alarm to the earliest pending one (this pattern is exactly what the Cloudflare Agents SDK's scheduling layer implements on top of `alarm()`).

---

## 4. DO websockets + hibernation

Hibernation is the most cost-critical primitive in the entire stack. Get it right, you pay almost nothing for an idle WebSocket. Get it wrong, you pay 24/7 for a DO that's "active" because it has a connection.

### The gotcha — `acceptWebSocket` vs `accept`

```ts
// WRONG — DO stays in memory forever, billed continuously
server.accept();

// RIGHT — DO can hibernate, clients stay connected
this.ctx.acceptWebSocket(server);
```

The docs are explicit: "Unlike `ws.accept()`, `state.acceptWebSocket(ws)` allows the Durable Object to be hibernated" ([api/websockets](https://developers.cloudflare.com/durable-objects/api/websockets/)). With hibernation, "Billable Duration (GB-s) charges do not accrue during hibernation" ([best-practices/websockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)).

### The full hibernation pattern in ~50 lines

```ts
import { DurableObject } from "cloudflare:workers";

export class ChatRoom extends DurableObject {
  async fetch(request: Request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Hibernation-safe accept
    this.ctx.acceptWebSocket(server, ["user:alice"]); // tags optional

    // Per-connection state survives hibernation (max 2,048 bytes)
    server.serializeAttachment({
      userId: "alice",
      joinedAt: Date.now(),
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // Runtime calls these handlers; constructor re-runs on wake
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const { userId } = ws.deserializeAttachment() ?? {};
    // Broadcast to everyone in the room
    for (const peer of this.ctx.getWebSockets()) {
      peer.send(JSON.stringify({ from: userId, body: message }));
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    console.error("ws error", error);
  }
}
```

### What hibernation actually does

When the DO has no in-flight events for a brief idle period, the runtime "evicts it from memory while maintaining client connections through the Cloudflare network" ([api/websockets](https://developers.cloudflare.com/durable-objects/api/websockets/)). On the next message/alarm/request, the constructor re-runs (so keep it cheap), and the appropriate `webSocket*` handler fires.

### Per-connection state — `serializeAttachment`

In-memory `this.foo` is gone after hibernation. Anything you need per-connection survives only via `ws.serializeAttachment(value)` (max **2,048 bytes**, structured-clone-compatible) and `ws.deserializeAttachment()` ([api/websockets](https://developers.cloudflare.com/durable-objects/api/websockets/)). For anything bigger, persist to `ctx.storage` and key by a small attachment.

### Auto-response — avoid waking for ping/pong

`ctx.setWebSocketAutoResponse(pair)` lets you register a fixed request/response (e.g. ping/pong) that the runtime answers without ever waking the DO ([api/state](https://developers.cloudflare.com/durable-objects/api/state/)). Use this for keepalives.

### Limits

- Up to **32,768** concurrent hibernating connections per DO ([api/state](https://developers.cloudflare.com/durable-objects/api/state/))
- Inbound message max **32 MiB** ([platform/limits](https://developers.cloudflare.com/durable-objects/platform/limits/))
- Outgoing WebSockets do **not** hibernate — only the server-side socket does ([best-practices/websockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/))
- WebSocket message billing ratio: 20:1 (100 incoming = 5 billable requests) ([platform/pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/))

---

## 5. DO migrations in wrangler

Migrations communicate class lifecycle changes to the Workers runtime — "a mapping process from a class name to a runtime state" ([reference/durable-objects-migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)). Every migration has a **unique tag** that the runtime uses to track which have been applied. Migrations are atomic — they cannot be gradually deployed.

### Create a new SQLite-backed class (recommended for everything new)

```toml
[[durable_objects.bindings]]
name = "AGENT"
class_name = "Agent"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Agent"]
```

### Create a legacy KV-backed class (avoid)

```toml
[[migrations]]
tag = "v1"
new_classes = ["LegacyAgent"]
```

The legacy form remains "for backwards compatibility" but new namespaces should not use it ([reference/durable-objects-migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)).

### Delete a class

```toml
[[migrations]]
tag = "v2"
deleted_classes = ["DeprecatedAgent"]
```

**This destroys all stored data for every instance of that class.** Remove the binding and code references first.

### Rename a class (same Worker)

```toml
[[durable_objects.bindings]]
name = "AGENT"
class_name = "AgentV2"   # already updated to new name

[[migrations]]
tag = "v3"
[[migrations.renamed_classes]]
from = "Agent"
to = "AgentV2"
```

Do **not** pre-create the destination class — the migration creates it.

### Transfer a class (between Worker scripts)

```toml
[[migrations]]
tag = "v4"
[[migrations.transferred_classes]]
from        = "Agent"
from_script = "old-worker"
to          = "Agent"
```

### Hard rules

1. **SQLite cannot be retrofitted.** "You cannot enable a SQLite storage backend on an existing, deployed Durable Object class" — `new_sqlite_classes` on an already-existing class fails ([reference/durable-objects-migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)). Choose at namespace creation.
2. **Tags must be unique forever** within a script. Don't reuse `v1`.
3. **Backward-compatible code first, migration second.** Code updates do not require a migration, but a migration without backward-compatible code corrupts existing instances.
4. **Workers Free supports only SQLite.** Workers Paid supports both. Downgrading from Paid → Free requires deleting all KV-backed objects first.
5. **500 DO classes max per Paid account, 100 Free.**

---

## 6. Workflows mental model

Workflows are "durable multi-step execution without timeouts" ([workflows/](https://developers.cloudflare.com/workflows/)). You write what looks like sequential async code; the platform persists every step result, replays on resume, and survives hours/days/weeks of sleep.

### When to reach for it

| Use case | Right primitive |
|----------|----------------|
| 8-step user onboarding: send email → wait 24h → check engagement → branch | **Workflows** |
| Chat room state, one DO per room | **DO** |
| 10k-row email blast, retry per row | **Queues** |
| One DO needs to flush a buffer every 30 seconds | **DO alarm** |
| AI pipeline: fetch → embed → store → notify, must survive failure | **Workflows** |
| Periodic sweep across a fleet of agents | **Workflows** with `step.sleep` (or per-DO alarms) |

The defining test: *is there one logical job with multiple expensive steps that I want to retry independently, and that may need to sleep for non-trivial time?* If yes — Workflows.

### `step.do` idempotency rules

Steps are checkpoints. A retry replays the workflow up to the failed step, skipping already-completed `step.do` results. From [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/):

1. **Non-idempotent calls go inside `step.do`, after a check.** Charge a card → first check whether you already charged. The check is what gives you safety on retry.
2. **One step = one unit of work.** Combining multiple side effects in one step prevents independent retries.
3. **Step names are cache keys.** They must be deterministic. `` step.do(`run-${Date.now()}`, ...) `` defeats the cache.
4. **Don't mutate the event.** "Any changes to an event are not persisted across the steps of a Workflow" ([build/events-and-parameters](https://developers.cloudflare.com/workflows/build/events-and-parameters/)). Return data from `step.do` instead.
5. **Always `await` steps.** Unawaited promises swallow errors and create races.
6. **Conditional logic must be deterministic.** Branch on step outputs or event payload, not `Math.random()` or `Date.now()`.
7. **Wrap all side effects in `step.do`.** Anything outside is replayed every retry.
8. **Step results ≤ 1 MiB**, must be structured-cloneable.

---

## 7. Workflows API summary — code samples for the 5 most important methods

Source: [build/workers-api](https://developers.cloudflare.com/workflows/build/workers-api/) and [build/sleeping-and-retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/).

### Skeleton

```ts
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";

interface Params { userId: string }

export class OnboardingWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    // ...
  }
}
```

### 1. `step.do` — durable, retried, idempotent unit of work

```ts
const profile = await step.do("fetch-profile", async () => {
  const res = await fetch(`https://api.example.com/users/${event.payload.userId}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`); // triggers retry
  return await res.json(); // ≤ 1 MiB, structured-cloneable
});
```

With per-step retry config (defaults: 5 retries, 10 s delay, exponential, 10 min timeout):

```ts
await step.do(
  "charge-card",
  {
    retries: { limit: 10, delay: "10 seconds", backoff: "exponential" },
    timeout: "30 minutes",
  },
  async () => { /* ... */ },
);
```

For terminal failures, throw `NonRetryableError` to abort without retries ([build/sleeping-and-retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)).

### 2. `step.sleep` — pause for a duration

```ts
await step.sleep("wait-24h", "1 day"); // or 86_400_000 (ms)
```

Accepts seconds, minutes, hours, days, weeks, months, years ([build/sleeping-and-retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)). Sleeps don't count against compute or step limits, and "waiting instances do not count towards instance concurrency limits" ([reference/limits](https://developers.cloudflare.com/workflows/reference/limits/)) — millions of sleeping workflows are fine. Max sleep: **365 days**.

### 3. `step.sleepUntil` — pause to an absolute time

```ts
const fireAt = new Date("2026-12-01T09:00:00Z");
await step.sleepUntil("send-renewal-reminder", fireAt);
```

### 4. `step.waitForEvent` — pause for an external signal

```ts
const approval = await step.waitForEvent("await-human-approval", {
  type: "approval",
  timeout: "7 days", // default 24h
});
```

The workflow is woken by an external `sendEvent` call (Worker binding or REST API) carrying a payload that lands in `approval`.

### 5. Triggering — `env.MY_WORKFLOW.create`

From a Worker, Agent, or another Workflow:

```ts
const instance = await env.ONBOARDING.create({
  id: `onboard-${userId}`, // optional; otherwise auto-generated
  params: { userId },
});

const status = await instance.status();
// or by ID:
const inst = await env.ONBOARDING.get(`onboard-${userId}`);
await inst.pause(); await inst.resume(); await inst.terminate(); await inst.restart();
```

The binding exposes `create`, `get`, `status`, `pause`, `resume`, `terminate`, `restart`, and `sendEvent` ([build/trigger-workflows](https://developers.cloudflare.com/workflows/build/trigger-workflows/)). Note: when a parent workflow triggers a child, "the parent Workflow will not block waiting for the child Workflow to complete — it continues execution immediately" — child workflows are fire-and-forget.

---

## 8. Workflows triggers

Three ways to start a workflow ([build/events-and-parameters](https://developers.cloudflare.com/workflows/build/events-and-parameters/), [build/trigger-workflows](https://developers.cloudflare.com/workflows/build/trigger-workflows/)):

### Worker → Workflow

```ts
// wrangler.toml
[[workflows]]
name = "onboarding"
binding = "ONBOARDING"
class_name = "OnboardingWorkflow"

// In the Worker fetch handler:
export default {
  async fetch(req: Request, env: Env) {
    const { userId } = await req.json();
    const inst = await env.ONBOARDING.create({ params: { userId } });
    return Response.json({ id: inst.id });
  },
};
```

### Agent → Workflow

The Cloudflare Agents SDK runs inside a DO. To kick off a workflow from a tool call:

```ts
class MyAgent extends Agent<Env> {
  async generateReport(topic: string) {
    const inst = await this.env.REPORT_WF.create({
      id: `report-${this.name}-${Date.now()}`,
      params: { topic, agentId: this.name },
    });
    return inst.id;
  }
}
```

The agent fires the workflow and returns the instance ID. The workflow does the long-running work (fetch → reason → write → store) and signals the agent back via `step.do` writing into the agent DO's storage, or via a Worker invoking the agent's RPC.

### Scheduled / cron triggers

Workflows can be triggered from a Worker's `scheduled` handler (Cron Triggers) — the Worker is the cron, the workflow is the body of work. There is no first-class `[[triggers.crons]]` binding directly on a Workflow; you add a cron trigger to a Worker and have it call `env.MY_WORKFLOW.create(...)`.

### REST API and CLI

Workflows can also be triggered via REST and via `wrangler workflows trigger <name> '<json>'` ([build/events-and-parameters](https://developers.cloudflare.com/workflows/build/events-and-parameters/)).

---

## 9. Queues — basic shape, when to choose

Queues implement "guaranteed delivery" producer/consumer messaging with batching, retries, DLQs, and configurable delays ([queues/](https://developers.cloudflare.com/queues/)).

### Producer

```ts
// wrangler.toml
[[queues.producers]]
queue   = "ingest-jobs"
binding = "INGEST"

// In the Worker:
await env.INGEST.send({ url: "https://...", userId: "u-42" });
await env.INGEST.send(payload, { delaySeconds: 600 });        // delay
await env.INGEST.sendBatch([{ body: a }, { body: b }, { body: c }]);
```

Body limits: single message **128 KB**; `sendBatch` up to 100 messages totalling 256 KB ([configuration/javascript-apis](https://developers.cloudflare.com/queues/configuration/javascript-apis/)).

### Consumer

```toml
[[queues.consumers]]
queue              = "ingest-jobs"
max_batch_size     = 10        # default 10, up to 100
max_batch_timeout  = 30        # seconds, default 5
max_retries        = 10        # default 3
dead_letter_queue  = "ingest-jobs-dlq"
max_concurrency    = 50        # 1–250, or omit for auto
```

```ts
export default {
  async queue(batch: MessageBatch<Job>, env: Env) {
    for (const msg of batch.messages) {
      try {
        await process(msg.body);
        msg.ack();                          // confirm one
      } catch (err) {
        msg.retry({ delaySeconds: 60 * msg.attempts }); // exp backoff
      }
    }
    // Or: batch.ackAll() / batch.retryAll()
  },
};
```

Per-message methods `ack()` / `retry()` give you per-row control inside a batch. "If you call `ack()` on a message, subsequent calls to `ack()` or `retry()` are silently ignored" ([configuration/batching-retries](https://developers.cloudflare.com/queues/configuration/batching-retries/)).

### Dead Letter Queues

After `max_retries` attempts, the message routes to `dead_letter_queue` if configured — otherwise it's dropped. DLQs are just queues; "configure a consumer for that queue just as you would any standard queue" ([configuration/dead-letter-queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/)). Dead-lettered messages persist 4 days if no consumer.

### Concurrency

Concurrency autoscales by default based on backlog size and error rate — up to 250 concurrent invocations on push-based queues ([configuration/consumer-concurrency](https://developers.cloudflare.com/queues/configuration/consumer-concurrency/)). Cloudflare recommends leaving `max_concurrency` unset.

### Queues vs Workflow vs Alarm

| Trait | Queues | Workflow | DO Alarm |
|-------|--------|----------|----------|
| **Shape** | Fan-out | Linear pipeline | Self-tick |
| **Order** | Best-effort | Sequential | Single |
| **State** | Per-message | Per-instance, multi-step | Inside one DO |
| **Retries** | Per message, configurable | Per step, configurable, exp backoff | 6 retries, exp |
| **Sleep** | Up to 24 h delay | Up to 365 days | Up to 15 min wall-clock per fire |
| **Use when** | "Email these 10k users" | "Onboard this user over 7 days" | "Buffer writes, flush every 30s" |

---

## 10. The decision tree

Ask, in order:

1. **Is there one logical entity whose state must serialize?** (a chat room, a per-user agent, a per-document buffer)  
   → **Durable Object**, named via `idFromName`.

2. **Inside that DO, do you need to wake yourself up later to do work?**  
   → **DO alarm.** Remember: one alarm per DO. Multiple wake-ups = priority queue in storage.

3. **Are you running a multi-step pipeline that may sleep, must retry per step, and must survive deploys?**  
   → **Workflows.** Trigger from a Worker or Agent via `env.MY_WF.create(...)`. Each side effect goes in `step.do`.

4. **Are you fanning out N independent jobs?**  
   → **Queues.** Producer in one Worker/Agent, `queue()` consumer in another. Configure DLQ. Use `msg.retry({ delaySeconds })` for backoff.

5. **Do you need real-time push to many clients?**  
   → **DO + WebSocket Hibernation API.** Always `acceptWebSocket` (never `accept`). Per-connection state via `serializeAttachment` (≤ 2 KB). Anything larger → `ctx.storage`.

6. **Just stateless request handling?**  
   → Plain Worker. Don't pay DO duration GB-s for nothing.

### Combine, don't substitute

The Cloudflare Agents SDK is a **DO** (per-agent state and single-threaded loop) that uses **alarms** (scheduled work, polling, retries), invokes **Workflows** for long deterministic pipelines, and produces to **Queues** for fan-out side effects. None of these primitives substitutes for another — they compose.

---

## 11. Limits comparison table

| Dimension | Durable Objects | Workflows | Queues |
|-----------|-----------------|-----------|--------|
| **Compute time per event** | 30 s default, up to 5 min CPU | Free 10 ms / Paid 30 s, up to 5 min per step | 30 s default, up to 5 min CPU per consumer batch |
| **Wall-clock max** | Unlimited (HTTP/RPC); 15 min (alarm) | Unlimited per step; total bounded by 365-day sleep & step count | 15 min per consumer invocation |
| **Throughput** | ~1,000 req/s per object (soft) | 50,000 concurrent running instances (Paid) | 5,000 msg/s per queue |
| **Concurrent connections** | 32,768 hibernating WS per DO | n/a | 250 concurrent consumer invocations |
| **Max message / payload size** | WS message: 32 MiB inbound; SQL row/BLOB: 2 MB | Step result: 1 MiB; event payload: 1 MiB | 128 KB per message; 256 KB per batch |
| **Storage cap** | 10 GB per DO (SQLite); account-wide 5 GB free / unlimited paid | Per instance: 100 MB free / 1 GB paid | Backlog: 25 GB per queue |
| **Retention** | Forever (until deleted); PITR 30 days | Step state retained for instance lifetime | 24 h free / 4 d paid default, up to 14 d |
| **Max instances / objects** | Unlimited per namespace; 500 classes paid | Free 100k execs/day, Paid unlimited; concurrency 100 free / 50,000 paid | 10,000 queues per account |
| **Retries** | Alarm: 6, exp backoff from 2s | Per step: default 5, configurable to 10,000 | Default 3, max 100 per message |
| **Sleep / delay** | Alarm scheduled to any future time | Up to 365 days `step.sleep` | Up to 24 h `delaySeconds` |
| **Other notable** | Single-threaded per instance; 100 SQL bound params; 100 cols/table | 10,000 steps default (25,000 paid); 50 subrequests free / 10,000 paid | Pull queue visibility timeout 12 h |

Sources: [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/), [Queues limits](https://developers.cloudflare.com/queues/platform/limits/).

---

## 12. Pricing comparison — back-of-envelope

All figures from [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/), and Workers Paid pricing referenced from the docs.

### Durable Objects

| Item | Free | Paid included | Beyond included |
|------|------|---------------|-----------------|
| Requests | 100k/day | 1M/month | $0.15/M |
| Duration | 13k GB-s/day | 400k GB-s/month | $12.50/M GB-s |
| SQLite reads | 5M rows/day | 25B rows/month | $0.001/M |
| SQLite writes | 100k rows/day | 50M rows/month | $1.00/M |
| SQLite storage | 5 GB | 5 GB-month | $0.20/GB-month |
| KV reads (legacy) | — | 1M units/month | $0.20/M (4 KB/unit) |
| KV writes (legacy) | — | 1M/month | $1.00/M |
| KV storage | — | 1 GB-month | $0.20/GB-month |

A single hibernating WS connection that sees ~1 message/min costs roughly: 1,440 messages/day × 1/20 (WS billing ratio) = 72 billable requests/day. At idle (hibernated), **zero duration GB-s**. That's the magic of hibernation. The same DO with `accept()` instead of `acceptWebSocket()` would burn 24 × 60 × 60 × 0.128 = **11,059 GB-s/day**, or ~2× the entire free tier per connection per day. Always prefer `acceptWebSocket`.

### Workflows

Workflows bill on Workers compute (CPU-ms while a step is running) plus per-instance overhead. **Sleeps and `waitForEvent` periods are free** — "waiting instances do not count towards instance concurrency limits" ([reference/limits](https://developers.cloudflare.com/workflows/reference/limits/)). Free tier: 100k executions/day, 100 concurrent running. Paid: unlimited executions, 50,000 concurrent running.

A 7-day onboarding workflow with 5 steps × 200 ms CPU each = 1 second of CPU spread over a week. Effectively free of CPU charges; you pay only for the underlying Worker request units.

### Queues

Billed per **operation**, where 1 op = 64 KB written, read, or deleted. A typical message lifecycle is 3 ops (write + read + delete).

- Free: 10k ops/day
- Paid: 1M ops/month included, then $0.40/M

Cost of pushing 10M messages/month through a queue (each ≤ 64 KB):  
`(10M × 3) - 1M = 29M` × $0.40/M = **~$11.60/month**. Add retry reads if any.

### Worked example — agent system

A Cloudflare Agent that:
- runs in a DO (one per user, ~10k users active),
- holds a hibernating WS to the user's browser,
- fires a workflow per "deep research" request (avg 1/user/day, 10 steps, 30 min wall-clock with 25 min of sleep),
- enqueues outbound emails (avg 0.2 per user-day) into a Queue.

Rough monthly:

- **DO**: ~10k users × ~100 messages/day inbound (5 billable each via 20:1) = 5/user/day × 10k × 30 = 1.5M billable requests = on Paid, $0.075. Duration: only when not hibernating, say 5 min/day active = 300 s × 0.128 = 38.4 GB-s/user/day × 10k × 30 = 11.5M GB-s = ~$144/month.
- **Workflows**: 10k workflows/day × 30 = 300k/month, each ~5 s CPU spread over 30 min wall-clock. Free.
- **Queues**: 10k × 0.2 × 30 = 60k messages × 3 ops = 180k ops. Free under the 1M paid included.

Total ballpark: **~$145/month** for ~10k DAU stateful agent system. The dominant line item is DO duration; the second-order optimization is reducing time-not-hibernating per user (fewer non-WS events, more `setWebSocketAutoResponse`).

---

## Appendix — citation index

- [Durable Objects overview](https://developers.cloudflare.com/durable-objects/)
- [DO state API](https://developers.cloudflare.com/durable-objects/api/state/)
- [DO storage API](https://developers.cloudflare.com/durable-objects/api/storage-api/)
- [DO SQL storage](https://developers.cloudflare.com/durable-objects/api/sql-storage/)
- [DO SQLite storage overview](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [DO base class](https://developers.cloudflare.com/durable-objects/api/base/)
- [DO namespace](https://developers.cloudflare.com/durable-objects/api/namespace/)
- [DO ID](https://developers.cloudflare.com/durable-objects/api/id/)
- [DO stub](https://developers.cloudflare.com/durable-objects/api/stub/)
- [DO alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [DO websockets API](https://developers.cloudflare.com/durable-objects/api/websockets/)
- [DO websockets best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [DO migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
- [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Workflows overview](https://developers.cloudflare.com/workflows/)
- [Workflows Workers API](https://developers.cloudflare.com/workflows/build/workers-api/)
- [Workflows sleeping and retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)
- [Workflows trigger](https://developers.cloudflare.com/workflows/build/trigger-workflows/)
- [Workflows events and parameters](https://developers.cloudflare.com/workflows/build/events-and-parameters/)
- [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
- [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)
- [Queues overview](https://developers.cloudflare.com/queues/)
- [Queues configuration](https://developers.cloudflare.com/queues/configuration/configure-queues/)
- [Queues JS APIs](https://developers.cloudflare.com/queues/configuration/javascript-apis/)
- [Queues batching and retries](https://developers.cloudflare.com/queues/configuration/batching-retries/)
- [Queues consumer concurrency](https://developers.cloudflare.com/queues/configuration/consumer-concurrency/)
- [Queues DLQ](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/)
- [Queues limits](https://developers.cloudflare.com/queues/platform/limits/)
- [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)
