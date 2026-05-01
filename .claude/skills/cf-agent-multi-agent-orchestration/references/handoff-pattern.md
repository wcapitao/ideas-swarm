# Hand-off pattern

Two flavors. Pick state-handoff by default; only escalate to full-replay when the second agent provably needs the full transcript.

## Why hand-offs exist

A conversation has phases that benefit from different agents:
- intake → fulfilment (different prompts, different tools)
- triage → resolution (different permissions)
- browse → checkout (different data access)
- generic → specialist (different model, different cost)

You could shove everything into one agent with `if (phase === "fulfilment")` branches. But:
- Context bleeds. The fulfilment phase sees intake junk it doesn't need.
- Permission boundaries blur. Fulfilment can read intake's secrets.
- The system prompt becomes a 500-line state machine.

A clean hand-off is cheaper and safer.

## Flavor 1 — State-handoff (default)

A condenses its work into a structured summary; B starts with that summary as initial state. A's transcript is **not** replayed.

### Code

```typescript
type HandoffSummary = {
  userIntent: string;
  gatheredFacts: Record<string, unknown>;
  artifactIds: string[];      // R2 keys, document IDs, etc
  reasonForHandoff: string;
};

// In A
async finishIntake() {
  const summary: HandoffSummary = {
    userIntent: this.state.intent,
    gatheredFacts: this.state.facts,
    artifactIds: this.state.artifacts.map((a) => a.r2Key),
    reasonForHandoff: "intake-complete",
  };
  const b = await getAgentByName(this.env.FulfilmentAgent, this.name);
  await b.startFromSummary(summary);
  await this.setState({ ...this.state, status: "handed-off" });
  await this.broadcast(JSON.stringify({
    type: "handoff",
    target: { agent: "FulfilmentAgent", name: this.name },
  }));
}

// In B
async startFromSummary(summary: HandoffSummary) {
  await this.setState({
    ...this.state,
    intent: summary.userIntent,
    facts: summary.gatheredFacts,
    sourceArtifacts: summary.artifactIds,
    phase: "fulfilment",
  });
  // Optional: pre-warm anything fulfilment needs (load artifacts from R2, etc)
}
```

### Tradeoffs

✓ **Cheap.** No transcript replay. B's context window stays small.
✓ **Privacy-preserving.** A chooses what to expose. Secrets stay in A.
✓ **Forward-compatible.** Adding to the summary is a non-breaking schema change.
✗ **Lossy.** If B later needs detail A summarized away, you must call back to A.
✗ **Schema discipline required.** The `HandoffSummary` type is a contract. Version it.

### When this is the right choice

- Phase A's role is to *gather and decide*; phase B's role is to *act on the decision*.
- The user's intent is captured in <2 KB of structured data.
- A and B have different permissions (B should not see A's full context).

## Flavor 2 — Full-replay

A and B share a common transcript store; B reads everything A saw and continues. The transcript can live in:

- A third DO (a `TranscriptAgent` or `ConversationStore` instance) — common for multi-party.
- B's own SQL store (B fetches from A via RPC at startup).
- An external store (R2, D1) — if you need to query/index the history.

### Code (third-DO variant)

```typescript
// Shared transcript DO
export class TranscriptAgent extends Agent<Env> {
  async append(entry: TranscriptEntry) {
    await this.sql`
      INSERT INTO transcript (ts, role, agent, content)
      VALUES (${Date.now()}, ${entry.role}, ${entry.agent}, ${entry.content})
    `;
  }

  async readAll(): Promise<TranscriptEntry[]> {
    const rows = await this.sql`SELECT * FROM transcript ORDER BY ts ASC`;
    return rows.toArray();
  }
}

// In A — log everything
async onChatMessage(_, options) {
  const t = await getAgentByName(this.env.TranscriptAgent, this.conversationId);
  await t.append({ role: "user", agent: "intake", content: this.lastUserMessage() });
  // ... A's response logic ...
  await t.append({ role: "assistant", agent: "intake", content: response });
}

// In B — pick up the full thread
async resume() {
  const t = await getAgentByName(this.env.TranscriptAgent, this.conversationId);
  const all = await t.readAll();
  await this.setState({ ...this.state, replayedHistory: all, phase: "fulfilment" });
}
```

### Tradeoffs

✓ **Lossless.** B has every byte A saw.
✓ **Auditable.** One canonical transcript per conversation.
✗ **Expensive context.** Long transcripts blow LLM costs and may exceed model windows.
✗ **Hot DO risk.** The shared `TranscriptAgent` becomes a single point of contention; throughput ceiling ~1k req/s.
✗ **Privacy leakage.** Anything A saw, B can read. Plan redaction explicitly.
✗ **Bigger blast radius for bugs.** If B's logic mishandles A's structure, every B run is broken.

### When this is the right choice

- Compliance / audit requires a complete record.
- Phase B genuinely needs to reason about phase A's nuances (e.g. legal review of a sales conversation).
- Multi-party where multiple agents read the same canonical thread.

## Hybrid: lazy-fetch summary + on-demand drill-down

Real-world default: hand off a summary, give B a method to call back into A for detail when needed.

```typescript
// In B
async needMoreContext(question: string): Promise<string> {
  // B realised the summary doesn't have what it needs
  const a = await getAgentByName(this.env.IntakeAgent, this.props.parentName);
  return a.queryHistory(question);
}

// In A
async queryHistory(question: string): Promise<string> {
  // A still has its full state; answers a focused question against it
  return this.searchOwnTranscript(question);
}
```

This is the "RAG within the topology" approach — summary is the working set, A is the cache.

## Client-side hand-off plumbing

When B is now the user's interlocutor, the client must reconnect:

### Server-driven (recommended)

A broadcasts a hand-off event on its WebSocket; the client sees it and reconnects.

```typescript
// In A
await this.broadcast(JSON.stringify({
  type: "handoff",
  target: { agent: "FulfilmentAgent", name: this.name },
}));

// In React frontend
const agentRef = useAgent({ agent: currentAgent, name: currentName, onMessage: (m) => {
  const data = JSON.parse(String(m.data));
  if (data.type === "handoff") {
    setCurrentAgent(data.target.agent);
    setCurrentName(data.target.name);
    // useAgent will reconnect to the new agent on the next render
  }
}});
```

### URL-driven

A returns a 302 redirect from `onRequest`. Useful for HTTP-driven flows, awkward for WebSocket sessions.

### Direct (no UI awareness)

A `fetch()`-forwards the user's request to B and proxies the response back. The user never knows there was a hand-off. Only works if A's outbound interface matches B's. Not common.

## Cleanup after hand-off

Don't leave A running indefinitely. Three options:

1. **Hibernate.** A keeps its state but goes idle. Cheap; no action needed.
2. **Mark dormant.** Set `this.state.status = "handed-off"`; keep state for audit; ignore future messages.
3. **Delete via SDK helper.** `deleteSubAgent("a-id")` from the parent. Use only when A's history is no longer needed.

Default to hibernate. Delete only with intent.
