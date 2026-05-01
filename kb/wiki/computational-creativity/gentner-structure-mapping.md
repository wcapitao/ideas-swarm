---
title: "Structure-Mapping: A Theoretical Framework for Analogy"
authors: "Gentner, Dedre"
year: 1983
type: framework
domain: computational-creativity
tier: T1
canonical_url: "https://doi.org/10.1207/s15516709cog0702_3"
retrieved: 2026-04-30
key_concepts:
  - structure mapping
  - base domain
  - target domain
  - relational structure
  - systematicity principle
  - Structure-Mapping Engine (SME)
  - analogy vs literal similarity
related_articles:
  - computational-creativity/hofstadter-fluid-concepts
  - computational-creativity/fauconnier-turner-blending-1998
status: draft
---

## TL;DR
Analogical reasoning works by mapping the **relational structure** (not surface attributes) of a base domain onto a target domain. The **systematicity principle**: mappings preferring connected systems of relations over isolated predicates produce stronger analogies. Pre-dates the field of computational creativity but is foundational substrate.

## Key thesis
A literal similarity transfers attributes (red apple ↔ red ball: both are red). An analogy transfers *relations* (the atom is like the solar system: not because they look alike, but because the relational structure of "small thing orbits large thing under attractive force" is shared). Higher-order relations (relations among relations) are preferred over isolated predicates — this is systematicity.

## Key concepts
- **base / target domains** — the source of structure and the destination.
- **relational structure** — the system of predicates connecting entities; the *shape* of the domain.
- **systematicity principle** — connected systems of relations transfer better than disconnected ones.
- **Structure-Mapping Engine (SME)** — the canonical computational implementation.

## Why it matters for ai-ideator
When you blend "Uber" with "healthcare," you're doing structure mapping: the relational system (on-demand matching of supply/demand via mobile app with rating system) is what gets imported, not surface features. Gentner provides the formal account of what makes a *deep* blend versus a shallow pun. Operational implication: extract the relational structure of source concepts before blending; do not blend surface features.

## Memorable passages
> "An analogy is an assertion that a relational structure that normally applies in one domain can be applied in another domain."

## Connections
- **Descendants:** [hofstadter-fluid-concepts](hofstadter-fluid-concepts.md), [fauconnier-turner-blending-1998](fauconnier-turner-blending-1998.md)

## Sources
1. [DOI 10.1207/s15516709cog0702_3 — Cognitive Science 7(2), 155–170](https://doi.org/10.1207/s15516709cog0702_3) (retrieved 2026-04-30)
