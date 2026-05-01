---
title: "Can LLMs Generate Novel Research Ideas? A Large-Scale Human Study with 100+ NLP Researchers"
authors: "Si, Chenglei; Yang, Diyi; Hashimoto, Tatsunori"
year: 2024
type: primary
domain: llm-creativity
tier: T1
canonical_url: "https://arxiv.org/abs/2409.04109"
retrieved: 2026-04-30
key_concepts:
  - blinded human evaluation
  - over-generate-and-rerank
  - retrieval-grounded ideation
  - novelty/feasibility tradeoff
related_articles:
  - llm-creativity/si-2025-ideation-execution-gap
  - llm-creativity/schapiro-2025-combinatorial-creativity
  - llm-creativity/researchagent
status: draft
---

## TL;DR
First rigorous head-to-head: **79 NLP experts blind-reviewed 49 ideas each** from (a) expert humans, (b) an LLM ideation agent, (c) AI ideas reranked by a human. AI-generated ideas were judged statistically more novel (p<0.05) than expert ideas, slightly weaker on feasibility. The agent's recipe — retrieval over papers + over-generate-and-rank — is the operational artifact.

## Key thesis
LLMs *can* match or beat human experts on perceived novelty of research ideas, when wrapped in a retrieval-grounded over-generation pipeline. Diagnoses two specific failure modes of single-agent LLM ideators: poor self-evaluation and low diversity across samples — both are addressed by scale of generation + rerank, not by prompt cleverness.

## Key concepts
- **blinded human evaluation** — experts review ideas without knowing source.
- **over-generate-and-rerank** — produce hundreds of candidates, dedup, LLM-rerank via pairwise tournament.
- **retrieval-grounding** — condition generation on retrieved literature.

## Why it matters for ai-ideator
**This is essentially the architecture the user is building, validated on real experts.** Substitute "NLP papers" with "concepts in your business KB." Crucial empirical lesson: scale of generation + dedup + rerank matters more than fancy single-shot prompts. Don't aim for one good idea — aim for 200 ideas and a strong reranker.

## Memorable findings
> "LLM-generated NLP research ideas are judged more novel than ideas from 100+ expert researchers (p<0.05), but slightly less feasible."

## Connections
- **Companion:** [si-2025-ideation-execution-gap](si-2025-ideation-execution-gap.md) — the follow-up that complicates this result.
- **Descendants:** [researchagent](researchagent.md), [chain-of-ideas](chain-of-ideas.md), [nova](nova.md), [ideasynth](ideasynth.md), [scideator](scideator.md)

## Sources
1. [arxiv:2409.04109](https://arxiv.org/abs/2409.04109) (retrieved 2026-04-30)
