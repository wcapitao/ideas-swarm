---
title: "Scideator: Human-LLM Scientific Idea Generation Grounded in Research-Paper Facet Recombination"
authors: "Radensky, Marissa; Shahid, Simra; Fok, Raymond; Siangliulue, Pao; Hope, Tom; Weld, Daniel S."
year: 2024
type: primary
domain: llm-creativity
tier: T1
canonical_url: "https://arxiv.org/abs/2409.14634"
retrieved: 2026-04-30
key_concepts:
  - purpose/mechanism/evaluation facets
  - analogous paper retrieval
  - facet recombination
  - RAG novelty checker
related_articles:
  - llm-creativity/ideasynth
  - llm-creativity/llms-realize-combinatorial-creativity
  - computational-creativity/fauconnier-turner-blending-1998
status: draft
---

## TL;DR
Extracts **purpose / mechanism / evaluation facets** from a user's seed papers and analogous papers, recombines them via three RAG modules (Analogous Paper Facet Finder, Faceted Idea Generator, Idea Novelty Checker). User study with 22 CS researchers shows significantly more creativity support than baseline; novelty-classification accuracy jumps from 13.79% to 89.66% with facet-based reranking.

## Key thesis
Possibly the cleanest existing implementation of textbook combinatorial creativity (Boden / Fauconnier-Turner): isolate components (facets), find analogues, recombine, check novelty. Decomposing into purpose/mechanism/evaluation is the right granularity — coarser loses signal, finer becomes unmanageable.

## Key concepts
- **P/M/E facets** — purpose (why), mechanism (how), evaluation (test).
- **analogous paper retrieval** — find papers with similar structure but different surface.
- **RAG novelty checker** — verify the combination isn't already in the literature.

## Why it matters for ai-ideator
**Direct architectural reference for ai-ideator's combiner.** The P/M/E split applies to business ideas: customer-job (purpose) / business mechanism (how) / market validation (evaluation). The 13.79% → 89.66% jump on novelty-classification is the strongest evidence in the literature that getting the **granularity** right is the central design choice.

## Memorable findings
> "A facet-based novelty checker boosts novelty-classification accuracy from 13.79% to 89.66% — granularity is the trick."

## Connections
- **Predecessors:** [fauconnier-turner-blending-1998](../computational-creativity/fauconnier-turner-blending-1998.md), [researchagent](researchagent.md)
- **Companions:** [ideasynth](ideasynth.md), [llms-realize-combinatorial-creativity](llms-realize-combinatorial-creativity.md)

## Sources
1. [arxiv:2409.14634](https://arxiv.org/abs/2409.14634) (retrieved 2026-04-30)
