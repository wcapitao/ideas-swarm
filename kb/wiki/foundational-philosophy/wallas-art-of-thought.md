---
title: "The Art of Thought"
authors: "Wallas, Graham"
year: 1926
type: primary
domain: foundational-philosophy
tier: T1
canonical_url: "https://archive.org/details/theartofthought"
retrieved: 2026-04-30
key_concepts:
  - preparation
  - incubation
  - illumination
  - verification
  - intimation
  - stage model of creativity
related_articles:
  - foundational-philosophy/poincare-mathematical-creation
status: draft
---

## TL;DR
Wallas systematizes Poincaré's introspections into a four-stage model of the creative process: **Preparation, Incubation, Illumination, Verification** — with an implicit fifth stage, **Intimation**, between Incubation and Illumination. The canonical workflow template for any creativity-generating system, including LLM agents.

## Key thesis
Creative thought is not unitary; it has a temporal structure. The thinker first gathers and engages with material consciously (Preparation), then steps away while unconscious processing continues (Incubation), then receives the candidate insight (Illumination, often preceded by a felt sense — Intimation, that "something is coming"), then tests and refines it (Verification).

## Key concepts
- **Preparation** — conscious gathering of materials; defining the problem.
- **Incubation** — letting the unconscious work without conscious effort.
- **Intimation** — the felt sense that an answer is approaching.
- **Illumination** — the candidate solution surfaces to consciousness.
- **Verification** — testing the solution against constraints.

## Why it matters for ai-ideator
The four-stage model maps cleanly to a multi-step agent pipeline:
- *Preparation* → retrieval and concept-loading.
- *Incubation* → divergent generation across many parallel threads (the "unconscious" of the system).
- *Illumination* → selection of the strongest candidate.
- *Verification* → critic agents, factual checks, feasibility analysis.

This is the canonical answer to "what should the stages of an ideation agent be?"

## Memorable passages
> "In the daily stream of thought these four different stages constantly overlap each other as we explore different problems… we are dealing with separable stages, and not separable mental events." — Ch. IV

## Connections
- **Predecessors:** [poincare-mathematical-creation](poincare-mathematical-creation.md)

## Sources
1. [archive.org — The Art of Thought](https://archive.org/details/theartofthought) (retrieved 2026-04-30)
