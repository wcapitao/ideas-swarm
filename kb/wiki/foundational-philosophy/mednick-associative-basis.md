---
title: "The Associative Basis of the Creative Process"
authors: "Mednick, Sarnoff A."
year: 1962
type: primary
domain: foundational-philosophy
tier: T1
canonical_url: "https://doi.org/10.1037/h0048850"
retrieved: 2026-04-30
key_concepts:
  - associative hierarchy (flat vs. steep)
  - remote associates
  - Remote Associates Test (RAT)
  - useful combinations
  - serendipity / similarity / mediation
related_articles:
  - foundational-philosophy/hume-treatise-association-of-ideas
  - foundational-philosophy/james-principles-association
  - combinatorial-creativity/remote-associates
status: draft
---

## TL;DR
Creativity is the forming of associative elements into new combinations that meet specified requirements. Creative individuals have **flat** associative hierarchies (many weak, far-flung associates to a stimulus) rather than **steep** ones (a few dominant associates), enabling them to reach remote combinations. The Remote Associates Test (RAT) operationalizes this and is the standard benchmark for testing combinatorial creativity in humans and models.

## Key thesis
Two people exposed to the same word produce different associations not by sampling the same distribution differently but because their distributions are differently shaped. Steep distributions concentrate probability on a few obvious associates (e.g., "table → chair"); flat distributions spread probability widely so distant associates are reachable. Creativity is enabled by the flat shape.

## Key concepts
- **associative hierarchy** — the probability distribution over a stimulus's associates; flat vs. steep is the central variable.
- **remote associates** — associates that are infrequent / far down the hierarchy.
- **Remote Associates Test (RAT)** — Mednick's benchmark: given three words, find a fourth that connects them.
- **routes to combination** — Mednick's typology of how remote associates get joined: serendipity, similarity, mediation.

## Why it matters for ai-ideator
Mednick gives the operational definition of combinatorial creativity that is closest to what an LLM ideation system actually does: take semantically distant inputs and find the connecting concept. Two design implications:
1. **Distance-controlled retrieval is a feature, not a bug.** Sometimes sample distant rather than nearest concepts.
2. **The RAT is directly usable as an eval** — both as a sanity check on the underlying model and as a structural template for "find the connecting concept" prompts.

## Memorable passages
> "We may proceed to define the creative thinking process as the forming of associative elements into new combinations which either meet specified requirements or are in some way useful. The more mutually remote the elements of the new combination, the more creative the process or solution."

## Connections
- **Predecessors:** [hume-treatise-association-of-ideas](hume-treatise-association-of-ideas.md), [james-principles-association](james-principles-association.md)
- **Descendants:** [koestler-act-of-creation](koestler-act-of-creation.md), [boden-creative-mind](../computational-creativity/boden-creative-mind.md)
- **Cross-cutting:** [remote-associates](../combinatorial-creativity/remote-associates.md)

## Sources
1. [DOI 10.1037/h0048850 — Psychological Review 69(3), 220–232](https://doi.org/10.1037/h0048850) (retrieved 2026-04-30)
