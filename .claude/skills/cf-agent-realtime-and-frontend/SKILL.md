---
name: cf-agent-realtime-and-frontend
description: >
  Designs the realtime + UI surface of a Cloudflare Agent — WebSocket with
  hibernation, SSE, RPC over WS, the agents/client AgentClient, the
  agents/react useAgent hook, and the canonical useAgentChat from
  @cloudflare/ai-chat/react. Activates when the user asks for a
  "WebSocket agent", "agents/react", "useAgent hook", "useAgentChat",
  "AgentClient", "chat UI for agent", "stream tokens", "SSE agent",
  or "AI SDK bridge" between Vercel useChat and Cloudflare useAgentChat.
  Encodes the transport-choice rubric (WS vs SSE vs HTTP vs RPC), the
  hibernation cost rule (acceptWebSocket() not accept()), the 200-line
  chat-stack, streaming UX gotchas (key by m.id, never by index),
  reconnection backoff, and the new package split (@cloudflare/ai-chat
  replaces the deprecated agents/ai-chat-agent and agents/ai-react
  shims). Do NOT use for tool authoring (cf-agent-tools-and-mcp) or
  WS-lifecycle testing (cf-agent-tests-and-evals).
---

# Cloudflare Agent — Realtime & Frontend

The realtime surface is **WebSocket-first**. Hibernation makes it cheap.
Everything else (SSE, HTTP, RPC) is fallback or service-to-service.

## Transport choice in 60 seconds

| Transport | Use when | Don't use when |
|---|---|---|
| **WebSocket** (default) | Chat UI, multi-client sync, presence, `setState` broadcast, streaming tokens to a browser | The network blocks WS (corp proxies) — fall back to SSE |
| **SSE** | One-way server push (logs, dashboards, model token streams to read-only consumers); WS is blocked | You need client→server messages — that's WS |
| **HTTP** | REST-style invocations from external systems, webhooks, one-shot jobs | You'd open more than 1 request per turn — that's WS or SSE |
| **RPC** (Workers/DO bindings) | Worker-A → Worker-B, Agent → Agent in same account | Browser client — RPC isn't reachable from JS in a tab |

> Decision rule: a chat UI is **always WebSocket** unless you have a
> measured reason otherwise. WS gives you state sync, RPC, presence,
> and streaming on one socket.

## WebSocket + hibernation (the cost rule)

The Agents SDK uses `acceptWebSocket()` under the hood, not `accept()`.
That single call is the difference between **paying for an idle DO**
and **the DO sleeping until the next message arrives**.

```ts
// You don't write this — Agent base class does. But know it's there.
this.ctx.acceptWebSocket(server);   // hibernation-friendly
// this.ctx.accept(server);          // disables hibernation, burns cost
```

Hibernation is **on by default** (`Agent.options.hibernate ?? true`).
Disable only with measured reason:

```ts
class AlwaysOn extends Agent<Env> {
  static options = { hibernate: false };
}
```

### What survives hibernation

| Survives | Lost |
|---|---|
| `this.state` (DO storage) | In-memory class fields |
| `connection.state` (WS attachment, **2KB cap**) | `setTimeout` / `setInterval` |
| `this.sql` rows | In-flight promises |
| Scheduled tasks (alarms) | Closures captured in `runFiber()` |
| Connection metadata (id, tags) | Anything not persisted |

### The 2KB attachment cap

`connection.setState({...})` serializes JSON into the WebSocket
attachment. Cloudflare caps that at **2KB**. Don't put chat history
or large blobs there. Use SQL or `this.state` for anything bigger.

```ts
// good: tiny per-connection identity
connection.setState({ userId, role: "user", joinedAt: Date.now() });

// bad: blows the 2KB cap and silently breaks hibernation
connection.setState({ chatHistory: this.messages });
```

## Client side: `agents/client` (AgentClient)

The browser/Node WebSocket client. Subclass of `partysocket`. Auto-reconnects
with exponential backoff.

```ts
import { AgentClient } from "agents/client";

const client = new AgentClient({
  agent: "chat-agent",          // DO class name (kebab-cased on the wire)
  name: "session-abc123",       // DO instance name
  host: "my.example.workers.dev",
  query: { token: await getToken() },   // querystring — survives reconnect
  basePath: "agents",
  onStateUpdate: (state, source) => {}, // source: "server" | "client"
});

await client.call("sendMessage", ["Hi"]);    // RPC over WS
await client.stub.sendMessage("Hi");          // typed shorthand
client.setState({ /* ... */ });               // optimistic + broadcast
client.send(rawData);                         // raw WS frame
client.reconnect();
client.close();

client.addEventListener("open" | "close" | "error" | "message", h);
```

`client.call(method, args, { signal, timeout })` correlates
`{ id, type: "rpc", method, args }` then `{ id, type: "rpc-response", result }`.
Pending calls reject with `"Connection closed"` on disconnect; await
`client.ready` to retry idempotent ones.

For one-shot HTTP (no WS), use `agentFetch`:

```ts
import { agentFetch } from "agents/client";

const r = await agentFetch(
  { agent: "data-agent", name: "i-1", host: "my-worker.workers.dev" },
  { method: "POST", body: JSON.stringify({}) }
);
```

## React: `useAgent`

The 5 things this hook gives you that a raw WebSocket doesn't:

1. **State sync.** `agent.state` mirrors the DO's `setState`; React re-renders on change.
2. **Typed RPC.** `agent.stub.foo(bar)` resolves the typed return of the server method.
3. **Reconnection with backoff.** Exponential, automatic, re-subscribes to same `name`.
4. **Lifecycle binding.** Closes on unmount, reopens on `name` change.
5. **MCP fan-in.** `cf_agent_mcp_servers` events update React state via `onMcpUpdate`.

```ts
import { useAgent } from "agents/react";
import type { ChatAgent } from "../server";

const agent = useAgent<ChatAgent>({
  agent: "ChatAgent",                  // class name
  name: "session-abc123",              // DO instance
  host,                                // defaults to current origin
  basePath: "agents",
  query: async () => ({ token: await getToken() }),  // re-fetched on reconnect
  queryDeps: [userId],
  cacheTtl: 60_000,                    // default 5 min

  onStateUpdate: (state, source) => {},
  onMcpUpdate: (mcp) => setMcpState(mcp),
  onOpen: () => setConnected(true),
  onClose: () => setConnected(false),
  onError: (e) => console.error(e),
  onMessage: (e) => {
    const data = JSON.parse(String(e.data));
    if (data.type === "scheduled-task") toasts.add(data);
  },
  onIdentity: (name, agentType) => {},
  onIdentityChange: (name, agentType) => {},
  onStateUpdateError: (err) => console.error(err),
});

// Returned API:
agent.state;                       // undefined until first cf_agent_state
agent.setState({ /* ... */ });     // optimistic
await agent.stub.someMethod(args); // typed
await agent.call("someMethod", [args], {
  timeout: 5000,
  stream: { onChunk, onDone, onError },
});
agent.reconnect();
agent.close();
```

> Reconnection caveat: in-flight RPC calls reject on disconnect. Don't
> call non-idempotent methods optimistically — gate behind `agent.ready`
> or the `onOpen` event.

## React: `useAgentChat`

> **Heads up:** the canonical import is `@cloudflare/ai-chat/react`.
> The legacy `agents/ai-react` is a deprecated shim that logs a warning.
> Likewise the chat agent: `@cloudflare/ai-chat` (new) replaces
> `agents/ai-chat-agent` (deprecated shim).

```tsx
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";

const agent = useAgent<ChatAgent>({ agent: "ChatAgent", name });
const {
  messages, input, status, isLoading,
  sendMessage, handleInputChange, handleSubmit, stop,
  clearHistory, addToolApprovalResponse,
} = useAgentChat({
  agent,
  initialMessages: [],
  onToolCall: async (event) => {
    // Client-side tools (no `execute` on server) resolve here.
    if ("addToolOutput" in event && event.toolCall.toolName === "getUserTimezone") {
      event.addToolOutput({
        toolCallId: event.toolCall.toolCallId,
        output: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
      });
    }
  },
});
```

What `useAgentChat` gives you for free:

- **Streaming.** Last `messages[i]` is patched in place on every chunk. Plain `messages.map(...)` already streams.
- **Optimistic.** `handleSubmit` immediately appends the `user` message; reconciles on server echo.
- **Persistence.** `AIChatAgent` writes `this.messages` to DO SQLite; reload with same `name` and you get history.
- **Multi-tab sync.** Two tabs on same `name` both subscribe to one DO and see identical message stream.
- **Approval flow.** `addToolApprovalResponse({ toolCallId, approved })` resolves `needsApproval` tools.

Server side wires up via `AIChatAgent.onChatMessage` — see the 200-line stack below or `references/chat-app-200-lines.md`.

## AI SDK bridge — `useChat` (Vercel) vs `useAgentChat` (Cloudflare)

| Need | Pick |
|---|---|
| Stateless chat against a Worker route returning `streamText().toUIMessageStreamResponse()` | `@ai-sdk/react useChat` over HTTP |
| Server holds conversation, schedules tasks, runs MCP, persists messages | `useAgentChat` over WS against `AIChatAgent` |
| Multi-tab sync of the same conversation | `useAgentChat` (DO is single source of truth) |
| Already have `/api/chat` and don't want a DO | `@ai-sdk/react useChat` |
| Cookie-based session auth | `useChat` (WS doesn't carry cookies — see Auth section) |

### Bridging an `AIChatAgent` to plain `useChat`

You lose multi-tab sync but gain HTTP simplicity. Expose an HTTP route:

```ts
export class ChatAgent extends AIChatAgent<Env> {
  async onRequest(req: Request) {
    if (new URL(req.url).pathname.endsWith("/chat")) {
      const body = await req.json<{ messages: UIMessage[] }>();
      this.messages = body.messages;
      const result = streamText({ model, messages: this.messages });
      return result.toUIMessageStreamResponse();
    }
    return super.onRequest(req);
  }
}

// Worker:
fetch: (req, env) => routeAgentRequest(req, env) ?? env.ASSETS.fetch(req)

// Client:
const { messages } = useChat({ api: "/agents/chat-agent/default/chat" });
```

Do this only if you specifically need the Vercel hook — cookies, an
existing UI library tied to `useChat`, or a stateless `/api/chat` already
deployed.

### Client-side tools — same pattern in both hooks

Server: declare a tool with **no** `execute`. Client: handle in `onToolCall`.

```ts
// Server
getUserTimezone: tool({
  description: "Get the user's timezone from their browser.",
  inputSchema: z.object({}),
}),  // no execute means client handles

// Client (useAgentChat or useChat)
onToolCall: async (event) => {
  if (event.toolCall.toolName === "getUserTimezone") {
    event.addToolOutput({
      toolCallId: event.toolCall.toolCallId,
      output: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
    });
  }
}
```

## The 200-line stack

Three files. `wrangler.jsonc` (~20) + `server.ts` (~80) + `app.tsx` (~60).
Full narrated walk-through in `references/chat-app-200-lines.md`. Sketch:

### `wrangler.jsonc`
```jsonc
{
  "name": "ai-chat",
  "main": "src/server.ts",
  "compatibility_date": "2026-03-02",
  "compatibility_flags": ["nodejs_compat"],
  "ai": { "binding": "AI", "remote": true },
  "assets": {
    "directory": "./public",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/agents/*", "/oauth/*"]
  },
  "durable_objects": {
    "bindings": [{ "class_name": "ChatAgent", "name": "ChatAgent" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ChatAgent"] }]
}
```

### `src/server.ts`
```ts
import { routeAgentRequest, callable } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { createWorkersAI } from "workers-ai-provider";
import { convertToModelMessages, pruneMessages, streamText, stepCountIs, tool } from "ai";
import { z } from "zod";

type Env = { AI: Ai; ASSETS: Fetcher; ChatAgent: DurableObjectNamespace };

export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;

  @callable() async ping() { return "pong"; }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const result = streamText({
      model: workersai("@cf/moonshotai/kimi-k2.6", { sessionAffinity: this.sessionAffinity }),
      system: "You are a concise assistant.",
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
      }),
      tools: {
        getWeather: tool({
          description: "Get the current weather",
          inputSchema: z.object({ city: z.string() }),
          execute: async ({ city }) => ({ city, tempC: 17 }),
        }),
        // client-side tool: no execute
        getUserTimezone: tool({
          description: "Get the user's browser timezone",
          inputSchema: z.object({}),
        }),
      },
      stopWhen: stepCountIs(5),
      abortSignal: options?.abortSignal,
    });
    return result.toUIMessageStreamResponse();
  }

  // Broadcast scheduled-task notifications without injecting into chat history
  async executeTask(description: string) {
    this.broadcast(JSON.stringify({ type: "scheduled-task", description, at: new Date().toISOString() }));
  }
}

export default {
  fetch: (req: Request, env: Env) =>
    routeAgentRequest(req, env) ?? new Response("Not found", { status: 404 }),
} satisfies ExportedHandler<Env>;
```

### `src/app.tsx`
```tsx
import { useState, useCallback } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { ChatAgent } from "./server";

export function App() {
  const [name] = useState(() => crypto.randomUUID());
  const [connected, setConnected] = useState(false);

  const agent = useAgent<ChatAgent>({
    agent: "ChatAgent",
    name,
    onOpen: useCallback(() => setConnected(true), []),
    onClose: useCallback(() => setConnected(false), []),
  });

  const { messages, input, handleInputChange, handleSubmit, status } =
    useAgentChat({
      agent,
      initialMessages: [],
      onToolCall: async (event) => {
        if ("addToolOutput" in event && event.toolCall.toolName === "getUserTimezone") {
          event.addToolOutput({
            toolCallId: event.toolCall.toolCallId,
            output: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
          });
        }
      },
    });

  return (
    <div>
      <header>{connected ? "online" : "offline"}</header>
      <ul>
        {messages.map((m) => (
          // KEY BY ID, NOT INDEX (see Streaming UX)
          <li key={m.id} className={m.role}>{m.content}</li>
        ))}
      </ul>
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} disabled={status === "streaming"} />
      </form>
    </div>
  );
}
```

That's the whole stack. `vite dev`, type, ship.

## Streaming UX — the rules

1. **`key={m.id}`, never `key={i}`.** `useAgentChat` patches the last
   message in place on every chunk. Indexed keys re-key the entire list
   on each chunk, so React tears, scroll position jumps, animations restart.
2. **Don't mutate `this.messages` mid-stream on the server.** Only inside
   the `onFinish` callback of `streamText`. Mutating during streaming
   races the AI SDK's own buffer.
3. **Backoff on disconnect.** `useAgent` already uses exponential backoff
   from `partysocket`. Don't add a parallel reconnect loop. Show
   "reconnecting…" on `onClose`, hide on `onOpen`.
4. **Optimistic append on submit.** `handleSubmit` does this for you in
   `useAgentChat`. If you handroll, append the user message before the
   server echo and reconcile by `id` when it arrives.
5. **Server-side de-dup on reconnect.** When a WS reopens mid-turn,
   `AIChatAgent` replays persisted messages from SQLite up to
   `maxPersistedMessages`. Trust that — don't re-send from the client.
6. **Backpressure.** A single `connection.send(chunk)` is buffered
   in-runtime, but if you stream tokens faster than the network can drain,
   call `connection.send` from the AI SDK's own back-pressured stream
   reader, not a `for await` that ignores draining.
7. **Cancel.** `useAgentChat` exposes `stop()` which sends
   `CF_AGENT_CHAT_REQUEST_CANCEL`. Wire it to a Stop button and to
   Escape-key for parity with chat-app conventions.

## Auth on the WebSocket

WS doesn't carry cookies. Pass auth via `query`:

```ts
const agent = useAgent({
  agent: "chat-agent",
  name,
  query: async () => ({ token: await getToken() }),  // re-fetched on reconnect
  queryDeps: [userId],
});
```

Server-side, validate in `onConnect`:

```ts
async onConnect(connection: Connection, ctx: ConnectionContext) {
  const token = new URL(ctx.request.url).searchParams.get("token");
  const claims = await verifyToken(token, this.env.JWKS);
  if (!claims) { connection.close(4001, "Unauthorized"); return; }
  connection.setState({ userId: claims.sub, role: claims.role });
}
```

Never put tokens in `setState({})` — that broadcasts to all clients
(see cf-agent-state-and-storage). Stash secrets in `this.props` or SQL.

## SSE-only mode (when WS is blocked)

Read-only consumer: dashboard, log tail, model token stream to a viewer.

```ts
async onRequest(request: Request) {
  if (new URL(request.url).pathname.endsWith("/stream")) {
    const stream = new ReadableStream({
      start: async (controller) => {
        const enc = new TextEncoder();
        for await (const chunk of this.tailStream()) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  }
  return super.onRequest(request);
}
```

Use `Last-Event-ID` for resume. Workers don't impose an SSE timeout, but
**Pages Functions and some reverse proxies buffer SSE** — deploy as a
plain Worker custom domain for `/stream`.

## RPC (service-to-service)

When Worker-A (or Agent-A) calls Agent-B in the same account:

```ts
import { getAgentByName } from "agents";

const agentB = await getAgentByName<Env, AgentB>(env.AgentB, "instance-1");
const result = await agentB.someMethod(args);   // direct DO RPC, no WS
```

`AbortSignal` does **not** cross DO RPC boundaries — enforce timeouts
on the callee side with `Promise.race(call, timeout())`.

## Hand-offs

- Tools you want the chat to call → **cf-agent-tools-and-mcp**
  (tool authoring, MCP servers, approval flows, the `getUserTimezone`
  / `calculate` / `getWeather` triad).
- Persisting chat history beyond `maxPersistedMessages`, schema for
  `this.messages`, `setState` shape, SQL for ad-hoc tables →
  **cf-agent-state-and-storage**.
- Testing the WS lifecycle (`runInDurableObject`, vitest pool workers,
  WebSocket mocks, replaying recorded sessions) →
  **cf-agent-tests-and-evals** + the `scripts/ws-replay.ts` here for
  smoke regression.
- Scheduled `broadcast()` notifications, cron jobs that fan out to
  connected clients → **cf-agent-workflows-and-scheduling**.
- OAuth tokens (don't put them in `setState`!), `this.props`, scope
  enforcement → **cf-agent-auth-and-permissions**.
- Picking the model behind `streamText`, AI Gateway in front of every
  call → **cf-agent-models-and-gateway**.

## References

- `references/transport-choice.md` — full WS / SSE / RPC / HTTP rubric, hibernation interaction.
- `references/useagent-cookbook.md` — every `useAgent` and `useAgentChat` pattern with code.
- `references/ai-sdk-bridge.md` — `useChat` (Vercel) vs `useAgentChat` (Cloudflare), bridge code, when each.
- `references/chat-app-200-lines.md` — the canonical end-to-end stack, narrated line by line.

## Scripts

- `scripts/ws-replay.ts` — connect to a deployed agent's WebSocket, replay
  a recorded JSON session (sequence of `send` payloads), record server
  responses, diff against a snapshot. Smoke-regression for chat flows.

  ```bash
  bun run scripts/ws-replay.ts \
    --host ai-chat.workers.dev \
    --agent ChatAgent \
    --name session-test \
    --session ./fixtures/golden-session.json \
    --snapshot ./fixtures/golden-snapshot.json
  ```
