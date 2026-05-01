# Cloudflare Agent — Full Decision Tree

Use this when the six-decision walkthrough produces ambiguity, or when
the user asks "which of these should I use?" Branches every choice
that has a non-obvious answer, and lists the "extra surfaces" that
exist but don't usually appear in the first pass.

---

## Top-level branch — what kind of thing are you building?

```
What is the agent for?
│
├── Browser chat UI ─────────────────────────────────────────────► AIChatAgent (cf-agents-core §9)
│       │                                                          (from @cloudflare/ai-chat,
│       │                                                           NOT agents/ai-chat-agent)
│       │
│       ├── ...with tool calls ──────────────────────► AIChatAgent + tools in onChatMessage
│       ├── ...with persisted history ───────────────► AIChatAgent (this.messages, maxPersistedMessages)
│       ├── ...with resume-on-reconnect ─────────────► AIChatAgent (chatRecovery: true)
│       └── ...with voice ────────────────────────────► Agent (raw) + Workers AI STT/TTS/VAD
│                                                       (cf-agents-core voice example)
│
├── MCP server (tools for an MCP client) ───────────────────────► McpAgent vs createMcpHandler
│       │
│       ├── per-user OAuth state, persisted history ─► McpAgent           (cf-agents-core §10)
│       ├── per-session counters, elicitation ───────► McpAgent           (this.elicitInput)
│       ├── pure functions, no state ─────────────────► createMcpHandler  (catalog #6 — fresh
│       │                                                                  McpServer per request)
│       └── proxy to existing OpenAPI / MCP ──────────► codemode-mcp-openapi (experimental)
│
├── Multi-step durable pipeline ─────────────────────────────────► WorkflowEntrypoint (compose
│       │                                                          with Agent if it has a UI)
│       │                                                          (cf-runtime-primitives §6)
│       │
│       ├── retry per step, sleeps days ──────────────► step.do + step.sleep
│       ├── needs human approval mid-flight ──────────► step.waitForEvent + this.approveWorkflow
│       └── must stream progress to UI ────────────────► step.updateAgentState (parent Agent
│                                                        broadcasts; workflows cannot open WS)
│
├── Real-time room / collab / multiplayer ──────────────────────► Agent (raw) + per-room name
│       │                                                          (cf-runtime-primitives §1)
│       └── 32k concurrent sockets per DO max
│
├── Webhook / external trigger ─────────────────────────────────► Agent (HTTP onRequest only)
│       └── one DO per source (e.g. github-webhook example)
│
├── Inbound email ──────────────────────────────────────────────► Agent + routeAgentEmail
│                                                                  (cf-agents-core §3)
│
├── Account-wide singleton / coordinator ───────────────────────► Agent + name: "default"
│
└── "Headless" agent invoked over RPC by other Workers ─────────► Agent + getAgentByName + RPC
                                                                   (NO @callable; that's for clients)
```

---

## Decision 1: Base class — fully expanded

```
Is there a chat UI in the browser?
├── YES ──► AIChatAgent (from @cloudflare/ai-chat) — DONE
└── NO  ──► continue
            │
            Is this an MCP server?
            ├── YES ──► tools need state? (per-user OAuth tokens, counters, history)
            │           ├── YES ──► McpAgent
            │           └── NO  ──► createMcpHandler (stateless, no DO)
            └── NO  ──► continue
                        │
                        Is the work multi-step + must-survive-deploys + sleeps > 15 min?
                        ├── YES ──► WorkflowEntrypoint
                        │           (usually composed with an Agent if user-facing)
                        └── NO  ──► Agent (generic)
```

**Compose, don't pick one.** Most non-trivial systems are a composition:

```
AIChatAgent (front door, persisted chat, schedules)
        │
        ├──runWorkflow──► ResearchWorkflow (10 steps, 30 min sleeps)
        │
        ├──getAgentByName──► PlannerAgent      (sub-agent)
        │                    SummarizerAgent   (sub-agent)
        │
        └──env.AI.run + AIG────► LLM
```

---

## Decision 2: Naming — fully expanded

```
What is the unit of state isolation?
│
├── one user owns it ──────► name = `user-${session.userId}`
├── one chat owns it ──────► name = `chat-${chatId}` (multi-ai-chat pattern)
├── one tenant owns it ────► name = `tenant-${orgId}`
├── one room/doc owns it ──► name = `room-${roomId}`
├── one source owns it ────► name = `webhook-${sourceId}` or `repo-${repoId}` (github-webhook example)
├── account-wide ──────────► name = "default"
└── high-cardinality bucket ► name = `bucket-${hash(input) % N}`
                              (when per-input would exceed DO ceiling)
```

**Cross-cuts the choice:**

- Always derive the name on the **server** from a verified session/token. Never let the client choose.
- Throughput per single DO: ~1,000 req/s soft ceiling — shard with `-shard-${i}` if exceeded.
- `locationHint` (`enam`/`weur`/...) and `jurisdiction` (`eu`/`fedramp`) optional but free.

---

## Decision 3: Transport — fully expanded

```
Who is talking to the agent?
│
├── Browser, interactive ─────────► WebSocket
│                                   (use AIChatAgent or Agent + onConnect/onMessage)
│                                   Hibernates: yes (acceptWebSocket — catalog #2)
│
├── Browser, one-shot fetch ──────► HTTP onRequest
│                                   (or SSE if streaming)
│
├── External webhook / cron ──────► HTTP onRequest
│                                   (HMAC verify; github-webhook pattern)
│
├── Other Worker / Agent ─────────► RPC via getAgentByName(env.X, name).method()
│                                   (NOT @callable; that's for clients)
│
├── MCP client ──────────────────► MCP transport
│                                   ├── streamable-http ──► default, modern (cf-agents-core §10)
│                                   ├── sse ──────────────► DEPRECATED, do not start here
│                                   └── rpc ──────────────► same-Worker only
│
├── Email server ────────────────► routeAgentEmail
│
└── Voice / phone ───────────────► WebSocket + Workers AI STT/TTS/VAD
```

**Hibernation × transport matrix** — see `transport-matrix.md`.

---

## Decision 4: State model — fully expanded

```
Is this state UI-visible?
├── YES (status, progress, public counter) ──► this.setState (broadcasts cf_agent_state)
└── NO  ──► continue
            │
            Is this a secret / token / PII?
            ├── YES ──► this.sql (NEVER setState — catalog #1)
            └── NO  ──► continue
                        │
                        Is this per-WebSocket connection state?
                        ├── YES ──► connection.serializeAttachment (max 2 KB,
                        │            survives hibernation)
                        └── NO  ──► continue
                                    │
                                    Hot path single-row read/write?
                                    ├── YES ──► this.ctx.storage.kv (synchronous, SQLite-backed)
                                    └── NO  ──► this.sql (general SQLite)
```

**Validation:** override `validateStateChange(next, source)` (sync,
throws to reject). Never validate in `onStateChanged()` — that's a
notification hook only (cf-agents-core §2).

**Vectorize for RAG:** SQL = source of truth, Vectorize = embeddings. Two
separate stores (cf-agents-core §11). Don't put embeddings in SQLite
unless they're tiny and few.

---

## Decision 5: Time + persistence — fully expanded

```
When does this work need to fire?
│
├── In N seconds / minutes ──────► this.schedule(N, "method", payload)
├── At absolute Date ────────────► this.schedule(new Date(...), ...)
├── On a cron ───────────────────► this.schedule("0 8 * * *", ...)
├── At sub-minute interval ─────► this.scheduleEvery(seconds, ...)
│                                   (skips overlapping runs)
│
├── Multi-step pipeline ────────► WorkflowEntrypoint
│       │
│       ├── retry per step ──────► step.do(name, fn) + retries options
│       ├── sleep > 15 min ──────► step.sleep("1 day")
│       ├── wait for human ──────► step.waitForEvent
│       └── progress to UI ──────► step.updateAgentState (Agent broadcasts)
│
├── Fan-out N independent jobs ─► Queue (env.QUEUE.send / sendBatch)
│       │                          DLQ recommended; default 3 retries
│       └── concurrency 1-250 (auto recommended)
│
├── Single-DO buffer flush ─────► DO alarm (raw) — but Agent.schedule()
│                                   is strictly better in 99% of cases
│
└── Long-running in-DO loop ────► durable execution (runFiber +
                                   onFiberRecovered) — advanced;
                                   closures NOT serialized (cf-agents-core §15)
```

**Idempotency:**

- Cron schedules: idempotent by default.
- Delayed/Date schedules: NOT idempotent — pass `{ idempotent: true }` from `onStart()`.
- Workflow `step.do`: idempotent (cached by name) — non-`step` calls in workflow body may run multiple times on retry.
- Queue messages: at-least-once delivery — handler must be idempotent.

**Sub-agents cannot schedule.** Schedule from the parent Agent.

**Workflows cannot open WebSockets.** For workflow → client push, the
workflow updates agent state and the agent broadcasts (cf-agents-core §6).

---

## Decision 6: Topology — fully expanded

```
Is the work bounded by one logical entity (user, chat, room)?
├── YES ──► single Agent per entity
└── NO  ──► continue
            │
            Does any of this apply?
            ├── parallelizable across N items ──► sub-agents (one per item)
            ├── role separation matters ────────► sub-agents (auditor pattern)
            ├── parent context would overflow ──► sub-agents (researcher pattern)
            ├── per-tenant facets needed ───────► directory + facet sub-agents
            │                                     (assistant / multi-ai-chat pattern)
            └── one big multi-step job ─────────► Agent + Workflow back-end (NOT sub-agents)
```

**Sub-agent rules (cf-agents-core §15):**

- Child class extends `Agent`, exported by **exact** class name.
- Auto-discovered via `ctx.exports`; only the parent needs a DO binding.
- Children **cannot** schedule, `keepAlive`, or be the workflow root.
- `abortSubAgent` / `deleteSubAgent` cascade to grandchildren.

---

## Extra surfaces — know they exist

These don't usually drive the first six decisions but the architect
should surface them when the project clearly needs them:

```
Surface              When to bring it up                                      Brief
────────────────────────────────────────────────────────────────────────────────────────────
Think                Opinionated chat agent: getModel/getSystemPrompt/        cf-agents-core §15
                     getTools/configureSession overrides; used as parent
                     in agents-as-tools.

Sessions             Cross-conversation memory primitives                     cf-agents-core
                     (agents/experimental/memory/session). Experimental.       §15

Durable execution    runFiber for long in-DO fibers that survive restarts.    cf-agents-core §15
                     Closures NOT serialized — restart logic must live in
                     onFiberRecovered. If onFiberRecovered throws, the row
                     is deleted with no automatic retry.

Codemode             LLM writes JS that orchestrates tools in a sandboxed     cf-agents-core §12
                     Worker. EXPERIMENTAL. needsApproval NOT honored.
                     External network blocked by default.

x402                 Paid MCP tools / paid HTTP routes ($X per call).         cf-agents-core §15
                     withX402(server) for MCP; Hono paymentMiddleware()
                     for HTTP.

Voice                Full STT/TTS/VAD/LLM loop in one DO via Workers AI.      cf-agents-core
                     Interruption support; useVoiceInput hook on the           voice example
                     React side.

Email                routeAgentEmail in + this.sendEmail() out;               cf-agents-core §3
                     createSecureReplyEmailResolver for HMAC-validated
                     replies.

Browser Run / pptr   LLM-driven web browsing via BROWSER binding +            cf-agents-core §12
                     codemode (browser_search + browser_execute), or
                     @cloudflare/puppeteer for programmatic flows.
                     Each browser_execute opens a fresh session — no
                     auth/cookies persist across calls.

A2A protocol         Expose Agent as A2A server with Agent Card +             cf-github-canon §3
                     SSE streaming.
```

---

## Anti-patterns the architect refuses

| User says... | Refuse with... |
|---|---|
| "Use `new_classes` because we're prototyping" | NO — irreversible. Use `new_sqlite_classes` always. |
| "Use `accept()` for the WS, hibernation is over-engineering" | NO — bills 24/7 per connection. SDK uses `acceptWebSocket`; do not bypass. |
| "Put OAuth tokens in `setState` so the client knows we're connected" | NO — broadcasts to every client. Use `this.sql`; broadcast a sanitized `connected: true`. |
| "Let the client pass the agent name in the URL" | NO — server picks the name from session. |
| "Skip AI Gateway, we want to call the provider directly" | NO — AIG is mandatory (cache, rate limit, fallback, logs). |
| "Use `experimentalDecorators` to fix this build error" | NO — silently breaks `@callable`. Extend `agents/tsconfig`. |
| "Have a sub-agent schedule its own work" | NO — schedule throws in sub-agents. Schedule from the parent. |
| "Use `agents/ai-chat-agent`" | NO — deprecated shim. Import `@cloudflare/ai-chat` directly. |
| "Open a WebSocket inside a Workflow step" | NO — workflows cannot open WS. Have the Agent broadcast. |
| "Skip the architecture spec, we'll figure it out as we go" | NO — six decisions before code, spec is the contract. |
