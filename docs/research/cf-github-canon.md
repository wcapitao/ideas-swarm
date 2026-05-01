# Cloudflare Agents — GitHub Canon

> Reconnaissance for a specialist building Cloudflare Agents. Captures the strongest reference repos and the patterns to copy. Compiled 2026-04-30.

The Cloudflare "agents on Workers" universe is centered on five repos:

| Repo | Stars | Last push | Role |
|------|-------|-----------|------|
| `cloudflare/agents` | 4 857 | 2026-04-30 | The SDK itself + ~35 examples + 2 narrative guides |
| `cloudflare/agents-starter` | 1 243 | 2026-04-30 | The canonical "deploy to Cloudflare" starter (chat agent + tools + scheduling) |
| `cloudflare/mcp-server-cloudflare` | 3 675 | 2026-04-30 | ~17 production McpAgent servers (workers-bindings, observability, radar, …) |
| `cloudflare/ai` | 1 023 | 2026-04-29 | ~38 demos for Workers AI; ~17 of them use Agent or McpAgent |
| `cloudflare/templates` | 1 935 | 2026-04-24 | 30+ Workers templates; only `nlweb-template` uses the Agents SDK |

All five are in active daily development. Versions in the wild as of this writing: `agents@0.12.0`, `@cloudflare/ai-chat@0.6.0`. Node 24+, npm workspaces, Nx, oxlint/oxfmt, Vitest, Playwright. The starter is on `wrangler@4.86.0` with `@cloudflare/vite-plugin@1.34.0`. The whole stack has converged on **Vite + `@cloudflare/vite-plugin`** for both dev and build — `wrangler dev` is no longer the recommended entry point for full-stack agent apps.

---

## 1. agents SDK source map

`cloudflare/agents` is an npm-workspaces monorepo. The publishable SDK is `packages/agents` (npm name: `agents`). Every entry point in `package.json#exports` maps cleanly to one file in `packages/agents/src/`.

### Public entry points (verbatim from `packages/agents/package.json`)

| Import path | Source file | What it exports |
|---|---|---|
| `agents` | `src/index.ts` (≈8 000 lines) | `Agent` class, `routeAgentRequest`, `routeAgentEmail`, `getAgentByName`, `getCurrentAgent`, `callable` decorator, `unstable_callable`, `StreamingResponse`, `SqlError`, `AgentNamespace`, `AgentContext`, `AgentOptions`, `Schedule`, `ScheduleCriteria`, `MCPServersState`, `MCPServer`, `AddMcpServerOptions`, plus re-exports from `./sub-routing` (`routeSubAgentRequest`, `getSubAgentByName`, `parseSubAgentPath`, `SUB_PREFIX`) |
| `agents/client` | `src/client.ts` | `AgentClient` (browser/Node WebSocket client), `AgentStub`, `agentFetch`, `createStubProxy` — built on `partysocket` |
| `agents/react` | `src/react.tsx` | `useAgent` hook (overloaded for typed agents and state sync), `useAgentToolEvents` |
| `agents/ai-react` | `src/ai-react.tsx` | One-line re-export of `@cloudflare/ai-chat/react` (deprecated path; keeps logging a warning) |
| `agents/mcp` | `src/mcp/index.ts` | `McpAgent` abstract class, `createMcpHandler`, `experimental_createMcpHandler`, `getMcpAuthContext`, `WorkerTransport`, `RPCClientTransport`, `RPCServerTransport`, `SSEEdgeClientTransport`, `StreamableHTTPEdgeClientTransport`, `ElicitRequestSchema` |
| `agents/mcp/client` | `src/mcp/client.ts` | `MCPClientManager` and friends |
| `agents/mcp/do-oauth-client-provider` | `src/mcp/do-oauth-client-provider.ts` | `DurableObjectOAuthClientProvider` for MCP-as-OAuth-client |
| `agents/schedule` | `src/schedule.ts` | `getSchedulePrompt(event)` (LLM-aimed prompt that turns natural language into a structured schedule) and `scheduleSchema` (Zod discriminated union: `scheduled` / `delayed` / `cron` / `no-schedule`) |
| `agents/workflows` | `src/workflows.ts` | `AgentWorkflow` base class for Workflows integrated with Agents; `WorkflowInfo`, `getWorkflows()` paging |
| `agents/email` | `src/email.ts` | `EmailMessage` re-export, `routeAgentEmail`, `createHeaderBasedEmailResolver`, `signAgentHeaders`/`replyToEmail` |
| `agents/observability` | `src/observability/index.ts` | Event types (`ObservabilityEvent`), `genericObservability` |
| `agents/agent-tools` | `src/agent-tools.ts` | `agentTool()` factory + `runAgentTool()` for "agents as tools" pattern |
| `agents/chat` | `src/chat/index.ts` | Shared chat primitives — turn queue, resumable-stream, sanitize, tool-state. Used by `@cloudflare/ai-chat` and `@cloudflare/think` |
| `agents/ai-chat-agent` | `src/ai-chat-agent.ts` | One-line re-export of `@cloudflare/ai-chat`; deprecated |
| `agents/ai-chat-v5-migration` | `src/ai-chat-v5-migration.ts` | Codemod-ish helpers for migrating from AI SDK v4 → v5 chat shapes |
| `agents/types` | `src/types.ts` | `MessageType` enum |
| `agents/vite` | `src/vite.ts` | Vite plugin — TC39 decorator transforms (Oxc doesn't natively support them) |
| `agents/x402` | `src/mcp/x402.ts` | `withX402` / `withX402Client` wrappers for paid MCP tools |
| `agents/experimental/webmcp` | `src/experimental/webmcp.ts` | `registerWebMcp()` browser adapter for Chrome's `navigator.modelContext` |
| `agents/experimental/memory/session` | `src/experimental/memory/session/` | Experimental session memory |

### Where each big API actually lives

```
packages/agents/src/
├── index.ts                      ← Agent class definition (line 930)
│                                   sql template literal (line 1166)
│                                   setState / onStateChanged (lines 1929 / 2209)
│                                   schedule / scheduleEvery (lines 3479 / 3540)
│                                   getSchedule / getSchedules / cancelSchedule (lines 3606 / 3642 / 3687)
│                                   onAlarm / destroy (lines 4363 / 6051)
│                                   routeAgentRequest (line 7755)
│                                   routeAgentEmail (line 7857)
│                                   getAgentByName (line 7938)
│                                   StreamingResponse (line 7957)
├── schedule.ts                   ← getSchedulePrompt + scheduleSchema (NL → cron/delayed/scheduled)
├── react.tsx                     ← useAgent (3 overloads, line 254/269/288), useAgentToolEvents (line 767)
├── client.ts                     ← AgentClient, agentFetch, AgentStub typing magic
├── sub-routing.ts                ← routeSubAgentRequest, parseSubAgentPath, SUB_PREFIX
├── retries.ts                    ← tryN, isErrorRetryable, RetryOptions
├── workflows.ts                  ← AgentWorkflow (a Workflow you can drive from an Agent)
├── workflow-types.ts             ← WorkflowInfo / WorkflowQueryCriteria / WorkflowPage
├── email.ts                      ← Email routing (header signing, resolvers, replyToEmail)
├── agent-tools.ts                ← agentTool(), runAgentTool(), child-adapter types
├── ai-chat-agent.ts              ← (re-export shim → @cloudflare/ai-chat)
├── ai-react.tsx                  ← (re-export shim → @cloudflare/ai-chat/react)
├── chat/                         ← turn-queue, resumable-stream, broadcast-state, parse-protocol, sanitize, tool-state
├── mcp/
│   ├── index.ts                  ← McpAgent abstract class (line 29). Required: `server` + `init()`.
│   │                               Static helpers: McpAgent.serve(path, opts), McpAgent.serveSSE(path), McpAgent.mount(path)
│   ├── handler.ts                ← createMcpHandler / experimental_createMcpHandler (stateless, no DO)
│   ├── transport.ts              ← McpSSETransport, StreamableHTTPServerTransport
│   ├── rpc.ts                    ← RPCClientTransport, RPCServerTransport, RPC_DO_PREFIX
│   ├── client.ts                 ← MCPClientManager (used by Agent.addMcpServer)
│   ├── client-connection.ts      ← MCPConnectionState
│   ├── do-oauth-client-provider.ts ← DurableObjectOAuthClientProvider
│   ├── auth-context.ts           ← getMcpAuthContext (read OAuth props inside a tool)
│   ├── worker-transport.ts       ← WorkerTransport (cross-Worker / RPC bridge)
│   └── x402.ts                   ← Paid-tool wrappers
├── observability/                ← pluggable observability (events emitted from the Agent)
├── experimental/
│   ├── webmcp.ts                 ← Browser bridge to navigator.modelContext (Chrome WebMCP)
│   └── memory/                   ← Experimental session memory primitives
└── cli/                          ← `npx agents` create scaffolder
```

### WebSocket hibernation

- `Agent` declares `static options: AgentStaticOptions = { hibernate: true }` (line 1099). Hibernation is **on by default** — confirmed by 12 references to "hibernate" in `index.ts`, including the line `hibernate: ctor.options?.hibernate ?? DEFAULT_AGENT_STATIC_OPTIONS.hibernate`.
- The base class extends `Server` from `partyserver`. `partyserver` already implements the `webSocketMessage` / `webSocketClose` / `webSocketError` hooks, so the user-facing API is `onConnect` / `onMessage` (which work the same whether the DO is awake or hibernated).
- State is persisted to a `cf_agents_state` SQLite table (`_ensureSchema()` near line 1190) and re-read after hibernation. The `_rawStateAccessors` WeakMap is rebuilt lazily because, per the comment at line 1944, "After hibernation, the `_rawStateAccessors` WeakMap is empty but the connection's state getter still reads from the persisted WebSocket attachment."
- Internal `_cf_*` flags on connections (readonly, no-protocol) survive hibernation because they live in the WebSocket attachment, not the in-memory wrapper.

### Examples folder — every directory

`cloudflare/agents/examples/` (35 directories — every one is a runnable Vite + Workers full-stack app that extends `agents/tsconfig`):

| Example | What it shows |
|---|---|
| `playground` | Kitchen-sink showcase of every SDK feature (Kumo design system) |
| `mcp` | Stateful MCP server using `McpAgent` with `setState` and `onStateChanged` |
| `mcp-worker` | Stateless MCP server using `createMcpHandler` (no DO, one fetch handler) |
| `mcp-worker-authenticated` | OAuth 2.1 in front of `createMcpHandler` via `@cloudflare/workers-oauth-provider` |
| `mcp-client` | Agent that **connects to** remote MCP servers via `addMcpServer` and routes `onMcpUpdate` to the React frontend |
| `mcp-elicitation` | Mid-tool-call user input via `this.elicitInput()` (built into `McpAgent`) |
| `mcp-rpc-transport` | Agent calling an `McpAgent` in the same Worker via `RPCServerTransport` (no HTTP) |
| `codemode` | LLM writes code that orchestrates tools (instead of one-tool-at-a-time); uses `@cloudflare/codemode` |
| `codemode-mcp` | Wraps an MCP server with `codeMcpServer` so an N-tool MCP becomes a single `code` tool |
| `codemode-mcp-openapi` | Same idea, applied to OpenAPI specs (`openApiMcpServer` produces `search` + `execute` tools) |
| `agents-as-tools` | Parent Think agent dispatches retained `Researcher` / planner sub-agents via `agentTool()` and `runAgentTool()` |
| `assistant` | Full Project Think showcase — multi-session sub-agent routing via `MyAssistant` facets under an `AssistantDirectory` |
| `multi-ai-chat` | Multi-session chat using sub-agent routing — single `Inbox` parent DO + per-chat facet DOs |
| `workspace-chat` | `Workspace` virtual filesystem from `@cloudflare/shell` integrated with `AIChatAgent` and `@cloudflare/codemode` |
| `resumable-stream-chat` | A streaming AI response that automatically resumes after disconnect — buffered chunks replay on reconnect |
| `ai-chat` | Canonical full chat app using `@cloudflare/ai-chat` (recommended over `agents/ai-chat-agent`) |
| `tictactoe` | Smart agent playing a game using GPT-4o + structured output |
| `dynamic-tools` | Tools registered at runtime by the embedding application (SDK / platform pattern) |
| `dynamic-workers` | Spin up sandboxed isolates at runtime via Worker Loader binding |
| `dynamic-workers-playground` | Same plus `@cloudflare/worker-bundler` for compile-then-execute UX |
| `worker-bundler-playground` | AI-described prompt → bundled Worker → load + run inline |
| `email-agent` | `this.sendEmail()` outbound + `routeAgentEmail()` inbound, with `postal-mime` MIME parsing and signed `replyToEmail` |
| `push-notifications` | Schedule reminders via `this.schedule()`, deliver them as Web Push when the alarm fires |
| `github-webhook` | Per-repo agent (one DO per repo); HMAC-SHA256 signature verification; events streamed over WebSocket |
| `cross-domain` | `routeAgentRequest(request, env, { cors: true })` — separate frontend domain |
| `auth-agent` | GitHub OAuth in front of `routeAgentRequest`, with the **Worker** (not the browser) deciding which DO instance a user can reach |
| `workflows` | Multiple concurrent `AgentWorkflow`s with per-workflow human-in-the-loop approval, paginated `getWorkflows()` listing |
| `structured-input` | Client-side tools that render a UI form (multiple choice, yes/no, rating) and return user response as tool output |
| `voice-agent` | Real-time voice loop entirely inside a DO — Workers AI for STT / TTS / VAD / LLM; interruption support |
| `voice-input` | `useVoiceInput` hook from `@cloudflare/voice` for mic → STT only |
| `elevenlabs-starter` | Voice chat / soundscape gen / character / music — Cloudflare Agents + ElevenLabs APIs |
| `a2a` | Cloudflare Agent exposed as an [A2A protocol](https://a2a-protocol.org/) server with Agent Card discovery and SSE streaming |
| `webmcp` | Bridges `McpAgent` tools to Chrome's `navigator.modelContext` via the experimental `registerWebMcp()` adapter |
| `x402` / `x402-mcp` | x402 HTTP payments — Hono middleware gating routes ($0.10 / call); MCP version with `withX402(server)` for paid tools |
| `push-notifications`, `tictactoe` | (covered above) |

### Guides folder

Long-form, narrative-first tutorials. Each is a runnable Vite + Workers app whose README is the main artifact.

| Guide | Topic |
|---|---|
| `guides/anthropic-patterns` | Implementations of all five [Anthropic agent patterns](https://www.anthropic.com/research/building-effective-agents) (chained, parallel, routing, orchestrator-workers, evaluator-optimizer) on top of `Agent` |
| `guides/human-in-the-loop` | The `tools.ts`/`utils.ts` pattern for marking tools `needsApproval`, surfacing them in the UI, and resolving the result back to the model |

### `experimental/` and `wip/`

`experimental/` contains nine WIP "gadgets" / "fibers" / "session" / "voice" / "webmcp" subprojects that are not published. `wip/` contains in-flight design notes (`think-multi-session-assistant-plan.md`, `inline-sub-agent-events.md`). **Do not copy from these.** They illustrate where the SDK is going, but the published `agents` package is the source of truth.

### `openai-sdk/`

A parallel set of demos that use `@openai/agents` instead of the Cloudflare `agents` SDK. Useful only if you want to compare the two authoring styles. Includes `basic`, `chess-app`, `handoffs`, `human-in-the-loop`, `llm-as-a-judge`, `pizzaz`, `streaming-chat`, `call-my-agent`.

---

## 2. agents-starter walkthrough

`cloudflare/agents-starter` is a single-app starter — no monorepo. Read order:

### 1. `wrangler.jsonc` (the deployment shape, 18 lines)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "agent-starter",
  "main": "src/server.ts",
  "compatibility_date": "2026-03-02",
  "compatibility_flags": ["nodejs_compat"],
  "ai": { "binding": "AI", "remote": true },
  "assets": {
    "directory": "./public",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/agents/*", "/oauth/*"]
  },
  "durable_objects": {
    "bindings": [{ "class_name": "ChatAgent", "name": "ChatAgent" }]
  },
  "migrations": [{ "new_sqlite_classes": ["ChatAgent"], "tag": "v1" }]
}
```

Note three things you'll see in every Cloudflare Agents app: the `assets.run_worker_first: ["/agents/*", "/oauth/*"]` carve-out, the SQLite-backed Durable Object class, and `ai: { binding: "AI", remote: true }` for Workers AI. There is **no** vectorize binding here despite the prompt's expectation — the canonical starter does not ship one. (Vectorize binding is found in `mcp-server-cloudflare/apps/workers-bindings/wrangler.jsonc` instead.)

### 2. `package.json` (the dependency wall)

Top deps: `agents@^0.12.0`, `@cloudflare/ai-chat@^0.6.0`, `@cloudflare/kumo@^1.19.0` (CF design system), `ai@^6.0.170` (Vercel AI SDK v6), `streamdown@^2.5.0`, `@phosphor-icons/react`, `workers-ai-provider@^3.1.13`, `zod@^4.4.1`. Top dev deps: `@cloudflare/vite-plugin@1.34.0`, `wrangler@4.86.0`, `oxfmt`, `oxlint`, `typescript@^6.0.3`, `vite@^8.0.10`, `@tailwindcss/vite@^4.2.4`. Scripts: `vite dev`, `vite build && wrangler deploy`. **No `wrangler dev`.**

### 3. `src/server.ts` (the chat agent — 217 lines)

```ts
import { createWorkersAI } from "workers-ai-provider";
import { callable, routeAgentRequest, type Schedule } from "agents";
import { getSchedulePrompt, scheduleSchema } from "agents/schedule";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { convertToModelMessages, pruneMessages, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";

export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;

  onStart() {
    this.mcp.configureOAuthCallback({ /* popup completion */ });
  }

  @callable() async addServer(name: string, url: string) { return await this.addMcpServer(name, url); }
  @callable() async removeServer(serverId: string) { await this.removeMcpServer(serverId); }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const mcpTools = this.mcp.getAITools();
    const workersai = createWorkersAI({ binding: this.env.AI });
    const result = streamText({
      model: workersai("@cf/moonshotai/kimi-k2.6", { sessionAffinity: this.sessionAffinity }),
      system: `You are a helpful assistant... ${getSchedulePrompt({ date: new Date() })}`,
      messages: pruneMessages({
        messages: inlineDataUrls(await convertToModelMessages(this.messages)),
        toolCalls: "before-last-2-messages"
      }),
      tools: { ...mcpTools, getWeather, getUserTimezone, calculate, scheduleTask, getScheduledTasks, cancelScheduledTask },
      stopWhen: stepCountIs(5),
      abortSignal: options?.abortSignal
    });
    return result.toUIMessageStreamResponse();
  }

  async executeTask(description: string, _task: Schedule<string>) {
    this.broadcast(JSON.stringify({ type: "scheduled-task", description, timestamp: new Date().toISOString() }));
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (await routeAgentRequest(request, env)) || new Response("Not found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
```

Things to internalize:

- The class extends **`AIChatAgent`** from `@cloudflare/ai-chat`, not `Agent` directly. `AIChatAgent` is the recommended base for chat — gives you `this.messages`, `this.mcp`, `this.broadcast`, `this.schedule`, `this.cancelSchedule`, `this.getSchedules`, `this.sessionAffinity`, `maxPersistedMessages`.
- **Three tool patterns in one file**: server-side (`getWeather` has `execute`), client-side (`getUserTimezone` has no `execute` — the browser handles it via `onToolCall`), and approval (`calculate` has `needsApproval: async ({ a, b }) => Math.abs(a) > 1000 || Math.abs(b) > 1000`). The starter README explicitly calls these out as the canonical three.
- **Scheduling tool** uses `getSchedulePrompt({ date })` injected into the system prompt + `scheduleSchema` (zod discriminated union) as the tool input. The actual scheduling call is `this.schedule(input, "executeTask", description, { idempotent: true })`. `idempotent: true` is critical — it makes `scheduleEvery` safe to call inside `onStart()` (which runs on every DO wake).
- **`this.broadcast(JSON.stringify({...}))`** is how scheduled tasks notify connected clients. The README explicitly warns "We use `broadcast()` instead of `saveMessages()` to avoid injecting into chat history — that would cause the AI to see the notification as new context and potentially loop."
- **MCP-as-a-client**: `this.addMcpServer(name, url)` (called from `@callable()` RPC) is enough — auth callback / popup is configured in `onStart()`.
- **`stopWhen: stepCountIs(5)`** caps tool-calling iterations. Combined with `pruneMessages({..., toolCalls: "before-last-2-messages"})` for context-window hygiene.

### 4. `src/app.tsx` (the React frontend — uses `useAgent` + `useAgentChat`)

```tsx
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { MCPServersState } from "agents";
import type { ChatAgent } from "./server";

const agent = useAgent<ChatAgent>({
  agent: "ChatAgent",
  onOpen:    useCallback(() => setConnected(true),  []),
  onClose:   useCallback(() => setConnected(false), []),
  onError:   useCallback((e: Event) => console.error("WebSocket error:", e), []),
  onMcpUpdate: useCallback((state: MCPServersState) => setMcpState(state), []),
  onMessage: useCallback((m: MessageEvent) => {
    const data = JSON.parse(String(m.data));
    if (data.type === "scheduled-task") toasts.add({ title: "Scheduled task completed", description: data.description });
  }, [toasts])
});

// agent.stub.addServer / agent.stub.removeServer — typed RPC against the @callable() methods on the server class

const { messages, sendMessage, clearHistory, addToolApprovalResponse, stop, status } = useAgentChat({
  agent,
  onToolCall: async (event) => {
    if ("addToolOutput" in event && event.toolCall.toolName === "getUserTimezone") {
      event.addToolOutput({
        toolCallId: event.toolCall.toolCallId,
        output: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, localTime: new Date().toLocaleTimeString() }
      });
    }
  }
});
```

The pair `useAgent` + `useAgentChat` is the recommended chat frontend. `useAgent` opens the WebSocket, syncs state, and gives you a typed `agent.stub` for RPC against `@callable()` methods. `useAgentChat` (from `@cloudflare/ai-chat/react`) layers chat semantics on top: streaming `messages`, `sendMessage`, `addToolApprovalResponse`, and the `onToolCall` callback for **client-side tools**.

### 5. `src/client.tsx` (5-line entry)

```tsx
import "./styles.css";
import { createRoot } from "react-dom/client";
import App from "./app";
createRoot(document.getElementById("root")!).render(<App />);
```

That's it. The starter is intentionally minimal: 4 source files, ~700 lines total (most of it `app.tsx` UI plumbing).

---

## 3. Examples catalog — sortable by topic

Combining `cloudflare/agents/examples`, `cloudflare/ai/demos`, `cloudflare/templates`, and `cloudflare/mcp-server-cloudflare/apps`:

### Tools
- `cloudflare/agents-starter/src/server.ts` — three tool patterns (server / client / approval) in one file
- `cloudflare/agents/examples/dynamic-tools` — runtime tool registration by embedding app
- `cloudflare/agents/examples/structured-input` — client-side tools that render UI forms (radio / yes-no / rating)
- `cloudflare/ai/demos/tool-calling`, `tool-calling-stream`, `tool-calling-stream-traditional` — Workers-AI-driven tool calling

### State (`setState`/`onStateChanged`/`sql`)
- `cloudflare/agents/examples/mcp` — `MyMCP extends McpAgent<Env, State>` with counter
- `cloudflare/ai/demos/agent-task-manager` — `Agent<Env, TaskManagerState>` with todos persisted in state
- `cloudflare/agents/examples/github-webhook` — events written to `this.sql\`INSERT INTO events ...\``

### Scheduling (`schedule` / `scheduleEvery`)
- `cloudflare/agents-starter` — natural-language → `scheduleSchema` → `this.schedule(...)`
- `cloudflare/ai/demos/agent-scheduler` — multi-step LLM extraction (action / type / date / cron / id) with `Confirmation` flow
- `cloudflare/agents/examples/push-notifications` — schedule fires → Web Push delivery via `web-push`

### MCP servers
- `cloudflare/agents/examples/mcp` — stateful (DO-backed) `McpAgent` with state
- `cloudflare/agents/examples/mcp-worker` — stateless `createMcpHandler`
- `cloudflare/agents/examples/mcp-worker-authenticated` — OAuth 2.1 wrapping of `createMcpHandler`
- `cloudflare/agents/examples/mcp-elicitation` — `this.elicitInput()` for mid-tool user prompts
- `cloudflare/agents/examples/mcp-rpc-transport` — Agent → McpAgent over RPC, in same Worker
- `cloudflare/mcp-server-cloudflare/apps/*` — production servers: `workers-bindings`, `workers-builds`, `workers-observability`, `radar`, `browser-rendering`, `logpush`, `ai-gateway`, `auditlogs`, `dns-analytics`, `dex-analysis`, `cloudflare-one-casb`, `graphql`, `sandbox-container`, `autorag`, `docs-vectorize`, `docs-autorag`
- `cloudflare/ai/demos/remote-mcp-server` (+ -auth0, -authkit, -authless, -github-oauth, -google-oauth, -logto, -descope-auth, -cf-access, -cf-access-self-hosted) — every common SaaS auth integration

### MCP clients (Agent connecting to remote MCP)
- `cloudflare/agents/examples/mcp-client` — `addMcpServer(name, url)` + `onMcpUpdate` → React via WebSocket
- `cloudflare/ai/demos/mcp-client` — minimal `MyAgent extends Agent` that exposes a `POST /add-mcp` endpoint via `onRequest`

### Streaming
- `cloudflare/agents/examples/resumable-stream-chat` — disconnect-replay-from-where-you-left-off
- `cloudflare/agents/examples/ai-chat` — streaming with `@cloudflare/ai-chat`
- `cloudflare/ai/demos/text-generation-stream`

### Multi-agent / sub-agents
- `cloudflare/agents/examples/agents-as-tools` — parent dispatches sub-agents via `agentTool()` + `runAgentTool()`
- `cloudflare/agents/examples/multi-ai-chat` — `Inbox` parent DO + per-chat facet DOs (sub-agent routing)
- `cloudflare/agents/examples/assistant` — `AssistantDirectory` + per-chat `MyAssistant` facets
- `cloudflare/ai/demos/orchestrator-workers`, `routing`, `parallelisation`, `prompt-chaining`, `evaluator-optimiser` — Anthropic patterns
- `cloudflare/agents/guides/anthropic-patterns` — narrative versions of all five patterns

### Human-in-the-loop
- `cloudflare/agents/guides/human-in-the-loop` — canonical pattern (the `needsApproval` tool flag + `addToolApprovalResponse` from the React side)
- `cloudflare/agents/examples/workflows` — per-workflow approval gates with paginated `getWorkflows()` listing
- `cloudflare/agents-starter` — `calculate` tool with `needsApproval` for `Math.abs(arg) > 1000`
- `cloudflare/ai/demos/agent-task-manager-human-in-the-loop`

### RAG
- `cloudflare/mcp-server-cloudflare/apps/docs-vectorize` — vectorize-backed docs MCP (`vectorize` binding, `embeddinggemma-v1` index)
- `cloudflare/mcp-server-cloudflare/apps/docs-autorag` — AutoRAG-backed docs
- `cloudflare/templates/nlweb-template/src/nlweb-mcp-do.ts` — `NLWebMcp extends McpAgent<Env>` with `this.env.AI.autorag(this.props.ragId).search()`
- `cloudflare/ai/demos/remote-mcp-server-autorag`

### Email / webhooks / external triggers
- `cloudflare/agents/examples/email-agent` — outbound `this.sendEmail()` and `routeAgentEmail()` for inbound
- `cloudflare/agents/examples/github-webhook` — HMAC-verified webhooks, agent-per-repo

### Voice
- `cloudflare/agents/examples/voice-agent` — full STT + TTS + VAD + LLM in one DO via Workers AI
- `cloudflare/agents/examples/voice-input` — `useVoiceInput` for mic→STT only
- `cloudflare/agents/examples/elevenlabs-starter` — Cloudflare Agents + ElevenLabs (4 demos in one app)

### Codemode (LLM writes code, code calls tools)
- `cloudflare/agents/examples/codemode` — chat app where LLM generates JS that orchestrates tools
- `cloudflare/agents/examples/codemode-mcp` — wrap existing MCP server as one `code` tool
- `cloudflare/agents/examples/codemode-mcp-openapi` — same for OpenAPI specs

### Workflows
- `cloudflare/agents/examples/workflows` — `AgentWorkflow` with progress + approvals + concurrent runs

### Payments
- `cloudflare/agents/examples/x402` — Hono `paymentMiddleware()` gates a route at $0.10
- `cloudflare/agents/examples/x402-mcp` — `withX402(server)` for paid MCP tools
- `cloudflare/templates/x402-proxy-template`

### Cross-cutting
- `cloudflare/agents/examples/cross-domain` — CORS-enabled routing
- `cloudflare/agents/examples/auth-agent` — GitHub OAuth + Worker-controlled DO routing
- `cloudflare/agents/examples/dynamic-workers` / `dynamic-workers-playground` / `worker-bundler-playground` — sandboxed isolates / Worker Loader

---

## 4. External canon

These are the most useful third-party repos for studying production Cloudflare Agents patterns. Filtered for: actually uses `agents/mcp` or `agents`, recent activity, and demonstrates a pattern not already in `cloudflare/*`.

| Repo | Stars | Last push | What it shows | Why copy it |
|---|---|---|---|---|
| [`getsentry/sentry-mcp`](https://github.com/getsentry/sentry-mcp) | 671 | 2026-04-28 | Production MCP using `createMcpHandler` (stateless) wrapped with `OAuthProvider`, RFC 9728 `WWW-Authenticate` patching, multiple rate-limit scopes (IP / user / chat / search), Sentry-instrumented MCP server | Best example of "stateless MCP server with serious auth and ops" — copy the rate-limiter and metrics shape |
| [`vantage-sh/vantage-mcp-server`](https://github.com/vantage-sh/vantage-mcp-server) | 80 | 2026-04-30 | `VantageMCP extends McpAgent<Env, {}, UserProps>` with dual auth (OAuth + bearer header via `HeaderAuthProvider`), tools auto-registered by side-effect import, generated tool typing from OpenAPI | Production stateful McpAgent with two auth modes; the `import "./tools"` side-effect tool registration is a clean pattern |
| [`stytchauth/mcp-stytch-consumer-todo-list`](https://github.com/stytchauth/mcp-stytch-consumer-todo-list) | 27 | 2026-03-12 | `TodoMCP extends McpAgent<Env, unknown, AuthenticationContext>` with **MCP Resources** (`new ResourceTemplate("todoapp://todos/{id}", ...)`), Stytch consumer auth | Cleanest example of MCP Resources (not just tools) on `McpAgent` |
| [`stytchauth/mcp-stytch-b2b-okr-manager`](https://github.com/stytchauth/mcp-stytch-b2b-okr-manager) | 7 | 2026-03-12 | B2B variant — multi-tenant org-scoped MCP | Reference for tenant-scoped MCP |
| [`knocklabs/knock-mcp`](https://github.com/knocklabs/knock-mcp) | 0 | 2026-04-22 | `KnockMCP extends McpAgent` with **`Sentry.wrapMcpServerWithSentry()`**, dynamic tool sets via `props.selectedGroups`, refresh-token store as auxiliary DO | Agent-level Sentry observability; per-session enabled-tools selection from auth props |
| [`Supermaxman/quickbooks-mcp-oauth`](https://github.com/Supermaxman/quickbooks-mcp-oauth) | 0 | 2025-08-25 | OAuth + McpAgent for QuickBooks API | Industry-specific OAuth pattern |
| [`Supermaxman/google-mcp-oauth`](https://github.com/Supermaxman/google-mcp-oauth) | 0 | 2025-08-25 | Google OAuth + McpAgent | Mirror of the above for Google |
| [`famma-ai/mcp-auth`](https://github.com/famma-ai/mcp-auth) | 26 | 2025-10-30 | Reverse-proxy auth pattern in front of an authless MCP — multiple worked examples (Supabase, etc.) | Useful when the upstream MCP can't be modified |
| [`arndvs/mcp-auth`](https://github.com/arndvs/mcp-auth) | 0 | 2025-10-10 | Workshop-style exercises stepping through MCP auth concepts | Pedagogical |
| [`yusukebe/cloudflare-workers-workshop-01`](https://github.com/yusukebe/cloudflare-workers-workshop-01) | 10 | 2025-06-03 | Workshop covering Workers + Hono + Agents | Self-contained tutorial |
| [`WojciechMatuszewski/cloudflare-mcp-server-client-example`](https://github.com/WojciechMatuszewski/cloudflare-mcp-server-client-example) | 0 | 2025-05-27 | Both an authless MCP server and a Worker client agent that calls it, in one repo | Clearest "client + server" pair for studying the request shape |
| [`allenheltondev/remote-mcp-agent`](https://github.com/allenheltondev/remote-mcp-agent) | 6 | 2025-07-03 | LangChain agent + remote MCP server (Cloudflare-hosted) | Shows non-Cloudflare client side hitting a Cloudflare-hosted MCP |
| [`zeroaddresss/cf_ai_watchpoint`](https://github.com/zeroaddresss/cf_ai_watchpoint) | 0 | 2026-03-10 | Web monitoring agent (Cloudflare 2026 internship project) | Real-world Agent-as-monitor pattern |
| [`MiguelAngelGutierrezMaya/remote-mcp`](https://github.com/MiguelAngelGutierrezMaya/remote-mcp) | 0 | 2025-05-10 | `WeatherAgent` — a minimal McpAgent | Smallest possible reference |
| [`stripe/ai`](https://github.com/stripe/ai) (the `tools/typescript/src/cloudflare/index.ts` integration) | 1 516 | 2026-04-30 | Stripe toolkit integration adapter for the Cloudflare Agents SDK | Reference for "build a third-party SDK adapter that targets Cloudflare Agents" |

Worth a look but **not** Cloudflare Agents: `eastlondoner/mineflare` (uses raw Workers + Containers + DOs without the SDK), `kentcdodds/mcp-demo` (uses the older direct DO pattern, not `McpAgent`).

---

## 5. Patterns that recur — the Cloudflare Agents house style

Things seen across at least three of the canonical repos.

### Project layout (every example, every starter, the nlweb template)

```
my-agent/
├── package.json           # "scripts": { "start": "vite dev", "deploy": "vite build && wrangler deploy", "types": "wrangler types env.d.ts --include-runtime false" }
├── vite.config.ts         # plugins: agents(), react(), cloudflare(), tailwindcss()
├── wrangler.jsonc         # not .toml. compatibility_date 2026-XX, compatibility_flags ["nodejs_compat"]
├── tsconfig.json          # extends "agents/tsconfig"
├── index.html             # Vite entry
├── env.d.ts               # generated by `wrangler types`
├── public/                # static assets
└── src/
    ├── server.ts          # Worker entry — exports default { fetch }, exports the Agent class
    ├── client.tsx         # createRoot(...).render(<App />) — 5 lines
    ├── app.tsx            # the React UI
    └── styles.css         # Tailwind + Kumo
```

The `agents()` Vite plugin is mandatory if you use `@callable()` (TC39 decorators aren't yet supported by Oxc).

### Worker fetch handler (every Agents example)

```ts
export default {
  async fetch(request: Request, env: Env) {
    return (await routeAgentRequest(request, env)) || new Response("Not found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
```

For cross-domain or SPA-on-different-host, add `{ cors: true }`. `routeAgentRequest` matches the `/agents/<class>/<name>/...` URL prefix and dispatches to the right DO.

### Wrangler config (every Agents example)

```jsonc
{
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [{ "class_name": "ChatAgent", "name": "ChatAgent" }]
  },
  "migrations": [{ "new_sqlite_classes": ["ChatAgent"], "tag": "v1" }],
  "assets": {
    "directory": "./public",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/agents/*", "/oauth/*"]
  }
}
```

`new_sqlite_classes` (not `new_classes`) is mandatory — Agents persist state to the DO's SQLite, so they must be SQLite-backed.

### Class shape (Agent)

```ts
export class MyAgent extends Agent<Env, MyState> {
  initialState: MyState = { /* ... */ };

  async onStart() {
    // Idempotent setup. Runs on every wake. Use scheduleEvery(idempotent: true) here.
    await this.scheduleEvery(60, "tick");
  }

  async tick() { /* runs every minute */ }

  @callable() async someRpcMethod(arg: string) { return ... }    // typed RPC from the client
  @callable({ streaming: true }) async streamingMethod(...) { ... }  // returns StreamingResponse

  async onConnect(connection: Connection, ctx: ConnectionContext) { /* WS open */ }
  async onMessage(connection: Connection, message: WSMessage) { /* WS msg */ }
  async onRequest(request: Request) { return new Response(...) }   // HTTP

  // Built-ins available on `this`:
  // this.state / this.setState(s) / this.sql`SELECT ...`
  // this.schedule(when, "method", payload, { idempotent }) / scheduleEvery / cancelSchedule / getSchedules
  // this.broadcast(payload) / this.getConnections()
  // this.addMcpServer(name, url) / this.removeMcpServer(id) / this.mcp.getAITools()
}
```

### Class shape (McpAgent)

```ts
export class MyMCP extends McpAgent<Env, MyState, MyProps> {
  server = new McpServer({ name: "Demo", version: "1.0.0" });
  initialState: MyState = { counter: 0 };

  async init() {
    this.server.registerTool("add", { description: "...", inputSchema: { a: z.number() } },
      async ({ a }) => { this.setState({ counter: this.state.counter + a }); return { content: [{ type: "text", text: "ok" }] }; });
    this.server.resource("counter", "mcp://resource/counter", uri => ({ contents: [{ text: String(this.state.counter), uri: uri.href }] }));
  }
}
export default MyMCP.serve("/mcp", { binding: "MyMCP" });
// or: McpAgent.serveSSE("/sse", ...) for SSE-only clients
// or: McpAgent.mount("/path", ...)
```

`server` and `init()` are abstract — every McpAgent must implement both. `this.props` is the OAuth-injected typed payload.

### Stateless MCP (no DO)

```ts
import { createMcpHandler } from "agents/mcp";
const server = new McpServer({ name: "Hello", version: "1.0.0" });
server.registerTool("hello", {...}, async ({...}) => ({...}));
export default {
  fetch: (request, env, ctx) => createMcpHandler(server)(request, env, ctx)
};
```

Used by `examples/mcp-worker` and `getsentry/sentry-mcp` — preferred when you don't need session state or per-user persistence.

### Tool registration

The community has converged on **two** styles:

1. **Inline literal** (Vercel AI SDK style, used in `agents-starter`): `tools: { getWeather: tool({ description, inputSchema, execute }) }` passed straight to `streamText`. Three flavours: `execute` (server), no `execute` (client-side, browser handles via `onToolCall`), `needsApproval` (HITL).
2. **Imperative `server.registerTool(name, schema, handler)`** (MCP style, used in every `McpAgent`): tools registered inside `async init()`. Schemas use Zod object shapes (not `z.object(...)`) for the MCP `inputSchema` field.

In production servers (`vantage-mcp-server`, `mcp-server-cloudflare`), tools are registered by **side-effect imports** — `import "./tools"` triggers `register*Tools(server)` calls — which keeps the main entry file tiny.

### Scheduling — natural language → schedule

Every chat agent that supports scheduling does this:

1. Inject `getSchedulePrompt({ date: new Date() })` into the system prompt.
2. Define a tool `scheduleTask` whose `inputSchema` is `scheduleSchema` (the Zod discriminated union).
3. In `execute`, call `this.schedule(input, "executeTask", description, { idempotent: true })` where `input` is one of `Date`, `cron-string`, or `delay-seconds-number`.
4. Define a callback method (here `executeTask`) that uses `this.broadcast(...)` (not `saveMessages`) to notify clients without polluting chat history.

### State broadcasting

`this.setState(newState)` triggers `onStateChanged` on the server and pushes to every connected WebSocket client. The React side picks it up via `useAgent`'s state binding. Classified two-way: clients can also call `agent.setState(...)` for collaborative edits (modulo readonly flag).

For events that are **not** state (notifications, scheduled-task fires), use `this.broadcast(JSON.stringify({ type, ... }))` and listen via `useAgent({ onMessage })` — never via state.

### Frontend connection

```tsx
const agent = useAgent<MyAgent>({ agent: "MyAgent", onOpen, onClose, onError, onMessage, onMcpUpdate });
// agent.stub.someRpcMethod(...) — typed RPC against @callable() methods
// agent.setState(...) — collaborative state edit
// useAgentChat({ agent, onToolCall }) — chat semantics on top
```

The `<MyAgent>` type parameter pulls in the typed surface for `agent.stub.*` — every `@callable()` method shows up.

### Auth posture

- For MCP servers, `OAuthProvider` from `@cloudflare/workers-oauth-provider` is the canonical wrapper. Auth context flows in as typed `this.props` on the McpAgent.
- For Agent apps, the worker is the gatekeeper — see `examples/auth-agent`. The browser asks the worker which DO it can reach, the worker decides, the worker dispatches to `routeAgentRequest`.
- Bearer-token mode (`api-token-mode.ts` in `mcp-common`) is the parallel path for headless / CI clients.

---

## 6. Anti-patterns

Things visible in older code that the new canonical repos have moved away from.

### 1. `wrangler.toml` for Agents apps — moved to `wrangler.jsonc`

All examples in `cloudflare/agents/examples` and `cloudflare/agents-starter` use `.jsonc`. The `examples/AGENTS.md` is explicit: "Use `wrangler.jsonc` (not `.toml`)". Two stragglers (`examples/agents-as-tools/wrangler.json`, `examples/resumable-stream-chat/wrangler.toml`) are exceptions and likely candidates for cleanup.

### 2. `npm run dev` / `wrangler dev` — moved to `vite dev`

The starter has `dev` and `start` scripts both pointing at `vite dev`. The examples convention (per `AGENTS.md`) is to use `start` only — `vite dev`, with `@cloudflare/vite-plugin` running the Workers runtime under the hood. Plain `wrangler dev` is no longer the entry point.

### 3. `agents/ai-chat-agent` and `agents/ai-react` — moved to `@cloudflare/ai-chat`

The current `src/ai-chat-agent.ts` and `src/ai-react.tsx` files are one-line shims that re-export from `@cloudflare/ai-chat` and `@cloudflare/ai-chat/react`, plus a `console.log("...is deprecated and will be removed in the next major version.")`. New code should import directly:

```ts
import { AIChatAgent } from "@cloudflare/ai-chat";
import { useAgentChat } from "@cloudflare/ai-chat/react";
```

### 4. `unstable_callable` and `unstable_getSchedulePrompt` — moved to `callable` / `getSchedulePrompt`

Both are kept as deprecated aliases that warn on first use. New code uses the un-prefixed names.

### 5. `AgentNamespace<MyAgent>` — moved to `DurableObjectNamespace<MyAgent>`

Source comment: `@deprecated Use DurableObjectNamespace instead`. Functionally identical, but the naming in `Env` types should now match the rest of the Workers types ecosystem.

### 6. Manual session ID handling for MCP — superseded by `McpAgent.serve()`

Older external repos (some of the smaller ones in the search results) hand-rolled SSE session management on top of raw DOs. The modern path is to extend `McpAgent` and call `MyMCP.serve("/mcp", { binding: ... })` — the SDK figures out transport from the URL prefix (`sse:`, `streamable-http:`, `rpc:`) and routes accordingly.

### 7. `new_classes` in migrations — should be `new_sqlite_classes`

The first generation of DO examples (in `templates/durable-chat-template`) used `new_classes`. Agents must use `new_sqlite_classes` because the SDK persists state to the DO SQLite. Mismatched migrations will surface as `SqlError` at runtime.

### 8. Polling for state — replaced by WebSocket state sync

`useAgent` opens a WebSocket and binds state automatically. Older chat-style code that polled `/api/state` from the client should be replaced by `useAgent` + `setState` + `broadcast`. `cloudflare/templates/durable-chat-template` is an older non-Agents pattern (raw partyserver) and is **not** the recommended starting point — start from `cloudflare/agents-starter` instead.

### 9. Storing chat history in `setState` instead of `messages`

`AIChatAgent` has built-in `this.messages` (persisted up to `maxPersistedMessages`) and a UI message stream over WebSocket. Stuffing the same messages into `setState` would double-write. Older demos sometimes did this; the current pattern is to put **only out-of-band notifications** (e.g. scheduled-task fires) on `broadcast`, and let `messages` own the history.

### 10. Returning raw text from MCP tools

The MCP SDK requires `{ content: [{ type: "text", text: "..." }] }` for tool returns. Several older external examples returned bare strings. Newer code consistently returns the structured shape and includes `isError: true` for failure cases (as seen in `cloudflare/templates/nlweb-template/src/nlweb-mcp-do.ts`).

---

## Appendix — the McpAgent class signature, verbatim

```ts
// packages/agents/src/mcp/index.ts:29
export abstract class McpAgent<
  Env   extends Cloudflare.Env             = Cloudflare.Env,
  State                                    = unknown,
  Props extends Record<string, unknown>    = Record<string, unknown>
> extends Agent<Env, State, Props> {
  abstract server: MaybePromise<McpServer | Server>;
  abstract init(): Promise<void>;

  props?: Props;

  // identity
  getTransportType(): "sse" | "streamable-http" | "rpc";
  getSessionId():     string;
  getWebSocket():     Connection | null;            // SSE only

  // mid-tool elicitation
  setInitializeRequest(req: JSONRPCMessage): Promise<void>;
  getInitializeRequest(): Promise<JSONRPCMessage | undefined>;
  protected getRpcTransportOptions(): RPCServerTransportOptions;

  // static factories — pick the URL prefix
  static serve(path: string, opts?: ServeOptions): ExportedHandler;
  static serveSSE(path: string, opts?: Omit<ServeOptions, "transport">): ExportedHandler;
  static mount(path: string, opts?: Omit<ServeOptions, "transport">): ExportedHandler; // alias of serveSSE
}
```

## Appendix — the Agent class signature, verbatim

```ts
// packages/agents/src/index.ts:930
export class Agent<
  Env   extends Cloudflare.Env             = Cloudflare.Env,
  State                                    = unknown,
  Props extends Record<string, unknown>    = Record<string, unknown>
> extends Server<Env, Props> {
  static options: AgentStaticOptions = { hibernate: true };  // hibernation default-on

  initialState?: State;

  // state
  state: State;
  setState(state: State): void;
  onStateChanged(state: State | undefined, source: Connection | "server"): void;
  // (onStateUpdate is deprecated alias)

  // SQL
  sql<T = Record<string, string|number|boolean|null>>(
    strings: TemplateStringsArray, ...values: (string|number|boolean|null)[]
  ): T[];

  // scheduling
  schedule<T>(when: Date | string | number, callback: keyof this, payload?: T,
              options?: { retry?: RetryOptions; idempotent?: boolean }): Promise<Schedule<T>>;
  scheduleEvery<T>(intervalSeconds: number, callback: keyof this, payload?: T,
              options?: { retry?: RetryOptions; _idempotent?: boolean }): Promise<Schedule<T>>;
  getSchedule<T>(id: string): Schedule<T> | undefined;
  getScheduleById(id: string): Promise<Schedule<unknown> | undefined>;
  getSchedules<T>(criteria?: ScheduleCriteria): Schedule<T>[];
  cancelSchedule(id: string): Promise<boolean>;
  onAlarm(): void;        // override-only

  // lifecycle
  onStart(): void | Promise<void>;
  destroy(): Promise<void>;

  // MCP-as-client (Agent connecting to remote MCP)
  addMcpServer(name: string, url: string, host?: string, opts?: AddMcpServerOptions): Promise<...>;
  removeMcpServer(id: string): Promise<void>;
  // this.mcp.getAITools() / this.mcp.configureOAuthCallback({...})
}
```

These two signatures are the load-bearing surface for every Cloudflare Agent. Skill playbooks should cite line numbers in `packages/agents/src/index.ts` and `packages/agents/src/mcp/index.ts` so the engineer can jump straight to the implementation if a subtle question comes up.

---

**Report saved to:** `/home/athena/ai-ideator/docs/research/cf-github-canon.md`
