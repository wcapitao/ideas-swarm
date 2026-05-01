---
title: "Chain of Ideas: Revolutionizing Research via Novel Idea Development with LLM Agents"
authors: "Li, Long; Xu, Weiwen; Guo, Jiayan; et al."
year: 2024
type: primary
domain: llm-creativity
tier: T1
canonical_url: "https://arxiv.org/abs/2410.13185"
retrieved: 2026-04-30
key_concepts:
  - domain trajectory chains
  - next-paper-style ideation
  - Idea Arena pairwise eval
  - iterative novelty filter
related_articles:
  - llm-creativity/researchagent
  - llm-creativity/nova
status: draft
---

## TL;DR
Builds 'chains' of literature reflecting the progressive development of a research domain, then asks the LLM to predict the next link. Three stages: CoI construction → idea generation with iterative novelty checks → experiment design. Introduces 'Idea Arena' pairwise evaluation. ~$0.50 per idea.

## Key thesis
Research ideation should not be unconstrained generation; it should be *trajectory extrapolation*. By representing a domain as a chronologically-ordered chain of papers and prompting the LLM to write "the next paper in this chain," you produce ideas that are novel-but-plausible — the most useful operating point for actual research.

## Key concepts
- **CoI construction** — building chronological domain trajectories.
- **Idea Arena** — pairwise tournament evaluation of ideas.
- **iterative novelty filter** — filter out generated ideas that match existing literature.

## Why it matters for ai-ideator
Provides an inductive bias for the system when the user wants ideas that are novel-but-plausible (most business contexts) rather than wild combinations. CoI is the right operating mode for "next-step business idea in this market" prompts. Idea Arena is also a reusable evaluation harness — pairwise judges are cheaper and more reliable than absolute scoring.

## Memorable findings
> "CoI generates research-quality ideas at ~$0.50 each — performance comparable to humans, costs comparable to a coffee."

## Connections
- **Predecessors:** [researchagent](researchagent.md)
- **Companions:** [nova](nova.md), [ideasynth](ideasynth.md)

## Sources
1. [arxiv:2410.13185](https://arxiv.org/abs/2410.13185) (retrieved 2026-04-30)
