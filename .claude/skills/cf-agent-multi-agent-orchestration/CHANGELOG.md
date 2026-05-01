# Changelog

All notable changes to the **cf-agent-multi-agent-orchestration** skill are documented here.

## [1.0.0] - 2026-04-30

### Added
- Initial SKILL.md with the four topology patterns (supervisor / peer hand-off / fan-out / Workflow-orchestrated), `getAgentByName` mechanics, two hand-off flavors, sub-agent footguns, OpenAI-SDK demo pointers
- "When to split into multiple agents" decision matrix (state lifetimes / transport / scaling / permissions)
- "Anti-pattern: splitting just to feel modular" with cost breakdown
- `references/topology-patterns.md` — supervisor, peer-to-peer, fan-out, hand-off worked examples
- `references/getagentbyname-cookbook.md` — addressing siblings, RPC vs HTTP between agents
- `references/handoff-pattern.md` — state-handoff vs full-replay tradeoffs and code shapes
- `references/examples-catalog.md` — pointers into `cloudflare/agents/examples/{multi-agent, openai-sdk/*}` demos
- `scripts/audit-topology.ts` — static analysis of the agent codebase: parses `getAgentByName` calls, builds a directed graph, detects cycles, prints a Mermaid diagram
