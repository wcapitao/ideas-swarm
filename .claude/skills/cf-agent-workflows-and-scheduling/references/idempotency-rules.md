# The 8 idempotency rules for Cloudflare Workflows

Workflows replay from the start on retry, skipping already-completed
`step.do` results. That replay is the entire safety model. Violate any
of these rules and the replay turns into a bug factory.

Source:
https://developers.cloudflare.com/workflows/build/rules-of-workflows/
https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/

## Rule 1 — Non-idempotent calls go inside `step.do`, after a check

Charge a card → first ask "have I already charged this card for this
order?" The check is what makes retry safe.

❌ Bad — naked side effect:

```ts
async run(event, step) {
  await chargeCard(event.payload.orderId, event.payload.amount);  // outside step.do
}
```

✅ Good — guarded inside a step:

```ts
const charge = await step.do("charge", async () => {
  const existing = await db.findCharge(event.payload.orderId);
  if (existing) return existing;                       // already done
  return await stripe.charge(event.payload.amount, { idempotencyKey: event.payload.orderId });
});
```

## Rule 2 — One step = one unit of work

Combining two side effects in one step means you cannot retry one
without retrying the other.

❌ Bad:

```ts
await step.do("charge-and-email", async () => {
  await chargeCard(...);
  await sendReceipt(...);
});
```

If `sendReceipt` fails, the retry attempts to charge again — so you
either need to bake an idempotency key into the charge call (and you
should anyway), or split the steps. Splitting is simpler and clearer.

✅ Good:

```ts
const charge = await step.do("charge", async () => chargeCard(...));
const email  = await step.do("send-receipt", async () => sendReceipt(charge));
```

## Rule 3 — Step names are cache keys

Step names must be **deterministic**. The runtime uses them to identify
which step has already been completed during a replay.

❌ Bad:

```ts
await step.do(`run-${Date.now()}`, async () => { ... });   // new name every replay
await step.do(`process-${uuid()}`, async () => { ... });    // same
```

Each replay generates a new name → cache miss → step re-runs → side
effect duplicated.

✅ Good — name encodes the input, not the moment:

```ts
await step.do(`process-${event.payload.orderId}`, async () => { ... });
await step.do("fetch-profile", async () => { ... });        // single-instance steps
```

## Rule 4 — Don't mutate the event

Per the docs: "Any changes to an event are not persisted across the
steps of a Workflow."

❌ Bad:

```ts
async run(event, step) {
  event.payload.processedAt = Date.now();      // lost on replay
  await step.do("a", async () => { ... });
  // later code reads event.payload.processedAt — undefined on replay
}
```

✅ Good — return data from steps and pass it explicitly:

```ts
const meta = await step.do("init", async () => ({ processedAt: Date.now() }));
const result = await step.do("a", async () => process(event.payload, meta));
```

## Rule 5 — Always `await` steps

Unawaited promises:
- swallow errors silently
- create races with subsequent steps
- can leave the step result uncached

❌ Bad:

```ts
step.do("save", async () => save());          // no await
const r = await step.do("next", ...);          // races
```

✅ Good:

```ts
await step.do("save", async () => save());
const r = await step.do("next", ...);
```

## Rule 6 — Conditional logic must be deterministic

Branches must be functions of step outputs or event payload — never of
non-deterministic sources like `Math.random()`, `Date.now()`, or live
external state read outside a step.

❌ Bad:

```ts
if (Math.random() < 0.1) {
  await step.do("flaky-path", ...);            // sometimes runs, sometimes doesn't, on replay
}
if (Date.now() > deadline) { ... }             // changes between replays
```

✅ Good — wrap non-determinism in a step:

```ts
const sample = await step.do("sample", async () => Math.random());
if (sample < 0.1) {
  await step.do("flaky-path", ...);            // step.do output is cached → deterministic
}
```

## Rule 7 — Wrap all side effects in `step.do`

Anything outside `step.do` (top-level code in the workflow body) is
**replayed on every retry**.

❌ Bad:

```ts
async run(event, step) {
  await db.insert(event.payload);              // replayed N times if step 3 fails
  await step.do("step-3", async () => failable());
}
```

✅ Good:

```ts
async run(event, step) {
  await step.do("insert-row", async () => db.insert(event.payload));
  await step.do("step-3", async () => failable());
}
```

The defining test: *if every line in this `run()` body could be
executed 5 times, would I be OK with that?* If no — wrap it in
`step.do`.

## Rule 8 — Step results ≤ 1 MiB and structured-cloneable

Step return values are serialized into the workflow's storage. The
serialization is structured-clone — same as `postMessage`. Size cap is
1 MiB.

❌ Bad:

```ts
const html = await step.do("scrape", async () => fetchLargeHtml());   // 4 MB → fails
const fn   = await step.do("compile", async () => makeFunction());     // function → fails
const dt   = await step.do("now", async () => new Date());             // OK (Date is cloneable)
```

✅ Good:

```ts
const summary = await step.do("scrape", async () => {
  const html = await fetchLargeHtml();
  return { length: html.length, title: extractTitle(html) };           // small + cloneable
});
// Persist the full HTML to R2/D1 and return a pointer if you really need it.
```

What is structured-cloneable: numbers, strings, booleans, null,
undefined, plain objects/arrays, Date, Map, Set, ArrayBuffer, TypedArrays.

What is NOT: functions, classes with custom prototypes, DOM nodes,
Proxies, Symbols (other than registered).

## Quick checklist before merging a workflow

- [ ] Every side effect is inside `step.do`.
- [ ] Every step name is deterministic (no `Date.now()`, no `uuid()`).
- [ ] Every `step.do` is `await`ed.
- [ ] Branches depend only on step outputs or event payload.
- [ ] Step return values are < 1 MiB and structured-cloneable.
- [ ] Non-idempotent calls have a "did I do this already?" guard.
- [ ] No mutation of `event.payload`.
- [ ] `NonRetryableError` thrown for terminal failures, not generic
      `Error`.
