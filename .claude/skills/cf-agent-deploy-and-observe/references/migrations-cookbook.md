# Durable Object migrations cookbook

DO migrations are **append-only**, **atomic**, and **all-or-nothing**.
Each `tag` must be unique. Once any migration tag has been applied to a
Worker, every future deploy must include a migration block. You cannot
reorder or remove a previously-applied tag. Migrations execute in
order during deploy; if one fails, the deploy fails.

## The 5 directives

| Directive | Effect |
|---|---|
| `new_sqlite_classes` | Create a new SQLite-backed DO class. **The modern path.** |
| `new_classes` | Create a new KV-backed DO class. **Legacy. Avoid.** |
| `deleted_classes` | Drop a class **and all its data**. |
| `renamed_classes` | Move state from one class name to another (same Worker). |
| `transferred_classes` | Move state to a class in a different Worker. |

Source: https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/

## The hard rules

1. **Always SQLite.** `new_sqlite_classes` is on Free tier, has 10 GB
   per object, and is the only forward-compatible path. `new_classes`
   (KV-backed) is paid-only and has no automated migration to SQLite.
2. **Append-only.** Editing or reordering a tag that has been applied
   is broken-by-design. Add `v2`, never edit `v1`.
3. **Tag uniqueness is global to the Worker.** Don't reuse `v1` even
   if you reset to a fresh Cloudflare account — the Worker namespace
   tracks tags per-environment.
4. **Class name in the binding must match the migration.** If you
   declare a binding for class `Foo` without a matching migration, the
   first deploy fails with "no migration found for class".
5. **Delete is two deploys.** Remove the binding first (so live code
   isn't holding a reference), deploy. Then add the
   `deleted_classes` migration in a second deploy.

## Recipes

### 1. Add the first SQLite-backed class

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "AGENT", "class_name": "IdeatorAgent" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["IdeatorAgent"] }
  ]
}
```

This is what every brand-new agent should ship with. Tag `v1`, one
class, SQLite.

### 2. Add a second class

Append a new tag. Don't touch `v1`.

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "AGENT", "class_name": "IdeatorAgent" },
      { "name": "RANKER", "class_name": "RankerAgent" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["IdeatorAgent"] },
    { "tag": "v2", "new_sqlite_classes": ["RankerAgent"] }
  ]
}
```

### 3. Rename a class (preserves data)

You're moving state from `IdeatorAgent` to `IdeatorAgentV2`. Don't
*also* declare `IdeatorAgentV2` in `new_sqlite_classes` — the rename
migration creates it.

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "AGENT", "class_name": "IdeatorAgentV2" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["IdeatorAgent"] },
    {
      "tag": "v3",
      "renamed_classes": [
        { "from": "IdeatorAgent", "to": "IdeatorAgentV2" }
      ]
    }
  ]
}
```

In `src/server.ts`, export the new class:

```ts
export class IdeatorAgentV2 extends Agent<Env> { /* ... */ }
```

The state survives. Existing object IDs continue to work; the runtime
re-routes them to the new class.

### 4. Delete a class (DESTROYS DATA)

Two-deploy pattern. **Order matters** — get this wrong and you'll see
"orphaned binding" errors.

**Deploy A**: remove the binding.

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "AGENT", "class_name": "IdeatorAgent" }
      // RANKER binding removed
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["IdeatorAgent"] },
    { "tag": "v2", "new_sqlite_classes": ["RankerAgent"] }
  ]
}
```

**Deploy B**: add the `deleted_classes` migration.

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "AGENT", "class_name": "IdeatorAgent" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["IdeatorAgent"] },
    { "tag": "v2", "new_sqlite_classes": ["RankerAgent"] },
    { "tag": "v4", "deleted_classes": ["RankerAgent"] }
  ]
}
```

After Deploy B, all `RankerAgent` storage is **gone**. There is no
recovery.

### 5. Transfer a class to another Worker

Useful when you split an agent out of a monolith into its own Worker.
The destination Worker must be deployed *first* with a matching
`renamed_classes` migration, OR you can use `transferred_classes` from
the source side.

In the destination Worker (`new-worker/wrangler.jsonc`):

```jsonc
{
  "name": "ranker-worker",
  "durable_objects": {
    "bindings": [{ "name": "RANKER", "class_name": "RankerAgent" }]
  },
  "migrations": [
    {
      "tag": "v1",
      "transferred_classes": [
        {
          "from": "RankerAgent",
          "from_script": "ai-ideator-agent",
          "to": "RankerAgent"
        }
      ]
    }
  ]
}
```

Then deploy the destination first, then update the source Worker to
remove the binding (it's been transferred).

### 6. KV-backed DO -> SQLite-backed (NO AUTOMATED PATH)

Cloudflare states this is "available in the future" but is not
implemented today. The safe pattern:

1. **Stop accepting writes** to the old KV-backed class.
2. **Create a new SQLite-backed class** with a different name.
3. **Write a one-time data export job** inside the old class that
   streams its state via `fetch` (or RPC) to the new class.
4. **Verify** every record migrated by checking counts and a few
   samples.
5. **Retire the old binding** via the two-deploy delete pattern above.

For new agents: never put yourself in this position. Always start with
`new_sqlite_classes`.

## Linter

Add this to CI to catch missing migrations before they hit production:

```bash
node -e '
  const fs = require("fs");
  const c = JSON.parse(fs.readFileSync("wrangler.jsonc","utf8")
    .replace(/\/\*[\s\S]*?\*\//g,"").replace(/\/\/.*$/gm,""));
  const bindings = (c.durable_objects?.bindings || []).map(b => b.class_name);
  const migrated = new Set();
  for (const m of c.migrations || []) {
    (m.new_sqlite_classes||[]).forEach(x => migrated.add(x));
    (m.new_classes||[]).forEach(x => migrated.add(x));
    (m.renamed_classes||[]).forEach(r => migrated.add(r.to));
    (m.transferred_classes||[]).forEach(t => migrated.add(t.to));
  }
  const missing = bindings.filter(b => !migrated.has(b));
  if (missing.length) { console.error("MIGRATION MISSING:", missing); process.exit(1); }
  console.log("ok: every DO binding has a migration");
'
```

Wire into the `test` job in `references/ci-cd.md`.

## Source

https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/
