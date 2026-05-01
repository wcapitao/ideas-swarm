---
title: "The AI Scientist: Towards Fully Automated Open-Ended Scientific Discovery"
authors: "Lu, Chris; Lu, Cong; Lange, Robert Tjarko; Foerster, Jakob; Clune, Jeff; Ha, David"
year: 2024
type: primary
domain: llm-creativity
tier: T1
canonical_url: "https://arxiv.org/abs/2408.06292"
retrieved: 2026-04-30
key_concepts:
  - end-to-end ideation→experiment→writeup→review
  - automated peer-review LLM
  - novelty filtering against literature
related_articles:
  - llm-creativity/agent-laboratory
  - llm-creativity/dolphin
status: draft
---

## TL;DR
End-to-end pipeline that ideates, codes, runs experiments, visualizes, writes a paper, and runs automated peer review. Three ML subfields tested. Less than $15 per paper. Some outputs cleared the acceptance threshold of an automated reviewer trained near-human accuracy.

## Key thesis
Closing the entire scientific loop autonomously is technically possible at low cost. The bottleneck is no longer compute or model capability — it's truthful novelty assessment and feasibility prediction. The system fails most often by generating ideas that look novel but turn out to be variations of existing work or experimentally infeasible.

## Key concepts
- **closed-loop pipeline** — ideation, code, experiments, writeup, review.
- **automated peer-review LLM** — judge trained to approximate human review.
- **novelty filter against literature** — search-and-compare to flag derivative ideas.

## Why it matters for ai-ideator
Reference architecture for what "closing the loop" looks like end-to-end. Important to study because (a) it works, (b) it has well-documented failure modes — poor novelty assessment, ~42% experiment failure rate per the literature critique — that any successor system has to address. ai-ideator should learn from AI Scientist's *gaps* as much as from its successes.

## Memorable findings
> "An autonomous LLM agent can produce a full ML paper for under $15 — the bottleneck is no longer cost, it's truthful novelty assessment."

## Connections
- **Companions:** [agent-laboratory](agent-laboratory.md), [dolphin](dolphin.md)

## Sources
1. [arxiv:2408.06292](https://arxiv.org/abs/2408.06292) (retrieved 2026-04-30)
