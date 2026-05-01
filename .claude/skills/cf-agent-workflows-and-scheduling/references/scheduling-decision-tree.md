# Scheduling decision tree — schedule vs alarm vs Workflow vs Queue

Pick the **smallest** primitive that does the job. Composing them is the
norm; substituting one for another usually goes wrong.

## The 30-second decision tree

```
Need to fire a callback at time T against THIS agent?
├─ ≤30 days, single agent, single callback
│   ├─ recurring on a clock pattern?       → this.schedule(cron, "callback")
│   ├─ recurring sub-minute?               → this.scheduleEvery(seconds, "callback")
│   └─ one-shot (delay / absolute)?        → this.schedule(seconds | Date, "callback")
│
└─ Plain DO (no Agents SDK)?               → ctx.storage.setAlarm(ms)

Multi-step pipeline?
├─ ≥2 steps, retry per step, may sleep > 1 hour, must survive restarts
│   └─ env.MY_WF.create({ params })         → Workflow
│
├─ Need to wait on an external signal?
│   └─ step.waitForEvent(name, { type })    → Workflow
│
└─ Single async block must hold the DO awake (LLM stream, WS pump)?
    └─ this.keepAliveWhile(promise)          → durable execution

Fan out to N independent jobs?
└─ env.QUEUE.send(...)  /  sendBatch(...)   → Queue (consumer in another Worker)

Async function inside the agent must survive a mid-flight DO restart?
└─ this.runFiber(name, fn) + fiber.stash() + onFiberRecovered  → durable execution
```

## The capability matrix

| Capability | `schedule()` | DO `alarm()` | Workflow | Queue | runFiber |
|---|---|---|---|---|---|
| Max delay | 30 days* | unbounded** | 365 days (`step.sleep`) | 24 h (`delaySeconds`) | n/a |
| Retries on failure | via `retry` opt | 6 / exp 2s | per-step config (default 5) | per-message (default 3, max 100) | none auto — recover in `onFiberRecovered` |
| Survives DO restart | ✅ persisted in SQLite | ✅ persisted | ✅ checkpointed per step | ✅ delivery guaranteed | ✅ if you `stash()` |
| Cron syntax | ✅ (5-field) | ❌ | ❌ (use Worker cron → create) | ❌ | n/a |
| Wait for external event | ❌ | ❌ | ✅ `step.waitForEvent` | n/a (push to consumer) | n/a |
| Fan-out parallel work | ❌ (single DO) | ❌ | child workflows fire-and-forget | ✅ native | ❌ |
| Idempotent by default | cron yes, delay/Date no | n/a | step names = cache keys | per-message | per stash key |
| Sub-agent friendly | ❌ throws | n/a | ✅ via parent | ✅ | ❌ throws (`keepAlive`) |
| Wall-clock cap per fire | inherits Agent (30s, refreshed) | 15 min | 30 min per step | 15 min per consumer batch | inherits Agent |

*The Agents SDK exposes 30-day practical schedules; longer tasks should
be modeled as a Workflow with `step.sleep`.
**`setAlarm` itself accepts any future ms timestamp; in practice you
won't schedule beyond 30 days because there's no idempotency layer.

## Decision examples

### "Send a reminder email tomorrow at 9am"

→ `this.schedule(new Date("...T09:00:00Z"), "sendReminder", { userId })`
plus `{ idempotent: true }` to survive cold-starts.

### "Every weekday at 8am, generate a digest"

→ `this.schedule("0 8 * * 1-5", "dailyDigest", {})`. Cron is idempotent
by default; calling on every cold-start is safe.

### "Poll an external API every 90 seconds while the user is connected"

→ `this.scheduleEvery(90, "poll")`. `scheduleEvery` skips overlapping
runs if the previous one is still going. Cancel in `onClose`.

### "Onboard a user over 7 days with email touchpoints"

→ Workflow with `step.do` (send email) + `step.sleep("wait-day-1", "1 day")`
+ `step.do` (check engagement) + branching. Sleeps are free of CPU cost.

### "Wait for human approval before charging"

→ Workflow with `step.waitForEvent("approval", { type: "approval", timeout: "7 days" })`.
Agent calls `this.sendWorkflowEvent(...)` when the human acts.

### "Send 10,000 personalized emails"

→ Producer (agent or worker) calls `env.MAIL_QUEUE.sendBatch([...])`.
Consumer worker processes in batches of 10–100 with auto-concurrency.
DLQ catches permanent failures.

### "An LLM call takes 8 minutes; the DO mustn't hibernate during it"

→ `await this.keepAliveWhile(() => llm.stream(...))`. Don't use
`setInterval` keepalive — that's lost on hibernation anyway.

### "A long deliberation chain has already burnt $4 of LLM cost; it must
survive a deploy mid-flight"

→ `this.runFiber("deliberate", async (fiber) => { ... await fiber.stash(...) ... })`.
On recovery, `onFiberRecovered` reads `ctx.lastStash` and re-issues
remaining work. Don't depend on closures from the original call.

## Combine, don't substitute

The Cloudflare Agents SDK is a **DO** (per-agent state, single-thread)
that uses **schedule/alarm** (its own scheduled wakeups), invokes
**Workflows** for long deterministic pipelines, and produces to
**Queues** for fan-out. Each primitive has a single job.

Pattern: **agent gets the request → enqueues N jobs to a Queue → kicks
off a Workflow per job → the Workflow calls back into the agent state
via `step.updateAgentState` → agent broadcasts progress to the user via
`broadcast()`**. None of those steps is interchangeable.

## Anti-patterns

- **`setInterval` inside a DO.** Lost on hibernation; burns CPU. Use
  `scheduleEvery`.
- **`this.retry()` with a 1-hour `baseDelayMs`.** Long retry backoffs
  hold the DO awake. Use `schedule()` for long delays instead.
- **Workflow with a single step.** That's just a fetch. Don't pay the
  Workflow overhead.
- **DO alarm trying to coordinate fan-out.** A DO is single-threaded;
  fan-out blocks itself. Use Queues.
- **Queue producer-consumer in the same DO.** Defeats the point —
  Queues exist to escape single-threading.
- **Workflow opening a WebSocket.** Workflows can't hold WebSockets.
  Pump from the agent via `broadcast()` driven by `step.updateAgentState`.
