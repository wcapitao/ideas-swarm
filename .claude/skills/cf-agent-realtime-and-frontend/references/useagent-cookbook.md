# useAgent + useAgentChat cookbook

Every pattern that ships in production. Code first.

## 1. Minimal — open a WS, render state

```tsx
import { useAgent } from "agents/react";

type CounterState = { count: number };

export function Counter() {
  const agent = useAgent<CounterState>({
    agent: "counter-agent",
    name: "default",
  });

  return (
    <div>
      <span>{agent.state?.count ?? 0}</span>
      <button onClick={() => agent.stub.increment()}>+</button>
    </div>
  );
}
```

Server side:

```ts
import { Agent, callable } from "agents";

export class CounterAgent extends Agent<Env, CounterState> {
  initialState: CounterState = { count: 0 };

  @callable() increment() {
    this.setState({ count: this.state.count + 1 });
    return this.state.count;
  }
}
```

## 2. Auth via query (token-rotated)

```tsx
const agent = useAgent({
  agent: "secure-agent",
  name: convoId,
  query: async () => ({ token: await getAccessToken() }),
  queryDeps: [userId],   // re-fetch when user changes
  cacheTtl: 60_000,      // re-fetch token at most once / minute
});
```

The `query` function is async and re-runs on:
- mount
- `queryDeps` change
- WS reconnect
- TTL expiry

Server side validates in `onConnect`:

```ts
async onConnect(connection: Connection, ctx: ConnectionContext) {
  const token = new URL(ctx.request.url).searchParams.get("token");
  const claims = await verifyJWT(token, this.env.JWKS_URL);
  if (!claims) {
    connection.close(4001, "Unauthorized");
    return;
  }
  connection.setState({ userId: claims.sub });   // <2KB, no secrets
}
```

## 3. Typed RPC against a server class

```ts
// server.ts
import { Agent, callable } from "agents";

export class TodoAgent extends Agent<Env, { items: Todo[] }> {
  initialState = { items: [] };

  @callable() async addTodo(title: string): Promise<Todo> {
    const item = { id: crypto.randomUUID(), title, done: false };
    this.setState({ items: [...this.state.items, item] });
    return item;
  }

  @callable() async toggleTodo(id: string) {
    this.setState({
      items: this.state.items.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    });
  }
}
```

```tsx
// client
import type { TodoAgent } from "../server";

const agent = useAgent<TodoAgent>({ agent: "TodoAgent", name: "u-1" });

// typed: returns Promise<Todo>
const newItem = await agent.stub.addTodo("Buy milk");

// signal + timeout
const ac = new AbortController();
setTimeout(() => ac.abort(), 3000);
await agent.call("addTodo", ["Quick"], { signal: ac.signal, timeout: 3000 });
```

## 4. Stream a long RPC result

```ts
// server
@callable() async *generate(prompt: string): AsyncIterable<string> {
  const stream = await this.env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct", {
    prompt, stream: true,
  });
  for await (const chunk of stream) yield chunk.response;
}
```

```tsx
// client
await agent.call("generate", [prompt], {
  stream: {
    onChunk: (chunk) => setOutput((s) => s + chunk),
    onDone: () => setStreaming(false),
    onError: (e) => console.error(e),
  },
});
```

`useAgentChat` does this internally for `streamText` — you only reach
for streamed `agent.call` when the response isn't a chat message
(custom analytics stream, log tail, etc).

## 5. Broadcast presence

```ts
// server
async onConnect(connection: Connection, ctx: ConnectionContext) {
  connection.setState({ joined: Date.now() });
  this.broadcast(JSON.stringify({ kind: "join", id: connection.id }));
}

async onClose(connection: Connection, code: number, reason: string) {
  this.broadcast(JSON.stringify({ kind: "leave", id: connection.id }));
}

@callable() listConnections() {
  return [...this.getConnections()].map((c) => ({ id: c.id, ...c.state }));
}
```

```tsx
// client
const [users, setUsers] = useState<{ id: string }[]>([]);

const agent = useAgent({
  agent: "room-agent",
  name: roomId,
  onMessage: (e) => {
    const msg = JSON.parse(String(e.data));
    if (msg.kind === "join") setUsers((u) => [...u, { id: msg.id }]);
    if (msg.kind === "leave") setUsers((u) => u.filter((x) => x.id !== msg.id));
  },
  onOpen: async () => setUsers(await agent.stub.listConnections()),
});
```

## 6. Optimistic local state + server reconciliation

```tsx
const agent = useAgent<TodoAgent>({
  agent: "TodoAgent",
  name,
  onStateUpdate: (state, source) => {
    if (source === "server") {
      // reconciled with server truth — clear any local pending markers
    }
  },
  onStateUpdateError: (err) => {
    toast.error(`State rejected: ${err}`);
    // server rejected the optimistic setState; revert UI
  },
});

function addLocal(title: string) {
  // 1. Optimistic
  agent.setState({
    items: [...(agent.state?.items ?? []), { id: "tmp-" + crypto.randomUUID(), title, done: false, pending: true }],
  });
  // 2. Real RPC (server returns the canonical id)
  agent.stub.addTodo(title);
  // server's setState will re-broadcast; UI reconciles by id.
}
```

## 7. useAgentChat — minimal

```tsx
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { ChatAgent } from "../server";

export function Chat({ name }: { name: string }) {
  const agent = useAgent<ChatAgent>({ agent: "ChatAgent", name });
  const { messages, input, handleInputChange, handleSubmit, status } =
    useAgentChat({ agent, initialMessages: [] });

  return (
    <>
      <ul>{messages.map((m) => <li key={m.id}>{m.role}: {m.content}</li>)}</ul>
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} disabled={status === "streaming"} />
      </form>
    </>
  );
}
```

## 8. useAgentChat — full features

```tsx
const agent = useAgent<ChatAgent>({
  agent: "ChatAgent",
  name,
  onMcpUpdate: (state) => setMcpServers(state),
  onMessage: (e) => {
    const data = JSON.parse(String(e.data));
    if (data.type === "scheduled-task") toasts.add({ title: "Task ran", body: data.description });
  },
});

const {
  messages,                        // UIMessage[] — already streaming
  input,                           // string
  status,                          // "idle" | "streaming" | "submitted" | "error"
  isLoading,                       // boolean — alias of status === "streaming"
  sendMessage,                     // (msg: UIMessage) -> Promise<void>
  handleInputChange,               // textarea / input handler
  handleSubmit,                    // form submit handler (optimistic append)
  stop,                            // cancel current turn
  clearHistory,                    // wipe DO message store
  addToolApprovalResponse,         // resolve a needsApproval tool
} = useAgentChat({
  agent,
  initialMessages: [],
  onToolCall: async (event) => {
    const { toolCall } = event;
    if (toolCall.toolName === "getUserTimezone" && "addToolOutput" in event) {
      event.addToolOutput({
        toolCallId: toolCall.toolCallId,
        output: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
      });
    }
  },
  onError: (err) => console.error(err),
  onFinish: ({ message }) => analytics.log("chat.turn", { len: message.content.length }),
});
```

## 9. Approval flow (needsApproval tool)

Server tool:

```ts
calculate: tool({
  description: "Evaluate a math expression",
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  execute: async ({ a, b }) => ({ result: a + b }),
  needsApproval: async ({ a, b }) => Math.abs(a) > 1000 || Math.abs(b) > 1000,
}),
```

Client UI:

```tsx
{messages.map((m) => (
  <li key={m.id}>
    {m.parts.map((part, i) => {
      if (part.type === "tool-invocation" && part.toolInvocation.state === "awaiting-approval") {
        return (
          <ApprovalCard
            key={i}
            tool={part.toolInvocation.toolName}
            args={part.toolInvocation.args}
            onApprove={() =>
              addToolApprovalResponse({ toolCallId: part.toolInvocation.toolCallId, approved: true })}
            onReject={() =>
              addToolApprovalResponse({ toolCallId: part.toolInvocation.toolCallId, approved: false })}
          />
        );
      }
      return part.type === "text" ? <span key={i}>{part.text}</span> : null;
    })}
  </li>
))}
```

## 10. MCP fan-in UI

When the agent calls `addMcpServer`, both sides see the update:

```tsx
const [mcp, setMcp] = useState<MCPServersState>({ servers: [] });

const agent = useAgent<ChatAgent>({
  agent: "ChatAgent",
  name,
  onMcpUpdate: setMcp,
});

return (
  <ul>
    {mcp.servers.map((s) => (
      <li key={s.id}>
        {s.name} — {s.tools.length} tools — {s.connectionState}
        <button onClick={() => agent.stub.removeServer(s.id)}>x</button>
      </li>
    ))}
    <button onClick={() => agent.stub.addServer("github", "https://gh-mcp.example.com/sse")}>
      + GitHub
    </button>
  </ul>
);
```

## 11. Reconnection backoff observation

`useAgent` uses `partysocket`'s built-in exponential backoff. You should
NOT implement your own. Surface state to the user:

```tsx
const [state, setState] = useState<"online" | "offline" | "reconnecting">("offline");

const agent = useAgent({
  agent: "x",
  name,
  onOpen: () => setState("online"),
  onClose: (e) => {
    // 1006 = abnormal; 1000 = normal — partysocket reconnects on most non-1000 codes
    setState(e.code === 1000 ? "offline" : "reconnecting");
  },
  onError: () => setState("reconnecting"),
});
```

## 12. Handling `name` change (open / close conversation X)

```tsx
const [conversationId, setConversationId] = useState("default");
const agent = useAgent({ agent: "ChatAgent", name: conversationId });
// changing conversationId triggers: close current WS, open new WS, re-subscribe to state.
// The useAgentChat hook re-initializes with the new agent reference.
```

## 13. Anti-patterns to avoid

- **Don't `key={index}`.** See SKILL.md Streaming UX.
- **Don't store tokens in `agent.setState`.** Broadcast == leak.
- **Don't open multiple `useAgent` to the same `name`** in one component;
  use one and pass `agent` to children.
- **Don't await RPC during render.** Call from `onClick` / `useEffect`.
- **Don't poll `agent.state`.** It updates by subscription; just read.
- **Don't reuse one DO class for chat AND admin dashboards.** Different
  invariants, different auth — split into two `class_name`s.
