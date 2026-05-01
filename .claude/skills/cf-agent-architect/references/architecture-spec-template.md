# Architecture Spec Template

Copy this into `docs/architecture/agent-spec.md` (or
`docs/agents/<name>-spec.md` for multi-agent projects). Fill in every
checkbox and table cell. Commit it before any agent code is written —
this is the contract the team reviews.

A worked sample is at the bottom.

---

## Template

```markdown
# <Agent Name> — Architecture

**Purpose:** <one-sentence statement of what the agent does>
**Owner:** <person / team>
**Date:** <YYYY-MM-DD>
**Status:** [ ] Draft [ ] Reviewed [ ] Approved
**Source briefs:** docs/research/cf-agents-core.md, cf-runtime-primitives.md, cf-github-canon.md

---

## 1. Base class

- [ ] `Agent` (generic — custom protocol / room / webhook / sub-agent target)
- [ ] `AIChatAgent` from `@cloudflare/ai-chat` (browser chat)
- [ ] `McpAgent` (stateful MCP server)
- [ ] `createMcpHandler` (stateless MCP — no DO)
- [ ] `WorkflowEntrypoint` (durable multi-step)
- [ ] Composition: <list which classes compose, e.g. "AIChatAgent + ResearchWorkflow + PlannerAgent sub-agent">

**Rationale:** <one or two sentences citing the deciding rule>

---

## 2. Naming + ID strategy

- [ ] Per-user (`user-${userId}`)
- [ ] Per-conversation (`chat-${chatId}`)
- [ ] Per-tenant (`tenant-${orgId}`)
- [ ] Per-room / per-doc (`room-${id}`)
- [ ] Singleton (`default`)
- [ ] Sharded (`<key>-shard-${0..N}`) — N = <number>, reason: <traffic, isolation>
- [ ] Hash bucket (`hash(input) % N`)

**Identity resolver:** [ ] `routeAgentRequest` default | [ ] `basePath` + server resolver from session

**Identity broadcast?** [ ] yes (default) | [ ] no (`sendIdentityOnConnect: false`) — if no, frontend MUST implement `onIdentity` / `onIdentityChange`

**Rationale:** <how this isolates state correctly; cite who owns what>

---

## 3. Transport surface

| Surface | Used? | Client | Notes |
|---|---|---|---|
| WebSocket (primary) | [ ] | <browser / mobile / WS client> | hibernation default-on |
| SSE | [ ] | <legacy HTTP client> | only for one-way streaming |
| HTTP `onRequest` | [ ] | <webhooks / REST / one-shot> | HMAC verify if external |
| RPC (server-to-server) | [ ] | <other Worker / Agent> | `getAgentByName(env.X, name).method()` |
| MCP streamable-http | [ ] | MCP clients | `MyMCP.serve("/mcp")` |
| Email | [ ] | mail server | `routeAgentEmail` |

**Rationale:** <why this transport; if SSE on a DO, defend the cost>

---

## 4. State model

| Surface | Use for | Example |
|---|---|---|
| `this.setState` (broadcasts) | UI-visible status / progress / public counters | `setState({ status: "running" })` |
| `this.sql` (private) | secrets, tokens, audit, PII | `INSERT INTO secrets ...` |
| `this.ctx.storage.kv` | hot single-row reads/writes | `kv.put("last_seen", Date.now())` |
| `connection.serializeAttachment` | per-WS identity, ≤ 2 KB | `{ userId, role }` |
| Vectorize | embeddings for RAG | separate index, ID-keyed back to SQL |

**Schema (SQLite, in `onStart()`):**
```sql
CREATE TABLE IF NOT EXISTS <table> (
  id INTEGER PRIMARY KEY,
  ...
);
```

**State validation hook:** [ ] none | [ ] `validateStateChange()` enforces <invariants>

**Rationale:** <especially: confirm no secret hits setState>

---

## 5. Time + persistence

| Need | Primitive | Detail |
|---|---|---|
| Cron / recurring tick | `this.schedule("...", "method")` | <cron string + callback name> |
| Reminder / delay | `this.schedule(seconds, "method", payload)` | idempotent? <yes/no> |
| Multi-step durable pipeline | `WorkflowEntrypoint` | <name + steps> |
| Fan-out batch | Queue | <queue name + max_retries + DLQ> |
| Self-tick (sub-minute) | `scheduleEvery(seconds, ...)` | overlap behavior: skipped |

**Rationale:** <why this primitive; alternative considered + why rejected>

---

## 6. Topology

- [ ] Single agent (default)
- [ ] Sub-agents — list child classes:
  - <ChildAgent1> — purpose
  - <ChildAgent2> — purpose
- [ ] Agent + Workflow back-end — Workflow name: <>
- [ ] Directory + facets pattern (per-tenant) — <DirectoryAgent + FacetAgent>

**Rationale:** <which of the four sub-agent triggers applies, or "none — single is sufficient">

---

## Bindings (wrangler.jsonc)

```jsonc
{
  "name": "<worker-name>",
  "main": "src/server.ts",
  "compatibility_date": "<YYYY-MM-DD>",
  "compatibility_flags": ["nodejs_compat"],
  "ai": { "binding": "AI" },                                          // catalog #5: AIG in front of every call
  "durable_objects": {
    "bindings": [{ "class_name": "<AgentClass>", "name": "<AGENT>" }]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["<AgentClass>"] }            // catalog #3: NEVER new_classes
  ],
  "workflows": [                                                        // if used
    { "name": "<wf>", "binding": "<WF>", "class_name": "<WfClass>" }
  ],
  "queues": {                                                           // if used
    "producers": [{ "queue": "<q>", "binding": "<Q>" }],
    "consumers": [{ "queue": "<q>", "max_retries": 5, "dead_letter_queue": "<q>-dlq" }]
  },
  "vectorize": [{ "binding": "VECTOR_DB", "index_name": "<index>" }]    // if RAG
}
```

**TypeScript config:** extends `agents/tsconfig` (NOT `experimentalDecorators` — catalog #4).

**Vite plugin:** `agents()` + `cloudflare()` from `@cloudflare/vite-plugin`.

---

## Bindings checklist

- [ ] `compatibility_flags: ["nodejs_compat"]`
- [ ] `new_sqlite_classes` (NOT `new_classes`)
- [ ] AI Gateway configured (catalog #5)
- [ ] Secrets in `wrangler secret put` (NOT in vars; vars are strings only)
- [ ] No `experimentalDecorators` in tsconfig
- [ ] `agents/vite` plugin in `vite.config.ts`

---

## Non-negotiables (signed off)

- [ ] No secrets / OAuth tokens in `setState` (catalog #1)
- [ ] `acceptWebSocket()` not `accept()` — confirmed via `Agent` base (catalog #2)
- [ ] `new_sqlite_classes` chosen — irreversible, confirmed (catalog #3)
- [ ] `experimentalDecorators` disabled (catalog #4)
- [ ] AI Gateway in front of every LLM call (catalog #5)
- [ ] Fresh `McpServer` per request in any stateless server (catalog #6)
- [ ] Vitest pool with `--no-isolate` for WS-DO tests (catalog #7)
- [ ] `vi.spyOn(env.AI, "run")` for AI mocks (catalog #8)
- [ ] `AIChatAgent` from `@cloudflare/ai-chat` (NOT shim) (catalog #9)
- [ ] DO-side timeouts in place (no reliance on caller AbortSignal) (catalog #10)

---

## Hand-off

| Track | Skill |
|---|---|
| Tools / MCP | `cf-agent-tools-and-mcp` |
| State / SQL / migrations | `cf-agent-state-and-storage` |
| Schedule / Workflow / Queue | `cf-agent-workflows-and-scheduling` |
| Frontend | `cf-agent-realtime-and-frontend` |
| Models / AIG / Vectorize | `cf-agent-models-and-gateway` |
| OAuth / secrets | `cf-agent-auth-and-permissions` |
| Tests / evals | `cf-agent-tests-and-evals` |
| Deploy / observe | `cf-agent-deploy-and-observe` |
| Sub-agents / orchestration | `cf-agent-multi-agent-orchestration` |

---

## Open questions

- <list anything still unresolved — block on these before code>
```

---

## Worked sample — "research-assistant"

```markdown
# research-assistant — Architecture

**Purpose:** Browser-based AI research assistant; user asks questions, agent
streams tool-calling chat answers, can spawn multi-day research jobs.
**Owner:** ai-platform team
**Date:** 2026-04-30
**Status:** [x] Draft [ ] Reviewed [ ] Approved

## 1. Base class

- [x] `AIChatAgent` from `@cloudflare/ai-chat`
- [x] Composition: AIChatAgent + ResearchWorkflow (back-end pipeline)

**Rationale:** browser chat UX with persisted history → AIChatAgent.
Multi-day research with retries per step → Workflow.

## 2. Naming

- [x] Per-user (`user-${session.userId}`)
- Identity resolver: `basePath` + session-based resolver
- Identity broadcast? no (`sendIdentityOnConnect: false`); frontend implements `onIdentity` / `onIdentityChange`

**Rationale:** one chat thread per user, isolated state. Server picks
the DO from the verified session — never trust client.

## 3. Transport

| Surface | Used? | Client | Notes |
|---|---|---|---|
| WebSocket (primary) | yes | browser | hibernates while idle |
| HTTP `onRequest` | yes | webhooks for source-feed updates | HMAC verify |
| RPC | yes | internal `digest-worker` calls in for daily summary | `getAgentByName` |

## 4. State model

| Surface | Use for |
|---|---|
| `setState` | `{ jobStatus: "idle"\|"running"\|"done" }` |
| `this.sql` | OAuth tokens for Notion / GitHub MCP servers; `events` audit log |
| `serializeAttachment` | `{ userId, role }` per WS connection |
| Vectorize | per-user embedding index for personal docs (binding `VECTOR_DB`) |

Schema:
```sql
CREATE TABLE IF NOT EXISTS oauth_tokens (provider TEXT PRIMARY KEY, token TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, ts INTEGER, kind TEXT, body TEXT);
```

## 5. Time + persistence

| Need | Primitive |
|---|---|
| Daily 8am digest | `this.schedule("0 8 * * *", "sendDigest")` (cron, idempotent) |
| Multi-step research | `ResearchWorkflow` (10 steps, sleeps up to 24h between web fetches) |
| Notion sync (every 15 min) | `this.scheduleEvery(900, "syncNotion")` |

## 6. Topology

- [x] Single agent + Workflow back-end (`ResearchWorkflow`)
- No sub-agents (yet) — research pipeline is linear, not parallel

## Bindings (wrangler.jsonc)

```jsonc
{
  "compatibility_date": "2026-03-02",
  "compatibility_flags": ["nodejs_compat"],
  "ai": { "binding": "AI" },
  "durable_objects": {
    "bindings": [{ "class_name": "ChatAgent", "name": "ChatAgent" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ChatAgent"] }],
  "workflows": [
    { "name": "research", "binding": "RESEARCH_WF", "class_name": "ResearchWorkflow" }
  ],
  "vectorize": [{ "binding": "VECTOR_DB", "index_name": "user-docs" }],
  "vars": { "AIG_ID": "research-assistant-prod" }
}
```

## Non-negotiables — signed off

- [x] OAuth tokens in `this.sql` (NOT setState)
- [x] WebSocket via SDK default (`acceptWebSocket` under the hood)
- [x] `new_sqlite_classes` confirmed
- [x] tsconfig extends `agents/tsconfig` (no `experimentalDecorators`)
- [x] AI Gateway `AIG_ID` set; passed via `gateway: { id: env.AIG_ID }`
- [x] No stateless MCP server in this app (only McpAgent-as-client)

## Hand-off

| Track | Skill | Notes |
|---|---|---|
| Tools / MCP-as-client | `cf-agent-tools-and-mcp` | `addMcpServer("notion", ...)`, `addMcpServer("github", ...)` |
| State / SQL | `cf-agent-state-and-storage` | secrets table, vectorize plumbing |
| Workflow / scheduling | `cf-agent-workflows-and-scheduling` | ResearchWorkflow steps + cron |
| Frontend | `cf-agent-realtime-and-frontend` | useAgentChat + onMcpUpdate |
| Models / RAG | `cf-agent-models-and-gateway` | AIG config + Vectorize query pattern |
| OAuth | `cf-agent-auth-and-permissions` | OAuthProvider for the worker; per-MCP OAuth flow |
| Tests | `cf-agent-tests-and-evals` | ResearchWorkflow eval set, chat regression |
| Deploy | `cf-agent-deploy-and-observe` | wrangler.jsonc, secret put, AIG dashboard wiring |

## Open questions

- Is one DO per user enough at our peak (~30 RPS / user)? Yes — well below 1k cap.
- Do we need sharding for the digest scheduler? No — each user agent self-schedules; no fan-out.
```
