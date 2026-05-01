# AI SDK bridge — useChat (Vercel) vs useAgentChat (Cloudflare)

Both render Vercel AI SDK `UIMessage`s. The difference is what's on the
other end of the wire.

## Pick by use case

| Need | Pick |
|---|---|
| Stateless chat, server is a Worker route returning `streamText().toUIMessageStreamResponse()` | `@ai-sdk/react useChat` over HTTP |
| Server holds conversation state, schedules tasks, has tools, runs upstream MCP | `useAgentChat` over WS against `AIChatAgent` |
| Multi-tab sync of the same conversation | `useAgentChat` (DO is the single source of truth) |
| Already have `/api/chat` and don't want a DO | `@ai-sdk/react useChat` |
| Cookie auth (session cookie sent automatically) | `useChat` (WS doesn't carry cookies reliably) |
| Token / query-string auth | either; `useAgentChat` via `query` on `useAgent` |
| Token streaming with no other features | `useChat` (simpler) |
| Persistent history across reloads, free | `useAgentChat` (DO SQLite) |

## Mental model

```
useChat       --HTTP POST /api/chat-->  Worker fetch handler -> streamText -> SSE response
useAgentChat  --WS /agents/...-->       AIChatAgent DO -> onChatMessage -> streamText -> WS frames
                                             |
                                             +-- this.messages persisted to DO SQLite
```

`useAgentChat` is built ON TOP of `useAgent` — it adds chat semantics
(streaming, optimistic append, persistence reconciliation, tool-approval)
to the WS connection that `useAgent` already manages.

## Both use the SAME UIMessage shape

```ts
type UIMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  parts: Array<
    | { type: "text"; text: string }
    | { type: "tool-invocation"; toolInvocation: { state: "..." ; toolName, args, ... } }
    | { type: "image"; image: string }
    /* ... */
  >;
  content?: string;        // legacy; computed from parts in v6+
};
```

Render code is portable between the two hooks.

## Side-by-side code

### useChat (Vercel)

```tsx
import { useChat } from "@ai-sdk/react";

function App() {
  const { messages, input, handleInputChange, handleSubmit, status } = useChat({
    api: "/api/chat",
    onToolCall: async ({ toolCall }) => {
      if (toolCall.toolName === "getUserTimezone") {
        return { tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
      }
    },
  });
  return /* ... */;
}
```

Worker route:

```ts
export default {
  async fetch(req: Request, env: Env) {
    if (new URL(req.url).pathname === "/api/chat") {
      const { messages } = await req.json();
      const result = streamText({ model, messages, tools });
      return result.toUIMessageStreamResponse();
    }
    return new Response("Not found", { status: 404 });
  }
};
```

No DO. No persistence. No multi-tab sync. Cookies work.

### useAgentChat (Cloudflare)

```tsx
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";

function App() {
  const agent = useAgent<ChatAgent>({ agent: "ChatAgent", name });
  const { messages, input, handleInputChange, handleSubmit, status } = useAgentChat({
    agent,
    onToolCall: async (event) => {
      if (event.toolCall.toolName === "getUserTimezone" && "addToolOutput" in event) {
        event.addToolOutput({
          toolCallId: event.toolCall.toolCallId,
          output: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
        });
      }
    },
  });
  return /* ... */;
}
```

DO `AIChatAgent` class:

```ts
export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;
  async onChatMessage() {
    const result = streamText({ model, messages: await convertToModelMessages(this.messages), tools });
    return result.toUIMessageStreamResponse();
  }
}
```

DO holds `this.messages`. Reload tab -> history. Open second tab on same
`name` -> same conversation, live.

## Bridge: drive useChat against an AIChatAgent

If you already have a UI library tied to `useChat` but want the DO's
persistence + scheduling, expose an HTTP route on the agent:

```ts
export class ChatAgent extends AIChatAgent<Env> {
  async onRequest(req: Request) {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/chat") && req.method === "POST") {
      const body = await req.json<{ messages: UIMessage[] }>();
      this.messages = body.messages;            // overwrites DO state
      const workersai = createWorkersAI({ binding: this.env.AI });
      const result = streamText({
        model: workersai("@cf/moonshotai/kimi-k2.6"),
        messages: await convertToModelMessages(this.messages),
        // tools, system, etc.
      });
      return result.toUIMessageStreamResponse();
    }
    return super.onRequest(req);
  }
}
```

Worker:

```ts
export default {
  fetch: (req, env) => routeAgentRequest(req, env) ?? env.ASSETS.fetch(req),
};
```

Client:

```tsx
const { messages } = useChat({
  api: `/agents/chat-agent/${convoId}/chat`,
  credentials: "include",   // cookies for session auth
});
```

**You lose:**
- Multi-tab live sync (HTTP doesn't push)
- WebSocket-based optimistic state
- `onMcpUpdate` events
- Approval flow integration (you'd reimplement)

**You keep:**
- DO-side persistence (`this.messages` written each turn)
- Scheduling (`this.schedule()` still works)
- Cookie-based auth (HTTP carries cookies)

## Bridge: drive useAgentChat against a non-Cloudflare backend

Don't. `useAgentChat` is hard-coupled to the `agents/client` WebSocket
protocol (`CF_AGENT_USE_CHAT_REQUEST`, `CF_AGENT_CHAT_MESSAGES`,
`cf_agent_state`). If your backend is OpenAI Responses API or a
non-Cloudflare server, use `useChat` and the bridge it provides.

## Auth comparison

| Auth method | useChat | useAgentChat |
|---|---|---|
| Cookies | yes (set `credentials: "include"`) | no (WS handshake doesn't carry cookies reliably) |
| Bearer token in header | yes (`headers` option) | no (WS upgrade doesn't take auth headers) |
| Token in query string | yes (`api: "/chat?token=..."`) | yes (via `query` on `useAgent`) |
| OAuth via redirect | yes (server validates session cookie on each call) | yes (validate token in `onConnect`) |

For SaaS chat with cookie sessions, `useChat` + the bridge above is the
cleanest path. For agentic UIs (DO + scheduled tasks + MCP fan-in),
`useAgentChat` is the canonical choice.

## Migration from `agents/ai-react` (deprecated)

Old:
```ts
import { useAgentChat } from "agents/ai-react";
import { AIChatAgent } from "agents/ai-chat-agent";
```

New:
```ts
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { AIChatAgent } from "@cloudflare/ai-chat";
```

The legacy paths are re-export shims that log a warning. Update package.json:

```json
"dependencies": {
  "@cloudflare/ai-chat": "^0.6.0"
}
```

Behavior is identical; the rename is purely package layout.
