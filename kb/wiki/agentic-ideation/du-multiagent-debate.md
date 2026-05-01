---
title: "Improving Factuality and Reasoning in Language Models through Multiagent Debate"
authors: "Du, Yilun; Li, Shuang; Torralba, Antonio; Tenenbaum, Joshua B.; Mordatch, Igor"
year: 2023
type: primary
domain: agentic-ideation
tier: T1
canonical_url: "https://arxiv.org/abs/2305.14325"
retrieved: 2026-04-30
key_concepts:
  - multi-agent debate
  - consensus by iterative critique
  - society-of-mind ensemble
related_articles:
  - agentic-ideation/liang-multiagent-debate
  - agentic-ideation/reconcile
status: draft
---

## TL;DR
N parallel LLM instances each generate an answer, then each is shown the others' answers and asked to revise. Repeated for several rounds. Reduces hallucinations and improves reasoning across six benchmarks. Black-box compatible — same prompts/procedure for all tasks.

## Key thesis
Pluralism scales without retraining. Multiple LLM instances prompted independently, then asked to revise in light of each other's answers, converge on better outputs than any single instance — even with the same model and same temperature.

## Applicable pattern
Parallel-then-cross-pollinate. Round 1: N agents generate independently. Round 2..K: each sees the full set of last-round answers and revises. Cheaper than turn-taking debate; natural ensemble diversity.

## Why it matters for ai-ideator
The **'idea convergence' pass** after divergent generation. Spawn 5 agents to each propose a business model around retrieved concepts in parallel; then run 2 rounds of cross-revision. The settled answer captures consensus signal while preserving the diversity of the initial sample.

## Memorable findings
> "Three GPT-3.5 agents debating each other beat a single GPT-3.5 with chain-of-thought on factuality and arithmetic — pluralism scales without retraining."

## Connections
- **Companions:** [liang-multiagent-debate](liang-multiagent-debate.md), [reconcile](reconcile.md), [mixture-of-agents](mixture-of-agents.md)

## Sources
1. [arxiv:2305.14325](https://arxiv.org/abs/2305.14325) (retrieved 2026-04-30)
