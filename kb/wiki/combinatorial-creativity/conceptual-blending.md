---
title: "Conceptual Blending"
authors: null
year: null
type: concept
domain: combinatorial-creativity
tier: T1
canonical_url: null
retrieved: 2026-04-30
key_concepts:
  - input space 1
  - input space 2
  - generic space
  - blended space
  - emergent structure
  - selective projection
related_articles:
  - computational-creativity/fauconnier-turner-blending-1998
  - computational-creativity/fauconnier-turner-way-we-think
  - combinatorial-creativity/bisociation
status: draft
---

## TL;DR
**Conceptual blending** is the formal cognitive model of how two (or more) concepts combine to yield a new whole with **emergent structure** — properties true of the blend but not of either parent. Introduced by Fauconnier & Turner (1998, 2002); the cognitive-science formalization of Koestler's bisociation. The architectural template for ai-ideator's combiner.

## The four-space architecture
Every blend involves at least four mental spaces:

```
   Input Space 1          Input Space 2
   (e.g., "Uber")        (e.g., "pet care")
        \                       /
         \                     /
          v                   v
        Generic Space
   (on-demand service matching
    supply and demand via app)
              |
              v
        Blended Space
  (Uber for dog walkers — emergent:
   GPS tracking, owner reviews,
   pet-care insurance schemes)
```

- **Input Space 1, Input Space 2** — the source concepts.
- **Generic Space** — the abstract structure both inputs share. *This is the most-skipped step in shallow blending and the source of most failures.*
- **Blended Space** — the new whole, drawing selectively from both inputs.
- **Emergent Structure** — features true of the blend that were not features of either input.

## The four operations on the blend
1. **Composition** — initial combination of projected elements.
2. **Completion** — pattern recognition fills in missing structure from the blend's own logic.
3. **Elaboration** — "running the blend" to derive consequences.
4. **(Reverse projection)** — sometimes the blend projects back to inform the inputs.

## Network typology (Fauconnier-Turner 2002)
- **Simplex** — one input is a frame, the other a value. Minimal blend.
- **Mirror** — inputs share an organizing frame. Moderate blend.
- **Single-scope** — only one input's frame organizes the blend.
- **Double-scope** — both inputs contribute organizing frame; the blend reconciles them. **Maximum creative leverage; highest difficulty.**

ai-ideator should support all four, with explicit user/system control over which type is requested.

## Operational template for ai-ideator

```python
def blend(input_a: Concept, input_b: Concept) -> Blend:
    generic = abstract_shared_structure(input_a, input_b)
    if generic is None:
        return None  # No coherent generic space → no blend possible
    blend = project_selectively(input_a, input_b, generic)
    blend = complete_pattern(blend)        # fill in the gaps
    blend = elaborate(blend)                # run the blend
    return blend
```

The implementation is LLM-driven, but the *structure* is deterministic.

## Common failures
- **Skipping the generic space** → shallow puns, "X for Y" templates without depth.
- **Equal-projection bias** → blending all features 50/50 instead of selectively projecting.
- **No elaboration** → the blend is asserted but not "run"; emergent structure is never surfaced.

## Related concepts
- **bisociation** (Koestler) — the cognitive intuition this formalizes.
- **structure mapping** ([Gentner 1983](../computational-creativity/gentner-structure-mapping.md)) — the related formal account based on relational structure.
- **combinational creativity** ([Boden](../computational-creativity/boden-creative-mind.md)) — the AI-relevant mode.

## Sources
1. [Fauconnier & Turner 1998 — Conceptual Integration Networks](../computational-creativity/fauconnier-turner-blending-1998.md)
2. [Fauconnier & Turner 2002 — The Way We Think](../computational-creativity/fauconnier-turner-way-we-think.md)
3. [Koestler 1964 — The Act of Creation](../foundational-philosophy/koestler-act-of-creation.md)
4. [Cooking Up Creativity (2025)](../llm-creativity/cooking-up-creativity.md) — modern LLM-era validation
