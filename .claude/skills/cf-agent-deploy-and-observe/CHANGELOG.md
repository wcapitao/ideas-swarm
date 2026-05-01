# Changelog

All notable changes to the **cf-agent-deploy-and-observe** skill are documented here.

## [1.0.0] - 2026-04-30

### Added
- Initial SKILL.md with the reference wrangler.jsonc, migrations cookbook,
  local dev fakery matrix, 15-command cheatsheet, 5 logging surfaces,
  secrets two-step + rotation runbook, CI/CD recipe, 20-line production
  checklist, short-form pricing, 16 gotchas, hand-offs.
- `references/wrangler-reference.md` — annotated wrangler.jsonc, every line explained.
- `references/migrations-cookbook.md` — add / rename / delete / transfer DO classes.
- `references/wrangler-cheatsheet.md` — 15 commands with concrete examples.
- `references/logs-and-tracing.md` — the 5 surfaces compared with code samples.
- `references/secrets.md` — vars vs secret put, Secrets Store, rotation.
- `references/ci-cd.md` — full GitHub Actions deploy.yml + branch-to-env mapping.
- `references/prod-checklist.md` — 20 items with rationale.
- `references/limits-and-pricing.md` — 24-row table.
- `scripts/wrangler-doctor.sh` — wrangler.jsonc sanity check.
- `scripts/verify-deploy.sh` — post-deploy smoke test.
- `scripts/cost-tracker.ts` — Analytics Engine + AIG cost roll-up.
