# Changelog

All notable changes to the **cf-agent-tools-and-mcp** skill are documented here.

## [1.0.0] - 2026-04-30

### Added
- Initial SKILL.md with the three-flavor decision tree
  (`@callable` / `McpAgent` / `createMcpHandler`) and Workflow off-ramp
- "Decide the flavor first" decision tree at the top
- `@callable()` authoring section with TC39 decorator footgun, the
  `AbortSignal`-doesn't-cross-DO-RPC rule, and the don't-throw-across-
  the-wire pattern
- `McpAgent` authoring section with side-effect tool registration (the
  `mcp-server-cloudflare` / `vantage-mcp-server` pattern), transport-
  aware DO naming, the `serve()` / `serveSSE()` dual mount, and
  `wrangler.jsonc` shape
- `createMcpHandler` (stateless) section with the fresh-`McpServer`-
  per-request rule (MCP SDK >=1.26.0) and `getMcpAuthContext()` via
  `AsyncLocalStorage`
- Approval-flows section: `needsApproval` lifecycle plus the codemode-
  bypasses-it caveat, with MCP elicitation as the cross-protocol fallback
- Schema discipline section: Zod patterns, JSON Schema gotchas, the
  raw-object-shape vs `z.object(...)` distinction between `McpAgent` and
  Vercel AI SDK
- Error handling section: `isError: true` over throws, the three error
  layers (LLM / user / operator)
- `references/tool-flavors.md` — full side-by-side comparison + transport
  spec matrix
- `references/tool-registration.md` — side-effect imports, scope gating,
  conditional registration
- `references/approval-flows.md` — full state diagram and recovery paths
- `references/schema-cookbook.md` — 10 Zod patterns
- `scripts/lint-tool-descriptions.ts` — TS source linter for tool
  descriptions, inspired by `audit-agent-descriptions.py`
- `scripts/mcp-doctor.sh` — MCP handshake / transport / capabilities /
  auth probe against a deployed worker
- Hand-off matrix to cf-agent-auth-and-permissions, cf-agent-tests-and-
  evals, cf-agent-models-and-gateway, cf-agent-workflows-and-scheduling,
  cf-agent-state-and-storage, cf-agent-architect
- 10 cross-cutting non-negotiables from SKILL_CATALOG

### Source briefs

- `docs/research/SKILL_CATALOG.md` — cross-cutting rules
- `docs/research/cf-agents-core.md` §10, §13, §15 — McpAgent surface,
  needsApproval, codemode caveat
- `docs/research/cf-mcp-auth-frontend.md` §1, §2, §10 — McpAgent class
  anatomy, transport choice, gotchas
- `docs/research/cf-github-canon.md` §1, §4 — SDK source map, production
  MCP server canon (mcp-server-cloudflare, vantage-mcp-server)
