---
title: "The Way We Think: Conceptual Blending and the Mind's Hidden Complexities"
authors: "Fauconnier, Gilles; Turner, Mark"
year: 2002
type: primary
domain: computational-creativity
tier: T1
canonical_url: "https://markturner.org/wwt.html"
retrieved: 2026-04-30
key_concepts:
  - double-scope blending
  - single-scope networks
  - mirror networks
  - simplex networks
  - vital relations
  - compression
  - running the blend
related_articles:
  - computational-creativity/fauconnier-turner-blending-1998
  - combinatorial-creativity/conceptual-blending
status: draft
---

## TL;DR
The book-length statement of conceptual blending theory. Argues **double-scope blending** — combining incompatible input frames into a coherent blend — is the cognitive innovation that makes humans uniquely creative. Provides a typology of integration networks that ranks blends by structural depth.

## Key thesis
Blending is everywhere — in everyday language ("digging your own grave"), in mathematics, in the computer desktop metaphor, in surgery-as-butchery. The really creative blends are *double-scope*: the input frames clash organizationally, yet the blend reconciles them with new emergent logic. The book classifies integration networks (simplex / mirror / single-scope / double-scope) by how much of the inputs' organizing frame survives.

## Key concepts
- **simplex network** — a value is plugged into a frame's role; minimal blend.
- **mirror network** — inputs share an organizing frame; the blend integrates differing values.
- **single-scope network** — only one input's frame organizes the blend.
- **double-scope network** — both inputs contribute organizing frame; the blend reconciles them. Maximum creative leverage.
- **vital relations** — the conceptual connections (Time, Space, Cause-Effect, Identity, Change, Analogy, Disanalogy, Property, Similarity, Category, Intentionality, Uniqueness) that get compressed in blending.
- **running the blend** — once constructed, the blend can be elaborated by its own internal logic.

## Why it matters for ai-ideator
Gives ai-ideator a **typology for ranking conceptual distance** between inputs. Double-scope blends are where the most surprising business ideas live. The four network types translate into prompt-engineering choices:
- *Simplex/Mirror* prompts → safe, derivative ideas.
- *Single-scope* prompts → moderately novel, derivative-of-one-parent ideas.
- *Double-scope* prompts → high-novelty, high-risk ideas (and the highest hallucination rate).

A well-designed system controls which type it requests based on the task.

## Memorable passages
> "The essence of the operation is to construct a partial match between two inputs… and then to project selectively from those inputs into a novel 'blended' mental space, which then dynamically develops emergent structure."

## Connections
- **Predecessors:** [fauconnier-turner-blending-1998](fauconnier-turner-blending-1998.md)
- **Descendants:** [veale-exploding-creativity](veale-exploding-creativity.md), [llm-creativity/cooking-up-creativity](../llm-creativity/cooking-up-creativity.md)

## Sources
1. [Mark Turner's site — The Way We Think](https://markturner.org/wwt.html) (retrieved 2026-04-30)
2. [Wikipedia — Conceptual blending](https://en.wikipedia.org/wiki/Conceptual_blending)
