---
name: cf-agent-architect
description: >
  Designs the high-level shape of a Cloudflare agent before any code is
  written. Activates when the user says "build a Cloudflare agent",
  "design an agent on Cloudflare", "Cloudflare agent for X", "agent on
  Workers / Durable Objects", "MCP server on Cloudflare", "what shape
  should this take", or asks which base class / transport / state model
  / hibernation / sub-agent split / Workflow vs schedule to use. Walks
  through six structural decisions in dependency order (base class,
  naming, transport, state model, time + persistence, topology),
  produces a one-page architecture spec, and hands off to the specialist
  cf-agent-* skills. Always invoke first when starting a new agent on
  Cloudflare. Do NOT invoke for tweaks to an existing agent, prompt-only
  changes, or "add a tool" — route those to the relevant specialist.
---

# Cloudflare Agent Architect

## Overview

A Cloudflare agent's shape is fixed by Workers runtime constraints
earlier than people realize. The base class is irreversible (KV-backed
DOs cannot be retrofitted to SQLite — `cf-runtime-primitives §5`). The
transport choice decides whether you can hibernate (and whether your
bill is sane — `cf-runtime-primitives §4`). The naming strategy fixes
your isolation boundary forever. This skill forces six decisions before
any line of SDK code is written, then routes to the specialist build
skills.

## When to use

| Trigger | Use? |
|---|---|
| "Build me a Cloudflare agent that..." | YES — start here |
| "Design an agent on Workers / DOs" | YES |
| "MCP server on Cloudflare" | YES |
| "What's the right base class / transport / shape" | YES |
| "Cloudflare agent for X" / "agent for Y on CF" | YES |
| Adding a tool to an existing CF agent | NO → `cf-agent-tools-and-mcp` |
| Tweak existing agent (prompt, model, behavior) | NO → relevant specialist |
| Debugging hibernation / state | NO → `cf-agent-state-and-storage` |
| Wrangler / deploy issues | NO → `cf-agent-deploy-and-observe` |

## The Six Decisions (in order)

Walk through these with the user. Refuse to skip any. The order is a
dependency order: each decision constrains the next.

### 1. Base class — `Agent` / `AIChatAgent` / `McpAgent` / `WorkflowEntrypoint` (or compose)

```
Agent              — generic. WS + HTTP + RPC + scheduling + state.
                     Use when: bespoke protocol, custom UI, voice,
                     game/room, webhook ingest, "agent" in the
                     classical sense (custom orchestration loop).
AIChatAgent        — chat-specific. From @cloudflare/ai-chat (NOT the
                     deprecated agents/ai-chat-agent shim — cf-github-
                     canon §1, §6). Gives you this.messages,
                     onChatMessage, persistMessages, useAgentChat
                     bridge. Use for any chat UX.
McpAgent           — Model Context Protocol server, stateful. Use
                     when: exposing tools to MCP clients (Claude
                     Desktop, Cursor, ChatGPT) AND tools need
                     per-session state. (cf-agents-core §10)
WorkflowEntrypoint — multi-step durable pipeline (Cloudflare
                     Workflows). Use when: 3+ deterministic steps,
                     sleeps > 15 min, must survive deploys. Usually
                     COMPOSED with an Agent — agent is the front
                     door, workflow is the long-running back end
                     (cf-agents-core §6, cf-runtime-primitives §6).

Stateless MCP only — createMcpHandler (no DO). Use when: tools have
                     zero per-session state. Cheaper, simpler. SDK
                     >=1.26.0 REQUIRES a fresh McpServer per request
                     (catalog non-negotiable #6, cf-agents-core §10).
```

**Decision rules:**

- Chat UI in browser → `AIChatAgent`. End of discussion.
- MCP server with per-user tokens / per-session counters / persisted history → `McpAgent`.
- MCP server with pure functions only → `createMcpHandler` (stateless).
- Pipeline > 30 s wall-clock or > 15 min sleeps → `WorkflowEntrypoint`, fronted by `Agent` if it has a UI.
- Anything else (custom protocol, voice, room, game, webhook handler) → `Agent`.

**Compose, don't substitute.** A common production shape: `AIChatAgent`
front door + `WorkflowEntrypoint` for long jobs + sub-`Agent`s for
bounded sub-tasks (cf-runtime-primitives §10). See
`references/class-selection.md` for minimal examples per class.

**Irreversibility footgun:** the migration must be `new_sqlite_classes`
(catalog non-negotiable #3). `new_classes` (KV-backed) **cannot** be
retrofitted to SQLite once deployed; you have to delete and recreate.
Always start SQLite (cf-runtime-primitives §5).

### 2. Naming + ID strategy — what's the isolation boundary?

A DO is identified by a string name. Two callers with the same name hit
the same instance, with the same SQLite, with the same in-memory state,
forever (cf-runtime-primitives §1). The naming key **is** the isolation
boundary. Pick wrong and you'll see other users' state.

```
Per-user           — name = `user-${userId}`. Isolated state per user.
                     Default for chat agents and personal assistants.
Per-conversation   — name = `chat-${chatId}`. Use when one user can
                     have many chats; chat history isolated per
                     conversation. (multi-ai-chat pattern, cf-github-
                     canon §3)
Per-tenant         — name = `tenant-${orgId}`. Multi-tenant SaaS;
                     state shared across users in an org.
Per-room/document  — name = `room-${roomId}`. Real-time fan-in
                     (chat room, collab editor, multiplayer game).
Singleton          — name = "default". One global instance; for
                     account-level coordinators or singletons.
Hash               — name = hash(input). Use to bucket high-cardinality
                     inputs (e.g. webhook source) without DO-id leaks.
```

**Decision rules:**

- The name is server-determined whenever the input comes from a client. **Never** trust a client-supplied DO name — that lets one user read another user's state. Use `basePath` + a server-side resolver (cf-agents-core §3).
- If `sendIdentityOnConnect: false` (you don't want to leak the name to clients), client React must supply `onIdentity`/`onIdentityChange`; otherwise `agent.ready` never resolves (cf-agents-core §15).
- `getAgentByName(env.MyAgent, name)` is the canonical API for server-to-server (cf-agents-core §3).
- Throughput cap: ~1,000 req/s per single DO (cf-runtime-primitives §1). If one entity exceeds this, shard the name (`room-${id}-shard-${0..N}`).

```ts
// canonical: server decides identity, client never sees it
import { getAgentByName, routeAgentRequest } from "agents";

export default {
  async fetch(req: Request, env: Env) {
    const session = await verifySession(req);
    if (!session) return new Response("Unauthorized", { status: 401 });
    // basePath path: server picks the DO; client cannot override
    if (new URL(req.url).pathname.startsWith("/user/")) {
      const agent = await getAgentByName(env.MyAgent, `user-${session.userId}`);
      return agent.fetch(req);
    }
    return (await routeAgentRequest(req, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

### 3. Transport surface — WS / SSE / HTTP / RPC

The transport decides cost, latency, and which clients can talk to it.

```
WebSocket (default) — bidirectional, hibernates (FREE while idle if
                       you use acceptWebSocket — catalog non-
                       negotiable #2). Use for: browser chat, live
                       collaboration, voice, game state, anything
                       that pushes server -> client. (cf-agents-core
                       §7)
SSE                 — one-way server -> client streaming. Use for:
                       LLM token streams from internal services
                       that won't speak WS. AI SDK's
                       result.toTextStreamResponse() goes here.
                       (cf-agents-core §8)
HTTP (onRequest)    — request/response only. Use for: webhooks,
                       REST API surface, external worker -> agent
                       calls that don't need a persistent
                       connection. (cf-agents-core §1)
RPC                 — same-Worker server-to-server, typed via
                       getAgentByName(...).method(). Zero HTTP
                       overhead. Use for: agent-to-agent inside
                       Cloudflare. NOT @callable() — that's for
                       client RPC over WS. (cf-agents-core §3, §15)
MCP transport       — streamable-http (default, modern), sse
                       (deprecated), rpc (in-Cloudflare only).
                       (cf-agents-core §10)
```

See `references/transport-matrix.md` for the full client × transport ×
hibernation table.

**Decision rules:**

- Browser chat → WebSocket. (Hibernation is the cost story; SSE on a DO is non-hibernating and bills 24/7.)
- Webhooks → HTTP. Add HMAC signature verification.
- MCP client (Claude Desktop, Cursor) → MCP streamable-http transport via `MyMCP.serve("/mcp")`.
- Internal worker → agent → RPC via `getAgentByName`. Don't HTTP yourself.
- Need both? Pick a primary and add HTTP as a secondary surface. Most production agents are WS + HTTP.

**Hibernation footgun:** `acceptWebSocket()` not `accept()` (catalog
non-negotiable #2). The Agents SDK does this for you on the
`Agent`/`AIChatAgent` path. If you're hand-rolling on top of `DurableObject`,
you must call `ctx.acceptWebSocket(server)`. Wrong → bill 24/7.

**WebSocket upgrade footgun:** never modify the Response returned by
`routeAgentRequest()` — the upgrade fails silently (cf-agents-core §3).

### 4. State model — broadcast `setState` vs raw SQL for secrets

Every Agent instance has its own SQLite database. Two ways to write to
it:

```
this.setState(s)        — writes to a hidden cf_agents_state table AND
                          broadcasts cf_agent_state to every connected
                          WebSocket client. Use for: UI-visible state,
                          collaborative state, chat status.
                          (cf-agents-core §2)
this.sql`...`           — direct SQLite, NOT broadcast. Use for:
                          secrets, OAuth tokens, audit logs,
                          per-user data that other connected clients
                          must not see. (cf-agents-core §2)
this.ctx.storage.kv.*   — synchronous KV path (SQLite-backed). Use for:
                          single-row hot-path (e.g. last-seen
                          timestamp). (cf-runtime-primitives §2)
connection.serializeAttachment(...)  — per-connection state, max 2 KB,
                          survives hibernation. Use for: per-socket
                          identity (userId, role).
                          (cf-runtime-primitives §4)
```

**The non-negotiable rule (catalog #1, cf-mcp-auth-frontend §10):**
**never put secrets, OAuth tokens, or PII in `setState`.** It broadcasts
to all clients. Use `this.sql` or `this.ctx.storage`.

**Decision rules:**

- State the user sees in the UI → `setState` (typed `State` generic on the class).
- State the agent uses internally that clients should never see → `this.sql`.
- Per-connection identity → `connection.setState({ userId, role })` + `serializeAttachment`.
- JSON-serializable only — no Dates, Maps, Sets, functions (cf-agents-core §2). Use ISO strings.
- Validate state changes in `validateStateChange()` (synchronous, throws to reject), NOT `onStateChanged()` (notification-only).

```ts
// canonical secret-handling
class Assistant extends Agent<Env, { status: "idle" | "running" }> {
  initialState = { status: "idle" as const };

  async storeOAuthToken(provider: string, token: string) {
    this.sql`INSERT OR REPLACE INTO secrets (provider, token, updated_at)
             VALUES (${provider}, ${token}, ${Date.now()})`;
    // do NOT setState({ ...this.state, [provider]: token }) — that broadcasts
  }

  async startJob() {
    this.setState({ status: "running" });   // safe to broadcast
  }
}
```

**Schema migrations:** wrangler-level migrations are append-only and
SQLite-class is irreversible (catalog #3, cf-runtime-primitives §5).
Run idempotent `CREATE TABLE IF NOT EXISTS` in `onStart()` for in-DB
schema changes.

### 5. Time + persistence — `schedule()` vs `alarm()` vs Workflows vs Queues

Pick the smallest primitive that satisfies the job (cf-runtime-primitives §10).

```
this.schedule(when, "method", payload)  — built into Agent. Three
                          overloads: delay (seconds), absolute Date,
                          cron string. Backed by DO alarms but you
                          get a priority queue for free. Use for:
                          per-instance reminders, cron jobs,
                          self-rescheduling ticks. (cf-agents-core §5)
DO alarm() (raw)        — one alarm per DO. Use only if you've dropped
                          to raw DurableObject; the Agents SDK's
                          schedule() is strictly better otherwise.
Workflows               — multi-step durable pipeline, sleeps up to
                          365 days, retries per step, survives
                          deploys. Trigger via this.runWorkflow(name,
                          params). (cf-agents-core §6)
Queues                  — fan-out N independent jobs, configurable
                          concurrency, DLQ, batching. Trigger via
                          env.QUEUE.send(...). Use when work is
                          parallelizable across messages.
                          (cf-runtime-primitives §9)
```

**Decision matrix:**

| Need | Pick |
|---|---|
| "Send reminder in 24h" / "tick every 5 min" | `this.schedule()` |
| "Daily digest at 8am" | `this.schedule("0 8 * * *", ...)` |
| "Onboard user over 7 days, multiple steps" | Workflow |
| "Process 10k rows in parallel" | Queue |
| "Charge a card, retry on 5xx" | Workflow (`step.do` with idempotency) |
| "Single tick across a fleet of agents" | Each agent sets its own `schedule()` (do NOT fan out from a coordinator) |

**Sub-agent caveat:** inside a sub-agent, `schedule()`, `cancelSchedule()`, and `keepAlive()` **throw**. Schedule from the parent (cf-agents-core §5).

**Idempotency:** cron schedules are idempotent by default; delayed/Date schedules are NOT. Pass `{ idempotent: true }` when seeding from `onStart()` (which runs on every wake) or you'll create duplicates after restart (cf-agents-core §5, cf-github-canon §2).

**Workflow gotcha:** workflows **cannot open WebSockets** (cf-agents-core §6). For workflow → client push, the workflow writes via `step.updateAgentState`/`step.mergeAgentState` and the agent broadcasts.

### 6. Topology — single-agent / sub-agents / agent + Workflow back-end

```
Single agent       — one DO class, one instance per name. Default.
                     Simpler debugging, shared state, lower cost.
Sub-agents         — parent Agent calls sibling Agent classes via
                     getAgentByName(env.Child, ...). Use when:
                     - work is parallelizable (review N files,
                       summarize N URLs)
                     - role separation (security auditor must not
                       see full conversation)
                     - parent context would overflow
                     - per-tenant isolation (a "directory" parent
                       routes to per-tenant facets)
                     (cf-agents-core §15, cf-github-canon §3 —
                     "agents-as-tools", "assistant", "multi-ai-chat")
Agent + Workflow   — Agent is the live front door (UI, scheduling,
                     state). Workflow is the durable back end
                     (multi-step, retry-per-step, days of sleep).
                     Use for: deep research, ETL, onboarding flows.
                     (cf-agents-core §6, cf-runtime-primitives §10)
```

**Decision rules:**

- Default to single-agent. Only split when one of the four sub-agent triggers above is met.
- Sub-agent child classes must extend `Agent`, be exported from the worker entry by **exact** class name (no aliasing), and are auto-discovered via `ctx.exports`. Only the parent needs a DO binding (cf-agents-core §15).
- Sub-agents cannot schedule. Schedule from the parent.
- For "I have one big job that takes minutes/hours" → Agent + Workflow, not sub-agents.

## The architecture spec

After answering all six, produce this one-page spec and save it to
`docs/architecture/agent-spec.md` (or `docs/agents/<name>-spec.md` if
the project will host more than one agent). The full fillable template
is at `references/architecture-spec-template.md`.

```markdown
# <Agent Name> — Architecture

**Purpose:** <one sentence>
**Owner:** <person/team>
**Date:** <YYYY-MM-DD>

| Decision | Choice | Rationale |
|---|---|---|
| 1. Base class | AIChatAgent (from @cloudflare/ai-chat) | browser chat UI, persisted history, useAgentChat |
| 2. Naming | per-user (`user-${session.userId}`) | one chat per user, isolation |
| 3. Transport | WebSocket primary + HTTP for webhooks | hibernates while idle, supports streaming |
| 4. State model | setState for UI status; this.sql for OAuth tokens | tokens must NOT broadcast |
| 5. Time + persistence | this.schedule() for reminders; Workflow for "deep research" jobs | reminders short, research is multi-step |
| 6. Topology | Single agent + Workflow back-end for /research command | live chat front door, durable pipeline behind |

**Bindings (wrangler.jsonc):**
- `[[durable_objects.bindings]] class_name = "ChatAgent"`
- `[[migrations]] new_sqlite_classes = ["ChatAgent"], tag = "v1"`  ← SQLite, never `new_classes`
- `ai = { binding = "AI" }` (Workers AI; route via AI Gateway — non-negotiable #5)
- `[[workflows]] class_name = "ResearchWorkflow", binding = "RESEARCH_WF"`
- `compatibility_flags = ["nodejs_compat"]`

**Hand-off:**
- Tools / MCP wiring → `cf-agent-tools-and-mcp`
- State / SQL / migrations / hibernation → `cf-agent-state-and-storage`
- Schedule / Workflow / Queue plumbing → `cf-agent-workflows-and-scheduling`
- Frontend (useAgent / useAgentChat / SSE) → `cf-agent-realtime-and-frontend`
- Workers AI / AI Gateway / Vectorize → `cf-agent-models-and-gateway`
- OAuth / scopes / secrets → `cf-agent-auth-and-permissions`
- Tests / evals → `cf-agent-tests-and-evals`
- wrangler.jsonc / deploy / observe → `cf-agent-deploy-and-observe`
- Sub-agent decomposition → `cf-agent-multi-agent-orchestration`
```

A worked sample lives in `references/architecture-spec-template.md`.

## Hand-off

| Next decision | Skill | When |
|---|---|---|
| "Add a tool / build an MCP server / expose X" | `cf-agent-tools-and-mcp` | After base class + topology decided |
| "Schema for state, hibernation, Vectorize, broadcast" | `cf-agent-state-and-storage` | After state model decided |
| "Schedule / Workflow / cron / alarm / long job" | `cf-agent-workflows-and-scheduling` | After time + persistence decided |
| "WebSocket UI, useAgent / useAgentChat, AI SDK bridge, SSE" | `cf-agent-realtime-and-frontend` | After transport decided |
| "Workers AI, AI Gateway, embeddings, Vectorize, AI Search" | `cf-agent-models-and-gateway` | When LLM calls or RAG enter the picture |
| "OAuth / MCP auth / secrets / this.props vs setState" | `cf-agent-auth-and-permissions` | When auth or secrets enter the picture |
| "Vitest pool workers, runInDurableObject, eval the agent" | `cf-agent-tests-and-evals` | Alongside every build skill (TDD-ish) |
| "wrangler.jsonc, migrations, secret put, wrangler tail" | `cf-agent-deploy-and-observe` | Before production |
| "Sub-agents, supervisor, fan-out, getAgentByName patterns" | `cf-agent-multi-agent-orchestration` | When topology requires sub-agents |

## Non-negotiables (cross-cutting — every skill must enforce)

These are findings serious enough that the whole suite refuses to
violate them. The architect surfaces them on day one:

1. **Never put secrets / OAuth tokens in `setState`** — it broadcasts to all clients. Use `this.sql` or `this.ctx.storage`. *(cf-mcp-auth-frontend §10)*
2. **`acceptWebSocket()`, not `accept()`** — `accept()` disables hibernation and bills 24/7. The Agents SDK uses `acceptWebSocket` internally on `Agent`; only relevant if you drop to raw `DurableObject`. *(cf-runtime-primitives §4)*
3. **`new_sqlite_classes`, not `new_classes`** — and once chosen, you cannot retrofit a DO from KV-backed to SQLite-backed. Always start SQLite. *(cf-runtime-primitives §5)*
4. **Disable `experimentalDecorators`** in tsconfig — silently breaks `@callable()`. Extend `agents/tsconfig` and use the `agents/vite` plugin. *(cf-agents-core §15)*
5. **AI Gateway in front of every LLM call** — caching, rate limit, fallback, logs. Pass `gateway: { id: "..." }` to `env.AI.run` or use the AI SDK with the AIG provider. *(cf-ai-stack §2-3)*
6. **MCP SDK >=1.26.0 needs a fresh `McpServer` per request** in stateless servers — sharing a global instance leaks responses across clients (CVE). *(cf-mcp-auth-frontend §1)*
7. **Vitest pool with `--no-isolate` + workspace split** for any test that touches WebSocket DOs. *(cf-tests-evals §2)*
8. **`vi.spyOn(env.AI, "run")`** is the canonical Workers AI mock. *(cf-tests-evals §4)*
9. **`AIChatAgent` from `@cloudflare/ai-chat`** is the canonical chat base — not the deprecated `agents/ai-chat-agent` shim. *(cf-mcp-auth-frontend §1, cf-github-canon §1)*
10. **`AbortSignal` doesn't cross DO RPC boundaries** — model timeouts have to be enforced inside the DO, not the caller. *(cf-agents-core §15)*

## Extra surfaces (know they exist — see references/decision-tree.md)

These are advanced surfaces that don't usually drive the initial six
decisions but that the architect must surface on the right project so
the user knows to ask the specialist:

- **`Think`** — opinionated chat agent with `getModel`/`getSystemPrompt`/`getTools`/`configureSession` overrides + step hooks. Used as parent in agents-as-tools. (cf-agents-core §15)
- **Sessions / experimental memory** — `agents/experimental/memory/session` for cross-conversation memory. Experimental.
- **Durable execution (`runFiber`)** — long-running fibers that survive restarts via `onFiberRecovered`. (cf-agents-core §15)
- **Codemode** — LLM writes JS that orchestrates tools in a sandboxed Worker. **Experimental** + `needsApproval` not honored. (cf-agents-core §12)
- **x402 / agentic payments** — paid MCP tools, $/call gating via Hono middleware or `withX402(server)`. (cf-agents-core §15)
- **Voice agent** — full STT/TTS/VAD/LLM in one DO via Workers AI. (cf-agents-core examples)
- **Email** — `routeAgentEmail` inbound + `this.sendEmail()` outbound, signed reply headers. (cf-agents-core §3)
- **Browser Run / `@cloudflare/puppeteer`** — LLM-driven web browsing. (cf-agents-core §12)

## Scaffolds

`scripts/architect-precheck.sh` — bash precheck that the host
environment is ready to bootstrap a Cloudflare agent (Node >= 20, wrangler
installed, account-id present, git repo initialized, no conflicting
`wrangler.toml`). Run before drafting the architecture spec:

```bash
bash scripts/architect-precheck.sh
```

It exits non-zero with an actionable message on any failure.

## Critical rules

- **Six decisions before code.** Skipping any is a future bug report.
- **SQLite-backed DO from day one.** `new_sqlite_classes`. Irreversible.
- **`AIChatAgent` from `@cloudflare/ai-chat`** for any chat UX.
- **Hibernation default-on.** Never call `accept()` directly; let the SDK use `acceptWebSocket`.
- **Secrets never in `setState`.** Always `this.sql` or `this.ctx.storage`.
- **AI Gateway in front of every LLM call.**
- **Architecture spec gets committed.** It's the contract the team reviews before the agent ships.
