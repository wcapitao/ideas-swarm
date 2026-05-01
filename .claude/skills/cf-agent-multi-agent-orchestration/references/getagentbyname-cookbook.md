# `getAgentByName` cookbook

Everything you need to address a sibling agent and call it correctly.

## Signature

```typescript
import { getAgentByName } from "agents";

const stub = await getAgentByName<Env, MyAgent>(
  namespace: DurableObjectNamespace<MyAgent>,
  name: string,
  options?: {
    locationHint?: "wnam" | "enam" | "sam" | "weur" | "eeur" | "apac" | "oc" | "afr" | "me";
    jurisdiction?: "eu" | "fedramp";
    props?: Record<string, unknown>;
  },
): Promise<DurableObjectStub<MyAgent>>;
```

Returns a typed `DurableObjectStub<T>`. The stub speaks DO RPC to that specific instance.

## Naming patterns

The string you pass as `name` is the only thing that addresses the instance. Same string ⇒ same DO forever.

| Pattern | Use case |
|---|---|
| `\`user-${userId}\`` | Per-user agent (most common). |
| `\`task-${taskId}\`` | Per-task ephemeral agent. |
| `roomId` (raw) | Shared room — many users, one DO. |
| `"global"` or `"default"` | Singleton. |
| `\`tenant-${tenantId}-user-${userId}\`` | Multi-tenant with user isolation. |
| `\`${a}-${b}\`` (a < b) | Symmetric pair (e.g. chess game between two users) — sort to canonicalize. |

**Anti-patterns:**
- `crypto.randomUUID()` for an agent the caller will need to find again. The next call won't know the name.
- Mutable IDs (e.g. user's email when they can change it). Bind to immutable IDs.
- Names with sensitive data — names show up in logs and `static options = { sendIdentityOnConnect: false }` is the only way to keep them off the wire to clients.

## Calling methods

`@callable()` is **not** required server-to-server. Plain methods on the DO class are addressable via the stub.

```typescript
// In MyAgent
export class MyAgent extends Agent<Env, State> {
  async investigate(query: string): Promise<Findings> {
    // ...
    return findings;
  }
}

// In another agent or Worker
const stub = await getAgentByName(env.MyAgent, "task-123");
const findings = await stub.investigate("research X");  // typed as Findings
```

Use `@callable()` only when **clients** (browser, mobile) call the method over WebSocket.

## RPC vs HTTP between agents

| | DO RPC (`stub.method(args)`) | HTTP (`stub.fetch(req)`) |
|---|---|---|
| Type safety | Yes | No (parse Response yourself) |
| Serialization cost | Structured clone (fast) | JSON serialize + parse |
| Streaming | Returns once | Can stream a `Response` body |
| Headers / cookies | No first-class | Yes |
| Best for | Internal calls, typed APIs | Forwarding browser HTTP, SSE relay |

**Default to RPC.** Reach for `fetch()` only when you need to forward a real HTTP request (e.g. an authentication redirect handed off to a sub-agent).

## Passing `props`

`props` is the canonical way to give the target agent context that **isn't** part of its persisted state. Think: caller identity, request-scoped flags, parent agent name.

```typescript
const stub = await getAgentByName(env.ResearchAgent, taskId, {
  props: {
    parentAgentName: this.name,
    parentAgentClass: "ChatSupervisor",
    userId: this.props.userId,  // forward the user
    ragId: env.RAG_ID,
  },
});
```

Inside the target:
```typescript
export class ResearchAgent extends Agent<Env, State> {
  async investigate(query: string) {
    const userId = this.props.userId;  // available everywhere
    const parent = this.props.parentAgentName;
    // ...
  }
}
```

`props` are not persisted — they exist only for the lifetime of the call/connection. For persisted context, use `setState`.

## locationHint and jurisdiction

- `locationHint` is a region pin **at first creation only**. Once the DO exists, its location is fixed.
- `jurisdiction: "eu"` keeps the DO in EU data centres for GDPR. `"fedramp"` for US gov compliance.

If you call `getAgentByName(env.X, "user-42", { locationHint: "weur" })` and the DO already exists in `enam`, the hint is ignored.

## Cross-agent error handling

Errors from RPC propagate as exceptions:

```typescript
try {
  const result = await stub.investigate(query);
} catch (err) {
  // err is the original error from the target DO, with stack trace
  console.error("research failed", err);
  // Decide: retry, fall back, or surface to user
}
```

If the target DO crashes mid-call, you get a `DurableObjectError`. Cloudflare doesn't auto-retry RPCs; you do.

## Call patterns to memorize

### Singleton helper
```typescript
const judge = await getAgentByName(this.env.Judge, "global");
const score = await judge.score(thing);
```

### Per-user
```typescript
const userAgent = await getAgentByName(this.env.UserAgent, `user-${userId}`);
```

### Forwarding HTTP
```typescript
async onRequest(request: Request) {
  const session = await this.getSession(request);
  const target = await getAgentByName(this.env.UserAgent, session.userId);
  return target.fetch(request);
}
```

### Worker → agent (queue consumer)
```typescript
export default {
  async queue(batch, env) {
    for (const msg of batch.messages) {
      const supervisor = await getAgentByName(env.Supervisor, msg.body.supervisorName);
      await supervisor.notifyDone(msg.body.jobId, result);
    }
  },
};
```

### Workflow → agent
```typescript
await step.do("send-welcome", async () => {
  const m = await getAgentByName(this.env.MessengerAgent, "global");
  return m.send({ userId, template: "welcome" });
});
```

## Subrequest budget

Every cross-agent call counts as one Worker subrequest:

| Tier | Subrequests / request |
|---|---|
| Free | 50 |
| Paid | 1,000 |

If your supervisor wants to fan out to 200 agents on free tier, it dies. Use a Queue (one `sendBatch` is one subrequest, no matter how many messages).

## Discovery and binding

For **plain peer agents** (not parent/child), each agent class needs its own `durable_objects.bindings` entry in `wrangler.jsonc`:

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "class_name": "ChatSupervisor", "name": "ChatSupervisor" },
      { "class_name": "ResearchAgent",  "name": "ResearchAgent"  },
      { "class_name": "JudgeAgent",     "name": "JudgeAgent"     }
    ]
  },
  "migrations": [
    { "new_sqlite_classes": ["ChatSupervisor", "ResearchAgent", "JudgeAgent"], "tag": "v1" }
  ]
}
```

For **SDK sub-agents** (`agentTool`, `runAgentTool`), only the parent needs a binding — children are auto-discovered via `ctx.exports`.

## When to skip `getAgentByName` entirely

- **Same DO, internal state** → just access `this.state`, no RPC needed.
- **Tool call to an external API** → that's a tool, not an agent. Use `cf-agent-tools-and-mcp`.
- **MCP server inside same Worker** → use `RPCServerTransport` (see `examples/mcp-rpc-transport`), no DO RPC.
