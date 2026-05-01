---
name: cf-agent-workflows-and-scheduling
description: >
  Time-based and long-running work in a Cloudflare Agent — `this.schedule()`
  (delay / Date / cron), DO `alarm()`, Workflows (`step.do`, `step.sleep`,
  `step.waitForEvent`, retries), Queues, and durable execution
  (`runFiber` / `stash` / `onFiberRecovered` / `keepAliveWhile`). Activates
  when the user asks to "schedule a task", "cron in the agent",
  "long-running job", "Workflow from agent", "alarm", "background job",
  "durable execution", "wait for event", "agent timer", or needs to choose
  between schedule / alarm / Workflow / Queue. Encodes the
  cron-idempotent-but-Date-not gotcha, the sub-agents-cant-schedule rule,
  the 6-retry alarm cap, the 8 Workflow idempotency rules, and the
  closures-aren't-serialized footgun in `runFiber`. Do NOT use for plain
  request handling, state design, or LLM-side prompting.
---

# cf-agent-workflows-and-scheduling

Time, retries, sleep, fan-out, durability. The shape of every long-running
job in a Cloudflare Agent.

## The decision in 30 seconds

| Need | Pick |
|------|------|
| Fire a callback in the future, ≤30 days, **single agent** | `this.schedule(seconds \| Date, "callbackName", payload)` |
| Fire on a **cron**, single agent (idempotent by default) | `this.schedule("0 8 * * *", "callbackName", payload)` |
| Sub-minute periodic tick (e.g. every 90 s) | `this.scheduleEvery(90, "tick")` |
| Multi-step process with retries, sleep up to **1 year**, durable across restarts | **Workflow** — `env.MY_WF.create({ params })` |
| **Wait for an external event** without polling | Workflow `step.waitForEvent` |
| **Fan out** to many independent workers / messages | **Queue** — `env.QUEUE.send(...)` |
| Checkpoint mid-async-function across DO restarts | **Durable execution** — `runFiber` + `stash` + `onFiberRecovered` |
| Hold the DO awake during a single long async block | `keepAliveWhile(promise)` |
| Wake **this DO** to do per-instance work later | `this.schedule()` (built on DO `alarm()`) |

Decision tree in `references/scheduling-decision-tree.md`.

## `this.schedule()` API

Signature:

```ts
async schedule<T>(
  when: number | Date | string,        // seconds | absolute Date | cron
  callback: keyof this,                // method name on the Agent class
  payload?: T,
  options?: { retry?: RetryOptions; idempotent?: boolean },
): Promise<Schedule<T>>
```

Three call shapes:

```ts
await this.schedule(30, "sendReminder", { msg: "..." });            // delay (sec)
await this.schedule(new Date("2026-09-01T09:00:00Z"), "wakeUp");    // absolute
await this.schedule("0 8 * * *", "dailyDigest", { userId });        // cron
```

Plus:

```ts
await this.scheduleEvery(90, "tick");           // sub-minute interval
this.getSchedules();                            // all
this.getSchedules({ type: "cron" });            // filter
this.getSchedules({ id: "abc123" });
this.getSchedules({ timeRange: { start, end } });
const ok = await this.cancelSchedule(id);       // boolean
```

`Schedule<T>` shape:

```ts
type Schedule<T> = {
  id: string;
  callback: string;
  payload: T;
  time: number;     // unix seconds
} & (
  | { type: "scheduled" }
  | { type: "delayed"; delayInSeconds: number }
  | { type: "cron"; cron: string }
  | { type: "interval"; intervalSeconds: number }
);
```

Callbacks resolve **by string name** on the Agent class. **If the method
does not exist when the schedule fires, the execution throws.** Add a
unit test that asserts every scheduled callback resolves.

Full reference: `references/schedule-api.md`.

## Idempotency rules — the three you must know

| Schedule type | Idempotent by default? | How to dedupe |
|---|---|---|
| Cron (`"0 8 * * *"`) | **Yes** — same cron + callback + payload returns the existing schedule | Just call `schedule()` again, get the same ID |
| Delayed (`30`) | **No** — two calls = two tasks | Pass `{ idempotent: true }` to dedupe by callback + payload |
| Date (`new Date(...)`) | **No** — two calls = two tasks | Pass `{ idempotent: true }` |

```ts
// Safe to call from onStart() — survives restart without duplicating
await this.schedule(3600, "flushBuffer", {}, { idempotent: true });
await this.schedule("*/5 * * * *", "tick");  // already idempotent
```

**The gotcha:** seeding from `onStart()` with a delay/Date and **not**
passing `idempotent: true` creates a fresh task on every cold-start.
Eventually the queue fills with duplicates.

## Sub-agents cannot schedule

Inside a sub-agent (a class auto-discovered via `ctx.exports`),
`schedule()`, `cancelSchedule()`, and `keepAlive()` **throw**. Schedule
on the parent and have the parent dispatch to the child via RPC.

## DO `alarm()` — when to use vs `this.schedule()`

`this.schedule()` is built on top of DO `alarm()`. The Agents SDK keeps
a priority-queue of pending wake-ups in SQLite and arms the single DO
alarm to the earliest one. Use the raw `alarm()` API only when:

- You're **not** using the Agents SDK (plain DO).
- You need exactly one self-tick and want to skip the schedule SQL row.
- You want to layer a custom retry policy on top of the at-least-once
  alarm guarantee.

Raw API:

```ts
ctx.storage.setAlarm(scheduledTimeMs);  // overrides existing — ONE alarm per DO
ctx.storage.getAlarm();                 // returns ms or null
ctx.storage.deleteAlarm();

async alarm(info?: { retryCount: number; isRetry: boolean }) { ... }
```

| Constraint | Value |
|---|---|
| Alarms per DO | **1** (`setAlarm` overrides) |
| Retry on uncaught throw | exponential backoff from 2 s, **6 retries**, then dropped |
| Wall-clock max per fire | **15 min** |
| Self-rescheduling | call `setAlarm(...)` again at the end of the handler |

If you want **multiple wake-ups**, store a priority queue in storage and
always set the alarm to the earliest pending — exactly what
`this.schedule()` does for you.

## Workflows from an Agent

Use a Workflow when the job is multi-step, may sleep for non-trivial
time, or must retry per step across restarts and deploys.

### Triggering a Workflow from the agent

```ts
const instanceId = await this.runWorkflow(
  "PROCESSING_WORKFLOW",
  { taskId, data },
  { id: `task-${taskId}`, metadata: { source: this.name } },
);
// persist the handle so we can resume / poll
this.sql`INSERT INTO workflow_runs (id, kind) VALUES (${instanceId}, 'process')`;
```

Lifecycle hooks fire on the agent automatically:

```ts
async onWorkflowProgress(name, instanceId, progress) { ... }
async onWorkflowComplete(name, instanceId, result)   { ... }
async onWorkflowError(name, instanceId, error)       { ... }
```

Bidirectional messaging:

```ts
// Workflow → Agent (durable, inside step):
await step.updateAgentState({ currentTask: { id, status: "processing" } });
await step.mergeAgentState({ progress: 0.75 });

// Agent → Workflow:
await this.sendWorkflowEvent("MY_WORKFLOW", instanceId, {
  type: "human-approval",
  payload: { ok: true },
});
await this.approveWorkflow(instanceId, { reason: "ok" });
```

Full pattern: `references/workflow-from-agent.md`.

### The 8 idempotency rules for `step.do`

1. **Non-idempotent calls go inside `step.do`, after a check.** Charge a
   card → first check whether you already charged.
2. **One step = one unit of work.** Don't combine side effects; you
   can't retry one without retrying the other.
3. **Step names are cache keys.** They must be deterministic.
   `` step.do(`run-${Date.now()}`, ...) `` defeats the cache.
4. **Don't mutate the event.** Return data from `step.do` instead.
5. **Always `await` steps.** Unawaited promises swallow errors.
6. **Conditional logic must be deterministic.** Branch on step outputs
   or event payload — never `Math.random()` / `Date.now()`.
7. **Wrap all side effects in `step.do`.** Code outside is replayed
   every retry.
8. **Step results ≤ 1 MiB**, structured-cloneable.

### Step API at a glance

```ts
// Retry config — defaults: 5 retries, 10 s base, exponential, 10 min timeout
await step.do(
  "charge-card",
  { retries: { limit: 10, delay: "10 seconds", backoff: "exponential" }, timeout: "30 minutes" },
  async () => { /* ... */ },
);

// Sleep relative — up to 365 days. Sleeps don't count against compute.
await step.sleep("wait-24h", "1 day");

// Sleep absolute
await step.sleepUntil("at-9am", new Date("2026-12-01T09:00:00Z"));

// Wait for an external signal — default 24h, max 7 days
const approval = await step.waitForEvent("await-human-approval", {
  type: "approval",
  timeout: "7 days",
});

// Terminal failure (no retries)
throw new NonRetryableError("invalid input");
```

Full idempotency rules in `references/idempotency-rules.md`.

## Queues from an Agent

Use a Queue when you need **fan-out** to many independent jobs, batch
processing, or DLQ semantics.

```ts
// In the agent (producer):
await this.env.INGEST.send({ url, userId });
await this.env.INGEST.sendBatch([{ body: a }, { body: b }]);
await this.env.INGEST.send(payload, { delaySeconds: 600 }); // up to 12h delay

// In a separate Worker (consumer):
export default {
  async queue(batch: MessageBatch<Job>, env: Env) {
    for (const msg of batch.messages) {
      try { await process(msg.body); msg.ack(); }
      catch { msg.retry({ delaySeconds: 60 * msg.attempts }); }
    }
  },
};
```

### Queue vs Workflow

| Trait | Queue | Workflow |
|---|---|---|
| Shape | Fan-out (N parallel) | Linear pipeline (per instance) |
| Per-job state | Per-message body | Per-instance, multi-step |
| Order | Best-effort | Sequential within an instance |
| Sleep | Up to 24 h delay | Up to 365 days |
| Retries | Per-message, default 3, max 100 | Per-step, default 5, configurable |
| Use when | "Email these 10k users" | "Onboard this user over 7 days" |

Queue limits: 128 KB per message; 256 KB per `sendBatch`; 5,000 msg/s
per queue; 250 concurrent consumer invocations.

## Durable execution — `runFiber` / `stash` / `onFiberRecovered`

For an async function inside the agent that must survive a DO restart
mid-flight (e.g. a long deliberation loop that's already issued
expensive LLM calls).

```ts
class MyAgent extends Agent<Env, State> {
  async deepResearch(topic: string) {
    return this.runFiber("research", async (fiber) => {
      const sources = await fetchSources(topic);
      await fiber.stash({ stage: "fetched", sources });   // checkpoint

      const summary = await llm.summarize(sources);
      await fiber.stash({ stage: "summarized", summary });

      const writeup = await llm.write(summary);
      return writeup;
    });
  }

  // Recovery logic must live HERE — closures inside runFiber are NOT serialized.
  async onFiberRecovered(ctx: FiberRecoveryContext) {
    const snapshot = ctx.lastStash as any;
    if (!snapshot) return;                          // never stashed; restart from scratch
    if (snapshot.stage === "fetched") {
      const summary = await llm.summarize(snapshot.sources);
      const writeup = await llm.write(summary);
      await ctx.complete(writeup);
    } else if (snapshot.stage === "summarized") {
      const writeup = await llm.write(snapshot.summary);
      await ctx.complete(writeup);
    }
  }
}
```

### `keepAliveWhile` — anchor a live connection

When the agent has an outbound stream (LLM, WebSocket, SSE) that must
not be cut by hibernation:

```ts
await this.keepAliveWhile(async () => {
  for await (const chunk of llm.stream(prompt)) emit(chunk);
});
```

The DO stays awake for the duration of the promise — once it resolves,
hibernation can kick in again. Outgoing WebSockets do **not** hibernate
by themselves; `keepAliveWhile` is the supported way to hold them.

### Footguns

1. **Closures inside `runFiber` are not serialized.** Recovery code must
   read `ctx.lastStash` and re-issue work — you cannot resume the
   suspended function as-is.
2. **If `onFiberRecovered` throws, the row is deleted with no automatic
   retries.** Wrap recovery in try/catch and use `this.retry()` or
   `schedule()` for re-attempts.
3. **`stash()` fully replaces the previous snapshot.** It's a write,
   not a merge. Snapshots must be JSON-serializable.
4. **Sub-agents cannot `keepAlive()`** (same rule as `schedule`).

Full pattern: `references/durable-execution.md`.

## `AbortSignal` doesn't cross DO RPC

```ts
// caller: passes signal to a DO method
await stub.longJob(input, signal);  // signal IS NOT seen on the DO side
```

`AbortSignal` does not survive the RPC boundary into a Durable Object.
Construct the controller **inside the DO** and enforce timeouts there:

```ts
async longJob(input: Input) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30_000);
  return await fetch(externalUrl, { signal: controller.signal });
}
```

For LLM streams, also forward the controller into
`streamText({ abortSignal })` or the model keeps generating after
cancellation.

## Inspecting scheduled tasks

```bash
ts-node scripts/schedule-introspect.ts <agent-name>
```

Connects to a deployed agent (via `AgentClient` or a debug
`/__schedules` HTTP route on the agent) and lists every pending
schedule with its type, payload, and next fire time.

## Critical rules

- **Scheduling a non-existent method throws at execution.** Method names
  must match `keyof this` exactly. Add a unit test that asserts every
  scheduled callback resolves.
- **Cron is idempotent; delayed/Date is not.** When seeding from
  `onStart()`, pass `{ idempotent: true }` to delayed/Date schedules.
- **Sub-agents cannot schedule, cancel, or keepAlive.** Dispatch from
  the parent.
- **One alarm per DO** at the OS level; the Agents SDK gives you
  many-via-priority-queue but only one alarm fires at a time.
- **Long retry backoffs keep the DO awake.** For long delays prefer
  `this.schedule()` over `this.retry()`.
- **Workflow steps must be deterministic and idempotent.** All side
  effects in `step.do`. Names are cache keys — never include
  `Date.now()` or random IDs.
- **Closures in `runFiber` are not serialized.** Recovery logic in
  `onFiberRecovered`.
- **`AbortSignal` does not cross DO RPC.** Enforce timeouts on the DO
  side.

## Hand-offs

- **`cf-agent-tests-and-evals`** — for `runInDurableObject` and
  `runDurableObjectAlarm` test patterns, advancing the test clock,
  asserting schedules fire.
- **`cf-agent-deploy-and-observe`** — for cron limits, Workflow
  concurrency pricing, and observability channels (`agents:schedule`,
  `agents:workflow`).
- **`cf-agent-state-and-storage`** — when scheduling needs to read or
  write per-instance SQL state.
- **`cf-agent-multi-agent-orchestration`** — when the parent dispatches
  scheduled callbacks down to sub-agents.

## References

- `references/scheduling-decision-tree.md` — schedule vs alarm vs Workflow vs Queue
- `references/schedule-api.md` — full `this.schedule()` reference
- `references/workflow-from-agent.md` — invoking + awaiting Workflows from an Agent
- `references/durable-execution.md` — `runFiber` / `stash` / `onFiberRecovered` / `keepAliveWhile`
- `references/idempotency-rules.md` — the 8 Workflow idempotency rules

## Scripts

- `scripts/schedule-introspect.ts` — list/inspect all scheduled tasks on a deployed agent
