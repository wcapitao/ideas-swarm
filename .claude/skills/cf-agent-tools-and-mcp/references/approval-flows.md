# Approval flows

Three approval mechanisms exist on Cloudflare. They are NOT
interchangeable — picking the wrong one means your "dangerous tool" is
either un-gated or un-callable.

| Mechanism | Where it lives | Who gates | Bypassed by |
|-----------|----------------|-----------|-------------|
| `tool({ needsApproval })` | AI SDK tool def, used inside `streamText({ tools })` on `AIChatAgent` | The chat UI (browser) | **codemode** (cf-agents-core §15) |
| MCP elicitation | Inside an `McpAgent` tool handler | The MCP client (Claude Desktop, Inspector) | Clients that don't implement elicitation |
| `waitForApproval(step, opts)` | Inside an `AgentWorkflow` step | Whoever calls `this.approveWorkflow(id)` | nothing — durable, multi-day timeouts |

---

## 1. `needsApproval` — the chat tool flow

```
User types message
  -> AIChatAgent.onChatMessage()
  -> streamText({ tools: { dangerousTool: tool({ needsApproval, execute }) } })
  -> Model emits tool call
  -> AI SDK runs needsApproval(input)
       returns true  -> tool message in UI stream with state="approval-required"
       returns false -> execute(input) runs immediately
  -> React side renders an approval button via useAgentChat
  -> Browser calls addToolApprovalResponse(toolCallId, approved: boolean)
  -> AI SDK either:
       calls execute(input)        if approved
       returns rejection to model  if denied
```

Source: cf-mcp-auth-frontend §7, agents-starter `src/server.ts` (the
`calculate` tool with `needsApproval: async ({ a, b }) => Math.abs(a) > 1000`).

### Code shape

```ts
import { tool } from "ai";
import { z } from "zod";

processPayment: tool({
  description: "Charge the user's saved payment method.",
  inputSchema: z.object({
    amountUsd: z.number().min(0.01),
    recipient: z.string(),
  }),
  needsApproval: async ({ amountUsd }) => amountUsd > 100,
  execute: async ({ amountUsd, recipient }) => {
    return await charge(recipient, amountUsd);
  },
}),
```

### React side

```tsx
const { messages, addToolApprovalResponse } = useAgentChat({ agent, ... });

// In the message renderer, when you see a tool message with state "approval-required":
<button onClick={() => addToolApprovalResponse(toolCallId, true)}>Approve</button>
<button onClick={() => addToolApprovalResponse(toolCallId, false)}>Deny</button>
```

### Codemode bypass — the gotcha

**This is the load-bearing footgun.** From cf-agents-core §15:

> "**`needsApproval` is *not* honored** in codemode — approval-required
> tools execute immediately."

Why: codemode lets the LLM write JS that imports your tools and calls
`execute()` directly, skipping the `needsApproval` check. If you have
`tools: { dangerousTool, ... }` and pass that map into `createCodeTool`,
the LLM-authored code can run `dangerousTool.execute(...)` without
prompting.

**Fix:** for any tool that is dangerous in either path:

```ts
processPayment: tool({
  description: "...",
  inputSchema: z.object({ amountUsd: z.number(), recipient: z.string() }),
  needsApproval: async ({ amountUsd }) => amountUsd > 100,
  execute: async ({ amountUsd, recipient }) => {
    // Defense in depth — also gate inside execute so codemode can't bypass.
    if (amountUsd > 100) {
      const approved = await checkOutOfBandApproval(/* ... */);
      if (!approved) {
        return { error: "approval required and not granted" };
      }
    }
    return await charge(recipient, amountUsd);
  },
}),
```

Or simpler: don't pass dangerous tools to `createCodeTool`. Maintain
two tool maps — one for codemode (read-only) and one for the chat
surface (full).

---

## 2. MCP elicitation — for `McpAgent` tools

MCP has its own approval primitive. Inside a tool handler:

```ts
this.server.tool(
  "transfer_funds",
  "Transfer money from one account to another.",
  { from: z.string().uuid(), to: z.string().uuid(), amountUsd: z.number() },
  async ({ from, to, amountUsd }, extra) => {
    if (amountUsd > 100) {
      const r = await this.server.server.elicitInput(
        {
          message: `Confirm transfer of $${amountUsd} from ${from} to ${to}?`,
          requestedSchema: {
            type: "object",
            properties: { confirm: { type: "boolean" } },
            required: ["confirm"],
          },
        },
        { relatedRequestId: extra.requestId },
      );
      if (r.action !== "accept" || !r.content?.confirm) {
        return {
          isError: true,
          content: [{ type: "text", text: "User declined the transfer." }],
        };
      }
    }
    const txId = await transfer(from, to, amountUsd);
    return { content: [{ type: "text", text: `OK: ${txId}` }] };
  },
);
```

### Client compatibility

Not all MCP clients implement elicitation. As of early 2026:

- **Claude Desktop**: yes
- **Cursor**: partial (depends on version)
- **MCP Inspector**: yes
- **`mcp-remote` bridge**: passes through, depends on downstream client

Always handle the no-support path. The SDK throws / returns an error
result if the client refuses the elicitation request.

```ts
try {
  const r = await this.server.server.elicitInput(/* ... */);
  // ...
} catch (e) {
  // Client doesn't support elicitation — fall back to a default-deny
  return {
    isError: true,
    content: [{ type: "text", text: "Confirmation required, but client does not support it. Aborting." }],
  };
}
```

---

## 3. `waitForApproval` — durable workflow gate

For multi-day approvals (e.g. a manager has to approve a refund), use
the workflow path. cf-agents-core §13.

```ts
// inside an AgentWorkflow
async run(event, step) {
  await step.do("notify-approver", async () => sendEmail(approverEmail, "Approve?"));
  await this.waitForApproval(step, { timeout: "7 days" });   // suspends durably
  await step.do("execute-refund", async () => refund(/* ... */));
}

// inside the agent
@callable() async approve(workflowId: string, reason: string) {
  await this.approveWorkflow(workflowId, { reason, metadata: { approvedBy: this.props?.userId } });
}
```

This is the only mechanism that survives DO hibernation, Worker
deploys, and multi-day pauses. Use for anything that would block a
chat session for more than a few minutes.

---

## State diagram (chat needsApproval flow)

```
                  +------------------+
                  | model emits call |
                  +------------------+
                            |
                            v
                  +---------------------+
                  | run needsApproval() |
                  +---------------------+
                       /            \
                false /              \ true
                     v                v
            +----------+      +-------------------+
            | execute  |      | UI: approval-     |
            +----------+      | required state    |
                  |           +-------------------+
                  |                    |
                  |             user clicks button
                  |                    |
                  |             +-------------+
                  |             | addToolApp- |
                  |             | rovalResp.. |
                  |             +-------------+
                  |                    |
                  |               approved?
                  |                /     \
                  |              yes      no
                  |              /         \
                  |             v           v
                  |       +---------+  +---------------+
                  |       | execute |  | tool result:  |
                  |       +---------+  | "user denied" |
                  |             |      +---------------+
                  v             v             |
            +-----------------+               |
            | tool result -> model            |
            +-----------------+ <------- ------
                            |
                            v
            +------------------------+
            | model continues turn   |
            +------------------------+
```
