# Cloudflare Agents skill suite — index

This directory holds the project's specialist suite for building Cloudflare Agents. Ten skills covering the lifecycle from architecture to deploy. They're activated by phrasing — see each skill's frontmatter `description` for trigger words. This index is for humans skimming the suite, not for the LLM.

> **Scope:** this suite is for *this project* (`ai-ideator`). The Anthropic Agent SDK skills at `~/.claude/skills/agent-*` remain available globally for other projects, but should NOT be invoked here. The Cloudflare runtime (Durable Objects, hibernation, AIG, Vectorize) differs enough that the Anthropic playbooks lead you wrong.

## The 10 skills

| # | Skill | Activates on | Hand-off targets |
|---|---|---|---|
| 1 | [`cf-agent-architect`](./cf-agent-architect/) | "build/design a Cloudflare agent", "what shape should this take", new agent project | tools-and-mcp, state-and-storage, workflows-and-scheduling |
| 2 | [`cf-agent-tools-and-mcp`](./cf-agent-tools-and-mcp/) | "add a tool", "register a tool", "build an MCP server", "@callable" | auth-and-permissions, tests-and-evals |
| 3 | [`cf-agent-state-and-storage`](./cf-agent-state-and-storage/) | "agent state", "DO storage", "broadcast to clients", "schema migration", "Vectorize index" | tests-and-evals, deploy-and-observe |
| 4 | [`cf-agent-workflows-and-scheduling`](./cf-agent-workflows-and-scheduling/) | "schedule a task", "cron", "long-running job", "Workflow", "alarm", "durable execution" | tests-and-evals |
| 5 | [`cf-agent-realtime-and-frontend`](./cf-agent-realtime-and-frontend/) | "WebSocket agent", "useAgent", "useAgentChat", "chat UI", "stream tokens", "AI SDK bridge" | tools-and-mcp |
| 6 | [`cf-agent-models-and-gateway`](./cf-agent-models-and-gateway/) | "Workers AI", "AI Gateway", "embeddings", "Vectorize", "RAG", "AI Search", "fallback provider" | tests-and-evals |
| 7 | [`cf-agent-auth-and-permissions`](./cf-agent-auth-and-permissions/) | "OAuth", "MCP auth", "workers-oauth-provider", "scopes", "this.props vs setState", "secret rotation" | tools-and-mcp |
| 8 | [`cf-agent-tests-and-evals`](./cf-agent-tests-and-evals/) ⭐ | "test the agent", "vitest pool workers", "runInDurableObject", "eval the agent", "golden set", "judge model", "regression test" | deploy-and-observe |
| 9 | [`cf-agent-deploy-and-observe`](./cf-agent-deploy-and-observe/) | "wrangler config", "deploy", "migration", "secret put", "wrangler tail", "logpush", "CI/CD", "production checklist" | tests-and-evals |
| 10 | [`cf-agent-multi-agent-orchestration`](./cf-agent-multi-agent-orchestration/) | "sub-agent", "agent-to-agent", "getAgentByName", "handoff", "fan out", "supervisor pattern" | architect |

⭐ = elevated to first-class per project decision (2026-04-30). Tests + evals are not optional.

## Typical lifecycle

```
new agent → 1. cf-agent-architect              ← always first
              ↓
            2-7. specialist skills              ← as work demands, in parallel
              ↓
            8. cf-agent-tests-and-evals         ← runs alongside 2-7 (TDD-ish)
              ↓
            9. cf-agent-deploy-and-observe      ← gates production
              ↓
            10. cf-agent-multi-agent-orchestration  ← when topology grows
```

## Cross-cutting non-negotiables

These rules apply to every Cloudflare agent. Each skill enforces a subset; together they prevent the most common production failures.

1. **Never put secrets in `setState`** — broadcasts to all WS clients.
2. **`acceptWebSocket()` not `accept()`** — disables hibernation and burns cost.
3. **Always SQLite-backed DOs** (`new_sqlite_classes`). Cannot retrofit later.
4. **`experimentalDecorators: false`** in tsconfig — silently breaks `@callable`.
5. **AI Gateway in front of every LLM call** — caching, rate-limit, fallback, logs, replay.
6. **MCP SDK ≥1.26.0** requires fresh `McpServer` per request in stateless servers.
7. **Vitest workspace split** with `--no-isolate` for any test that touches WebSocket DOs.
8. **`vi.spyOn(env.AI, "run")`** is the canonical Workers AI mock.
9. **`AIChatAgent` from `@cloudflare/ai-chat`**, not the deprecated `agents/ai-chat-agent` shim.
10. **`AbortSignal` does not cross DO RPC** — enforce timeouts on the DO side.

## Provenance

Skills derived from 7 research briefs in `docs/research/`:
- `cf-agents-core.md` — Agents SDK API surface
- `cf-runtime-primitives.md` — Durable Objects, Workflows, Queues
- `cf-ai-stack.md` — Workers AI, AI Gateway, Vectorize, AI Search
- `cf-github-canon.md` — `cloudflare/agents`, `agents-starter`, `mcp-server-cloudflare`, external repos
- `cf-mcp-auth-frontend.md` — McpAgent, OAuth provider, agents/react, chat stack
- `cf-deploy-observe.md` — wrangler, observability, CI/CD
- `cf-tests-evals.md` — vitest pool, eval harness, AIG eval flow

Each skill cites its source brief inline. To revise a skill, update the brief first, then the skill.

## Versioning

All skills are at v0.1.0. Major bumps when:
- The Cloudflare Agents SDK ships a breaking change (e.g., a base class rename).
- A non-negotiable rule is added or removed.
- The skill structure changes in a way that breaks invocation.

Skills are added/improved iteratively from production experience. The `CHANGELOG.md` in each skill records why each version exists.
