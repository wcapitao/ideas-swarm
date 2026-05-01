# KB Operations Log

Append-only. Most recent at the top. See `SCHEMA.md` for the action vocabulary.

## 2026-05-01 16:00 | INGEST | claude-code
Article: kb/wiki/gastritis-traditional/ (38 stub articles)
Notes: Ingested 38 traditional gastritis stubs across 8 paradigm areas: TCM herbal formulas (10), TCM acupuncture/moxibustion (4), Kampo (5), Ayurveda (5), Unani/Persian (4), Greco-Roman (3), Korean traditional (2), African/Latin American folk (5). Evidence tiers: rct (2), meta-analysis (1), survey (12), in-vivo-animal (15), in-vitro (3), case-series (1), expert-opinion (1), framework (1). Cross-cultural herbs (licorice, ginger, turmeric, aloe, Nigella sativa) indexed across paradigms. Tier distribution: 9 T1, 28 T2, 1 T3. Updated domain INDEX.md and master kb/INDEX.md.

## 2026-05-01 14:00 | INGEST | claude-code
Article: kb/wiki/gastritis-alternative/ (28 stub articles)
Notes: Ingested 28 alternative gastritis stubs across 12 topic areas: mastic gum (1), DGL licorice (2), zinc carnosine (3), cabbage juice (2), curcumin (2), ginger (2), aloe vera (1), ashwagandha (1), functional medicine/leaky gut (2), hypochlorhydria (3), probiotics (1), gut-brain axis (3), homeopathy (1), diet-based (2), popular books (2), SIBO (1). Tier distribution: 5 T1, 18 T2, 5 T3. Updated domain INDEX.md and master kb/INDEX.md.

## 2026-05-01 12:00 | INGEST | claude-code
Article: kb/wiki/gastritis-conventional/ (32 stub articles)
Notes: Ingested 32 conventional gastritis stubs across 8 topic areas: H. pylori discovery & treatment (7), PPIs (3), autoimmune gastritis (3), NSAID gastropathy (5), bile reflux (2), gastric microbiome (3), Correa cascade & cancer (4), guidelines & reviews (5). Tier distribution: 25 T1, 7 T2. Updated domain INDEX.md and master kb/INDEX.md.

## 2026-04-30 17:35 | INGEST | claude-code
Action: Initial corpus ingest, all five domains.
Source batches:
- `kb/raw/foundational-philosophy/_research-batch-001.json` (14 entries → 13 articles; Boden CM moved to computational-creativity)
- `kb/raw/computational-creativity/_research-batch-001.json` (18 entries → 18 articles)
- `kb/raw/llm-creativity/_research-batch-001.json` (33 entries → 22 articles; pure-pattern entries moved to agentic-ideation)
- `kb/raw/agentic-ideation/_research-batch-001.json` (17 entries → 21 articles, including overlaps from llm-creativity batch)
Articles created: 80 wiki articles + 5 domain INDEX.md + 1 master INDEX.md + 6 cross-cutting concept articles in combinatorial-creativity/.
Tier distribution: 38 T1, 23 T2, 6 T3 (per-domain counts in each domain INDEX).
Notes: All four research-agent batches completed and synthesized in one session. Cross-references built between every domain. The user-cited anchor paper (arXiv:2509.21043, Schapiro 2025) is at `wiki/llm-creativity/schapiro-2025-combinatorial-creativity.md` and is referenced as the central LLM-era anchor throughout.

## 2026-04-30 16:55 | KB-INIT | claude-code
Action: Initialized knowledge base.
Created: 5 domain directories (foundational-philosophy, computational-creativity, combinatorial-creativity, llm-creativity, agentic-ideation), SCHEMA.md, INDEX.md (placeholder), CHANGELOG.md, LOG.md.
Notes: Phase 0 begun. Research agents dispatched in parallel for the four research domains.
