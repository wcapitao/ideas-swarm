---
title: "Chain-of-Verification Reduces Hallucination in Large Language Models"
authors: "Dhuliawala, Shehzaad; Komeili, Mojtaba; Xu, Jing; et al."
year: 2023
type: primary
domain: agentic-ideation
tier: T2
canonical_url: "https://arxiv.org/abs/2309.11495"
retrieved: 2026-04-30
key_concepts:
  - draft-then-verify
  - independent sub-question answering
  - self-consistency via decomposition
related_articles:
  - agentic-ideation/self-refine
status: draft
---

## TL;DR
Four-step verification: draft answer → plan verification questions → answer them independently to avoid bias → produce verified final response. **Reduces hallucinations on Wikidata list QA, MultiSpanQA, and longform generation.** F1 on closed-book QA improves 23% (0.39 → 0.48).

## Key thesis
Decomposition-based self-checking works only when sub-questions are answered *independently* of the original draft — otherwise the LLM rationalizes. The bias-free decomposition is the central mechanism.

## Applicable pattern
Draft → list verification questions about claims in the draft → answer each in a fresh prompt without showing the draft → reconcile any discrepancies → emit final.

## Why it matters for ai-ideator
**The principled feasibility-checker.** After generating a creative idea, CoVe-style verification questions ('does this method actually exist?', 'is dataset X public?', 'what is the addressable market for Y?') are the cheapest way to filter hallucinated combinations before execution.

## Memorable findings
> "Independently answering verification subquestions — without seeing the draft — is what makes CoVe work; bias-free decomposition matters."

## Connections
- **Companions:** [self-refine](self-refine.md)

## Sources
1. [arxiv:2309.11495](https://arxiv.org/abs/2309.11495) (retrieved 2026-04-30)
