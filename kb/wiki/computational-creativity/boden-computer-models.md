---
title: "Computer Models of Creativity"
authors: "Boden, Margaret A."
year: 2009
type: survey
domain: computational-creativity
tier: T1
canonical_url: "https://doi.org/10.1609/aimag.v30i3.2254"
retrieved: 2026-04-30
key_concepts:
  - combinational creativity
  - evaluation of creative AI
  - semantic networks
  - knowledge-richness as bottleneck
related_articles:
  - computational-creativity/boden-creative-mind
  - computational-creativity/ritchie-empirical-criteria
status: draft
---

## TL;DR
Surveys how AI systems implement each of Boden's three creativity types and argues — counterintuitively — that **combinational creativity is the hardest to model in AI**, because evaluating which combinations are valuable demands rich semantic knowledge. Generating combinations is trivial; valuing them is expensive.

## Key thesis
Pure combinational generation is computationally cheap; what's hard is determining which combinations are valuable, which requires large stores of world knowledge and many ways of moving around within it. This inverts the naive expectation that combinational creativity is the "easy" form and transformational the "hard" one.

## Key concepts
- **knowledge-richness as bottleneck** — for combinational creativity, the value-judgment step is the rate limiter.
- **evaluation as the central problem** — generating ideas is trivial compared with telling good ones from bad.

## Why it matters for ai-ideator
This is the single best citation for why ai-ideator must invest heavily in the **evaluation layer** (Phase 4 of the roadmap). Combination is cheap; valuing the output is expensive. Most "AI ideation" projects fail because they try to optimize the cheap step.

## Memorable passages
> "Combinational creativity, paradoxically, is the most difficult to model in AI — for it requires a rich store of knowledge, and many ways of moving around within it."

## Connections
- **Predecessors:** [boden-creative-mind](boden-creative-mind.md), [boden-nutshell](boden-nutshell.md)
- **Descendants:** [ritchie-empirical-criteria](ritchie-empirical-criteria.md), [jordanous-specs](jordanous-specs.md)

## Sources
1. [DOI 10.1609/aimag.v30i3.2254 — AI Magazine 30(3), 23–34](https://doi.org/10.1609/aimag.v30i3.2254) (retrieved 2026-04-30)
