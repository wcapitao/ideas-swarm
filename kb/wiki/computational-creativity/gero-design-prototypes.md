---
title: "Design Prototypes: A Knowledge Representation Schema for Design"
authors: "Gero, John S."
year: 1990
type: framework
domain: computational-creativity
tier: T2
canonical_url: "https://doi.org/10.1609/aimag.v11i4.854"
retrieved: 2026-04-30
key_concepts:
  - design prototypes
  - Function-Behavior-Structure (FBS) framework
  - routine design
  - innovative design
  - creative design
  - variable space expansion
related_articles:
  - computational-creativity/boden-creative-mind
status: draft
---

## TL;DR
Introduces design prototypes as a representation that distinguishes **routine, innovative, and creative** design. Creative design occurs when *new variables* are added to the design space; innovative design re-instantiates existing variables in new ranges; routine design fills standard variable ranges. Parallel to Boden's combinational/exploratory/transformational.

## Key thesis
Design is not all the same kind of activity. Routine design is parameter selection; innovative design is range extension; creative design is space expansion. A design prototype is a structured triple of Function (what it does), Behavior (how it does it), Structure (the implementation). Creativity is best modeled as adding new variables to this representation.

## Key concepts
- **Function-Behavior-Structure (FBS)** — Gero's tripartite design representation.
- **routine / innovative / creative** — the three modes of design.
- **variable space expansion** — what makes design genuinely creative.

## Why it matters for ai-ideator
The FBS frame is directly transplantable as a slot structure for an LLM business idea generator:
- **Function** = customer job-to-be-done.
- **Behavior** = how the business achieves it (mechanism).
- **Structure** = the operational implementation (people, tech, channels).

This makes business ideation isomorphic to engineering design — and lets you reuse 30 years of design-research evaluation methodology.

## Memorable passages
> "Creative design… is concerned with the introduction of new variables that hitherto have not been part of the design representation."

## Connections
- **Predecessors:** [boden-creative-mind](boden-creative-mind.md)

## Sources
1. [DOI 10.1609/aimag.v11i4.854 — AI Magazine 11(4), 26–36](https://doi.org/10.1609/aimag.v11i4.854) (retrieved 2026-04-30)
