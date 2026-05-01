# Changelog

All notable changes to the **cf-agent-architect** skill are documented here.

## [0.1.0] - 2026-04-30

### Added
- Initial skill, derived from research briefs in `docs/research/` as of 2026-04-30
  (cf-agents-core, cf-runtime-primitives, cf-github-canon, cf-mcp-auth-frontend,
  cf-ai-stack, cf-tests-evals, cf-deploy-observe; suite design in
  `docs/research/SKILL_CATALOG.md`).
- `SKILL.md` — six-decision walkthrough (base class, naming, transport, state
  model, time + persistence, topology), architecture-spec template, hand-off
  table to the rest of the cf-agent-* suite, and the 10 cross-cutting
  non-negotiables every cf-agent-* skill must enforce.
- `references/decision-tree.md` — full ASCII decision flow including the
  "extra surfaces" (Sessions, Think, durable execution, codemode, x402, voice,
  email, browser).
- `references/class-selection.md` — when to pick `Agent` /
  `AIChatAgent` / `McpAgent` / `WorkflowEntrypoint` / `createMcpHandler`,
  with minimal 30-line examples and required wrangler bindings per class.
- `references/transport-matrix.md` — WS / SSE / HTTP / RPC / MCP transport
  matrix: client × hibernation × broadcast × use case.
- `references/architecture-spec-template.md` — the one-page fillable spec
  the skill produces, with a worked sample.
- `scripts/architect-precheck.sh` — host-environment precheck (Node >= 20,
  wrangler installed, account-id resolvable, git repo initialized, no
  conflicting `wrangler.toml`).
