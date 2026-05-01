---
title: "The Ideation-Execution Gap: Execution Outcomes of LLM-Generated versus Human Research Ideas"
authors: "Si, Chenglei; Hashimoto, Tatsunori; Yang, Diyi"
year: 2025
type: primary
domain: llm-creativity
tier: T1
canonical_url: "https://arxiv.org/abs/2506.20803"
retrieved: 2026-04-30
key_concepts:
  - execution study
  - novelty-feasibility-effectiveness
  - rank flip
related_articles:
  - llm-creativity/si-2024-can-llms-generate-novel-ideas
  - llm-creativity/schapiro-2025-combinatorial-creativity
  - llm-creativity/dolphin
status: draft
---

## TL;DR
Follow-up to Si 2024. **43 expert researchers each spent 100+ hours actually executing a randomly-assigned LLM-generated or human-generated idea**, producing a 4-page paper. After execution, LLM ideas dropped significantly more than human ideas on novelty, excitement, effectiveness and overall quality (p<0.05). **Rankings flipped: human ideas now scored higher.**

## Key thesis
Novelty at idea-time does not survive contact with execution. LLM-generated ideas appear novel because they are unmoored from the constraints that would limit a human; on contact with reality, they degrade more. The hardest empirical finding in the field: any ideation system must either (a) co-design with execution feedback loops or (b) explicitly model and evaluate feasibility, not just novelty.

## Key concepts
- **rank flip** — apparent winners at ideation become losers post-execution.
- **execution-time feasibility** — distinct from prompt-time feasibility judgments.

## Why it matters for ai-ideator
The single most important caution for ai-ideator: pure novelty optimization is a trap. The system must include feasibility prediction and ideally a downstream "execution simulation" critic. Phase 4 of the roadmap (evaluator) must include an execution-feasibility component, not just an "is this novel?" check.

## Memorable findings
> "After 100+ hours of execution per idea, LLM-generated research ideas lose more score than human ideas on every metric — and human ideas end up ranked higher."

## Connections
- **Predecessors:** [si-2024-can-llms-generate-novel-ideas](si-2024-can-llms-generate-novel-ideas.md)
- **Descendants:** [dolphin](dolphin.md) — closes the loop with execution feedback.
- **Resonates with:** [schapiro-2025-combinatorial-creativity](schapiro-2025-combinatorial-creativity.md) — names the gap formally.

## Sources
1. [arxiv:2506.20803](https://arxiv.org/abs/2506.20803) (retrieved 2026-04-30)
