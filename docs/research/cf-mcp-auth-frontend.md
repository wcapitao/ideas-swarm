# Cloudflare Agents — MCP, OAuth, and the Frontend Stack

> Research note for building specialist-level skills on Cloudflare's `agents` SDK: hosting MCP servers via `McpAgent`, wiring OAuth via `workers-oauth-provider`, and consuming agents from React via `agents/react` (`useAgent`) and `@cloudflare/ai-chat/react` (`useAgentChat`), plus how this layer relates to the Vercel AI SDK (`@ai-sdk/react`). Every claim cites either Cloudflare's docs or source files on GitHub.

Sources surveyed:

- Cloudflare docs (HTML + the Markdown variant noted in the page banner: append `index.md`):
  - https://developers.cloudflare.com/agents/model-context-protocol/
  - https://developers.cloudflare.com/agents/guides/remote-mcp-server/
  - https://developers.cloudflare.com/agents/guides/test-remote-mcp-server/
  - https://developers.cloudflare.com/agents/model-context-protocol/transport/
  - https://developers.cloudflare.com/agents/model-context-protocol/authorization/
  - https://developers.cloudflare.com/agents/model-context-protocol/tools/
  - https://developers.cloudflare.com/agents/api-reference/calling-agents/
  - https://developers.cloudflare.com/agents/api-reference/websockets/
- GitHub (read via `raw.githubusercontent.com` and the GitHub REST API):
  - `cloudflare/agents` — `packages/agents/src/{mcp/index.ts, mcp/handler.ts, mcp/auth-context.ts, mcp/types.ts, client.ts, react.tsx}` and `packages/ai-chat/src/{index.ts, react.tsx, ws-chat-transport.ts}`
  - `cloudflare/workers-oauth-provider` — `README.md`
  - `cloudflare/mcp-server-cloudflare` — `README.md`, `apps/workers-bindings/`
  - `cloudflare/agents-starter` — `src/server.ts`, `src/app.tsx`, `src/tools.ts`, `wrangler.jsonc`, `package.json`
  - `modelcontextprotocol/specification` — schema dirs and the published spec at `https://modelcontextprotocol.io/`

Important shape note (read directly off main): in current `cloudflare/agents`, the chat side has been split out of `packages/agents` into a separate package `@cloudflare/ai-chat` (`packages/ai-chat`). `useAgentChat` is now imported from `@cloudflare/ai-chat/react`, and `AIChatAgent` from `@cloudflare/ai-chat`. The original `agents/ai-react` and `agents/ai-chat-agent` paths still appear in older docs but the agents-starter `package.json` and `src/server.ts`/`src/app.tsx` use the new package — this matters when you're writing skills against today's code.

---

## 1. McpAgent class anatomy

### Where it lives

`McpAgent` is exported from the `agents/mcp` subpath of the `agents` package. Source: `cloudflare/agents/packages/agents/src/mcp/index.ts`. It is a Durable Object class that extends the base `Agent` class — both ship in the same `agents` npm package.

> "Cloudflare's Agents SDK includes the `McpAgent` class — built on top of our [Agents SDK](/agents) — which allows you to build remote MCP servers on Cloudflare." — `https://developers.cloudflare.com/agents/model-context-protocol/`

### What the base class gives you (vs. plain `Agent`)

A plain `Agent` is "a Durable Object with batteries": persistent state (`this.setState` / `this.state`), SQL via `this.sql\`...\``, WebSocket support with hibernation, RPC calls, `schedule()`, and a request handler. `McpAgent` adds, on top of that base:

- An MCP server (`McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`) bound to the DO. Tools, resources, and prompts are registered on `this.server`. The class is **abstract** in `server` and `init()` — you must declare both. (`mcp/index.ts:51-52`)
- A pluggable transport selected by the DO's `name` prefix: `sse:<sessionId>`, `streamable-http:<sessionId>`, or `rpc:<sessionId>`. The `getTransportType()` helper reads it off `this.name` and `initTransport()` picks the implementation. (`mcp/index.ts`, "Read the transport type for this agent" comment)
- An `init()` lifecycle hook that runs once before any tool dispatch — call site is `onStart` → `await this.init()`. (`mcp/index.ts:175`)
- A `props` field (`Props extends Record<string, unknown>`) that carries OAuth context from `workers-oauth-provider`. Hydrated on `onStart(props?)`: if invoked with props it persists them, otherwise it restores from DO storage (hibernation recovery).
- Static factory methods returning a `Worker.fetch`-compatible handler: `MyMcp.serve(path, opts)` (default streamable HTTP), `MyMcp.serveSSE(path, opts)` (legacy SSE), and `MyMcp.mount(path, opts)` (legacy alias for `serveSSE`). `serveSSE` simply calls `serve` with `transport: "sse"`. (`mcp/index.ts:424,500-507`)
- A `transport: "auto"` mode that content-sniffs the request and dispatches to either streamable HTTP or SSE — see `createAutoHandler` in `mcp/utils.ts`.
- A separate stateless entrypoint, `createMcpHandler(server, options?)` from `agents/mcp`, for non-DO MCP servers. (`mcp/handler.ts`)
- Auth context plumbing via `getMcpAuthContext()` (uses `AsyncLocalStorage`) for the `createMcpHandler` path. (`mcp/auth-context.ts`)

### Method signatures (read off `packages/agents/src/mcp/index.ts`)

```ts
export abstract class McpAgent<
  Env extends Cloudflare.Env = Cloudflare.Env,
  State = unknown,
  Props extends Record<string, unknown> = Record<string, unknown>
> extends Agent<Env, State, Props> {
  props?: Props;
  abstract server: MaybePromise<McpServer | Server>;
  abstract init(): Promise<void>;

  // Transport bridge — DO name encodes which one
  getTransportType(): "sse" | "streamable-http" | "rpc";
  getSessionId(): string;

  // Static mounts — return a fetch-compatible handler
  static serve(path: string, opts?: ServeOptions): { fetch(req, env, ctx): Promise<Response> };
  static serveSSE(path: string, opts?: ServeOptions): { fetch(...): Promise<Response> };
  static mount(path: string, opts?: ServeOptions): { fetch(...): Promise<Response> }; // legacy alias
}

interface ServeOptions {
  binding?: string;            // default "MCP_OBJECT"
  corsOptions?: CORSOptions;
  transport?: "streamable-http" | "sse" | "auto" | "rpc";  // default "streamable-http"
  jurisdiction?: DurableObjectJurisdiction;                 // for EU-only routing etc.
}
```

`ServeOptions` shape: `cloudflare/agents/packages/agents/src/mcp/types.ts`.

### Tool / resource / prompt registration

Tools, resources, and prompts use the standard `@modelcontextprotocol/sdk` API on `this.server`. From `https://developers.cloudflare.com/agents/model-context-protocol/tools/`:

```ts
this.server.tool(
  "add",
  "Add two numbers together",
  { a: z.number(), b: z.number() },
  async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
);
```

Tools return `{ content: [{ type: "text" | "image" | "resource", ... }], isError?: boolean }`. Resources and prompts use `this.server.resource(...)` and `this.server.prompt(...)`.

### Stateless vs. stateful split

Per the overview and transport docs:

- **Stateful** servers: backed by a Durable Object — `class MyMCP extends McpAgent` — so `this.setState(...)` and `this.sql\`...\`` persist across tool calls *in the same session*. The DO ID is `${transport}:${sessionId}`, derived from the session ID baked into the transport. Mount with `MyMCP.serve("/mcp")` / `serveSSE("/sse")`.
- **Stateless** servers: build an `McpServer` per request and use `createMcpHandler(server, { route: "/mcp", … })`. No DO required, no per-session memory. Source: `mcp/handler.ts`.

The MCP SDK 1.26+ enforces this split: the handler will throw `"Server is already connected to a transport. Create a new McpServer instance per request for stateless handlers."` if you reuse one server across requests.

### Hello world: 30+ lines, 1 tool, served over SSE and streamable HTTP

```ts
// src/index.ts
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Env = { MCP_OBJECT: DurableObjectNamespace };

export class CalculatorMCP extends McpAgent<Env, { count: number }> {
  server = new McpServer({ name: "calculator", version: "0.1.0" });
  initialState = { count: 0 };

  async init() {
    this.server.tool(
      "add",
      "Add two numbers and remember how many calls we've served.",
      { a: z.number(), b: z.number() },
      async ({ a, b }) => {
        this.setState({ count: (this.state?.count ?? 0) + 1 });
        return {
          content: [
            { type: "text", text: `${a + b} (call #${this.state.count})` },
          ],
        };
      },
    );
  }
}

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/sse"))
      return CalculatorMCP.serveSSE("/sse").fetch(req, env, ctx);
    if (url.pathname.startsWith("/mcp"))
      return CalculatorMCP.serve("/mcp").fetch(req, env, ctx);
    return new Response("Not found", { status: 404 });
  },
};
```

…with `wrangler.jsonc`:

```jsonc
{
  "name": "calculator-mcp",
  "main": "src/index.ts",
  "compatibility_date": "2025-04-01",
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [{ "name": "MCP_OBJECT", "class_name": "CalculatorMCP" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["CalculatorMCP"] }]
}
```

This shape mirrors the workers-bindings reference in [`cloudflare/mcp-server-cloudflare/apps/workers-bindings/src/index.ts`](https://github.com/cloudflare/mcp-server-cloudflare/blob/main/apps/workers-bindings/src/index.ts) and the docs at [`/agents/guides/remote-mcp-server/`](https://developers.cloudflare.com/agents/guides/remote-mcp-server/).

---

## 2. Transport choices: SSE vs. streamable HTTP

`McpAgent` ships both transports because the MCP spec is mid-migration.

### MCP spec versions

The spec repo `modelcontextprotocol/specification` contains schemas for at least `2024-11-05`, `2025-03-26`, `2025-06-18`, and `2025-11-25` (the last is what `README.md` of the spec repo currently links to). Streamable HTTP was introduced in `2025-03-26` and is the canonical remote transport from that point onward. Old HTTP+SSE (the `2024-11-05` shape with separate `/sse` and `/sse/message` endpoints) is the legacy mode and is what Cloudflare exposes as `serveSSE`.

### What Cloudflare gives you

From `mcp/index.ts` (`static serve` switch on `transport`):

| Mount | Transport | MCP spec | Endpoints | DO name prefix |
|-------|-----------|----------|-----------|---------------|
| `MyMcp.serve("/mcp")` | `streamable-http` (default) | 2025-03-26+ | `/mcp` (POST + optional GET-with-SSE) | `streamable-http:<sessionId>` |
| `MyMcp.serveSSE("/sse")` | legacy `sse` | 2024-11-05 | `/sse` + `/sse/message` | `sse:<sessionId>` |
| `MyMcp.serve("/mcp", { transport: "auto" })` | auto-detect | both | one path, content-sniffs | n/a |
| `MyMcp.serve("/rpc", { transport: "rpc" })` | Worker → DO RPC | (private) | RPC stub only | `rpc:<sessionId>` |

The recommended production pattern (per the docs and `mcp-server-cloudflare`) is to mount **both** SSE and streamable HTTP at different paths. `cloudflare/mcp-server-cloudflare` README explicitly says: "They support both the `streamable-http` transport via `/mcp` and the `sse` transport (deprecated) via `/sse`."

### Client compatibility (early 2026)

- **Claude Desktop**, the **MCP Inspector** at `https://inspector.modelcontextprotocol.io`, and the [Cloudflare AI playground](https://playground.ai.cloudflare.com/) accept arbitrary remote MCP URLs and walk the user through OAuth automatically. Per `/agents/guides/test-remote-mcp-server/`, Cursor and Windsurf accept a `url`/`serverUrl` field directly.
- For desktop clients without first-class remote MCP support, the recommended bridge is `npx mcp-remote https://your-server/sse` — the same incantation appears in both Cloudflare's "Test a Remote MCP Server" doc and `mcp-server-cloudflare` README.
- The reference SDK `@modelcontextprotocol/sdk` defaults to streamable HTTP when constructing a remote client.

If you only mount one transport: prefer streamable HTTP, and document an `mcp-remote` config block for legacy stdio clients.

---

## 3. Auth in 1 page — `workers-oauth-provider` + `McpAgent`

### What the library is

`cloudflare/workers-oauth-provider` is a TypeScript library that turns a Worker into a full **OAuth 2.1 + PKCE + Dynamic Client Registration** authorization server — the exact subset MCP requires. Source: `cloudflare/workers-oauth-provider/README.md`.

It does for you, automatically:

- Generates `/.well-known/oauth-authorization-server` (RFC 8414).
- Hosts `/authorize`, `/token`, optionally `/register` (RFC 7591 dynamic client registration).
- Issues, refreshes, and revokes tokens; persists them in a KV namespace. *"The library's storage does not store any secrets, only hashes of them."*
- Handles **PKCE** end-to-end (S256 by default; `allowPlainPKCE: false` to disable plain).
- Surfaces grant context to the protected handler via `ctx.props`.

### The wiring shape

Per the README, the canonical setup looks like:

```ts
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { CalculatorMCP } from "./mcp.js";
import { GoogleHandler } from "./google-handler.js"; // your "default" handler

export default new OAuthProvider({
  // Multi-handler form for several protected paths:
  apiHandlers: {
    "/sse": CalculatorMCP.serveSSE("/sse"),
    "/mcp": CalculatorMCP.serve("/mcp"),
  },
  // Single-handler form (alternative):
  // apiRoute: ["/api/", "https://api.example.com/"], apiHandler: ApiHandler,

  // Anything NOT under apiHandlers — login UI, consent screen, OAuth callback.
  defaultHandler: GoogleHandler,

  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["read", "write", "profile"],
  allowImplicitFlow: false,        // OAuth 2.1 default
  allowPlainPKCE: false,           // S256-only
  disallowPublicClientRegistration: false,
});
```

### Consent screen + scope grant

Inside `GoogleHandler.fetch`, when the user hits `/authorize`:

1. Parse the inbound `oauthReqInfo` from the URL (the library puts it there).
2. Redirect the user to your upstream identity provider (Google, GitHub, Cloudflare itself, Stytch, Auth0, WorkOS, Descope) for login.
3. On the OAuth callback, verify the upstream code, extract identity, then call `env.OAUTH_PROVIDER.completeAuthorization({ request: oauthReqInfo, userId, scope, props, metadata })`.
4. The library issues access + refresh tokens to the *MCP client*, redirects to its `redirect_uri`, and stores its own KV record.

`completeAuthorization` is the single chokepoint where you decide which `scope` strings to grant, attach a stable `userId`, and stash arbitrary `props` (e.g. `{ accessToken, refreshToken, accountId, claims, permissions }`) that flow to your `McpAgent` as `this.props`.

The Cloudflare authorization page documents four wiring modes (`/agents/model-context-protocol/authorization/`):
1. **Cloudflare Access OAuth** — SSO-only, no consent screen authoring required.
2. **Third-party OAuth** — GitHub, Google, etc. via your own `defaultHandler`.
3. **Bring-your-own** — Stytch, Auth0, WorkOS, Descope all have working examples linked.
4. **Self-hosted** — your Worker handles everything.

### Reading auth in tools

Per the same docs page:

```ts
type AuthContext = { claims: { sub: string; name: string; email: string }; permissions: string[] };

export class MyMCP extends McpAgent<Env, unknown, AuthContext> {
  server = new McpServer({ name: "Auth Demo", version: "1.0.0" });
  async init() {
    this.server.tool("whoami", "Get the current user", {}, async () => ({
      content: [{ type: "text", text: `Hello, ${this.props.claims.name}!` }],
    }));
  }
}
```

Or, when using `createMcpHandler` instead of the DO subclass, use `getMcpAuthContext()`:

```ts
import { createMcpHandler, getMcpAuthContext } from "agents/mcp";
server.tool("whoami", "...", {}, async () => {
  const auth = getMcpAuthContext();
  const name = (auth?.props?.name as string) ?? "anonymous";
  return { content: [{ type: "text", text: `Hello, ${name}!` }] };
});
```

`getMcpAuthContext` is implemented with `AsyncLocalStorage` (`mcp/auth-context.ts:7-15`).

### Token storage

`workers-oauth-provider` itself stores the OAuth tokens it issues to *MCP clients* in **KV** (the namespace you bind, conventionally `OAUTH_KV`). It does **not** put them in your DO state.

What goes into DO state via `this.props` are the **upstream** access/refresh tokens you receive from your identity provider — i.e. the things your tools need in order to call Google, GitHub, the Cloudflare API, etc. on the user's behalf. These flow from `completeAuthorization({ props })` through `OAuthProvider` into the agent's `ctx.props`, then into `this.props` via `onStart(props)` → `updateProps(props)` → `ctx.storage.put("props", props)` (see `McpAgent.onStart` in `mcp/index.ts`). So they survive hibernation but never travel back to the MCP client.

---

## 4. Production MCP server checklist

Drawn from `cloudflare/mcp-server-cloudflare/packages/mcp-common/`, the docs, and the source:

1. **Rate limits**. Wrap the protected `apiHandler` with the Workers Rate Limiting binding (`env.RATE_LIMITER.limit({ key })`), keyed by `props.userId`. The mcp-common package ships a `withRateLimit(handler)` wrapper.
2. **Scope-based tool gating**. Two valid styles, per the docs: (a) check `this.props.permissions?.includes("admin")` inside the tool handler and return an error message the LLM can read; (b) conditionally `this.server.tool(...)` so the tool is never exposed. Style (b) is safer because the LLM cannot attempt the call.
3. **Audit log**. Wrap each tool handler so the call (`userId`, tool name, args, result-or-error) writes to Workers Analytics Engine or a Logpush dataset. Redact `props.accessToken` / `props.refreshToken` before logging.
4. **Secret rotation**. Upstream identity provider client secrets live in `wrangler secret put` (e.g. `GOOGLE_CLIENT_SECRET`). `workers-oauth-provider` rotates its own signing keys — see the `tokenEndpointAuthMethodsSupported` and key-expiry options in its README.
5. **Observability**. Set `observability.enabled = true` in `wrangler.jsonc` and `wrangler tail` for live logs. The agents package ships `packages/agents/src/observability/mcp.ts` for MCP-specific tracing.
6. **CORS**. Pass `corsOptions` to `serve`/`serveSSE` so browser-based clients (the AI playground, Inspector) connect. The default helper is `handleCORS` in `mcp/utils.ts`. At minimum allow `Content-Type`, `Authorization`, and the `mcp-session-id` header.
7. **Transport dual-mount**. Mount both `serve("/mcp")` and `serveSSE("/sse")` (or use `transport: "auto"`). Document both in your `oauth-protected-resource` metadata.
8. **DO migration tag**. The first deploy must include `migrations: [{ tag: "v1", new_sqlite_classes: ["YourMcpClass"] }]`. The starter and mcp-server-cloudflare do this.
9. **Error surface**. MCP errors must be returned as `{ isError: true, content: [...] }` (or thrown as `McpError`) — never as HTTP 500s. The LLM reads them as tool errors and can recover.
10. **Jurisdiction lock-in (optional)**. `serve(path, { jurisdiction: "eu" })` pins DO instances to the EU region. Useful for GDPR-bound deployments.
11. **`@modelcontextprotocol/sdk` version**. Pin a tested version. The 1.26.0 release introduced the "server already connected" guard — older versions silently accepted reused server instances.
12. **Don't share a class between MCP and chat**. `McpAgent.init()` registers tools idempotently per session; `AIChatAgent` expects `this.messages` to be the source of truth. Use two classes, two bindings.

---

## 5. `agents/client` API

Source: `cloudflare/agents/packages/agents/src/client.ts`. The default export is `AgentClient` (subclass of `PartySocket`), a thin WebSocket client.

### Construction

```ts
import { AgentClient } from "agents/client";

const client = new AgentClient({
  agent: "chat-agent",          // DO class name, kebab-cased
  name: "session-abc123",       // DO instance name → routes all messages here
  host: "my.example.workers.dev", // optional; defaults to window.location
  query: { token: "..." },      // optional querystring for auth/version
  basePath: "agents",           // optional; matches routeAgentRequest's basePath
});
```

### Methods

| Method | Shape | What it does |
|---|---|---|
| `client.send(data)` | inherited from PartySocket | raw WebSocket send |
| `client.call<T>(method, args?, opts?)` | RPC over WS | invokes a server-side `@callable()` method and awaits its return value (with `signal: AbortSignal` for cancellation) |
| `client.stub` | Proxy | typed shorthand: `client.stub.foo(bar)` ≡ `client.call("foo", [bar])` |
| `client.setState(state)` | `void` | optimistically replace local state and broadcast `cf_agent_state` to the server |
| `client.close()` / `reconnect()` | `void` | clean disconnect / forced re-open |

### Events

Beyond raw `message` / `open` / `close` / `error`, the SDK fires:

- `"cf_agent_state"` — server-side `setState` was called; payload is the new state.
- `"cf_agent_mcp_servers"` — when the agent itself has connected to upstream MCP servers via `addMcpServer`, this surfaces the live list of servers + their tools (see `MCPServersState` type in `agents`).

`call()` sits on top of `send` + `message` with a request-id correlation envelope (`{ id, type: "rpc", method, args }` → `{ id, type: "rpc-response", result | error }`).

### Server side: how methods become callable

On the agent class:

```ts
import { Agent, callable } from "agents";

export class CounterAgent extends Agent<Env, { count: number }> {
  initialState = { count: 0 };

  @callable()
  increment() {
    this.setState({ count: this.state.count + 1 });
    return this.state.count;
  }
}
```

`@callable()` is a decorator that registers the method as RPC-reachable. Methods that aren't `@callable()`-tagged are not exposed.

### Routing

The Worker's `fetch` uses `routeAgentRequest(req, env, opts?)` from `agents` to map `/agents/<class-kebab>/<name>/...` to the correct DO. Any request that doesn't match returns `null` so you can fall through to static assets (e.g. `env.ASSETS.fetch(req)`). This is exactly what `agents-starter/src/server.ts` does (just minus the explicit `routeAgentRequest` because the starter's `server.ts` is dominated by `AIChatAgent` config — but the same module exports the helper).

---

## 6. `agents/react`: `useAgent`

Source: `cloudflare/agents/packages/agents/src/react.tsx`.

### Signature

```ts
import { useAgent } from "agents/react";

const agent = useAgent<MyState>({
  agent: "chat-agent",          // class name (kebab-cased on the wire)
  name: "session-abc123",       // DO instance name
  host?: string,
  query?: Record<string, string>,
  basePath?: string,            // e.g. "user" — see UseAgentOptions docs
  // event hooks
  onStateUpdate?: (state: MyState, source: "server" | "client") => void,
  onStateUpdateError?: (error: string) => void,
  onMcpUpdate?: (mcpServers: MCPServersState) => void,
  onOpen?: (e: Event) => void,
  onClose?: (e: CloseEvent) => void,
  onMessage?: (e: MessageEvent) => void,
  onError?: (e: Event) => void,
});
```

The actual `UseAgentOptions<State>` type is in `react.tsx:130-220` and extends the underlying `usePartySocket` options.

### Return value

`useAgent` returns an `AgentClient`-shaped object with extras:

- `agent.state: MyState` — latest server state, kept in sync via `cf_agent_state` events. (`react.tsx:596` shows `options.onStateUpdate?.(parsedMessage.state, "server")` and `:707` shows the local-source path.)
- `agent.setState(next)` — optimistic local update + broadcast.
- `agent.call("toolName", [args])` — typed RPC.
- `agent.stub.toolName(args)` — Proxy shorthand for `call`.
- All raw socket methods from `PartySocket`.

There are typed and untyped overloads (`react.tsx:254` and `:269`); when you pass a generic `useAgent<MyAgent, MyState>(...)` you get a `Stub<MyAgent>` with method types inferred from the server class.

### "5 things this hook gives you that a raw WebSocket doesn't"

1. **State synchronization.** `agent.state` mirrors the DO's `setState`; React re-renders on every change. No manual JSON parsing.
2. **Typed RPC.** `agent.stub.foo(bar)` resolves with the typed return value of the server method. With the dual-overload typing, this includes inferred argument types from your `@callable()` methods.
3. **Reconnection with backoff.** The underlying `PartySocket` reconnects with exponential backoff; `useAgent` re-subscribes to the same DO instance after reconnect, so in-flight RPC calls either resolve or surface a clear error. (See the query-cache and `usePartySocket` integration around `react.tsx:30-100`.)
4. **Lifecycle binding.** The hook closes the socket on unmount and reopens on `name` change, so URL-driven "open conversation X" navigation works without leaks.
5. **MCP fan-in.** When your `Agent` itself uses `addMcpServer(name, url)`, the `cf_agent_mcp_servers` message updates the React-side `MCPServersState` and fires `onMcpUpdate`, so your UI can render "Connect GitHub" / "Tools available" badges. The starter's `app.tsx` uses exactly this for its MCP server panel.

---

## 7. `agents/react`: `useAgentChat` (in `@cloudflare/ai-chat/react`)

> Heads up: in current main, `useAgentChat` lives in `@cloudflare/ai-chat/react` and `AIChatAgent` lives in `@cloudflare/ai-chat`. The legacy `agents/ai-react` and `agents/ai-chat-agent` paths still appear in older docs and may still re-export the same symbols, but the starter's `package.json` and code use the split package.

Source: `cloudflare/agents/packages/ai-chat/src/react.tsx` and `packages/ai-chat/src/index.ts`. `UseAgentChatOptions` is at `react.tsx:366`, `useAgentChat` at `:557`.

### Server side

```ts
// src/agent.ts
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { streamText, tool } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";

export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const result = streamText({
      model: workersai("@cf/moonshotai/kimi-k2.6", {
        sessionAffinity: this.sessionAffinity,
      }),
      system: "You are a helpful assistant.",
      messages: await convertToModelMessages(this.messages),
      tools: {
        getWeather: tool({
          description: "Get the current weather for a city",
          inputSchema: z.object({ city: z.string() }),
          execute: async ({ city }) => ({ city, temperature: 17 }),
        }),
      },
    });
    return result.toUIMessageStreamResponse();
  }
}
```

`this.messages` is persisted to DO SQLite across reconnects. `onChatMessage` is invoked when a new user message arrives over the WS. The starter's actual implementation (`agents-starter/src/server.ts`) shows additional patterns: `pruneMessages` to keep token usage bounded, client-side tools (no `execute` — see §8), approval-required tools, and `mcp.getAITools()` to fan-in upstream MCP server tools.

### Chat-app-in-30-lines pattern

```tsx
// src/app.tsx
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";

export function App() {
  const agent = useAgent({ agent: "chat-agent", name: "default" });
  const { messages, input, handleInputChange, handleSubmit, isLoading } =
    useAgentChat({ agent, initialMessages: [] });

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>
          <b>{m.role}:</b> {m.content}
        </div>
      ))}
      <form onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={handleInputChange}
          disabled={isLoading}
          placeholder="Say something…"
        />
      </form>
    </div>
  );
}
```

The starter's real `app.tsx` is much more elaborate (image attachments, tool-UI parts via `isToolUIPart` / `getToolName`, MCP server-management UI, theme toggle), but this is the minimum.

### Streaming, optimistic, history

- **Streaming**: `useAgentChat` patches the last message in `messages` on every chunk. A normal `messages.map(m => ...)` render is therefore already streaming, as long as you `key={m.id}` (not by index — see Gotchas).
- **Optimistic**: `handleSubmit` immediately appends the `user` message before the server has acknowledged it; `useAgentChat` reconciles when the server echoes its persisted version (the chat package's `reconcileMessages` from `agents/chat`).
- **Persisting history**: free — `AIChatAgent` writes `this.messages` to DO SQLite on every turn. On reconnect, the DO replays history into the hook's initial state, governed by `maxPersistedMessages`.

---

## 8. AI SDK integration: when to use `@ai-sdk/react useChat` vs `useAgentChat`

Both hooks render Vercel AI SDK `UIMessage`s. The difference is what's on the other end of the wire.

| Need | Pick |
|---|---|
| Stateless chat against a Worker that returns `streamText().toUIMessageStreamResponse()` | `@ai-sdk/react useChat` over HTTP |
| Server holds conversation state, schedules background work, has tools, runs upstream MCP servers | `useAgentChat` over WebSocket against an `AIChatAgent` DO |
| Multi-tab sync of the *same* conversation | `useAgentChat` (DO is the source of truth; both tabs subscribe to the same `name`) |
| You already have a `/api/chat` route and don't want a DO | `@ai-sdk/react useChat` |

### Client-side tools — the same pattern in both

The Vercel AI SDK lets you declare tools that the *client* executes. In `useAgentChat` this looks identical to `useChat`:

```ts
// In your `tools` object on the server, declare a tool with NO execute fn.
getUserTimezone: tool({
  description: "Get the user's timezone from their browser.",
  inputSchema: z.object({}),
}), // no execute → client must handle
```

…and on the client, intercept tool-invocation parts and resolve them via `addToolResult` (Vercel AI SDK) or the equivalent in `useAgentChat`. The starter does this with `getUserTimezone` and `calculate` (the latter requires user approval).

### Bridging an `AIChatAgent` to plain `useChat`

If you must drive `useChat` (not `useAgentChat`) against an `AIChatAgent`, expose an HTTP route on the agent and forward through `routeAgentRequest`:

```ts
export class ChatAgent extends AIChatAgent<Env> {
  async onRequest(req: Request) {
    if (new URL(req.url).pathname.endsWith("/chat")) {
      const body = await req.json<{ messages: UIMessage[] }>();
      this.messages = body.messages;
      const result = streamText({ model: ..., messages: this.messages });
      return result.toUIMessageStreamResponse();
    }
    return super.onRequest(req);
  }
}

// Worker fetch:
fetch: (req, env) => routeAgentRequest(req, env) ?? env.ASSETS.fetch(req)

// In React:
const { messages, ... } = useChat({ api: "/agents/chat-agent/default/chat" });
```

This bypasses the WS-based optimistic reconciliation, so you'll lose multi-tab sync — only do this if you specifically need `useChat`.

---

## 9. Authoring a chat agent end-to-end

Walking the ~200-line stack from [`cloudflare/agents-starter`](https://github.com/cloudflare/agents-starter):

### `wrangler.jsonc` (~20 lines)

```jsonc
{
  "name": "ai-ideator-chat",
  "main": "src/server.ts",
  "compatibility_date": "2025-04-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "directory": "public", "binding": "ASSETS" },
  "ai": { "binding": "AI" },
  "durable_objects": {
    "bindings": [{ "name": "Chat", "class_name": "ChatAgent" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ChatAgent"] }],
  "vars": { "MODEL": "@cf/moonshotai/kimi-k2.6" }
}
```

The DO `class_name` matches `ChatAgent` in `server.ts`. `assets.directory = "public"` lets the same Worker serve the React bundle. The starter binds Workers AI; swap to `OPENAI_API_KEY` + `@ai-sdk/openai` if you want OpenAI.

### `src/server.ts` (~80 lines)

```ts
import { routeAgentRequest, callable } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { createWorkersAI } from "workers-ai-provider";
import { convertToModelMessages, pruneMessages, streamText, tool } from "ai";
import { z } from "zod";

type Env = { AI: Ai; ASSETS: Fetcher; Chat: DurableObjectNamespace };

export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;

  onStart() {
    // Smooth OAuth popup UX for upstream MCP servers we connect to
    this.mcp.configureOAuthCallback({
      customHandler: (result) =>
        result.authSuccess
          ? new Response("<script>window.close();</script>", {
              headers: { "content-type": "text/html" },
            })
          : new Response(`Auth failed: ${result.authError ?? "unknown"}`, {
              status: 400,
            }),
    });
  }

  @callable() async addServer(name: string, url: string) {
    return await this.addMcpServer(name, url);
  }
  @callable() async removeServer(serverId: string) {
    await this.removeMcpServer(serverId);
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const mcpTools = this.mcp.getAITools(); // upstream MCP tools
    const workersai = createWorkersAI({ binding: this.env.AI });
    const result = streamText({
      model: workersai("@cf/moonshotai/kimi-k2.6", {
        sessionAffinity: this.sessionAffinity,
      }),
      system: "You are a concise assistant. Use tools when helpful.",
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
      }),
      tools: {
        ...mcpTools,
        getWeather: tool({
          description: "Get the current weather for a city",
          inputSchema: z.object({ city: z.string() }),
          execute: async ({ city }) => ({ city, temperature: 17 }),
        }),
        // Client-side tool — no execute; the browser handles it
        getUserTimezone: tool({
          description: "Get the user's timezone from their browser.",
          inputSchema: z.object({}),
        }),
      },
    });
    return result.toUIMessageStreamResponse();
  }
}

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) =>
    routeAgentRequest(req, env) ?? env.ASSETS.fetch(req),
};
```

This is the actual shape of `agents-starter/src/server.ts` (truncated for the report; the real file adds an `inlineDataUrls` pre-pass for image data URIs, a calculation-with-approval tool, and Workers Scheduler integration).

### `src/app.tsx` (~60 lines)

```tsx
import { useState } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { createRoot } from "react-dom/client";

function App() {
  const [name] = useState(() => crypto.randomUUID());
  const agent = useAgent({ agent: "chat-agent", name });
  const { messages, input, handleInputChange, handleSubmit, isLoading } =
    useAgentChat({ agent, initialMessages: [] });

  return (
    <div className="chat">
      <ul>
        {messages.map((m) => (
          <li key={m.id} className={m.role}>
            <span>{m.role}</span>
            <p>{m.content}</p>
          </li>
        ))}
      </ul>
      <form onSubmit={handleSubmit}>
        <input
          autoFocus
          disabled={isLoading}
          value={input}
          onChange={handleInputChange}
          placeholder="Say something…"
        />
      </form>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
```

`wrangler dev`, open `http://localhost:8787`, type. The conversation persists per `name`; reload with the same name and you get history. Source: `cloudflare/agents-starter/src/app.tsx`.

### Adding a sibling MCP server

In a new file `src/mcp.ts`:

```ts
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export class IdeatorMCP extends McpAgent {
  server = new McpServer({ name: "ideator", version: "0.1.0" });
  async init() {
    this.server.tool(
      "recombine",
      "Recombine two concepts into a new business idea",
      { a: z.string(), b: z.string() },
      async ({ a, b }) => ({
        content: [{ type: "text", text: `Combine ${a} and ${b}: …` }],
      }),
    );
  }
}
```

…then in `wrangler.jsonc` add a second binding `IdeatorMCP` and migration tag, and in the default fetch route both `/mcp` and `/sse` to `IdeatorMCP.serve` / `serveSSE`:

```ts
const url = new URL(req.url);
if (url.pathname.startsWith("/mcp"))
  return IdeatorMCP.serve("/mcp").fetch(req, env, ctx);
if (url.pathname.startsWith("/sse"))
  return IdeatorMCP.serveSSE("/sse").fetch(req, env, ctx);
return routeAgentRequest(req, env) ?? env.ASSETS.fetch(req);
```

Now `https://your-worker/mcp` is consumable by Claude Desktop, Cursor, and the AI playground, and `/agents/chat-agent/...` is the conversation UI. Both classes are independent DOs in the same Worker.

---

## 10. Gotchas

A non-exhaustive list, drawn from the docs and source:

1. **Token leakage in client state.** Don't put OAuth refresh tokens or upstream API keys in `agent.setState({...})` — that state is broadcast to every connected browser via `cf_agent_state`. Stash them in `this.props` (server-only, persisted to DO storage by `onStart`/`updateProps`) or a private SQL table. Source: `mcp/index.ts` `onStart` + `updateProps`.
2. **MCP transport mismatches.** Some clients support only SSE; others only streamable HTTP. Mount both, surface both URLs in your `oauth-protected-resource` metadata, or use `transport: "auto"`. Source: `/agents/model-context-protocol/transport/`.
3. **SSE proxying.** Workers themselves don't buffer, but Pages Functions and certain reverse-proxy setups do, which breaks streaming. Prefer plain Worker custom domains for `/sse`.
4. **Hibernation + WS reconnect.** When the DO hibernates and a new WS connects, `onStart()` runs with no `props` argument — `McpAgent.onStart` then restores from `ctx.storage.get("props")`. If you ever bypass `updateProps` and assign `this.props = ...` directly without persisting, hibernation will silently drop them.
5. **First-deploy migrations.** First deploy must include `migrations: [{ tag: "v1", new_sqlite_classes: ["YourClass"] }]`. Without it, deploy succeeds but the DO can't be instantiated.
6. **`mcp-session-id` header.** Streamable HTTP carries the session ID in `mcp-session-id`. If your front Workers Routes or middleware strip non-standard headers, multi-turn breaks. Add it to `corsOptions.headers` and any rewriting middleware allow-list.
7. **Streaming after `onFinish`.** Mutate `this.messages` only inside the `onFinish` callback of `streamText`; mutating mid-stream races with the AI SDK's own buffer. Source: `ai-chat/src/react.tsx` reconcile path.
8. **OAuth provider KV vs DO.** `workers-oauth-provider` needs a KV binding (conventionally `OAUTH_KV`). Don't try to fold token storage into the same DO as your MCP server — refresh-token rotation must outlive any single DO instance and KV is the explicit design.
9. **Dynamic Client Registration must be enabled.** MCP clients (Claude Desktop, Inspector, the Cloudflare AI playground) discover your auth server via `/.well-known/oauth-authorization-server` and self-register at `/register`. If you disable `clientRegistrationEndpoint`, every client must be pre-registered.
10. **Streaming token UX flicker.** With `useAgentChat`, the last message is patched in place on every chunk. If you `key={i}` the rendered list, the entire list re-keys on every chunk and React tears. Always `key={m.id}`.
11. **`useChat` vs `useAgentChat` cookie semantics.** `useChat` uses `fetch` and respects `credentials: "include"` for cookies. `useAgentChat` uses a WebSocket and does not carry HTTP cookies — pass auth via the `query` param to `useAgent` and check it server-side in `onConnect`.
12. **Agent name length.** DO instance names map 1:1 to `name` in `useAgent({ name })`. Names longer than 243 chars or containing path separators silently break routing. Use `crypto.randomUUID()` or a hash.
13. **Cold-start cost on first tool call.** First MCP request to a new session pays the DO cold-start. Pre-warm by hitting `/sse` (or sending `tools/list`) before the user's first user-facing action.
14. **Scope enforcement is your job.** `workers-oauth-provider` issues tokens with whatever scopes you wrote into `completeAuthorization`, but it does **not** stop a tool from running based on scope. Gate inside `init()` (preferred — don't register the tool at all) or inside the tool body (return an error message).
15. **Don't share a class between MCP and chat.** They have different invariants. Use two classes, two bindings.
16. **Stateless `createMcpHandler` requires fresh `McpServer` per request.** As of `@modelcontextprotocol/sdk` 1.26+, reusing a server across calls throws. The handler in `mcp/handler.ts` performs the check explicitly.
17. **Package layout shift.** `useAgentChat` and `AIChatAgent` were split out of `agents` into `@cloudflare/ai-chat`. If you scaffold from older docs that say `import { useAgentChat } from "agents/ai-react"` and your `package.json` lists current `agents`, the import may resolve to a re-export but you should align with the starter and use `@cloudflare/ai-chat/react`.

---

### Appendix: file map

| Path | Purpose |
|---|---|
| `cloudflare/agents/packages/agents/src/index.ts` | `Agent` base DO, `routeAgentRequest`, `callable` |
| `cloudflare/agents/packages/agents/src/mcp/index.ts` | `McpAgent`, `serve`, `serveSSE`, `mount` |
| `cloudflare/agents/packages/agents/src/mcp/handler.ts` | stateless `createMcpHandler` |
| `cloudflare/agents/packages/agents/src/mcp/auth-context.ts` | `getMcpAuthContext`, `runWithAuthContext` (AsyncLocalStorage) |
| `cloudflare/agents/packages/agents/src/mcp/transport.ts` | `McpSSETransport`, `StreamableHTTPServerTransport` |
| `cloudflare/agents/packages/agents/src/mcp/types.ts` | `ServeOptions`, `TransportType`, `CORSOptions` |
| `cloudflare/agents/packages/agents/src/client.ts` | `AgentClient` browser client |
| `cloudflare/agents/packages/agents/src/react.tsx` | `useAgent` hook |
| `cloudflare/agents/packages/ai-chat/src/index.ts` | `AIChatAgent` DO base class |
| `cloudflare/agents/packages/ai-chat/src/react.tsx` | `useAgentChat` hook |
| `cloudflare/agents/packages/ai-chat/src/ws-chat-transport.ts` | WS transport for chat hook |
| `cloudflare/workers-oauth-provider/README.md` | full `OAuthProvider` config reference |
| `cloudflare/mcp-server-cloudflare/apps/workers-bindings/` | reference production MCP server |
| `cloudflare/agents-starter/src/{server.ts,app.tsx,wrangler.jsonc}` | end-to-end chat starter |
