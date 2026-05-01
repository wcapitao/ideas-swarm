---
title: "Solo Performance Prompting: Multi-Persona Self-Collaboration"
authors: "Wang, Zhenhailong; Mao, Shaoguang; Wu, Wenshan; Ge, Tao; Wei, Furu; Ji, Heng"
year: 2023
type: primary
domain: agentic-ideation
tier: T1
canonical_url: "https://arxiv.org/abs/2307.05300"
retrieved: 2026-04-30
key_concepts:
  - dynamic persona generation
  - single-model multi-turn self-collaboration
  - task-conditioned role assignment
related_articles:
  - agentic-ideation/multi-persona-prompting
status: draft
---

## TL;DR
Solo Performance Prompting (SPP) makes a *single* LLM simulate a panel of personas in one prompt — the model first identifies which experts the task needs, then role-plays them in sequence, with a Leader persona synthesizing. Crucially, **cognitive synergy emerges only at GPT-4-class scale**; smaller models lose persona coherence.

## Key thesis
Many tasks need multiple expert perspectives. SPP provides that diversity from a single model in a single prompt — much cheaper than orchestrating real subagents — but the synergy is a capability threshold: only frontier models maintain persona coherence and produce real diversity.

## Applicable pattern
One prompt: (1) auto-generate cast of personas the task needs (Marketer, Engineer, Skeptical CFO, Target User), (2) simulate dialogue, (3) Leader synthesizes.

## Why it matters for ai-ideator
**Cheap inner ideation loop *inside* a single subagent.** Lets you get persona diversity without paying for N separate agent calls. Pair with real multi-agent debate at the outer layer for the most robust setup: SPP for the cheap inner expansion, MAD for the expensive but powerful outer convergence.

## Memorable findings
> "Cognitive synergy from multi-persona self-collaboration only emerges in GPT-4 — it's a capability threshold."

## Connections
- **Companions:** [multi-persona-prompting](multi-persona-prompting.md)

## Sources
1. [arxiv:2307.05300](https://arxiv.org/abs/2307.05300) (retrieved 2026-04-30)
