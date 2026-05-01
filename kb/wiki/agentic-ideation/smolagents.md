---
title: "smolagents"
authors: "Hugging Face"
year: 2024
type: framework
domain: agentic-ideation
tier: T2
canonical_url: "https://huggingface.co/docs/smolagents/index"
retrieved: 2026-04-30
key_concepts:
  - CodeAgent (code as action)
  - LiteLLM model abstraction
  - sandboxed execution
related_articles:
  - agentic-ideation/crewai
  - agentic-ideation/langgraph
status: draft
---

## TL;DR
Minimalist agent library (<1K LOC core). Distinctive feature: **CodeAgent writes actions as executable Python** rather than JSON tool-calls — empirically ~30% fewer steps and LLM calls vs. tool-calling agents. Supports any LLM via LiteLLM (Claude, GPT, Llama, local Ollama). Sandboxed execution via E2B/Modal/Docker/Pyodide.

## Key thesis
Tool-calling JSON is a bad action language: it requires multiple round-trips for any non-trivial composition. Letting the agent write *Python* as its action language allows it to compose multiple tools in a single expression with native control flow.

## Applicable pattern
The agent emits a Python snippet rather than a tool-call JSON. The snippet may call multiple tools, use conditionals, loop. Sandboxed runtime executes safely.

## Why it matters for ai-ideator
Use when ideation involves heavy combinatorial work over the KB (e.g., 'retrieve all concepts with tag X, cross-product with all in tag Y, filter by recency > 2024, rank by similarity to seed'). Code agents express that natively in one shot; tool-calling agents loop forever.

## Connections
- **Alternatives:** [crewai](crewai.md), [langgraph](langgraph.md)

## Sources
1. [smolagents docs](https://huggingface.co/docs/smolagents/index) (retrieved 2026-04-30)
