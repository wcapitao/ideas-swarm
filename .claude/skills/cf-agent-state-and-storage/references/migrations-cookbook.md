# Migrations cookbook

Everything you need to evolve a DO class over its life. Migrations communicate **class lifecycle changes** (create/rename/delete/transfer) to the Workers runtime. **They do NOT cover in-DB schema** — for column adds you run idempotent DDL in `onStart()`.

Source: cf-runtime-primitives §5; cf-agents-core §15.

---

## Hard rules

1. **Tags are append-only** — unique forever within a script, never reordered, never edited. The runtime tracks which tags it has applied.
2. **Always `new_sqlite_classes`** — never `new_classes`. The choice is permanent.
3. **Atomic deploys** — a migration cannot be gradually rolled out.
4. **Backward-compatible code first, migration second** — code updates do not require a migration, but a migration without backward-compatible code corrupts existing instances.
5. **`deleted_classes` destroys data** — every instance, gone forever, no undo.
6. **500 DO classes max per Paid account, 100 Free.**
7. **Workers Free supports only SQLite.** Workers Paid supports both. You can't downgrade Paid → Free without first deleting all KV-backed objects.

---

## Recipe 1 — Create a new SQLite-backed agent class

Use this every time. Do this even for the very first deploy — without a migration, the deploy succeeds but the DO can't be instantiated (cf-mcp-auth-frontend §10 #5).

```jsonc
{
  "name": "my-agent-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-30",
  "compatibility_flags": ["nodejs_compat"],
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

Notes:
- `nodejs_compat` is mandatory for the Agents SDK (cf-agents-core §15).
- Tag names are conventionally `v1`, `v2`, ... but anything unique within the script works.

---

## Recipe 2 — Add a column to an existing table (in-DB, NOT a wrangler migration)

Wrangler migrations don't manage your tables. Schema-in-DB lives in your code.

The Agents SDK convention: idempotent DDL in `onStart()`:

```ts
import { Agent } from "agents";

export class MyAgent extends Agent<Env, State> {
  async onStart() {
    // Create-if-not-exists is idempotent
    this.sql`CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      body TEXT
    )`;

    // Column-add is not idempotent — guard manually
    try {
      this.sql`ALTER TABLE notes ADD COLUMN created_at INTEGER`;
    } catch (e) {
      // SQLite throws "duplicate column name" if it already exists
      if (!String(e).includes("duplicate column")) throw e;
    }

    // Indexes — `IF NOT EXISTS` is supported
    this.sql`CREATE INDEX IF NOT EXISTS idx_notes_created
             ON notes(created_at)`;
  }
}
```

For raw DOs (without the Agents SDK), use `ctx.blockConcurrencyWhile` in the constructor (cf-runtime-primitives §2):

```ts
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  ctx.blockConcurrencyWhile(async () => {
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS notes (...)`);
  });
}
```

`blockConcurrencyWhile` runs once per cold-start, blocks any incoming events until done, has a 30-second runaway cap.

---

## Recipe 3 — Rename a DO class

You're refactoring `MyAgent` → `MyAgentV2` (e.g. semantics changed substantially):

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "AGENT", "class_name": "MyAgentV2" }   // updated to new name
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

Constraints:
- **Do NOT pre-create the destination class** via `new_sqlite_classes` — the rename creates it.
- The class file must be exported under the new name (`export class MyAgentV2 extends Agent { ... }`).
- All instance state, all SQL tables, all stored alarms transfer.

---

## Recipe 4 — Delete a DO class (DESTRUCTIVE)

You're deleting `DeprecatedAgent` for good. **Every instance's data is gone forever.**

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "AGENT", "class_name": "MyAgent" }
      // DeprecatedAgent binding REMOVED
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["MyAgent"] },
    { "tag": "v2", "new_sqlite_classes": ["DeprecatedAgent"] },
    { "tag": "v3", "deleted_classes": ["DeprecatedAgent"] }
  ]
}
```

Pre-flight checklist:
1. Remove the binding from `durable_objects.bindings`.
2. Remove all imports / `getAgentByName(env.DeprecatedAgent, ...)` calls.
3. Deploy that change first (no migration yet).
4. THEN add the `deleted_classes` migration in a follow-up deploy.

If you skip 1–3, the migration fails because the runtime sees code referencing a class you're trying to delete.

---

## Recipe 5 — Transfer a class between Worker scripts

Splitting a monolith. The new Worker `agents-v2` should inherit instances from the old Worker `agents-v1`:

```jsonc
// In the NEW worker (agents-v2)
{
  "durable_objects": {
    "bindings": [
      { "name": "AGENT", "class_name": "MyAgent" }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "transferred_classes": [
        { "from": "MyAgent", "from_script": "agents-v1", "to": "MyAgent" }
      ]
    }
  ]
}
```

Then in the OLD Worker (`agents-v1`), remove the class binding and add a `deleted_classes` migration in a follow-up deploy.

`transferred_classes` is rare in practice — most teams keep all DO classes in one Worker.

---

## Workflow binding renames

Workflow bindings have their own one-shot migration helper (cf-agents-core §15):

```ts
import { migrateWorkflowBinding } from "agents";

export default {
  async fetch(req, env) {
    if (req.url.endsWith("/migrate-wf")) {
      await migrateWorkflowBinding(env, "OLD_WF", "NEW_WF");
      return new Response("ok");
    }
    // ...
  }
};
```

Renaming a workflow binding without `migrateWorkflowBinding()` orphans tracking records.

---

## Linting your migrations

`scripts/migration-lint.sh` checks:

- Tags are unique within `migrations[]`.
- Tags are monotonically increasing (no `v3` before `v2`).
- Every name in `new_sqlite_classes` has a matching `class_name` in `durable_objects.bindings`.
- No `new_classes` (warns loudly — KV-backed is irreversible).
- Every entry in `renamed_classes` has both `from` and `to`.
- Every entry in `transferred_classes` has `from`, `from_script`, and `to`.

Run it as a pre-commit hook and in CI before every `wrangler deploy`. Pair with `scripts/validate-do-state-shape.ts` for full state-and-schema coverage.

---

## CI integration (hand-off to cf-agent-deploy-and-observe)

```yaml
# .github/workflows/deploy.yml — fragment
- name: Lint DO migrations
  run: bash .claude/skills/cf-agent-state-and-storage/scripts/migration-lint.sh wrangler.jsonc

- name: Validate state-vs-schema
  run: npx tsx .claude/skills/cf-agent-state-and-storage/scripts/validate-do-state-shape.ts

- name: Deploy
  run: npx wrangler deploy
```

The `cf-agent-deploy-and-observe` skill owns the full deploy pipeline; this one owns the migration safety net.

---

## Common migration screwups

| Mistake | Symptom | Fix |
|---|---|---|
| Used `new_classes` | "fine" until you want PITR / sync KV / SDK scheduler | Start over with a new class — KV→SQLite is impossible |
| Forgot the migration on first deploy | DO can't instantiate; "no migration declared" | Add `migrations: [{ tag: "v1", new_sqlite_classes: [...] }]` and redeploy |
| Edited a deployed `tag` | Migration silently re-applies (or doesn't) | Tags are append-only — add a new tag, never edit |
| Renamed via two-step (delete + create new) | Lost all data | Use `renamed_classes` |
| Pre-created the rename target | Migration fails | Don't add `new_sqlite_classes` for a class that's about to be the target of a rename |
| `wrangler.toml` numeric var | Type error in code | `vars` values are always strings — parse in code (cf-agents-core §15) |
| Forgot `nodejs_compat` flag | Agent imports fail at runtime | Add to `compatibility_flags` |
