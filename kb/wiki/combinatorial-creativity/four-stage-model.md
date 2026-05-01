---
title: "The Four-Stage Model of Creativity (Wallas) and its Computational Reduction"
authors: null
year: null
type: concept
domain: combinatorial-creativity
tier: T1
canonical_url: null
retrieved: 2026-04-30
key_concepts:
  - preparation
  - incubation
  - illumination
  - verification
  - intimation
related_articles:
  - foundational-philosophy/wallas-art-of-thought
  - foundational-philosophy/poincare-mathematical-creation
status: draft
---

## TL;DR
Wallas's 1926 four-stage model — **Preparation, Incubation, Illumination, Verification** — is the canonical workflow template for any creativity-generating system, including LLM agents. It maps cleanly onto an agent pipeline and tells us where to put which kind of compute.

## The stages

| Stage | Cognitive content | Agent-system analogue |
|---|---|---|
| **Preparation** | Conscious gathering of materials, problem definition. | Retrieval; concept-loading; problem-statement parsing. |
| **Incubation** | Unconscious combinatorial work; the conscious mind is elsewhere. | Divergent generation across many parallel threads; the system's "unconscious" runs while the user is unaware. |
| **Intimation** *(Wallas's optional fifth)* | Felt sense that something is approaching. | Internal scoring signal that some candidate is rising above threshold. |
| **Illumination** | The candidate solution surfaces. | Selection of the strongest candidate. |
| **Verification** | Conscious checking, refinement, testing. | Critic agents, factual checks, feasibility analysis, execution simulation. |

## Why this is a *workflow*, not just a metaphor

The stages have different compute profiles. ai-ideator should match its resource allocation:

- **Preparation** = cheap, narrow LLM calls + KB queries.
- **Incubation** = expensive, parallelized LLM generation. *The bulk of the budget goes here.*
- **Illumination** = cheap selection given good Incubation.
- **Verification** = moderately expensive but tractable critic calls.

If the system spends most of its budget on Verification or Illumination it is *over-conservative*; if on Preparation it is *under-prepared*. Most failed ideation tools spend everything on a single Preparation+Illumination prompt and skip Incubation.

## Mapping to other frameworks
- **Boden's three types** — Preparation+Verification together produce the "rules"; Incubation does the combinational/exploratory/transformational work.
- **Campbell's BVSR** — Incubation = Blind Variation; Illumination + Verification = Selective Retention.
- **Poincaré's "atoms hooked together"** — the Incubation stage's mechanism.
- **Self-Refine / Reflexion** — implement the Incubation→Verification loop.

## ai-ideator's pipeline (Phase-3 design)

```
Preparation:    parse query → retrieve concept-pair (Phase 2)
Incubation:     spawn N parallel blenders (different personas, different network types)
                → produce N×K candidate blends
Intimation:     embed and cluster candidates; mark high-novelty/high-coherence ones
Illumination:   select top candidate from each cluster
Verification:   critic agents score on novelty/utility/surprise/feasibility
                → optionally re-route weak candidates back to Incubation (Self-Refine loop)
                → emit final structured idea(s)
```

## Related concepts
- **bisociation** — the core operation that happens during Incubation.
- **conceptual blending** — the formal mechanism of Incubation+Illumination.
- **novelty-utility tradeoff** — Verification's central concern.

## Sources
1. [Wallas 1926 — The Art of Thought](../foundational-philosophy/wallas-art-of-thought.md)
2. [Poincaré 1908 — Mathematical Creation](../foundational-philosophy/poincare-mathematical-creation.md)
3. [Campbell 1960 — BVSR](../foundational-philosophy/campbell-bvsr.md)
