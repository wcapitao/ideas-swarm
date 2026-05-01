# Changelog

All notable changes to the **cf-agent-auth-and-permissions** skill are documented here.

## [1.0.0] - 2026-04-30

### Added
- Initial SKILL.md: four auth postures, `OAuthProvider`-as-Worker-entrypoint, the grant flow,
  `this.props` vs `setState` rule with the broadcast-leak warning, scope design, secret hygiene,
  the 5-line production MCP server checklist, and 10 ranked footguns.
- `references/oauth-flows.md` — four `workers-oauth-provider` patterns side-by-side
  (Cloudflare Access, third-party IdP, BYO IdP, self-hosted) with full code samples.
- `references/props-vs-state.md` — surface-by-surface comparison, right/wrong placement,
  hibernation persistence pattern, broadcast leak walkthrough.
- `references/scope-design.md` — scope hierarchy patterns, mapping to tool gating,
  scope-bump flow, worked examples for read/write/admin tiers.
- `references/secret-management.md` — `wrangler secret put` recipes, `secrets.required`,
  Secrets Store cross-Worker sharing, quarterly rotation runbook.
- `scripts/audit-state-for-secrets.ts` — deno/node TypeScript that regex-greps a state dump
  for JWTs, `Bearer ` headers, `sk_live_`, `gho_`, `xoxb-`, AWS keys, long base64 strings.
  Exits non-zero if any are inside the broadcast `state` field.
- `scripts/verify-oauth-flow.sh` — curl-based smoke test: discovery → register → authorize →
  token → protected MCP call, with status reporting per step.
