# ai-ideator — Project Operating Rules

> These rules extend the global rules at `~/CLAUDE.md`. Project-specific guidance here takes precedence on conflict.

## Project mission

Build an agentic LLM workflow that generates business ideas via **combinatorial creativity** — retrieving concepts from a curated knowledge base and recombining them with disciplined evaluation.

## Phases

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Knowledge base — canonical research, indexed and summarized | **active** |
| 1 | Concept ontology — extract atomic "concepts" from KB articles | not started |
| 2 | Retrieval layer — embedding + symbolic indexing of concepts | not started |
| 3 | Combiner agent — generator/critic loop on **Cloudflare Agents SDK** (TypeScript, Workers + Durable Objects) | not started |
| 4 | Evaluator — novelty + utility + surprise scoring | not started |
| 5 | UI / API — interactive ideation interface | not started |

## Knowledge Base (`kb/`) rules

1. **One source of truth per concept**. If a concept appears across multiple papers, create one wiki article and link to all sources.
2. **Every wiki article has frontmatter** matching `kb/SCHEMA.md`. No exceptions.
3. **Citations are mandatory**. Every factual claim cites a source — either a `raw/` file or a canonical URL with retrieval date.
4. **Tier honestly**:
   - **T1**: foundational / canonical / must-read for anyone working on this system.
   - **T2**: important supporting context.
   - **T3**: optional reference, included for completeness.
5. **Contradictions are flagged, not silenced**. Use the `CONTRADICTION` block in `SCHEMA.md`.
6. **Indexes are derived, not hand-written from scratch**. When adding articles, update the relevant `INDEX.md` and `kb/INDEX.md` in the same change.
7. **The `raw/` tree is immutable** once ingested. Source preservation matters.

## Code rules

This project is **bilingual** by design — the runtime split follows the runtime requirements, not preference:

### KB tooling (`scripts/`, `src/ai_ideator/kb/`) — Python 3.11+
- **Ruff** for lint+format. **Pytest** for tests. **Pyright** for type checking (strict).
- **Pydantic v2** for all structured data (concepts, ideas, evaluation outputs).
- This code runs locally / in CI — file I/O, ingestion, hashing, lint, embedding pre-computation.

### Agent runtime (`agent/`) — TypeScript on Cloudflare Workers (Phase 3+)
- **Cloudflare Agents SDK** (`agents` npm package) on Workers + Durable Objects.
- **Wrangler** for config / dev / deploy. **Vitest** with `@cloudflare/vitest-pool-workers` for tests.
- **TypeScript strict**, **Biome** (or eslint+prettier) for lint/format.
- State lives in Durable Objects (SQLite-backed). Scheduling via the Agents SDK `schedule` API or Workflows. LLM calls go through **AI Gateway** (logging, caching, fallback). Embeddings live in **Vectorize**.
- The frontend uses `agents/react` (`useAgent`, `useAgentChat`) over WebSocket with hibernation.

### Cross-cutting rules
- **No deterministic work in LLM calls** (Stella Principle from global CLAUDE.md). LLMs do judgment — synthesis, prioritization, blending. Scripts/Workers handle file I/O, embedding lookups, JSON parsing, ranking math.
- **Every LLM call has a budget** (token cap, cost ceiling, max retries) and a structured output schema (Zod on the TS side, Pydantic on the Python side).
- **Every Agent method has a test** — unit (pure functions), DO-level (`runInDurableObject`), and end-to-end (`SELF.fetch`). Eval suite runs nightly against a golden conversation set.

## Communication style for this project

- When discussing creative output: cite the source of each idea-input. "Combined X (from raw/foo.md) with Y (from raw/bar.md)" is the right level of traceability.
- When proposing architecture: ground it in a KB reference. "We're using a generator-critic split because Madaan et al. 2023 (Self-Refine) showed …" beats "let's add a critic agent."
- When in doubt, read `kb/INDEX.md` first.

## Skill activation hints

### Knowledge Base (Phase 0)
- New KB sources arriving → `kb-ingest` skill.
- New research domain → `kb-add-domain` skill.
- Health check on the KB (links, dupes, contradictions) → `kb-lint` skill.
- Question about combinatorial creativity → `kb-query` skill (synthesizes from wiki content).

### Agent runtime (Phase 3+) — Cloudflare Agents SDK
This project uses the **Cloudflare Agents SDK**, not the Anthropic Agent SDK. The global `~/.claude/skills/agent-*` skills (Anthropic SDK) remain available for other projects but are **not** the right tool here. Use the Cloudflare suite under `.claude/skills/cf-*` instead:

- Designing / shaping a new agent → `cf-agent-architect`
- Adding tools or building an MCP server (`McpAgent`) → `cf-agent-tools-and-mcp`
- State, SQL, multi-client sync, hibernation → `cf-agent-state-and-storage`
- `schedule()`, alarms, Workflows, long-running jobs → `cf-agent-workflows-and-scheduling`
- WebSocket / SSE / `agents/react` realtime UX, chat frontend → `cf-agent-realtime-and-frontend`
- Workers AI, AI Gateway, Vectorize, prompt + model tuning → `cf-agent-models-and-gateway`
- OAuth provider, scopes, secret hygiene, permission posture → `cf-agent-auth-and-permissions`
- **Tests + evals** (vitest pool, DO testing, golden-set evals, AIG eval flow) → `cf-agent-tests-and-evals`
- `wrangler.jsonc`, migrations, logs, CI/CD, production checklist → `cf-agent-deploy-and-observe`
- Splitting into multiple agents, supervisor / sub-agents / handoff → `cf-agent-multi-agent-orchestration`

The suite index lives at `.claude/skills/CF_AGENTS_SUITE.md` (human-readable; the LLM auto-loads each skill via its frontmatter description).

If you reach for `agent-sdk-architect` / `agent-tool-and-mcp-builder` / `agent-prompt-and-model-tuning` in this repo, stop — use the `cf-` equivalent above. Concepts overlap, but the primitives (DOs vs in-process state, hibernation vs long-lived sessions, AIG vs direct provider calls) are different enough that the Anthropic playbooks will lead you wrong.
