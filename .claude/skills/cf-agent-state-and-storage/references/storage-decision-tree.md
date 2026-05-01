# Storage decision tree

The full table that SKILL.md collapses into 5 tiers. Walk top to bottom.

## 1. Is it state for ONE agent instance?

| Sub-question | If YES |
|---|---|
| Does the UI need to bind to it? | `this.setState({...})` (Tier 1) |
| Is it secret / a token / a key? | `this.ctx.storage.kv.put` or private SQL table (Tier 3) |
| Is it queryable / structured / many rows? | `this.sql\`...\`` (Tier 2) |
| Is it a >1 MB blob? | `this.ctx.storage.put(key, blob)` or stash in R2 with a pointer in SQL |
| Per-WebSocket-connection state? | `ws.serializeAttachment({...})` ≤ 2 KB |

## 2. Is it state shared ACROSS agent instances?

| Sub-question | If YES |
|---|---|
| It's a vector? | Vectorize (Tier 4) |
| It's a blob ≥128 KB? | R2 (Tier 5) |
| It's small global config / allow-list? | KV (Tier 5) |
| It's relational across tenants? | D1 (Tier 5) |

---

## Vectorize vs DO SQL — the embedding-store fork

| Question | Vectorize | DO SQL |
|---|---|---|
| Reach | Cross-instance, global | One DO instance |
| Max vectors | 10 M | Bounded by 10 GB cap |
| Dimensions | Fixed (1,536 max) — immutable post-create | Anything — store as BLOB / JSON |
| Query | `env.IDX.query(vec, {topK, filter})` | Manual cosine in SQL or in JS |
| Metadata filter | `$eq/$ne/$in/$nin/$lt/$lte/$gt/$gte`, 64-byte string ceiling | Anything SQL can express |
| Latency | Network call to Vectorize service | Sub-ms on the same node |
| Cost | $0.05/100M dim/mo stored, $0.01/1M dim/mo queried | DO storage + read/write rows |

**Pick Vectorize when:** the same embeddings are queried by many DOs (a shared concept index, a cross-tenant doc store).

**Pick DO SQL when:** the embeddings are private to one agent (per-user memory, per-conversation context).

**Use both when:** Vectorize is the global index; DO SQL caches the matched payloads to avoid round-trips during a session.

---

## R2 vs KV vs D1

| | R2 | KV | D1 |
|---|---|---|---|
| Shape | Object store | Eventually-consistent KV | SQLite-as-a-service |
| Best for | Blobs, files, audio, images, model weights | Cached config, allow-lists, public read-heavy | Multi-tenant relational |
| Consistency | Strong | Eventual (~60 s typical) | Strong per-DB |
| Egress | Free | Free | Free |
| Size cap | 5 TiB / object | 25 MB / value | 10 GB / DB |
| Latency | ~30 ms | ~5 ms read (cached) | ~10–30 ms |
| Use with DO? | DO holds the pointer (key), R2 holds the bytes | DO reads on cold start | DO joins to D1 only when truly cross-tenant |

### Common combos

- **R2 + DO SQL.** Doc bytes in R2; chunk/embedding metadata in DO SQL. The agent owns the per-doc index, the bytes are global.
- **Vectorize + R2 + DO SQL.** Vectorize indexes the chunks, R2 stores the source files, DO SQL caches the per-session candidate set.
- **KV + DO.** OAuth approved-clients registry in KV (read by every DO at session start), per-session tokens in `this.props` / DO SQL.

---

## Storage size rule of thumb

| Size | Where |
|---|---|
| < 4 KB and bound to UI | `this.setState` |
| < 128 KB structured | DO SQL row |
| < 25 MB blob, cross-instance, tolerate eventual consistency | KV value |
| 128 KB – 5 TiB blob | R2 object |
| Embeddings, cross-instance | Vectorize |

The hard caps:
- DO SQL row / BLOB / string: **2 MB max** (cf-runtime-primitives §2)
- DO total storage: **10 GB / DO**
- WebSocket inbound message: 32 MiB
- WebSocket `serializeAttachment`: **2,048 bytes**
- Workflow step result: 1 MiB
- Vectorize metadata: 10 KiB / vector, 64-byte index ceiling per string field

---

## When you're hitting the 10 GB DO cap

Symptoms: `SQLITE_FULL` on writes, reads still work.

Mitigation order:
1. **Spill blobs to R2.** Keep a pointer (URL or key) in DO SQL.
2. **TTL old data.** A nightly `DELETE FROM ... WHERE created_at < ?` via `schedule()`.
3. **Shard the DO.** Split `Room#42` into `Room#42-shard-0`, `Room#42-shard-1`, etc.
4. **Last resort: D1.** If the data is fundamentally cross-instance, it shouldn't have been in DO SQL.

(cf-runtime-primitives §2.)

---

## The Cloudflare Agents SDK adds these conventions

The SDK reserves a few SQLite tables for itself in every Agent DO:

| Table | Purpose |
|---|---|
| `cf_ai_state` (internal) | Backs `this.state` |
| `cf_ai_schedules` (internal) | Backs `this.schedule()` |
| `cf_ai_chat_messages` (internal, AIChatAgent) | Persisted chat messages |

Don't write to those tables directly. Anything you create lives in your own tables (e.g. `notes`, `sessions`, `memos`).
