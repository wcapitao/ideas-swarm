---
title: "AutoTRIZ: Automating Engineering Innovation with TRIZ and Large Language Models"
authors: "Jiang, Shuo; Li, Weifeng; Qian, Yuping; Zhang, Yangjun; Luo, Jianxi"
year: 2024
type: primary
domain: agentic-ideation
tier: T2
canonical_url: "https://arxiv.org/abs/2403.13002"
retrieved: 2026-04-30
key_concepts:
  - TRIZ inventive principles
  - contradiction matrix
  - structured-method-as-pipeline
related_articles:
  - llm-creativity/cooking-up-creativity
status: draft
---

## TL;DR
Encodes TRIZ's structured inventive-problem-solving methodology (40 inventive principles, contradiction matrix, ideality) as an LLM workflow. From a problem statement, the system identifies engineering contradictions, retrieves applicable inventive principles, and generates a solution report following TRIZ reasoning. Companions: TRIZ-GPT (arxiv:2408.05897) and TRIZ Agents (arxiv:2506.18783).

## Key thesis
A domain-expert framework (TRIZ, JTBD, Lean Canvas, Business Model Canvas) provides scaffolding the LLM lacks. Encoding it as a deterministic pipeline where each stage is an LLM call with one narrow responsibility outperforms unstructured prompts.

## Applicable pattern
Encode a domain-expert framework as a multi-stage pipeline: each stage is one narrow LLM call (e.g., 'identify contradiction', 'select principle', 'instantiate solution'). The framework provides scaffolding the LLM lacks.

## Why it matters for ai-ideator
TRIZ's 40 inventive principles map directly to business model patterns ('segment a service', 'invert the customer/supplier relationship', 'merge with adjacent industry'). ai-ideator could implement a 'business TRIZ' agent that, given a stale industry, identifies its contradiction (e.g., 'high-touch but unscalable') and retrieves the principle ('automate the human ritual') to propose recombined ideas. **The structured-method-as-pipeline pattern is reusable for any business-ideation framework.**

## Connections
- **Companions:** [cooking-up-creativity](../llm-creativity/cooking-up-creativity.md) — also argues for structured intermediates.

## Sources
1. [arxiv:2403.13002](https://arxiv.org/abs/2403.13002) (retrieved 2026-04-30)
