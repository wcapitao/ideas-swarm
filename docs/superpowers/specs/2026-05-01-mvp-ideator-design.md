# MVP Ideator Agent — Design Spec

**Date:** 2026-05-01
**Status:** Approved
**Scope:** Replaces multi-phase architecture for MVP. Full plan preserved in `docs/architecture/agentic-ideation-system.md` for later.

## Mission

A single Cloudflare Workers agent that takes a user's problem or topic, selects 4 maximally-distant pairs of arXiv papers from a pre-seeded corpus, and generates 4 novel ideas by combining insights from each pair. Ideas are streamed to a chat UI as structured cards with self-scores.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime | Cloudflare Workers + Durable Objects | Aligns with full architecture direction |
| Agent pattern | Single `AIChatAgent` DO, parallel LLM calls | Fast, simple — no multi-DO coordination for MVP |
| Paper source | Pre-analyzed JSONs bundled as static assets | Offline analysis via existing Python pipeline, agent only consumes |
| Paper selection | Maximally distant pairs (Jaccard distance on tags/categories/domain) | Forces cross-domain bisociation |
| LLM | DeepSeek via AI Gateway | Single provider, key already available |
| Frontend | `agents/react` chat UI with `useAgentChat` | WebSocket + hibernation, matches full architecture |
| Output format | Structured idea cards with novelty/feasibility/impact scores (1-10) | Previews Phase 4 evaluator |
| Auth | None | MVP, public access |
| Conversation state | Stateless — each request independent | No multi-turn follow-up for MVP |

## Data Layer

### Paper Corpus

Pre-analyzed paper JSONs stored at `agent/data/papers/`. Each file follows the `PaperAnalysis` schema (`docs/architecture/paper-analysis-schema.json`), produced offline by the Python analyzer pipeline (`scripts/analyze_papers.py` with MiniMax M2.7).

The agent loads the full corpus into memory on first request. Corpus is small enough (tens of papers for MVP) that this is fine.

### Paper Selection Algorithm

1. Build a feature set per paper: union of `tags` + `categories.primary` + `classification.domain`.
2. Compute pairwise Jaccard distance: `1 - |A ∩ B| / |A ∪ B|`.
3. Greedily select 4 pairs with highest distance, ensuring no paper appears in more than 2 pairs.

Minimum corpus size: 8 papers (to guarantee 4 pairs with no paper appearing more than twice). If the corpus is smaller, reduce the number of ideas proportionally.

This is pure math — no LLM involved (Stella Principle).

## Agent Architecture

```
User (browser)
  ↕ WebSocket (agents/react, useAgentChat)
IdeatorAgent (AIChatAgent DO)
  ├── onChatMessage(msg)
  │     1. Parse user request (topic/problem)
  │     2. Select 4 maximally-distant paper pairs
  │     3. Fire 4 parallel DeepSeek calls via AI Gateway
  │     4. Stream each idea card back as a chat message
  └── Paper corpus loaded in-memory from bundled JSON
```

No external storage (D1, KV, R2) for MVP. No authentication. No multi-turn state.

## Idea Generation

### LLM Input (per call)

The user's topic/problem, plus from both papers in the pair:
- `topic` (what/how/why_matters)
- `tags`
- `novelty` claims
- `open_problems`
- `applicability` (good_for/not_for/requires)

### LLM Output (per idea card)

```typescript
{
  title: string;
  paper_a: {
    id: string;       // arxiv:XXXX.XXXXvN
    insight: string;
  };
  paper_b: {
    id: string;
    insight: string;
  };
  combined_idea: string;
  why_novel: string;
  potential_applications: string[];  // 2-3 items
  scores: {
    novelty: number;      // 1-10
    feasibility: number;  // 1-10
    impact: number;       // 1-10
  };
}
```

Validated with Zod on the Worker side. One system prompt instructs DeepSeek as a combinatorial creativity engine. Per-call prompt injects the two papers' analysis data and the user's problem.

### Streaming

4 LLM calls fire in parallel via `Promise.all`. Each idea streams as a complete chat message once its call resolves. Cards appear out of order — whichever finishes first renders first. Frontend shows 4 skeleton placeholders during loading.

## Frontend

Minimal chat interface:
- `useAgentChat` hook over WebSocket with hibernation.
- Single page: input bar at bottom, idea cards above.
- Each card renders: title, paper insights (A & B), combined idea, why novel, applications list, 3 score badges.
- Cards appear one at a time as parallel calls resolve.
- Loading: 4 placeholder skeletons.
- Styling: Tailwind CSS. Clean, minimal. No navigation, no sidebar, no settings.

## Project Structure

```
agent/
├── src/
│   ├── index.ts              # Worker entrypoint, routes
│   ├── ideator-agent.ts      # IdeatorAgent (AIChatAgent DO)
│   ├── paper-selector.ts     # Jaccard distance, pair selection logic
│   ├── prompt.ts             # System prompt + per-call prompt builder
│   ├── schema.ts             # Zod schemas (idea card, paper analysis input)
│   └── types.ts              # Shared TypeScript types
├── data/
│   └── papers/               # Pre-analyzed paper JSONs
├── frontend/
│   ├── index.html
│   ├── App.tsx
│   └── styles.css
├── test/
│   ├── paper-selector.test.ts
│   ├── prompt.test.ts
│   └── schema.test.ts
├── wrangler.jsonc
├── package.json
├── tsconfig.json
└── biome.json
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `agents` | Cloudflare Agents SDK — AIChatAgent, WebSocket, hibernation |
| `zod` | LLM response validation |
| `react` + `react-dom` + `agents/react` | Frontend chat UI |
| `tailwindcss` | Styling |
| `vitest` + `@cloudflare/vitest-pool-workers` | Testing |
| `biome` | Lint/format |
| `wrangler` | Dev/deploy |

## What This Is Not

- Not multi-turn conversation — each request is independent.
- Not the full architecture — no ConceptForge, no EvaluatorCouncil, no GoalSession, no Neo4j graph, no Vectorize embeddings.
- Not authenticated — public access.
- Not production-grade — no observability, no SLOs, no failure recovery beyond AI Gateway retries.

The full architecture at `docs/architecture/agentic-ideation-system.md` remains the north star. This MVP validates the core loop: select papers, combine, generate ideas.
