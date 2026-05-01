---
title: "ResearchAgent: Iterative Research Idea Generation over Scientific Literature with Large Language Models"
authors: "Baek, Jinheon; Jauhar, Sujay Kumar; Cucerzan, Silviu; Hwang, Sung Ju"
year: 2024
type: primary
domain: llm-creativity
tier: T1
canonical_url: "https://arxiv.org/abs/2404.07738"
retrieved: 2026-04-30
key_concepts:
  - academic graph
  - entity knowledge store
  - LLM ideator + reviewer agents
  - human-aligned review prompts
  - iterative refinement
related_articles:
  - llm-creativity/chain-of-ideas
  - llm-creativity/scideator
  - agentic-ideation/self-refine
status: draft
---

## TL;DR
Combines an academic graph and an entity knowledge store of shared concepts mined across many papers with an LLM ideator and multiple LLM-based reviewer agents whose evaluation criteria are aligned to human judgments. Iteratively generates problem statements, methods, and experiment designs and refines them through simulated peer review.

## Key thesis
Quality ideation requires three things working together: (1) a structured retrieval substrate (graph + entity store), (2) an ideator agent, and (3) reviewer agents whose criteria are *empirically aligned* with how humans actually judge ideas. The alignment step is what makes the iterative refinement loop converge on novel-and-valid ideas.

## Key concepts
- **academic graph** — citation/concept graph over papers.
- **entity knowledge store** — mined cross-paper concepts.
- **human-aligned review prompts** — reviewer rubrics calibrated against human judgments.
- **iterative refinement** — generate → review → refine loop.

## Why it matters for ai-ideator
**Canonical reference for the ai-ideator architecture.** The structure (graph + entity store + ideator + critics) is exactly what the project's roadmap describes for Phase 1–3. The key engineering insight to steal: don't write critic prompts from intuition; calibrate them against human judgments before deploying.

## Memorable findings
> "Aligning the LLM reviewer's evaluation criteria to actual human judgments was the key step that made the iterative refinement loop converge on novel-and-valid ideas."

## Connections
- **Predecessors:** [si-2024-can-llms-generate-novel-ideas](si-2024-can-llms-generate-novel-ideas.md)
- **Descendants:** [chain-of-ideas](chain-of-ideas.md), [scideator](scideator.md), [ideasynth](ideasynth.md)

## Sources
1. [arxiv:2404.07738](https://arxiv.org/abs/2404.07738) (retrieved 2026-04-30)
