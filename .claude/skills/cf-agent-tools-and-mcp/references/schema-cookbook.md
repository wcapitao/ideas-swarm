# Schema cookbook — Zod patterns for tool I/O

The model reads JSON Schema. Zod compiles to JSON Schema. What the model
sees is what `.describe()`, `.min()`, `.max()`, `.default()`, and `.enum()`
turn into. Treat the schema as documentation **for the LLM**, not just
runtime validation.

---

## 1. Strings with semantic constraints

```ts
{
  email:    z.string().email().describe("Recipient email address"),
  url:      z.string().url().describe("Absolute URL with scheme"),
  uuid:     z.string().uuid().describe("Server-issued resource ID"),
  isoDate:  z.string().datetime().describe("ISO 8601 timestamp, UTC"),
  slug:     z.string().regex(/^[a-z0-9-]+$/).max(64).describe("Lowercase, dash-separated slug"),
}
```

`.email()` etc emit `format: "email"` in JSON Schema, which good models
respect. Bad models read the description; either way you win.

---

## 2. Enums (always preferred over `z.string()`)

```ts
{
  status: z.enum(["pending", "active", "archived"])
    .describe("Filter rows by lifecycle state."),
  units:  z.enum(["metric", "imperial"]).default("metric"),
}
```

JSON Schema renders as `{ "enum": [...] }`. The model picks valid values
and never invents a free-form string.

---

## 3. Numbers with bounds

```ts
{
  pageSize: z.number().int().min(1).max(100).default(20)
    .describe("Page size, capped at 100"),
  ratio:    z.number().min(0).max(1).describe("Decimal between 0 and 1"),
  // For currency, prefer integer minor units:
  amountCents: z.number().int().min(0).describe("Amount in USD cents"),
}
```

Avoid `z.number()` with no bounds — the model has been seen to send
`9e99` and `Number.MAX_SAFE_INTEGER`.

---

## 4. Optional vs default vs nullable

```ts
{
  // Required
  query: z.string().min(1),

  // Optional — may be absent
  filter: z.string().optional().describe("Optional substring filter"),

  // Has a default — also optional, but with documented fallback
  pageSize: z.number().int().min(1).max(100).default(20),

  // Nullable — explicit null allowed (rare; use only when API requires)
  cursor: z.string().nullable().describe("Pagination cursor; null on first page"),
}
```

Prefer `.optional()` over `.nullable()` unless null is semantically meaningful.
`.default()` makes the field auto-populate, so the model can omit it.

---

## 5. Discriminated unions

For "either A or B but not both":

```ts
const scheduleInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delayed"), delaySeconds: z.number().int().min(1) }),
  z.object({ type: z.literal("scheduled"), at: z.string().datetime() }),
  z.object({ type: z.literal("cron"), cron: z.string().describe("5-field cron, e.g. '0 8 * * 1-5'") }),
]);
```

Renders as `oneOf` with discriminator — the model navigates it cleanly.
`agents/schedule` exports exactly this shape as `scheduleSchema`.

**Avoid plain `z.union(...)`.** It renders as `anyOf` with no discriminator,
which causes the model to send fields from both branches.

---

## 6. Arrays with element validation

```ts
{
  ids: z.array(z.string().uuid()).min(1).max(50)
    .describe("UUIDs of items to update; at least one, at most fifty."),
  scores: z.array(z.number().min(0).max(1)).max(100),
}
```

Always set `max()` — unbounded arrays let the model chew through the
context window.

---

## 7. Nested objects (kept shallow)

```ts
{
  pagination: z.object({
    cursor: z.string().nullable(),
    limit:  z.number().int().min(1).max(100).default(20),
  }).describe("Pagination control"),
}
```

Keep nesting to one level. Two-level-deep schemas confuse models.
Flatten where possible:

```ts
// Prefer:
{ pageCursor: ..., pageLimit: ... }
// Over:
{ pagination: { cursor: ..., limit: ... } }
```

---

## 8. Idempotency keys

```ts
{
  idempotencyKey: z.string().uuid().optional()
    .describe("Optional client-provided UUID. Repeating with the same key returns the prior result instead of double-charging."),
}
```

Document the **semantics** in the description — the model has to know
what idempotency means in your domain.

---

## 9. File / path inputs

```ts
{
  path: z.string()
    .regex(/^\/[A-Za-z0-9_\-/.]+$/)
    .max(1024)
    .describe("Absolute path under /workspace/. No '..', no shell metacharacters."),
}
```

Validate at the schema layer; **also** validate in the handler (defense
in depth). The model can be coerced to send `../../etc/passwd` if the
schema doesn't reject it first.

---

## 10. Cross-flavor: the `z.object` distinction

This catches everyone once.

```ts
// McpAgent.server.tool(name, desc, INPUT_SHAPE, handler)
//   INPUT_SHAPE is the RAW object literal:
this.server.tool("add", "Add two numbers.",
  { a: z.number(), b: z.number() },                // raw object
  async ({ a, b }) => ({ ... }));

// AI SDK tool({ inputSchema, execute })
//   inputSchema is a WRAPPED z.object:
const addTool = tool({
  description: "Add two numbers.",
  inputSchema: z.object({ a: z.number(), b: z.number() }),  // wrapped
  execute: async ({ a, b }) => ({ ... }),
});
```

Cross them up and you get cryptic errors at runtime ("inputSchema is not
a function" or "expected ZodObject"). Stick a comment by every tool
declaration calling out which flavor.

---

## 11. Output schemas (for typed tool returns)

Most tool results are `{ content: [{ type: "text", text: ... }] }`. For
typed payloads, MCP supports `structuredContent`:

```ts
this.server.tool(
  "search",
  "Search rows.",
  { query: z.string().min(1) },
  async ({ query }) => {
    const rows = await search(query);
    return {
      content: [{ type: "text", text: JSON.stringify(rows) }],
      structuredContent: { rows, total: rows.length, query },
    };
  },
);
```

The model still reads the `content` text; sophisticated clients can also
parse `structuredContent` for downstream use. AI SDK tools type their
return via `execute`'s return type.

---

## 12. Anti-patterns

| Anti-pattern | Why bad | Replace with |
|---|---|---|
| `z.any()` | No JSON Schema → model sends garbage | A specific shape |
| `z.string()` with no `.max()` | Token-unbounded; model has been seen to send 100k chars | `.max(N)` |
| `z.number()` with no `.min()/.max()` | NaN, Infinity, MAX_SAFE_INTEGER | `.min().max()` |
| `z.union([...])` of objects | Renders as `anyOf` — model sends fields from both | `z.discriminatedUnion("kind", [...])` |
| Missing `.describe()` per field | Model guesses semantics | One short sentence per field |
| `z.record(z.string(), z.unknown())` | Free-form bag — model invents keys | A typed shape |
| Two-level nesting | Confuses models | Flatten with prefixed names |
