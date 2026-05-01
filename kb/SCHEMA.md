# Knowledge Base Schema

> The contract for every wiki article. If your article doesn't match this, it doesn't go in.

## Article filename

`kb/wiki/<domain>/<slug>.md`

`<slug>` is lowercase, hyphenated, and starts with the **author surname** for primary-source articles or the **concept name** for cross-cutting concept articles.

Examples:
- `kb/wiki/foundational-philosophy/hume-treatise-association-of-ideas.md`
- `kb/wiki/computational-creativity/boden-three-types-of-creativity.md`
- `kb/wiki/combinatorial-creativity/conceptual-blending.md` *(concept article)*
- `kb/wiki/llm-creativity/si-2024-can-llms-generate-novel-research-ideas.md`

## Frontmatter (required)

```yaml
---
title: "Verbatim title of the work, or canonical concept name"
authors: "Last, First; Last, First"        # omit for concept articles
year: 1739                                  # primary publication year; null for concept articles
type: primary | concept | survey | framework | tool
domain: foundational-philosophy | computational-creativity | combinatorial-creativity | llm-creativity | agentic-ideation | gastritis-foundations | gastritis-conventional | gastritis-traditional | gastritis-alternative | gastritis-integrative
tier: T1 | T2 | T3
paradigm: conventional | tcm | kampo | ayurveda | unani | greco-roman | naturopathy | functional | homeopathy | folk | integrative  # gastritis domains only
era: ancient | classical | pre-modern | modern | contemporary  # gastritis domains only; ancient (<500 CE), classical (500–1800), pre-modern (1800–1980), modern (1980–2010), contemporary (2010+)
evidence_level: meta-analysis | rct | cohort | case-series | in-vitro | in-vivo-animal | case-report | expert-opinion | traditional-use | anecdotal  # gastritis domains only
canonical_url: "https://..."                # DOI, arxiv, plato.stanford.edu, gutenberg.org, …
retrieved: 2026-04-30                       # date the URL was last verified
key_concepts:
  - association of ideas
  - resemblance
  - contiguity
related_articles:
  - foundational-philosophy/locke-association
  - computational-creativity/boden-three-types
status: stub | draft | reviewed
---
```

**Tier guidance** — be honest:
- **T1**: Foundational. Anyone working on combinatorial creativity must know this. ~10–15 entries per domain max.
- **T2**: Important context. Read after T1.
- **T3**: Supporting / completist. Indexed but not required reading.

## Body

Articles use this section order. Section headings are exact (`##`-level). Omit a section only if the section truly does not apply (e.g., concept articles have no "abstract").

### `## TL;DR`
2–4 sentences. The thesis a reader gets if they read nothing else.

### `## Abstract` *(primary sources only)*
The author's abstract verbatim, OR a faithful 5–8 sentence paraphrase if no abstract exists. Mark paraphrases.

### `## Key thesis`
1 paragraph. The argument or contribution in the author's own framing.

### `## Key concepts`
Bulleted glossary. Each bullet: `**term** — one-line definition`. These mirror the `key_concepts:` frontmatter and are what future agents will retrieve over.

### `## Why it matters for ai-ideator`
2–4 sentences. Specifically: how does this constrain or enable a system that combines KB concepts into business ideas? Be concrete. "It's interesting" is not sufficient.

### `## Memorable passages`
Quoted material with citations. Page numbers if available. Mark every quote.

### `## Connections`
Bulleted list of cross-references inside the KB:
- **Predecessors**: `[hume-treatise](../foundational-philosophy/hume-treatise.md)` — what this work builds on
- **Descendants**: `[boden-three-types](../computational-creativity/boden-three-types.md)` — what builds on this
- **Contrasts**: `[some-article](...)` — competing or contradicting view

### `## Sources`
1. `[Source: raw/<domain>/<file>]` — local copy of source material if we have one
2. Canonical URL (verified, with retrieval date)
3. Secondary references (Stanford Encyclopedia of Philosophy entries, well-cited reviews)

## Connections rules

- Use **relative links** within `kb/wiki/` so the wiki is portable.
- Every T1 article has at least one connection in each direction (predecessor + descendant) when applicable.
- A "concept article" (e.g. `conceptual-blending.md`) lives in the `combinatorial-creativity/` domain (the cross-cutting domain) and links *out* to every primary source that develops it.

## Contradictions

When a new source contradicts existing wiki content, do **not** silently update. Add a block to the affected article(s):

```markdown
## Contradiction
- **Claim in this article:** ...
- **Counterclaim:** ... [Source: kb/wiki/<domain>/<other>.md]
- **Status:** unresolved | resolved-in-favor-of-X
- **Logged:** YYYY-MM-DD
```

The user adjudicates contradictions; the agent flags them.

## Index files

Every domain has `kb/wiki/<domain>/INDEX.md`. Format:

```markdown
# <Domain Name> — Index

> 1–2 sentence scope description.

Last updated: YYYY-MM-DD
Articles: N

## T1 — Foundational

| Article | Authors | Year | Summary |
|---|---|---|---|
| [hume-treatise](hume-treatise.md) | Hume | 1739 | Three principles of association: resemblance, contiguity, cause-effect. |

## T2 — Important context
...

## T3 — Supporting
...

## Concept index

| Concept | Article(s) |
|---|---|
| Bisociation | [koestler-act-of-creation](koestler-act-of-creation.md) |
```

## Logging

Every ingest, edit, or rename is logged to `kb/LOG.md`:

```markdown
## YYYY-MM-DD HH:MM | <ACTION> | <actor>
Article: <path>
Notes: <one line>
```

Actions: `INGEST | EDIT | RENAME | DELETE | DOMAIN-CREATE | CONTRADICTION-FLAG | INDEX-REBUILD`.

## Stub articles

It is acceptable to create a stub for a known-important work we haven't fully processed yet. Stubs:
- Have `status: stub` in frontmatter
- Have at minimum: title, authors, year, canonical_url, TL;DR, and Sources sections
- Are listed in their domain INDEX with `[stub]` in the Summary column
- Are tracked for completion (the indexes count stubs separately)
