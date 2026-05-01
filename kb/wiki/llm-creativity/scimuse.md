---
title: "Interesting Scientific Idea Generation Using Knowledge Graphs and LLMs (SciMuse)"
authors: "Gu, Xuemei; Krenn, Mario"
year: 2024
type: primary
domain: llm-creativity
tier: T2
canonical_url: "https://arxiv.org/abs/2405.17044"
retrieved: 2026-04-30
key_concepts:
  - 58M-paper knowledge graph
  - personalized ideation
  - supervised + zero-shot interestingness ranking
related_articles:
  - llm-creativity/sciagents
  - llm-creativity/researchagent
status: draft
---

## TL;DR
SciMuse builds a knowledge graph from **58M papers** and uses an LLM to propose personalized interdisciplinary ideas. **100+ research group leaders** rated 4,400+ ideas; both supervised neural rankers and unsupervised LLM rankers can predict 'interestingness' as judged by working scientists.

## Key thesis
'Interestingness' — the subjective sense that an idea is worth pursuing — is *learnable*. With enough labeled data (4,400+ ratings from senior scientists), models can predict it; even unsupervised LLM rankers with no training can approximate it. Personalization (knowing the user's research history) materially shifts which combinations land as interesting.

## Key concepts
- **mega-scale KG** — 58M-paper graph.
- **personalized ideation** — conditioned on user's research profile.
- **interestingness prediction** — supervised + zero-shot.

## Why it matters for ai-ideator
Real-world deployment with senior scientists — the scale of human evaluation is unmatched. Two takeaways for ai-ideator: (1) personalization is high-value (the same combination can be 'fresh' to one user and 'old' to another), (2) interestingness is learnable so we should *collect* user feedback and train a small ranker on it over time.

## Memorable findings
> "Both an unsupervised LLM ranker and a small supervised model trained on real researcher feedback can predict idea-level interestingness — interestingness is learnable."

## Connections
- **Companions:** [sciagents](sciagents.md), [researchagent](researchagent.md)

## Sources
1. [arxiv:2405.17044](https://arxiv.org/abs/2405.17044) (retrieved 2026-04-30)
