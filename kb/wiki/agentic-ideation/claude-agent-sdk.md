---
title: "Claude Agent SDK (Subagents + Skills)"
authors: "Anthropic"
year: 2025
type: framework
domain: agentic-ideation
tier: T1
canonical_url: "https://docs.claude.com/en/api/agent-sdk/overview"
retrieved: 2026-04-30
key_concepts:
  - description-driven subagent invocation
  - Operator/Orchestrator
  - Split-and-Merge
  - permissions and hooks
  - isolated subagent context
related_articles:
  - agentic-ideation/crewai
  - agentic-ideation/langgraph
status: draft
---

## TL;DR
The runtime under Claude Code, exposed as a library (TS: `@anthropic-ai/claude-agent-sdk`; Python: `claude-agent-sdk`). **Subagents** are declared with a description, system prompt, restricted toolset, and optional model — the parent agent's LLM decides when to invoke them based on the description. Patterns documented: Operator/Orchestrator, Split-and-Merge (fan out to up to 10 subagents), Agent Teams with shared task list. Permissions/hooks system enforces safety.

## Key thesis
Agents work best when each has a narrow, *description-driven* role and an isolated context. The parent's LLM routes based on subagent descriptions — vague descriptions kill invocation rates. Subagents see only what they need; the parent sees only the final message — this is the right primitive for parallel exploration without context pollution.

## Applicable pattern
Description-driven subagent invocation. Subagents have isolated context (parent only sees final message). Split-and-Merge for parallel work; Operator/Orchestrator for managed delegation.

## Why it matters for ai-ideator
**Native fit if user is in Claude ecosystem.** Define subagents: `concept-retriever` (read-only KB tools), `combinator` (Sonnet, persona-cycling), `critic` (Opus, tougher judgment), `pitch-writer`. Parent orchestrator does Split-and-Merge for parallel concept-pair exploration. Hooks let you log every idea generated for later eval. The permissions system supports the Stella Principle natively.

## Connections
- **Alternatives:** [crewai](crewai.md), [langgraph](langgraph.md), [autogen](autogen.md)

## Sources
1. [Claude Agent SDK overview](https://docs.claude.com/en/api/agent-sdk/overview) (retrieved 2026-04-30)
