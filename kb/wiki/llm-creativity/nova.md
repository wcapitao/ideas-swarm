---
title: "Nova: An Iterative Planning and Search Approach to Enhance Novelty and Diversity of LLM Generated Ideas"
authors: "Hu, Xiang; Fu, Hongyu; Wang, Jinge; et al."
year: 2024
type: primary
domain: llm-creativity
tier: T1
canonical_url: "https://arxiv.org/abs/2410.14255"
retrieved: 2026-04-30
key_concepts:
  - planned multi-hop retrieval
  - iterative knowledge enrichment
  - diversity-aware search
related_articles:
  - llm-creativity/si-2024-can-llms-generate-novel-ideas
  - llm-creativity/chain-of-ideas
status: draft
---

## TL;DR
Addresses LLMs' tendency to produce repetitive, simplistic ideas by explicitly **planning multi-hop external knowledge retrieval** and iteratively expanding the idea space. Validated by automated and human assessment over 170 seed papers. Produces 3.4× more unique novel ideas than baseline.

## Key thesis
Diversity in LLM ideation does not come from temperature; it comes from *planned retrieval*. The system explicitly plans which knowledge to fetch next based on what the current idea space lacks, then fetches it, then re-ideates. This iterative planning closes the diversity gap that pure sampling cannot.

## Key concepts
- **planned multi-hop retrieval** — choose what to retrieve based on current gaps.
- **iterative knowledge enrichment** — alternate retrieval and generation.
- **diversity-aware search** — explicit diversity objective in selection.

## Why it matters for ai-ideator
Directly attacks the diversity/repetition failure mode that Si 2024 named. The 3.4× and 2.5× numbers are strong evidence that **planned retrieval** — not sampling temperature — is what unlocks combinatorial breadth. ai-ideator's retrieval layer (Phase 2) should use planned multi-hop retrieval with gap-driven query reformulation, not single-shot top-k.

## Memorable findings
> "Nova produces 3.4× more unique novel ideas than the baseline and 2.5× more top-rated ideas than SOTA — diversity comes from planned retrieval, not temperature."

## Connections
- **Predecessors:** [si-2024-can-llms-generate-novel-ideas](si-2024-can-llms-generate-novel-ideas.md)
- **Companions:** [chain-of-ideas](chain-of-ideas.md), [researchagent](researchagent.md)

## Sources
1. [arxiv:2410.14255](https://arxiv.org/abs/2410.14255) (retrieved 2026-04-30)
