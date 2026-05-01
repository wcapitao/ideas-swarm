# Durable execution — `runFiber` / `stash` / `onFiberRecovered` / `keepAliveWhile`

The runtime layer for async functions inside the Agent that must
survive a DO restart, a hibernation cycle, or a deploy mid-flight —
without escalating to a full Workflow.

Source:
https://developers.cloudflare.com/agents/api-reference/durable-execution/
https://developers.cloudflare.com/agents/concepts/long-running-agents/

## Decision: fiber vs Workflow

| Property | runFiber | Workflow |
|---|---|---|
| Execution location | inside the Agent DO | separate runtime |
| Sleep | no native sleep — use `schedule()` to chain | `step.sleep` up to 365 days |
| Retry | none auto — recover in `onFiberRecovered` | per-step config |
| Branching | normal JS code | normal JS code |
| Cost / overhead | one DO row + your stash | full Workflow instance |
| Use when | "I have a 5-minute deliberation that already burnt $4 of LLM cost; survive a deploy" | "I have a 7-day onboarding pipeline" |

## `runFiber` — checkpointed async function

```ts
class MyAgent extends Agent<Env, State> {
  async deepResearch(topic: string) {
    return this.runFiber("research", async (fiber) => {
      // Phase 1: cheap fetch
      const sources = await fetchSources(topic);
      await fiber.stash({ stage: "fetched", topic, sources });

      // Phase 2: expensive LLM summary
      const summary = await llm.summarize(sources);
      await fiber.stash({ stage: "summarized", topic, sources, summary });

      // Phase 3: expensive LLM writeup
      const writeup = await llm.write(summary);
      await fiber.stash({ stage: "wrote", topic, sources, summary, writeup });

      return writeup;
    });
  }
}
```

The fiber is named (`"research"` here) so multiple in-flight fibers per
agent can be tracked independently.

## `stash()` — checkpointed snapshots

`fiber.stash(snapshot)` writes a JSON-serializable object into the
Agent's storage as the latest known state of this fiber.

Rules:

- **Replaces, doesn't merge.** The new value overwrites the previous
  snapshot in full.
- **Must be JSON-serializable.** Functions, Dates, Maps, Sets do not
  survive. Use ISO strings.
- **Cheap to call** — synchronous storage write under the hood.
- **Granularity is your choice.** A common pattern is one stash per
  expensive step, marking the stage so recovery can resume.

```ts
await fiber.stash({
  stage: "summarized",
  topic,
  sources,                       // already fetched — don't refetch
  summary,                       // already paid for — don't redo
  startedAt: new Date().toISOString(),
});
```

## `onFiberRecovered` — recovery hook

When the DO restarts (deploy, hibernation evict + wake on a request,
crash), the runtime fires `onFiberRecovered` for every fiber that was
mid-execution. **Closures inside the original `runFiber` callback are
NOT serialized** — you cannot resume the suspended function.

```ts
async onFiberRecovered(ctx: FiberRecoveryContext) {
  const snapshot = ctx.lastStash as any;

  // Never stashed — start over (or abandon).
  if (!snapshot) return;

  try {
    if (snapshot.stage === "fetched") {
      const summary = await llm.summarize(snapshot.sources);
      const writeup = await llm.write(summary);
      await ctx.complete(writeup);
      return;
    }
    if (snapshot.stage === "summarized") {
      const writeup = await llm.write(snapshot.summary);
      await ctx.complete(writeup);
      return;
    }
    if (snapshot.stage === "wrote") {
      // Whole thing is done — just emit the result.
      await ctx.complete(snapshot.writeup);
      return;
    }
  } catch (err) {
    // 🚨 If we throw here, the row is deleted with NO automatic retry.
    // Manual recovery: re-run later.
    await this.schedule(60, "retryFiberRecovery", { snapshot });
  }
}

async retryFiberRecovery(p: { snapshot: any }) {
  // Re-issue the work outside the fiber recovery path.
}
```

`FiberRecoveryContext` API:

```ts
interface FiberRecoveryContext {
  fiberName: string;
  lastStash: unknown | null;
  complete(result: unknown): Promise<void>;   // resolve the original runFiber promise
  fail(error: unknown): Promise<void>;        // reject the original runFiber promise
}
```

## `keepAliveWhile` — anchor a live connection

For a single async block that must keep the DO awake for its full
duration — typically a streamed LLM response or an SSE pump.

```ts
async streamCompletion(prompt: string) {
  return this.keepAliveWhile(async () => {
    for await (const chunk of llm.stream(prompt)) {
      this.broadcast(JSON.stringify({ kind: "chunk", chunk }));
    }
  });
}
```

The DO will not hibernate while the promise is pending. Once the
promise resolves (or rejects), normal hibernation behavior resumes.

Use `keepAliveWhile` when:

- You hold an outbound WebSocket — those don't hibernate by themselves.
- You're streaming an LLM and the request would otherwise time out.
- You're awaiting a long external call where reconnect on hibernate
  would lose the in-flight work.

Don't use `keepAliveWhile` for:

- Periodic ticks → use `scheduleEvery`.
- Multi-hour pipelines → use a Workflow.
- Long sleeps → use `schedule()` or Workflow `step.sleep`.

## Sub-agent restriction

Inside a sub-agent, `keepAlive()` and `keepAliveWhile()` **throw**, in
the same way `schedule()` does. Schedule the long work on the parent
and dispatch via RPC.

## Restart semantics — what survives, what doesn't

| Item | Survives restart? |
|---|---|
| `this.state` | ✅ (SQLite) |
| `this.sql` rows | ✅ |
| `connection.state` | ✅ |
| Scheduled tasks | ✅ |
| In-memory class fields (`this.foo = 5`) | ❌ |
| `setTimeout` / `setInterval` | ❌ |
| In-flight promises captured in closures | ❌ |
| Closures inside `runFiber` | ❌ — recover via `onFiberRecovered` |
| Fiber stash | ✅ |
| `keepAliveWhile` block | ❌ — restarts as a plain agent without the block |

## Anti-patterns

- **Recovery logic in the `runFiber` closure.** It will not run on
  restart. Put it in `onFiberRecovered`.
- **Stash-as-merge.** `stash` is a full replace. Build the full
  snapshot every call.
- **`Date`, `Map`, `Set` in the stash.** Lost. Convert to ISO strings,
  arrays, plain objects.
- **`onFiberRecovered` that can throw.** A throw drops the row with no
  retry. Wrap and reschedule manually.
- **Long `keepAliveWhile` for periodic work.** `keepAliveWhile` holds
  the DO awake — it's expensive. For periodic ticks use `scheduleEvery`.
- **`keepAliveWhile` in a sub-agent.** Throws. Hold on the parent.

## Worked example — LLM deliberation that survives a deploy

```ts
class IdeatorAgent extends Agent<Env, State> {
  async generateIdeas(topic: string, n: number) {
    return this.runFiber(`ideate-${topic}`, async (fiber) => {
      // Phase 1: brainstorm
      const seeds = await llm.brainstorm(topic, { n: n * 2 });
      await fiber.stash({ stage: "seeds", topic, n, seeds });

      // Phase 2: rank
      const ranked = await llm.rank(seeds, { topic });
      await fiber.stash({ stage: "ranked", topic, n, seeds, ranked });

      // Phase 3: top-N narratives
      const narratives = await Promise.all(
        ranked.slice(0, n).map((idea) => llm.expand(idea))
      );
      await fiber.stash({ stage: "expanded", topic, n, narratives });

      return narratives;
    });
  }

  async onFiberRecovered(ctx: FiberRecoveryContext) {
    const s = ctx.lastStash as any;
    if (!s) return;

    try {
      if (s.stage === "seeds") {
        const ranked = await llm.rank(s.seeds, { topic: s.topic });
        const narratives = await Promise.all(
          ranked.slice(0, s.n).map((idea) => llm.expand(idea))
        );
        return ctx.complete(narratives);
      }
      if (s.stage === "ranked") {
        const narratives = await Promise.all(
          s.ranked.slice(0, s.n).map((idea) => llm.expand(idea))
        );
        return ctx.complete(narratives);
      }
      if (s.stage === "expanded") {
        return ctx.complete(s.narratives);
      }
    } catch (err) {
      // Hand off to schedule for re-attempt; do NOT throw out of onFiberRecovered.
      await this.schedule(120, "retryIdeate", { snapshot: s });
    }
  }

  async retryIdeate(p: { snapshot: any }) {
    // Re-enter the recovery flow with the saved snapshot.
    // Implementation depends on how you want to re-issue work.
  }
}
```
