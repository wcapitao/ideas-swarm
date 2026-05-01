# Workflows from an Agent

Patterns for invoking, awaiting, and bidirectionally messaging a
Cloudflare Workflow from inside an Agent. Use Workflows for jobs that
are multi-step, retry per step, may sleep for hours/days, and must
survive deploys.

Sources:
https://developers.cloudflare.com/agents/api-reference/run-workflows/
https://developers.cloudflare.com/agents/concepts/workflows/
https://developers.cloudflare.com/workflows/build/workers-api/
https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/
https://developers.cloudflare.com/workflows/build/rules-of-workflows/

## Decision: do you actually need a Workflow?

| Want | Use |
|---|---|
| One synchronous tool call (≤30 s) | plain async method on the Agent |
| Long async block, single retry semantics, no sleep | `this.runFiber()` + `stash` |
| Multi-step, retry per step, may sleep > 1 hour | **Workflow** |
| Wait for an external signal | **Workflow** with `step.waitForEvent` |
| Fan-out N independent jobs | **Queue** (or N Workflows fired in a loop) |

If the answer is "Workflow", read on.

## Setup

`wrangler.jsonc`:

```jsonc
{
  "name": "my-agent",
  "main": "src/index.ts",
  "workflows": [
    {
      "name": "ProcessingWorkflow",
      "binding": "PROCESSING_WORKFLOW",
      "class_name": "ProcessingWorkflow"
    }
  ],
  "durable_objects": {
    "bindings": [{ "name": "AGENT", "class_name": "MyAgent" }]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["MyAgent"] }
  ]
}
```

Workflow definition:

```ts
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";

interface Params { taskId: string; data: unknown; agentName: string }

export class ProcessingWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    // 1) deterministic side effect
    const fetched = await step.do("fetch-data", async () => {
      const res = await fetch(`https://api.example.com/items/${event.payload.taskId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`); // triggers retry
      return await res.json();
    });

    // 2) report progress to the agent (DURABLE)
    await step.updateAgentState({ progress: 0.33, stage: "fetched" });

    // 3) heavier processing with custom retry config
    const enriched = await step.do(
      "enrich",
      { retries: { limit: 5, delay: "5 seconds", backoff: "exponential" }, timeout: "10 minutes" },
      async () => enrich(fetched),
    );

    await step.mergeAgentState({ progress: 0.66, stage: "enriched" });

    // 4) wait on a signal from the agent
    const approval = await step.waitForEvent("approve-publish", {
      type: "approval",
      timeout: "7 days",
    });

    if (!approval.payload?.ok) {
      throw new NonRetryableError("not approved");  // terminal
    }

    // 5) publish
    const result = await step.do("publish", async () => publish(enriched));

    await step.updateAgentState({ progress: 1, stage: "done", result });
    return result;
  }
}
```

## Triggering from the Agent

```ts
class MyAgent extends Agent<Env, State> {
  async startProcessing(taskId: string, data: unknown) {
    const instanceId = await this.runWorkflow(
      "PROCESSING_WORKFLOW",
      { taskId, data, agentName: this.name },
      {
        id: `task-${taskId}`,            // optional; auto-generated otherwise
        metadata: { source: this.name }, // queryable, not sent to workflow
        // agentBinding: "AGENT",         // auto-detected from this.name
      },
    );

    // Persist the handle so we can reference it later.
    this.sql`
      INSERT INTO workflow_runs (id, task_id, status, started_at)
      VALUES (${instanceId}, ${taskId}, 'running', ${Date.now()})
    `;

    return instanceId;
  }
}
```

`runWorkflow` returns the workflow's instance ID. Persist it to SQL or
agent state — you'll need it to look up status, send events, or
reconcile after restart.

## Lifecycle hooks on the Agent

The Agent automatically receives progress / completion / error events
from any Workflow it started:

```ts
async onWorkflowProgress(workflowName: string, instanceId: string, progress: unknown) {
  this.sql`UPDATE workflow_runs SET progress = ${JSON.stringify(progress)} WHERE id = ${instanceId}`;
  this.broadcast(JSON.stringify({ kind: "wf-progress", instanceId, progress }));
}

async onWorkflowComplete(workflowName: string, instanceId: string, result: unknown) {
  this.sql`UPDATE workflow_runs SET status = 'done' WHERE id = ${instanceId}`;
  this.broadcast(JSON.stringify({ kind: "wf-complete", instanceId, result }));
}

async onWorkflowError(workflowName: string, instanceId: string, error: unknown) {
  this.sql`UPDATE workflow_runs SET status = 'error', error = ${String(error)} WHERE id = ${instanceId}`;
  this.broadcast(JSON.stringify({ kind: "wf-error", instanceId, error: String(error) }));
}
```

## Bidirectional messaging

### Workflow → Agent (durable, inside `step`)

These are durable RPC-style writes from a step into the agent's state:

```ts
// Replace agent.state with a partial update
await step.updateAgentState({ progress: 0.5 });

// Shallow-merge into agent.state
await step.mergeAgentState({ stage: "enriched" });
```

### Agent → Workflow (events)

```ts
await this.sendWorkflowEvent("PROCESSING_WORKFLOW", instanceId, {
  type: "approval",
  payload: { ok: true, by: "alice" },
});

// Convenience for approval flows
await this.approveWorkflow(instanceId, { reason: "ok" });
```

The Workflow receives this through a corresponding
`step.waitForEvent("approve-publish", { type: "approval" })`.

### Non-`step` agent calls are best-effort

```ts
// In a workflow:
await env.AGENT.get(env.AGENT.idFromName("alice")).reportProgress(0.5);  // ⚠️
```

Non-`step` Agent RPC calls **may execute multiple times on retry**.
Treat them as best-effort UI updates; never as the source of truth. For
durable updates, use `step.updateAgentState` / `step.mergeAgentState`.

## Idempotency rules — the 8 rules summarized

(Full version in `idempotency-rules.md`.)

1. Side effects only inside `step.do`, after a "did I do this already?"
   check.
2. One step = one unit of work.
3. Step names are cache keys — must be deterministic.
4. Don't mutate the event payload; return data instead.
5. Always `await` steps.
6. Conditional logic must be deterministic.
7. All side effects in `step.do`; code outside is replayed each retry.
8. Step results ≤ 1 MiB and structured-cloneable.

## Step API quick reference

```ts
// Default retry: 5 attempts, 10s base, exponential, 10 min step timeout
await step.do("name", async () => { ... });

// Custom retry / timeout
await step.do(
  "charge",
  { retries: { limit: 10, delay: "10 seconds", backoff: "exponential" }, timeout: "30 minutes" },
  async () => { ... },
);

// Sleep relative — up to 365 days; sleeps don't count against compute.
await step.sleep("wait-1h", "1 hour");
await step.sleep("wait-1h", 3_600_000);             // also accepts ms

// Sleep absolute
await step.sleepUntil("noon", new Date("2026-12-01T12:00:00Z"));

// Wait for an external event — default 24h, max 7 days
const evt = await step.waitForEvent("approve", { type: "approval", timeout: "7 days" });

// Terminal non-retry
throw new NonRetryableError("invalid input");
```

## Querying / controlling instances

```ts
const handle = await env.PROCESSING_WORKFLOW.get(instanceId);
const status = await handle.status();    // queued | running | paused | complete | errored | terminated
await handle.pause();
await handle.resume();
await handle.terminate();
await handle.restart();
```

## Critical limits

| Item | Value |
|---|---|
| Max step wall-clock | 30 minutes |
| Max workflow state | 10 MB |
| Max step result | 1 MiB |
| Max event payload | 1 MiB |
| Max sleep | 365 days |
| Max `waitForEvent` timeout | 7 days |
| Subrequests per workflow run | 50 free / 10,000 paid |
| Steps per workflow | 10,000 default / 25,000 paid |
| Concurrent running instances | 100 free / 50,000 paid |

## Footguns

- **Workflows cannot open WebSockets.** To push to clients, write into
  agent state via `step.updateAgentState` and let the agent
  `broadcast()`.
- **Renaming the workflow binding.** When you change `binding` in
  `wrangler.jsonc`, call `migrateWorkflowBinding()` from the Agent so
  the in-flight tracking records survive. Otherwise pending instances
  go orphan.
- **Child workflows are fire-and-forget.** A parent workflow that calls
  `env.OTHER_WF.create(...)` does not block. If you need to await the
  child, use a `step.waitForEvent` and have the child fire it on
  completion.
- **`Date.now()` / `Math.random()` outside `step.do` is a bug.** They
  produce different values on retry replays. Wrap in
  `step.do("now", async () => Date.now())` if you really need the
  determinism cached.
- **Non-`step` agent RPC = best-effort.** Use `step.updateAgentState`
  for anything you'd be sad to see twice.
- **No DLQ.** Failed instances stay in `errored`. Build your own
  recovery (e.g. nightly sweep that calls `restart()` on `errored`
  instances).
