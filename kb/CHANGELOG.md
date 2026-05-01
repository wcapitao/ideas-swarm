# KB Changelog

## [0.1.0] — 2026-04-30 — Phase 0 Knowledge Base

### Added
- Project skeleton: README, CLAUDE.md, pyproject.toml, .gitignore, .env.example, src/ai_ideator stub, docs/CONCEPT.md, docs/ROADMAP.md.
- KB scaffolding: `kb/SCHEMA.md`, `kb/INDEX.md`, `kb/LOG.md`, `kb/CHANGELOG.md`.
- 5 domain directories with full article sets:
  - `foundational-philosophy/` — 13 primary-source articles + INDEX.md
  - `computational-creativity/` — 18 articles + INDEX.md
  - `llm-creativity/` — 22 articles + INDEX.md (including the user-cited anchor paper arXiv:2509.21043)
  - `agentic-ideation/` — 21 articles + INDEX.md
  - `combinatorial-creativity/` — 6 cross-cutting concept articles + INDEX.md
- Master `kb/INDEX.md` with concept glossary and three reading paths.
- Raw research-agent JSON batches preserved in `kb/raw/<domain>/_research-batch-001.json` for traceability.

### Conventions established
- Article frontmatter per `kb/SCHEMA.md` (required: title, authors, year, type, domain, tier, canonical_url, retrieved, key_concepts, related_articles, status).
- Tier classification: T1 (must-read), T2 (important context), T3 (supporting).
- Cross-references are bidirectional where applicable; concept articles in `combinatorial-creativity/` are the cross-cutting glue.

### Coming
- Phase 1: extract atomic concepts from wiki articles into `concepts.jsonl`.
- Phase 2: embedding store + symbolic index + distance-controlled retriever.
- Phase 3: Cloudflare Agents SDK combiner MVP in **`agent/`** (`IdeatorAgent` + inline adversarial **`evaluator.ts`**); full multi-DO / graph-backed loop still future.
