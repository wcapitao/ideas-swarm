---
title: "OpenAI Swarm / Agents SDK"
authors: "OpenAI"
year: 2024
type: framework
domain: agentic-ideation
tier: T2
canonical_url: "https://github.com/openai/swarm"
retrieved: 2026-04-30
key_concepts:
  - handoff-as-routing
  - stateless agents
  - emergent control flow
related_articles:
  - agentic-ideation/crewai
  - agentic-ideation/autogen
status: draft
---

## TL;DR
Educational framework (since superseded by the OpenAI Agents SDK in March 2025) demonstrating two minimalist primitives: **Agent** (instructions + tools) and **Handoff** (an Agent can return another Agent as the next responder). Stateless, client-side, no persistence — pure routing. Production users should migrate to the Agents SDK; Swarm is unmaintained but the concept is the cleanest articulation of handoff-based routing.

## Key thesis
Handoff-as-routing is the lightest-weight multi-agent pattern. Each agent knows the small set of agents it can hand off to and decides — via tool-call — when to delegate. No central orchestrator; control flow is *emergent*. Best when routing logic is genuinely local (each agent knows its own next-step).

## Why it matters for ai-ideator
Useful for a 'scout' phase where a Triage agent classifies a user's seed prompt and hands off to one of (Consumer-Product agent, B2B-SaaS agent, Marketplace agent, Hardware agent), each tuned with domain priors. Cheap, simple, and the routing logic stays inspectable.

## Connections
- **Alternatives:** [crewai](crewai.md), [autogen](autogen.md), [langgraph](langgraph.md)

## Sources
1. [OpenAI Swarm GitHub](https://github.com/openai/swarm) (retrieved 2026-04-30)
