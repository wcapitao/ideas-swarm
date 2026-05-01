---
title: "Self-Refine: Iterative Refinement with Self-Feedback"
authors: "Madaan, Aman; Tandon, Niket; Gupta, Prakhar; Hallinan, Skyler; et al."
year: 2023
type: primary
domain: agentic-ideation
tier: T1
canonical_url: "https://arxiv.org/abs/2303.17651"
retrieved: 2026-04-30
key_concepts:
  - self-critique prompt
  - feedback-conditioned revision
  - test-time iterative loop
related_articles:
  - agentic-ideation/reflexion
  - agentic-ideation/tree-of-thoughts
status: draft
---

## TL;DR
A single LLM produces an output, generates feedback on it, then revises — repeated until convergence. **No training, no extra models, no labels.** Across 7 tasks (dialog, math, code, creative writing) with GPT-3.5/4, average ~20% absolute improvement; humans prefer Self-Refine outputs. Canonical reference for the generator-critic prompting pattern.

## Key thesis
The cheapest, simplest iterative-improvement pattern: generate → self-critique → revise. Works because the same LLM is *better at evaluating* than at one-shot generation; the critic prompt elicits judgments the generator prompt missed.

## Key concepts
- **self-critique prompt** — same model, different prompt, focused on weakness identification.
- **feedback-conditioned revision** — generator sees the critique and produces a new draft.
- **test-time loop** — no fine-tuning, all done at inference.

## Applicable pattern
Wrap any single-shot LLM call in: generate → self-critique (with rubric) → revise. Stop at quality threshold or max-iters (~4).

## Why it matters for ai-ideator
**Cheapest baseline for any ideation agent.** Wrap any single-shot 'generate business idea' call in a Self-Refine loop with a critic prompt that scores novelty + feasibility + customer-pain-fit. Solid 15-25% quality lift before you build any multi-agent infra. **Most of the agentic ideation systems are essentially Self-Refine variants** where the critic is grounded in literature, peer review, or knowledge graphs.

## Memorable findings
> "Just looping output → self-critique → revise yields ~20% absolute improvement across 7 disparate tasks with no training."

## Connections
- **Companions:** [reflexion](reflexion.md), [tree-of-thoughts](tree-of-thoughts.md)
- **Descendants:** [llm-creativity/researchagent](../llm-creativity/researchagent.md), [llm-creativity/ideasynth](../llm-creativity/ideasynth.md)

## Sources
1. [arxiv:2303.17651](https://arxiv.org/abs/2303.17651) (retrieved 2026-04-30)
