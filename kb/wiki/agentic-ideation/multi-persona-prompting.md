---
title: "Multi-Persona Prompting for Design Concept Diversity"
authors: "Hong et al. (Cambridge 'Design Science', 2024)"
year: 2024
type: primary
domain: agentic-ideation
tier: T2
canonical_url: "https://www.cambridge.org/core/journals/design-science/article/enhancing-design-concept-diversity-multipersona-prompting-strategies-for-large-language-models/3B346E253508337A4EE899499BE49D9B"
retrieved: 2026-04-30
key_concepts:
  - parallel persona fan-out
  - Six Thinking Hats (de Bono)
  - personas as semantic anchors
related_articles:
  - agentic-ideation/solo-performance-prompting
status: draft
---

## TL;DR
Systematically tests persona-prompting strategies for design ideation. **Finding: parallel personas (each with own prompt) > sequential personas > single prompt for diversity.** Personas anchor generation in distinct semantic regions. De Bono's Six Thinking Hats (White=facts, Red=emotion, Black=critique, Yellow=optimism, Green=creativity, Blue=process) is the canonical persona set in this lineage.

## Key thesis
Persona-prompting works because each persona anchors generation in a distinct semantic region of the model's distribution. Parallel beats sequential because parallel preserves the semantic separation that sequential erodes.

## Applicable pattern
For each ideation step, run K personas in parallel, each producing one candidate. Dedup + merge. Six Hats specifically: White=market data, Yellow=upside, Black=risks, Green=novel angles, Red=customer emotion, Blue=structuring discussion.

## Why it matters for ai-ideator
**Cheap, high-leverage diversity intervention.** Before any debate/critique pipeline runs, generate K initial ideas via K personas in parallel. The Six Hats specifically is well-mapped to business ideation. Parallel-personas + LLM-judge convergence is the cheapest robust ideation pipeline.

## Connections
- **Companions:** [solo-performance-prompting](solo-performance-prompting.md), [du-multiagent-debate](du-multiagent-debate.md)

## Sources
1. [Cambridge Design Science — Multi-persona Prompting](https://www.cambridge.org/core/journals/design-science/article/enhancing-design-concept-diversity-multipersona-prompting-strategies-for-large-language-models/3B346E253508337A4EE899499BE49D9B) (retrieved 2026-04-30)
