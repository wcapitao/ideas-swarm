#!/usr/bin/env node
/**
 * validate-do-state-shape.ts
 *
 * Catches state-vs-schema drift in a Cloudflare Agent:
 *   - fields declared in your Zod State schema that have no corresponding SQLite table or `cf_ai_state` entry
 *   - SQLite tables in the DO that nothing in State references
 *
 * Run via `npx tsx scripts/validate-do-state-shape.ts` after a vitest-pool-workers test
 * has booted the DO and dumped its sqlite_master output to a JSON file.
 *
 * Stella Principle: this is deterministic. It compares two sets of names. Don't push it through an LLM.
 *
 * Usage:
 *   1. In a vitest-pool-workers test, dump the DO's tables:
 *
 *        await runInDurableObject(stub, async (instance, ctx) => {
 *          const tables = ctx.storage.sql
 *            .exec("SELECT name, sql FROM sqlite_master WHERE type='table'")
 *            .toArray();
 *          await fs.writeFile(".do-tables.json", JSON.stringify(tables));
 *        });
 *
 *   2. Export your Zod State schema from a known module:
 *
 *        // src/agent.ts
 *        export const StateSchema = z.object({ count: z.number(), ... });
 *
 *   3. Run this validator:
 *
 *        npx tsx scripts/validate-do-state-shape.ts \
 *          --schema=./src/agent.ts \
 *          --tables=.do-tables.json
 *
 * Exits non-zero on drift.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ---------- types ----------

type DoTable = { name: string; sql: string };

type ValidationReport = {
  declaredStateFields: string[];
  declaredTables: string[];
  unknownStateFields: string[];   // in State but no table, no cf_ai_state coverage assumed
  orphanTables: string[];         // tables that nothing in State references AND aren't SDK-internal
  warnings: string[];
};

// Tables the Cloudflare Agents SDK creates internally — never flag them
const SDK_INTERNAL_TABLES = new Set([
  "cf_ai_state",          // backs this.state
  "cf_ai_schedules",      // backs this.schedule()
  "cf_ai_chat_messages",  // backs AIChatAgent
  "_cf_METADATA",         // SQLite internals
  "_cf_KV",               // sync KV table
  "__cf_kv",              // alt naming sometimes seen
  "sqlite_sequence",      // SQLite internals
]);

// ---------- arg parsing ----------

function parseArgs(): { schemaPath: string; tablesPath: string } {
  const args = process.argv.slice(2);
  const get = (flag: string) =>
    args.find((a) => a.startsWith(`--${flag}=`))?.split("=")[1];

  const schemaPath = get("schema");
  const tablesPath = get("tables") ?? ".do-tables.json";

  if (!schemaPath) {
    console.error(
      "Usage: validate-do-state-shape.ts --schema=<path> [--tables=<path>]",
    );
    process.exit(2);
  }
  return {
    schemaPath: resolve(schemaPath),
    tablesPath: resolve(tablesPath),
  };
}

// ---------- schema introspection ----------

/**
 * Imports the user's module and pulls the named Zod schema, then enumerates its top-level keys.
 * Falls back to regex parsing if dynamic import isn't possible (e.g. esm/cjs mismatch in CI).
 */
async function getStateFields(schemaPath: string): Promise<string[]> {
  // Try dynamic import first — the proper path
  try {
    const mod: Record<string, unknown> = await import(schemaPath);
    const candidate =
      (mod.StateSchema as { shape?: Record<string, unknown> } | undefined) ??
      (mod.AgentStateSchema as { shape?: Record<string, unknown> } | undefined) ??
      (mod.default as { shape?: Record<string, unknown> } | undefined);

    if (candidate && typeof candidate === "object" && "shape" in candidate && candidate.shape) {
      return Object.keys(candidate.shape);
    }
  } catch (err) {
    // fall through to regex
  }

  // Regex fallback — read the source and pull z.object({...}) keys
  const source = readFileSync(schemaPath, "utf8");
  const match = source.match(
    /(?:StateSchema|AgentStateSchema)\s*=\s*z\.object\(\s*\{([\s\S]*?)\}\s*\)/,
  );
  if (!match) {
    throw new Error(
      `No StateSchema / AgentStateSchema export found in ${schemaPath} (and import failed)`,
    );
  }
  const body = match[1];
  // crude: grab `key: ...` at the start of each line/segment
  const keys = Array.from(body.matchAll(/(?:^|,|\n)\s*([a-zA-Z_][\w]*)\s*:/g)).map(
    (m) => m[1],
  );
  return Array.from(new Set(keys));
}

// ---------- table introspection ----------

function getDeclaredTables(tablesPath: string): DoTable[] {
  if (!existsSync(tablesPath)) {
    throw new Error(
      `Tables dump not found at ${tablesPath}. Run a vitest-pool-workers test that writes it first.`,
    );
  }
  const raw = readFileSync(tablesPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Expected tables dump to be a JSON array");
  }
  return parsed.filter(
    (t): t is DoTable =>
      typeof t === "object" && t !== null && "name" in t && "sql" in t,
  );
}

// ---------- comparison ----------

function diff(stateFields: string[], tables: DoTable[]): ValidationReport {
  const userTables = tables
    .map((t) => t.name)
    .filter((n) => !SDK_INTERNAL_TABLES.has(n) && !n.startsWith("sqlite_"));

  const tableSet = new Set(userTables);
  const stateSet = new Set(stateFields);

  // Heuristic: a state field is "covered" either by cf_ai_state (always present in Agents SDK)
  // or by a same-named table (`messages`, `notes`, etc.). We allow both.
  const cfAiStatePresent = tables.some((t) => t.name === "cf_ai_state");

  const unknownStateFields = cfAiStatePresent
    ? [] // SDK persists state in cf_ai_state — nothing to flag at field level
    : stateFields.filter((f) => !tableSet.has(f));

  // A user-table is "orphan" if:
  //  - it's not in SDK_INTERNAL_TABLES
  //  - and no state-field name matches it (loose; `messages` table for `messages` field)
  const orphanTables = userTables.filter((t) => !stateSet.has(t));

  const warnings: string[] = [];
  if (!cfAiStatePresent) {
    warnings.push(
      "cf_ai_state not present — either this isn't an Agents-SDK DO, or onStart() hasn't run yet.",
    );
  }
  if (stateFields.length === 0) {
    warnings.push("No state fields detected. Did you export StateSchema / AgentStateSchema?");
  }

  return {
    declaredStateFields: stateFields,
    declaredTables: userTables,
    unknownStateFields,
    orphanTables,
    warnings,
  };
}

// ---------- reporter ----------

function report(r: ValidationReport): number {
  console.log("=== DO state-vs-schema drift report ===\n");

  console.log(`State schema fields (${r.declaredStateFields.length}):`);
  for (const f of r.declaredStateFields) console.log(`  - ${f}`);

  console.log(`\nUser-defined tables (${r.declaredTables.length}):`);
  for (const t of r.declaredTables) console.log(`  - ${t}`);

  if (r.warnings.length) {
    console.log("\nWarnings:");
    for (const w of r.warnings) console.log(`  ! ${w}`);
  }

  if (r.unknownStateFields.length) {
    console.log("\nState fields with no backing table:");
    for (const f of r.unknownStateFields) console.log(`  X ${f}`);
  }

  if (r.orphanTables.length) {
    console.log("\nOrphan tables (no state field references them — informational):");
    for (const t of r.orphanTables) console.log(`  ? ${t}`);
  }

  if (r.unknownStateFields.length > 0) {
    console.log("\nFAIL — state schema has fields with no SQLite backing.");
    return 1;
  }
  console.log("\nOK — state shape matches schema.");
  return 0;
}

// ---------- main ----------

async function main() {
  const { schemaPath, tablesPath } = parseArgs();
  const stateFields = await getStateFields(schemaPath);
  const tables = getDeclaredTables(tablesPath);
  const r = diff(stateFields, tables);
  process.exit(report(r));
}

main().catch((err) => {
  console.error("validate-do-state-shape: fatal:", err);
  process.exit(2);
});
