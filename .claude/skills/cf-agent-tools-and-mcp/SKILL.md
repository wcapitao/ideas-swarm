---
name: cf-agent-tools-and-mcp
description: >
  Builds tools and MCP servers for Cloudflare Agents. Activates when the
  user asks to "add a tool", "register a tool", "expose this as a tool",
  "build an MCP server", "remote MCP", "Cloudflare MCP", "tool calling",
  or wires a Cloudflare agent to external clients (Claude Desktop, Cursor,
  the AI playground). Covers the three flavors: in-Agent `@callable()`
  methods, stateful `McpAgent` (DO-backed), and stateless
  `createMcpHandler`. Encodes tool registration via side-effect imports,
  the codemode-skips-`needsApproval` gotcha, the fresh-`McpServer`-per-
  request rule (MCP SDK >=1.26.0), Zod input schemas, `isError` returns,
  and the dual `/sse` + `/mcp` mount. Ships `lint-tool-descriptions.ts`
  and `mcp-doctor.sh`. Do NOT use for prompt tweaks (cf-agent-models-and-
  gateway), OAuth flows (cf-agent-auth-and-permissions), or tool tests
  (cf-agent-tests-and-evals).
---

# Cloudflare Agent Tools & MCP

Tools are typed functions the LLM can call. On Cloudflare you have **three
flavors**, each backed by a different primitive. Pick wrong and you spend a
day fighting transports or DO migrations.

## Decide the flavor first

```
Is the tool only used by *this* agent's own LLM calls?
  -> yes -> @callable() method on the Agent class
            (also: server-to-server RPC; no decorator needed for
             getAgentByName(...).method())

Should external MCP clients (Claude Desktop, Cursor, AI playground,
ChatGPT MCP, Inspector) discover and call this tool?
  - tool needs per-session state, persistence, or hibernation
       -> McpAgent (DO-backed, extends Agent)
  - tool is pure / stateless / per-request
       -> createMcpHandler (no DO, single fetch handler)

Is the tool heavy (>30s, multi-step, retry-on-failure)?
  -> don't run it inline. Return a Workflow handle. Schedule via
     this.runWorkflow(...) and have the workflow call back via
     step.updateAgentState() / this.sendWorkflowEvent().
     (cf-agents-core §6, "Workflows from agents")
```

The shorthand: `@callable` = inside the agent. `McpAgent` = stateful
remote MCP. `createMcpHandler` = stateless remote MCP. Anything else,
delegate to a Workflow.

`references/tool-flavors.md` has the full comparison table.

---

## 1. Authoring a `@callable` tool

`@callable()` exposes an Agent instance method as RPC over WebSocket
(client -> server) and as typed RPC over DO bindings (server -> server).
Source: `agents` package, `src/index.ts` (cf-github-canon §1).

### Minimum viable shape

```ts
import { Agent, callable, type StreamingResponse } from "agents";
import { z } from "zod";

type Env = { /* generated via `wrangler types` */ };
type State = { count: number };

export class Counter extends Agent<Env, State> {
  initialState: State = { count: 0 };

  @callable({ description: "Increment the counter and return new value." })
  async increment(by = 1): Promise<number> {
    // Validate inputs explicitly — decorators don't auto-coerce
    const safe = z.number().int().min(1).max(1000).parse(by);
    this.setState({ count: this.state.count + safe });
    return this.state.count;
  }

  @callable({ description: "Stream tokens from the LLM", streaming: true })
  async generate(stream: StreamingResponse, prompt: string) {
    const safePrompt = z.string().min(1).max(10_000).parse(prompt);
    try {
      for await (const chunk of llm(safePrompt)) stream.send(chunk);
      stream.end();
    } catch (e) {
      stream.error((e as Error).message);
    }
  }
}
```

### Rules that bite

1. **TC39 decorators only.** Do **not** set `experimentalDecorators: true`
   in `tsconfig.json`; it silently breaks `@callable()` at runtime.
   Extend `agents/tsconfig` and add the `agents()` Vite plugin (Oxc does
   not yet support TC39 decorators natively). cf-agents-core §15;
   SKILL_CATALOG cross-cutting #4.
2. **Args/returns must be JSON-serializable.** Functions, `Date`, `Map`,
   `Set` do not survive the wire — use ISO strings. cf-agents-core §1.
3. **`needsApproval` is for AI-SDK `tool()` definitions, not for
   `@callable`.** If you need approval on a `@callable` method, gate it
   yourself (return a sentinel, surface in state, wait for follow-up
   call). The dedicated approval pipeline lives on `tool({ needsApproval })`
   inside `streamText({ tools })`. See §4.
4. **`AbortSignal` does not cross DO RPC.** Build the controller inside
   the DO. cf-agents-core §15; SKILL_CATALOG #10.
5. **Errors -> don't throw across the wire.** Throwing makes the client
   see `"Connection closed"`. Return a discriminated error result
   instead:
   ```ts
   @callable() async charge(amount: number) {
     try { return { ok: true as const, txId: await pay(amount) }; }
     catch (e) { return { ok: false as const, error: (e as Error).message }; }
   }
   ```

### Server-to-server: no decorator needed

```ts
const stub = await getAgentByName(env.Counter, "global");
await stub.increment(5);    // works without @callable for DO RPC
```

`@callable()` only matters for **client -> server** RPC over WebSocket.
Worker -> Agent and Agent -> Agent calls go through the standard DO RPC
boundary. cf-mcp-auth-frontend §5.

---

## 2. Authoring an `McpAgent` (stateful, DO-backed)

`McpAgent` extends `Agent`, so you keep `setState`, `this.sql`, schedules,
hibernation. On top: a per-session `McpServer`, a transport selected by
the DO `name` prefix (`sse:` / `streamable-http:` / `rpc:`), an abstract
`init()` that runs once before any tool dispatch, and `props` for OAuth
context. cf-mcp-auth-frontend §1; cf-github-canon Appendix.

### Minimal McpAgent + dual mount

```ts
// src/mcp.ts
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Env = { MCP_OBJECT: DurableObjectNamespace };
type State = { count: number };
type Props = { userId: string; scopes: string[] };

export class CalculatorMCP extends McpAgent<Env, State, Props> {
  server = new McpServer({ name: "calculator", version: "0.1.0" });
  initialState: State = { count: 0 };

  async init() {
    // init() runs once per session before the first tool dispatch.
    this.server.tool(
      "add",
      "Add two numbers and return the sum.",
      { a: z.number(), b: z.number() },
      async ({ a, b }) => {
        try {
          this.setState({ count: this.state.count + 1 });
          return { content: [{ type: "text", text: `${a + b} (call #${this.state.count})` }] };
        } catch (e) {
          return { isError: true, content: [{ type: "text", text: `add failed: ${(e as Error).message}` }] };
        }
      },
    );
  }
}

// src/index.ts — Worker entry; dual-mount /mcp + /sse
export { CalculatorMCP } from "./mcp.js";
export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/mcp")) return CalculatorMCP.serve("/mcp").fetch(req, env, ctx);
    if (url.pathname.startsWith("/sse")) return CalculatorMCP.serveSSE("/sse").fetch(req, env, ctx);
    return new Response("Not found", { status: 404 });
  },
};
```

`wrangler.jsonc` essentials: `compatibility_flags: ["nodejs_compat"]`, a
`durable_objects.bindings` entry pointing `MCP_OBJECT` at `CalculatorMCP`,
and `migrations: [{ tag: "v1", new_sqlite_classes: ["CalculatorMCP"] }]`.
**`new_sqlite_classes`, not `new_classes`**, and once SQLite-backed it
stays so — you cannot retrofit. SKILL_CATALOG #3.

### Transport-aware DO naming

`McpAgent.serve()` produces a fetch handler that derives the DO name
from the URL plus a session ID, prefixed with the transport:

| Mount | Transport | DO name prefix |
|-------|-----------|----------------|
| `serve("/mcp")` (default) | `streamable-http` | `streamable-http:<sid>` |
| `serveSSE("/sse")` | `sse` (deprecated) | `sse:<sid>` |
| `serve("/x", { transport: "auto" })` | content-sniffed | dynamic |
| `serve("/rpc", { transport: "rpc" })` | RPC (in-platform) | `rpc:<sid>` |

The recommended production posture is to mount **both** `/mcp` and
`/sse` so legacy clients still work. cf-mcp-auth-frontend §2.

### `serve()` vs `serveSSE()`

```ts
// Streamable HTTP (MCP spec 2025-03-26+; canonical for new work)
export default CalculatorMCP.serve("/mcp", {
  binding: "MCP_OBJECT",   // default
  jurisdiction: "eu",      // GDPR pin
  corsOptions: { /* ... */ },
});

// Legacy SSE (spec 2024-11-05; some older Claude Desktop builds, Inspector)
export default CalculatorMCP.serveSSE("/sse");
```

`serveSSE` calls `serve` with `transport: "sse"`. `mount(...)` is a
deprecated alias. `references/tool-flavors.md` covers the spec-version
matrix.

### Side-effect tool registration (mcp-server-cloudflare pattern)

For >5 tools, don't pile them into `init()`. Use side-effect imports,
exactly the way `cloudflare/mcp-server-cloudflare` and `vantage-mcp-
server` do (cf-github-canon §4): one `registerXxxTools(server)` per
domain, called from `init()`.

```ts
// src/tools/accounts.ts
export function registerAccountTools(server: McpServer) {
  server.tool("list_accounts", "List the user's accounts.", { ... }, handler);
  // ...
}

// src/mcp.ts
async init() {
  registerAccountTools(this.server);
  if (this.props?.scopes?.includes("admin")) registerAdminTools(this.server);
}
```

Conditional registration is **safer than runtime checks** — the LLM
never sees a tool it isn't allowed to call. Full pattern in
`references/tool-registration.md`. cf-mcp-auth-frontend §4.

### Reading auth context

```ts
async init() {
  this.server.tool("whoami", "Return current user.", {}, async () => ({
    content: [{ type: "text", text: `Hello ${this.props?.userId ?? "anon"}` }],
  }));
}
```

`this.props` is hydrated by `OAuthProvider.completeAuthorization({ props })`
on first connect, then persisted by `McpAgent.onStart`/`updateProps` to
DO storage so it survives hibernation. **Never** put OAuth tokens or
secrets into `setState` — `setState` broadcasts to all WebSocket clients.
SKILL_CATALOG #1; cf-mcp-auth-frontend §10.

---

## 3. Authoring a `createMcpHandler` (stateless)

When you don't need per-session state, skip the DO. Stateless is also
the right shape for tools that wrap a request-scoped external API.

```ts
// src/index.ts
import { createMcpHandler, getMcpAuthContext } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

function createServer(): McpServer {
  // CRITICAL: build a fresh server per request. MCP SDK >=1.26.0 throws
  // "Server is already connected to a transport" if reused. Older versions
  // would silently leak responses across clients (CVE). SKILL_CATALOG #6.
  const s = new McpServer({ name: "echo", version: "0.1.0" });
  s.tool(
    "echo",
    "Echo a string back, with the calling user's name if authenticated.",
    { text: z.string().min(1).max(2000) },
    async ({ text }) => {
      const auth = getMcpAuthContext();
      const who = (auth?.props?.userId as string) ?? "anonymous";
      return { content: [{ type: "text", text: `${who} said: ${text}` }] };
    },
  );
  return s;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    return createMcpHandler(createServer(), {
      route: "/mcp",
      sessionIdGenerator: () => crypto.randomUUID(),
      corsOptions: { allowHeaders: ["Content-Type", "Authorization", "mcp-session-id"] },
    })(req, env, ctx);
  },
};
```

### `getMcpAuthContext()` — read auth inside a stateless tool

`createMcpHandler` runs each tool inside an `AsyncLocalStorage` scope
populated by the surrounding OAuth handler. `getMcpAuthContext()` (from
`agents/mcp`, file `mcp/auth-context.ts`) reads it. cf-mcp-auth-frontend §1.

```ts
const auth = getMcpAuthContext();
if (!auth?.props?.scopes?.includes("write")) {
  return { isError: true, content: [{ type: "text", text: "missing write scope" }] };
}
```

### When `createMcpHandler` is the right choice

- Tool reads from a global cache or a request-scoped fetch.
- You're wrapping an existing REST API and don't want a DO.
- You expect **high tool QPS** and want per-request horizontal scaling
  rather than DO concentration.
- Production examples: `cloudflare/agents/examples/mcp-worker`,
  `getsentry/sentry-mcp` (rate-limited, stateless). cf-github-canon §4.

When NOT to use it: any tool that needs to remember things between
calls in the same session, schedule alarms, or hold a SQL table.

---

## 4. Approval flows — `needsApproval` and the codemode caveat

`needsApproval` lives on the **AI-SDK `tool()` definition**, not on
`@callable`. It's how `AIChatAgent` (and the `streamText` tool surface)
gates dangerous operations:

```ts
// inside async onChatMessage(...) on an AIChatAgent
tools: {
  processPayment: tool({
    description: "Charge the user's card.",
    inputSchema: z.object({ amountUsd: z.number(), recipient: z.string() }),
    needsApproval: async ({ amountUsd }) => amountUsd > 100,
    execute: async ({ amountUsd, recipient }) => charge(amountUsd, recipient),
  }),
},
```

Flow: model emits call -> SDK runs `needsApproval` -> if true, tool
surfaces in the UI stream as `state: "approval-required"` -> browser
calls `addToolApprovalResponse(toolCallId, approved)` via `useAgentChat`
-> SDK runs `execute` or returns a rejection. cf-mcp-auth-frontend §7;
agents-starter `src/server.ts` (the `calculate` tool).

### The codemode caveat (cf-agents-core §15)

> "**`needsApproval` is *not* honored in codemode** — approval-required
> tools execute without prompt."

If you wrap tools in `createCodeTool({ tools, executor })` (the LLM
writes JS that orchestrates tools), the `needsApproval` predicate is
**bypassed** — LLM-authored code calls `execute` directly. Two fixes:

- **Don't expose dangerous tools to codemode.** Keep them out of the
  `tools` map passed to `createCodeTool`.
- **Gate inside `execute` itself.** Validate independently of
  `needsApproval` so the gate fires either way.

For `McpAgent` tools (no `needsApproval` in the MCP protocol), either
gate inside the handler or use **MCP elicitation**:

```ts
const r = await this.server.server.elicitInput(
  { message: `Confirm transfer of $${amount}?`,
    requestedSchema: { type: "object", properties: { confirm: { type: "boolean" } }, required: ["confirm"] } },
  { relatedRequestId: extra.requestId },
);
if (r.action !== "accept" || !r.content?.confirm)
  return { isError: true, content: [{ type: "text", text: "User declined." }] };
```

Elicitation is opt-in per client (Claude Desktop yes, others vary) — always
have a fallback. cf-agents-core §10. Full state diagram in
`references/approval-flows.md`.

---

## 5. Tool descriptions — LLM-facing contract

The model reads every tool's `description` on every turn. Vague
descriptions -> low invocation rate -> "the agent doesn't use my tool".

Rules:

- **First sentence: what it does.** ("Charge the user's card.")
- **Second sentence: when to use it.** ("Use only after the user
  confirms the order total.")
- No filler ("This is a tool that..."). No hedges ("might", "sometimes").
- Be explicit about side effects (writes, network, charges) and
  cost/latency shape if it matters.

```
BAD : "weather" -> "Gets weather"
GOOD: "weather" -> "Get current weather for a city. Use only when the
                    user asks for weather, conditions, or temperature."
```

Lint with `scripts/lint-tool-descriptions.ts`. It extracts `tool(...)`,
`server.tool(...)`, and `@callable({ description })` calls and flags:
descriptions <40 chars, no action verb in the first 5 words, parameter-
list re-statements ("Takes a, b, c"), duplicates, hedge words, TODOs.

```bash
bunx tsx scripts/lint-tool-descriptions.ts ./src/tools
```

Inspired by `audit-agent-descriptions.py` from agent-subagent-
orchestration; same problem, different surface.

---

## 6. Schema discipline

Tool inputs are validated by Zod on the TS side. The MCP layer ships
the schema as **JSON Schema** in the `tools/list` capabilities response —
the model reads it.

```ts
// Always describe each field. This lands in JSON Schema.
{
  city:    z.string().describe("ISO city name, e.g. 'London'"),
  units:   z.enum(["metric", "imperial"]).default("metric"),
  pageSize: z.number().int().min(1).max(100).default(20),
  ids:     z.array(z.string().uuid()).max(50),
  filter:  z.string().optional().describe("Optional substring match"),
}
```

Common mistakes:

- `z.any()` / `z.unknown()` — produces empty JSON Schema; model has no
  idea what to send. Always specify a shape.
- Missing `.describe()` per field — model guesses semantics.
- **Raw shape vs wrapped `z.object`**: `McpAgent.server.tool` takes the
  **raw object shape** (`{ a: z.number() }`); Vercel AI SDK
  `tool({ inputSchema })` takes the **wrapped** form. Mixing up gives
  cryptic errors.
- `z.union` with no discriminator — renders as `anyOf`; prefer
  `z.discriminatedUnion`.

`references/schema-cookbook.md` has 12 ready-to-paste patterns.

---

## 7. Error handling — `isError` in tool results

MCP tools return a structured result. **Never throw** out of a tool
handler — exceptions surface as JSON-RPC 500s and the model sees "tool
failed" with no detail.

```ts
// success
return { content: [{ type: "text", text: "..." }] };

// failure — model-facing, recoverable
return {
  isError: true,
  content: [{ type: "text", text: "DB unavailable: timeout after 5s. Try again." }],
};
```

What to include in the error string: concrete cause ("HTTP 503"), whether
retryable, retry hint if applicable. **Do NOT include secrets, stack
traces, or internal IDs** — the model echoes errors back to the user.

Three error layers:

```
LLM       <- isError + content[]                  (recoverable, in-band)
User      <- chat UI rendering of above           (model summarizes)
Operator  <- Logpush / Tail / observability       (full detail; agents:mcp)
```

Log full error info via the observability layer, **not** via the tool
result. cf-agents-core §15.

For `@callable` methods, prefer the discriminated-result pattern from §1
over throwing.

---

## 8. Hand-offs

| If the user... | Hand off to |
|---|---|
| asks about OAuth, scopes, `__Host-` cookies, `workers-oauth-provider`, securing the MCP | **cf-agent-auth-and-permissions** |
| asks to test a tool, write a vitest for `runInDurableObject`, or stub `env.AI.run` | **cf-agent-tests-and-evals** |
| asks "which model should I use for tool calling", "tune the system prompt", "use AI Gateway" | **cf-agent-models-and-gateway** |
| asks about scheduled or long-running tools (>30s) | **cf-agent-workflows-and-scheduling** |
| asks about `setState` broadcast, `this.sql`, hibernation footguns | **cf-agent-state-and-storage** |
| asks "which shape should the agent take" or "do I need an MCP server at all" | **cf-agent-architect** |

---

## 9. Non-negotiables (cross-cutting from SKILL_CATALOG)

These apply to every Cloudflare Agent skill. Tools/MCP code that violates
them is rejected at review.

1. **Never put secrets in `setState`** — broadcasts to clients. Use
   `this.props` or `this.sql`. (#1)
2. **`acceptWebSocket()` not `accept()`** — only relevant if you bypass
   the SDK, but worth knowing. (#2)
3. **`new_sqlite_classes` not `new_classes`** in migrations — and once
   chosen, can't be retrofitted. (#3)
4. **No `experimentalDecorators: true`** — silently breaks `@callable()`.
   Extend `agents/tsconfig`. (#4)
5. **AI Gateway in front of every LLM call** — caching, rate limit,
   fallback. (#5)
6. **Fresh `McpServer` per request** in `createMcpHandler`. (#6)
7. **Vitest pool with `--no-isolate`** for WS DO tests. (#7)
8. **`vi.spyOn(env.AI, "run")`** is the canonical Workers AI mock. (#8)
9. **Use `AIChatAgent` from `@cloudflare/ai-chat`**, not the deprecated
   `agents/ai-chat-agent` shim. (#9)
10. **`AbortSignal` does not cross DO RPC** — controllers must be built
    inside the DO. (#10)

Plus tool-specific:

- **Tool descriptions are LLM-facing contract** — lint them.
- **Return `isError: true`, never throw** out of a tool handler.
- **Side-effect-import for >5 tools** — keep the entry file readable.
- **Dual-mount `/mcp` and `/sse`** — until SSE clients die out.
- **Codemode bypasses `needsApproval`** — gate inside `execute` for
  destructive tools, or don't expose them to codemode.

---

## 10. Diagnosing a broken MCP server

Run `scripts/mcp-doctor.sh <url>` against a deployed worker. It hits
`/mcp` (and falls back to `/sse`) with a real MCP `initialize` +
`tools/list` over JSON-RPC, then reports:

- HTTPS reachability + TLS
- `initialize` handshake protocol version
- transport detected (`streamable-http` / `sse`)
- capabilities returned
- tool count + first 5 tool names
- whether auth was required (`401` / `WWW-Authenticate` shape)
- CORS preflight (for browser clients)

```bash
./scripts/mcp-doctor.sh https://my-mcp.workers.dev
./scripts/mcp-doctor.sh https://my-mcp.workers.dev --auth "Bearer $TOKEN"
```

Exit 0 on healthy. Non-zero with a specific diagnostic line on failure.

---

## Reference index

- `references/tool-flavors.md` — `@callable` / `McpAgent` / `createMcpHandler`
  side-by-side, including transport matrix.
- `references/tool-registration.md` — the side-effect-import pattern,
  scope-gating, and conditional registration.
- `references/approval-flows.md` — `needsApproval` lifecycle, codemode
  caveat, MCP elicitation as a fallback.
- `references/schema-cookbook.md` — Zod patterns that translate to clean
  JSON Schema for tool I/O.
