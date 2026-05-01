---
title: "IdeaSynth: Iterative Research Idea Development Through Evolving and Composing Idea Facets with Literature-Grounded Feedback"
authors: "Pu, Kevin; Feng, K. J. Kevin; Grossman, Tovi; et al."
year: 2024
type: primary
domain: llm-creativity
tier: T1
canonical_url: "https://arxiv.org/abs/2410.04025"
retrieved: 2026-04-30
key_concepts:
  - facet-based idea decomposition
  - interactive canvas UI
  - literature-grounded feedback
related_articles:
  - llm-creativity/scideator
  - llm-creativity/researchagent
status: draft
---

## TL;DR
Decomposes an idea into **facets** (problem, solution, evaluation, contribution) presented as an interactive canvas. Users freely create variants, recombine facets, and receive **literature-grounded feedback** on each. Lab study (N=20) plus 3-day field deployment (N=7) show greater exploration and more specific ideas than baseline.

## Key thesis
Ideation isn't a single decision; it's the parallel evolution of multiple facets. By exposing facets as independently-mutable units on a canvas, with per-facet literature-grounded feedback, the system gets more exploration AND more specificity simultaneously — typically a tradeoff in single-prompt UIs.

## Key concepts
- **facet decomposition** — idea = (problem, solution, evaluation, contribution).
- **canvas UI** — facets are draggable, mutable, recombinable.
- **literature-grounded feedback per facet** — local feedback that doesn't require regenerating the whole idea.

## Why it matters for ai-ideator
Operationalizes combinatorial creativity at the **UX level**: ideas are typed slots that can be mutated and recombined independently. A direct blueprint for a human-in-the-loop ideation tool — when ai-ideator reaches Phase 5 (interface), this is the canonical reference.

## Memorable findings
> "Letting users mutate facets in any order produced both more exploration and more specificity simultaneously — typically a tradeoff."

## Connections
- **Predecessors:** [researchagent](researchagent.md)
- **Companions:** [scideator](scideator.md)

## Sources
1. [arxiv:2410.04025](https://arxiv.org/abs/2410.04025) (retrieved 2026-04-30)
