# Roadmap

## Phase 0 — Knowledge Base (active)

**Goal:** Ground the project in arXiv research. Build a navigable wiki populated exclusively with arXiv papers — the agents will analyze these papers and extract concepts for combinatorial recombination.

**Deliverables:**
- [ ] 5 domain `INDEX.md` files (foundational-philosophy, computational-creativity, combinatorial-creativity, llm-creativity, agentic-ideation)
- [ ] 50–80 wiki articles sourced exclusively from arXiv papers, all conforming to `kb/SCHEMA.md`
- [ ] Master `kb/INDEX.md` with concept glossary and cross-domain navigation
- [ ] At least 20 cross-references (`connections:` blocks) between articles
- [ ] `docs/CONCEPT.md` — synthesis of the lineage (done)

**Exit criteria:** Any contributor can open `kb/INDEX.md` and within 15 minutes understand the arXiv-sourced research landscape — what combinatorial creativity is, who said what, and what the LLM-era state of the art looks like.

---

## Phase 1 — Concept Ontology

**Goal:** Convert wiki content into atomic "concept" records that downstream agents can retrieve and combine.

**Deliverables:**
- `concepts.jsonl` — one record per concept extracted from the KB
- Schema: `{id, name, definition, parent_concepts, related_concepts, sources[], embedding}`
- Extraction script in `scripts/extract_concepts.py`
- ADR documenting concept-granularity decisions

**Risk:** Concept granularity is the central design question. Too coarse and combinations are bland; too fine and the search space explodes. Pilot with ~200 concepts before committing.

---

## Phase 2 — Retrieval Layer

**Goal:** Given a query (or a random seed), return *k* concepts with controllable **distance** — not just nearest neighbors.

**Deliverables:**
- Embedding store (start with sqlite-vec or Chroma; defer Pinecone unless needed)
- Symbolic index over `key_concepts` frontmatter
- Distance-controlled sampler: `retrieve(query, k=2, min_distance=0.4, max_distance=0.8)` — the **Mednick/remote-associates** mechanism
- Coverage diagnostics: which domains are over/under-represented in retrieval?

---

## Phase 3 — Combiner Agent

**Goal:** Generator-critic loop using Claude Agent SDK that turns concept pairs into structured blends.

**Architecture (preliminary):**
- **Retriever** (subagent): pulls concept pairs at controlled distance.
- **Blender** (subagent): runs the Fauconnier-Turner protocol — generic space, projection, emergent structure, business form.
- **Critic** (subagent): scores against novelty/utility/surprise/feasibility; routes back to Blender if below threshold.
- **Orchestrator**: budgets, logs, persists the structured output.

Validate with `agent-sdk-architect` skill before coding.

---

## Phase 4 — Evaluator

**Goal:** Quantitative scoring against the literature's frameworks (Boden's criteria, Ritchie's empirical criteria, Wiggins' CSF).

**Deliverables:**
- Pluggable evaluators (LLM-judge, embedding-distance, retrieval-grounded factuality)
- Eval harness with golden examples of "good" and "bad" blends
- Ablation: do we beat naive single-prompt ChatGPT on novelty *and* utility?

---

## Phase 5 — Interface

**Goal:** Make it usable. CLI first, then API, then (maybe) UI.

**Open questions:**
- Single-shot ideation vs. session-based exploration?
- How does the human steer? (constraints, seeds, rejected directions)
- Persistence model for "ideas I want to keep working on"?

---

## Cross-cutting concerns

- **Stella Principle**: scripts handle all deterministic work; LLMs do only judgment. Audit every new LLM call against this.
- **Cost discipline**: every Phase-3+ run has a turn budget *and* a cost cap.
- **Provenance**: every output traces back to specific KB sources. No untraceable claims.
- **KB hygiene**: run `kb-lint` after every 50–100 article additions/edits.
