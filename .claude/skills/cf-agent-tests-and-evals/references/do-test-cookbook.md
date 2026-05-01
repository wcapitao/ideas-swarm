# DO/Agent test cookbook

Six worked tests every Cloudflare Agent needs. Copy, adapt to your shape.

## 1. Test an Agent method directly

The simplest tier — drives the agent's instance methods inside the test runtime, no HTTP.

```ts
import { env, runInDurableObject } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("MyAgent.greet", () => {
  it("appends to history", async () => {
    const id = env.AGENT.idFromName("user-1");
    const stub = env.AGENT.get(id);
    await runInDurableObject(stub, async (instance) => {
      await instance.greet("hello");
      expect(instance.state.history).toContain("hello");
    });
  });

  it("rejects empty input", async () => {
    const stub = env.AGENT.get(env.AGENT.idFromName("user-2"));
    await runInDurableObject(stub, async (instance) => {
      await expect(instance.greet("")).rejects.toThrow(/empty/);
    });
  });
});
```

## 2. Test a WebSocket flow (onConnect → onMessage → broadcast)

Lives in `test/ws/` (the `--no-isolate` workspace). Without that workspace, multi-connection tests fail with isolation errors.

```ts
import { connectWS, waitForMessage } from "../../.claude/skills/cf-agent-tests-and-evals/scripts/ws-test-helpers";
import { describe, it, expect } from "vitest";

describe("MyAgent WS", () => {
  it("ping triggers state broadcast", async () => {
    const ws = await connectWS(null, "/agents/MyAgent/user-1");
    ws.send(JSON.stringify({ type: "ping" }));
    const msg = await waitForMessage(ws, (m: any) => m.type === "state");
    expect((msg as any).state.lastPing).toBeDefined();
    ws.close();
  });

  it("broadcasts to all connected clients on state change", async () => {
    const a = await connectWS(null, "/agents/MyAgent/u1");
    const b = await connectWS(null, "/agents/MyAgent/u1");

    a.send(JSON.stringify({ type: "setTopic", topic: "stoicism" }));

    const fromA = await waitForMessage(a, (m: any) => m.state?.topic);
    const fromB = await waitForMessage(b, (m: any) => m.state?.topic);
    expect((fromA as any).state.topic).toBe("stoicism");
    expect((fromB as any).state.topic).toBe("stoicism");
    a.close(); b.close();
  });
});
```

## 3. Test scheduled task firing

The trick: schedule with a real delay, then SQL-backdate the row to make it overdue, then trigger the alarm.

```ts
import { env, runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { describe, it, expect } from "vitest";

it("scheduled callback fires", async () => {
  const stub = env.AGENT.get(env.AGENT.idFromName("u1"));

  // Schedule with delay; row is created in cf_agents_schedules
  await runInDurableObject(stub, async (instance) => {
    await instance.schedule(60, "onTick", { msg: "boom" });
  });

  // Backdate the schedule row so the next alarm tick treats it as overdue.
  await runInDurableObject(stub, async (_inst, state) => {
    state.storage.sql.exec(
      "UPDATE cf_agents_schedules SET fire_at = ? WHERE callback = ?",
      Date.now() - 1000, "onTick"
    );
  });

  // Trigger
  const ran = await runDurableObjectAlarm(stub);
  expect(ran).toBe(true);

  // Assert the side effect (e.g., a row in `events` from onTick)
  await runInDurableObject(stub, (instance) => {
    const ev = instance.sql<{ msg: string }>`SELECT msg FROM events ORDER BY id DESC LIMIT 1`.first();
    expect(ev?.msg).toBe("boom");
  });
});
```

## 4. Test the alarm() handler

Direct alarm test — bypasses `schedule()` entirely.

```ts
import { env, runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";

it("alarm processes pending work", async () => {
  const stub = env.AGENT.get(env.AGENT.idFromName("u1"));

  await runInDurableObject(stub, async (instance) => {
    instance.ctx.storage.put("pending", ["a", "b", "c"]);
    instance.ctx.storage.setAlarm(Date.now());
  });

  const ran = await runDurableObjectAlarm(stub);
  expect(ran).toBe(true);   // false would indicate no alarm was set

  await runInDurableObject(stub, async (instance) => {
    const remaining = await instance.ctx.storage.get("pending");
    expect(remaining).toEqual([]);
  });
});
```

## 5. Test `routeAgentRequest` end-to-end via SELF.fetch

```ts
import { SELF } from "cloudflare:test";

it("routes WS upgrade to the right agent", async () => {
  const r = await SELF.fetch("https://test/agents/MyAgent/u1", {
    headers: { Upgrade: "websocket", "Sec-WebSocket-Version": "13" }
  });
  // The pool may return either 101 (WS accepted) or 426 (upgrade required) —
  // accept both as "the route matched".
  expect([101, 426]).toContain(r.status);
});

it("returns 404 for unknown agent class", async () => {
  const r = await SELF.fetch("https://test/agents/Bogus/x");
  expect(r.status).toBe(404);
});

it("case-insensitive on the class segment", async () => {
  const r = await SELF.fetch("https://test/agents/myagent/u1");
  expect([200, 101, 426]).toContain(r.status);
});
```

## 6. Test SQL state migration

State migrations are application-level, run idempotently in `onStart`. Test that they ran and that the schema is current.

```ts
import { env, runInDurableObject } from "cloudflare:test";

it("v2 migration adds the topic column", async () => {
  const stub = env.AGENT.get(env.AGENT.idFromName("schema-test"));

  // First call triggers onStart, which runs migrations
  await runInDurableObject(stub, (instance) => instance.greet("hi"));

  await runInDurableObject(stub, (instance) => {
    const cols = instance.ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(messages)").toArray();
    const names = cols.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(["id", "ts", "role", "body", "topic"]));
  });
});

it("migration is idempotent on a hot DO", async () => {
  const stub = env.AGENT.get(env.AGENT.idFromName("idem-test"));
  await runInDurableObject(stub, (i) => i.greet("a"));
  await runInDurableObject(stub, (i) => i.greet("b"));   // re-runs onStart logic
  await runInDurableObject(stub, (i) => i.greet("c"));   // again
  // No throw = idempotent.
});
```

## Tier-by-tier coverage targets

| Tier | Coverage target |
|---|---|
| 1 | 100% of pure functions |
| 2 | Every Agent method called by tools |
| 3 | Every state migration |
| 4 | Every routed path |
| 5 | One representative WS flow per agent class |
| 6 | Every alarm handler |
| 7 | One test per `schedule()` callback name |
| 8 | One test per `step.do` activity |
| 9 | At least 5 golden conversations per agent |
| 10 | One regression case per prod incident |
