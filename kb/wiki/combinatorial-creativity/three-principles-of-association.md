---
title: "Hume's Three Principles of Association"
authors: null
year: null
type: concept
domain: combinatorial-creativity
tier: T1
canonical_url: null
retrieved: 2026-04-30
key_concepts:
  - resemblance
  - contiguity
  - cause and effect
  - retrieval operators
related_articles:
  - foundational-philosophy/hume-treatise-association-of-ideas
  - foundational-philosophy/hume-enquiry-association
status: draft
---

## TL;DR
Hume (1739; restated 1748) named **three** — and only three — principles by which the imagination spontaneously moves between ideas:
1. **Resemblance** — moving from an idea to one that is similar.
2. **Contiguity** — moving from an idea to one that was near it in space/time.
3. **Cause and Effect** — moving from cause-idea to effect-idea or vice versa.

These three principles map directly onto the retrieval operators of an LLM ideation pipeline.

## The three operators in modern computational terms

| Hume's principle | Cognitive form | Computational analogue | When to use |
|---|---|---|---|
| **Resemblance** | A reminds me of B because they share features. | Embedding-similarity (cosine on dense vectors). | Exploratory work; "more like this" requests. |
| **Contiguity** | A reminds me of B because they appeared together. | Co-occurrence retrieval; graph adjacency. | Context-driven retrieval; "what else was around when X happened?" |
| **Cause and Effect** | A reminds me of B because A leads to B. | Causal-graph retrieval; if-then chain following. | Mechanism reasoning; "what would happen if X?" |

Most LLM retrieval stacks implement only **resemblance** and call it done. ai-ideator should support all three, with the prompt explicitly choosing the operator (or sampling among them):

```python
def retrieve(query, mode: Literal["resemblance", "contiguity", "causation"]):
    if mode == "resemblance":
        return embedding_top_k(query)
    elif mode == "contiguity":
        return graph_neighbors_in_co_occurrence_graph(query)
    elif mode == "causation":
        return follow_causal_edges(query)
```

Different operators yield different blend types. A **resemblance pair** plus a **causation pair** as inputs to a blender is much more productive than two resemblance pairs.

## Why this matters historically
This is a 300-year-old taxonomy that has survived because it carves the space at the joints. Implementing one operator is impoverished retrieval; implementing all three gives the LLM ideator the same diversity of associative routes Hume attributed to human imagination.

## Related concepts
- **conceptual blending** — given inputs from these operators, blending is the next step.
- **remote associates** ([Mednick](../foundational-philosophy/mednick-associative-basis.md)) — distance along *any* of the three operators is the variable Mednick studied.

## Sources
1. [Hume 1739 — Treatise of Human Nature](../foundational-philosophy/hume-treatise-association-of-ideas.md)
2. [Hume 1748 — Enquiry Concerning Human Understanding](../foundational-philosophy/hume-enquiry-association.md)
3. [SEP — Associationist Theories of Thought](https://plato.stanford.edu/entries/associationist-thought/)
