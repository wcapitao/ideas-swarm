# ai-ideator — Cloudflare Worker (`agent/`)

Single **Workers + Durable Object** deployment: **`IdeatorAgent`** extends **`AIChatAgent`**. Loads gastritis **`PaperAnalysis`** JSON from **`kb/raw/gastritis/`**, selects distant pairs, generates idea cards (**DeepSeek** via **AI Gateway**), validates with Zod, runs an **inline adversarial eval** (`src/evaluator.ts`), emits markdown, and streams it for chat persistence.

## Commands

```bash
cd agent
npm install
npm test
npm run typecheck
npm run dev      # wrangler dev
npm run deploy   # wrangler deploy — not triggered by git push unless you wire CI separately
```

## Secrets & vars

Configured in **`wrangler.jsonc`** as plain **`vars`** where safe. Set secrets for your account (minimum needed by `src/index.ts` **`Env`**):

- **`DEEPSEEK_API_KEY`**
- **`CLOUDFLARE_ACCOUNT_ID`** (used in Gateway URL composition in code)

Ensure **AI Gateway** id matches (**`AIG_GATEWAY_ID`**, default **`ai-ideator`** in `vars`) and the Gateway routes to DeepSeek.

Use `.dev.vars` locally for Wrangler (**do not commit** secrets).

## Source map

| File | Role |
|------|------|
| `src/index.ts` | **`routeAgentRequest`**, exports `IdeatorAgent` |
| `src/ideator-agent.ts` | DO — pair selection → ideas → evals → markdown → `streamText` |
| `src/evaluator.ts` | Adversarial **`generateText`** + **`EvalResult`** parsing |
| `src/papers.ts` | Bundled corpus imports |
| `src/paper-selector.ts` | Jaccard pair selection |
| `src/prompt.ts` | Combinatorial idea prompts |

Authoritative MVP write-up: **`docs/superpowers/specs/2026-05-01-mvp-ideator-design.md`**.  
North-star architecture: **`docs/architecture/agentic-ideation-system.md`**.
