---
title: "Graph of Thoughts: Solving Elaborate Problems with Large Language Models"
authors: "Besta, Maciej; Blach, Nils; Kubicek, Ales; et al."
year: 2023
type: primary
domain: agentic-ideation
tier: T1
canonical_url: "https://arxiv.org/abs/2308.09687"
retrieved: 2026-04-30
key_concepts:
  - graph-structured reasoning
  - thought aggregation/merging
  - thought refinement loops
  - modular thought transformations
related_articles:
  - agentic-ideation/tree-of-thoughts
  - computational-creativity/fauconnier-turner-blending-1998
status: draft
---

## TL;DR
Generalizes ToT from a tree to an arbitrary DAG: thoughts can be **merged**, refined, and looped. Models combinations of multiple thoughts into composite outputs and supports feedback edges. Reports +62% quality on sorting versus ToT while using >31% fewer LLM calls.

## Key thesis
Many tasks aren't tree-shaped — they require *aggregating* multiple partial thoughts into a composite, or refining the same thought repeatedly. A graph structure allows both. Crucially: **conceptual blending IS graph aggregation** — exactly what combinatorial creativity needs.

## Key concepts
- **graph-structured reasoning** — thoughts as nodes, transformations as edges.
- **thought aggregation/merging** — multiple parents combine into one child.
- **refinement loops** — the same thought updated iteratively.

## Applicable pattern
Define thought transformations: generate, refine, aggregate. Compose them into a DAG matching the task structure. Aggregation nodes are where conceptual blending happens.

## Why it matters for ai-ideator
**Conceptual blending is graph aggregation.** GoT is the most natural reasoning scaffold for combining multiple parent ideas into a hybrid child idea. Directly maps onto Boden/Fauconnier-style combinatorial creativity, where blends draw structure from multiple input spaces. ai-ideator's blender should be implemented as GoT aggregation nodes, not ToT branches.

## Memorable findings
> "On sort, GoT beats ToT by 62% in quality with 31% less compute — merging dominates branching for combinatorial tasks."

## Connections
- **Predecessors:** [tree-of-thoughts](tree-of-thoughts.md)
- **Resonates with:** [fauconnier-turner-blending-1998](../computational-creativity/fauconnier-turner-blending-1998.md)

## Sources
1. [arxiv:2308.09687](https://arxiv.org/abs/2308.09687) (retrieved 2026-04-30)
