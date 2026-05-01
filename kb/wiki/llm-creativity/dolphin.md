---
title: "Dolphin: Moving Towards Closed-loop Auto-research through Thinking, Practice, and Feedback"
authors: "Yuan, Jiakang; Yan, Xiangchao; Feng, Shiyang; et al."
year: 2025
type: primary
domain: llm-creativity
tier: T2
canonical_url: "https://arxiv.org/abs/2501.03916"
retrieved: 2026-04-30
key_concepts:
  - execution-grounded ideation loop
  - exception-traceback-guided code repair
  - result-conditioned next-round generation
related_articles:
  - llm-creativity/si-2025-ideation-execution-gap
  - llm-creativity/ai-scientist
status: draft
---

## TL;DR
Closed-loop system that ideates → implements → debugs (using exception-traceback-guided code repair) → analyzes → feeds results back to next ideation cycle. Reaches SOTA-comparable performance on tasks like 3D point classification with continuous self-improvement.

## Key thesis
The ideation-execution gap (Si 2025) is closable if execution outcomes feed back into the next ideation round. Specifically: failed experiments produce tracebacks, which the next round of ideation can use to refine its proposals. This converts execution from a binary pass/fail signal into a rich gradient.

## Key concepts
- **execution-grounded ideation** — outcomes condition next-round generation.
- **traceback-guided repair** — exception messages used as diagnostic signal.

## Why it matters for ai-ideator
Directly addresses the ideation-execution gap. ai-ideator should design Phase 4's evaluator to *predict* feasibility risks at idea-time AND, when execution data is available, feed it back as conditioning signal. This is the closest analog to a true evolutionary ideation system in the current literature.

## Memorable findings
> "Conditioning the next round of ideation on the previous round's failed traceback closes a meaningful chunk of the ideation-execution gap."

## Connections
- **Predecessors:** [si-2025-ideation-execution-gap](si-2025-ideation-execution-gap.md)
- **Companions:** [ai-scientist](ai-scientist.md), [agent-laboratory](agent-laboratory.md)

## Sources
1. [arxiv:2501.03916](https://arxiv.org/abs/2501.03916) (retrieved 2026-04-30)
