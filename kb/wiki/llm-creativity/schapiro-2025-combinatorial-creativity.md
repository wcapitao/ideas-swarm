---
title: "Combinatorial Creativity: A New Frontier in Generalization Abilities"
authors: "Schapiro, Samuel; Shashidhar, Sumuk; Gladstone, Alexi; et al."
year: 2025
type: primary
domain: llm-creativity
tier: T1
canonical_url: "https://arxiv.org/abs/2509.21043"
retrieved: 2026-04-30
key_concepts:
  - combinatorial creativity
  - novelty-utility tradeoff
  - ideation-execution gap
  - compositional vs combinatorial generalization
  - scaling-law analysis of creativity
related_articles:
  - llm-creativity/si-2024-can-llms-generate-novel-ideas
  - llm-creativity/si-2025-ideation-execution-gap
  - computational-creativity/boden-creative-mind
status: draft
---

## TL;DR
**The definitional anchor paper for the LLM-era domain.** Argues combinatorial creativity is a distinct generalization ability from compositional generalization — open-ended, evaluated by degrees of novelty and utility rather than against fixed targets. Provides early empirical results on how LLM creativity scales with model size, finds optimal depth-width tradeoffs, and introduces the **ideation-execution gap** framing along with a fundamental **novelty-utility tradeoff**.

## Key thesis
LLM "creativity" should not be evaluated as accuracy. Combinatorial creativity is a different kind of generalization — open-ended outputs scored on continuous novelty and utility scales — and it has its own scaling laws and architectural sensitivities. The central empirical claim: a fundamental novelty-utility tradeoff persists even at scale, and the gap between idea-time scores and post-execution outcomes is its empirical signature.

## Key concepts
- **combinatorial creativity (LLM sense)** — open-ended generation of new combinations evaluated by degrees of novelty and utility.
- **novelty-utility tradeoff** — increasing one tends to decrease the other; no free lunch.
- **ideation-execution gap** — apparent novelty at ideation does not survive contact with execution.
- **compositional vs combinatorial** — compositional = systematic combination of known primitives for known tasks; combinatorial = open-ended for unknown tasks.

## Why it matters for ai-ideator
Any ideation system design should explicitly position itself on the novelty-utility tradeoff curve. ai-ideator's evaluator must score both axes; the project must commit to a target operating point (e.g., "high novelty, moderate utility, with a feasibility gate"). This paper supplies the language for that commitment.

## Memorable findings
> "There is no free lunch: a fundamental novelty-utility tradeoff persists even at scale, and the ideation-execution gap is its empirical signature."

## Connections
- **Predecessors:** [boden-creative-mind](../computational-creativity/boden-creative-mind.md), [koestler-act-of-creation](../foundational-philosophy/koestler-act-of-creation.md)
- **Direct companions:** [si-2024-can-llms-generate-novel-ideas](si-2024-can-llms-generate-novel-ideas.md), [si-2025-ideation-execution-gap](si-2025-ideation-execution-gap.md)

## Sources
1. [arxiv:2509.21043](https://arxiv.org/abs/2509.21043) (retrieved 2026-04-30)
2. [HF papers — 2509.21043](https://huggingface.co/papers/2509.21043)
