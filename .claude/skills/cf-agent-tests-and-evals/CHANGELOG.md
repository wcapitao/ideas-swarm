# Changelog

## v0.1.0 — 2026-04-30

Initial skill, derived from `docs/research/cf-tests-evals.md` (5,892 words) and cross-cut findings from `cf-agents-core.md` §15.

Key sources captured:
- `cloudflare/agents` test workspace pattern (`--no-isolate` for WS).
- `workers-sdk/fixtures/ai-vectorize` `vi.spyOn(env.AI, "run")` canon.
- `introspectWorkflowInstance` + `await using` for Workflow mocking.
- AIG evals limitations (cost/speed/thumbs-up only) → DIY judge requirement.
- Production telemetry → eval feedback loop.
