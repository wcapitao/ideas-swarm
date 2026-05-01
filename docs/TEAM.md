# Team Responsibilities

> Three contributors, each owning distinct phases. Interfaces between roles are explicit to avoid duplicate work and dropped handoffs.

## Roster

| Name | Focus | Phases owned | Stack |
|------|-------|-------------|-------|
| **Wilson** | Core runtime + orchestration | 2, 3, 5 + overall architecture | TypeScript (Cloudflare Agents SDK), Python (retrieval tooling) |
| **Florian** | Knowledge base + concept extraction | 0, 1 | Python (Ruff, Pytest, Pyright, Pydantic v2) |
| **Ivo** | Evaluation council / swarm | 4 | TypeScript (Cloudflare Agents SDK) |

---

## Florian — Knowledge Base & Concept Ontology

### Phase 0: Knowledge Base (active)

- Source, ingest, and analyze research papers into `kb/raw/`.
- Write wiki articles in `kb/wiki/` conforming to `kb/SCHEMA.md` — frontmatter, tiering, citations, contradiction blocks.
- Maintain domain `INDEX.md` files and the master `kb/INDEX.md`.
- Run the paper analysis pipeline (`scripts/analyze_papers.py`, `scripts/build_graph.py`, etc.).
- Ensure exit criteria: any contributor reads `kb/INDEX.md` and understands the field in 15 minutes.
- Run `kb-lint` after every batch of additions.

### Phase 1: Concept Ontology

- Design concept granularity (the central risk — too coarse = bland, too fine = explosion).
- Build extraction script (`scripts/extract_concepts.py`) to produce `concepts.jsonl`.
- Define the concept schema: `{id, name, definition, parent_concepts, related_concepts, sources[], embedding}`.
- Pilot with ~200 concepts before committing to granularity.
- Write ADR documenting granularity decisions.

### Artifacts owned

- `kb/` (entire tree — `raw/`, `wiki/`, all `INDEX.md` files, `SCHEMA.md`)
- `cybersec-papers/` (ingestion pipeline)
- `scripts/analyze_papers.py`, `build_graph.py`, `build_indexes.py`, `finish_analysis.py`, `report.py`
- `src/ai_ideator/analyzer/`
- `concepts.jsonl` (Phase 1 output)

### Skills to use

`kb-ingest`, `kb-add-domain`, `kb-lint`, `kb-query`, `kb-explore`, `kb-brief`

---

## Ivo — Evaluation Council / Swarm

### Phase 4: Evaluator

- Design the multi-agent evaluation architecture — a council/swarm where multiple evaluator agents independently score each idea.
- Implement pluggable evaluators grounded in the literature's frameworks:
  - **Novelty** — is this combination surprising? (Boden's criteria, embedding distance from known ideas)
  - **Utility** — is it useful? (market signal, feasibility heuristics)
  - **Surprise** — does it violate expectations productively? (Wiggins' CSF)
  - **Feasibility** — can it be built? (resource, tech, market constraints)
- Build the eval harness with golden examples of "good" and "bad" blends.
- Run ablation: does the system beat naive single-prompt generation on novelty *and* utility?
- Design the council consensus mechanism — how do individual agent scores aggregate into a final verdict.

### Architecture constraints

- Runs on **Cloudflare Agents SDK** (TypeScript, Workers + Durable Objects) — consistent with the combiner agent.
- Each evaluator agent is a separate Durable Object (or subagent within one).
- LLM calls go through **AI Gateway** (logging, caching, fallback).
- Every evaluator has a structured output schema (Zod).
- **Stella Principle**: scoring math, ranking, and aggregation are deterministic (no LLM). LLMs only do qualitative judgment (e.g., "is this blend genuinely novel or just unusual?").

### Artifacts owned

- `agent/evaluator/` (Phase 4 agent code, when created)
- Eval golden set and ablation results
- Evaluator Durable Object definitions
- ADR for council architecture and consensus mechanism

### Skills to use

`cf-agent-architect`, `cf-agent-state-and-storage`, `cf-agent-models-and-gateway`, `cf-agent-tests-and-evals`, `cf-agent-multi-agent-orchestration`

---

## Wilson — Retrieval, Combiner Agent & Interface

### Phase 2: Retrieval Layer

- Build the embedding store (sqlite-vec or Vectorize).
- Implement symbolic index over `key_concepts` frontmatter from `concepts.jsonl`.
- Build the distance-controlled sampler: `retrieve(query, k, min_distance, max_distance)` — the Mednick/remote-associates mechanism.
- Coverage diagnostics: which domains are over/under-represented in retrieval.

### Phase 3: Combiner Agent

- Build the generator-critic loop on **Cloudflare Agents SDK**:
  - **Retriever** subagent: pulls concept pairs at controlled distance.
  - **Blender** subagent: runs Fauconnier-Turner protocol — generic space, projection, emergent structure, business form.
  - **Critic** subagent: initial quality gate before ideas reach Ivo's evaluation council.
  - **Orchestrator**: budgets, logs, persists structured output.
- State in Durable Objects (SQLite-backed). LLM calls through AI Gateway.
- Structured output via Zod schemas.

### Phase 5: Interface

- CLI-first, then API, then UI.
- Frontend uses `agents/react` (`useAgent`, `useAgentChat`) over WebSocket with hibernation.
- Session model: single-shot ideation vs. session-based exploration (decision pending).
- Human steering: constraints, seeds, rejected directions.

### Overall architecture

- Owns `docs/architecture/` and ADRs.
- Final say on cross-phase integration points.
- Maintains `CLAUDE.md`, `docs/ROADMAP.md`, and project-level configuration.

### Artifacts owned

- `agent/` (except `agent/evaluator/` — that's Ivo's)
- Phase 2 retrieval code (location TBD — likely `agent/retriever/` or `src/ai_ideator/retriever/`)
- `docs/architecture/`, `docs/adr/`
- `wrangler.jsonc`, CI/CD config
- `CLAUDE.md`, `docs/ROADMAP.md`, `docs/TEAM.md`

### Skills to use

`cf-agent-architect`, `cf-agent-state-and-storage`, `cf-agent-realtime-and-frontend`, `cf-agent-tools-and-mcp`, `cf-agent-deploy-and-observe`, `cf-agent-workflows-and-scheduling`

---

## Interfaces & Handoff Points

These are the contracts between roles. Each handoff has a defined artifact and format.

```
Florean ──────────────────────────────────────── Wilson ──────────────── Ivo
                                                    │                      │
Phase 0: kb/wiki/*.md  ──→  Phase 2: embeddings    │                      │
Phase 1: concepts.jsonl ──→  Phase 2: indexing      │                      │
                                                    │                      │
                              Phase 3: raw ideas ───┼──→  Phase 4: scored ideas
                              (structured blends)   │     (council verdict)
                                                    │                      │
                              Phase 5: UI shows  ←──┼──── scored results   │
```

| From → To | Artifact | Format | Contract |
|-----------|----------|--------|----------|
| Florean → Wilson | Wiki articles | Markdown per `kb/SCHEMA.md` | Frontmatter valid, tier assigned, all claims cited |
| Florean → Wilson | Concept records | `concepts.jsonl`, one JSON per line | Schema: `{id, name, definition, parent_concepts, related_concepts, sources[]}` |
| Wilson → Ivo | Raw idea blends | Structured JSON (Zod schema TBD) | Each blend includes `inputs`, `generic_space`, `blend`, `provenance` |
| Ivo → Wilson | Scored ideas | Structured JSON with scores | Each score: `{novelty, utility, surprise, feasibility}` ∈ [0,1] + qualitative rationale |

---

## Shared Responsibilities

- **Code review**: everyone reviews PRs touching their owned artifacts. Cross-boundary PRs get two reviewers.
- **Stella Principle**: everyone enforces it in their domain. Deterministic work stays in scripts/Workers; LLMs do judgment only.
- **Testing**: every feature ships with tests. No exceptions.
- **KB citations**: if you reference a KB article anywhere in code or docs, verify the source exists in `kb/wiki/`.

---

## Decision Rights

| Decision | Owner | Consulted |
|----------|-------|-----------|
| KB schema changes | Florean | Wilson |
| Concept granularity | Florean | Wilson, Ivo |
| Agent architecture (combiner) | Wilson | Ivo |
| Evaluation framework & scoring | Ivo | Wilson, Florean |
| Cross-phase API contracts | Wilson | All |
| Infrastructure & deploy | Wilson | — |
| UI/UX | Wilson | — |
