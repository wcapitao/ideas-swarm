# Agentic Ideation — Index

> Multi-agent and orchestration patterns for LLM ideation. Reasoning scaffolds (ToT, GoT), generator-critic loops (Self-Refine, Reflexion), debate (Liang, Du), persona prompting (SPP, multi-persona), heterogeneous-model aggregation (MoA, ReConcile), frameworks (CrewAI, LangGraph, AutoGen, Claude Agent SDK), structured-method pipelines (AutoTRIZ).

Last updated: 2026-04-30
Articles: 21

## T1 — Foundational reasoning scaffolds

| Article | Authors | Year | arXiv | Pattern | Summary |
|---|---|---|---|---|---|
| [tree-of-thoughts](tree-of-thoughts.md) | Yao et al. | 2023 | 2305.10601 | tree search | Generation + value prompt + BFS/DFS + backtracking. CoT 4% → ToT 74% on Game of 24. |
| [graph-of-thoughts](graph-of-thoughts.md) | Besta et al. | 2023 | 2308.09687 | DAG aggregation | Thoughts can be **merged**, not just branched. Conceptual blending = graph aggregation. |
| [self-refine](self-refine.md) | Madaan et al. | 2023 | 2303.17651 | generator-critic loop | Single LLM, generate → critique → revise. ~20% lift across 7 tasks. **Cheapest baseline.** |
| [reflexion](reflexion.md) | Shinn et al. | 2023 | 2303.11366 | verbal RL | Agents reflect in language; episodic memory of failures. 91% pass@1 on HumanEval. |

## T1 — Multi-agent debate / aggregation

| Article | Authors | Year | arXiv | Pattern | Summary |
|---|---|---|---|---|---|
| [du-multiagent-debate](du-multiagent-debate.md) | Du et al. | 2023 | 2305.14325 | parallel debate | N parallel agents → cross-revision. Reduces hallucination. **Use for convergence.** |
| [liang-multiagent-debate](liang-multiagent-debate.md) | Liang et al. | 2023 | 2305.19118 | adversarial debate | Names Degeneration-of-Thought; adversarial agents force divergent thinking. **Use for divergence.** |
| [solo-performance-prompting](solo-performance-prompting.md) | Wang et al. | 2023 | 2307.05300 | single-model multi-persona | Cheap inner loop; synergy emerges only at GPT-4 scale. |
| [mixture-of-agents](mixture-of-agents.md) | Wang et al. | 2024 | 2406.04692 | heterogeneous proposer-aggregator | Diversity comes from different *models*, not different prompts. |
| [reconcile](reconcile.md) | Chen et al. | 2023 | 2309.13007 | confidence-weighted multi-model | Round-table with calibrated confidence; +11.4% over baselines. **Use for final ranking.** |

## T1 — Frameworks

| Article | Maintainer | Pattern | Summary |
|---|---|---|---|
| [crewai](crewai.md) | João Moura | role-based crew | Role/Goal/Backstory primitives; cleanest mental model for ai-ideator. |
| [langgraph](langgraph.md) | LangChain | state-machine graph | Conditional cyclic state graphs with HITL checkpoints; serious choice for branching workflows. |
| [claude-agent-sdk](claude-agent-sdk.md) | Anthropic | description-driven subagents | Native fit if Claude-ecosystem; permissions/hooks system supports Stella Principle. |

## T2 — Frameworks (alternatives)

| Article | Maintainer | Pattern | Summary |
|---|---|---|---|
| [autogen](autogen.md) | Microsoft | conversation-as-orchestration | Group Chat + Nested Chats. Closest analog to a brainstorm room. |
| [smolagents](smolagents.md) | Hugging Face | code-as-action | CodeAgent writes Python; ~30% fewer LLM calls than tool-calling agents. |
| [openai-swarm](openai-swarm.md) | OpenAI | handoff-as-routing | Lightest-weight pattern; superseded by OpenAI Agents SDK. |

## T2 — Multi-agent role-play (precursors)

| Article | Authors | Year | arXiv | Summary |
|---|---|---|---|---|
| [chatdev](chatdev.md) | Qian et al. | 2023 | 2307.07924 | Role-played software-dev team; communicative dehallucination. |
| [metagpt](metagpt.md) | Hong et al. | 2023 | 2308.00352 | SOP-encoded prompts; structured artifact handoffs suppress cascading hallucination. |
| [camel](camel.md) | Li et al. | 2023 | 2303.17760 | Inception prompting; earliest fully-autonomous role-played agent setup. |
| [chain-of-verification](chain-of-verification.md) | Dhuliawala et al. | 2023 | 2309.11495 | Bias-free decomposition for hallucination reduction; +23% F1. **Feasibility-checker.** |

## T2 — Methods / Techniques

| Article | Year | Summary |
|---|---|---|
| [multi-persona-prompting](multi-persona-prompting.md) | 2024 | Parallel personas > sequential > single prompt for diversity. Six Thinking Hats. |
| [autotriz](autotriz.md) | 2024 | TRIZ encoded as LLM workflow. Structured-method-as-pipeline pattern. |

## Concept index

| Concept | Article(s) |
|---|---|
| **Tree search over thoughts** | [tree-of-thoughts](tree-of-thoughts.md) |
| **Graph/DAG aggregation of thoughts** | [graph-of-thoughts](graph-of-thoughts.md) |
| **Generator-critic loop (Self-Refine)** | [self-refine](self-refine.md) |
| **Verbal reinforcement (Reflexion)** | [reflexion](reflexion.md) |
| **Multi-agent debate (consensus)** | [du-multiagent-debate](du-multiagent-debate.md) |
| **Multi-agent debate (adversarial / divergent)** | [liang-multiagent-debate](liang-multiagent-debate.md) |
| **Degeneration-of-Thought (DoT)** | [liang-multiagent-debate](liang-multiagent-debate.md) |
| **Multi-persona self-collaboration** | [solo-performance-prompting](solo-performance-prompting.md), [multi-persona-prompting](multi-persona-prompting.md) |
| **Mixture-of-Agents (heterogeneous models)** | [mixture-of-agents](mixture-of-agents.md) |
| **Confidence-weighted aggregation** | [reconcile](reconcile.md) |
| **Chain-of-Verification (feasibility check)** | [chain-of-verification](chain-of-verification.md) |
| **Role-Goal-Backstory agents** | [crewai](crewai.md) |
| **State-machine of agents** | [langgraph](langgraph.md) |
| **Description-driven subagents** | [claude-agent-sdk](claude-agent-sdk.md) |
| **Code-as-action agents** | [smolagents](smolagents.md) |
| **Group Chat with Manager** | [autogen](autogen.md) |
| **Handoff-as-routing** | [openai-swarm](openai-swarm.md) |
| **SOP-encoded prompts (artifact handoffs)** | [metagpt](metagpt.md) |
| **Inception prompting** | [camel](camel.md) |
| **Communicative dehallucination** | [chatdev](chatdev.md) |
| **Six Thinking Hats (de Bono)** | [multi-persona-prompting](multi-persona-prompting.md) |
| **TRIZ-as-LLM-workflow** | [autotriz](autotriz.md) |

## Architectural recipe (synthesis)

The 21 sources cluster into a coherent four-layer recipe for ai-ideator:

1. **Retrieval layer** — KB-grounded with planned multi-hop (see Nova in [llm-creativity/](../llm-creativity/INDEX.md)).
2. **Divergent generation layer** — multi-persona fan-out + heterogeneous-model MoA + ToT branching.
3. **Critique/refine layer** — Self-Refine inner loop + adversarial MAD (Liang) outer loop.
4. **Convergence/eval layer** — confidence-weighted aggregation (ReConcile) + multi-dim scoring (CreativityPrism in [llm-creativity/](../llm-creativity/INDEX.md)).

Frameworks ranked for fit: **CrewAI** or **Claude Agent SDK** for orchestration shell; **LangGraph** when conditional cycles or HITL gates are central; **smolagents** for compute-heavy combinatorial inner steps.

## Reading order

1. [self-refine](self-refine.md) — the cheapest pattern; build this first.
2. [tree-of-thoughts](tree-of-thoughts.md) + [graph-of-thoughts](graph-of-thoughts.md) — the search scaffolds.
3. [du-multiagent-debate](du-multiagent-debate.md) + [liang-multiagent-debate](liang-multiagent-debate.md) — debate patterns; pick by need.
4. [crewai](crewai.md) or [claude-agent-sdk](claude-agent-sdk.md) — pick a framework.
5. [reconcile](reconcile.md) — final ranking layer.

## Connections out of this domain

- → [llm-creativity/](../llm-creativity/INDEX.md) — these patterns are *applied* in concrete ideation systems.
- ← [computational-creativity/](../computational-creativity/INDEX.md) — the creativity-evaluation theory these systems should implement.
- → [combinatorial-creativity/](../combinatorial-creativity/INDEX.md) — cross-cutting concepts mapped onto agent patterns.
