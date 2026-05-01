---
title: "Reflexion: Language Agents with Verbal Reinforcement Learning"
authors: "Shinn, Noah; Cassano, Federico; Berman, Edward; et al."
year: 2023
type: primary
domain: agentic-ideation
tier: T1
canonical_url: "https://arxiv.org/abs/2303.11366"
retrieved: 2026-04-30
key_concepts:
  - verbal RL via natural-language reflections
  - episodic memory of failures
  - self-evaluation traces
related_articles:
  - agentic-ideation/self-refine
status: draft
---

## TL;DR
Agents reflect on task feedback in natural language and store the reflections in episodic memory; future trials condition on these reflections rather than weight updates. **Achieves 91% pass@1 on HumanEval, beating GPT-4's 80%**, and improves sequential decision-making and reasoning across diverse benchmarks.

## Key thesis
Verbal reflection works as a substitute for gradient-based RL. The reflection persists across trials; the agent learns from its own failures *in language*, without retraining. Crucial for long-horizon tasks where each trial is expensive.

## Key concepts
- **verbal RL** — natural-language reflection in place of gradient updates.
- **episodic memory** — past reflections stored and retrieved.
- **self-evaluation traces** — the reflection includes why a trial failed.

## Applicable pattern
After each trial: prompt LLM to reflect on what went wrong. Store reflection. Next trial: condition on stored reflections. Iterate until success or max trials.

## Why it matters for ai-ideator
Provides the **long-horizon learning loop** that an ideation agent needs across multiple ideation rounds. Reflexion-style memory of "why this idea was rejected" is what prevents the system from recycling the same combinations. ai-ideator's session memory should store rejection rationales (Reflexion-style), not just accepted ideas.

## Memorable findings
> "Reflexion reaches 91% pass@1 on HumanEval, beating raw GPT-4's 80% — verbal reflection works as a substitute for gradient-based RL."

## Connections
- **Companions:** [self-refine](self-refine.md)

## Sources
1. [arxiv:2303.11366](https://arxiv.org/abs/2303.11366) (retrieved 2026-04-30)
