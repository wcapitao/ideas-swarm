---
title: "CAMEL: Communicative Agents for 'Mind' Exploration of Large Language Model Society"
authors: "Li, Guohao; Hammoud, Hasan Abed Al Kader; Itani, Hani; Khizbullin, Dmitrii; Ghanem, Bernard"
year: 2023
type: framework
domain: agentic-ideation
tier: T2
canonical_url: "https://arxiv.org/abs/2303.17760"
retrieved: 2026-04-30
key_concepts:
  - inception prompting
  - role-conditioned agent pairs
  - autonomous task completion via dialogue
related_articles:
  - agentic-ideation/autogen
  - agentic-ideation/chatdev
status: draft
---

## TL;DR
Introduces role-playing **'inception prompting'** to drive autonomous cooperation between two agents (AI user and AI assistant) toward a task. The earliest fully autonomous role-played agent setup; widely-used open-source library.

## Key thesis
Two role-played LLM agents can plan and complete a task autonomously from a single seed prompt. The 'inception prompt' establishes both roles and the task such that the dialogue self-perpetuates without further human input. Origin point for the entire role-play agent ecosystem.

## Why it matters for ai-ideator
Useful as the **minimal baseline for any 'two-agent ideation' design** where one agent generates and the other criticizes, before adding more sophisticated machinery. Inception prompting is also a clean primitive: it produces autonomous behavior from a single setup prompt.

## Memorable findings
> "Two role-played LLM agents can plan and complete a task autonomously from a single seed prompt — origin point for the entire role-play agent ecosystem."

## Connections
- **Descendants:** [autogen](autogen.md), [chatdev](chatdev.md), [metagpt](metagpt.md)

## Sources
1. [arxiv:2303.17760](https://arxiv.org/abs/2303.17760) (retrieved 2026-04-30)
