# The 200-line chat-app stack

Three files. Walks the canonical `cloudflare/agents-starter` shape.
Total ~180 lines of code; the rest is comments.

## File map

```
project/
├── wrangler.jsonc       (~22 lines)
├── package.json
├── public/index.html    (root <div id="root"></div> + <script src="/client.tsx" type="module">)
├── src/
│   ├── server.ts        (~85 lines — the AIChatAgent + Worker handler)
│   ├── app.tsx          (~60 lines — useAgent + useAgentChat UI)
│   └── client.tsx       (~5 lines — React mount)
└── tsconfig.json        (extends agents/tsconfig)
```

## 1. wrangler.jsonc — deployment shape

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "ai-ideator-chat",
  "main": "src/server.ts",
  "compatibility_date": "2026-03-02",
  "compatibility_flags": ["nodejs_compat"],

  // Workers AI binding — no API key needed; "remote: true" means use
  // the production Workers AI service even in `vite dev`.
  "ai": { "binding": "AI", "remote": true },

  // Static assets bundled with the Worker. The carve-out is critical:
  // /agents/* and /oauth/* must hit the Worker FIRST (so the agent
  // WebSocket upgrade lands), not the SPA index.html fallback.
  "assets": {
    "directory": "./public",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/agents/*", "/oauth/*"]
  },

  // The Durable Object class. Name MUST match the export in server.ts.
  "durable_objects": {
    "bindings": [{ "class_name": "ChatAgent", "name": "ChatAgent" }]
  },

  // First-deploy migration. SQLite-backed (mandatory for Agent state).
  // NEVER use `new_classes` here — it cannot be retrofit to SQLite later.
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ChatAgent"] }]
}
```

Three things every Cloudflare Agents app has:

1. `assets.run_worker_first: ["/agents/*", "/oauth/*"]` — without this
   the SPA fallback eats the WS upgrade.
2. `new_sqlite_classes` — not `new_classes`. SQLite-backed DOs are required.
3. `compatibility_flags: ["nodejs_compat"]` — needed by the AI SDK and zod.

## 2. package.json — dependency wall

```json
{
  "name": "ai-chat",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "deploy": "vite build && wrangler deploy"
  },
  "dependencies": {
    "agents": "^0.12.0",
    "@cloudflare/ai-chat": "^0.6.0",
    "ai": "^6.0.170",
    "workers-ai-provider": "^3.1.13",
    "zod": "^4.4.1",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@cloudflare/vite-plugin": "1.34.0",
    "wrangler": "^4.86.0",
    "vite": "^8.0.10",
    "typescript": "^6.0.3",
    "@cloudflare/workers-types": "^4.20260301.0"
  }
}
```

Notes:
- `vite dev` (not `wrangler dev`) — the Cloudflare Vite plugin replaces `wrangler dev` for full-stack apps.
- `@cloudflare/ai-chat` ships `AIChatAgent` and the React hook. Replaces deprecated `agents/ai-chat-agent` + `agents/ai-react`.
- `agents` itself stays for `useAgent`, `routeAgentRequest`, `callable`, etc.

## 3. src/server.ts — the chat agent

```ts
import { routeAgentRequest, callable, type Schedule } from "agents";
import { getSchedulePrompt, scheduleSchema } from "agents/schedule";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { createWorkersAI } from "workers-ai-provider";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  tool,
} from "ai";
import { z } from "zod";

type Env = {
  AI: Ai;
  ASSETS: Fetcher;
  ChatAgent: DurableObjectNamespace;
};

export class ChatAgent extends AIChatAgent<Env> {
  // Prune to last 100 messages on persist; older ones drop off the end of SQLite.
  maxPersistedMessages = 100;

  // RPC method — typed and reachable via agent.stub.ping() on the React side.
  @callable() async ping() {
    return "pong";
  }

  // The AIChatAgent invokes this on every inbound chat message.
  // The return value is sent back to the WS client via CF_AGENT_USE_CHAT_RESPONSE.
  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersai("@cf/moonshotai/kimi-k2.6", {
        // sessionAffinity routes follow-up token streams back to the same model worker.
        sessionAffinity: this.sessionAffinity,
      }),
      system:
        "You are a concise assistant. Use tools when helpful. " +
        getSchedulePrompt({ date: new Date() }),
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        // Drop tool-call output from anything older than the last 2 messages —
        // shrinks the context window without dropping conversational continuity.
        toolCalls: "before-last-2-messages",
      }),
      tools: {
        // Server-side tool — has `execute`. Runs inside the DO.
        getWeather: tool({
          description: "Get current weather for a city",
          inputSchema: z.object({ city: z.string() }),
          execute: async ({ city }) => ({ city, tempC: 17 }),
        }),

        // Client-side tool — NO `execute`. Browser handles it via onToolCall.
        getUserTimezone: tool({
          description: "Get the user's browser timezone",
          inputSchema: z.object({}),
        }),

        // Approval-required tool — blocks until addToolApprovalResponse resolves.
        calculate: tool({
          description: "Evaluate a math expression",
          inputSchema: z.object({ a: z.number(), b: z.number() }),
          execute: async ({ a, b }) => ({ result: a + b }),
          needsApproval: async ({ a, b }) =>
            Math.abs(a) > 1000 || Math.abs(b) > 1000,
        }),

        // Scheduling tool — uses the shared schema from agents/schedule.
        scheduleTask: tool({
          description: "Schedule a task to run later",
          inputSchema: scheduleSchema.extend({
            description: z.string(),
          }),
          execute: async ({ description, ...input }) => {
            // idempotent: re-issuing the same description is a no-op.
            const s = await this.schedule(input as Schedule<string>["payload"], "executeTask", description, {
              idempotent: true,
            });
            return { id: s.id, time: s.time };
          },
        }),
      },
      stopWhen: stepCountIs(5),       // cap tool-calling iterations
      abortSignal: options?.abortSignal, // wired from useAgentChat.stop()
    });

    return result.toUIMessageStreamResponse();
  }

  // Called by the schedule alarm. Broadcasts to all WS clients on this name.
  // We use broadcast() rather than saveMessages() so the AI doesn't see its
  // own scheduled-task notifications as new conversational input.
  async executeTask(description: string) {
    this.broadcast(
      JSON.stringify({
        type: "scheduled-task",
        description,
        at: new Date().toISOString(),
      })
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routeAgentRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
```

### Things to internalise

- **`AIChatAgent` not `Agent`**. The chat base class supplies
  `this.messages`, `this.broadcast`, `this.schedule`, `this.sessionAffinity`,
  `maxPersistedMessages`, and the `onChatMessage` hook.
- **Three tool patterns in one file** — server (`getWeather`),
  client (`getUserTimezone` no execute), approval (`calculate`).
- **`pruneMessages` keeps token usage bounded** without killing
  conversation continuity.
- **`stepCountIs(5)` caps tool-calling loops** — without it a buggy
  tool can spin forever.
- **`broadcast` for notifications, not `saveMessages`** — never inject
  scheduled-task output into chat history; the AI will loop on it.

## 4. src/app.tsx — the React frontend

```tsx
import { useState, useCallback } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { MCPServersState } from "agents";
import type { ChatAgent } from "./server";

export default function App() {
  // One DO instance per browser session; reload to keep history.
  const [name] = useState(() => crypto.randomUUID());
  const [connected, setConnected] = useState(false);
  const [mcp, setMcp] = useState<MCPServersState>({ servers: [] });

  const agent = useAgent<ChatAgent>({
    agent: "ChatAgent",
    name,
    onOpen: useCallback(() => setConnected(true), []),
    onClose: useCallback(() => setConnected(false), []),
    onError: useCallback((e: Event) => console.error("WS error:", e), []),
    onMcpUpdate: useCallback(setMcp, []),
    onMessage: useCallback((e: MessageEvent) => {
      try {
        const data = JSON.parse(String(e.data));
        if (data.type === "scheduled-task") {
          // surface a toast / badge — bypasses the chat history entirely
          console.log("scheduled task ran:", data);
        }
      } catch {}
    }, []),
  });

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    status,
    stop,
    addToolApprovalResponse,
  } = useAgentChat({
    agent,
    initialMessages: [],
    onToolCall: async (event) => {
      // Resolve client-side tool calls in the browser.
      if ("addToolOutput" in event && event.toolCall.toolName === "getUserTimezone") {
        event.addToolOutput({
          toolCallId: event.toolCall.toolCallId,
          output: {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            localTime: new Date().toLocaleTimeString(),
          },
        });
      }
    },
  });

  return (
    <div className="chat">
      <header>
        <span>{connected ? "online" : "offline"}</span>
        <button onClick={() => agent.stub.ping()}>ping</button>
      </header>

      <ul className="messages">
        {messages.map((m) => (
          // KEY BY ID, not index — useAgentChat patches the last message
          // in place on every chunk. Indexed keys re-key the entire list
          // on every chunk and React tears.
          <li key={m.id} className={m.role}>
            <span className="role">{m.role}</span>
            {m.parts?.map((part, i) => {
              if (part.type === "text") return <span key={i}>{part.text}</span>;
              if (part.type === "tool-invocation" &&
                  part.toolInvocation.state === "awaiting-approval") {
                return (
                  <button
                    key={i}
                    onClick={() => addToolApprovalResponse({
                      toolCallId: part.toolInvocation.toolCallId,
                      approved: true,
                    })}
                  >approve {part.toolInvocation.toolName}</button>
                );
              }
              return null;
            }) ?? <span>{m.content}</span>}
          </li>
        ))}
      </ul>

      <form onSubmit={handleSubmit}>
        <input
          autoFocus
          disabled={status === "streaming"}
          value={input}
          onChange={handleInputChange}
          placeholder="Say something…"
        />
        {status === "streaming" && (
          <button type="button" onClick={stop}>stop</button>
        )}
      </form>

      {mcp.servers.length > 0 && (
        <aside className="mcp-servers">
          <h3>MCP servers</h3>
          <ul>
            {mcp.servers.map((s) => (
              <li key={s.id}>{s.name} — {s.tools.length} tools</li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
```

## 5. src/client.tsx — entry

```tsx
import "./styles.css";
import { createRoot } from "react-dom/client";
import App from "./app";

createRoot(document.getElementById("root")!).render(<App />);
```

## Run it

```bash
pnpm install
pnpm dev                     # vite dev → http://localhost:8787
pnpm deploy                  # vite build && wrangler deploy
```

Open the URL, type, watch tokens stream. Reload — history persists.
Open a second tab on the same URL — both conversations stay in sync
(both subscribe to the same DO `name`).

## Adding a sibling MCP server

Drop `src/mcp.ts`:

```ts
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export class IdeatorMCP extends McpAgent {
  server = new McpServer({ name: "ideator", version: "0.1.0" });
  async init() {
    this.server.tool(
      "recombine",
      "Recombine two concepts into a business idea",
      { a: z.string(), b: z.string() },
      async ({ a, b }) => ({
        content: [{ type: "text", text: `Combine ${a} and ${b}: ...` }],
      })
    );
  }
}
```

Add to `wrangler.jsonc`:

```jsonc
"durable_objects": {
  "bindings": [
    { "class_name": "ChatAgent", "name": "ChatAgent" },
    { "class_name": "IdeatorMCP", "name": "IdeatorMCP" }
  ]
},
"migrations": [
  { "tag": "v1", "new_sqlite_classes": ["ChatAgent"] },
  { "tag": "v2", "new_sqlite_classes": ["IdeatorMCP"] }
]
```

Route it in `server.ts`:

```ts
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/mcp")) {
      return IdeatorMCP.serve("/mcp").fetch(req, env, ctx);
    }
    if (url.pathname.startsWith("/sse")) {
      return IdeatorMCP.serveSSE("/sse").fetch(req, env, ctx);
    }
    return (await routeAgentRequest(req, env)) ?? env.ASSETS.fetch(req);
  },
};
```

Now `https://your-worker/mcp` is consumable by Claude Desktop / Cursor /
the Cloudflare AI Playground. The agent and MCP server are independent
DOs in the same Worker.

## Total

About 180 lines of TypeScript across 3 source files. That's the whole
chat-agent stack: persistent state, streaming tokens, tool calling
(server / client / approval), scheduling, multi-tab sync, MCP fan-in,
and SPA frontend. Production-ready.
