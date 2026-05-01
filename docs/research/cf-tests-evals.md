# Cloudflare Agents — Tests & Evals Playbook

> Audience: senior engineer turning this into an LLM "skill" for production-grade Cloudflare Agents.
> Scope: every layer from pure functions through replay-driven model evals.
> All claims cited. Code samples are runnable shapes (TypeScript), not pseudocode.

---

## 1. The testing pyramid for a Cloudflare Agent

A Cloudflare Agent is a stateful Durable Object (DO) instance with persistent SQLite, optional WebSocket connections, alarms, schedules, and (often) outbound calls to LLM providers. That stack maps to a six-layer pyramid.

| # | Layer | What it catches | Tool |
|---|---|---|---|
| 1 | Pure-function unit tests | Logic bugs in helpers (parsers, formatters, prompt assembly, scoring) | `vitest` (Workers pool not strictly required, but use it for type+import parity) |
| 2 | DO behaviour tests via `runInDurableObject` | Bugs in instance methods, SQL state, sub-agent facets, internal invariants | `cloudflare:test` `runInDurableObject` |
| 3 | HTTP-level routing tests via `SELF` / `exports.default.fetch` | `routeAgentRequest` regressions, kebab-case naming, query-param passthrough, sub-paths, email routing | `cloudflare:workers` `exports.default.fetch` |
| 4 | WebSocket / hibernation tests | `onConnect` / `onMessage` flows, identity & state push, RPC over WS, malformed-message resilience | WS via `exports.default.fetch` + `Upgrade: websocket` |
| 5 | Alarm + schedule tests | `runDurableObjectAlarm`, scheduled callback execution, interval vs delayed vs cron, error-resilience | `cloudflare:test` `runDurableObjectAlarm` |
| 6 | Workflow tests | `step.do` flows, sleep skipping, mocked step results, error injection | `cloudflare:test` `introspectWorkflow` / `introspectWorkflowInstance` |
| 7 | Tool-call / LLM-mock tests | Deterministic responses from `env.AI`, fetch-based providers, tool dispatch | `vi.spyOn(env.AI, 'run')`, `MSW`, `globalThis.fetch` spy |
| 8 | LLM-in-the-loop evals | Real model output regressions, judge-scored quality, prompt drift | golden JSONL + judge model + Worker harness |
| 9 | Replay regressions from AIG | Real prod scenarios re-run on new model versions | AI Gateway Logs API + dataset eval |
| 10 | Cost + latency assertions | Per-request token, ms wall-clock, $ ceiling regressions | `vi` time + cost-tracker on AIG headers |

The first six layers are deterministic and run on every PR. The last four are model-in-the-loop and run on a slower cadence.

Source — testing entry point: <https://developers.cloudflare.com/agents/getting-started/testing-your-agent/>. Recommended harness: "We recommend using the Vitest integration, which allows you to run tests _inside_ the Workers runtime, and unit test individual functions within your Worker." (<https://developers.cloudflare.com/workers/testing/>).

---

## 2. Vitest pool setup (copy-pasteable)

### Install

```bash
npm i -D vitest@^4.1.0 @cloudflare/vitest-pool-workers
```

The pool requires Vitest 4.1 or later. Source: <https://developers.cloudflare.com/workers/testing/vitest-integration/get-started/>.

### `wrangler.jsonc`

This is the canonical shape used by `packages/agents/src/tests/wrangler.jsonc` in `cloudflare/agents`. Pull every flag — the Vitest runner needs the extra Node compat flags even though prod doesn't.

```jsonc
{
  "compatibility_date": "2026-01-28",
  "compatibility_flags": [
    "nodejs_compat",
    // Vitest runner needs these extra Node modules
    "enable_nodejs_tty_module",
    "enable_nodejs_fs_module",
    "enable_nodejs_http_modules",
    "enable_nodejs_perf_hooks_module",
    "enable_nodejs_v8_module",
    "enable_nodejs_process_v2"
  ],
  "main": "src/worker.ts",
  "durable_objects": {
    "bindings": [
      { "class_name": "MyAgent", "name": "MyAgent" },
      { "class_name": "TestStateAgent", "name": "TestStateAgent" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["MyAgent", "TestStateAgent"] }
  ],
  "ai": { "binding": "AI" },
  "vectorize": [{ "binding": "VECTORIZE", "index_name": "ideas" }]
}
```

Source: `gh api repos/cloudflare/agents/contents/packages/agents/src/tests/wrangler.jsonc`.

If you don't supply `compatibility_date`, Vitest infers the latest one — see `cloudflare/workers-sdk/fixtures/vitest-pool-workers-examples/durable-objects/wrangler.jsonc`: "don't provide compatibility_date so that vitest will infer the latest one."

### `vitest.config.ts`

```typescript
import path from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const testsDir = import.meta.dirname;

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: path.join(testsDir, "wrangler.jsonc") }
    })
  ],
  test: {
    name: "workers",
    include: [path.join(testsDir, "**/*.test.ts")],
    setupFiles: [path.join(testsDir, "setup.ts")],
    testTimeout: 10_000,
    deps: {
      // Some bundle-incompatible CJS deps need pre-optimization
      optimizer: { ssr: { include: ["ajv"] } }
    }
  }
});
```

Source: `cloudflare/agents/packages/agents/src/tests/vitest.config.ts`.

### `setup.ts` — the warm-up trick

The very first `exports.default.fetch()` triggers Vite to resolve the entire dep graph, which can take >10s and blow the test's 10s timeout in CI. Warm it up in `beforeAll`:

```typescript
import { afterAll, beforeAll } from "vitest";
import { exports } from "cloudflare:workers";

beforeAll(async () => {
  await exports.default.fetch("http://warmup/");
}, 30_000);

// Give DOs a moment to finish WebSocket close handlers before
// the module is invalidated between test files.
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)));
```

Source: `cloudflare/agents/packages/agents/src/tests/setup.ts`.

### `test/tsconfig.json`

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "moduleResolution": "bundler",
    "types": ["@cloudflare/vitest-pool-workers"]
  },
  "include": ["./**/*.ts", "../src/worker-configuration.d.ts"]
}
```

Source: <https://developers.cloudflare.com/workers/testing/vitest-integration/get-started/>.

### `package.json` scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "evals": "vitest run --config vitest.evals.config.ts",
    "types": "wrangler types"
  }
}
```

Note: native V8 coverage is not supported. Use Istanbul. Source: <https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/> ("Native code coverage via V8 is not supported. Use instrumented code coverage via Istanbul instead.").

### Auxiliary worker option (when you need a separate isolate)

If you need a second Worker (e.g. to test a downstream service binding), use the `miniflare.workers` array:

```typescript
cloudflareTest({
  miniflare: {
    compatibilityDate: "2024-01-01",
    compatibilityFlags: ["nodejs_compat", "service_binding_extra_handlers"],
    serviceBindings: { WORKER: "worker-under-test" },
    workers: [{
      name: "worker-under-test",
      modules: true,
      scriptPath: "./dist/index.js", // pre-built by globalSetup
      compatibilityDate: "2024-01-01",
      compatibilityFlags: ["nodejs_compat"]
    }]
  }
})
```

Source: `cloudflare/workers-sdk/fixtures/vitest-pool-workers-examples/basics-integration-auxiliary/vitest.config.ts`. Caveat (verbatim): "auxiliary Workers cannot load their configuration from `wrangler.toml` files, and must be configured with Miniflare `WorkerOptions`." Auxiliary workers also "cannot access the `cloudflare:test` module" — see <https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/>.

---

## 3. DO/Agent test cookbook (six worked examples)

All examples assume the `Agent` is registered as a DO binding in `wrangler.jsonc`. The `getAgentByName(env.MyAgent, "instance-name")` helper from the `agents` package returns a typed stub.

### a. Test a method on the Agent

Direct method invocation through the stub. The test runs in the Workers runtime; you call the agent's RPC methods like local async functions.

```typescript
// test/agent-method.test.ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getAgentByName } from "agents";

describe("CounterAgent", () => {
  it("persists count across stub re-acquisitions", async () => {
    const agent = await getAgentByName(env.CounterAgent, "user-42");

    expect(await agent.getCount()).toBe(0);
    await agent.increment(3);
    expect(await agent.getCount()).toBe(3);

    // Re-acquire stub; SQLite state survives
    const agent2 = await getAgentByName(env.CounterAgent, "user-42");
    expect(await agent2.getCount()).toBe(3);
  });
});
```

For *direct* access to instance fields and storage (testing private state), use `runInDurableObject`:

```typescript
import { runInDurableObject } from "cloudflare:test";
import type { CounterAgent } from "../src/agents/counter";

await runInDurableObject(stub, async (instance: CounterAgent, state) => {
  expect(instance.count).toBe(2);
  expect(await state.storage.get<number>("count")).toBe(2);
});
```

Source: `cloudflare/workers-sdk/fixtures/vitest-pool-workers-examples/durable-objects/test/direct-access.test.ts`. The runInDurableObject signature is `<O extends DurableObject, R>(stub, callback) => Promise<R>` — see <https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/>.

### b. Test a WebSocket flow (onConnect + onMessage)

Open a WS connection through `routeAgentRequest`, accept, send messages, and assert what comes back. The agents repo uses this exact pattern in `message-handling.test.ts`.

```typescript
// test/websocket.test.ts
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

async function connectWS(path: string) {
  const res = await exports.default.fetch(`http://example.com${path}`, {
    headers: { Upgrade: "websocket" }
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket as WebSocket;
  ws.accept();
  return ws;
}

function waitForMessage(ws: WebSocket, timeout = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), timeout);
    ws.addEventListener("message", (e: MessageEvent) => {
      clearTimeout(t);
      resolve(JSON.parse(e.data as string));
    }, { once: true });
  });
}

describe("CounterAgent over WebSocket", () => {
  it("emits identity then state on connect", async () => {
    const ws = await connectWS("/agents/counter-agent/room-1");
    const identity = await waitForMessage(ws);
    expect(identity.type).toBe("cf_agent_identity");
    expect(identity.name).toBe("room-1");
    expect(identity.agent).toBe("counter-agent");
    ws.close();
  });

  it("ignores malformed JSON without crashing", async () => {
    const ws = await connectWS("/agents/counter-agent/room-2");
    // skip initial identity/state/mcp_servers messages
    for (let i = 0; i < 3; i++) await waitForMessage(ws);

    ws.send("not json {{{");
    ws.send("{incomplete");

    // RPC still works — connection is alive
    const id = crypto.randomUUID();
    ws.send(JSON.stringify({ type: "rpc", id, method: "increment", args: [1] }));
    const reply = await waitForMessage(ws);
    expect(reply.id).toBe(id);
    expect(reply.success).toBe(true);
    ws.close();
  });
});
```

Source: `cloudflare/agents/packages/agents/src/tests/message-handling.test.ts` and `state.test.ts`.

**Critical caveat from the known-issues page:** "Using WebSockets with Durable Objects is not supported with per-file storage isolation. Workaround: Run tests with shared storage using `--max-workers=1 --no-isolate`." Source: <https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/>. Either run WS test files in a separate Vitest project with that flag, or split your `vitest.config.ts` into two `test.workspace` projects: `unit` (isolated) and `ws` (shared).

Always close the WebSocket on response in routing tests to prevent "WebSocketPipe was destroyed" log spam:

```typescript
function closeWs(res: Response) {
  if (res.webSocket) { res.webSocket.accept(); res.webSocket.close(); }
}
```

Source: `cloudflare/agents/packages/agents/src/tests/routing.test.ts`.

### c. Test scheduled tasks fire correctly

Schedules in the `agents` package are stored in the `cf_agents_schedules` SQLite table and dispatched via the DO alarm. To make them fire deterministically:

1. Create the schedule with the agent's `schedule()` method (or a helper).
2. Backdate the row so `runDurableObjectAlarm` considers it due.
3. Call `runDurableObjectAlarm(stub)` — it returns `true` if an alarm ran.

```typescript
// test/schedule.test.ts
import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getAgentByName } from "agents";
import type { TestScheduleAgent } from "./agents/schedule";

describe("scheduled callback fires", () => {
  it("invokes callback when alarm runs", async () => {
    const agent = await getAgentByName(env.TestScheduleAgent, "schedule-1");
    const id = await agent.createSchedule(60); // 60-sec delay

    // Backdate so the alarm is due now
    await runInDurableObject(agent, async (instance: TestScheduleAgent) => {
      const past = Math.floor(Date.now() / 1000) - 1;
      instance.sql`UPDATE cf_agents_schedules SET time = ${past} WHERE id = ${id}`;
    });

    expect(await runDurableObjectAlarm(agent)).toBe(true);

    // Verify callback executed (e.g. counter incremented)
    await runInDurableObject(agent, async (instance: TestScheduleAgent) => {
      expect(instance.intervalCallbackCount).toBeGreaterThan(0);
    });
  });

  it("interval schedule survives a throwing callback", async () => {
    const agent = await getAgentByName(env.TestScheduleAgent, "interval-throw");
    const scheduleId = await agent.createThrowingIntervalSchedule(1);

    await runDurableObjectAlarm(agent);

    // The interval row should NOT have been deleted (delayed schedules are; intervals are not)
    const stillThere = await agent.getStoredScheduleById(scheduleId);
    expect(stillThere).toBeDefined();
    expect(stillThere?.type).toBe("interval");

    await agent.cancelScheduleById(scheduleId);
  });
});
```

Source: `cloudflare/agents/packages/agents/src/tests/schedule.test.ts`. The "backdate via SQL" trick is verbatim from that file.

For Worker-level cron handlers (not DO), use `createScheduledController`:

```typescript
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src";

const controller = createScheduledController({
  scheduledTime: new Date(1000),
  cron: "30 * * * *"
});
const ctx = createExecutionContext();
await worker.scheduled(controller, env, ctx);
await waitOnExecutionContext(ctx);
```

Source: `cloudflare/workers-sdk/fixtures/vitest-pool-workers-examples/basics-unit-integration-self/test/scheduled-unit.test.ts`.

### d. Test the `alarm()` handler

```typescript
// test/alarm.test.ts
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { it, expect } from "vitest";
import { Counter } from "../src";

it("alarm resets counter", async ({ expect }) => {
  const id = env.COUNTER.newUniqueId();
  const stub = env.COUNTER.get(id);

  await runInDurableObject(stub, (instance: Counter) => {
    instance.increment(3);
    instance.scheduleReset(60_000);
  });

  let res = await stub.fetch("http://placeholder");
  expect(await res.text()).toBe("4");

  // Trigger the alarm manually
  expect(await runDurableObjectAlarm(stub)).toBe(true);

  res = await stub.fetch("http://placeholder");
  expect(await res.text()).toBe("1");

  // No alarm scheduled now → returns false
  expect(await runDurableObjectAlarm(stub)).toBe(false);
});
```

Source verbatim: `cloudflare/workers-sdk/fixtures/vitest-pool-workers-examples/durable-objects/test/alarm.test.ts`.

**Race-with-auto-alarm gotcha** (from `cloudflare/agents/packages/agents/src/tests/alarms.test.ts`): if your agent auto-schedules an alarm in `onStart`, clear it before invoking `runDurableObjectAlarm` manually so the manual call doesn't race the auto-fired one:

```typescript
await agentStub.clearStoredAlarm();
await agentStub.setStoredAlarm(Date.now() + 1000);
await runDurableObjectAlarm(agentStub);
```

### e. Test `routeAgentRequest` end-to-end via SELF

```typescript
// test/routing.test.ts
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

function closeWs(res: Response) {
  if (res.webSocket) { res.webSocket.accept(); res.webSocket.close(); }
}

describe("routeAgentRequest", () => {
  it("matches kebab-case URL to CamelCase class", async () => {
    // CounterAgent → counter-agent
    const res = await exports.default.fetch(
      "http://example.com/agents/counter-agent/room-1",
      { headers: { Upgrade: "websocket" } }
    );
    expect([101, 426]).toContain(res.status);
    closeWs(res);
  });

  it("returns 400 for unknown agent binding", async () => {
    const res = await exports.default.fetch(
      "http://example.com/agents/non-existent/room"
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for malformed paths", async () => {
    expect((await exports.default.fetch("http://example.com/agents/")).status).toBe(404);
    expect((await exports.default.fetch("http://example.com/agents")).status).toBe(404);
  });

  it("preserves query params", async () => {
    const res = await exports.default.fetch(
      "http://example.com/agents/counter-agent/room?k=v",
      { headers: { Upgrade: "websocket" } }
    );
    expect([101, 426]).toContain(res.status);
    closeWs(res);
  });
});
```

Source: `cloudflare/agents/packages/agents/src/tests/routing.test.ts`. WS responses can return 101 (upgraded) or 426 (upgrade required) depending on isolate state — accept either. `routeAgentRequest` returns null for non-WS requests, so plain GETs to an agent path 404 unless the agent exposes its own HTTP handler.

### f. Test SQL state migrations

Agents typically run schema migrations on first boot. Test that:
1. Old data is preserved.
2. CHECK constraints are upgraded.
3. The migration is idempotent.

```typescript
// test/migration.test.ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getAgentByName } from "agents";

describe("schedule schema migration", () => {
  it("old constraint rejects new types", async () => {
    const agent = await getAgentByName(env.MigratableAgent, "old-rejects");
    await agent.simulateOldSchema();

    const result = await agent.tryInsertIntervalOldColumns();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("CHECK constraint failed");
  });

  it("migration preserves existing data", async () => {
    const agent = await getAgentByName(env.MigratableAgent, "preserves");
    await agent.simulateOldSchema();
    expect(await agent.getScheduleCount()).toBe(1);

    await agent.runMigration();

    const row = await agent.getOldRow();
    expect(row?.id).toBe("test-old-row");
    expect(await agent.getScheduleCount()).toBe(1);
  });

  it("migration is idempotent", async () => {
    const agent = await getAgentByName(env.MigratableAgent, "idempotent");
    await agent.simulateOldSchema();
    await agent.runMigration();
    await agent.runMigration(); // second run is a no-op
    expect((await agent.tryInsertInterval()).ok).toBe(true);
  });
});
```

Source verbatim: `cloudflare/agents/packages/agents/src/tests/migration.test.ts`.

For D1 (not DO-internal SQLite), use `applyD1Migrations` in a setup file:

```typescript
// test/apply-migrations.ts
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Setup files run outside the per-test-file storage isolation, and may be run
// multiple times. `applyD1Migrations()` only applies migrations that haven't
// already been applied, so this is safe to call here.
await applyD1Migrations(env.DATABASE, env.TEST_MIGRATIONS);
```

Source verbatim: `cloudflare/workers-sdk/fixtures/vitest-pool-workers-examples/d1/test/apply-migrations.ts`.

---

## 4. Mocking the LLM

Three patterns in increasing order of fidelity. Choose by what your agent talks to.

### 4a. Workers AI binding (`env.AI`) — `vi.spyOn`

```typescript
import { vi } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src";

it("returns embedding from mocked AI binding", async () => {
  vi.spyOn(env.AI, "run").mockResolvedValue({
    shape: [1, 2],
    data: [[0, 0]]
  });

  const req = new Request("http://example.com/embed");
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);

  expect(await res.text()).toMatchInlineSnapshot(
    `"{"shape":[1,2],"data":[[0,0]]}"`
  );
});
```

Source verbatim: `cloudflare/workers-sdk/fixtures/vitest-pool-workers-examples/ai-vectorize/test/index.spec.ts`. The same pattern works for `env.VECTORIZE.upsert`, `env.QUEUE_PRODUCER.send`, etc.

```typescript
// Mocking a queue producer
const sendSpy = vi.spyOn(env.QUEUE_PRODUCER, "send")
  .mockImplementation(async () => ({
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0,
                            oldestMessageTimestamp: new Date(0) } }
  }));
// ... call worker
expect(sendSpy).toBeCalledWith({ key: "/key", value: "value" });
```

Source: `cloudflare/workers-sdk/fixtures/vitest-pool-workers-examples/queues/test/queue-producer-unit.test.ts`.

**Always** `vi.restoreAllMocks()` in `afterEach` so spies don't leak across tests.

### 4b. HTTP-based providers (OpenAI, Anthropic, etc.) — MSW

The `request-mocking` fixture uses [MSW](https://mswjs.io/) and Workers' built-in interceptor (`miniflare`'s `fetchMock`). MSW gives you declarative handlers; the imperative path is `vi.spyOn(globalThis, "fetch")`.

**Declarative (MSW):**

```typescript
// test/server.ts
import { setupServer } from "msw/node";
export const server = setupServer();

// test/setup.ts
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// test/anthropic.test.ts
import { http, HttpResponse } from "msw";
import { server } from "./server";
import { exports } from "cloudflare:workers";

it("sends a tool-call response", async () => {
  server.use(
    http.post("https://api.anthropic.com/v1/messages", async () => {
      return HttpResponse.json({
        id: "msg_test",
        content: [{ type: "tool_use", id: "tool_1", name: "search",
                    input: { query: "weather Paris" } }],
        stop_reason: "tool_use"
      });
    })
  );

  const res = await exports.default.fetch("http://example.com/chat", {
    method: "POST",
    body: JSON.stringify({ message: "weather in Paris?" })
  });
  expect(res.status).toBe(200);
});
```

Source: `cloudflare/workers-sdk/fixtures/vitest-pool-workers-examples/request-mocking/test/{server,setup,declarative}.test.ts`.

Note the `--once` semantics: by default MSW handlers expire after one match unless you call `.persist()` or use `{ once: true }` on a per-handler basis.

**Imperative (vitest spy):**

```typescript
import { vi } from "vitest";

vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
  const url = new URL(new Request(input, init).url);
  if (url.host === "api.openai.com" && url.pathname === "/v1/chat/completions") {
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "fixture answer" } }]
    }), { headers: { "content-type": "application/json" } });
  }
  throw new Error(`Unmocked fetch: ${url}`);
});
```

Source verbatim: `cloudflare/workers-sdk/fixtures/vitest-pool-workers-examples/request-mocking/test/imperative.test.ts`.

The imperative path also handles WebSocket upstreams — same fixture demonstrates a `WebSocketPair` mock for a fetched-WS provider.

### 4c. Deterministic tool-call traces

For testing the *agent loop* (model says X → tool runs → model says Y), pre-record the model's response sequence and step through it:

```typescript
class ScriptedLLM {
  constructor(private steps: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; name: string; input: any }
  >) {}
  responses(): typeof this.steps { return this.steps; }
  next() { return this.steps.shift(); }
}

// In test setup
const scripted = new ScriptedLLM([
  { type: "tool_use", name: "search", input: { q: "Paris weather" } },
  { type: "text", text: "It's 18°C and sunny in Paris." }
]);

vi.spyOn(env.AI, "run").mockImplementation(async () => {
  const step = scripted.next();
  if (!step) throw new Error("Script exhausted");
  return { /* shape it like the real AI binding response */ ...step };
});
```

This lets you assert *exactly* the tool sequence the agent emits, without any model variance. Use it for the deterministic tier of CI; save real-model runs for nightly evals.

### 4d. Mocking Workflow steps with `introspectWorkflow`

If your agent kicks off a Workflow, you can mock individual `step.do` results:

```typescript
import { introspectWorkflowInstance } from "cloudflare:test";

it("auto-approves on low violation score", async () => {
  const instanceId = crypto.randomUUID();

  await using instance = await introspectWorkflowInstance(env.MODERATOR, instanceId);
  await instance.modify(async (m) => {
    await m.disableSleeps();
    await m.mockStepResult({ name: "AI content scan" }, { violationScore: 0 });
  });

  await env.MODERATOR.create({ id: instanceId });

  expect(await instance.waitForStepResult({ name: "AI content scan" }))
    .toEqual({ violationScore: 0 });
  await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
  expect(await instance.getOutput()).toEqual({ status: "auto_approved" });
});
```

Source verbatim: `cloudflare/workers-sdk/fixtures/vitest-pool-workers-examples/workflows/test/unit.test.ts`. The `await using` syntax is critical — it disposes the introspector at scope exit; without it you must `try { ... } finally { await instance.dispose(); }`. You can also inject errors with `m.mockStepError({ name }, new Error("boom"), 2)` (the `2` retries-before-success).

`introspectWorkflow(env.MODERATOR)` (without instance ID) intercepts *all* subsequently-created instances — useful for HTTP-driven flows where you don't know the ID up front. Source: `cloudflare/workers-sdk/fixtures/vitest-pool-workers-examples/workflows/test/integration.test.ts`.

---

## 5. LLM-in-the-loop evals

Unit/integration tests prove the *plumbing*. Evals prove the *behaviour* with a real model in the loop. The harness shape:

### 5a. Golden set (JSONL)

```jsonl
{"id":"weather-paris","input":{"messages":[{"role":"user","content":"What's the weather in Paris?"}]},"expected":{"tools_called":["get_weather"],"tool_args":{"get_weather":{"city":"Paris"}},"final_contains":["Paris"]},"rubric":{"helpful":4,"correct_tool":5}}
{"id":"approval-gate","input":{"messages":[{"role":"user","content":"Calculate 5000*3 and email Alice"}]},"expected":{"tools_called":["calc","approval","send_email"],"requires_approval":true},"rubric":{"safety":5}}
```

Keep golden cases small (<200 typically). Each case has: stable `id`, the input the agent sees, *expected behaviour* (not expected text — text is judge-scored), and a per-criterion `rubric`.

### 5b. The harness — run inside a Worker so it has access to the agent under test

The eval is itself a Workers test, but configured separately so it doesn't run on every PR:

```typescript
// vitest.evals.config.ts
import path from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.evals.jsonc" } })],
  test: {
    name: "evals",
    include: ["evals/**/*.eval.ts"],
    testTimeout: 120_000, // model calls are slow
    setupFiles: ["evals/setup.ts"]
  }
});
```

`wrangler.evals.jsonc` differs from the unit-test config in that it *does* point at the real provider (no MSW, no `vi.spyOn`). Use a separate AI Gateway with eval-specific budgets and tags so prod metrics aren't polluted.

```typescript
// evals/agent.eval.ts
import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import { getAgentByName } from "agents";

interface Case {
  id: string;
  input: { messages: Array<{ role: string; content: string }> };
  expected: {
    tools_called?: string[];
    tool_args?: Record<string, unknown>;
    final_contains?: string[];
    requires_approval?: boolean;
  };
  rubric: Record<string, number>; // criterion → minimum-acceptable-score (1-5)
}

const cases: Case[] = (await fs.readFile("evals/golden.jsonl", "utf8"))
  .split("\n").filter(Boolean).map(l => JSON.parse(l));

async function runAgent(input: Case["input"]) {
  const agent = await getAgentByName(env.ChatAgent, `eval-${crypto.randomUUID()}`);
  const trace: { tools: string[]; tool_args: Record<string, unknown>; final: string } =
    { tools: [], tool_args: {}, final: "" };

  // Hook the agent's onToolCall observer (see packages/agents observability)
  await agent.runWithTrace(input, (event) => {
    if (event.type === "tool_call") {
      trace.tools.push(event.name);
      trace.tool_args[event.name] = event.args;
    } else if (event.type === "final_text") {
      trace.final = event.text;
    }
  });
  return trace;
}

async function judge(criterion: string, text: string, expected: unknown) {
  // Cheap-model judge call via env.AI; rubric: 1-5
  const out = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
    messages: [
      { role: "system", content: "You are a strict grader. Return JSON {score: 1-5, reason: string}." },
      { role: "user", content: `Criterion: ${criterion}\nExpected: ${JSON.stringify(expected)}\nActual: ${text}` }
    ],
    response_format: { type: "json_object" }
  });
  return JSON.parse((out as any).response) as { score: number; reason: string };
}

describe("Agent golden set", () => {
  for (const c of cases) {
    it(`[${c.id}] passes`, async () => {
      const trace = await runAgent(c.input);

      // Deterministic assertions
      if (c.expected.tools_called) {
        expect(trace.tools).toEqual(c.expected.tools_called);
      }
      if (c.expected.final_contains) {
        for (const s of c.expected.final_contains) {
          expect(trace.final).toContain(s);
        }
      }

      // Judge-scored assertions
      for (const [criterion, minScore] of Object.entries(c.rubric)) {
        const verdict = await judge(criterion, trace.final, c.expected);
        expect(verdict.score, `[${c.id}/${criterion}] ${verdict.reason}`)
          .toBeGreaterThanOrEqual(minScore);
      }
    }, 60_000);
  }
});
```

This shape gives you four scoring tiers per case:
1. **Hard pass/fail**: tool sequence equality, expected substrings.
2. **Judge-graded** (1-5): per-criterion, with a minimum threshold.
3. **Cost** (separately accumulated, see §10).
4. **Latency** (wall-clock, separately accumulated).

Aggregate per-case verdicts into a JSON report and post a comment on the PR (see §8).

### 5c. Judge-model choice

Cheaper-than-task model, but capable enough to compare. Workers AI's `@cf/meta/llama-3.1-8b-instruct` is a fine baseline. For higher-fidelity grading on hard rubrics, route the judge through AI Gateway to a stronger model and assert `verdict.score ≥ 4`.

### 5d. Regression vs first-time

Two different eval modes, both worth running:
- **Regression**: the *same* golden set against the *new* candidate (model version, prompt change, code change). Pass = no case slipped vs the last green run.
- **First-time**: probe novel cases harvested from prod (see §9). Pass = new behaviours don't violate any rubric.

Track per-case scores in `evals/baseline.json` checked into the repo. CI fails if any case drops below baseline by more than ε.

---

## 6. AI Gateway eval flow

### What you get from AIG

By default, AIG logs every request: "user prompts and model responses, provider and timestamp information, token usage and associated costs, request duration and status." Source: <https://developers.cloudflare.com/ai-gateway/observability/logging/>.

Per-request control headers:
- `cf-aig-collect-log: false` — skip this entry entirely.
- `cf-aig-collect-log-payload: false` — skip the prompt/response body, keep metadata.

### The eval feature (dashboard)

AIG's built-in evaluations: "Datasets are collections of logs stored for analysis." Create them by filtering logs in the dashboard, then running an evaluation. Available evaluator types are currently:
- **Cost** — average per-request cost across the dataset.
- **Speed** — average duration.
- **Performance via human feedback** — % thumbs-up on individual log entries.

Source: <https://developers.cloudflare.com/ai-gateway/evaluations/set-up-evaluations/> and <https://developers.cloudflare.com/ai-gateway/evaluations/add-human-feedback/>.

**Critical limitation**: "While datasets automatically update based on filters, evaluations do not. You will have to create a new evaluation if you want to evaluate new logs." Same source. Datasets use `AND` joins with one item per filter — not very expressive.

### When to use AIG evals vs DIY

| Use AIG evals | Use DIY harness |
|---|---|
| You want cost/speed regression tracking with zero code | You need behavioural assertions (tool sequence, content match) |
| Human raters thumb-up/down via dashboard | You need automated judge-scored rubrics |
| Quick ROI comparison across providers | You need per-PR pass/fail in CI |

In practice: AIG handles cost+speed dashboards; DIY handles correctness gating. Don't try to make AIG do both.

### Replay loop using the Logs API

The AIG logs UI supports filtering and CSV-style export; for programmatic replay, pull recent prod sessions, transform them into golden cases, and run them through your harness:

```typescript
// scripts/harvest-from-aig.ts (Node, runs in CI nightly)
const aigLogs = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai-gateway/gateways/${GATEWAY}/logs?per_page=100&direction=desc`,
  { headers: { Authorization: `Bearer ${process.env.CF_API_TOKEN}` } }
).then(r => r.json());

for (const log of aigLogs.result) {
  if (log.feedback === "negative" || log.success === false) {
    // Worth turning into a golden case
    appendToJsonl("evals/harvested.jsonl", {
      id: `prod-${log.id}`,
      input: { messages: log.request.messages },
      expected: { /* annotate manually before next run */ },
      rubric: { correctness: 4, helpful: 3 }
    });
  }
}
```

See §9 for the full feedback loop.

---

## 7. Determinism tactics

LLM evals can't be perfectly deterministic, but everything else can be.

### Time

Vitest's fake timers don't apply to KV/R2/cache simulators (verbatim known issue: "Cannot expire KV keys by advancing fake time"; <https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/>). For DO alarms, *don't* use fake timers — use `runDurableObjectAlarm()` to fire on demand and the SQL-backdating trick (§3c). For Workers AI/HTTP timing assertions, wrap in your own clock injection rather than relying on `vi.useFakeTimers()`.

### Random IDs

`crypto.randomUUID()` is the right primitive (it works in the Workers runtime and tests). For tests where the ID must be predictable, inject a generator into your agent constructor:

```typescript
class IdeatorAgent extends Agent<Env, State> {
  private genId: () => string = () => crypto.randomUUID();
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    if (env.TEST_FIXED_IDS) this.genId = makeSeededGenerator("test-seed");
  }
}
```

### Network

Default to `onUnhandledRequest: "error"` in MSW so any un-mocked outbound HTTP fails the test loudly. Source: `request-mocking/test/setup.ts`. For direct `vi.spyOn(globalThis, "fetch")`, throw on unmocked URLs.

### Snapshot-friendly outputs

For agent responses with timestamps, IDs, or model-version strings, use `toMatchInlineSnapshot` with property serializers:

```typescript
expect.addSnapshotSerializer({
  test: (v) => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v),
  print: () => '"<UUID>"'
});
expect(response).toMatchInlineSnapshot(`{
  "id": "<UUID>",
  "result": "ok"
}`);
```

### LLM determinism

Set `temperature: 0`, fixed `seed` (where the provider supports it — OpenAI does, Anthropic does not), and version-pin model IDs. Stash the model ID + provider response hash in the eval report so a flake is debuggable.

### `await` everything that touches storage

Verbatim known issue: "Always `await` all Promises that read or write to storage services. Use the `using` keyword when calling RPC methods returning non-primitive values. Consume entire response bodies from `fetch` or `R2.get()` operations." Source: <https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/>. The per-test-file storage isolation only works if the runner can settle all writes before resetting.

---

## 8. CI architecture

A four-tier matrix on GitHub Actions, each with different cadence:

| Tier | Trigger | Job | Cost ceiling |
|---|---|---|---|
| 1 — unit | every PR | `npm run test` (no WS, isolated storage) | $0 (fully mocked) |
| 2 — DO + integration | every PR | `vitest run --max-workers=1 --no-isolate` (the WS-compatible config) | $0 |
| 3 — LLM evals | nightly + manual | `npm run evals` against the real provider | budgeted, see below |
| 4 — cost tests | weekly | replay a pinned set against the current prod model, fail if `$ / case` regresses >10% | budgeted |

### Sample workflow

```yaml
# .github/workflows/test.yml
name: tests
on: [pull_request, push]
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run test -- --project workers
      - run: npm run test -- --project workers-ws --max-workers=1 --no-isolate

  evals:
    if: github.event_name == 'workflow_dispatch' || github.event.schedule
    runs-on: ubuntu-latest
    env:
      CF_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run evals
      - name: Compare to baseline
        run: node scripts/compare-evals.js evals/results.json evals/baseline.json
      - name: Comment on PR
        if: github.event_name == 'workflow_dispatch'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const report = fs.readFileSync('evals/report.md', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number, owner: context.repo.owner,
              repo: context.repo.repo, body: report
            });

on:
  schedule:
    - cron: "0 3 * * *"  # nightly evals
    - cron: "0 5 * * 1"  # weekly cost tests
  workflow_dispatch:
```

### Two Vitest projects (one config, two storage modes)

Because WS tests need shared storage but everything else benefits from isolation, run two Vitest projects:

```typescript
// vitest.workspace.ts
export default [
  { test: { name: "workers", include: ["test/!(ws-)*.test.ts"], pool: { workers: { isolatedStorage: true } } } },
  { test: { name: "workers-ws", include: ["test/ws-*.test.ts"], maxWorkers: 1, isolate: false } }
];
```

This is the practical workaround for the known issue: "Using WebSockets with Durable Objects is not supported with per-file storage isolation." Source: <https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/>.

### Eval budget enforcement

Have your eval harness emit a JSON report with cumulative cost from AIG response headers (`cf-aig-cost`). The `compare-evals.js` step asserts:
1. No case regressed below baseline.
2. `total_cost_usd ≤ budget`.
3. `p95_latency_ms ≤ budget`.

Fail loudly. Don't silently amortize.

---

## 9. Production telemetry → eval feedback loop

The bottom of the pyramid is a closed loop: prod sessions become golden cases, which gate future PRs.

```
[prod traffic]
   │
   ▼
[AI Gateway logs]  ──────────────►  [classification script]
   │                                       │
   │ filter: cost spike, error,            │ tag: novel, regression-risk, gold-candidate
   │ negative human feedback,              │
   │ tool-loop, slow                       ▼
   │                              [evals/harvested.jsonl]
   │                                       │
   ▼                                       ▼
[manual review]  ◄──── batch UI ──── [LLM-assisted dedupe]
   │
   ▼
[evals/golden.jsonl]  ────►  [nightly eval run]  ────►  [baseline.json]
                                       │
                                       ▼
                          [PR check: no case below baseline]
```

### Concrete pipeline

1. **Classify** logs hourly (Worker cron):
   ```typescript
   // worker.ts (cron handler)
   async scheduled(controller, env, ctx) {
     const since = controller.scheduledTime - 3600_000;
     const logs = await aigClient.logs({ since, perPage: 1000 });
     for (const l of logs) {
       const tags: string[] = [];
       if (l.cost_usd > P95_COST) tags.push("cost-spike");
       if (l.feedback === "negative") tags.push("user-flagged");
       if (l.duration_ms > P95_LATENCY) tags.push("slow");
       if (tags.length > 0) await env.HARVEST_KV.put(l.id, JSON.stringify({ ...l, tags }));
     }
   }
   ```
2. **Dedupe** with a cheap embedding pass — don't add 100 near-identical "weather Paris" cases.
3. **Annotate** in a small UI (or ask Claude to draft `expected` + `rubric`, human approves).
4. **Promote** approved cases to `evals/golden.jsonl`; bump `baseline.json` only after a clean run.

### Local replay

Capture a real session with `cf-aig-tag: replay-candidate` set on the request. In dev:

```typescript
// scripts/replay.ts
const log = await aigClient.getLog(LOG_ID);
const agent = await getAgentByName(env.ChatAgent, `replay-${LOG_ID}`);
const trace = await agent.runWithTrace(log.request, (e) => console.log(e));
```

This runs the *same* prompt against your local agent build, with full trace, so you can step through what changed.

---

## 10. Gotchas

A consolidated list of the traps documented across the Cloudflare docs and observed in the `cloudflare/agents` test suite.

### 10a. Vitest pool known issues (verbatim from <https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/>)

1. **Native V8 coverage not supported** — use Istanbul.
2. **Vitest fake timers don't apply to KV, R2, cache simulators** — can't expire KV keys by advancing fake time.
3. **Dynamic `import()` doesn't work inside `export default { ... }` handlers** with `exports.default.fetch()`, or inside DO event handlers. Use static imports.
4. **WebSockets + DOs require shared storage** — run with `--max-workers=1 --no-isolate`. The pyramid in §8 splits this into a second Vitest project.
5. **Per-test-file storage isolation** undoes writes at file end. Always `await` storage promises; consume entire response bodies; use `using` for non-primitive RPC returns.
6. **Missing `ctx.exports` properties** with virtual modules / wildcard re-exports — set `additionalExports` in pool config.
7. **Module resolution errors** ("Cannot use require() to import an ES Module") — bundle with `deps.optimizer.ssr`.
8. **Global setup runs in Node** — wrap workerd-specific imports through Vite's SSR module loader.

### 10b. Isolation surprises

Per <https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/>: storage isolation is *per test file*, not per `it()`. If you need fresh state inside a file, manually `await stub.destroy()` or use a fresh agent instance name per test. Workers and module caches are *reused* across test runs where feasible — Vitest selectively invalidates based on modified files, so cold-start regressions can hide between files.

### 10c. Alarm timing

Two pitfalls:
- The agent's auto-scheduled alarm can race with manual `runDurableObjectAlarm`. Clear and re-set before the manual fire (§3d).
- Schedules with `delay: 0` can fire automatically before your test gets to the manual trigger. Use a future delay (e.g. 86400) for the *creation*, then SQL-backdate before `runDurableObjectAlarm` (§3c).

### 10d. WebSocket lifecycle

- Always `ws.accept()` after upgrade; tests fail silently otherwise.
- Always `ws.close()` (or `closeWs(res)`) at the end of each test or you get "WebSocketPipe was destroyed" log noise and the runtime occasionally hangs the suite.
- WS responses can return either 101 (upgraded) or 426 (upgrade required) depending on isolate state — assert `expect([101, 426]).toContain(res.status)`. Source: `cloudflare/agents/packages/agents/src/tests/routing.test.ts`.
- Hibernation: agents that `keepAlive()` won't hibernate during tests, but stale `keepAlive` refs (e.g. a thrown callback that didn't decrement) will leak across tests. Use `keepAliveWhile(fn)` which is finally-clause safe — see `cloudflare/agents/packages/agents/src/tests/keep-alive.test.ts`.

### 10e. Env binding mocking

`vi.spyOn(env.AI, "run")` works because `env.AI` is the actual Workers AI binding object — *but* it persists across tests within a file unless you `vi.restoreAllMocks()` in `afterEach`. Forgetting this is the #1 source of flake-by-leak in agent suites. Source pattern: `request-mocking/test/imperative.test.ts` (`afterEach(() => vi.restoreAllMocks())`).

### 10f. `routeAgentRequest` returns null for non-WS

Plain GETs to `/agents/<name>/<instance>` 404 unless the agent itself exposes an HTTP handler. If you want HTTP-only agents, route through `routeAgentEmail` or a custom prefix. Source: `cloudflare/agents/packages/agents/src/tests/routing.test.ts` (verbatim: "routeAgentRequest returns null for non-WebSocket requests, falling through to 404").

### 10g. Workflow introspector disposal

`introspectWorkflowInstance` and `introspectWorkflow` *must* be disposed. Use `await using` (TC39 explicit resource management) or wrap in `try { ... } finally { await instance.dispose(); }`. Forgetting leaks Workflow state across tests. Source: `cloudflare/workers-sdk/fixtures/vitest-pool-workers-examples/workflows/test/{unit,integration}.test.ts` ("Workflow introspector should be disposed the end of each test, if no `await using` syntax is used").

### 10h. Auxiliary workers can't use `cloudflare:test`

Per <https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/>: workers in the `miniflare.workers` array "must be pre-compiled to JavaScript" and "cannot access the `cloudflare:test` module." If you need test APIs in a second worker, restructure so the *test runner worker* drives both — auxiliary workers are for "downstream service" simulation only.

### 10i. `compatibility_date` and Node compat flags

The test runner needs more Node modules than prod typically does. Always include the Vitest-specific Node compat flags in your test wrangler:

```jsonc
"compatibility_flags": [
  "nodejs_compat",
  "enable_nodejs_tty_module",
  "enable_nodejs_fs_module",
  "enable_nodejs_http_modules",
  "enable_nodejs_perf_hooks_module",
  "enable_nodejs_v8_module",
  "enable_nodejs_process_v2"
]
```

Source: `cloudflare/agents/packages/agents/src/tests/wrangler.jsonc`. Forgetting any one of these throws cryptic "module not found" errors deep in the runner.

### 10j. Cost regressions are silent unless asserted

AI Gateway logs cost, but unit tests don't. If a prompt change doubles your token bill, only the weekly cost test (Tier 4 in §8) catches it. Always assert per-case `cost_usd ≤ budget` in evals — use the AIG response header `cf-aig-cost` or count tokens at the SDK layer.

### 10k. Eval flake budget

Even with `temperature: 0`, providers don't guarantee determinism. Set `EVAL_RETRIES=2` for judge-scored cases; fail only if both retries miss the rubric threshold. Distinguish *flakes* (one fail in N retries) from *regressions* (consistent failures) in your report.

---

## Source index

Primary docs:
- <https://developers.cloudflare.com/agents/getting-started/testing-your-agent/> — entry point.
- <https://developers.cloudflare.com/workers/testing/> — overall testing landing.
- <https://developers.cloudflare.com/workers/testing/vitest-integration/> — pool overview.
- <https://developers.cloudflare.com/workers/testing/vitest-integration/get-started/> — install + canonical example.
- <https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/> — `cloudflareTest` options, miniflare/wrangler/main/auxiliary.
- <https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/> — `runInDurableObject`, `runDurableObjectAlarm`, `listDurableObjectIds`, `applyD1Migrations`, `createMessageBatch`, `getQueueResult`, `createScheduledController`, `introspectWorkflow{Instance}`.
- <https://developers.cloudflare.com/workers/testing/vitest-integration/recipes/> — links to 19 fixture examples.
- <https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/> — per-test-file storage, `--no-isolate` for shared.
- <https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/> — every gotcha verbatim.
- <https://developers.cloudflare.com/workers/testing/miniflare/> — underlying simulator.
- <https://developers.cloudflare.com/workers/testing/integration-testing/>, <https://developers.cloudflare.com/workers/testing/unit-testing/> — high-level patterns.
- <https://developers.cloudflare.com/ai-gateway/observability/logging/> — Logs API + per-request control headers.
- <https://developers.cloudflare.com/ai-gateway/evaluations/> — overview.
- <https://developers.cloudflare.com/ai-gateway/evaluations/set-up-evaluations/> — datasets, evaluator types, run flow.
- <https://developers.cloudflare.com/ai-gateway/evaluations/add-human-feedback/> — thumbs up/down → eval metric.

GitHub source patterns inspected (via `gh api`):
- `cloudflare/agents/packages/agents/src/tests/vitest.config.ts` — production-grade test config.
- `cloudflare/agents/packages/agents/src/tests/wrangler.jsonc` — full DO bindings + compat flags.
- `cloudflare/agents/packages/agents/src/tests/setup.ts` — warm-up trick, async teardown.
- `cloudflare/agents/packages/agents/src/tests/alarms.test.ts` — alarm-init race handling.
- `cloudflare/agents/packages/agents/src/tests/schedule.test.ts` — SQL-backdate trick, interval vs delayed schedules.
- `cloudflare/agents/packages/agents/src/tests/routing.test.ts` — kebab-case URL → CamelCase class, 101/426 dual-accept.
- `cloudflare/agents/packages/agents/src/tests/state.test.ts` — `connectWS` + `waitForMessage` helpers.
- `cloudflare/agents/packages/agents/src/tests/migration.test.ts` — schema migration cookbook (idempotent, preserve data, fix CHECK).
- `cloudflare/agents/packages/agents/src/tests/message-handling.test.ts` — malformed JSON, RPC over WS.
- `cloudflare/agents/packages/agents/src/tests/sub-agent.test.ts` — sub-agent / facet RPC, abort-and-restart.
- `cloudflare/agents/packages/agents/src/tests/keep-alive.test.ts` — `keepAliveWhile` ref-count semantics.
- `cloudflare/agents/packages/agents/src/tests/observability.test.ts` — channel-routing event subscription tests.
- `cloudflare/agents/packages/agents/src/tests/email-routing.test.ts` — `ForwardableEmailMessage` mocking, address-based resolver.
- `cloudflare/workers-sdk/fixtures/vitest-pool-workers-examples/durable-objects/{src,test}` — alarm, direct-access, sqlite.
- `cloudflare/workers-sdk/fixtures/vitest-pool-workers-examples/request-mocking/test` — MSW + imperative `vi.spyOn(globalThis, "fetch")`.
- `cloudflare/workers-sdk/fixtures/vitest-pool-workers-examples/d1` — `applyD1Migrations` setup pattern.
- `cloudflare/workers-sdk/fixtures/vitest-pool-workers-examples/queues/test/queue-{producer,consumer}-unit.test.ts` — `createMessageBatch`, `getQueueResult`, mocked `env.QUEUE_PRODUCER.send`.
- `cloudflare/workers-sdk/fixtures/vitest-pool-workers-examples/workflows/test/{unit,integration}.test.ts` — `introspectWorkflowInstance` + `introspectWorkflow`, `mockStepResult`, `mockStepError`, `await using` disposal.
- `cloudflare/workers-sdk/fixtures/vitest-pool-workers-examples/ai-vectorize/test/index.spec.ts` — `vi.spyOn(env.AI, "run")`, `vi.spyOn(env.VECTORIZE, "upsert")`.
- `cloudflare/workers-sdk/fixtures/vitest-pool-workers-examples/basics-{unit-integration-self,integration-auxiliary}` — SELF vs `exports.default.fetch` vs auxiliary worker.

End of brief.
