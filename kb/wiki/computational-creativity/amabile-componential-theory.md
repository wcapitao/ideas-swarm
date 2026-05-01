---
title: "The Componential Theory of Creativity"
authors: "Amabile, Teresa M."
year: 1983
type: framework
domain: computational-creativity
tier: T2
canonical_url: "https://www.hbs.edu/ris/Publication%20Files/12-096.pdf"
retrieved: 2026-04-30
key_concepts:
  - componential theory
  - domain skills
  - creativity-relevant processes
  - intrinsic motivation principle
  - social environment
  - killers of creativity
related_articles:
  - computational-creativity/sternberg-investment-theory
  - computational-creativity/runco-jaeger-standard-definition
status: draft
---

## TL;DR
Creative output requires the confluence of four components: (1) **domain-relevant skills**, (2) **creativity-relevant processes** (cognitive style, working style), (3) **intrinsic task motivation**, and (4) the **social/work environment**. The intrinsic motivation principle is central.

## Key thesis
Creativity is not a personality trait; it's an outcome that requires four ingredients in combination. Domain skills provide raw material; creativity-relevant processes are the cognitive machinery; intrinsic motivation is the engine (extrinsic pressure depresses creativity); environment provides or removes constraints. Remove any one and creativity collapses.

## Key concepts
- **four components** — domain skills, creativity processes, intrinsic motivation, environment.
- **intrinsic motivation principle** — extrinsic motivation hurts creativity; intrinsic helps.
- **killers of creativity** — Amabile's catalog of organizational practices that suppress creativity.

## Why it matters for ai-ideator
Bridge from psychology to system design. Amabile's four components map cleanly onto an LLM ideator's architecture:
- *Domain skills* → KB / RAG retrieval grounding.
- *Creativity-relevant processes* → combinational prompting + ToT/GoT search.
- *Motivation* → objective function / goal specification (the "why" we feed in).
- *Environment* → the prompt context and constraints the user supplies.

Cite Amabile when justifying why a single prompt isn't enough — you need all four ingredients.

## Memorable passages
> "People will be most creative when they feel motivated primarily by the interest, enjoyment, satisfaction, and challenge of the work itself — and not by external pressures."

## Connections
- **Contemporaries:** [sternberg-investment-theory](sternberg-investment-theory.md)
- **Descendants:** [runco-jaeger-standard-definition](runco-jaeger-standard-definition.md)

## Sources
1. [HBS WP #12-096 (revision)](https://www.hbs.edu/ris/Publication%20Files/12-096.pdf) (retrieved 2026-04-30)
