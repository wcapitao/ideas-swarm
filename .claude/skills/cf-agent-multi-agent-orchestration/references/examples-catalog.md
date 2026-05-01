# Examples catalog

Pointers into the canonical Cloudflare-published demos that show multi-agent topologies. Read these before writing your own from scratch.

## Native SDK demos (`cloudflare/agents/examples/`)

These use the Cloudflare `agents` SDK directly. **Prefer these for greenfield work.**

| Example | Pattern | What to copy |
|---|---|---|
| `agents-as-tools` | Supervisor + retained sub-agents | The `agentTool()` / `runAgentTool()` shape. Parent `Think` agent dispatches retained `Researcher` and planner sub-agents as tools the LLM can call. |
| `multi-ai-chat` | Multi-session sub-agent routing | Single `Inbox` parent DO + per-chat facet DOs. Good template for "one user, many parallel conversations." |
| `assistant` | Project Think showcase | `AssistantDirectory` with per-chat `MyAssistant` facets — sub-agent routing scaled to a real product surface. Most complex of the three. |
| `workflows` | Workflow-orchestrated | Multiple concurrent `AgentWorkflow` instances with per-workflow human-in-the-loop approval and paginated `getWorkflows()` listing. |

## Anthropic-pattern guides (`cloudflare/agents/guides/anthropic-patterns/`)

Implementations of the five [Anthropic agent patterns](https://www.anthropic.com/research/building-effective-agents) on Cloudflare:

- **Chained** — sequential pipeline; each step's output is the next step's input.
- **Parallel** — N specialists in parallel; aggregator combines.
- **Routing** — a router classifies and dispatches to the right specialist.
- **Orchestrator-workers** — orchestrator decomposes the task; workers execute; orchestrator synthesizes.
- **Evaluator-optimizer** — generator + critic loop until the critic accepts.

The orchestrator-workers and routing patterns map directly onto the supervisor topology. Evaluator-optimizer maps onto a peer pair (generator agent + critic agent) with iterative hand-off.

## OpenAI-SDK style demos (`cloudflare/agents/examples/openai-sdk/`)

Uses `@openai/agents` (OpenAI's Agents SDK) on top of Workers + DOs. **Use these only when porting an existing OpenAI Agents app to Cloudflare.**

| Demo | Pattern | What to copy |
|---|---|---|
| `basic` | Single agent | Minimal scaffold for OpenAI Agents on Workers. |
| `chess-app` | Two-agent | Player + analyzer talking. Clean pair-of-agents shape. |
| `handoffs` | Peer hand-off | OpenAI-SDK handoff translated to a Cloudflare DO topology. The reference for how OpenAI's "handoff" concept maps to `getAgentByName`. |
| `human-in-the-loop` | Approval gate | One agent waits for approval before another agent acts. |
| `llm-as-a-judge` | Generator + critic | Iterative refinement loop with a judge model. |
| `pizzaz` | Multi-agent commerce | Full multi-agent demo (a commerce flow). The largest of the OpenAI-SDK demos. |
| `streaming-chat` | Streaming with multi-agent backend | Token streaming surface fronting a multi-agent backend. |
| `call-my-agent` | Voice front-end | Phone/voice into a multi-agent backend. |

## Cloudflare AI demos (`cloudflare/ai/demos/`)

These are individual pattern demos using Workers AI as the LLM. Useful as small, self-contained references.

| Demo | Pattern |
|---|---|
| `orchestrator-workers` | Orchestrator + workers (matches Anthropic pattern) |
| `routing` | Router classifies → dispatches to specialist |
| `parallelisation` | Fan-out specialists, aggregator combines |
| `prompt-chaining` | Sequential pipeline |
| `evaluator-optimiser` | Generator + critic loop |

These are **small** (a few hundred lines each). Read them when you want the bare-minimum shape of one pattern.

## Reading order

If you're building your first multi-agent app:

1. `cloudflare/ai/demos/orchestrator-workers` — smallest possible "supervisor" shape.
2. `cloudflare/agents/examples/agents-as-tools` — same idea with proper SDK helpers.
3. `cloudflare/agents/guides/anthropic-patterns` — narrative explaining all five patterns.
4. `cloudflare/agents/examples/multi-ai-chat` — production-shaped multi-session app.
5. `cloudflare/agents/examples/workflows` — when you need durability.

For hand-off specifically:

1. `cloudflare/agents/examples/openai-sdk/handoffs` — the OpenAI-SDK take.
2. Read `references/handoff-pattern.md` (this skill) for the native-SDK shape.

## Layout of every Cloudflare Agents example

Every demo extends `agents/tsconfig`, uses `vite + @cloudflare/vite-plugin`, and follows this layout:

```
example-name/
├── package.json           # "agents": "^0.12.x"
├── vite.config.ts         # plugins: agents(), cloudflare(), react?, tailwindcss?
├── wrangler.jsonc         # durable_objects.bindings + new_sqlite_classes migration
├── tsconfig.json          # extends "agents/tsconfig"
├── src/
│   ├── server.ts          # Worker entry — exports Agent classes + default fetch
│   ├── client.tsx         # createRoot(...).render(<App />)
│   └── app.tsx            # the React UI (uses useAgent + useAgentChat)
└── public/                # static assets
```

When you copy a demo as a starting point, copy the **whole layout** including the `wrangler.jsonc` migration block — that's the part most likely to bite you if you skip it.

## What NOT to copy from

- `cloudflare/agents/experimental/` — WIP gadgets, not published, breaking changes.
- `cloudflare/agents/wip/` — design notes, not runnable code.
- Anything in `kentcdodds/mcp-demo` — uses pre-`McpAgent` patterns.
- `eastlondoner/mineflare` — raw Workers + DOs without the SDK; not Agents-style.

## Related skills

- `cf-agent-architect` — when designing a new topology, start there.
- `cf-agent-workflows-and-scheduling` — for the Workflow-orchestrated pattern.
- `cf-agent-tools-and-mcp` — when the answer is "single agent + more tools," not "more agents."
- `cf-agent-tests-and-evals` — testing across agent boundaries with `runDurableObject`.
