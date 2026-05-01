# ADR-001 — Citation model and paper-concept linkage

| Field | Value |
|---|---|
| **Status** | Accepted (incorporated into ARCH-001 v0.1, §3 D12, §5.4, §8.5–§8.7) |
| **Date** | 2026-05-01 |
| **Deciders** | modernwinds@gmail.com (architect) |
| **Supersedes** | — |
| **Superseded by** | — |
| **Related** | `docs/architecture/agentic-ideation-system.md` (ARCH-001), `docs/CONCEPT.md`, `kb/SCHEMA.md`, original combinatorial-creativity engine spec §1–§2 |

---

## 1. Context

ARCH-001 establishes that a **WikiArticle** (citation, one markdown file under `kb/wiki/`) is a different unit from a **Concept** (atomic graph node, the thing the combinator merges). One paper yields many concepts; one concept can be supported by many papers (D10).

This raises a question the original combinatorial-creativity spec did not answer:

> Each paper, when ingested, is enriched by an LLM with structured metadata — tier, research type, contribution type, key concepts, relevance score, free-text tags. Some of those fields are evaluative (paper-level performance signals). When concepts are extracted from that paper, **how does the paper-level evaluation flow into concept-level state**?

Three failure modes if this is not resolved cleanly:

1. **Cold-start zero priors.** A freshly extracted concept has empty `parameter_scores` (the original spec's learned-from-merges field). Until ~10–50 merges have referenced it, the Stage 5 predictor has nothing to weight on. Newly ingested concepts are effectively invisible to retrieval ranking.
2. **Conflated signals.** If we naively dump paper enrichment into `Concept.parameter_scores`, two distinct questions collapse into one field: *"how trustworthy is the claim?"* (inherited from the source) and *"how well does this concept perform in merges?"* (learned from outcomes). The predictor can no longer learn the distinction; it conflates "good source" with "good merge participant", which is empirically wrong (a T1 survey is highly trustworthy and often a sterile merge input).
3. **Lossy citation.** A flat `wiki_article_path` field on `Concept` cannot represent the many-to-many relationship. New citations to existing concepts force a rewrite or get silently dropped.

The decision must specify (a) where paper-level evaluations live in the graph; (b) how they are propagated into concept state at extraction time; (c) how they enter the Stage 5 prediction function without overwriting learned scores.

## 2. Decision

Adopt a **three-flow citation model** with a new node type, a new edge type, and one derived aggregate field on `Concept`. Defined in detail in ARCH-001 §8.5–§8.7; summarized here.

### 2.1 New graph entities

```
WikiArticle node      — the citation (one per file under kb/wiki/)
RawArtifact  node     — the source bytes in R2 (one per fetched PDF/HTML/JSON)
CITED_FROM   edge     — Concept → WikiArticle, carrying tier, role, passage anchor
DERIVED_FROM edge     — WikiArticle → RawArtifact
```

`CITED_FROM` primary key is `(Concept.id, WikiArticle.id)` so re-running a paper updates rather than duplicates the edge. New citations to existing concepts add new edges without rewriting the concept.

### 2.2 The three flows

**Flow 1 — Inheritance at extraction time (seed parameters).** When `ConceptForge` extracts a Concept, the *same* enrichment LLM call's output is mapped — by deterministic code, not another LLM — into the Concept's initial parameters across the Provenance, Maturity, Constraint, and Behavior categories of the original §2 parameter system. Mapping table in ARCH-001 §8.5.

**Flow 2 — Explicit `CITED_FROM` edge with metadata.** Each (Concept, WikiArticle) pair gets one edge carrying `tier`, `relevance_score`, `year`, `role` (`primary | supporting | contradicts`), `passage_anchor`. Filter retrieval by source quality, audit a concept's evidentiary base, and add new citations lazily — all become Cypher one-liners.

**Flow 3 — Derived `source_quality_score` on Concept.** A scalar aggregate over a concept's `CITED_FROM` edges, recomputed on every edge insert/update by deterministic Cypher:

```
source_quality_score(c) =
  Σ_e∈CITED_FROM(c)  tier_weight(e.tier) · role_weight(e.role) · recency_factor(e.year)
  ───────────────────────────────────────────────────────────────────────────────────
                              citation_count(c) + 1
```

The `+1` is shrinkage: one citation does not match five. Range ≈ `[-0.5, 1.0]`; negative values flag concepts whose citations principally contradict them.

### 2.3 Plumbing into Stage 5

The Stage 5 prediction function's `effective_score` term gains one multiplier:

```
effective_score(c, p) =
       c.parameter_scores[p].value
     · c.parameter_scores[p].confidence            ← per-parameter confidence (LEARNED)
     · f(c.source_quality_score)                   ← per-concept claim-trust (INHERITED)

f(q) = clamp(0.5 + 0.5·q, min=0.25, max=1.25)
```

`f` is a soft clamp: ±25% adjustment, never zeroed. The two signals — learned `parameter_scores` and inherited `source_quality_score` — remain separable so the predictor can learn that "trustworthy claim" and "good merge participant" are different.

### 2.4 Where the work happens

Updates to ARCH-001 §5.4 ConceptForge:

- Step 5 produces Concept atoms **with seed parameters from the same enrichment payload** (no extra LLM hop).
- Step 7 upserts both Concept nodes **and** one `CITED_FROM` edge per (Concept, WikiArticle) pair.
- Step 8 recomputes `source_quality_score`, `citation_count`, `citation_diversity` deterministically.

Idempotency keys extended: `(concept_id, wiki_article_id)` is the `CITED_FROM` primary key.

## 3. Consequences

### 3.1 Positive

- **No cold-start.** Fresh concepts have non-empty seed parameters and a `source_quality_score` immediately, so Stage 3 retrieval and Stage 5 prediction can rank them on day one.
- **Two signals stay separable.** The predictor can learn that a T1-cited concept performs poorly in merges (or vice versa) — this distinction is not collapsible into a single field.
- **Graph-native many-to-many.** Adding the fifth supporting paper to a long-standing concept is one `CREATE`-edge statement; no concept rewrite, no Vectorize re-embed, no orphan rows.
- **Auditable provenance.** `MATCH (c:Concept {id: $id})-[e:CITED_FROM]->(w:WikiArticle) RETURN w.path, e.tier, e.role` is the full provenance answer in one query. The user-facing render in ARCH-001 §9 reads directly from this.
- **Negative citations are first-class.** A `role: contradicts` edge can lower `source_quality_score` instead of being silently filtered out — important for the Boden/Wiggins discipline of taking falsifications seriously.
- **Stella-clean.** All three flows execute one LLM call per paper (the enrichment) plus the existing concept-extraction call. The mapping, aggregation, and edge writes are pure code.

### 3.2 Negative

- **Two-store coordination tax.** Vectorize and Aura both need to be updated when a concept changes. `source_quality_score` updates only touch Aura, but if a concept gains a tier-promoting citation that would justify re-ranking in Vectorize, the change must be propagated. Mitigated by Vectorize metadata being limited (we don't store `source_quality_score` there; retrieval-time multiplication happens in the Worker).
- **Mapping table is a maintained artifact.** The seed-parameter mapping (ARCH-001 §8.5) is hand-curated. New `research_type` strings emerging from the enrichment LLM need a default-bucket fallback to avoid silent zeros. Mitigated by the "default to lowest-confidence + flag for review" rule.
- **`source_quality_score` invites false confidence.** It is a heuristic. A T1 paper from a discredited journal is still T1 here. Mitigated by treating it as a soft multiplier (±25%) rather than a gate.
- **Recency factor is a value judgment.** A 50-year linear decay is opinionated; some concepts (Hume 1739) are foundational and should not decay. Mitigated by the floor at 0.5 and by `tier=T1` carrying a high `tier_weight` regardless of age.
- **Edge-property duplication.** `CITED_FROM.tier` duplicates `WikiArticle.tier` for retrieval-time speed. If a wiki article's tier is ever upgraded post-hoc (a T2 paper that later becomes canonical), all `CITED_FROM` edges must be migrated. A nightly reconciliation job (already implied by ARCH-001 §1.6 "Stale parameter scores") owns this.

### 3.3 Neutral

- ConceptForge step count grows from 7 to 8. The new step (recompute aggregates) is deterministic Cypher and adds <50 ms per paper.
- The wiki-schema fields under `kb/SCHEMA.md` already cover everything needed by Flow 1 (tier, key_concepts, retrieved). No change to the wiki schema is required by this ADR.

## 4. Alternatives considered

### 4.1 A single scalar `wiki_article_path` on `Concept` (the original spec's implicit position)

**Rejected.** Cannot represent many-to-many. Forces concept rewrite on every new citation. Loses the role / passage-anchor metadata that makes provenance auditable.

### 4.2 Embed paper-level evaluations directly into `Concept.parameter_scores`

**Rejected.** Conflates two signals (claim trustworthiness vs merge performance) the predictor needs to keep separate. A T1 survey concept would carry a strong `parameter_scores[*]` prior that the feedback loop has to overcome before the concept's actual merge behavior surfaces — slow and confusing.

### 4.3 Inherited at extraction time, then frozen

**Rejected.** A concept that gains five additional T1 citations over six months is *more* trustworthy than the moment it was extracted. Freezing inheritance forfeits this signal. The `CITED_FROM` edge model lets the aggregate update lazily without ever rewriting the concept.

### 4.4 Single LLM call computes both enrichment and seed parameters in one structured-output schema

**Accepted in part — this is what we do for steps 3 and 5.** ARCH-001 §5.4 keeps these as two LLM calls (enrichment of the *paper*, then extraction of *concept atoms*) because the prompts and the structured schemas differ enough that combining them produced lower-quality outputs in early prototyping (per `cybersec-papers/` experience). The seed-parameter mapping is then deterministic code — no third LLM call.

### 4.5 Compute `source_quality_score` lazily at retrieval time instead of storing it

**Rejected.** Stage 3 retrieval ranks across thousands of candidates per goal; per-candidate aggregation over `CITED_FROM` edges is too slow. Storing the scalar with an edge-write trigger keeps retrieval O(1) per candidate.

### 4.6 Use a separate Concept-Performance graph DB and join across systems

**Rejected.** Splits provenance across two stores; complicates lineage queries. Single-store (Aura) with derived aggregates is cheaper to operate and easier to reason about. Vectorize remains the only secondary store, and only for embeddings.

## 5. Open follow-ups

- **Tier upgrade reconciliation.** The nightly job to migrate `CITED_FROM.tier` when a `WikiArticle.tier` changes is owned by `cf-agent-deploy-and-observe` and should produce a `kb/LOG.md` entry on every migration. ADR not required; runbook task.
- **Recency-factor calibration.** The 50-year linear decay is a v1 placeholder. Once we have ≥1k merges with feedback, calibrate by checking whether high-recency-factor concepts actually outperform low ones in merges. Track in `predictor_training` features.
- **Negative-citation prompts.** ConceptForge needs a prompt that makes the enrichment LLM *willing to mark `role: contradicts`* — the default LLM behavior is to ignore disagreement. A small prompt-engineering task before M1 ships.

## 6. References

- ARCH-001 (`docs/architecture/agentic-ideation-system.md`):
  - §3 D10 (WikiArticle ≠ Concept)
  - §3 D12 (this ADR's deltas table entry)
  - §5.4 (ConceptForge step list)
  - §8.1, §8.5, §8.6, §8.7 (schema, mapping, predictor change, indexes)
- Original combinatorial-creativity engine spec — §1 (graph schema), §2 (parameter system, especially Provenance and Maturity categories), §3.5 (Stage 5 prediction function)
- `docs/CONCEPT.md` — Boden/Fauconnier-Turner framing
- `kb/SCHEMA.md` — wiki frontmatter contract that supplies Flow 1's input
- `cybersec-papers/2026-04-17_to_2026-04-30/enriched.jsonl` — reference shape for Flow 1 paper-level enrichment
