---
title: "CreativityPrism: A Holistic Evaluation Framework for LLM Creativity"
authors: "Zhang et al."
year: 2025
type: framework
domain: llm-creativity
tier: T1
canonical_url: "https://arxiv.org/abs/2510.20091"
retrieved: 2026-04-30
key_concepts:
  - quality / novelty / diversity
  - originality / feasibility / fluency / flexibility (Guilford)
  - LLM-as-judge with semantic-entropy
  - heterogeneous-judge ensembles
related_articles:
  - computational-creativity/jordanous-specs
  - llm-creativity/liveideabench
status: draft
---

## TL;DR
Modern evaluation framework decomposing creativity into **Quality, Novelty, and Diversity**, with sub-metrics including originality, feasibility, fluency, and flexibility (Guilford). Uses LLM-as-judge with semantic-entropy as a reference-free novelty/diversity metric. Captures the literature's converging consensus around the Boden/Maher 'novelty + value + surprise' triad. Companion read: 'Rethinking Creativity Evaluation' (arxiv:2508.05470).

## Key thesis
Creativity evaluation is the under-built layer of the field. CreativityPrism unifies 30 years of psychology metrics (Guilford's flexibility/fluency/originality) with computational metrics (Jordanous SPECS, Ritchie's criteria) and LLM-era techniques (semantic-entropy, LLM-judge ensembles). The framework is reference-free where possible — critical for open-ended ideation evaluation.

## Key concepts
- **Quality / Novelty / Diversity** — top-level decomposition.
- **semantic-entropy** — reference-free novelty/diversity via embeddings.
- **heterogeneous-judge ensembles** — mitigate single-model judge biases.

## Why it matters for ai-ideator
**This is the missing eval layer most ideation systems skip.** ai-ideator should build a CreativityPrism-style scorer:
- *Novelty* = 1 − max-cosine-sim to KB + LLM judge "have you seen this before?"
- *Utility* = LLM-judge against rubric (problem severity, willingness-to-pay, defensibility)
- *Surprise* = inverse likelihood under base prompt (low likelihood = high surprise)
- *Diversity* = pairwise semantic entropy across the slate

Use both for ranking AND as the critic signal in self-refine loops — double-leverage.

## Connections
- **Predecessors:** [jordanous-specs](../computational-creativity/jordanous-specs.md), [ritchie-empirical-criteria](../computational-creativity/ritchie-empirical-criteria.md), [boden-creative-mind](../computational-creativity/boden-creative-mind.md)
- **Companions:** [liveideabench](liveideabench.md), [ideabench](ideabench.md)

## Sources
1. [arxiv:2510.20091](https://arxiv.org/abs/2510.20091) (retrieved 2026-04-30)
2. [arxiv:2508.05470 — Rethinking Creativity Evaluation](https://arxiv.org/abs/2508.05470)
