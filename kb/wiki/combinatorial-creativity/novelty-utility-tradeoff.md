---
title: "The Novelty-Utility Tradeoff and the Ideation-Execution Gap"
authors: null
year: null
type: concept
domain: combinatorial-creativity
tier: T1
canonical_url: null
retrieved: 2026-04-30
key_concepts:
  - novelty-utility tradeoff
  - ideation-execution gap
  - standard definition (novelty + effectiveness)
  - Pareto frontier of creativity
related_articles:
  - llm-creativity/schapiro-2025-combinatorial-creativity
  - llm-creativity/si-2025-ideation-execution-gap
  - computational-creativity/runco-jaeger-standard-definition
status: draft
---

## TL;DR
The single most important design constraint for any ideation system: **maximizing novelty alone produces nonsense; maximizing utility alone produces clichés.** Creativity lives on the Pareto frontier between them. Ignoring this tradeoff is the most common failure mode of "AI ideation" tools.

## The standard definition (Runco & Jaeger 2012)
> "Creativity requires both originality and effectiveness."

This is not negotiable. Drop either axis and you exit the field.

## The LLM-era empirical findings

### Si 2024: novelty up, feasibility down
LLM-generated NLP research ideas are judged statistically *more novel* than ideas from 100+ expert researchers — but slightly *less feasible*.

### Si 2025: rank flip after execution
After 43 experts spent 100+ hours each *executing* an LLM-generated or human-generated idea, the LLM ideas degraded more on every metric. **The ranking flipped: human ideas now scored higher.**

### Schapiro 2025: this is fundamental, not a calibration issue
There is no free lunch. Novelty-utility is a real Pareto tradeoff that persists at scale. The empirical signature is the **ideation-execution gap**: apparent novelty does not survive contact with execution.

## The ideation-execution gap
A score that looks high at idea-time can drop sharply once the idea is built/tested. Reasons:
- The novelty signal is partly *unmoored novelty* — the idea is novel because it isn't constrained by reality.
- The feasibility signal at idea-time is the LLM's prediction of feasibility, which is over-optimistic for novel-looking ideas.
- Real execution surfaces constraints the idea-time judgment couldn't.

## Operational implications for ai-ideator

1. **Score both axes independently.** Never collapse novelty + utility into a single LLM judge call.
2. **Use heterogeneous judges for utility.** Single-judge bias is a known issue (CreativityPrism, ReConcile).
3. **Add explicit feasibility prediction.** Ask "what would have to be true for this to work?" and check those preconditions.
4. **Where possible, close the loop with execution feedback** (Dolphin's pattern) so future rounds learn what survives reality.
5. **Operate on a chosen point on the Pareto frontier.** ai-ideator's design specifies "high novelty, moderate utility, hard feasibility gate" — but this is a project-level commitment, not a default.

## The right mental model
Imagine a 2D plane: x = novelty, y = utility. Random sampling produces a cloud near (low, low). Single-prompt LLMs produce a band hugging the y-axis (high utility, low novelty — clichés). Naïve "be creative!" prompts produce a band hugging the x-axis (high novelty, low utility — gibberish). **A good system pushes outward toward the Pareto frontier without jumping off the cliff into incoherence.**

## Related concepts
- **standard definition of creativity** ([Runco & Jaeger 2012](../computational-creativity/runco-jaeger-standard-definition.md))
- **CreativityPrism evaluation** ([Zhang 2025](../llm-creativity/creativityprism.md))
- **Boden's three types** — combinational, exploratory, transformational each have different positions on this frontier.

## Sources
1. [Schapiro 2025 — Combinatorial Creativity (anchor)](../llm-creativity/schapiro-2025-combinatorial-creativity.md)
2. [Si 2024](../llm-creativity/si-2024-can-llms-generate-novel-ideas.md)
3. [Si 2025 — Ideation-Execution Gap](../llm-creativity/si-2025-ideation-execution-gap.md)
4. [Runco & Jaeger 2012](../computational-creativity/runco-jaeger-standard-definition.md)
