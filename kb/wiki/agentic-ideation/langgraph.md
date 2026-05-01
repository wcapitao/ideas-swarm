---
title: "LangGraph"
authors: "LangChain team"
year: 2024
type: framework
domain: agentic-ideation
tier: T1
canonical_url: "https://docs.langchain.com/oss/python/langgraph/overview"
retrieved: 2026-04-30
key_concepts:
  - graph-based orchestration
  - state-machine of agents
  - HITL checkpoints
  - persistence and time-travel debugging
related_articles:
  - agentic-ideation/crewai
  - agentic-ideation/autogen
status: draft
---

## TL;DR
**Graph-based orchestration**: nodes are agents/tools/functions, edges are control flow (including conditional and cyclic), state is a shared dataclass mutated by nodes. First-class support for human-in-the-loop checkpoints, persistence, streaming, and time-travel debugging. The serious choice when your workflow needs branching/loops/HITL — Crew/Swarm get awkward there.

## Key thesis
When a workflow has *real conditional logic and cycles* (generate → critique → if-score-too-low-then-regenerate), a state-machine model fits better than a chat or sequence model. LangGraph makes the state graph explicit, inspectable, and replayable.

## Applicable pattern
Define state schema. Define nodes (each updates the state). Define edges (conditional or fixed). Run; checkpoints persist state for resume / replay / time-travel.

## Why it matters for ai-ideator
Use when you need conditional routing (e.g., 'if novelty score < 0.6 → re-route to divergent agent; if feasibility < 0.5 → route to constraint-relaxer; else → output'). The checkpointing is also the cheapest way to build a 'resume yesterday's ideation session' UX. Pick LangGraph over CrewAI when conditional cyclic state machines or HITL gates are central; CrewAI when role-based crew is enough.

## Connections
- **Alternatives:** [crewai](crewai.md), [autogen](autogen.md), [claude-agent-sdk](claude-agent-sdk.md)

## Sources
1. [LangGraph overview](https://docs.langchain.com/oss/python/langgraph/overview) (retrieved 2026-04-30)
