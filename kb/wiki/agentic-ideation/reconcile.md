---
title: "ReConcile: Round-Table Conference Improves Reasoning via Consensus among Diverse LLMs"
authors: "Chen, Justin; Saha, Swarnadeep; Bansal, Mohit"
year: 2023
type: primary
domain: agentic-ideation
tier: T1
canonical_url: "https://arxiv.org/abs/2309.13007"
retrieved: 2026-04-30
key_concepts:
  - confidence-weighted multi-model debate
  - rectifying explanations
  - calibrated aggregation
related_articles:
  - agentic-ideation/du-multiagent-debate
  - agentic-ideation/mixture-of-agents
status: draft
---

## TL;DR
Multi-model 'round-table' where heterogeneous LLMs (e.g., GPT-4, Claude, Bard) debate with explicit confidence scores and human-rectifying-explanation demonstrations to convince each other. Final answer via **confidence-weighted vote**. **+11.4% over single-agent and prior multi-agent baselines**; outperforms GPT-4 alone on three datasets.

## Key thesis
Multi-model debate works better when (a) agents are heterogeneous (different model families), (b) each emits a calibrated confidence with its answer, (c) final aggregation is confidence-weighted, not majority. The rectifying-explanation demonstrations bootstrap each agent's ability to convince/be-convinced.

## Applicable pattern
Each agent emits (answer, justification, confidence ∈ [0,1]). Discussion includes answer-rectifying examples. Final aggregation = confidence-weighted vote.

## Why it matters for ai-ideator
**Final ranking layer for the ideation pipeline.** After generating a slate of business ideas, run a ReConcile pass where 3 heterogeneous-model judges score each on novelty/feasibility/market-fit with confidences; weighted-vote produces final ranking that's calibrated and less single-model-biased. Especially valuable when you need a single answer rather than a slate.

## Connections
- **Companions:** [du-multiagent-debate](du-multiagent-debate.md), [mixture-of-agents](mixture-of-agents.md)

## Sources
1. [arxiv:2309.13007](https://arxiv.org/abs/2309.13007) (retrieved 2026-04-30)
