# Combinatorial Creativity — The Concept Behind ai-ideator

## One sentence

**New ideas are combinations of existing ideas, and the question worth asking is which combinations are surprising, useful, and true.**

## The lineage in one paragraph

The thesis dates to **David Hume**, *A Treatise of Human Nature* (1739, Book I, Part I, §IV): there are three principles by which the mind connects ideas — **resemblance, contiguity in time/place, and cause-and-effect**. Locke had already used the phrase "association of ideas" (1690, *Essay* II.XXXIII), but Hume made it the engine of cognition itself. Across the next two centuries the **British associationists** (Hartley, James Mill, J. S. Mill, Bain) elaborated it into a quasi-mechanical theory of mind. **Henri Poincaré** (1908) rephrased it as a creative process: the unconscious shuffles ideas; the conscious mind selects the harmonious combinations. **Graham Wallas** (1926) gave us the four-stage model — *preparation, incubation, illumination, verification* — that still anchors creativity research. **Arthur Koestler** (*The Act of Creation*, 1964) coined **"bisociation"**: the sudden coupling of two normally separate "matrices of thought." **Sarnoff Mednick** (1962) gave it an empirical handle with the Remote Associates Test and the hypothesis that creative people have *flatter associative hierarchies*. **Margaret Boden** (*The Creative Mind*, 1990) packaged the modern AI-relevant taxonomy: **combinational, exploratory, transformational** creativity. **Fauconnier & Turner** (1998, 2002) provided the cognitive mechanism — **conceptual blending** — describing how mental spaces project into a blended space with emergent structure absent from either input.

That is the substrate. Everything ai-ideator does is a computational implementation of that lineage, with LLMs as the engine.

## Why combinatorial creativity is the right frame for LLMs

LLMs are trained to predict probable continuations from a vast corpus. Two consequences:
1. **They have read the inputs** — every paper, every patent, every business model description in the training set. The "concepts" we want to combine already exist as latent representations.
2. **They regress to the mean.** Left to their own devices they reproduce the most probable continuation, which is by definition the least novel. They are weak at *unprompted* divergence.

Combinatorial creativity is the discipline that compensates for weakness #2. Instead of asking the LLM "give me a novel idea" (which yields cliché), we:
- Retrieve two or more **specific concepts** from a curated base.
- Force the model to *project both inputs into a shared blended space* (Fauconnier & Turner).
- Apply Boden's three operations selectively: combine first, then explore the combined space, then transform constraints if the combination is sterile.
- Evaluate with explicit criteria — **novelty, utility, surprise** — not vibes.

This is structurally what the recent literature (Si et al. 2024 on LLM research ideation, Liang et al. 2023 on multi-agent debate, the bisociation-with-LLMs work referenced in arxiv:2509.21043) is converging on.

## The three operations (Boden's taxonomy, mapped to our system)

| Boden's type | What it does | What it looks like in ai-ideator |
|---|---|---|
| **Combinational** | Combines familiar ideas in unfamiliar ways. The Hume/Koestler engine. | Retrieve two concepts → blend → output candidate idea. The default loop. |
| **Exploratory** | Searches within an existing conceptual space (genre, paradigm). | Given a blended idea, generate variations along its dimensions. The "what else could this be" loop. |
| **Transformational** | Changes the rules of the space itself. Rare, deep. | Identify a constraint baked into the space and drop it. The "what if X were not required" loop. |

Most of the value is in #1, executed well. #2 and #3 amplify it.

## Three mechanisms we will lean on

1. **Conceptual blending** (Fauconnier & Turner) — the cognitive substrate. Two **input spaces** share structure with a **generic space** and project into a **blended space** that may contain **emergent structure** absent from either input. This is the mathematical shape of the operation, and it maps cleanly onto a structured LLM prompt.
2. **Bisociation** (Koestler) — the *humor/insight/discovery* trinity. A bisociation succeeds when the same situation is intelligible in two normally unrelated frames. Our novelty heuristic borrows this: the more disjoint the source frames *while remaining mutually intelligible*, the higher the bisociative score.
3. **Remote associates** (Mednick) — the empirical operationalization. Creative thinkers have flatter associative hierarchies → they reach distant nodes faster. Our retrieval layer should *sometimes* sample distant rather than nearest concepts.

## What "an idea" means in this system

A candidate **idea** is a structured object, not free text:

```yaml
inputs:                     # the concepts being combined
  - concept_id: ...
    source: kb/wiki/...
  - concept_id: ...
    source: kb/wiki/...
generic_space:              # what they share (the abstraction)
  - ...
blend:
  emergent_structure: ...   # what's true of the blend that wasn't true of either input
  business_form: ...        # the concrete proposal in business terms
evaluation:
  novelty: 0..1
  utility: 0..1
  surprise: 0..1
  feasibility: 0..1
provenance:                 # full chain for reproducibility
  retrieved_via: ...
  blended_by: ...
  evaluated_by: ...
```

Free-form ideas are not the artifact. **Structured, traceable blends with explicit provenance** are.

## What we are not doing

- **Not** "ChatGPT for business ideas." That's the failure mode — undifferentiated suggestions, no provenance, no concept of distance or surprise.
- **Not** a brainstorming app. Brainstorming is human-time-bounded; this is a research-grade ideation engine that can spend 1000 LLM calls on a single deep blend.
- **Not** a benchmark-chaser. We measure novelty/utility/surprise on our own evaluation harness, defined against the academic literature in `kb/`.

## Required reading before contributing

In order:
1. `kb/wiki/foundational-philosophy/hume-treatise-association-of-ideas.md` (when written)
2. `kb/wiki/foundational-philosophy/koestler-bisociation.md`
3. `kb/wiki/computational-creativity/boden-three-types.md`
4. `kb/wiki/computational-creativity/fauconnier-turner-conceptual-blending.md`
5. `kb/wiki/llm-creativity/` — at least the T1 entries.

After that, you can argue with me about the design.
