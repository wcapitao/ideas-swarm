# Three APIs on one DO

A SQLite-backed DO exposes three storage APIs that all point at the same SQLite database. Choose by **shape of access**, not by namespace.

Source: cf-runtime-primitives §2.

---

## API #1 — Synchronous KV (`ctx.storage.kv.*`)

```ts
// Available ONLY on SQLite-backed DOs.
// Note: NO `await` — these return synchronously.
this.ctx.storage.kv.put("counter", 42);
const n = this.ctx.storage.kv.get<number>("counter");
this.ctx.storage.kv.delete("counter");
const all = this.ctx.storage.kv.list({ prefix: "user:" });
```

- **Synchronous.** No promises, no `await`.
- **Stored in a hidden `__cf_kv` SQLite table.**
- Limits: key 2 KiB, value 128 KiB (same as legacy KV).
- The fastest storage path on DOs — sub-millisecond for hot reads.

When to pick it: hot per-row reads/writes (counters, last-seen timestamps, small per-session blobs) where you don't need to query across keys. Functionally equivalent to a giant in-memory `Map` that survives hibernation.

---

## API #2 — Asynchronous KV (`ctx.storage.*`)

```ts
await this.ctx.storage.put("session_blob", largeBuffer);
const b = await this.ctx.storage.get<ArrayBuffer>("session_blob");
await this.ctx.storage.delete(["a", "b", "c"]);
const map = await this.ctx.storage.list({ prefix: "user:", limit: 100 });
```

- **Asynchronous.** Returns promises.
- Same shape as the legacy (KV-backed) DO API.
- Same `__cf_kv` table on SQLite backend.
- Limits: key 2 KiB, value 128 KiB.

List options: `start`, `startAfter`, `end`, `prefix`, `reverse`, `limit`, `allowConcurrency`, `noCache`.

When to pick it: code that needs to compile against either backend (rare), or generic blob KV where the sync API isn't ergonomic (e.g. writing inside a `for await` loop).

**90% of the time, prefer #1 (sync KV) for KV-shaped writes.**

---

## API #3 — SQL (`ctx.storage.sql.exec` and `this.sql\`\``)

Two ways to call:

```ts
// Raw — anywhere in the DO
const cursor = this.ctx.storage.sql.exec(
  "SELECT * FROM artist WHERE artistid = ?",
  123,
);
for (const row of cursor) console.log(row.artistname);
// or: cursor.toArray(); cursor.one(); cursor.raw().toArray();

// Tagged template — Agents SDK ergonomics
const rows = this.sql<{ id: string; body: string }>`
  SELECT id, body FROM notes WHERE id = ${id}
`;
```

Tagged-template values are bound parameters automatically — no string interpolation, no SQL injection.

Cursor properties:
- `columnNames`
- `rowsRead` (drives billing)
- `rowsWritten` (drives billing)

Limits (cf-runtime-primitives §2):
- Per-DO SQLite cap: **10 GB**
- Row / BLOB / string: 2 MB max
- SQL statement: 100 KB
- Bound parameters per query: 100
- Columns per table: 100

### Transactions

You **cannot** issue `BEGIN` or `SAVEPOINT` directly via `exec()`. Use:

```ts
// Sync
ctx.storage.transactionSync(() => {
  this.sql`UPDATE accounts SET balance = balance - 100 WHERE id = 1`;
  this.sql`UPDATE accounts SET balance = balance + 100 WHERE id = 2`;
});

// Async
await ctx.storage.transaction(async (txn) => {
  // ... txn.exec(...)
});
```

The single-threaded DO model auto-coalesces writes: "any sequence of writes without intervening awaits submits atomically." So in practice you rarely need explicit transactions.

When to pick SQL: structured queries, ordered scans, FTS5, JSON funcs, anything that would require iterating a KV list. SQL is also the right pick when the size and shape of the data don't fit a flat key→value map.

---

## Choosing between the three

| Question | Answer |
|---|---|
| Do I need to query by something other than a single key? | **SQL** |
| Is the value > 128 KiB? | **SQL** (or R2 for huge blobs) |
| Am I writing tight loops with no await? | **Sync KV** (no promise overhead) |
| Do I need joins / ordered scans / FTS / JSON funcs? | **SQL** |
| Am I writing legacy code that compiles against KV-backed too? | **Async KV** |

In a typical Cloudflare Agent:

- `this.state` → managed via `setState`, lives in SQLite (internal table)
- `notes`, `messages`, `sessions` → SQL tables you create in `onStart()`
- `oauth_refresh_token`, `last_seen_ms` → sync KV
- (Legacy code) → async KV

---

## Point-in-Time Recovery — SQLite-only superpower

```ts
// At a known-good moment, capture a bookmark
const bookmark = await this.ctx.storage.getCurrentBookmark();

// Later, after damage:
const past = await this.ctx.storage.getBookmarkForTime(Date.now() - 3600_000);
await this.ctx.storage.onNextSessionRestoreBookmark(past);
this.ctx.abort(); // restart triggers restore
```

Bookmarks are lexically ordered strings, valid for 30 days. Recovery applies to "the entire SQLite database contents, including both the object's stored SQL data and stored key-value data" — i.e. all three APIs roll back together.

**PITR is unique to the SQLite backend.** Another reason to never use `new_classes`.

---

## The "always start SQLite-backed" rule

```jsonc
// wrangler.jsonc
"migrations": [
  { "tag": "v1", "new_sqlite_classes": ["MyAgent"] }
]
```

You **cannot** retrofit a deployed DO from KV-backed to SQLite-backed (cf-runtime-primitives §5). The choice is permanent at namespace creation.

The Agents SDK's `Agent` base class requires SQLite-backed storage — its scheduler tables, its built-in state table, and its chat-message table all live in SQLite. If you accidentally use `new_classes`, **the agent won't even instantiate** (cf-mcp-auth-frontend §10 #5).

`scripts/migration-lint.sh` warns loudly on `new_classes`.
