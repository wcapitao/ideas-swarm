---
title: "LiveIdeaBench: Evaluating LLMs' Divergent Thinking Capabilities for Scientific Idea Generation with Minimal Context"
authors: "Ruan, Kai; Wang, Xuan; Hong, Jixiang; et al."
year: 2024
type: framework
domain: llm-creativity
tier: T2
canonical_url: "https://arxiv.org/abs/2412.17596"
retrieved: 2026-04-30
key_concepts:
  - minimal-context single-keyword prompting
  - 5-dimensional creativity rubric
  - dynamic LLM judge panel
related_articles:
  - llm-creativity/ideabench
  - llm-creativity/creativityprism
status: draft
---

## TL;DR
**Single-keyword prompts test pure divergent thinking.** 40+ models, 1,180 keywords, 22 scientific domains. Five dimensions: originality, feasibility, fluency, flexibility, clarity. Surprising finding: scientific idea generation is poorly predicted by general intelligence scores.

## Key thesis
Most ideation benchmarks are heavily contextualized (paper-grounded retrieval, domain prompts). LiveIdeaBench strips context to a single keyword to isolate *raw divergent thinking*. The result: models that score similarly on general benchmarks differ wildly on creativity, and vice versa — creativity is a separable axis.

## Key concepts
- **divergent thinking minimum-context test** — keyword-only prompts.
- **5-dimensional rubric** — originality, feasibility, fluency, flexibility, clarity (Guilford-aligned).
- **dynamic judge panel** — multiple models judge to reduce single-judge bias.

## Why it matters for ai-ideator
Provides a creativity benchmark **decoupled from retrieval/literature**. Useful to detect when a model's ideation strength comes from raw creativity vs. memorized literature. ai-ideator should test its base model on LiveIdeaBench separately from end-to-end evals to attribute performance correctly.

## Memorable findings
> "QwQ-32B-preview matches Claude-3.7-Sonnet:thinking on idea generation despite a much lower IQ-style benchmark — creativity is a separable axis from general intelligence."

## Connections
- **Companions:** [ideabench](ideabench.md), [creativityprism](creativityprism.md)

## Sources
1. [arxiv:2412.17596](https://arxiv.org/abs/2412.17596) (retrieved 2026-04-30)
