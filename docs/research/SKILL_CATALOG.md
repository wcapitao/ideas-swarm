# Cloudflare Agents skill catalog

Synthesized from the 7 research briefs in this directory. The goal: a focused suite that turns Claude into a top-tier specialist in Cloudflare Agents — enough coverage to ship production agents quickly, narrow enough that each skill has crisp, non-overlapping triggers.

## Design principles

1. **Mirror the Anthropic suite shape** (architect → tools → state → schedule → ai → auth → tests → deploy → multi-agent) where the concept overlaps; **diverge** where Cloudflare's primitives demand it (DO state, hibernation, AIG, Vectorize, transport-aware MCP).
2. **First-class tests + evals.** The user explicitly elevated this. It gets a dedicated skill, not a section.
3. **Strong invocation triggers** in each `description`. Skills must self-activate on natural phrasing — "build an agent", "add a tool", "schedule a job", "write tests for the agent", "deploy to staging".
4. **Each skill has references/** with extracted source-of-truth material from the briefs, so the LLM doesn't re-derive on every invocation.
5. **Each skill has scripts/** when there's a deterministic helper that can replace LLM judgement (Stella Principle): wrangler config validators, migration linters, eval harness runners.

## The 10 skills

| # | Skill | Trigger phrases (informal) | Inputs (briefs) | Hand-off targets |
|---|---|---|---|---|
| 1 | `cf-agent-architect` | "build an agent", "design an agent", "Cloudflare agent for X", "what shape should this take" | core, runtime, github | tools-and-mcp, state-and-storage, workflows-and-scheduling |
| 2 | `cf-agent-tools-and-mcp` | "add a tool", "register a tool", "build an MCP server", "expose this as a tool" | core, mcp-auth-frontend, github | auth-and-permissions, tests-and-evals |
| 3 | `cf-agent-state-and-storage` | "agent state", "DO storage", "SQL on the agent", "broadcast to clients", "hibernation", "Vectorize index", "schema migration" | runtime, core, ai-stack | tests-and-evals, deploy-and-observe (migrations) |
| 4 | `cf-agent-workflows-and-scheduling` | "schedule a task", "cron in the agent", "long-running job", "Workflow from agent", "alarm", "background job", "durable execution" | runtime, core | tests-and-evals |
| 5 | `cf-agent-realtime-and-frontend` | "WebSocket agent", "agents/react", "useAgentChat", "chat UI for agent", "stream tokens", "AI SDK bridge", "SSE" | core, mcp-auth-frontend, github | tools-and-mcp |
| 6 | `cf-agent-models-and-gateway` | "Workers AI", "AI Gateway", "model selection", "embeddings", "Vectorize for RAG", "AI Search", "fallback provider" | ai-stack, core | tests-and-evals (eval harness uses AIG logs) |
| 7 | `cf-agent-auth-and-permissions` | "OAuth on the agent", "MCP auth", "workers-oauth-provider", "scopes", "secret in agent", "this.props vs setState" | mcp-auth-frontend, deploy-observe | tools-and-mcp |
| 8 | `cf-agent-tests-and-evals` | "test the agent", "vitest pool workers", "runInDurableObject", "test the websocket", "test scheduled tasks", "eval the agent", "golden set", "judge model", "regression tests for the agent" | tests-evals, core | deploy-and-observe (CI) |
| 9 | `cf-agent-deploy-and-observe` | "wrangler config", "deploy the agent", "migration", "secret put", "wrangler tail", "logpush", "CI/CD for the agent", "production checklist" | deploy-observe | tests-and-evals |
| 10 | `cf-agent-multi-agent-orchestration` | "sub-agent", "agent-to-agent", "getAgentByName", "handoff", "fan out", "multi-agent", "supervisor pattern" | core, github, runtime | architect (when designing the topology) |

## Skill activation order (typical lifecycle)

```
new agent project
   ↓
[1] cf-agent-architect          ← always first
   ↓
[2-7] specialist build skills   ← invoked in parallel as work demands
   ↓
[8] cf-agent-tests-and-evals    ← runs alongside [2-7] (TDD-ish)
   ↓
[9] cf-agent-deploy-and-observe ← gates production
   ↓
[10] cf-agent-multi-agent-orchestration ← when the agent grows past one DO class
```

## Cross-cutting non-negotiables (every skill must enforce)

These are findings from the briefs serious enough that *every* skill should know them and refuse to violate them:

1. **Never put secrets / OAuth tokens in `setState`** — it broadcasts to all clients. Use DO storage directly via `this.sql` or `this.ctx.storage`. *(cf-mcp-auth-frontend §10)*
2. **`acceptWebSocket()` not `accept()`** — the latter disables hibernation and burns cost. *(cf-runtime-primitives §4)*
3. **`new_sqlite_classes` not `new_classes`** — and once chosen, you cannot retrofit a DO from KV-backed to SQLite-backed. Always start SQLite. *(cf-runtime-primitives §5)*
4. **Disable `experimentalDecorators`** in tsconfig — silently breaks `@callable()`. Use the standards-track decorators that ship in TS 5.0+. *(cf-agents-core §15)*
5. **AI Gateway in front of every LLM call** — caching, rate limit, fallback, logs. Don't call providers directly. *(cf-ai-stack §2-3)*
6. **MCP SDK ≥1.26.0 needs a fresh `McpServer` per request** in stateless servers. Don't reuse the instance. *(cf-mcp-auth-frontend §1)*
7. **Vitest pool with `--no-isolate` + workspace split** for any test that touches WebSocket DOs. *(cf-tests-evals §2)*
8. **`vi.spyOn(env.AI, "run")`** is the canonical Workers AI mock. *(cf-tests-evals §4)*
9. **The current canonical chat base class is `AIChatAgent` from `@cloudflare/ai-chat`**, not the deprecated `agents/ai-chat-agent` shim. *(cf-mcp-auth-frontend §1, cf-github-canon §1)*
10. **`AbortSignal` doesn't cross DO RPC boundaries** — model timeouts have to be enforced on the DO side, not the caller. *(cf-agents-core §15)*

## Skill file structure (template)

Every skill follows this layout, mirroring the Anthropic suite at `~/.claude/skills/agent-*/`:

```
.claude/skills/cf-agent-<topic>/
├── SKILL.md              # YAML frontmatter + the playbook (≤1500 lines)
├── CHANGELOG.md          # version history
├── references/
│   ├── decision-tree.md  # the "when to use what" map
│   ├── recipes.md        # 5-10 worked code examples
│   └── gotchas.md        # the footguns
└── scripts/              # deterministic helpers (Stella Principle)
    └── <validator>.{sh,ts,py}
```

## SKILL.md frontmatter format

```yaml
---
name: cf-agent-<topic>
description: >
  <One paragraph. Lead with WHAT it does, then strong invocation triggers
  ("Activates when the user asks to ..."), then exclusions ("Do NOT use
  for ..."). Aim for 80-120 words. The description is what makes the skill
  self-invoke; weak descriptions = skill never fires.>
---
```
