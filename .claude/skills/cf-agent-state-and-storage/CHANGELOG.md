# cf-agent-state-and-storage — changelog

## 0.1.0 — 2026-04-30

Initial draft. Synthesized from the seven Cloudflare research briefs in `/home/athena/ai-ideator/docs/research/`.

- 5-tier storage decision (setState / sql / ctx.storage / Vectorize / R2-KV-D1)
- "Three APIs on one DO" — sync KV, async KV, SQL
- Hibernation survival matrix
- Five migration recipes with full `wrangler.jsonc` blocks
- Secret vs state taxonomy (the never-broadcast rule)
- Embedding storage decision (Vectorize ↔ DO SQL)
- `validate-do-state-shape.ts` — Zod ↔ SQLite drift check
- `migration-lint.sh` — `wrangler.jsonc migrations[]` linter
