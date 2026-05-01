---
title: "Cooking Up Creativity: Enhancing LLM Creativity through Structured Recombination"
authors: "Mizrahi, Moran; Shani, Chen; Stanovsky, Gabriel; Jurafsky, Dan; Shahaf, Dafna"
year: 2025
type: primary
domain: llm-creativity
tier: T1
canonical_url: "https://arxiv.org/abs/2504.20643"
retrieved: 2026-04-30
key_concepts:
  - NL ↔ structured representation
  - cognitively-inspired symbolic manipulations
  - abstraction-level recombination
  - DishCOVER (recipes)
related_articles:
  - llm-creativity/llms-realize-combinatorial-creativity
  - computational-creativity/fauconnier-turner-way-we-think
status: draft
---

## TL;DR
Argues LLMs sample at the surface level and miss real creative leaps. Solution: **translate to a structured representation, perform cognitively inspired manipulations** (substitution, abstraction, blending) on that structure, then translate back. Demonstrated via DishCOVER (recipes); domain experts rate outputs as significantly more novel and diverse than GPT-4o.

## Key thesis
Doing creativity in raw token space is doomed: LLMs minimize next-token loss, which favors safe surface continuations. Force the creative move into a structured intermediate representation (where you can apply explicit abstraction, substitution, blending operators), then translate back to natural language. The structure is where real creativity happens.

## Key concepts
- **structured intermediate representation** — typed graph or schema; not tokens.
- **cognitively-inspired operators** — substitution, abstraction, blending — drawn from cognitive science.
- **translate-manipulate-translate** — the three-stage pipeline.

## Why it matters for ai-ideator
The strongest recent argument for **going through a structured intermediate representation** rather than doing creativity in raw token space. Highly relevant: ai-ideator should support a typed intermediate schema (concepts, mechanisms, constraints, business roles) and apply explicit combinatorial operators on it, not free-form LLM mush.

## Memorable findings
> "Doing the creative move in a structured schema, not in tokens, is what beats GPT-4o on novelty/diversity for a domain it knows extremely well (recipes)."

## Connections
- **Predecessors:** [fauconnier-turner-way-we-think](../computational-creativity/fauconnier-turner-way-we-think.md), [llms-realize-combinatorial-creativity](llms-realize-combinatorial-creativity.md)

## Sources
1. [arxiv:2504.20643](https://arxiv.org/abs/2504.20643) (retrieved 2026-04-30)
