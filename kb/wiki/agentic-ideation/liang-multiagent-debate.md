---
title: "Encouraging Divergent Thinking in Large Language Models through Multi-Agent Debate"
authors: "Liang, Tian; He, Zhiwei; Jiao, Wenxiang; et al."
year: 2023
type: primary
domain: agentic-ideation
tier: T1
canonical_url: "https://arxiv.org/abs/2305.19118"
retrieved: 2026-04-30
key_concepts:
  - Degeneration-of-Thought (DoT)
  - adversarial multi-agent debate
  - tit-for-tat interaction
  - judge-mediated termination
related_articles:
  - agentic-ideation/du-multiagent-debate
status: draft
---

## TL;DR
Identifies the **Degeneration-of-Thought (DoT)** problem — once an LLM commits to an answer, self-reflection cannot generate genuinely novel alternatives. Proposes Multi-Agent Debate (MAD): two affirmative/negative debaters in a 'tit-for-tat' state plus a judge who manages debate flow. Empirically improves on commonsense MT and counter-intuitive arithmetic. Key finding: a *moderate* level of disagreement is optimal.

## Key thesis
Self-reflection cannot escape an LLM's first commitment. Forcing real divergent thought requires *adversarial* agents — one whose explicit job is to disagree. Tit-for-tat at moderate intensity is the sweet spot; too cooperative collapses to consensus, too adversarial collapses to noise.

## Key concepts
- **Degeneration-of-Thought (DoT)** — an LLM cannot self-correct away from its first commitment.
- **adversarial debate** — opposed agents force exploration.
- **tit-for-tat** — controlled disagreement intensity.

## Applicable pattern
Spawn N agents with deliberately opposed system prompts. Each round, each sees the others' last argument and must respond. A judge agent monitors and terminates when divergence is sufficient OR convergence is reached.

## Why it matters for ai-ideator
Names a core failure mode of single-agent ideation (DoT) and provides the canonical fix. After retrieving 2 concepts, spawn a Bull and Bear agent who debate viability. The judge surfaces ideas only when the Bull survives substantive Bear pushback — screens out weak superficial recombinations. **For divergent ideation specifically, MAD is a better default than Du et al.'s consensus-seeking debate.**

## Memorable findings
> "Self-reflection alone cannot escape an LLM's first commitment; only adversarial agents force genuine divergent thinking."

## Connections
- **Companions:** [du-multiagent-debate](du-multiagent-debate.md), [reconcile](reconcile.md)

## Sources
1. [arxiv:2305.19118](https://arxiv.org/abs/2305.19118) (retrieved 2026-04-30)
