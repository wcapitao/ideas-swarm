---
title: "Conceptual Integration Networks"
authors: "Fauconnier, Gilles; Turner, Mark"
year: 1998
type: primary
domain: computational-creativity
tier: T1
canonical_url: "https://doi.org/10.1207/s15516709cog2202_1"
retrieved: 2026-04-30
key_concepts:
  - conceptual blending
  - input space 1
  - input space 2
  - generic space
  - blended space
  - emergent structure
  - selective projection
  - cross-space mapping
related_articles:
  - computational-creativity/fauconnier-turner-way-we-think
  - foundational-philosophy/koestler-act-of-creation
  - combinatorial-creativity/conceptual-blending
status: draft
---

## TL;DR
**THE formal cognitive model** of how two concepts combine to yield something new. Meaning arises by selectively projecting from two (or more) input mental spaces into a **blended space** via a **generic space**, producing **emergent structure** absent in either input. The four-space architecture is directly applicable to a business-idea generator.

## Key thesis
Conceptual integration is a fundamental cognitive operation, not a special poetic device. It involves at least four mental spaces:
1. **Input Space 1** (e.g., "Uber")
2. **Input Space 2** (e.g., "pet care")
3. **Generic Space** — what they share at an abstract level (on-demand service matching supply and demand)
4. **Blended Space** — the new whole, with emergent properties (insurance, GPS tracking, owner reviews) that neither parent dictated.

Selective projection from inputs to blend is *not* compositional — the blend may add structure (completion, elaboration) that follows the blend's own logic.

## Key concepts
- **input space** — a structured mental representation of one source domain.
- **generic space** — the abstraction shared by both inputs; the "what's the same here?" layer.
- **blended space** — the new structure that integrates partial projections from both inputs.
- **emergent structure** — features true of the blend but not of either parent.
- **selective projection** — only some elements from each input project into the blend.
- **cross-space mapping** — the correspondences between inputs that allow projection.

## Why it matters for ai-ideator
This paper is the **mathematical shape** of the operation ai-ideator performs. The four-space structure maps directly onto the prompt template:
- Step 1: Identify Input A and Input B from the KB.
- Step 2: Construct the Generic Space (what abstraction do they share?).
- Step 3: Build the Blended Space — selectively project; let emergent structure surface.
- Step 4: Evaluate the blend on novelty + utility + surprise.

Skip the generic space and you get shallow puns. Build it and you get genuine combinatorial creativity.

## Memorable passages
> "Blending is not a compositional algorithmic operation… The blended space typically develops emergent structure not provided by the inputs."

## Connections
- **Predecessors:** [koestler-act-of-creation](../foundational-philosophy/koestler-act-of-creation.md) — bisociation as the cognitive intuition.
- **Descendants:** [fauconnier-turner-way-we-think](fauconnier-turner-way-we-think.md), [veale-exploding-creativity](veale-exploding-creativity.md)
- **Cross-cutting:** [conceptual-blending](../combinatorial-creativity/conceptual-blending.md)

## Sources
1. [DOI 10.1207/s15516709cog2202_1 — Cognitive Science 22(2), 133–187](https://doi.org/10.1207/s15516709cog2202_1) (retrieved 2026-04-30)
