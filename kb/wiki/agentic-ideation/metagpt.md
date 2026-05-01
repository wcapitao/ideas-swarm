---
title: "MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework"
authors: "Hong, Sirui; Zhuge, Mingchen; Chen, Jiaqi; et al."
year: 2023
type: framework
domain: agentic-ideation
tier: T2
canonical_url: "https://arxiv.org/abs/2308.00352"
retrieved: 2026-04-30
key_concepts:
  - SOP-encoded prompts
  - structured artifact handoffs (PRDs, architecture docs)
  - assembly-line decomposition
related_articles:
  - agentic-ideation/chatdev
  - agentic-ideation/autogen
status: draft
---

## TL;DR
Encodes Standardized Operating Procedures (SOPs) into agent prompts to suppress cascading hallucinations in multi-agent pipelines. Decomposes work assembly-line style across PM/architect/engineer/QA agents. Outperforms prior chat-based multi-agent systems on software engineering benchmarks.

## Key thesis
Free-form chat between agents *cascades* hallucinations: each agent's mistake is taken as input by the next. Encoding human SOPs (PM writes a structured PRD; architect produces a structured design doc; etc.) constrains what each agent emits, breaking the cascade.

## Why it matters for ai-ideator
Shows that **imposing structured artifact handoffs** (instead of free chat) is what makes long agent pipelines stable. Useful template for an ideation system whose stages — explore, evaluate, refine, score — must each emit a *typed artifact*. ai-ideator should adopt typed handoffs (concept-pair → blend record → evaluation record → ranked output), not pass loose text between agents.

## Memorable findings
> "Encoding human SOPs into prompts is what suppresses cascading hallucination across long agent chains."

## Connections
- **Companions:** [chatdev](chatdev.md), [autogen](autogen.md)

## Sources
1. [arxiv:2308.00352](https://arxiv.org/abs/2308.00352) (retrieved 2026-04-30)
