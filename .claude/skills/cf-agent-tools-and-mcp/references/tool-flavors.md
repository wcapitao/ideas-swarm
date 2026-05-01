# Tool flavors — `@callable` vs `McpAgent` vs `createMcpHandler`

The three flavors solve different problems. Pick on the basis of "who
calls this tool?" first, "does it need state?" second.

---

## Side-by-side

| | `@callable()` method | `McpAgent` (DO-backed) | `createMcpHandler` (stateless) |
|---|---|---|---|
| Caller | Browser (via `useAgent` / `agent.stub`) or another DO (via `getAgentByName`) | External MCP clients (Claude Desktop, Cursor, Inspector, AI playground) | Same as `McpAgent` |
| Backed by | Existing Agent DO | Per-session Durable Object | Single Worker fetch handler |
| Per-session state | `this.state`, `this.sql` | `this.state`, `this.sql`, `this.props` | none — fresh server per request |
| Discoverable as MCP? | no | yes (`tools/list`) | yes (`tools/list`) |
| OAuth context | hand-rolled on `onConnect` | typed `this.props` from `OAuthProvider` | `getMcpAuthContext()` (AsyncLocalStorage) |
| Schema language | TS types (no runtime check) — add Zod inside | Zod object shape on `server.tool(name, desc, shape, handler)` | Same as `McpAgent` |
| Approval flow | none built-in (gate manually) | MCP elicitation (client-supported only) | MCP elicitation (limited) |
| Hibernation | yes | yes | n/a |
| Cold-start cost | first call wakes the DO | first call wakes the DO | none — Worker isolate only |
| Transport | WebSocket | streamable HTTP / SSE / RPC (transport-aware DO naming) | streamable HTTP only |
| Source | `agents/src/index.ts` (`callable` decorator near line 7755 zone) | `agents/src/mcp/index.ts:29-` (cf-github-canon Appendix) | `agents/src/mcp/handler.ts` |

---

## Transport spec matrix

The MCP spec is mid-migration. Cloudflare exposes both forms.

| Mount | Transport | MCP spec ver | Endpoints | DO name prefix | When |
|-------|-----------|--------------|-----------|----------------|------|
| `MyMcp.serve("/mcp")` (default) | `streamable-http` | 2025-03-26+ | `/mcp` (POST + optional GET-with-SSE) | `streamable-http:<sid>` | New work; default |
| `MyMcp.serveSSE("/sse")` | legacy `sse` | 2024-11-05 | `/sse` + `/sse/message` | `sse:<sid>` | Older Inspector; some Claude Desktop builds; `npx mcp-remote` bridge |
| `MyMcp.serve("/x", { transport: "auto" })` | content-sniff | both | one path | dynamic | When you can't predict the client |
| `MyMcp.serve("/rpc", { transport: "rpc" })` | Workers RPC | private | RPC stub | `rpc:<sid>` | In-platform Agent → MCP without HTTP |
| `MyMcp.mount("/sse")` | alias of `serveSSE` | 2024-11-05 | as SSE | as SSE | Deprecated; legacy |

**Production posture (per `cloudflare/mcp-server-cloudflare` README):** mount
both `/mcp` and `/sse`. Document both URLs in the `oauth-protected-resource`
metadata. Once enough clients ship streamable HTTP support, drop SSE.

---

## When NOT to build a tool

Sometimes the right answer is "no tool":

| Want | Don't | Do |
|---|---|---|
| One-shot HTTP fetch from inside a turn | Custom tool wrapper around `fetch` | Use the model's built-in web/fetch tool if available |
| Run for >30s | Inline tool — burns DO compute budget and times out | Workflow handle returned from a tool |
| Wrap your entire REST API | One MCP server with 200 tools | Multiple narrowly-scoped MCP servers (cf-mcp-auth-frontend §10 #15) |
| Browser DOM manipulation | Tool that runs in the worker | Client-side tool — `tool({ inputSchema })` with no `execute`; resolve via `onToolCall` in `useAgentChat` |
| Heavy CPU per call | Tool inside a DO | Tool that hands off to a Workflow or a sandboxed isolate (Worker Loader) |

cf-agents-core §6 (Workflows from agents) for the durable-execution path.

---

## Decision tree (text form)

```
1. Who calls this?
   - Just my own agent's LLM         -> @callable() OR AI-SDK tool({ ... })
   - External MCP clients              -> step 2
   - Another Worker / Agent server-to-server -> getAgentByName + plain method (no decorator needed)

2. Does it need state across calls in the same session?
   - Yes (counter, draft, accumulating context)  -> McpAgent
   - No  (pure function, per-request fetch)      -> createMcpHandler

3. How long does it run?
   - <30s, in-memory, single step     -> inline (in any flavor)
   - >30s, multi-step, retry-on-error -> Workflow handle from the tool

4. Is it dangerous (write, payment, destructive)?
   - Yes -> approval/elicitation gate. AND: don't expose to codemode.
   - No  -> proceed
```

The codemode caveat from cf-agents-core §15 is non-obvious: `needsApproval`
predicates **do not run** in codemode. If a tool is dangerous, gate inside
`execute` itself, not just on `needsApproval`.
