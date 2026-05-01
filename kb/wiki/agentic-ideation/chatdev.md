---
title: "ChatDev: Communicative Agents for Software Development"
authors: "Qian, Chen; Liu, Wei; Liu, Hongzhang; et al."
year: 2023
type: primary
domain: agentic-ideation
tier: T2
canonical_url: "https://arxiv.org/abs/2307.07924"
retrieved: 2026-04-30
key_concepts:
  - role-based specialization
  - phased chat chain workflow
  - communicative dehallucination
related_articles:
  - agentic-ideation/autogen
  - agentic-ideation/metagpt
status: draft
---

## TL;DR
LLM agents play roles (CEO, CTO, programmer, reviewer, tester) and collaborate via a 'chat chain' to take a software product from design through code to test. Introduces **'communicative dehallucination'** — letting agents verify each other's claims before progressing.

## Key thesis
Multi-agent role-play scales to building real artifacts, not just discussion. The role-as-perspective pattern (CEO has different priors than CTO) lets specialists override the LLM's default 'helpful generalist' mode. The chat chain (phased workflow) provides structure that pure conversation lacks.

## Why it matters for ai-ideator
Proves multi-agent role-play scales to real artifact production. The role-as-perspective pattern is exactly what an ideation system should exploit to combine diverse domain framings of a problem. **Communicative dehallucination** — agents verifying each other's claims — directly applies to ideation, where one agent's optimistic feasibility claim should be challenged by another agent.

## Memorable findings
> "Role-played LLM teams produced functional software end-to-end — 'natural language for design, code for debugging' as a unifying principle."

## Connections
- **Companions:** [autogen](autogen.md), [metagpt](metagpt.md), [camel](camel.md)

## Sources
1. [arxiv:2307.07924](https://arxiv.org/abs/2307.07924) (retrieved 2026-04-30)
