---
title: "Agent Laboratory: Using LLM Agents as Research Assistants"
authors: "Schmidgall, Samuel; Su, Yusheng; Wang, Ze; et al."
year: 2025
type: primary
domain: llm-creativity
tier: T2
canonical_url: "https://arxiv.org/abs/2501.04227"
retrieved: 2026-04-30
key_concepts:
  - staged research workflow
  - co-pilot human feedback hooks
  - reasoning-model-driven planning
related_articles:
  - llm-creativity/ai-scientist
  - llm-creativity/dolphin
status: draft
---

## TL;DR
Three-stage autonomous pipeline (literature review → experimentation → report writing) seeded by a human-provided idea, with optional human feedback at each stage. Best results with o1-preview; achieves SOTA-comparable code on some tasks; 84% cost reduction vs prior autonomous research systems.

## Key thesis
Compared to AI Scientist's full automation, AgentLab keeps the human in the loop. Empirically: adding human feedback at each stage measurably improves quality. Full automation is not Pareto-optimal — the right design point is HITL co-pilot, not autonomous agent.

## Key concepts
- **staged research workflow** — literature → experiments → report.
- **HITL co-pilot mode** — optional human checkpoints between stages.

## Why it matters for ai-ideator
Reinforces a Phase-5 design decision: ai-ideator should default to a HITL mode where the human approves/redirects between stages, not a fully-autonomous "ideate → ship" mode. The 84% cost reduction is also a useful data point — staged pipelines with reasoning models for planning beat single-shot megaprompts on cost.

## Memorable findings
> "Adding human feedback at each stage of the autonomous pipeline measurably improves quality — full automation is not Pareto-optimal."

## Connections
- **Companions:** [ai-scientist](ai-scientist.md), [dolphin](dolphin.md)

## Sources
1. [arxiv:2501.04227](https://arxiv.org/abs/2501.04227) (retrieved 2026-04-30)
