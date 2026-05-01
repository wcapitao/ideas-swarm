# MVP Ideator Agent — Design Spec

**Date:** 2026-05-01  
**Status:** Approved (updated 2026-05-01 — adversarial eval pass)  
**Scope:** Replaces multi-phase architecture for MVP. Full plan preserved in `docs/architecture/agentic-ideation-system.md` for later.

## Mission

A single Cloudflare Workers **Durable Object** — **`IdeatorAgent`** (`AIChatAgent`) — takes a user's problem or topic, selects maximally distant paper pairs from a pre-seeded corpus, generates structured idea cards (**parallel DeepSeek calls**), runs a **parallel adversarial evaluation pass** per validated card (evidence gaps, safety flags, adjusted scores), composes **one markdown document**, then **streams** it through the Agents chat pipeline so `AIChatAgent` persists the assistant message correctly.

There is **one** exported agent class (`IdeatorAgent`); evaluation is **`agent/src/evaluator.ts`** (prompts + `generateText`), not a second DO — see **`docs/architecture/agentic-ideation-system.md`** for the eventual multi-agent council.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime | Cloudflare Workers + Durable Objects | Aligns with full architecture direction |
| Agent pattern | Single `AIChatAgent` DO | No multi-DO coordination for MVP; eval is an extra **`generateText` batch** in-process |
| Paper source | `PaperAnalysis` JSON imported from **`kb/raw/gastritis/`** (bundled build) | Real corpus; avoids duplicating blobs under `agent/data/` |
| Paper selection | Maximally distant pairs (Jaccard on tags + primary category + domain) | Forces cross-domain bisociation |
| LLM | DeepSeek via **AI Gateway** (`@ai-sdk/openai-compatible` + `ai` package) | Single provider; logging / rate limits at the edge |
| Frontend | Intended: `agents/react` + **`useAgentChat`** over WebSocket | Chat UI deps present; **`agent/public`** is placeholders until SPA is wired |
| Idea output | `IdeaCard` — novelty / feasibility / impact self-scores (1–10) | Generator's first-pass judgment |
| Eval output | `EvalResult` — gaps, flags, **`adjusted_scores`**, **confidence**, one-liner | Second-pass stress-test; **`### Evaluation`** in markdown |
| Phase 4 | **Out of scope** | No EvaluatorCouncil, no golden harness, no multi-judge consensus — MVP only surfaces one critic prompt |
| Auth | None | MVP, public access |
| Conversation state | Stateless per logical request | Persistent **chat transcripts** remain an `AIChatAgent` concern |

## Data Layer

### Paper Corpus

Pre-analyzed paper JSON follows **`PaperAnalysis`** in `agent/src/schema.ts` (see `docs/architecture/paper-analysis-schema.json`).

**Loader:** `agent/src/papers.ts` statically imports ten diverse gastritis **`kb/raw/gastritis/*.json`** files. The corpus is cached in module scope after first `loadPapers()`.

### Paper Selection Algorithm

1. Build a feature set per paper: union of **`tags`** + **`categories.primary`** + **`classification.domain`**.
2. Compute pairwise **Jaccard distance**: `1 - |A ∩ B| / |A ∪ B|`.
3. Greedily select up to four high-distance pairs, each paper at most twice.

Pure code — **Stella Principle** (no LLM).

## Agent Architecture

```
User (browser)
  ↔ WebSocket (target: useAgentChat → AIChatAgent)
IdeatorAgent (single AIChatAgent DO)
  onChatMessage
    1. Extract topic from last user message
    2. loadPapers(); selectPairs()  — deterministic
    3. Parallel generateText × N — idea JSON per pair (idea system + buildIdeaPrompt)
    4. Parse + IdeaCardSchema.safeParse — drop malformed
    5. Parallel generateText × M (one per valid card) — adversarial eval (evaluator.ts)
    6. buildFinalDocument — markdown for all cards (+ optional ### Evaluation)
    7. streamText — system “reproduce verbatim”; onFinish → framework persistence
```

No D1 / KV / R2 for ideation data in MVP. SQLite DO storage is **Agents SDK** default for chat state, not idea KB.

### Why `streamText` at the end

`generateText` is required to obtain **complete JSON** before Zod validation. The final **`streamText`** step replays pre-built markdown token-by-token so **`AIChatAgent`**'s `onFinish` path matches hook expectations (`ai` v4/v6 bridging is handled with a narrow cast in `ideator-agent.ts`).

## Idea generation (combiner pass)

Same as before: user topic plus both papers’ topic, tags, novelty, open problems, applicability.

### LLM output — `IdeaCard`

```typescript
{
  title: string;
  paper_a: { id: string; insight: string };
  paper_b: { id: string; insight: string };
  combined_idea: string;
  why_novel: string;
  potential_applications: string[]; // 1–3 items
  scores: { novelty: number; feasibility: number; impact: number }; // 1–10 ints
}
```

Validated with **`IdeaCardSchema`**. Prompt builders: **`buildSystemPrompt`** (system) and **`buildIdeaPrompt`** (per pair) in **`prompt.ts`**.

## Evaluation pass (single-critic MVP)

Implemented in **`agent/src/evaluator.ts`**:

- **`buildEvalSystemPrompt` / `buildEvalPrompt`** — medical evidence skeptic; insists on **`adjusted_scores`** that reflect evidence, not unchecked copy-paste of self-scores when unsupported.
- **`parseEvalResult`** — unwrap responses wrapped in fenced **json** code blocks when present; then regex JSON object extraction + **`EvalResultSchema.safeParse`**.
- **`evaluateIdea(card, env, { abortSignal })`** — one **`generateText`** (cap 512 completion tokens).

### `EvalResult` shape

```typescript
{
  evidence_gaps: string[];
  safety_flags: string[];
  adjusted_scores: {
    novelty: number; feasibility: number; impact: number; // 1–10 ints
  };
  confidence: "promising" | "needs_validation" | "risky";
  one_liner: string;
}
```

On parse failure **`evaluateIdea`** returns **`null`** and **`### Evaluation`** is **omitted** for that card (no synthetic fallback).

## Frontend (target)

Minimal chat UX when connected:

- Input bar + scrollable markdown / card rendering produced by **`formatIdeaCard`** (scores, then evaluation block with verdict emoji and **↑ / ↓ / (= n)** deltas vs self-scores).
- Loading UX is downstream of **`useAgentChat`**; MVP backend returns **one** streamed assistant blob per user turn (not four independent partial messages).

## Project structure (current)

```
agent/
├── src/
│   ├── index.ts              # Worker fetch — routeAgentRequest<Env>
│   ├── ideator-agent.ts      # IdeatorAgent DO — full orchestration + markdown
│   ├── evaluator.ts          # Adversarial eval prompts + generateText + parse
│   ├── papers.ts             # kb/raw/gastritis imports + PaperAnalysis cache
│   ├── paper-selector.ts     # Jaccard + greedy pairs
│   ├── prompt.ts             # Idea generation prompts
│   └── schema.ts             # Zod: PaperAnalysis, IdeaCard, EvalResult
├── public/                   # Static assets (Worker `assets.directory`)
├── test/
│   ├── schema.test.ts
│   ├── paper-selector.test.ts
│   ├── prompt.test.ts
│   ├── evaluator.test.ts
│   └── index.test.ts
├── migrations/               # DO SQLite (Agents)
├── wrangler.jsonc
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── biome.json
```

## Dependencies (notable)

| Package | Purpose |
|---------|---------|
| `agents` | `AIChatAgent`, `routeAgentRequest`, WebSocket chat |
| `ai` | `generateText`, `streamText` |
| `@ai-sdk/openai-compatible` | DeepSeek through AI Gateway base URL |
| `zod` | `IdeaCard`, `EvalResult`, `PaperAnalysis` |
| `vitest` + `@cloudflare/vitest-pool-workers` | Tests |
| `biome` | Lint/format |
| `wrangler` | Dev / deploy |

## What this is still not

- Not multi-turn “session ideation UX” scoped for product — each **generation burst** follows the scripted pipeline above; chat transcripts may persist via `AIChatAgent`.
- Not **ARCH‑001**: no ConceptForge, EvaluatorCouncil, GoalSession split, Neo4j, Vectorize retrieval.
- Not **Phase 4** scoring rigor — one **LLM critic**, no council, no harness.
- Not production hardening beyond AI Gateway retries / basic error swallow in eval try/catch.

The north star stays **`docs/architecture/agentic-ideation-system.md`**. MVP proves: distant pairs → structured blends → visible second opinion on scores.
