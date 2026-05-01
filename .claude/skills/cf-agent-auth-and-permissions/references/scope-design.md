# Scope design for tool-based agents

OAuth scopes on an MCP server are different from OAuth scopes on a
classic web app. The LLM is the consumer. It will try anything you
register. Scopes need to map cleanly to **whether a tool exists at all
for this session**, not just to a permission check buried inside.

Sources: `cf-mcp-auth-frontend.md` §3 (auth in 1 page), §10 gotcha #14
(scope enforcement is your job), `mcp-server-cloudflare/packages/mcp-common`.

---

## The pattern: `verb:resource`

| Scope | Grants |
|---|---|
| `read:account` | Tools that read user account / profile data |
| `write:account` | Tools that mutate account settings |
| `read:billing` | Read invoices, subscriptions, usage |
| `write:billing` | Charge, refund, cancel, change plan |
| `read:files` | List / read user files |
| `write:files` | Create / delete / move files |
| `read:*` | Sugar — every `read:*` scope |
| `write:*` | Every `write:*` (implies all `read:*`) |
| `admin` | Side channel; only for staff tools |

Why `verb:resource` over alternatives:

- It's how every major IdP shapes scopes (Google `https://www.googleapis.com/auth/drive.readonly`, GitHub `repo`/`user:email`, Slack `chat:write`). MCP clients are used to this format.
- It maps cleanly to tool names. If the tool is `listInvoices`, it
  wants `read:billing`. If it's `refundInvoice`, it wants
  `write:billing`. Mechanical mapping → fewer mistakes.
- It composes. `write:*` is unambiguous shorthand for "all the write
  scopes". `admin` is unambiguous for "above all of those".

---

## Anti-patterns

| Anti-pattern | Why it bites |
|---|---|
| One mega-scope `app` that grants everything | LLM gets keys to the kingdom; users can't grant partial access; audit log can't differentiate |
| Per-tool scopes (`refund-invoice`, `list-invoices`) | Explodes combinatorially; consent screen becomes a wall of checkboxes |
| Action verbs only (`refund`, `charge`) | What's the resource? Refund what? Two unrelated tools sharing a verb get the same scope |
| Hidden `admin` scope you never grant in the UI | Inevitable foot-gun where someone hardcodes a token with `admin` for "testing" and forgets to revoke |

---

## Mapping scopes to tool gating in the agent

Two valid styles. **Prefer (b)** — conditional registration. The LLM
literally cannot attempt a tool that isn't on the server.

### (a) Runtime check

```ts
this.server.tool("refundInvoice", "...", { id: z.string() }, async ({ id }) => {
  if (!this.props.permissions?.includes("write:billing")) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: "Insufficient scope. This tool requires write:billing.",
      }],
    };
  }
  // ... do the refund
});
```

Pros: simple, shows up in logs as a "tried-and-blocked" event.
Cons: LLM wastes tokens trying it; tool's existence leaks information
to a user who doesn't have access.

### (b) Conditional registration

```ts
async init() {
  const perms = this.props.permissions ?? [];

  // Always-on
  this.server.tool("whoami", "...", {}, async () => ({
    content: [{ type: "text", text: this.props.claims.name }],
  }));

  // Read-tier
  if (perms.includes("read:billing") || perms.includes("read:*")) {
    this.server.tool("listInvoices", "...", {}, async () => { /* ... */ });
  }

  // Write-tier
  if (perms.includes("write:billing") || perms.includes("write:*")) {
    this.server.tool("refundInvoice", "...", { id: z.string() }, async ({ id }) => {
      // ... do the refund
    }, { needsApproval: true }); // human-in-the-loop on top
  }

  // Admin-tier
  if (perms.includes("admin")) {
    this.server.tool("forceCloseAccount", "...", { userId: z.string() }, async ({ userId }) => {
      // ...
    }, { needsApproval: true });
  }
}
```

Pros: LLM can't try what isn't there; smaller tool list = faster
inference + cheaper. Tool's very existence is gated.
Cons: Slightly more code; can't "softly" expose with an error message.

### Helper

```ts
function hasScope(perms: string[], scope: string): boolean {
  if (perms.includes(scope)) return true;
  // Wildcard expansion
  const [verb] = scope.split(":");
  if (perms.includes(`${verb}:*`)) return true;
  if (perms.includes("admin")) return true;
  return false;
}

// usage in init()
if (hasScope(this.props.permissions ?? [], "write:billing")) {
  this.server.tool("refund", ...);
}
```

---

## `needsApproval` for destructive tools

Even with the right scope, destructive tools (`refund`, `delete*`,
`transfer`, `forceClose*`) should require human-in-the-loop confirmation
in the MCP client. This is a layer on top of scope check, not a
replacement.

```ts
this.server.tool(
  "refundInvoice",
  "Refund an invoice. Requires user confirmation.",
  { id: z.string() },
  async ({ id }) => { /* ... */ },
  { needsApproval: true }
);
```

The MCP client renders an approval prompt to the user. Source pattern:
`agents-starter/src/tools.ts` — the `calculate` tool with
`needsApproval`.

---

## The scope-bump flow

User hits a tool that requires a scope they don't have. Two sane
responses:

1. **(b) Conditional registration:** the tool isn't there, the LLM
   never tries. The agent might say "I can't do that" naturally because
   the tool's not in its tool list. Done.
2. **(a) Runtime check:** the tool returns a structured error. The LLM
   reads it and tells the user. The user can then re-auth with extra
   scopes via the MCP client's "reconnect / reauthorize" flow, which
   triggers `workers-oauth-provider` to re-issue with elevated scope.

For pattern 2, the error message format that LLMs handle well:

```
{
  isError: true,
  content: [{
    type: "text",
    text: "Insufficient scope: write:billing required. " +
          "Re-authorize with the 'write:billing' scope to use this tool.",
  }]
}
```

Don't put a URL in the error — the LLM will try to navigate it and
that's not what reauth is.

---

## Scope catalog — example for a billing-and-files MCP server

```yaml
# scopes.yaml — author-time reference
read:account:
  description: Read your account profile, organization membership, settings
  tools: [whoami, getOrg, getSettings]

write:account:
  description: Modify your account profile and settings
  tools: [updateProfile, updateSettings]

read:billing:
  description: View invoices, subscriptions, usage
  tools: [listInvoices, getInvoice, getSubscription, getUsage]

write:billing:
  description: Charge cards, issue refunds, change plan
  tools: [chargeCard, refundInvoice, changePlan, cancelSubscription]
  destructive: [refundInvoice, cancelSubscription]   # → needsApproval

read:files:
  description: List and read your files
  tools: [listFiles, readFile, getFileMetadata]

write:files:
  description: Create, modify, and delete your files
  tools: [createFile, updateFile, deleteFile, moveFile]
  destructive: [deleteFile, moveFile]                # → needsApproval

admin:
  description: Staff-only tools. Never granted to end users.
  tools: [forceCloseAccount, viewAuditLog, impersonateUser]
  destructive: all
```

Drive both `scopesSupported` in the OAuth provider and the conditional
`init()` registration off this catalog.

---

## Consent-screen UX

The consent screen is your `defaultHandler` rendering before redirecting
to the IdP. Show the user:

1. The application name (registered via DCR).
2. A list of requested scopes, with the human-readable `description`
   from the catalog.
3. A clear "Allow" / "Deny" choice.

GitHub / Google handle their own consent screen; you only render yours
if you're self-hosted (Posture 4) or you want to gate "this app got
write:billing" with an extra confirmation. Most prod setups skip
custom consent and let the IdP do it.
