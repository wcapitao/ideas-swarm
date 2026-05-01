---
name: cf-agent-state-and-storage
description: >
  Decides where state lives in a Cloudflare Agent — the DO state model
  (`setState`/`initialState`/`validateStateChange`), the three storage APIs on
  one SQLite (sync KV, async KV, SQL), `wrangler.jsonc` migrations, and the
  cross-instance store choice (Vectorize / R2 / KV / D1). Activates when the
  user asks about "agent state", "DO storage", "SQL on the agent", "broadcast
  to clients", "hibernation", "Vectorize index", "schema migration", "where do
  I store X", "this.setState vs this.sql", "secret in agent state", or
  diagnoses state-vs-schema drift, hibernation data loss, or migration tag
  errors. Do NOT use for prompt-tuning, model selection, or HTTP routing —
  hand off to the relevant skill instead.
---

# cf-agent-state-and-storage

> Storage decisions are irreversible more often than you think. SQLite-vs-KV is permanent. Vector dimensions are permanent. Migration tags are append-only. Make the call once, with this skill open.

## When this skill fires

The user is doing one of:

| Trigger | What they're really asking |
|---|---|
| "where should I store X" | The 5-tier decision (below) |
| "broadcast it to clients" | `setState` — and is it secret? |
| "I lost data after the DO went idle" | Hibernation gotcha — in-memory fields |
| "schema migration" / "wrangler migration" | The 5 migration recipes |
| "Vectorize index" / "embedding store" | Vectorize vs DO SQL vs both |
| "DO storage cap" / "SQLITE_FULL" | The 10 GB ceiling, when to spill to R2 |
| "tokens in this.state" | **STOP** — read `references/secret-vs-state.md` |

---

## Cross-cutting non-negotiables

These are SKILL_CATALOG.md rules every Cloudflare-agent skill enforces:

1. **Never broadcast secrets.** `setState` writes the JSON-serialized payload to every connected client via `cf_agent_state`. Tokens, API keys, OAuth refresh tokens never go through `setState`. Use `this.sql` or `this.ctx.storage.put` directly. (cf-mcp-auth-frontend §10 #1)
2. **Always SQLite-backed.** `new_sqlite_classes`, never `new_classes`. The choice is permanent — "you cannot enable a SQLite storage backend on an existing, deployed Durable Object class" (cf-runtime-primitives §5).
3. **Migration tags are append-only.** Unique forever within a script, never edited, never reordered (cf-agents-core §15 — Wrangler / migrations).
4. **In-memory fields die on hibernation.** Only `this.state`, `this.sql`, and `ctx.storage` survive (cf-runtime-primitives §4, cf-agents-core §15 — Hibernation).
5. **Vectorize dimensions are immutable.** Switching embedding model = new index + full re-embed (cf-ai-stack §10 #2).

---

## The 5-tier storage decision

For each thing the agent stores, walk this table top to bottom. The first row that fits is the answer.

| # | Shape of data | API | Reach | Cap | Picks itself when |
|---|---|---|---|---|---|
| 1 | Per-instance, transactional, small (<10 MB), **client-broadcastable** JSON | `this.setState({...})` | This DO instance + all WS clients | 1 GB / instance soft (state lives in SQLite) | UI binds to it. No secrets. |
| 2 | Per-instance, transactional, **structured/queryable** | `` this.sql`SELECT ...` `` (SQLite) | This DO instance only | 10 GB / DO | Lots of rows, joins, ordered scans, FTS5 |
| 3 | Per-instance, **secrets / large blobs / private** | `this.ctx.storage.put` / `this.ctx.storage.kv.put` | This DO instance only, **no broadcast** | 10 GB / DO | OAuth tokens, API keys, opaque blobs |
| 4 | **Cross-instance vector** | Vectorize binding (`env.MY_INDEX.query`) | Globally shared | 10 M vectors / index, 1,536 dim max | Embeddings, similarity search across many agents |
| 5 | **Cross-instance blob/KV/relational** | R2 / KV / D1 | Globally shared | varies | One source of truth across many DO instances |

### Tier 1 in detail — `this.setState`

```ts
this.setState({ ...this.state, count: this.state.count + 1 });
```

`setState` runs three steps **in order** (cf-agents-core §2):
1. Persist to SQLite (in the agent's own DB).
2. Broadcast `cf_agent_state` JSON frame to every connected WebSocket (skipping clients where `shouldSendProtocolMessages()` returned false).
3. Best-effort call `onStateChanged()`.

Constraints:
- **JSON-serializable only.** Functions, `Date`, `Map`, `Set` do not survive. Use ISO strings (cf-agents-core §15 — State).
- **Validate in `validateStateChange()`, not `onStateChanged()`.** The latter is a notification hook, fires after broadcast, must not block.
- **Mutate via `setState`, never `this.state.x = y`.** Direct mutation skips persist + broadcast (cf-agents-core §15 — State).

### Tier 2 in detail — `this.sql`

```ts
this.sql`CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, body TEXT)`;
this.sql`INSERT INTO notes (id, body) VALUES (${id}, ${body})`;
const rows = this.sql<{ id: string; body: string }>`SELECT * FROM notes WHERE id = ${id}`;
```

Tagged-template values become bound params (no string injection). Returns rows as a typed array. Backed by the same SQLite DB as `this.state` — they share the 10 GB cap. Use this when the data is too structured for JSON state, or has too many rows to broadcast.

### Tier 3 in detail — raw `ctx.storage`

```ts
// Sync KV (SQLite-backed only) — fast path, returns synchronously
this.ctx.storage.kv.put("oauth_refresh_token", encrypted);
const tok = this.ctx.storage.kv.get<string>("oauth_refresh_token");

// Async KV (works on both backends)
await this.ctx.storage.put("session_blob", largeBuffer);
```

This is for things that **must not** ride the WS broadcast — secrets and private blobs. Same SQLite DB, different table (`__cf_kv` for the sync KV path); same 10 GB cap.

### Tier 4 in detail — Vectorize

Use when embeddings serve **multiple agent instances** (e.g. a shared concept index queried from any per-user agent). If one instance owns all the embeddings, put them in DO SQL. The dimension/metric lock-in is the killer constraint — see `references/storage-decision-tree.md` §"Vectorize vs DO SQL".

### Tier 5 in detail — R2 / KV / D1

| Pick | When |
|---|---|
| **R2** | Blobs ≥ 128 KB, files, model artifacts, audio, source documents for RAG. Free egress. |
| **KV** | Cross-region cached config, allow-lists, OAuth approved-clients registry. Eventual consistency (60 s typical). Don't use for monotonic counters. |
| **D1** | Cross-instance relational. Multi-tenant tables that can't shard per-DO. ≤ 10 GB / DB. |

R2 + DO SQL is the most common combo: R2 for the blob, DO SQL for the per-instance metadata pointer.

---

## Three APIs on one DO

A SQLite-backed DO exposes **three** APIs that all sit on top of the same SQLite database (cf-runtime-primitives §2):

| API | Sync? | Use for | Backed by |
|---|---|---|---|
| `ctx.storage.kv.get/put/delete/list` | **Synchronous** (no `await`) | Hot per-row reads/writes | Hidden `__cf_kv` SQLite table |
| `ctx.storage.get/put/delete/list` | Async (legacy shape) | Backwards-compat code, generic blob KV | Same `__cf_kv` table |
| `ctx.storage.sql.exec(query, ...binds)` | Async cursor | Joins, ordered scans, FTS5, JSON funcs | Your CREATE-TABLE schema |

You also get **Point-in-Time Recovery** — rewind the entire DB up to 30 days back via `ctx.storage.getCurrentBookmark` / `onNextSessionRestoreBookmark`. PITR is **only on the SQLite backend**.

### The "always start SQLite-backed" rule (irreversible)

```jsonc
// wrangler.jsonc — RIGHT
"migrations": [
  { "tag": "v1", "new_sqlite_classes": ["MyAgent"] }
]

// WRONG — legacy KV-backed, you can't ever convert it
"migrations": [
  { "tag": "v1", "new_classes": ["MyAgent"] }
]
```

Run `scripts/migration-lint.sh` on every change to `wrangler.jsonc` — it warns loudly on `new_classes`.

The Agents SDK convention: every new agent class goes into `new_sqlite_classes`. The `agents/` package literally requires SQLite for its scheduler tables.

---

## Hibernation and state — the survival matrix

A hibernated DO is evicted from memory while keeping its WebSocket connections alive on the Cloudflare edge. On the next event the constructor re-runs and the appropriate handler fires (cf-runtime-primitives §4).

What survives, what doesn't:

| Thing | Survives hibernation? |
|---|---|
| `this.state` (set via `setState`) | YES — persisted to SQLite |
| `this.sql` rows | YES — SQLite |
| `this.ctx.storage.*` | YES — SQLite |
| `this.foo = ...` (in-memory class field) | **NO** — gone on wake |
| `setInterval` / `setTimeout` | **NO** — use `schedule()` / `setAlarm` |
| Open promises / closures | **NO** |
| `ws.serializeAttachment(value)` | YES — but **2,048-byte cap**, structured-clone only |
| Connection objects (`this.ctx.getWebSockets()`) | YES — lazy-rehydrated on first access |

### The `serializeAttachment` 2 KB ceiling

Per-connection state — small JSON only:

```ts
this.ctx.acceptWebSocket(server, ["user:alice"]);
server.serializeAttachment({ userId: "alice", joinedAt: Date.now() }); // <2KB

// later, on wake:
async webSocketMessage(ws: WebSocket, msg: string) {
  const { userId } = ws.deserializeAttachment() ?? {};
}
```

Anything bigger → key it from a small attachment and store the body in `this.sql`. A common pattern:

```ts
server.serializeAttachment({ connId: crypto.randomUUID(), userId });
this.sql`INSERT INTO conn_state (conn_id, blob) VALUES (${connId}, ${JSON.stringify(big)})`;
```

### `acceptWebSocket` not `accept`

Reiterating the cross-cutting rule (cf-runtime-primitives §4):

```ts
// WRONG — billed continuously, no hibernation
server.accept();

// RIGHT — DO can hibernate, clients stay connected
this.ctx.acceptWebSocket(server);
```

The cost differential is ~11k GB-s/day per connection vs ~zero. Always `acceptWebSocket`.

### Long work in a hibernating agent

Don't spin in `setInterval`. Use:
- `this.schedule(time, "methodName", payload)` — Agent SDK scheduler (alarms under the hood).
- `keepAliveWhile(promise)` — hold off hibernation while a specific promise resolves.
- Delegate to a Workflow and let the agent hibernate; the workflow writes back via `step.updateAgentState`.

---

## Migrations cookbook — five worked recipes

Every migration has a **unique tag**, append-only, never reordered (cf-runtime-primitives §5; cf-agents-core §15). The runtime applies tags it hasn't seen yet, in order. Tags are atomic — you cannot gradually deploy a migration.

### Recipe 1 — Add a new SQLite-backed DO class

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "AGENT", "class_name": "MyAgent" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["MyAgent"] }
  ]
}
```

### Recipe 2 — Add a column (in-DB, not a wrangler migration)

Wrangler migrations are class-lifecycle only. Schema *inside* the DB is your job. The Agents SDK convention is to run idempotent DDL in `onStart()`:

```ts
async onStart() {
  this.sql`CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, body TEXT)`;
  // Idempotent column add — SQLite errors on duplicate, swallow it
  try {
    this.sql`ALTER TABLE notes ADD COLUMN created_at INTEGER`;
  } catch (e) {
    if (!String(e).includes("duplicate column")) throw e;
  }
}
```

(For raw DOs without the Agents SDK, do the same thing inside `ctx.blockConcurrencyWhile(() => ...)` in the constructor — cf-runtime-primitives §2.)

### Recipe 3 — Rename a DO class

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "AGENT", "class_name": "MyAgentV2" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["MyAgent"] },
    {
      "tag": "v2",
      "renamed_classes": [
        { "from": "MyAgent", "to": "MyAgentV2" }
      ]
    }
  ]
}
```

Do NOT pre-create the destination class via `new_sqlite_classes` — the migration creates it.

### Recipe 4 — Delete a DO class (DESTROYS DATA)

```jsonc
{
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["MyAgent"] },
    { "tag": "v3", "deleted_classes": ["DeprecatedAgent"] }
  ]
}
```

Remove the binding and all code references first. **Every instance's data is gone forever.** No undo. (cf-runtime-primitives §5; cf-agents-core §15.)

### Recipe 5 — Transfer a class between Worker scripts

```jsonc
{
  "migrations": [
    {
      "tag": "v4",
      "transferred_classes": [
        { "from": "MyAgent", "from_script": "old-worker", "to": "MyAgent" }
      ]
    }
  ]
}
```

Use this when splitting a monolith Worker into multiple scripts and you need the new script to inherit the existing DO instances.

### Lint your migrations

`scripts/migration-lint.sh` parses `wrangler.jsonc` and enforces:
- Tags unique + monotonically increasing.
- Every `new_sqlite_classes` has a matching `bindings` entry.
- No `new_classes` (warn loudly — KV-backed, irreversible).
- Every `renamed_classes` entry has both `from` and `to`.

Hand-off: run this in CI via `cf-agent-deploy-and-observe`.

---

## Never broadcast secrets

The single most expensive class of bug:

```ts
// WRONG — this.state is broadcast to every connected browser
this.setState({
  ...this.state,
  oauthRefreshToken: token,        // leaked
  upstreamApiKey: env.SECRET,      // leaked
});
```

`setState` performs a `cf_agent_state` broadcast — payload visible to every WebSocket peer, including any browser that connected before you knew it shouldn't have (cf-mcp-auth-frontend §10 #1). The broadcast happens **after** persist but **before** `onStateChanged`, so even short-lived secrets escape.

The right shapes:

```ts
// Right shape #1 — private SQL table
this.sql`INSERT OR REPLACE INTO secrets (key, value) VALUES (${"oauth_refresh"}, ${token})`;

// Right shape #2 — sync KV, never broadcast
this.ctx.storage.kv.put("oauth_refresh", token);

// Right shape #3 — props, server-only, persisted by McpAgent.onStart
await this.updateProps({ ...this.props, oauthRefreshToken: token });
```

`this.props` is the McpAgent pattern — restored from `ctx.storage.get("props")` on hibernation wake (cf-mcp-auth-frontend §10 #4). It's the canonical place for per-session secrets in MCP agents. **Never assign `this.props = ...` directly without `updateProps` — direct assignment skips the persist step and hibernation drops it silently.**

See `references/secret-vs-state.md` for the full taxonomy of what goes where.

---

## Embedding storage — Vectorize vs DO SQL vs both

Three patterns. Pick by reach and lifetime:

| Pattern | Use when |
|---|---|
| **Vectorize only** | Embeddings shared across many agent instances. Globally available. Cross-tenant unless you use `namespace` per tenant. |
| **DO SQL only** | Embeddings unique to one agent instance (e.g. per-user memory). ≤ 10 GB. No similarity-search-at-scale, but FTS5 + manual cosine works for small sets. |
| **Both** | Vectorize is the index, DO SQL is the per-instance cache + denormalized blob (avoids the round-trip on every query). |

### Dimension lock-in (cf-ai-stack §10 #2)

```bash
# Pick once, live with it
npx wrangler vectorize create concepts --dimensions=768 --metric=cosine
```

You cannot change `--dimensions` or `--metric` post-creation. Switching from `@cf/baai/bge-base-en-v1.5` (768) to `@cf/baai/bge-large-en-v1.5` (1024) means a **new index + full re-embed**.

The corollary: **decide your embedding model before your first big upsert.** Re-embedding 10 M vectors is a multi-day job and a cost pulse.

### Metadata index lock-in (cf-ai-stack §10 #3)

Vectors upserted *before* a metadata index existed are invisible to filters on that field. Define every metadata field you'll filter on **before** the first upsert. Each metadata index covers only the first 64 bytes of a string field.

### When to denormalize into DO SQL

If the agent does N queries per session and each query needs the full vector + metadata, paying N round-trips to Vectorize is wasteful. Cache the candidate set in `this.sql` for the session and rerank locally.

```ts
// 1. Vectorize gives you top-50 IDs
const matches = await env.CONCEPTS.query(qVec, { topK: 50, returnMetadata: "all" });

// 2. Hydrate full payloads from DO SQL
const ids = matches.map(m => m.id);
const rows = this.sql<{ id: string; body: string }>`
  SELECT id, body FROM concept_cache WHERE id IN (${ids})
`;
```

---

## Validate state shape against schema

Drift between the Zod schema for `this.state` and the SQLite tables is the most common subtle bug — fields in state that no table tracks, columns in tables that nothing in state references. `scripts/validate-do-state-shape.ts` catches it:

1. Reads a Zod schema for the agent's `State` type.
2. Boots the DO in a vitest-pool-workers test runner.
3. Dumps `SELECT name, sql FROM sqlite_master WHERE type='table'`.
4. Diffs declared state shape vs actual tables.
5. Fails CI on drift.

Run it as a pre-commit hook or in CI.

---

## Hand-offs

| Situation | Hand off to |
|---|---|
| Migration about to land in CI/CD | `cf-agent-deploy-and-observe` |
| Need to test the migration on a fresh DO | `cf-agent-tests-and-evals` |
| Designing the agent class boundaries (one DO vs many) | `cf-agent-architect` |
| Storing OAuth tokens / props lifecycle | `cf-agent-auth-and-permissions` |
| Picking the embedding model dimensions | `cf-agent-models-and-gateway` |
| Workflow writing back to agent state | `cf-agent-workflows-and-scheduling` |

---

## Quick reference

| Task | API |
|---|---|
| Set broadcastable state | `this.setState({...})` |
| Validate state | `validateStateChange(next, source)` (sync, throws to reject) |
| Read raw SQL | `` this.sql`SELECT ...` `` |
| Write secret | `this.ctx.storage.kv.put(k, v)` (sync) |
| Workflow writes state | `await step.mergeAgentState(partial)` |
| Schema migrate | `wrangler.jsonc migrations[]` (lifecycle) + idempotent DDL in `onStart` (in-DB) |
| Point-in-time restore | `ctx.storage.onNextSessionRestoreBookmark(bookmark); ctx.abort();` |
| Per-WS state | `ws.serializeAttachment({...})` ≤ 2 KB |
| Cross-instance vector | `env.MY_INDEX.query(vec, {topK, filter})` |
| Cross-instance blob | `env.MY_BUCKET.put(key, body)` (R2) |

---

## References

- `references/storage-decision-tree.md` — full table of every storage option, with picks
- `references/three-apis.md` — sync KV vs async KV vs SQL, with worked examples
- `references/migrations-cookbook.md` — every migration shape with full `wrangler.jsonc`
- `references/hibernation-and-state.md` — survival matrix, cost math, recovery patterns
- `references/secret-vs-state.md` — the broadcast-blast-radius rule and what goes where
- `scripts/validate-do-state-shape.ts` — Zod ↔ SQLite drift check
- `scripts/migration-lint.sh` — `wrangler.jsonc migrations[]` linter

---

## Citation index

- Cloudflare Agents core brief: `/home/athena/ai-ideator/docs/research/cf-agents-core.md` §2 (state), §15 (gotchas)
- Runtime primitives brief: `/home/athena/ai-ideator/docs/research/cf-runtime-primitives.md` §2 (storage), §4 (hibernation), §5 (migrations)
- AI stack brief: `/home/athena/ai-ideator/docs/research/cf-ai-stack.md` §6 (Vectorize), §10 (gotchas — dimension lock-in)
- MCP/auth brief: `/home/athena/ai-ideator/docs/research/cf-mcp-auth-frontend.md` §10 (token leakage)
- Skill catalog: `/home/athena/ai-ideator/docs/research/SKILL_CATALOG.md` (cross-cutting non-negotiables)
