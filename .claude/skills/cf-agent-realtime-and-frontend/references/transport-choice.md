# Transport choice — WS / SSE / HTTP / RPC

Cloudflare Agents speak four wire protocols. Pick wrong and you either
break hibernation (cost), or fight the framework (bugs).

## Decision tree

```
Need bidirectional comms with a browser?
    yes -> WebSocket
    no  -> server -> client only?
                yes -> SSE
                no  -> external system / webhook?
                            yes -> HTTP
                            no  -> Worker -> Worker / Agent -> Agent?
                                        yes -> RPC (DO bindings, getAgentByName)
                                        no  -> reconsider; you probably want WS
```

## WebSocket — the default

Hibernation is on by default. The framework calls `acceptWebSocket()`
(NOT `accept()`); state is reattached lazily after wake from
`cf_agents_state` SQLite plus the per-connection 2KB attachment.

What you get over a raw socket:

| Feature | Mechanism |
|---|---|
| State sync | `cf_agent_state` server-push frame; `agent.state` mirrors |
| Typed RPC | `client.call(method, args)` -> `{type:"rpc", id, method, args}` |
| Multi-client broadcast | `this.broadcast(msg)`; `getConnections(tag)` for selective |
| Optimistic state | `client.setState({...})` echoes locally, server reconciles |
| MCP fan-in | `cf_agent_mcp_servers` push when `addMcpServer` lands |
| Auto-reconnect | `partysocket` exponential backoff |
| Auth | `query` param (cookies don't ride the WS handshake reliably) |

Connection lifecycle hooks on the Agent:

```ts
async onConnect(connection: Connection, ctx: ConnectionContext) { /* auth */ }
async onMessage(connection: Connection, message: WSMessage) { /* RPC fallthrough handled */ }
async onClose(connection: Connection, code: number, reason: string, wasClean: boolean) { /* cleanup */ }
async onError(connection: Connection, error: unknown) { /* log */ }
```

### Tags + selective broadcast

```ts
getConnectionTags(connection: Connection, ctx: ConnectionContext) {
  return ctx.role === "admin" ? ["admin"] : ["user"];
}

// in some method:
for (const c of this.getConnections("admin")) c.send(JSON.stringify({ kind: "admin-only" }));
this.broadcast(JSON.stringify({ kind: "all-but-sender" }), [connection.id]);
```

Tag limits: max 9 tags per connection, each <=256 chars.

## SSE — server push only

Use when:
- corporate proxy blocks WS upgrades
- consumer is a CLI / dashboard that only reads
- you want to expose a public read-only stream (e.g. status feed)

```ts
async onRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/stream")) {
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`));
        // for await chunks from your source:
        for await (const ev of someAsyncIterable()) {
          controller.enqueue(enc.encode(`id: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }
  return new Response("Not found", { status: 404 });
}
```

Format is exactly `data: <line>\n\n`. Send `id:` lines so clients can
resume with `Last-Event-ID`. **Pages Functions and certain reverse
proxies buffer SSE.** Deploy a plain Worker custom domain for streaming.

### AI SDK SSE shortcut

For a model-token stream:

```ts
import { streamText } from "ai";
const result = streamText({ model, messages });
return result.toTextStreamResponse();         // raw text stream
// or:
return result.toUIMessageStreamResponse();    // chat UI shape (used by useAgentChat & useChat)
```

## HTTP — request/response

Webhooks, REST endpoints, one-shot fetches from external systems.

```ts
async onRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname.endsWith("/ingest")) {
    const body = await request.json();
    await this.ingest(body);
    return Response.json({ ok: true });
  }
  return new Response("Not found", { status: 404 });
}
```

Routing from the Worker fetch handler:

```ts
fetch: (req, env) => routeAgentRequest(req, env) ?? env.ASSETS.fetch(req)
```

## RPC — service to service

Worker-A wants to call Agent-B (a DO) directly:

```ts
import { getAgentByName } from "agents";

const agent = await getAgentByName<Env, MyAgent>(env.MyAgent, "instance-name");
const result = await agent.someMethod(args);
```

This bypasses HTTP/WS entirely. Method must be on the DO class (any
public method works; `@callable()` is only required for WS-RPC).

### AbortSignal does NOT cross DO RPC

```ts
// caller (WRONG — signal is dropped)
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);
await agent.expensiveMethod(args, controller.signal);  // signal ignored

// callee — enforce timeouts on the DO side
async expensiveMethod(args: Args, _signal: AbortSignal) {
  return await Promise.race([
    this.doWork(args),
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
  ]);
}
```

### Cross-Worker RPC (service bindings)

```jsonc
// wrangler.jsonc on caller
"services": [{ "binding": "OTHER", "service": "other-worker" }]
```

```ts
const r = await env.OTHER.fetch(new Request("https://internal/foo"));
```

For typed cross-Worker RPC use Workers RPC (entrypoints + interfaces),
which can carry `Connection`-like objects but not WebSockets.

## Hibernation interaction matrix

| Transport | Triggers wake from hibernation | Survives hibernation |
|---|---|---|
| WebSocket | yes (on next inbound message) | connection state, attachment |
| SSE | n/a (HTTP-shaped, response stream) | stream closes; client reconnects |
| HTTP | yes (each request wakes the DO) | n/a (request/response) |
| RPC | yes | n/a |

Cron + `schedule()` fire alarms which also wake the DO. So even a fully
hibernated agent answers all four transports without manual wake logic.

## Anti-patterns

1. **Polling for state.** `setInterval(() => fetch("/state"), 1000)` — the
   WebSocket exists for this; `agent.state` is already pushed.
2. **Two sockets per agent (one for chat, one for state).** Use one WS;
   multiplex via message `type` field.
3. **Reusing one DO instance for chat AND admin/dashboard streams.** They
   have different auth boundaries. Use two classes / two bindings.
4. **HTTP/SSE inside a tab where the user is also chatting.** Open one
   WS, broadcast everything over it; SSE is for separate consumers.
5. **Forgetting `run_worker_first: ["/agents/*", "/oauth/*"]`** in the
   assets block. Without it, the SPA index.html captures the agent path
   and the WS upgrade silently 404s.
