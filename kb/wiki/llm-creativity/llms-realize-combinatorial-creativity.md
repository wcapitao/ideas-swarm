---
title: "LLMs can Realize Combinatorial Creativity: Generating Creative Ideas via LLMs for Scientific Research"
authors: "Gu, Tianyang; Wang, Jingjin; Zhang, Zhihao; Li, HaoHong"
year: 2024
type: primary
domain: llm-creativity
tier: T1
canonical_url: "https://arxiv.org/abs/2412.14141"
retrieved: 2026-04-30
key_concepts:
  - abstraction-level hierarchical retrieval
  - structured component recombination
  - combinatorial creativity theory operationalization
related_articles:
  - llm-creativity/cooking-up-creativity
  - llm-creativity/scideator
  - computational-creativity/boden-creative-mind
status: draft
---

## TL;DR
Explicitly grounds an LLM ideator in classical combinatorial creativity theory. Uses a generalization-level retrieval system to find cross-domain knowledge at multiple abstraction levels, then a structured combinatorial process recombines components. Improves similarity to real research developments by 7–10% on OAG-Bench.

## Key thesis
The most theory-aligned recent paper. Operationalizes Boden's combinational creativity directly: (1) retrieve concepts at *multiple abstraction levels* (so analogies can be made surface-different but structure-similar), (2) recombine via structured operations, (3) measure how close the synthesized idea is to actual research developments.

## Key concepts
- **abstraction-level hierarchical retrieval** — concepts indexed at multiple levels of abstraction.
- **structured component recombination** — explicit combination operators, not free-form LLM blending.
- **theory-grounded LLM ideation** — Boden/Fauconnier-Turner explicitly cited and implemented.

## Why it matters for ai-ideator
Directly answers "what would a Boden-style combinatorial creativity engine look like with LLMs?" The hierarchical retrieval insight is critical: LLMs can match surface features easily but mis-match relational structure. Indexing concepts at multiple abstraction levels lets the system reach for the right analogue depth.

## Memorable findings
> "Mapping concepts across abstraction levels before recombination is what enables meaningful cross-domain creative leaps in LLMs."

## Connections
- **Predecessors:** [boden-creative-mind](../computational-creativity/boden-creative-mind.md), [fauconnier-turner-way-we-think](../computational-creativity/fauconnier-turner-way-we-think.md)
- **Companions:** [scideator](scideator.md), [cooking-up-creativity](cooking-up-creativity.md)

## Sources
1. [arxiv:2412.14141](https://arxiv.org/abs/2412.14141) (retrieved 2026-04-30)
