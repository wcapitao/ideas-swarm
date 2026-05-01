---
title: "Some Empirical Criteria for Attributing Creativity to a Computer Program"
authors: "Ritchie, Graeme D."
year: 2007
type: framework
domain: computational-creativity
tier: T1
canonical_url: "https://doi.org/10.1007/s11023-007-9066-2"
retrieved: 2026-04-30
key_concepts:
  - typicality
  - quality
  - novelty
  - inspiring set
  - ratio criteria
  - average and weighted measures
  - creativity attribution
related_articles:
  - computational-creativity/boden-computer-models
  - computational-creativity/jordanous-specs
status: draft
---

## TL;DR
18 empirical criteria for judging whether a program's outputs warrant the attribution of creativity, organized around three dimensions: **typicality** (does the output belong to the intended class?), **quality** (is it good?), and **novelty** relative to the program's *inspiring set*. The standard rubric for evaluating creative AI systems.

## Key thesis
Creativity attribution should be a *measurement*, not a vibe. Pick an inspiring set (the program's training/source material), then compute the proportion of outputs that are typical, the proportion that are high quality, and the proportion that are novel relative to the set. Combinations of these proportions (Ritchie defines 18 specific ratios and weighted versions) constitute the creativity profile.

## Key concepts
- **inspiring set** — the explicit reference set against which outputs are judged for novelty.
- **typicality** — does the output count as a member of the target class?
- **quality** — is it any good (by domain criteria)?
- **novelty** — how different is it from the inspiring set?
- **ratio criteria** — Ritchie's 18 specific formulas combining typicality/quality/novelty proportions.

## Why it matters for ai-ideator
Forces ai-ideator to specify, *in advance*, three things:
1. What counts as a valid business idea (typicality).
2. What counts as a good one (quality criteria).
3. What's the **inspiring set** for novelty? — this is the most overlooked design decision in LLM ideation systems. Are you novel relative to the KB? Relative to existing companies? Relative to the LLM's training distribution? Different choices give wildly different "novelty" signals.

Without these commitments, evaluation is anecdotal cherry-picking.

## Memorable passages
> "An item is novel if it is dissimilar to existing examples in some specified inspiring set."

## Connections
- **Predecessors:** [boden-computer-models](boden-computer-models.md)
- **Descendants:** [jordanous-specs](jordanous-specs.md), [colton-creativity-vs-perception](colton-creativity-vs-perception.md)

## Sources
1. [DOI 10.1007/s11023-007-9066-2 — Minds and Machines 17(1), 67–99](https://doi.org/10.1007/s11023-007-9066-2) (retrieved 2026-04-30)
