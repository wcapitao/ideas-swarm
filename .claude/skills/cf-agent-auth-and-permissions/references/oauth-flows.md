# OAuth flows — the four `workers-oauth-provider` patterns

Side-by-side reference for the four legal auth postures of a Cloudflare
agent. Each section is a drop-in skeleton: copy, change the IdP-specific
bits, deploy.

Sources: `cloudflare/workers-oauth-provider/README.md`,
`developers.cloudflare.com/agents/model-context-protocol/authorization/`,
`cloudflare/mcp-server-cloudflare/apps/workers-bindings/`.

---

## Posture 1 — Cloudflare Access in front (single SSO)

Use when: only your org's users should reach the agent, and you already
have Cloudflare Access set up. Zero application-side OAuth code.

### Setup

1. In the Cloudflare dashboard → Zero Trust → Access → Applications,
   create a Self-hosted application pointed at your Worker's hostname.
2. Configure your IdP (Google Workspace, Okta, Azure AD, GitHub Org).
3. Bind your access policy (e.g. `email ends with @yourorg.com`).

### Worker

```ts
// src/index.ts
import { CalculatorMCP } from "./mcp.js";

type Env = { MCP_OBJECT: DurableObjectNamespace };

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    // Cloudflare Access has already authenticated the request.
    // Read the JWT for identity. The header is set automatically.
    const jwt = req.headers.get("Cf-Access-Jwt-Assertion");
    if (!jwt) {
      return new Response("Unauthorized", { status: 401 });
    }

    // OPTIONAL: verify the JWT against your team domain's JWKS.
    // (Cloudflare's edge already verified it, but verify again if you
    // expose origin to anything other than Access.)
    const claims = decodeJwtClaims(jwt); // your helper

    const url = new URL(req.url);
    if (url.pathname.startsWith("/sse"))
      return CalculatorMCP.serveSSE("/sse").fetch(req, env, ctx);
    if (url.pathname.startsWith("/mcp"))
      return CalculatorMCP.serve("/mcp").fetch(req, env, ctx);
    return new Response("Not found", { status: 404 });
  },
};
```

The `McpAgent` reads identity from `req` (you can plumb it into props
via a custom `serve` wrapper) or via `getMcpAuthContext()` if you use
`createMcpHandler`.

### Pros / cons

| Pros | Cons |
|---|---|
| Zero OAuth code in your Worker | Single-tenant — only your org's IdP |
| Reuses existing SSO + group policy | MCP clients must support sending Access cookies / Service Tokens |
| Easy to revoke a user (at the IdP) | Public MCP clients (Claude Desktop, etc.) usually can't talk to Access without the `cloudflared` warp client |

---

## Posture 2 — Third-party IdP (GitHub / Google)

Use when: you want anyone-with-a-GitHub-account (or Google account) to
use your MCP server. This is the canonical public MCP server shape.

### Worker (entrypoint)

```ts
// src/index.ts
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { CalculatorMCP } from "./mcp.js";
import { GitHubHandler } from "./github-handler.js";

type Env = {
  OAUTH_KV: KVNamespace;
  MCP_OBJECT: DurableObjectNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
};

export default new OAuthProvider({
  apiHandlers: {
    "/sse": CalculatorMCP.serveSSE("/sse"),
    "/mcp": CalculatorMCP.serve("/mcp"),
  },
  defaultHandler: GitHubHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["read", "write", "profile"],
  allowImplicitFlow: false,
  allowPlainPKCE: false,
});
```

### `github-handler.ts` (the consent-screen handler)

```ts
// src/github-handler.ts
import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

app.get("/authorize", async (c) => {
  // workers-oauth-provider has parsed the inbound oauth request and
  // stashed it. Pull it back out:
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  // Stash it in a cookie for the callback. Real impls sign this cookie.
  const state = btoa(JSON.stringify(oauthReqInfo));
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${new URL(c.req.url).origin}/oauth/callback`);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  return c.redirect(url.toString());
});

app.get("/oauth/callback", async (c) => {
  const code = c.req.query("code")!;
  const state = c.req.query("state")!;
  const oauthReqInfo = JSON.parse(atob(state));

  // Exchange the GitHub code for a GitHub access token.
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const { access_token } = await tokenRes.json<{ access_token: string }>();

  // Identify the user.
  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${access_token}`, "User-Agent": "my-mcp" },
  });
  const user = await userRes.json<{ id: number; login: string; email: string }>();

  // THE CHOKEPOINT — issue our OAuth token to the MCP client and stash
  // the GitHub upstream token as `props` for the agent.
  return c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: String(user.id),
    scope: "read write profile",
    props: {
      githubAccessToken: access_token,  // upstream token → this.props
      login: user.login,
      claims: { sub: String(user.id), name: user.login, email: user.email },
      permissions: ["read:account", "read:billing"], // your derived perms
    },
    metadata: { provider: "github" },
  });
});

export const GitHubHandler = app;
```

### `wrangler.jsonc`

```jsonc
{
  "name": "my-mcp-server",
  "main": "src/index.ts",
  "compatibility_date": "2025-04-01",
  "compatibility_flags": ["nodejs_compat"],
  "kv_namespaces": [{ "binding": "OAUTH_KV", "id": "..." }],
  "durable_objects": {
    "bindings": [{ "name": "MCP_OBJECT", "class_name": "CalculatorMCP" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["CalculatorMCP"] }],
  "secrets": { "required": ["GITHUB_CLIENT_SECRET"] },
  "vars": { "GITHUB_CLIENT_ID": "Iv1.abc123" }
}
```

### Pros / cons

| Pros | Cons |
|---|---|
| Anyone with a GitHub account can use it | You're now an OAuth server — RFC 9728 metadata, KV, refresh-token rotation |
| Industry-standard, MCP-spec-aligned | Requires consent-screen UX (or just redirect, as shown) |
| MCP Inspector + Claude Desktop both work via DCR | GitHub rate-limits your client_id |

---

## Posture 3 — BYO IdP (Stytch / Auth0 / WorkOS / Descope)

Same shape as Posture 2 — `workers-oauth-provider` is still the
entrypoint, you still write a `defaultHandler`, you still call
`completeAuthorization`. The differences are entirely inside the
handler:

- The redirect target is your IdP's OAuth endpoint instead of GitHub's.
- The token exchange uses your IdP's `/oauth/token`.
- The user-info endpoint is your IdP's `/userinfo`.
- Permissions / org-membership probably come from the IdP's claim
  payload, not derived from your DB.

### Why use this over Posture 2

- You already have Stytch/Auth0/WorkOS for your main app — share the user pool.
- B2B multi-tenant — WorkOS gives you SSO connections per customer org.
- You need MFA, SCIM, magic links — IdPs do this, GitHub doesn't.

Reference repos:
- `stytchauth/mcp-stytch-consumer-todo-list` (consumer auth)
- `stytchauth/mcp-stytch-b2b-okr-manager` (B2B multi-tenant)

The shape of `defaultHandler.fetch` is identical to GitHubHandler above
— swap the URLs, swap the user-info parsing.

---

## Posture 4 — Self-hosted (your Worker handles everything)

Use when: you don't want a third-party IdP at all. Your Worker stores
user records, hashes passwords, sends magic-link emails. Rare; usually
overkill. Same shape as Posture 2 but `defaultHandler` renders your own
HTML login form and verifies passwords / tokens against a D1 table or
KV.

Use Stytch / Auth0 / WorkOS unless you really, really want to be in the
identity-storage business. You don't.

---

## Common: production hardening for Postures 2-4

These apply identically across the three OAuth-provider postures.

### Rate limit the protected handler

```ts
// Wrap each apiHandler with the Workers Rate Limiting binding,
// keyed by props.userId so authenticated users get their own bucket.
const rateLimited = (inner: { fetch: (...args: any[]) => Promise<Response> }) => ({
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const userId = (ctx as any).props?.userId ?? "anon";
    const { success } = await env.RATE_LIMITER.limit({ key: userId });
    if (!success) return new Response("Rate limited", { status: 429 });
    return inner.fetch(req, env, ctx);
  },
});

export default new OAuthProvider({
  apiHandlers: {
    "/sse": rateLimited(CalculatorMCP.serveSSE("/sse")),
    "/mcp": rateLimited(CalculatorMCP.serve("/mcp")),
  },
  // ...
});
```

### CORS for browser-based clients

```ts
CalculatorMCP.serve("/mcp", {
  corsOptions: {
    origin: "*", // or specific origins
    headers: ["Content-Type", "Authorization", "mcp-session-id"],
    methods: ["GET", "POST", "OPTIONS"],
    maxAge: 86400,
  },
});
```

The `mcp-session-id` header is REQUIRED for streamable HTTP multi-turn.
If a proxy strips it, your MCP server appears stateless to the client
and every call looks like a new session.

### `/.well-known/oauth-protected-resource` (RFC 9728)

`workers-oauth-provider` serves this automatically — clients use it to
discover the auth server. Verify with:

```bash
curl https://your-mcp.example.com/.well-known/oauth-protected-resource
# Should return JSON pointing at your authorization_servers
```

If you put a CDN or reverse proxy in front, make sure `/.well-known/*`
isn't cached aggressively or rewritten.
