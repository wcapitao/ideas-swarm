---
title: "Mixture-of-Agents Enhances Large Language Model Capabilities"
authors: "Wang, Junlin; Wang, Jue; Athiwaratkun, Ben; Zhang, Ce; Zou, James"
year: 2024
type: primary
domain: agentic-ideation
tier: T1
canonical_url: "https://arxiv.org/abs/2406.04692"
retrieved: 2026-04-30
key_concepts:
  - heterogeneous proposer-aggregator stack
  - layered refinement
  - model-diversity advantage
related_articles:
  - agentic-ideation/du-multiagent-debate
status: draft
---

## TL;DR
Layered architecture: layer-1 has N proposer agents (often *different* models — Llama, Qwen, Mixtral, etc.). Each subsequent layer's agents receive *all* layer-1 outputs as context and refine. Final aggregator emits the answer. **Open-source MoA hits 65.1% on AlpacaEval 2.0 vs. GPT-4 Omni's 57.5%.** Demonstrates aggregating diverse models beats any single model.

## Key thesis
The diversity in 'multi-agent' systems comes mostly from **using different models**, not different prompts. Same model with N personas is much weaker than N different model families with the same prompt. Layered aggregation extracts the union of priors.

## Applicable pattern
Layer 1 = diverse models proposing. Layer 2+ = refiners conditioning on full slate. Final = aggregator.

## Why it matters for ai-ideator
Run idea generation across *different* model families (Claude, GPT-4, Llama, Mixtral) in parallel — each has different priors about what 'a good business' looks like, so the union covers more concept-combination space than any single model alone. Aggregator picks the strongest. **The architectural argument for not being mono-model.**

## Memorable findings
> "Open-source MoA hits 65.1% on AlpacaEval 2.0 vs. GPT-4 Omni's 57.5% — model diversity is doing the work."

## Connections
- **Companions:** [du-multiagent-debate](du-multiagent-debate.md), [reconcile](reconcile.md)

## Sources
1. [arxiv:2406.04692](https://arxiv.org/abs/2406.04692) (retrieved 2026-04-30)
