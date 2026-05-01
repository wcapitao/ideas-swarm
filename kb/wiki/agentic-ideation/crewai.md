---
title: "CrewAI"
authors: "Moura, João / crewAIInc (open-source)"
year: 2024
type: framework
domain: agentic-ideation
tier: T1
canonical_url: "https://docs.crewai.com/en/introduction"
retrieved: 2026-04-30
key_concepts:
  - Role-Goal-Backstory agent specification
  - Crew (sequential / hierarchical)
  - Flow (event-driven state machine)
  - manager-driven delegation
related_articles:
  - agentic-ideation/autogen
  - agentic-ideation/langgraph
  - agentic-ideation/claude-agent-sdk
status: draft
---

## TL;DR
Python framework for **role-based multi-agent orchestration**. Primitives: `Agent` (role + goal + backstory + tools), `Task`, `Crew` (sequential or hierarchical), `Flow` (event-driven state machine that can invoke Crews). No LangChain dependency — leaner than alternatives. Built-in memory (short/long/entity/contextual), 100+ tools.

## Key thesis
Default mental model: **"team of specialists with a manager."** Most ideation pipelines map cleanly onto an org chart, so a framework whose primitives ARE org-chart concepts (Agent, Task, Crew) is the lowest-friction way to build.

## Applicable pattern
Define Agents with Role/Goal/Backstory; group into a Crew; the manager agent (or fixed sequence) delegates. Flows handle deterministic glue between LLM stages.

## Why it matters for ai-ideator
**Most natural framework for ai-ideator.** Define `ConceptRetriever`, `CombinationGenerator`, `MarketAnalyst`, `FeasibilityCritic`, `PitchWriter`; chain them in a Crew. The Backstory field is where you inject persona diversity. The Flow primitive is where deterministic retrieval/scoring code lives — keeping the system Stella-compliant.

## Connections
- **Alternatives:** [langgraph](langgraph.md), [autogen](autogen.md), [claude-agent-sdk](claude-agent-sdk.md), [smolagents](smolagents.md)

## Sources
1. [CrewAI docs](https://docs.crewai.com/en/introduction) (retrieved 2026-04-30)
