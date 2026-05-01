---
title: "Tree of Thoughts: Deliberate Problem Solving with Large Language Models"
authors: "Yao, Shunyu; Yu, Dian; Zhao, Jeffrey; Shafran, Izhak; Griffiths, Thomas L.; Cao, Yuan; Narasimhan, Karthik"
year: 2023
type: primary
domain: agentic-ideation
tier: T1
canonical_url: "https://arxiv.org/abs/2305.10601"
retrieved: 2026-04-30
key_concepts:
  - tree search over thoughts
  - self-evaluation as heuristic
  - BFS/DFS over reasoning states
  - lookahead and backtracking
related_articles:
  - agentic-ideation/graph-of-thoughts
  - agentic-ideation/self-refine
status: draft
---

## TL;DR
Generalizes Chain-of-Thought into a search tree: at each step, the LM proposes K candidate **thoughts**, a value/voter prompt scores each, and BFS/DFS explores the tree. **Game of 24: GPT-4 with CoT solves 4%; with ToT, 74%.** Includes a Creative Writing task showing the same gain on open-ended generation.

## Key thesis
Reasoning is search. CoT samples one path; ToT explores many. The combination of *generation* (propose K thoughts) + *evaluation* (value prompt) + *search algorithm* (BFS/DFS/beam) + *backtracking* converts an LLM from a one-shot generator into a deliberate problem-solver.

## Key concepts
- **thought** — an intermediate step in solving a problem; nodes in the search tree.
- **value prompt** — LLM scores each thought to decide what to expand.
- **search algorithm** — BFS / DFS / beam over the thought tree.
- **backtracking** — the LLM can abandon a branch and return to an earlier node.

## Applicable pattern
At each node prompt for K candidate next-steps; score each with a value prompt; expand best with BFS/DFS/beam. Backtracking is core — LLM can abandon a branch.

## Why it matters for ai-ideator
**Core scaffold for any agentic ideation system:** ideation IS combinatorial search. Map business-idea space as a tree: root = problem space, level 1 = customer segments, level 2 = value props, level 3 = monetization. At each level expand K candidates, score with a critic, prune. Yields a *portfolio* of ideas with explicit reasoning paths — much more defensible than flat sampling.

## Memorable findings
> "On Game of 24, GPT-4 with CoT solves 4%; with ToT it jumps to 74% — search structure matters more than the model."

## Connections
- **Descendants:** [graph-of-thoughts](graph-of-thoughts.md)
- **Companions:** [self-refine](self-refine.md), [reflexion](reflexion.md)

## Sources
1. [arxiv:2305.10601](https://arxiv.org/abs/2305.10601) (retrieved 2026-04-30)
