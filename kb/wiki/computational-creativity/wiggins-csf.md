---
title: "A Preliminary Framework for Description, Analysis and Comparison of Creative Systems"
authors: "Wiggins, Geraint A."
year: 2006
type: framework
domain: computational-creativity
tier: T1
canonical_url: "https://doi.org/10.1016/j.knosys.2006.04.009"
retrieved: 2026-04-30
key_concepts:
  - Creative Systems Framework (CSF)
  - conceptual space
  - universe of concepts
  - rules of traversal R
  - generation operator T
  - evaluation E
  - aberration
related_articles:
  - computational-creativity/boden-creative-mind
  - computational-creativity/ritchie-empirical-criteria
status: draft
---

## TL;DR
Formalizes Boden's intuitive framework into a rigorous **Creative Systems Framework (CSF)**. A creative system is a tuple `<U, L, [[·]], <<·,·>>, R, T, E>` over a universe of concepts, with explicit operators for **traversal (R), generation (T), and evaluation (E)** of a conceptual space. The first formal specification of what a creative system *is* as a computational object.

## Key thesis
To compare creative systems rigorously, you need a notation. Wiggins introduces one. The seven components are: U (universe), L (language), `[[·]]` (interpretation), `<<·,·>>` (preference), R (rules of traversal — what counts as the conceptual space), T (transformations producing new candidates), E (evaluation). Boden's three creativity types are then expressible as different operations on this tuple.

## Key concepts
- **Creative Systems Framework (CSF)** — Wiggins' formal tuple.
- **conceptual space (R)** — the rules that define what counts as legal in this domain.
- **generation operator (T)** — transforms one concept into another.
- **evaluation (E)** — judges whether a concept is good.
- **aberration** — when T produces something outside R; transformational creativity reinterprets R itself.

## Why it matters for ai-ideator
Wiggins gives ai-ideator the architectural vocabulary it needs. The system must have **three architecturally separated components**: retrieval/space-definition (R), generation (T), evaluation (E). They should not be the same prompt to the same model. This is the citation for designing the architecture, not just the prompts. Wiggins also formalizes when a candidate output counts as transformational vs exploratory — directly useful for evaluation rubrics.

## Memorable passages
> "We have proposed a framework which allows us to describe creative behaviour in computational systems… and to compare different systems on the same basis."

## Connections
- **Predecessors:** [boden-creative-mind](boden-creative-mind.md), [ritchie-empirical-criteria](ritchie-empirical-criteria.md)
- **Descendants:** [colton-wiggins-final-frontier](colton-wiggins-final-frontier.md)

## Sources
1. [DOI 10.1016/j.knosys.2006.04.009 — Knowledge-Based Systems 19(7), 449–458](https://doi.org/10.1016/j.knosys.2006.04.009) (retrieved 2026-04-30)
