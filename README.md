# Ideas-Swarm

> An agentic LLM workflow for generating novel ideas through **combinatorial creativity** — analyzing arXiv papers, extracting concepts, and recombining them in disciplined, traceable ways. The knowledge base is populated exclusively with arXiv papers.

## The thesis

Creativity is not magic. From Hume to Boden to today's LLM literature, the most productive theory of creative cognition treats new ideas as recombinations of existing ones. Hume called it the **association of ideas** (1739); Koestler called it **bisociation** (1964); Boden formalized it as **combinational creativity** (1990); Fauconnier & Turner gave it a cognitive mechanism with **conceptual blending** (1998).

LLMs are extraordinary at this last operation — projecting two conceptual spaces into a blended space — but they are *unreliable* on their own. They hallucinate, they regress to the mean, and they reward fluency over novelty. The way out is **structure**: a curated concept base, an agentic pipeline that separates divergent from convergent thinking, and an evaluation loop that scores novelty *and* utility.

This project builds that pipeline. The first deliverable is the **knowledge base** — a curated collection of arXiv papers on combinatorial creativity and related fields, summarized and indexed so downstream agents can analyze them and reason over extracted concepts.

## Repository structure

```
ai-ideator/
├── README.md                     ← you are here
├── CLAUDE.md                     ← project operating rules (extends global)
├── pyproject.toml                ← Python project (agent runtime, ingestion scripts)
├── docs/
│   ├── CONCEPT.md                ← What is combinatorial creativity?
│   ├── ROADMAP.md                ← Phases from KB → MVP → production
│   └── adr/                      ← Architecture decision records
├── kb/                           ← THE KNOWLEDGE BASE (research substrate)
│   ├── INDEX.md                  ← Master index across all domains
│   ├── SCHEMA.md                 ← Wiki article format & ingestion contract
│   ├── LOG.md                    ← Append-only operations log
│   ├── CHANGELOG.md
│   ├── wiki/                     ← Synthesized knowledge (one .md per concept/work)
│   │   ├── foundational-philosophy/   ← Hume, Locke, Koestler, Mednick, …
│   │   ├── computational-creativity/  ← Boden, Fauconnier & Turner, Wiggins, …
│   │   ├── combinatorial-creativity/  ← Cross-cutting: bisociation, blending …
│   │   ├── llm-creativity/            ← 2022–2026 LLM ideation papers
│   │   └── agentic-ideation/          ← Multi-agent debate, ToT, GoT, frameworks
│   └── raw/                      ← Original sources (PDFs, scraped HTML, notes)
├── src/ai_ideator/               ← Future: agent runtime
├── tests/
└── scripts/                      ← KB ingestion, validation, hashing helpers
```

## Status

**Phase 0 — Knowledge Base** (in progress).
Building the research foundation from arXiv papers exclusively. Every paper gets a wiki article with citations, key-concept extraction, and tier classification (T1 = must-read, T2 = important context, T3 = supporting). Each domain has its own `INDEX.md`; `kb/INDEX.md` indexes the indexes.

See `docs/ROADMAP.md` for what comes next.

## How to navigate the KB

- Want **the canon**? Start with `kb/INDEX.md`, then read T1 entries in each domain.
- Want **a specific concept** (e.g. "bisociation", "conceptual blending", "tree of thoughts")? Search `kb/wiki/` or grep the `key_concepts` frontmatter field.
- Want **the lineage of an idea**? Each article has a `connections` block linking to predecessors and descendants across domains.

## Conventions

- Every wiki article cites its source: `[Source: raw/path/to/file.md]` or canonical URL.
- Every claim is attributed.
- Contradictions between sources get a `CONTRADICTION` block, not silent reconciliation.
- The `kb/SCHEMA.md` file is the source of truth for article format. Read it before adding to the KB.

## Neo4j sync

The local Python pipeline already emits a typed property graph under each analysis date folder:

- `graph/nodes.jsonl`
- `graph/edges.jsonl`
- `graph/graph.graphml`

To push that graph into Neo4j Community via the HTTP Query API:

```bash
python scripts/sync_graph_to_neo4j.py \
  --date-dir ./cybersec-papers/2026-04-17_to_2026-04-30 \
  --neo4j-url http://localhost:7474 \
  --neo4j-username neo4j \
  --neo4j-password '...'
```

Environment variables are also supported: `NEO4J_URL`, `NEO4J_USERNAME`,
`NEO4J_PASSWORD`, `NEO4J_DATABASE`.

See [docs/neo4j-sync.md](docs/neo4j-sync.md) for implementation details and
operational notes.
