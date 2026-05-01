---
name: cf-agent-multi-agent-orchestration
description: >
  Designs multi-agent topologies on Cloudflare Agents — when to split an
  agent into siblings, how the parent calls them, how state crosses agent
  boundaries. Activates when the user asks to "use a sub-agent", build an
  "agent-to-agent" call, "getAgentByName", design a "handoff" between
  agents, "fan out" work to workers, build a "supervisor pattern", an
  "agent network", or sketch an "agent topology". Encodes the four core
  patterns (supervisor / peer hand-off / fan-out via Queues / Workflow-
  orchestrated), the `getAgentByName` mechanics for sibling RPC, the two
  hand-off flavors (state-handoff vs full-replay), the sub-agent footguns
  (no `schedule()`, no `AbortSignal` across DO RPC, cycles), and ships
  audit-topology.ts to graph the agent-call graph from source. Do NOT use
  for single-agent tool-call dispatch — that's `cf-agent-tools-and-mcp`.
---

# Cloudflare Agents — Multi-Agent Orchestration

## Overview

A Cloudflare "agent" is a class extending `Agent` (or `AIChatAgent` /
`McpAgent`), instantiated as a Durable Object. Multi-agent orchestration
is what happens when one DO calls another DO via `getAgentByName` (or via
the SDK's first-class sub-agent helpers like `agentTool()`). The transport
between them is DO RPC — type-safe method calls, no HTTP, no JSON parsing.

This skill is opinionated:

- **Default to one agent.** A single agent with multiple tools is simpler,
  cheaper, and easier to reason about than a network.
- **Split only when state lifetimes, transport surfaces, scaling profiles,
  or permission domains differ.** Splitting "to feel modular" is a tax.
- **The graph must be acyclic.** `audit-topology.ts` enforces this.

## When to split into multiple agents

Split if **any** of the following is true:

1. **Different state lifetimes.** A per-user supervisor (lives for years)
   should not own per-task scratch state (lives for minutes). One DO per
   user + one DO per task is cleaner and lets the task DO be deleted
   without losing user history.
2. **Different transport surfaces.** A chat agent (`AIChatAgent` over
   WebSocket) and an MCP server agent (`McpAgent` over Streamable HTTP)
   serve different clients. They can share state via a third DO or via
   sibling RPC, but they should be separate classes.
3. **Different scaling profiles.** One always-on supervisor that owns the
   conversation, plus many transient worker agents that come up to grind
   on a task and then go quiet. One always-warm DO + N hibernating DOs is
   cheaper than N always-warm DOs.
4. **Different permission domains.** An admin agent that can write to all
   users' state vs a user agent that can only see its own. Keep them
   separate so the admin's blast radius is clear.

If none of these apply, **don't split**. A single `Agent` class with
multiple tools (some calling Workers AI, some calling MCP servers, some
calling external HTTP) is the right answer.

## Anti-pattern: splitting just to feel modular

Each Cloudflare DO instance you add to the topology costs:

- More **duration GB-s** when not hibernated (real money — see
  `cf-runtime-primitives.md` §12; DO duration is the dominant line item
  in most agent systems).
- More **migration overhead** — every class gets a `new_sqlite_classes`
  migration tag, never editable, append-only forever.
- More **subrequest fan-out** — every cross-agent RPC counts as a
  subrequest. Free-tier Workers cap at 50; paid at 1,000.
- More **reasoning surface** — auth, rate limiting, observability, and
  tests now have to span multiple classes.

A 4-agent supervisor/research/critic/judge mesh costs more than a single
`ResearchAgent` with four tool methods, and is no easier to evolve. Only
split when the four reasons above force you to.

## Topology patterns

The four shapes you'll actually deploy.

### 1. Supervisor

One agent owns the conversation; specialist agents do focused work and
return; the supervisor synthesizes.

```
        ChatSupervisor          (per-user; holds WS to browser)
              |
              |   getAgentByName(env.X, ...)
      +-------+-------+
      v       v       v
   Research  Code   Judge       (per-task; transient)
```

```typescript
export class ChatSupervisor extends AIChatAgent<Env> {
  async onChatMessage() {
    const research = await getAgentByName(
      this.env.ResearchAgent,
      `task-${crypto.randomUUID()}`,
    );
    const findings = await research.investigate(this.lastUserMessage());

    const judge = await getAgentByName(this.env.JudgeAgent, "global");
    const verdict = await judge.score(findings);

    return this.streamSynthesis(findings, verdict);
  }
}
```

Use when: one agent is the user-facing surface, others are bounded
specialists. Most production "Cloudflare-style" multi-agent apps look
like this. See `cloudflare/agents/examples/agents-as-tools` and
`cloudflare/agents/examples/multi-ai-chat`.

### 2. Peer-to-peer hand-off

Agent A finishes its phase, hands the conversation to agent B, A goes
quiet. B does not see A's full context — only what A serialized.

```
  user -> A (intake) --handoff--> B (fulfilment)
                                       ^
                                       | user keeps talking to B
```

```typescript
export class IntakeAgent extends Agent<Env> {
  async finish() {
    const summary = await this.summarize(this.state);
    const fulfilment = await getAgentByName(
      this.env.FulfilmentAgent,
      this.name,  // same name = same instance forever
    );
    await fulfilment.startFromSummary(summary);
    await this.setState({ ...this.state, status: "handed-off" });
    // IntakeAgent now hibernates; client reconnects to FulfilmentAgent
  }
}
```

Use when: phases are sequential, the second agent has different
permissions or model, and replaying the first agent's full transcript
would be wasteful. See `examples/openai-sdk/handoffs/`.

### 3. Fan-out (Queue + workers)

Supervisor pushes N tasks to a Queue; **Worker** consumers (not agents)
process them; supervisor consumes results via callback or polling.

```
   Supervisor --send N-->  [ Queue ]  --pop-->  Worker (xN concurrent)
                                                     |
                                                     | writes result
                                                     v
                                              Supervisor.notifyDone()
```

```typescript
// In the supervisor
async dispatch(items: Item[]) {
  const jobId = crypto.randomUUID();
  await this.env.JOBS.sendBatch(
    items.map((body) => ({ body: { jobId, supervisor: this.name, item: body } })),
  );
  await this.setState({ ...this.state, pending: { [jobId]: items.length } });
}

// In the queue consumer Worker (NOT an agent)
export default {
  async queue(batch: MessageBatch<Job>, env: Env) {
    for (const msg of batch.messages) {
      const result = await processItem(msg.body.item);
      const supervisor = await getAgentByName(env.Supervisor, msg.body.supervisor);
      await supervisor.notifyDone(msg.body.jobId, result);
      msg.ack();
    }
  },
};
```

Use when: N is large (>10) and items are independent. **Don't** fan out
to N agent DOs — pay the DO cost only for stateful work. Workers are
cheap-fan-out; agents are not.

### 4. Workflow-orchestrated

A Workflow owns the durability and retry logic; each step calls into one
or more agents via RPC. Agents own state, the Workflow owns the
narrative.

```
   Worker triggers -> Workflow --step.do--> AgentA.method()
                          |
                          +--step.do------> AgentB.method()
                          |
                          +--step.sleep---> (resume next week)
```

```typescript
export class OnboardingWorkflow extends WorkflowEntrypoint<Env, OnboardingPayload> {
  async run(event: WorkflowEvent<OnboardingPayload>, step: WorkflowStep) {
    const profile = await step.do("collect-profile", async () => {
      const intake = await getAgentByName(this.env.IntakeAgent, event.payload.userId);
      return intake.collectProfile();
    });

    await step.sleep("wait-1d", "1 day");

    await step.do("send-welcome", async () => {
      const messenger = await getAgentByName(this.env.MessengerAgent, "global");
      return messenger.sendWelcome(profile);
    });
  }
}
```

Use when: the orchestration must survive deploys, sleeps for hours/days,
or has many heterogeneous steps. Workflow steps are idempotent units; the
agents themselves stay simple. See `cf-agent-workflows-and-scheduling`.

## `getAgentByName` mechanics

```typescript
const stub = await getAgentByName(env.MyAgent, "instance-name", {
  locationHint: "enam",         // optional region hint
  jurisdiction: "eu",           // optional data residency
  props: { userId: "u-42" },    // attached to the target agent's `this.props`
});

// Now stub is a typed DurableObjectStub<MyAgent>:
const result = await stub.someMethod(arg1, arg2);  // typed RPC
const res    = await stub.fetch(req);              // forward an HTTP request
```

Key facts:

- **Naming is deterministic.** `name === name` => same DO instance forever.
  Use stable IDs (`user-${userId}`, `task-${taskId}`) so the same caller
  always lands on the same instance.
- **No `@callable` needed for server-to-server.** `@callable()` is only
  for client->server RPC over WebSocket. Inside a Worker or another agent,
  call methods directly via the stub.
- **The stub speaks DO RPC, not HTTP.** Cheaper, type-safe, no JSON
  serialization tax — but with caveats (see footguns).
- **Children of sub-agents** auto-discover via `ctx.exports`; only the
  parent class needs an explicit `durable_objects.bindings` entry. (See
  `agents/api-reference/sub-agents` — the SDK has first-class
  sub-agent helpers `agentTool()`, `runAgentTool()`, `abortSubAgent()`,
  `deleteSubAgent()`.)

When to prefer `getAgentByName` over the SDK's sub-agent helpers:

| You want… | Use |
|---|---|
| Plain peer agent call from a Worker, Workflow, or another agent | `getAgentByName` |
| Parent-managed lifecycle (abort, delete cascade), automatic discovery | SDK sub-agent helpers (`agentTool`, `runAgentTool`) |
| Forward an HTTP request to an agent | `stub.fetch(req)` |

## Hand-off pattern (state crossing agent boundaries)

Two flavors. Pick one consciously.

### State-handoff (recommended default)

A serializes a summary of its work. B starts fresh with that summary as
its initial state. A's transcript is not replayed.

```typescript
// In A
const summary = {
  userIntent: this.state.intent,
  decisionsMade: this.state.decisions,
  artifactsProduced: this.state.outputs.map((o) => o.id),
};
await b.startFromSummary(summary);

// In B
async startFromSummary(summary: HandoffSummary) {
  await this.setState({ ...this.initialState, ...summary, phase: "fulfilment" });
}
```

Tradeoffs:
- Cheap. No replay. B's context window stays small.
- Clean permission story — A can redact what B shouldn't see.
- Lossy. If B needs detail A summarized away, you can't recover it
  without going back to A.

### Full-replay

A and B share a transcript via a third DO (a "shared memory" agent) or
via SQL on B. B reads everything A saw and continues.

```typescript
// Both agents write to a shared TranscriptAgent
const transcript = await getAgentByName(env.TranscriptAgent, conversationId);
await transcript.append({ role: "intake", content: msg });

// B picks up
async resume() {
  const all = await transcript.readAll();
  this.replay(all);
}
```

Tradeoffs:
- Lossless. B has every byte A saw.
- Expensive. Long transcript = large context = slow + expensive LLM
  calls. And the shared DO is a hot single point.
- Permission leakage risk. If A saw a secret, B sees it too.

**Default to state-handoff.** Reach for full-replay only when the
downstream agent demonstrably needs the full history.

## Sub-agent footguns

1. **Sub-agents cannot `schedule()`, `cancelSchedule()`, or `keepAlive()`.**
   They throw at runtime. Schedule from the parent and dispatch via RPC
   when the alarm fires. (cf-agents-core §15)
2. **`AbortSignal` does not cross DO RPC boundaries.** If your supervisor
   wants to cancel a worker mid-flight, you cannot pass an AbortController
   over `getAgentByName(...).method(signal)`. The signal will be a fresh
   stub on the worker side. Construct AbortControllers inside the worker
   DO and expose a `cancel()` RPC method instead.
3. **Cycles deadlock.** Agent A awaits Agent B awaits Agent A → both DOs
   block forever (DOs are single-threaded). `audit-topology.ts` detects
   cycles statically.
4. **Every cross-agent call is a subrequest.** Free Workers: 50
   subrequests/request. Paid: 1,000. A supervisor that fans out to 1,001
   workers in one turn fails.
5. **Child class names must match exactly.** `cloudflare/agents`
   sub-agent discovery uses class name string-match — no aliased exports.
6. **`abortSubAgent` / `deleteSubAgent` cascade.** Deleting a parent
   sub-agent recursively deletes its children. Useful for cleanup; lethal
   if you didn't expect it.
7. **Children inherit nothing implicit.** `props`, auth context, location
   hints — pass each explicitly via `getAgentByName(..., { props })`.

## OpenAI-SDK-style multi-agent

Cloudflare ships a parallel set of demos in
`cloudflare/agents/examples/openai-sdk/` that use `@openai/agents`
(OpenAI's Agents SDK) instead of Cloudflare's own SDK, layered on top of
Workers + DOs:

| Demo | What it shows |
|---|---|
| `basic` | Minimal one-agent setup |
| `chess-app` | Two agents (player + analyzer) talking |
| `handoffs` | OpenAI-SDK handoff translated to a Cloudflare DO topology |
| `human-in-the-loop` | Approval gate between agents |
| `llm-as-a-judge` | Generator + critic loop |
| `pizzaz` | Multi-agent demo app (commerce flow) |
| `streaming-chat` | Streaming responses with multi-agent backend |
| `call-my-agent` | Voice/phone front-end into a multi-agent backend |

Use these when you're porting an existing OpenAI-SDK multi-agent app to
Cloudflare. For greenfield Cloudflare work, prefer the native
`cloudflare/agents` SDK demos (`agents-as-tools`, `multi-ai-chat`,
`assistant`) — they're better integrated with DO state, hibernation,
WebSockets, and the Workers runtime.

See `references/examples-catalog.md` for full pointers.

## When NOT to split

Rule of thumb: if your "second agent" wouldn't have its own state,
schedule, or transport, it's a tool. Make it a method on the existing
agent or an MCP tool. Single-agent + multi-tool dispatch is:

- **Cheaper.** One DO, one duration meter.
- **Simpler.** No cross-agent error handling, no hand-off serialization.
- **Easier to test.** One `runDurableObject` block in vitest.
- **Easier to observe.** One transcript per conversation.

You should feel a real itch — "this state lives on a different timeline"
or "this surface needs different auth" — before splitting. If the only
reason is "this looks neater as a separate file," it isn't.

## Hand-offs to other skills

| Situation | Skill |
|---|---|
| Topology is being designed; this is the first sketch | `cf-agent-architect` |
| The orchestration is durable and multi-step (sleeps, retries, days) | `cf-agent-workflows-and-scheduling` |
| Need to test across agent boundaries (`runDurableObject` of one agent that calls another) | `cf-agent-tests-and-evals` |
| Adding more tools to an existing agent (not splitting) | `cf-agent-tools-and-mcp` |
| Cross-agent permission separation (admin DO vs user DO) | `cf-agent-auth-and-permissions` |
| Topology scope grows past three classes — revisit the design | `cf-agent-architect` |

## Critical rules

- **Single-agent is the default.** Justify every split with a state /
  transport / scaling / permission reason.
- **No cycles.** Run `scripts/audit-topology.ts` against your source.
- **Stable DO names.** Use deterministic IDs (`user-${id}`, `task-${id}`),
  never `crypto.randomUUID()` for an agent the caller will need to find
  again.
- **Sub-agents do not schedule.** Schedule in the parent.
- **Cancellation crosses RPC explicitly.** Provide a `cancel()` method
  on the worker; do not rely on `AbortSignal`.
- **State-handoff before full-replay.** Reach for replay only when proven
  necessary.
- **Cap fan-out at the subrequest budget.** 50 free / 1,000 paid per
  request. Anything bigger goes through Queues, not direct RPC.

## Scripts

`scripts/audit-topology.ts` — static analysis: parses all
`getAgentByName(env.X, ...)` and SDK sub-agent calls in your codebase,
builds a directed graph of agent->agent calls, detects cycles, prints a
Mermaid diagram. Run before merging any change that adds or removes a
cross-agent call.

```bash
npx tsx scripts/audit-topology.ts src/
```

Exits non-zero if cycles are found.
