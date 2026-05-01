# MVP Ideator Agent — Session Handoff

> **Stale / historical (2026-05-01+):** Describes a mid-build snapshot. **IdeatorAgent**, **`index.ts`**, **`evaluator.ts`**, and full tests have landed; task table below is **not** current. Use **`docs/superpowers/specs/2026-05-01-mvp-ideator-design.md`**, **`agent/README.md`**, and source as truth.

> **Date:** 2026-05-01
> **Branch:** `main` (worktree `feature/mvp-ideator-agent` was merged mid-session via PR #1)
> **Plan file:** `docs/superpowers/plans/2026-05-01-mvp-ideator-agent.md`
> **Workflow:** Subagent-Driven Development (skill: `superpowers:subagent-driven-development`)

---

## What's Done

| Task | Description | Status | Commit |
|------|-------------|--------|--------|
| Task 1 | Install deps, simplify wrangler.jsonc, update tsconfig | **Done** | `08f41f3` |
| Task 2 | Zod schemas (PaperAnalysis + IdeaCard) | **Done** | `2f5070b`, updated in `f78600b` |
| Task 3 | Paper selector (Jaccard distance + greedy pairs) | **Done** | `c5c9218` |
| Task 4 | Prompt builder (system + per-call) | **Done** | `a22f3a7` |
| Task 5 | Paper data + loader | **Done** | `f78600b` |
| Task 8 | Vitest config (Workers pool + `~` alias) | **Done** | `f21dad7` |

**16 tests passing** across 3 test files (`schema`, `paper-selector`, `prompt`). *(Current tree: 24+ tests including `evaluator`, `index`.)*

---

## What's Left _(superseded — see banner)_

Originally outstanding: Tasks 6–7 (Ideator **`DO`**, Worker **`index`**), verification, frontend. Those are **complete** in the current repo, plus **`src/evaluator.ts`** adversarial pass and **`evaluator.test.ts`**.

Do **not** use **`docs/superpowers/plans/2026-05-01-mvp-ideator-agent.md`** as an execution checklist without diffing against source.

---

## Key Decisions Made Mid-Session

1. **Gastritis papers instead of arXiv samples.** The plan originally had 10 hardcoded arXiv paper JSONs. We switched to loading 10 real papers from `kb/raw/gastritis/` (124 total in that directory). The schema was updated:
   - `paper_id` regex: `^(doi|pmid|text|isbn|arxiv):.+$` (was `arxiv:` only)
   - `tags` min: 4 (was 5)
   - Added `characteristics` array (measurement data per paper)
   - Added `_meta` object (analysis metadata)
   - `IdeaCardSchema` paper ID regex updated to match

2. **UI deferred.** Another developer will build the frontend. Task 7 should only create the Worker entrypoint with `routeAgentRequest` routing — no inline HTML.

3. **No `agent/data/papers/` directory.** Papers are imported directly from `../../kb/raw/gastritis/` via static JSON imports in `agent/src/papers.ts`.

4. **`agent/public/.gitkeep`** was added because `wrangler.jsonc` declares `assets.directory: "./public"` and the vitest Workers pool crashes without it.

---

## Files snapshot _(partial — see `agent/README.md`)_

Incremental mid-build listing only. Current tree adds **`ideator-agent.ts`**, **`index.ts`**, **`evaluator.ts`**, **`test/evaluator.test.ts`**, **`migrations/`**, and **`EvalResult`** in **`schema.ts`**.

---

## How to Continue _(historical)_

Prefer reading **`agent/README.md`** and running **`npm test`** locally. Archived prompt:

```bash
# In a new Claude Code session:
cd /home/athena/ai-ideator

# Resume using the plan:
# "Continue building docs/superpowers/plans/2026-05-01-mvp-ideator-agent.md with subagent-driven development. Tasks 1-5 and 8 are done. Start from Task 6 (IdeatorAgent DO). UI is deferred — Task 7 is routing only."
```

---

## Notes for Task 6 Implementation _(historical)_

The `ideator-agent.ts` from the plan needs one update: the `IdeaCardSchema` paper IDs now use `doi:`/`pmid:`/`text:`/`isbn:` formats, not `arxiv:`. The plan's code should work as-is since the regex was updated in the schema, but verify the DeepSeek prompt instructs the LLM to use the correct paper IDs from the input.

The 10 papers loaded by `papers.ts`:
- `marshall-warren-1984-curved-bacilli.json` (microbiology)
- `fellenius-1981-ppi-mechanism.json` (pharmacology)
- `cheney-1950-vitamin-u.json` (dietary therapy)
- `ford-2020-eradication-cancer-prevention.json` (cancer prevention)
- `nanjundaiah-2011-ginger-gastroprotection.json` (ethnopharmacology)
- `fasano-2020-zonulin-leaky-gut.json` (gut barrier biology)
- `he-2025-acupuncture-chronic-gastritis.json` (TCM)
- `park-2020-cheonwangbosim-dan-hpylori.json` (Korean herbal medicine)
- `sipponen-maaroos-2015-chronic-gastritis.json` (pathology classification)
- `tan-2000-voacanga-africana-anti-ulcer.json` (African ethnopharmacology)
