---
title: "AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation"
authors: "Wu, Qingyun; Bansal, Gagan; Zhang, Jieyu; et al. (Microsoft)"
year: 2023
type: framework
domain: agentic-ideation
tier: T2
canonical_url: "https://arxiv.org/abs/2308.08155"
retrieved: 2026-04-30
key_concepts:
  - conversable agents
  - human-in-the-loop modes
  - programmable orchestration
  - tool-use integration
  - Group Chat / Nested Chat
related_articles:
  - agentic-ideation/chatdev
  - agentic-ideation/metagpt
  - agentic-ideation/camel
status: draft
---

## TL;DR
Conversation-as-orchestration framework. Primitives: `ConversableAgent`, `AssistantAgent`, `UserProxyAgent`. Patterns: Two-Agent Chat, Sequential Chat, **Group Chat** (with a `GroupChatManager` that picks next speaker), **Nested Chats** (encapsulated subworkflow as one agent). Now subsumed under Microsoft Agent Framework but the conceptual primitives remain the most-cited reference.

## Key thesis
Multi-agent applications are well-modeled as conversations. Letting agents speak when relevant (rather than running fixed pipelines) gives the right amount of structure for varied tasks. Group Chat with a Manager replicates how real teams work; Nested Chats let you hide a sub-team behind a single agent interface.

## Applicable pattern
Group Chat with a Manager: agents speak when the manager (or heuristic) selects them. Most flexible mental model for free-form ideation — agents can self-select speaking turns, like a real brainstorm.

## Why it matters for ai-ideator
Closest analog to a brainstorm room. Set up a Group Chat with personas (Visionary, Skeptic, Customer, Investor, Operator) and a Manager that dynamically picks who speaks next based on current state. Nest a 'research subteam' inside one agent so the main chat stays focused. **Useful when free-form discussion outperforms a rigid pipeline.**

## Connections
- **Companions:** [chatdev](chatdev.md), [metagpt](metagpt.md), [camel](camel.md)

## Sources
1. [arxiv:2308.08155](https://arxiv.org/abs/2308.08155) (retrieved 2026-04-30)
2. [AutoGen docs](https://microsoft.github.io/autogen/)
