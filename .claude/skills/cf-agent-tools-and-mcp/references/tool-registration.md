# Tool registration patterns

How production Cloudflare MCP servers organize their tool code. The
canonical references are `cloudflare/mcp-server-cloudflare` (~17 production
servers under `apps/`) and `vantage-sh/vantage-mcp-server` (cf-github-canon §4).

---

## 1. Inline registration in `init()`

Fine for ≤5 tools. Used by the docs and `cloudflare/agents/examples/mcp`.

```ts
export class CalculatorMCP extends McpAgent<Env, State, Props> {
  server = new McpServer({ name: "calc", version: "0.1.0" });
  async init() {
    this.server.tool("add", "Add two numbers.",
      { a: z.number(), b: z.number() },
      async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }));
    this.server.tool("mul", "Multiply two numbers.",
      { a: z.number(), b: z.number() },
      async ({ a, b }) => ({ content: [{ type: "text", text: String(a * b) }] }));
  }
}
```

Past 5 tools, `init()` becomes unreadable.

---

## 2. Side-effect import — the production pattern

`cloudflare/mcp-server-cloudflare/apps/workers-bindings` and
`vantage-sh/vantage-mcp-server` both do this.

```
src/
  mcp.ts                  ← McpAgent class, ~30 lines
  tools/
    index.ts              ← single registerAllTools(server) entry
    accounts.ts           ← registerAccountTools(server)
    invoices.ts           ← registerInvoiceTools(server)
    reports.ts            ← registerReportTools(server)
```

```ts
// src/tools/accounts.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerAccountTools(server: McpServer) {
  server.tool(
    "list_accounts",
    "List the user's billing accounts. Use to find an account ID.",
    { limit: z.number().int().min(1).max(100).default(20) },
    async ({ limit }) => {
      // ... fetch and return
    },
  );

  server.tool(
    "get_account",
    "Get details for one billing account by ID.",
    { id: z.string().uuid() },
    async ({ id }) => {
      // ...
    },
  );
}
```

```ts
// src/tools/index.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAccountTools } from "./accounts";
import { registerInvoiceTools } from "./invoices";
import { registerReportTools } from "./reports";

export function registerAllTools(server: McpServer) {
  registerAccountTools(server);
  registerInvoiceTools(server);
  registerReportTools(server);
}
```

```ts
// src/mcp.ts
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools";

export class BillingMCP extends McpAgent<Env, State, Props> {
  server = new McpServer({ name: "billing", version: "0.1.0" });
  async init() {
    registerAllTools(this.server);
  }
}
```

The entry file is small enough to read in one screen.

---

## 3. Scope-gated registration

Conditionally register based on `this.props.scopes`. Safer than runtime
checks because the LLM **never sees a tool it isn't allowed to call**
(cf-mcp-auth-frontend §4, "Scope-based tool gating, style (b)").

```ts
async init() {
  registerReadOnlyTools(this.server);

  const scopes = this.props?.scopes ?? [];
  if (scopes.includes("write"))   registerWriteTools(this.server);
  if (scopes.includes("admin"))   registerAdminTools(this.server);
  if (scopes.includes("billing")) registerBillingTools(this.server);
}
```

The MCP spec leaves auth context per-session, so each session sees only
tools it has scopes for. The `tools/list` response varies by user.

---

## 4. Runtime-gated handler (style (a))

When the same tool is allowed for everyone but with different behavior:

```ts
server.tool(
  "search",
  "Search the user's data. Admins see all rows; users see their own.",
  { query: z.string().min(1).max(500) },
  async ({ query }) => {
    const userId = this.props?.userId ?? "anon";
    const isAdmin = this.props?.scopes?.includes("admin");
    const rows = isAdmin
      ? await searchAllRows(query)
      : await searchUserRows(userId, query);
    return { content: [{ type: "text", text: JSON.stringify(rows) }] };
  },
);
```

Less safe than (3) — the model can attempt a query for "everyone's data"
and read the error. Prefer (3) when the tool itself differs by scope.

---

## 5. Tool naming conventions

- `snake_case`. The MCP spec recommends it; the SDK normalizes anyway.
- Be specific: `list_invoices` not `list`. The model reads the name as
  the first part of the contract.
- Prefix with the entity when there are several: `invoice_list`,
  `invoice_get`, `invoice_send`. Aids the model's mental model.
- For per-Cloudflare-account servers (like `mcp-server-cloudflare/apps/
  workers-observability`), prefix with the platform: `workers_logs_query`.

---

## 6. Tool metadata gotchas

- The MCP `inputSchema` field is the **raw Zod object shape** —
  `{ a: z.number() }`, not `z.object({ a: z.number() })`. The MCP SDK
  wraps it for you.
- The Vercel AI SDK's `tool({ inputSchema: z.object({...}) })` IS
  wrapped — different convention. When migrating an AI-SDK tool to MCP,
  unwrap the outer `z.object`.
- Tool **names** are what end up in `mcp__<server>__<tool>` for the
  agent's `allowedTools` filter. Stable names matter for permission
  policy and CI matchers.

---

## 7. Resources and prompts (sibling registrations)

`McpServer` exposes three registries. All follow the same shape:

```ts
// resources — read-only, URI-addressable data
this.server.resource(
  "counter",
  "mcp://resource/counter",
  (uri) => ({
    contents: [{ uri: uri.href, text: String(this.state.counter) }],
  }),
);

// prompts — reusable system-prompt fragments
this.server.prompt(
  "summarize-account",
  "Summarize a billing account with totals and outliers.",
  { accountId: z.string().uuid() },
  ({ accountId }) => ({
    messages: [{ role: "user", content: { type: "text", text: `Summarize ${accountId}` } }],
  }),
);
```

`stytchauth/mcp-stytch-consumer-todo-list` uses `ResourceTemplate` for
parameterized URIs (`todoapp://todos/{id}`); cf-github-canon §4. Use
resources when the model wants to **read** something repeatedly without
spending a tool call.
