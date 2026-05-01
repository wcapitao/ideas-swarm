---
name: cf-agent-tests-and-evals
description: >
  Tests and evaluations for Cloudflare Agents. Activates when the user asks to
  "test the agent", "vitest pool workers", "runInDurableObject", "test the
  websocket", "test scheduled tasks", "test the alarm", "eval the agent",
  "golden set", "judge model", "regression tests for the agent", "agent CI",
  "test the chat agent", "agent test harness", "mock Workers AI", "mock the
  LLM in tests", or any phrase about testing or evaluating a Cloudflare-runtime
  agent. Covers the full pyramid — vitest pool with @cloudflare/vitest-pool-workers,
  DO-level testing, WebSocket flow tests, alarm/schedule tests, LLM mocking,
  golden-set evals with judge-model scoring, AI Gateway eval flow, and CI matrix.
  Use PROACTIVELY whenever code is written without tests. Do NOT use for
  non-Cloudflare-runtime test work (route to language-specific test skills).
---

# cf-agent-tests-and-evals

> The most-elevated skill in the suite. The user explicitly raised tests + evals to first-class. An agent without an eval suite is an agent that will silently regress.

## When to use

| Trigger | Use? |
|---|---|
| "test the agent" / "write tests for [agent]" | YES |
| "set up vitest for this Worker" | YES |
| "I need an eval harness for the agent" | YES |
| "regression-test the chat flow" | YES |
| "the agent is non-deterministic, how do I test it" | YES |
| "mock Workers AI / the LLM" | YES |
| Pure TS unit test with no Workers runtime needed | NO → plain vitest |

## The 10-tier testing pyramid

| Tier | Surface tested | Tool | Scope per test |
|------|---------------|------|----------------|
| 1 | Pure TS functions (parsers, schemas) | plain `vitest` | <1ms |
| 2 | Agent **method** in isolation | `runInDurableObject` | a few ms |
| 3 | Agent **state migration** | `runInDurableObject` + SQL inspection | tens of ms |
| 4 | **HTTP** routing via `routeAgentRequest` | `SELF.fetch` | tens of ms |
| 5 | **WebSocket** flow (onConnect → onMessage → broadcast) | `SELF.fetch(101)` + helpers | hundreds of ms |
| 6 | **Alarm** firing | `runDurableObjectAlarm` | tens of ms |
| 7 | **Scheduled task** firing | SQL backdate trick | tens of ms |
| 8 | **Workflow step** mocking | `introspectWorkflowInstance` + `await using` | hundreds of ms |
| 9 | **LLM-in-the-loop** golden eval | DIY harness + judge model | seconds |
| 10 | **Replay regression** from prod logs | AIG logs API + replay script | seconds |

Every tier above tier 2 requires `@cloudflare/vitest-pool-workers`.

## Setup in 5 minutes

`wrangler.jsonc` (test target):
```jsonc
{
  "name": "agent-tests",
  "compatibility_date": "2026-04-01",
  "compatibility_flags": [
    "nodejs_compat",
    "experimental",
    "no_handle_cross_request_promise_resolution",
    "service_binding_extra_handlers",
    "rpc",
    "no_global_navigator",
    "no_global_fetch_mock"
  ]
}
```

`vitest.config.ts`:
```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // bind your DO here; the test runtime needs the same shape as prod
          durableObjects: { AGENT: { className: "MyAgent", scriptName: "agent-tests" } }
        }
      }
    }
  }
});
```

`test/setup.ts` — **the warm-up trick**. Without this, the first test in a file will time out from cold Vite resolution:
```ts
import worker from "../src/index";
beforeAll(async () => {
  await worker.fetch(new Request("http://warmup/"), env, ctx);
});
```

`tsconfig.json`:
```jsonc
{
  "compilerOptions": {
    "types": ["@cloudflare/vitest-pool-workers"],
    "experimentalDecorators": false  // standards-track only — see Non-negotiables
  }
}
```

**The architectural decision**: WebSocket tests need a workspace split because per-file storage isolation breaks shared DO storage. Run two projects:

```ts
// vitest.workspace.ts
export default [
  // Isolated: most tests, fast, parallel
  { extends: "./vitest.config.ts", test: { include: ["test/unit/**"] } },
  // Shared: WS tests, --no-isolate
  {
    extends: "./vitest.config.ts",
    test: {
      include: ["test/ws/**"],
      isolate: false,
      poolOptions: { workers: { isolatedStorage: false, singleWorker: true } }
    }
  }
];
```

This is exactly what `cloudflare/agents` itself does. Don't reinvent.

## Six tests every agent needs

Full code in `references/do-test-cookbook.md`. Teaser per test:

### 1. Test an Agent method directly

```ts
import { env, runInDurableObject } from "cloudflare:test";

it("greet appends to history", async () => {
  const id = env.AGENT.idFromName("user-1");
  const stub = env.AGENT.get(id);
  await runInDurableObject(stub, async (instance) => {
    await instance.greet("hello");
    expect(instance.state.history).toContain("hello");
  });
});
```

### 2. Test a WebSocket flow

```ts
it("onMessage broadcasts state delta", async () => {
  const ws = await connectWS(env, "/agents/MyAgent/user-1");
  ws.send(JSON.stringify({ type: "ping" }));
  const msg = await waitForMessage(ws, m => m.type === "state");
  expect(msg.state.lastPing).toBeDefined();
});
```

### 3. Test scheduled task firing

The trick: schedule with `delay: 60`, then SQL-backdate the row to make it overdue, then trigger the alarm.
```ts
await runInDurableObject(stub, async (i, state) => {
  await i.schedule(60, "onTick");
  state.storage.sql.exec(
    "UPDATE cf_agents_schedules SET fire_at = ? WHERE callback = ?",
    Date.now() - 1000, "onTick"
  );
});
await runDurableObjectAlarm(stub);
// assert side effect
```

### 4. Test the alarm() handler

```ts
await runInDurableObject(stub, i => i.ctx.storage.setAlarm(Date.now()));
const ran = await runDurableObjectAlarm(stub);
expect(ran).toBe(true);
```

### 5. Test routeAgentRequest end-to-end

```ts
it("routes to the right agent", async () => {
  const r = await SELF.fetch("https://test/agents/MyAgent/u1", {
    headers: { Upgrade: "websocket" }
  });
  // Pool rule: WS upgrade returns 101 OR 426 — accept both
  expect([101, 426]).toContain(r.status);
});
```

### 6. Test SQL state migration

```ts
it("v2 migration adds the topic column", async () => {
  await runInDurableObject(stub, async (i) => {
    const cols = i.ctx.storage.sql
      .exec("PRAGMA table_info(messages)").toArray();
    expect(cols.find(c => c.name === "topic")).toBeDefined();
  });
});
```

## Mocking the LLM

### Workers AI (canonical)

```ts
import { env } from "cloudflare:test";
import { vi } from "vitest";

vi.spyOn(env.AI, "run").mockResolvedValue({ response: "stubbed" });
```

This is verbatim what `cloudflare/agents` and `workers-sdk/fixtures/ai-vectorize` use. Don't reinvent.

### HTTP providers (Anthropic / OpenAI)

```ts
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const server = setupServer(
  http.post("https://api.anthropic.com/v1/messages",
    () => HttpResponse.json({ content: [{ type: "text", text: "stub" }] }))
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

`onUnhandledRequest: "error"` is non-negotiable — silent fall-through to the real network is how you waste $50 in a CI run.

### Workflow steps

```ts
import { introspectWorkflowInstance } from "cloudflare:test";

await using inst = await introspectWorkflowInstance(env.WF, "id-1");
inst.modify({ instanceId: "id-1" }, async (mod) => {
  await mod.mockStepResult({ name: "fetch-data", result: { data: "stub" } });
});
// ... drive the workflow, assert
```

`await using` ensures the introspection is unwound on test exit. Forget this and the next test inherits the mock.

## LLM-in-the-loop evals

The harness shape (full code in `scripts/eval-runner.ts`):

```
evals/
  cases/
    chat-001-greeting.jsonl     # one case per file or batched
    chat-002-disambiguation.jsonl
  rubrics/
    coherence.md                # judge prompt for "does this make sense"
    safety.md                   # judge prompt for "is this safe to ship"
  baseline/
    snapshots/                  # last green run for diff comparison
```

A case file:
```jsonl
{"id":"chat-001","input":[{"role":"user","content":"hi"}],"expect":{"toolCalls":["greet"],"rubric":["coherence"]}}
```

Run modes:
1. **First-time** — produce the snapshot, save under `baseline/snapshots/`. Manual review gate.
2. **Regression** — diff vs baseline. Deterministic assertions hard-fail; rubric scores require ≥4/5.

The judge model: Anthropic via AI Gateway with structured tool-use output. Falls back to `@cf/meta/llama-3.1-8b-instruct` for cost-tier evals. See `scripts/eval-judge.ts`.

## AI Gateway eval flow

AIG ships built-in evaluators but they're weak: **Cost**, **Speed**, and **human thumbs-up only**. Useful for cost/latency regression. Insufficient for behavioral regression.

The DIY pattern that works:
```
[1] Cron pulls AIG logs API for the last 24h
[2] Filter to logs with metadata.session_id (your agent's marker)
[3] For each session, reconstruct the message sequence
[4] Replay against the test agent (scripts/replay-prod-session.ts)
[5] Score the new output with the judge model
[6] Flag any regression, file as a new golden case for review
[7] On approval, promote to evals/cases/
```

This is the **production-feedback loop**. It's what compounds — the eval set grows from real usage, not invented cases.

## CI matrix

| Tier | What | When | Budget |
|------|------|------|--------|
| 1 | Unit tests (no Workers runtime) | every PR | <30s |
| 2 | Integration (DO + WS + alarm) | every PR | <3min |
| 3 | Nightly evals (golden set, judge) | nightly + on-merge | <15min, <$2 |
| 4 | Cost regression (token + duration) | weekly | <30min, <$5 |

GitHub Actions skeleton (full file in `references/ci-matrix.md`):
```yaml
strategy:
  matrix:
    tier: [unit, integration]
    include:
      - tier: evals
        if: github.event_name == 'schedule'
```

## Determinism tactics

| Source of nondet | How to control |
|------------------|----------------|
| `Date.now()` | `vi.useFakeTimers({ now: 1700000000000 })` |
| `crypto.randomUUID()` | `vi.spyOn(crypto, 'randomUUID').mockReturnValue(...)` |
| Network | MSW with `onUnhandledRequest: "error"` |
| LLM output | judge-model rubric, not exact-match |
| KV TTL expiry | **does not respect fake timers** — use real `await scheduler.wait(ttl + 1)` |

The KV-TTL gotcha is from the official known-issues list. Don't try to advance fake time past a TTL; KV won't expire.

## Production telemetry → eval feedback loop

```
prod (AIG logs)
   ↓ nightly cron pulls logs by metadata.session_id
classifier (cheap LLM: pass/fail/edge)
   ↓ failures + edges
human review queue
   ↓ on approval
evals/cases/  (new golden case)
   ↓ next CI run
regression detected → blocks merge
```

Without this loop, your eval set rots. With it, every prod failure becomes a regression test for free.

## Footguns (the 11 known)

1. **WebSocket tests need `--no-isolate` workspace split** — per-file isolation breaks shared DO storage.
2. **`setup.ts` warm-up** — without it, first test per file times out cold.
3. **`experimentalDecorators: true`** silently breaks `@callable()`. Standards-track only.
4. **MCP SDK ≥1.26.0** requires fresh `McpServer` per request in stateless servers.
5. **`AbortSignal`** does not cross DO RPC. Enforce timeouts on the DO side.
6. **`acceptWebSocket`** not `accept()` — also matters in tests; otherwise hibernation tests don't reflect prod.
7. **KV TTL doesn't respect fake timers** — use real waits or test the TTL logic separately.
8. **`runDurableObjectAlarm` returns false** if no alarm was set — assert true to catch missing-setAlarm bugs.
9. **`routeAgentRequest` returns null for non-WebSocket requests** — your tests need to handle 426.
10. **Workflow disposal** — forget `await using` on `introspectWorkflowInstance` and the next test inherits mocks.
11. **MSW + Workers pool** — must use `msw/node` not `msw/browser`; the Workers pool runs Node-style.

## Hand-offs

- After tests pass → `cf-agent-deploy-and-observe` for the CI/CD recipe + production checklist.
- Before tests can be written → `cf-agent-architect` to lock the agent's shape; tests are easier on a stable shape.
- For testing OAuth flows specifically → `cf-agent-auth-and-permissions` has a curl-driven smoke test.

## Non-negotiables (cross-cutting)

The 10 rules from `docs/research/SKILL_CATALOG.md` apply. The ones this skill enforces directly:

- **`vi.spyOn(env.AI, "run")`** is the canonical Workers AI mock.
- **`--no-isolate` workspace split** for any test that touches WebSocket DOs.
- **`onUnhandledRequest: "error"`** in MSW.
- **AIG in front of every LLM call** — your eval harness depends on AIG logs to close the feedback loop.

## See also

- `references/testing-pyramid.md` — full 10-tier table
- `references/vitest-setup.md` — copy-pasteable config for a new agent
- `references/do-test-cookbook.md` — six worked examples in full
- `references/llm-mocking.md` — every mock pattern
- `references/eval-harness.md` — golden JSONL schema, judge rubric design
- `references/aig-eval-flow.md` — DIY harness on top of AIG logs
- `references/ci-matrix.md` — full GH Actions yaml
- `scripts/eval-runner.ts` — the runnable harness
- `scripts/eval-judge.ts` — judge model with structured output
- `scripts/ws-test-helpers.ts` — `connectWS`, `waitForMessage`, `hibernateAndRestore`
- `scripts/replay-prod-session.ts` — pull AIG log → replay → diff
