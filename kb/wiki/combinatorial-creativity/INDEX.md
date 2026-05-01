# Combinatorial Creativity — Index (cross-cutting concepts)

> The cross-cutting domain. Articles here are **concept articles**, not primary-source summaries — they distill ideas that appear across multiple primary sources into one navigable place. This is where to look when you want to understand a *concept* rather than read a *paper*.

Last updated: 2026-04-30
Articles: 6

## Concept articles

| Article | What it is | Key sources it draws from |
|---|---|---|
| [bisociation](bisociation.md) | Koestler's term for the simultaneous activity of two normally-separate matrices on one situation. **The single most useful concept for ai-ideator.** | [Koestler 1964](../foundational-philosophy/koestler-act-of-creation.md), [Fauconnier & Turner 1998](../computational-creativity/fauconnier-turner-blending-1998.md) |
| [conceptual-blending](conceptual-blending.md) | Fauconnier & Turner's four-space architecture (inputs / generic / blended) with selective projection and emergent structure. The formal cognitive mechanism. | [Fauconnier & Turner 1998](../computational-creativity/fauconnier-turner-blending-1998.md), [Fauconnier & Turner 2002](../computational-creativity/fauconnier-turner-way-we-think.md) |
| [remote-associates](remote-associates.md) | Mednick's flat vs steep associative hierarchies; the empirical claim that distant combinations are more creative; the Remote Associates Test. | [Mednick 1962](../foundational-philosophy/mednick-associative-basis.md), [Poincaré 1908](../foundational-philosophy/poincare-mathematical-creation.md) |
| [three-principles-of-association](three-principles-of-association.md) | Hume's resemblance / contiguity / cause-and-effect mapped onto modern retrieval operators. | [Hume 1739](../foundational-philosophy/hume-treatise-association-of-ideas.md), [Hume 1748](../foundational-philosophy/hume-enquiry-association.md) |
| [novelty-utility-tradeoff](novelty-utility-tradeoff.md) | The standard-definition dual-criterion + the empirical Pareto reality + the ideation-execution gap. **The single most important design constraint.** | [Schapiro 2025](../llm-creativity/schapiro-2025-combinatorial-creativity.md), [Si 2024](../llm-creativity/si-2024-can-llms-generate-novel-ideas.md), [Si 2025](../llm-creativity/si-2025-ideation-execution-gap.md), [Runco & Jaeger 2012](../computational-creativity/runco-jaeger-standard-definition.md) |
| [four-stage-model](four-stage-model.md) | Wallas's Preparation / Incubation / Illumination / Verification, mapped onto an agent pipeline with compute-allocation guidance. | [Wallas 1926](../foundational-philosophy/wallas-art-of-thought.md), [Poincaré 1908](../foundational-philosophy/poincare-mathematical-creation.md), [Campbell 1960](../foundational-philosophy/campbell-bvsr.md) |

## How to navigate

- Want **the central operation** ai-ideator performs? → [bisociation](bisociation.md), then [conceptual-blending](conceptual-blending.md).
- Want **why distance matters** in retrieval? → [remote-associates](remote-associates.md).
- Want **how retrieval should be designed**? → [three-principles-of-association](three-principles-of-association.md).
- Want **the central evaluation tradeoff**? → [novelty-utility-tradeoff](novelty-utility-tradeoff.md).
- Want **the agent pipeline shape**? → [four-stage-model](four-stage-model.md).

## Connections

These concept articles are the **glue** of the KB. Every primary-source article in the other four domains links to one or more of these; conversely, each concept article links to its primary sources across all four domains.

- ↔ [foundational-philosophy/](../foundational-philosophy/INDEX.md)
- ↔ [computational-creativity/](../computational-creativity/INDEX.md)
- ↔ [llm-creativity/](../llm-creativity/INDEX.md)
- ↔ [agentic-ideation/](../agentic-ideation/INDEX.md)

## When to add a new concept article

Create a new concept article when:
1. The same concept appears in 3+ primary-source articles.
2. The concept has a clear architectural implication for ai-ideator.
3. Future agents would benefit from a single canonical entry to retrieve.

Update existing concept articles when new primary sources develop or contest the concept; do not silently overwrite — flag contradictions per `kb/SCHEMA.md`.
