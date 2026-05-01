# Class Selection — `Agent` / `AIChatAgent` / `McpAgent` / `WorkflowEntrypoint` / `createMcpHandler`

Per base class: when to use, when NOT to use, minimal example,
required packages, required wrangler bindings.

All examples use SQLite-backed DOs (`new_sqlite_classes` — catalog #3,
cf-runtime-primitives §5) and `nodejs_compat`.

---

## `AIChatAgent` (from `@cloudflare/ai-chat`)

The canonical chat base. Use for any browser chat UX.

### When to use

- Chat UI in the browser (single user, single conversation).
- Persisted message history with a max-size cap.
- Streaming LLM responses with tool calls.
- Resume after disconnect (`chatRecovery: true`).
- AI SDK v5+ as the LLM bridge.

### When NOT to use

- No chat UX → use `Agent`.
- MCP server (tools for an MCP client) → use `McpAgent` or `createMcpHandler`.
- Long durable pipelines → use `WorkflowEntrypoint` (compose with AIChatAgent if user-facing).
- The deprecated `agents/ai-chat-agent` shim — **always** import from `@cloudflare/ai-chat` (catalog #9, cf-github-canon §6).

### Packages

```
agents @cloudflare/ai-chat ai workers-ai-provider zod
@cloudflare/vite-plugin (dev)
```

### Wrangler bindings

```jsonc
{
  "compatibility_date": "2026-03-02",
  "compatibility_flags": ["nodejs_compat"],
  "ai": { "binding": "AI" },
  "durable_objects": {
    "bindings": [{ "class_name": "ChatAgent", "name": "ChatAgent" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ChatAgent"] }]
}
```

### Minimal example (~30 lines)

```ts
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { createWorkersAI } from "workers-ai-provider";
import { convertToModelMessages, pruneMessages, stepCountIs, streamText } from "ai";
import { routeAgentRequest } from "agents";

export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;
  chatRecovery = true;

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const result = streamText({
      model: workersai("@cf/meta/llama-4-scout-17b-16e-instruct", {
        // AI Gateway in front of every call (catalog #5)
        gateway: { id: this.env.AIG_ID },
      }),
      system: "You are a helpful assistant.",
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
      }),
      stopWhen: stepCountIs(5),
      abortSignal: options?.abortSignal,        // mandatory — cf-agents-core §9
    });
    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(req, env) {
    return (await routeAgentRequest(req, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

---

## `Agent` (generic, from `agents`)

The generic class. Use for everything that isn't pure chat / pure MCP /
pure workflow.

### When to use

- Custom protocol over WebSocket (game, room, voice, collab editor).
- Webhook/email handler.
- Headless agent invoked over RPC by other Workers.
- Per-room/per-doc DO with custom state.
- Sub-agent target (children always extend `Agent`).

### When NOT to use

- Browser chat → `AIChatAgent`.
- MCP server → `McpAgent` (or `createMcpHandler` if stateless).
- > 30s wall-clock pipeline that must retry per step → `WorkflowEntrypoint`.

### Packages

```
agents
@cloudflare/vite-plugin (dev)
```

### Wrangler bindings

```jsonc
{
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [{ "class_name": "RoomAgent", "name": "RoomAgent" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["RoomAgent"] }]
}
```

### Minimal example (~30 lines)

```ts
import { Agent, callable, getAgentByName, routeAgentRequest } from "agents";

type State = { players: string[]; turn: number };

export class RoomAgent extends Agent<Env, State> {
  initialState: State = { players: [], turn: 0 };

  async onStart() {
    // Idempotent table + idempotent recurring tick (runs on every wake).
    this.sql`CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, ts INTEGER, body TEXT)`;
    await this.scheduleEvery(60, "heartbeat", undefined, { _idempotent: true } as any);
  }

  async heartbeat() {
    this.broadcast(JSON.stringify({ type: "heartbeat", ts: Date.now() }));
  }

  @callable() async join(player: string) {
    this.setState({ ...this.state, players: [...this.state.players, player] });
    return this.state.players.length;
  }
}

export default {
  async fetch(req, env) {
    return (await routeAgentRequest(req, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

---

## `McpAgent` (from `agents/mcp`)

Stateful MCP server. Tools have access to per-session state via
`this.state` / `this.sql` and OAuth user props via `this.props`.

### When to use

- Exposing tools to MCP clients (Claude Desktop, Cursor, ChatGPT) AND
  the tools need per-session state (auth tokens, counters, cached
  context, persisted history).
- MCP Resources, Prompts, or Elicitation (`this.elicitInput()`).
- OAuth-protected tools that read identity from `this.props`.

### When NOT to use

- Pure functions, no per-session state → `createMcpHandler` (cheaper, no DO).
- Browser chat with tools → `AIChatAgent` + tools in `onChatMessage`.

### Packages

```
agents @modelcontextprotocol/sdk zod
@cloudflare/workers-oauth-provider (for OAuth)
@cloudflare/vite-plugin (dev)
```

### Wrangler bindings

```jsonc
{
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [{ "class_name": "MyMCP", "name": "MyMCP" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["MyMCP"] }]
}
```

### Minimal example (~30 lines)

```ts
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type State = { count: number };
type Props = { username: string };

export class MyMCP extends McpAgent<Env, State, Props> {
  server = new McpServer({ name: "demo", version: "1.0.0" });
  initialState: State = { count: 0 };

  async init() {
    this.server.tool(
      "increment",
      "Increment the per-session counter",
      { by: z.number().default(1) },
      async ({ by }) => {
        this.setState({ count: this.state.count + by });
        return { content: [{ type: "text", text: `count=${this.state.count} (user=${this.props?.username ?? "anon"})` }] };
      }
    );
  }
}

export default MyMCP.serve("/mcp");
```

---

## `createMcpHandler` (stateless MCP, no DO)

The lightweight MCP option. No DO, no state, no per-session storage.

### When to use

- Tools are pure functions of their inputs (no per-user state).
- You want to deploy as a single Worker fetch handler.
- Cost optimization — no DO duration GB-s.

### When NOT to use

- Tools need per-session state → `McpAgent`.
- OAuth-protected per-user data → `McpAgent` + OAuth provider.

### Critical rule (catalog #6)

**MCP SDK >=1.26.0 requires a fresh `McpServer` per request.** A shared
global instance fails after the first request and would leak responses
across clients (CVE).

### Packages

```
agents @modelcontextprotocol/sdk zod
```

### Wrangler bindings

```jsonc
{
  "compatibility_flags": ["nodejs_compat"]
  // no durable_objects, no migrations needed
}
```

### Minimal example (~30 lines)

```ts
import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

function createServer() {
  const s = new McpServer({ name: "echo", version: "1.0.0" });
  s.tool("echo", "Echo back input", { msg: z.string() }, async ({ msg }) => ({
    content: [{ type: "text", text: msg }],
  }));
  return s;
}

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const server = createServer();   // MUST be per-request — catalog #6
    return createMcpHandler(server, {
      route: "/mcp",
      sessionIdGenerator: () => crypto.randomUUID(),
    })(req, env, ctx);
  },
} satisfies ExportedHandler<Env>;
```

---

## `WorkflowEntrypoint` (from `cloudflare:workers`)

Multi-step durable pipeline. Steps are checkpointed; replays skip
already-completed `step.do` results.

### When to use

- 3+ deterministic steps with side effects.
- Sleeps > 15 min, up to 365 days.
- Must survive deploys / restarts.
- Per-step retry with exponential backoff.
- Human-in-the-loop approval gates (`step.waitForEvent`, `this.approveWorkflow`).

### When NOT to use

- Single-shot LLM call → just `await` it inside an Agent.
- Wall-clock < 30 s with no need for replay → an Agent method is fine.
- Real-time bidirectional with clients → Agent (workflows cannot open WS).

### Compose pattern

The Agent is the user-facing front door; the Workflow is the durable
back end. The Agent triggers via `this.runWorkflow(name, params)` and
the Workflow updates state via `step.updateAgentState` / `step.mergeAgentState`,
which the Agent broadcasts to clients (cf-agents-core §6).

### Packages

```
agents (for AgentWorkflow base + this.runWorkflow on the Agent)
```

### Wrangler bindings

```jsonc
{
  "compatibility_flags": ["nodejs_compat"],
  "workflows": [
    {
      "name": "research",
      "binding": "RESEARCH_WF",
      "class_name": "ResearchWorkflow"
    }
  ],
  "durable_objects": {
    "bindings": [{ "class_name": "ChatAgent", "name": "ChatAgent" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ChatAgent"] }]
}
```

### Minimal example (~30 lines)

```ts
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

interface Params { topic: string; agentId: string }

export class ResearchWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const sources = await step.do("gather-sources", { retries: { limit: 3, delay: "30 seconds", backoff: "exponential" } }, async () => {
      const r = await fetch(`https://api.example.com/search?q=${encodeURIComponent(event.payload.topic)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    });

    await step.updateAgentState({ stage: "summarizing", sources });   // Agent broadcasts to UI

    const summary = await step.do("summarize", async () => summarize(sources, this.env.AI));

    await step.sleep("notify-tomorrow", "1 day");                     // free, doesn't burn GB-s

    await step.updateAgentState({ stage: "done", summary });
    return summary;
  }
}
```

---

## Quick comparison table

| Class | Has DO | SQLite | WS | Hibernates | this.messages | this.props (OAuth) | Schedule | Use for |
|---|---|---|---|---|---|---|---|---|
| `Agent` | yes | yes | yes | yes | no | optional | yes | generic / room / webhook / sub-agent target |
| `AIChatAgent` | yes | yes | yes | yes | yes | optional | yes | browser chat |
| `McpAgent` | yes | yes | optional (SSE) | yes | no | yes | yes | stateful MCP server |
| `createMcpHandler` | NO | NO | no | n/a | no | n/a | no | stateless MCP server |
| `WorkflowEntrypoint` | no (own runtime) | no | no | n/a | no | no | step.sleep | durable multi-step pipeline |

`AIChatAgent` and `McpAgent` both extend `Agent`, so everything an
`Agent` can do (state, sql, schedule, broadcast, mcp client) is
available on them too.
