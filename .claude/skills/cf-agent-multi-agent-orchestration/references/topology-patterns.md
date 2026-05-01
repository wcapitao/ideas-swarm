# Topology patterns — long form

Four production-grade shapes for multi-agent Cloudflare apps. Pick by **inputs** (what knows what), not by aesthetics.

## 1. Supervisor

**Shape:** one agent owns the user-facing channel (chat WebSocket, MCP session, voice loop). When work needs domain expertise, the supervisor calls a specialist agent via `getAgentByName`, awaits the result, and continues the conversation. Specialists do not talk to each other; they talk only to the supervisor.

**State distribution:**
- Supervisor: conversation history, user identity, dispatch state.
- Specialist: ephemeral task scratch — deleted after the result returns.

**When to use:**
- One conversational surface, multiple specialized backends.
- Specialists' work is bounded (single RPC method, returns a value).
- Specialists may be reused across users (singleton instances).

**Code shape:**

```typescript
// Supervisor (per-user)
export class ChatSupervisor extends AIChatAgent<Env> {
  async onChatMessage(_, options) {
    const intent = await this.classify(this.lastUserMessage());

    if (intent === "research") {
      const r = await getAgentByName(this.env.ResearchAgent, `task-${ulid()}`);
      const findings = await r.investigate(this.lastUserMessage());
      // Optional: clean up the task DO when done
      await r.markDone();
      return this.streamSynthesis(findings);
    }

    if (intent === "code-review") {
      const c = await getAgentByName(this.env.CodeAgent, "global");
      return this.streamFromAgent(await c.review(this.lastUserMessage()));
    }
  }
}

// Research specialist (per-task)
export class ResearchAgent extends Agent<Env, ResearchState> {
  async investigate(query: string) {
    await this.setState({ ...this.state, query, status: "running" });
    const docs = await this.env.AI.autorag(this.props.ragId).search({ query });
    const summary = await this.summarize(docs);
    await this.setState({ ...this.state, summary, status: "done" });
    return summary;
  }
}
```

**Pitfalls:**
- A supervisor doing 20 specialist calls per turn will hit subrequest caps. Batch where possible (e.g. one specialist call returns multiple results).
- If specialists also call `getAgentByName(...)` to reach further specialists, you have a deeper tree — `audit-topology.ts` will graph it. Keep depth ≤2.

**See:** `cloudflare/agents/examples/agents-as-tools`, `cloudflare/agents/examples/multi-ai-chat`, `cloudflare/agents/guides/anthropic-patterns` (orchestrator-workers section).

---

## 2. Peer-to-peer hand-off

**Shape:** Agent A handles the early phase of the conversation (intake, qualification, triage). When the phase boundary is crossed, A serializes a summary, calls `B.startFromSummary(summary)`, and goes quiet. The user is now talking to B. A retains its history but does no further work on this conversation.

**State distribution:**
- Agent A: stays alive, holds historical state for audit / appeal / rollback.
- Agent B: starts with the summary as `initialState`-ish, accumulates new state.

**When to use:**
- The conversation has a hard phase change (intake → fulfilment, triage → resolution, browsing → checkout).
- Phase B has different permissions, models, or tools than phase A.
- Phase A's full transcript is wasted context for phase B.

**Code shape (state-handoff variant):**

```typescript
export class IntakeAgent extends AIChatAgent<Env> {
  async onChatMessage() {
    if (this.shouldHandoff()) {
      const summary = {
        userIntent: this.state.intent,
        gatheredFacts: this.state.facts,
        // Note: do NOT include transcript; B starts fresh
      };
      const b = await getAgentByName(this.env.FulfilmentAgent, this.name);
      await b.startFromSummary(summary);
      await this.broadcast(JSON.stringify({ type: "handoff", to: "FulfilmentAgent" }));
      // Client receives "handoff" event, reconnects to FulfilmentAgent
      return new Response("handed-off", { status: 200 });
    }
    return this.normalChat();
  }
}

export class FulfilmentAgent extends AIChatAgent<Env> {
  async startFromSummary(summary: HandoffSummary) {
    await this.setState({ ...this.state, ...summary, phase: "fulfilment" });
  }

  async onChatMessage() {
    // Operates with summary as context, not A's full transcript
    return this.streamWithSystemPrompt(this.buildPromptFromSummary());
  }
}
```

**Client-side hand-off plumbing:** the client needs to know to reconnect to a different agent class. Two ways:

1. **Server-driven**: A broadcasts a `{ type: "handoff", to: "FulfilmentAgent", name: "..." }` message. Client reconnects via `useAgent({ agent: "FulfilmentAgent", name: "..." })`.
2. **URL-driven**: A returns an HTTP 302 to `/agents/fulfilment-agent/<name>`. Client follows.

The `cloudflare/agents/examples/openai-sdk/handoffs/` demo shows the OpenAI-SDK take on this; the same shape works with the native SDK.

**Pitfalls:**
- The client must handle two consecutive WebSocket lifecycles cleanly. Don't lose pending user input across the swap.
- If the user wants to "go back" to phase A, you need explicit state in B that says "I came from A and can hand back" — DOs don't naturally do this.

---

## 3. Fan-out (Queue + workers)

**Shape:** the supervisor agent has N independent items to process. It pushes them to a Queue. Plain Workers (not agents) consume the queue concurrently, do the work, and call back into the supervisor with results.

**State distribution:**
- Supervisor: tracks pending count, accumulates results.
- Queue: ephemeral message bus, no state.
- Worker consumers: stateless.

**When to use:**
- N >= 10 independent jobs.
- Each job is bounded (< 30 s CPU on free tier, < 5 min CPU paid).
- Jobs can fail independently and retry independently (Queues give you per-message `retry()`).

**Why workers, not agents, for the consumers:**
- DOs cost duration GB-s while alive. Fan-out to 1000 DOs = 1000 duration meters.
- Workers are pay-per-request. Fan-out to 1000 Worker invocations = N concurrent invocations within Queues' 250-concurrent cap.
- Queue consumers also give you DLQs and configurable retries — DO RPC does not.

**Code shape:**

```typescript
// 1. Producer (supervisor)
async kickoff(items: Item[]) {
  const jobId = ulid();
  await this.setState({
    ...this.state,
    jobs: { ...this.state.jobs, [jobId]: { total: items.length, done: 0, results: [] } },
  });
  await this.env.JOBS_QUEUE.sendBatch(
    items.map((item) => ({
      body: { jobId, supervisorName: this.name, item },
    })),
  );
  return jobId;
}

// 2. Consumer (plain Worker, not agent)
export default {
  async queue(batch: MessageBatch<Job>, env: Env) {
    for (const msg of batch.messages) {
      try {
        const result = await processItem(msg.body.item, env);
        const supervisor = await getAgentByName(env.Supervisor, msg.body.supervisorName);
        await supervisor.notifyJobItemDone(msg.body.jobId, result);
        msg.ack();
      } catch (err) {
        msg.retry({ delaySeconds: 60 * msg.attempts });
      }
    }
  },
} satisfies ExportedHandler<Env, Job>;

// 3. Supervisor receives results
async notifyJobItemDone(jobId: string, result: ItemResult) {
  const job = this.state.jobs[jobId];
  job.results.push(result);
  job.done++;
  await this.setState({ ...this.state, jobs: { ...this.state.jobs, [jobId]: job } });
  if (job.done === job.total) {
    await this.broadcast(JSON.stringify({ type: "job-complete", jobId, results: job.results }));
  }
}
```

**Pitfalls:**
- The supervisor name in the queue payload must match a real running supervisor. If the supervisor was deleted (`deleteSubAgent`), the consumer's RPC call fails. Set up a DLQ.
- Large result payloads (>1 MB) won't fit in `notifyJobItemDone` arguments cleanly. Store the result in R2 and pass the key.
- Heat: if 1000 messages all complete in the same second, the supervisor receives 1000 RPC calls in tight succession — the DO is single-threaded, so they queue. Throughput ceiling is ~1k req/s per DO. For higher fan-in, shard the supervisor.

---

## 4. Workflow-orchestrated

**Shape:** a Cloudflare Workflow is the conductor. Each `step.do(...)` calls into one agent (or several) via `getAgentByName`. The Workflow handles durability, retries, sleeps, deploys-mid-execution; agents handle local state and per-call logic.

**State distribution:**
- Workflow: step results, retry state, sleep state.
- Agents: per-instance state (their normal job).

**When to use:**
- Multi-step flow that must survive restarts and deploys.
- Steps separated by long sleeps (hours, days, up to 365 days).
- Each step is a unit of work with deterministic inputs and outputs.

**Code shape:**

```typescript
export class OnboardingWorkflow extends WorkflowEntrypoint<Env, { userId: string }> {
  async run(event: WorkflowEvent<{ userId: string }>, step: WorkflowStep) {
    const profile = await step.do("collect-profile", async () => {
      const intake = await getAgentByName(this.env.IntakeAgent, event.payload.userId);
      return intake.gatherProfile();
    });

    await step.sleep("welcome-delay", "1 hour");

    await step.do("send-welcome", async () => {
      const messenger = await getAgentByName(this.env.MessengerAgent, "global");
      return messenger.send({ userId: event.payload.userId, template: "welcome", profile });
    });

    await step.sleep("nudge-delay", "3 days");

    const engaged = await step.do("check-engagement", async () => {
      const tracker = await getAgentByName(this.env.EngagementTracker, event.payload.userId);
      return tracker.summarizeWeek();
    });

    if (!engaged.didLogin) {
      await step.do("nudge", async () => {
        const messenger = await getAgentByName(this.env.MessengerAgent, "global");
        return messenger.send({ userId: event.payload.userId, template: "nudge" });
      });
    }
  }
}
```

**Pitfalls:**
- A Workflow step retries on failure. If your agent RPC method has side effects, make it idempotent (or guard with state — `if (this.state.welcomeSent) return`).
- Workflows cannot open WebSockets (cf-agents-core §6). Broadcasts to clients must go through an Agent's `broadcast()`.
- Non-`step` calls inside `run()` may execute multiple times on retry — best-effort only. Wrap every side effect in `step.do`.

**See:** `cloudflare/agents/examples/workflows`, `cf-agent-workflows-and-scheduling` skill.

---

## Choosing between the four

| Question | Pattern |
|---|---|
| One conversation, several specialist backends? | Supervisor |
| Phase change between intake and fulfilment? | Peer hand-off |
| Many independent jobs to grind through? | Fan-out (Queue + workers) |
| Steps separated by hours/days, must survive deploys? | Workflow-orchestrated |
| Just adding tools to one agent? | Don't split. Use `cf-agent-tools-and-mcp`. |
