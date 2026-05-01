# LLM-Era Combinatorial Creativity — Index

> 2022–2026 papers on using large language models for concept combination, ideation, and creative reasoning. The state of the art and where ai-ideator slots in.

Last updated: 2026-04-30
Articles: 22

## T1 — Foundational

| Article | Authors | Year | arXiv | Summary |
|---|---|---|---|---|
| [schapiro-2025-combinatorial-creativity](schapiro-2025-combinatorial-creativity.md) | Schapiro et al. | 2025 | 2509.21043 | **The definitional anchor.** Names combinatorial creativity as a distinct generalization ability; introduces novelty-utility tradeoff and ideation-execution gap. |
| [si-2024-can-llms-generate-novel-ideas](si-2024-can-llms-generate-novel-ideas.md) | Si, Yang, Hashimoto | 2024 | 2409.04109 | LLM ideas judged more novel than 100+ NLP experts (p<0.05). Recipe: retrieval + over-generate + rerank. **Empirical anchor for ai-ideator's architecture.** |
| [si-2025-ideation-execution-gap](si-2025-ideation-execution-gap.md) | Si, Hashimoto, Yang | 2025 | 2506.20803 | Follow-up: after 100+ hours of execution per idea, LLM ideas degrade more; ranking flips. **The hardest empirical finding in the field.** |
| [researchagent](researchagent.md) | Baek et al. | 2024 | 2404.07738 | Academic graph + entity store + LLM ideator + reviewer agents with human-aligned criteria. Iterative refinement. |
| [chain-of-ideas](chain-of-ideas.md) | Li et al. | 2024 | 2410.13185 | Domain trajectory chains; next-paper prediction; ~$0.50/idea. Idea Arena pairwise eval. |
| [nova](nova.md) | Hu et al. | 2024 | 2410.14255 | Planned multi-hop retrieval; 3.4× more unique novel ideas than baseline. **Diversity from planned retrieval, not temperature.** |
| [ideasynth](ideasynth.md) | Pu et al. | 2024 | 2410.04025 | Facet decomposition (problem/solution/evaluation/contribution) on a canvas; literature-grounded per-facet feedback. |
| [scideator](scideator.md) | Radensky et al. | 2024 | 2409.14634 | Purpose/Mechanism/Evaluation facet recombination; novelty-classification 13.79% → 89.66% with facets. **Direct architectural reference.** |
| [llms-realize-combinatorial-creativity](llms-realize-combinatorial-creativity.md) | Gu et al. | 2024 | 2412.14141 | Theory-grounded: hierarchical abstraction-level retrieval before recombination; +7-10% similarity to real research developments. |
| [cooking-up-creativity](cooking-up-creativity.md) | Mizrahi et al. | 2025 | 2504.20643 | Translate to structured representation, manipulate symbolically, translate back. Beats GPT-4o on recipes. **The argument for structured intermediate representations.** |
| [ai-scientist](ai-scientist.md) | Lu et al. | 2024 | 2408.06292 | End-to-end ideate→code→experiment→write→review pipeline; <$15/paper. |
| [creativityprism](creativityprism.md) | Zhang et al. | 2025 | 2510.20091 | Holistic LLM creativity evaluation: Quality / Novelty / Diversity. Reference-free semantic-entropy metric. |

## T2 — Important context

| Article | Authors | Year | arXiv | Summary |
|---|---|---|---|---|
| [sciagents](sciagents.md) | Ghafarollahi & Buehler | 2024 | 2409.05556 | KG + multi-agent for materials discovery; cross-disciplinary connections from grounded swarm. |
| [agent-laboratory](agent-laboratory.md) | Schmidgall et al. | 2025 | 2501.04227 | HITL co-pilot (lit review → experiments → report); 84% cost reduction; full automation isn't Pareto-optimal. |
| [dolphin](dolphin.md) | Yuan et al. | 2025 | 2501.03916 | Closed-loop with traceback-guided code repair; partially closes the ideation-execution gap. |
| [ideabench](ideabench.md) | Guo et al. | 2024 | 2411.02429 | 2,374-paper / 8-domain benchmark; two-stage Insight Score. |
| [liveideabench](liveideabench.md) | Ruan et al. | 2024 | 2412.17596 | Single-keyword pure-divergent test; creativity is a separable axis from general intelligence. |
| [scimuse](scimuse.md) | Gu & Krenn | 2024 | 2405.17044 | 58M-paper KG + personalized ideation; interestingness is learnable from senior-scientist feedback. |
| [kumar-2024-rct-creativity](kumar-2024-rct-creativity.md) | Kumar et al. | 2024 | 2410.03703 | Pre-registered N=1,100 RCT; LLM-assisted users beat controls during, lose to controls afterward. **Skill atrophy is real.** |
| [ding-2023-fluid-transformers](ding-2023-fluid-transformers.md) | Ding et al. | 2023 | 2302.12832 | LLM cross-domain analogies cause humans to reformulate problems in ~80% of cases. |

## T3 — Supporting

| Article | Authors | Year | arXiv | Summary |
|---|---|---|---|---|
| [ai-augmented-brainwriting](ai-augmented-brainwriting.md) | Shaer et al. | 2024 | 2402.14978 | LLM-augmented group brainwriting; calibrated LLM-as-judge for convergent stage. |
| [agent-ideate-patents](agent-ideate-patents.md) | Kanumolu et al. | 2025 | 2507.01717 | Patent-grounded product ideation; agentic > standalone LLM. **One of few business-ideation papers.** |

## Concept index

| Concept | Article(s) |
|---|---|
| **Combinatorial creativity (LLM era)** | [schapiro-2025](schapiro-2025-combinatorial-creativity.md), [llms-realize-combinatorial-creativity](llms-realize-combinatorial-creativity.md), [cooking-up-creativity](cooking-up-creativity.md) |
| **Novelty-utility tradeoff** | [schapiro-2025](schapiro-2025-combinatorial-creativity.md), [si-2024](si-2024-can-llms-generate-novel-ideas.md), [si-2025](si-2025-ideation-execution-gap.md) |
| **Ideation-execution gap** | [si-2025](si-2025-ideation-execution-gap.md), [schapiro-2025](schapiro-2025-combinatorial-creativity.md), [dolphin](dolphin.md) |
| **Retrieval-grounded over-generation + rerank** | [si-2024](si-2024-can-llms-generate-novel-ideas.md), [researchagent](researchagent.md), [nova](nova.md) |
| **Facet decomposition** | [scideator](scideator.md), [ideasynth](ideasynth.md) |
| **Domain-trajectory chains (next-paper prediction)** | [chain-of-ideas](chain-of-ideas.md) |
| **Planned multi-hop retrieval** | [nova](nova.md) |
| **Structured intermediate representation** | [cooking-up-creativity](cooking-up-creativity.md), [llms-realize-combinatorial-creativity](llms-realize-combinatorial-creativity.md) |
| **Hierarchical abstraction-level retrieval** | [llms-realize-combinatorial-creativity](llms-realize-combinatorial-creativity.md) |
| **End-to-end autonomous research** | [ai-scientist](ai-scientist.md), [agent-laboratory](agent-laboratory.md), [dolphin](dolphin.md) |
| **KG-grounded multi-agent ideation** | [sciagents](sciagents.md), [scimuse](scimuse.md) |
| **Multi-dimensional creativity evaluation (LLM-era)** | [creativityprism](creativityprism.md), [ideabench](ideabench.md), [liveideabench](liveideabench.md) |
| **Cross-domain analogy as perspective shift** | [ding-2023-fluid-transformers](ding-2023-fluid-transformers.md) |
| **Patent-grounded ideation** | [agent-ideate-patents](agent-ideate-patents.md) |
| **Skill atrophy from LLM assistance** | [kumar-2024-rct-creativity](kumar-2024-rct-creativity.md) |

## Reading order

If you read **only five papers** to ground ai-ideator:
1. [schapiro-2025-combinatorial-creativity](schapiro-2025-combinatorial-creativity.md) — the field's anchor.
2. [si-2024-can-llms-generate-novel-ideas](si-2024-can-llms-generate-novel-ideas.md) + [si-2025-ideation-execution-gap](si-2025-ideation-execution-gap.md) — what works and what fails.
3. [scideator](scideator.md) — the cleanest existing combinatorial-creativity LLM implementation.
4. [nova](nova.md) — how to get diversity right.
5. [creativityprism](creativityprism.md) — how to evaluate.

## Connections out of this domain

- ← [computational-creativity/](../computational-creativity/INDEX.md) — Boden, Fauconnier-Turner, Wiggins, Ritchie, Jordanous — the canon these papers extend.
- ← [foundational-philosophy/](../foundational-philosophy/INDEX.md) — Hume, Koestler, Mednick — the deeper lineage.
- → [agentic-ideation/](../agentic-ideation/INDEX.md) — the agent patterns and frameworks these systems use.
- → [combinatorial-creativity/](../combinatorial-creativity/INDEX.md) — cross-cutting concept articles.
