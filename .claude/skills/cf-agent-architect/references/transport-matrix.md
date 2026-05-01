# Transport Matrix — WS / SSE / HTTP / RPC / MCP

For each transport: which clients can speak it, whether it's
hibernation-compatible, whether you can broadcast on it, and the
canonical use case.

---

## Master matrix

| Transport | Direction | Client | Hibernates | Broadcastable | Typical use case | Cited |
|---|---|---|---|---|---|---|
| **WebSocket** | bidirectional | browser, Node, mobile, any WS client | **yes** (with `acceptWebSocket`) | **yes** (`this.broadcast`, tag-filtered) | browser chat, collab, voice, game, anything pushing server→client | cf-agents-core §7, cf-runtime-primitives §4 |
| **SSE** | server→client | browser (`EventSource`) or any HTTP client | no (DO stays awake while stream open) | no (single connection) | one-way LLM token streams from internal services that won't speak WS | cf-agents-core §8 |
| **HTTP `onRequest`** | request/response | any HTTP client (curl, Worker, webhook source) | n/a (not persistent) | no | webhooks, REST surface, one-shot fetch from `agentFetch` | cf-agents-core §1, §3 |
| **RPC (DO stub)** | request/response | other Workers / Agents in the same account | n/a | no | server-to-server typed calls via `getAgentByName().method()` | cf-agents-core §3, §15 |
| **`@callable()` over WS** | client→server RPC | browser via `useAgent().stub.method()` or `client.stub.method()` | yes (rides on the WS) | response-only | typed RPC from a connected client | cf-agents-core §1 |
| **MCP streamable-http** | bidirectional | MCP clients (Claude Desktop, Cursor, ChatGPT) | yes (DO-backed McpAgent) | n/a (per-session) | modern MCP transport, default for `McpAgent.serve` | cf-agents-core §10 |
| **MCP SSE** | server→client (legacy) | older MCP clients only | partial | n/a | **deprecated** — do not start new servers on this | cf-agents-core §10 |
| **MCP RPC** | bidirectional, in-Cloudflare | Agent → McpAgent same Worker | yes | n/a | zero-HTTP MCP between Agent and same-Worker McpAgent (mcp-rpc-transport example) | cf-agents-core §10 |
| **Email** | inbound + outbound | mail server | n/a | n/a | inbound: `routeAgentEmail`; outbound: `this.sendEmail()` (signed HMAC for replies) | cf-agents-core §3 |

---

## Decision rules

### Is the client a browser?

- **Interactive chat / collab / live UI** → WebSocket. Hibernation is the cost story; without it you bill GB-s 24/7 per connection (cf-runtime-primitives §4 — 1 connection on `accept()` ≈ 11,000 GB-s/day, ~2× the entire DO free tier).
- **One-shot fetch / GET / POST** → HTTP `onRequest` (use `agentFetch` from `agents/client` if you want the typed wrapper).
- **Streaming response only (no upstream)** → SSE inside `onRequest`. Reach for the AI SDK's `result.toTextStreamResponse()`.

### Is the client another Worker / Agent in the same Cloudflare account?

- **Always RPC.** `getAgentByName(env.X, name).method()`. Zero HTTP overhead. Typed via `DurableObjectStub<T>`.
- Don't `@callable()` for server-to-server — that's for clients over WS. Just call the method directly.
- **Footgun:** `AbortSignal` does not cross DO RPC boundaries (catalog #10, cf-agents-core §15). Enforce timeouts inside the receiving DO.

### Is the client an MCP client (Claude Desktop, Cursor, ChatGPT, Continue)?

- **Default → MCP streamable-http** via `MyMCP.serve("/mcp")`. SDK figures out the transport from the URL prefix.
- **Don't start new work on SSE.** It's deprecated (cf-agents-core §10, transport).
- **Same-Worker Agent ↔ McpAgent** → use MCP RPC transport (`RPCServerTransport` / `RPCClientTransport`) — example: `mcp-rpc-transport`.

### Is the client an external system (webhook, cron, email)?

- **HTTP webhook** → `onRequest` + HMAC signature verification (every byte of the body, constant-time compare). Pattern: github-webhook example.
- **Email** → `routeAgentEmail` with `createAddressBasedEmailResolver` or `createSecureReplyEmailResolver` (HMAC-validated). Use `postal-mime` to parse.
- **Cron** → Worker `[[triggers.crons]]` calls `getAgentByName(...).method()`. Or: agent schedules itself via `this.schedule("0 * * * *", ...)`.

---

## Hibernation deep-cut

Hibernation is the most cost-critical primitive in the stack
(cf-runtime-primitives §4):

```
Use acceptWebSocket(server) ──► DO can hibernate ──► billable duration $0 while idle
Use accept()                ──► DO stays in memory ──► bill 24/7 per connection
```

The Agents SDK uses `acceptWebSocket` for you on the `Agent` /
`AIChatAgent` / `McpAgent` paths. **Only** worry about this if you drop
to raw `DurableObject`. There is no API to "force" the SDK to use
`accept()` — that's intentional.

### What survives hibernation

| Survives | Lost |
|---|---|
| `this.state` (SQLite) | in-memory class fields (`this.foo = ...`) |
| `connection.state` (via `serializeAttachment`, max 2 KB) | timers (`setTimeout`, `setInterval`) |
| `this.sql` rows | in-flight promises |
| Connection metadata, tags | local closures |
| Scheduled tasks (DO alarm) | closures captured in `runFiber` (must use `onFiberRecovered` to restart) |

### Auto-response — avoid waking on ping/pong

```ts
this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
```

Registers a fixed request/response answered without waking the DO
(cf-runtime-primitives §4, cf-agents-core §7). Use for keepalives.

---

## Multi-transport agents

Most production agents speak **two** transports:

```
WebSocket primary  (live UI, broadcast state, callable RPC)
   +
HTTP secondary     (webhooks, REST, one-shot fetches)
```

This is the default in the agents-starter (`routeAgentRequest` handles
both URL prefixes — `/agents/<class>/<name>/...`). Only choose a
single transport if you have a specific reason.

A common third surface is **email** (inbound only) — wired via
`routeAgentEmail` from the Worker `email()` handler.

---

## Anti-patterns

| Don't | Do |
|---|---|
| Open SSE on a DO for browser chat | Use WebSocket — hibernation matters. |
| Modify the Response from `routeAgentRequest()` for a WS upgrade | Pass it through. (cf-agents-core §3) |
| Use `@callable()` for server-to-server | Use plain RPC via `getAgentByName(env.X, name).method()`. |
| Trust client-supplied agent name in URL | Resolve from session on the server (`basePath` pattern). |
| Start a new MCP server on SSE | Use streamable-http. SSE is deprecated. |
| Re-use one global `McpServer` across requests in stateless mode | Create per-request. (catalog #6) |
| Open a WebSocket inside a Workflow step | Workflows can't. Update agent state and broadcast from the Agent. |
| Rely on `AbortSignal` from the caller crossing DO RPC | Enforce timeouts inside the DO. (catalog #10) |
