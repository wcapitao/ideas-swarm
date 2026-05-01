# `this.schedule()` API reference

The full surface of the Agents SDK scheduling API. Built on top of DO
`alarm()` + a SQLite-backed priority queue, so schedules survive
hibernation and DO restarts.

Source: https://developers.cloudflare.com/agents/api-reference/schedule-tasks/

## Signature

```ts
async schedule<T = unknown>(
  when: number | Date | string,
  callback: keyof this,
  payload?: T,
  options?: {
    retry?: RetryOptions;
    idempotent?: boolean;
  },
): Promise<Schedule<T>>
```

`when` overload semantics:

| Type | Meaning | Idempotent? |
|---|---|---|
| `number` | seconds from now (delay) | No (opt-in via `idempotent: true`) |
| `Date` | absolute wall-clock target | No (opt-in via `idempotent: true`) |
| `string` | 5-field cron expression | **Yes by default** |

`callback` is a method name — a **string** that must match a method on
the Agent class. Methods do not need any decorator; they just need to
exist with a matching signature `(payload: T) => any`.

```ts
class MyAgent extends Agent<Env, State> {
  async sendReminder(payload: { msg: string }) {
    /* … */
  }
}

await this.schedule(30, "sendReminder", { msg: "hi" });
```

**If the method does not exist when the schedule fires, the execution
throws** at runtime. Add a unit test that asserts every callback string
resolves to a method.

## `scheduleEvery` — sub-minute intervals

Cron's smallest unit is one minute. For shorter intervals:

```ts
await this.scheduleEvery(90, "tick", { ... });   // every 90 seconds
await this.scheduleEvery(5,  "fastTick");        // every 5 seconds
```

Behavior: **if the callback takes longer than the interval, the next
execution is skipped.** No backlog builds up.

## Querying schedules

```ts
this.getSchedules();                                            // all
this.getSchedules({ type: "cron" });                            // filter by type
this.getSchedules({ type: "delayed" });
this.getSchedules({ id: "abc123" });                            // by id
this.getSchedules({ timeRange: { start: new Date(), end: ... } });
```

Returns an array of `Schedule<T>` objects.

## Cancelling

```ts
const ok = await this.cancelSchedule(scheduleId);   // returns boolean
```

`true` if a row was removed; `false` if no schedule with that id existed.

## `Schedule<T>` shape

```ts
type Schedule<T> = {
  id: string;
  callback: string;
  payload: T;
  time: number;     // unix seconds
} & (
  | { type: "scheduled" }                                   // absolute Date
  | { type: "delayed"; delayInSeconds: number }              // number arg
  | { type: "cron"; cron: string }                           // cron arg
  | { type: "interval"; intervalSeconds: number }            // scheduleEvery
);
```

## Cron syntax

Standard 5-field: `minute hour day-of-month month day-of-week`.

```
*/5 * * * *      every 5 minutes
0 8 * * 1-5      weekdays at 08:00
0 0 1 * *        first of month at midnight
0 9-17 * * *     hourly between 09:00 and 17:00
30 4 * * 0       Sundays at 04:30
```

Operators: `*` (any), `,` (list), `-` (range), `/` (step).

Cron uses **the agent runtime's UTC clock**. If you need a local-time
schedule (e.g. "9am in user's tz"), compute the next absolute Date in
your code and use `schedule(new Date(...), ...)`.

## Idempotency

| Trigger | Default | With `idempotent: true` |
|---|---|---|
| Cron | already idempotent on `(cron, callback, payload)` | (no-op — same behavior) |
| Delay (number) | NEW row each call | dedupe on `(callback, payload)` |
| Date | NEW row each call | dedupe on `(callback, payload)` |

```ts
// Seed a once-per-instance daily flush — safe to re-run on every cold-start.
async onStart() {
  await this.schedule("0 4 * * *", "flushDaily", {});       // cron, idempotent default
  await this.schedule(3600, "flushHourly", {}, { idempotent: true });
}
```

If you skip `idempotent: true` on a delayed/Date seed in `onStart()`,
each cold-start adds another row. Eventually you have hundreds of
duplicate flush jobs.

## `RetryOptions`

```ts
type RetryOptions = {
  maxAttempts?: number;     // default 3 (class default via static options.retry)
  baseDelayMs?: number;     // default 100
  maxDelayMs?: number;      // default 3000
};
```

Note: `shouldRetry` exists on `this.retry()` only — **not** on
`schedule()` or `queue()`. If you need conditional retry, throw a
sentinel error in the callback and handle reschedule manually.

Class-level default:

```ts
class MyAgent extends Agent<Env, State> {
  static options = {
    retry: { maxAttempts: 5, baseDelayMs: 200, maxDelayMs: 10_000 },
  };
}
```

## Sub-agent restriction

Inside a sub-agent (a class auto-discovered via `ctx.exports`):

```ts
await this.schedule(...);    // ❌ throws
this.cancelSchedule(...);    // ❌ throws
this.keepAlive(...);         // ❌ throws
```

Workaround: parent owns the schedule, dispatches to the child via RPC
when the alarm fires.

```ts
// Parent
async dispatchToChild(payload: { childName: string; data: unknown }) {
  const child = await this.getSubAgent(MyChildAgent, payload.childName);
  await child.handleScheduled(payload.data);
}
async onStart() {
  await this.schedule("*/15 * * * *", "dispatchToChild", { childName: "worker-1", data: {} });
}
```

## Hibernation interplay

- Schedules survive hibernation. When a schedule fires, the runtime
  wakes the DO, the constructor re-runs, and the callback is invoked.
- The constructor is on the cold-start path of every fire. Keep it
  cheap; do schema migrations under `ctx.blockConcurrencyWhile()`.
- `connection.state` and `this.state` are persisted, so the callback
  sees the same state as before hibernation.

## Observability

The diagnostics channel `agents:schedule` emits events on every
schedule create / fire / cancel. Subscribe in production logs to debug
mis-fires and duplicate seeds. Channels are silent by default — zero
overhead unless subscribed.

## Common patterns

### One-shot reminder

```ts
async setReminder(when: Date, msg: string) {
  return this.schedule(when, "fireReminder", { msg });
}

async fireReminder(p: { msg: string }) {
  this.broadcast(JSON.stringify({ kind: "reminder", body: p.msg }));
}
```

### Daily cron with deterministic id

```ts
async onStart() {
  await this.schedule("0 6 * * *", "morningSweep", { tz: "UTC" });
}

async morningSweep() {
  // ... idempotent work
}
```

### Cancel-on-disconnect tick

```ts
async onConnect(connection: Connection) {
  const s = await this.scheduleEvery(30, "pushUpdate", { cid: connection.id });
  connection.setState({ ...connection.state, scheduleId: s.id });
}

async onClose(connection: Connection) {
  const id = connection.state?.scheduleId;
  if (id) await this.cancelSchedule(id);
}
```

### Self-rescheduling backoff

```ts
async pollUpstream(p: { attempt: number }) {
  try {
    const data = await fetch(this.env.UPSTREAM);
    if (!data.ok) throw new Error("upstream down");
    // ... store
  } catch {
    const next = Math.min(2 ** p.attempt * 30, 3600);  // cap at 1h
    await this.schedule(next, "pollUpstream", { attempt: p.attempt + 1 });
  }
}
```
