---
title: "IdeaBench: Benchmarking Large Language Models for Research Idea Generation"
authors: "Guo, Sikun; Shariatmadari, Amir Hassan; Xiong, Guangzhi; et al."
year: 2024
type: framework
domain: llm-creativity
tier: T2
canonical_url: "https://arxiv.org/abs/2411.02429"
retrieved: 2026-04-30
key_concepts:
  - 2374-paper benchmark
  - 8-domain coverage
  - domain-researcher profiling
  - two-stage Insight Score
related_articles:
  - llm-creativity/liveideabench
  - llm-creativity/si-2024-can-llms-generate-novel-ideas
status: draft
---

## TL;DR
Benchmark of 2,374 influential papers across 8 domains plus 29,408 references. LLMs are profiled as domain researchers and evaluated via two-stage GPT-4o ranking with an 'Insight Score' that captures user-specified quality dimensions like novelty and feasibility.

## Key thesis
Standardized benchmarks are essential for ideation research. IdeaBench provides the first large-scale, domain-diverse, paper-grounded benchmark with reproducible evaluation. The two-stage Insight Score (ranking + reasoning) reduces noise from one-shot LLM-judge variance.

## Key concepts
- **paper-grounded benchmark** — ideas evaluated against the original papers' contributions.
- **domain-researcher profiling** — LLM is prompted to act as domain expert before generating.
- **two-stage Insight Score** — first rank, then justify.

## Why it matters for ai-ideator
Critical for evaluating an ideation system against a known baseline rather than ad-hoc human studies. ai-ideator should benchmark against IdeaBench (or equivalent business-domain benchmark) before claiming state-of-the-art. Confirms the Si et al. tradeoff at scale: novelty up, feasibility down.

## Memorable findings
> "On IdeaBench, LLMs are good at novelty but reliably weak on feasibility — confirming the Si et al. tradeoff at scale."

## Connections
- **Companions:** [liveideabench](liveideabench.md), [si-2024-can-llms-generate-novel-ideas](si-2024-can-llms-generate-novel-ideas.md)

## Sources
1. [arxiv:2411.02429](https://arxiv.org/abs/2411.02429) (retrieved 2026-04-30)
