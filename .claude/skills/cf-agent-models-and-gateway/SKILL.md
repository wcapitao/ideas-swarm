---
name: cf-agent-models-and-gateway
description: >
  The AI layer of a Cloudflare Agent — Workers AI binding, AI Gateway
  (caching / rate limiting / fallback / logs / BYO key), Vectorize, AI Search
  (formerly AutoRAG), model selection, prompt discipline, multi-provider
  failover. Activates when the user asks about "Workers AI", "AI Gateway",
  "model selection", "embeddings", "Vectorize", "RAG", "AI Search", "fallback
  provider", "BYO API key", "caching LLM responses", "structured output",
  "tool-calling model", "prompt tuning for the agent", "switch from OpenAI to
  Anthropic", or "which model for this agent". Encodes the AIG-in-front-of-
  every-LLM-call rule, the streaming-not-cached caveat, the dimension lock-in
  rule, the JSON-mode-no-streaming rule, and the universal-vs-provider
  endpoint decision. Do NOT use for non-Cloudflare model hosting or
  Anthropic-SDK prompt work.
---

# cf-agent-models-and-gateway

The AI layer is where Cloudflare Agents are most different from generic LLM apps. Every LLM call goes through AI Gateway. Every embedding lives in Vectorize. Every model has a Cloudflare-side identifier and a Cloudflare-side cost. Get this layer wrong and you forfeit caching, rate-limit, fallback, observability, and the eval feedback loop simultaneously.

## When to use

| Trigger | Use? |
|---|---|
| "Pick a model for the agent" | YES |
| "How do I cache LLM responses" | YES |
| "Set up AI Gateway" | YES |
| "Add a Vectorize index" | YES |
| "Switch from OpenAI to Anthropic" | YES |
| "Build RAG into the agent" | YES |
| "Multi-provider fallback" | YES |
| "Which embedding model" | YES |
| Tuning a single prompt | YES (see prompt discipline section) |
| Adding a tool | NO → `cf-agent-tools-and-mcp` |
| Designing the agent shape | NO → `cf-agent-architect` |
| Testing prompts | NO → `cf-agent-tests-and-evals` |

## The cardinal rule: AIG in front of EVERY LLM call

| What you forfeit by calling providers directly | Why it hurts |
|---|---|
| Caching | Repeat prompts re-charge full cost |
| Rate limiting | A runaway agent burns the monthly budget in an hour |
| Fallback / retry | One provider outage = your agent is down |
| Logs (replay-grade) | Eval harness has nothing to feed on |
| Per-tenant metadata | You can't roll up cost by `agent_id` or `user_id` |
| Universal request shape | Migrating from OpenAI → Anthropic means rewriting the call site |

The `gateway` parameter on `env.AI.run` does this for Workers AI. For external providers, route through the AIG endpoint URL, not `api.openai.com` / `api.anthropic.com`.

## Workers AI binding

```ts
const out = await env.AI.run(
  "@cf/meta/llama-3.1-8b-instruct",
  { messages: [{ role: "user", content: "hi" }], stream: false },
  {
    gateway: {
      id: "my-aig",
      cacheTtl: 3600,
      metadata: { agent_id: this.name, session_id: sessionId }
    }
  }
);
```

### Most-used model IDs

| Model ID | Use for | Notes |
|---|---|---|
| `@cf/meta/llama-3.1-8b-instruct` | General chat, baseline | Cheap, fast, no native tool-use |
| `@cf/meta/llama-3.1-70b-instruct` | Higher-quality chat | Slower, more expensive |
| `@cf/qwen/qwen3-instruct` | Tool-calling | Strong native function-calling |
| `@hf/nousresearch/hermes-2-pro-mistral-7b` | Tool-calling | The canonical Workers AI tool-use model |
| `@cf/deepseek-ai/deepseek-r1-distill` | Reasoning | Slow but strong for hard problems |
| `@cf/baai/bge-base-en-v1.5` | Embeddings, 768 dim | Sweet spot for ai-ideator-style RAG |
| `@cf/baai/bge-small-en-v1.5` | Embeddings, 384 dim | Cheaper, smaller index |
| `@cf/baai/bge-large-en-v1.5` | Embeddings, 1024 dim | Higher recall, larger index |

The dimension is **permanent for the index** — picking 768 vs 1024 locks you in until you re-embed everything. Default to 768 (`bge-base`).

### Streaming

```ts
const stream = await env.AI.run(
  "@cf/meta/llama-3.1-8b-instruct",
  { messages, stream: true }
);
return new Response(stream, { headers: { "content-type": "text/event-stream" } });
```

**Caveat:** streamed responses are NOT cached by AI Gateway. If you need both streaming and caching, fetch the cached non-stream first; fall back to stream-on-miss.

### JSON mode (no streaming)

```ts
const out = await env.AI.run(model, {
  messages,
  response_format: { type: "json_schema", json_schema: zodToJsonSchema(MySchema) }
});
```

JSON mode forces a structured object — but **disables streaming**. Tradeoff: hard structure vs token-by-token UX. Pick based on the surface (tools want structure, chat wants stream).

### Tool calling

Only certain models do native tool-use. Workers AI list:
- `@hf/nousresearch/hermes-2-pro-mistral-7b` — canonical
- `@cf/qwen/qwen3-instruct`
- `@cf/deepseek-ai/deepseek-r1-distill` (reasoning + tools)

For Anthropic / OpenAI, use their tool-use APIs via AIG. Don't try to retrofit text parsing.

## AI Gateway primer

Four value props, each in one paragraph:

### Caching

```ts
{ gateway: { cacheTtl: 3600 } }   // cache for 1h
```

Cache key = SHA-256 of the request body (provider + messages + params). Identical requests within `cacheTtl` return from cache. Headers can override: `cf-aig-cache-ttl: 0` to skip on a specific call. Two big rules:

1. **Streaming is never cached** (the response is too small a unit to hash).
2. **Vary on metadata or skip cache** for per-user content. Otherwise user A's response leaks to user B.

### Rate limiting

Per-gateway rate limits in fixed or sliding windows. Best for keeping a runaway loop from burning the monthly cap.

### Fallback / universal endpoint

Universal endpoint: `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/`

Send a body listing providers; AIG tries them in order. Header `cf-aig-step: 1` in the response tells you which provider answered.

```ts
const r = await fetch(`https://gateway.ai.cloudflare.com/v1/${acct}/${gw}/`, {
  method: "POST",
  body: JSON.stringify([
    { provider: "anthropic", endpoint: "v1/messages", headers: { ... }, query: { ... } },
    { provider: "openai",    endpoint: "chat/completions", headers: { ... }, query: { ... } },
    { provider: "workers-ai", endpoint: "@cf/meta/llama-3.1-8b-instruct", query: { ... } }
  ])
});
```

### Logs

Every request through AIG is logged (with redaction). The Logs API lets you:
- Replay a request to a different model (eval flow).
- Roll up cost by metadata key (`agent_id`, `user_id`, `tenant_id`).
- Build a regression set from prod failures (see `cf-agent-tests-and-evals`).

Use `cf-aig-collect-log: true` to opt in. Use `cf-aig-metadata: {"agent_id": "..."}` to tag.

## Universal vs provider-specific endpoint

| Use case | Pick |
|---|---|
| Single provider, want full SDK ergonomics (Anthropic SDK, OpenAI SDK) | Provider-specific (`https://gateway.ai.cloudflare.com/v1/<acct>/<gw>/anthropic/v1/messages`) |
| Multi-provider failover | Universal endpoint |
| Workers AI only | Use the binding `env.AI.run` with `gateway` param |

The provider-specific path keeps your SDK code unchanged — just swap `baseURL`. Universal trades that for failover.

## Three integration patterns (full code)

### Pattern A — Cached chat agent

```ts
import Anthropic from "@anthropic-ai/sdk";

export class ChatAgent extends AIChatAgent<Env> {
  async onChatMessage(messages: Message[]) {
    const client = new Anthropic({
      baseURL: `https://gateway.ai.cloudflare.com/v1/${this.env.ACCOUNT_ID}/${this.env.AIG_NAME}/anthropic`,
      apiKey: this.env.ANTHROPIC_KEY,
      defaultHeaders: {
        "cf-aig-cache-ttl": "300",
        "cf-aig-metadata": JSON.stringify({ agent_id: this.name })
      }
    });
    return client.messages.stream({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      messages,
      // session affinity → AIG hashes prompt prefix the same way every time
      extra_headers: { "x-session-affinity": this.name }
    });
  }
}
```

### Pattern B — Retrieval-augmented agent

```ts
async retrieveAndAnswer(query: string) {
  // Embed the query through Workers AI (no AIG needed for embeddings, but you can)
  const e = await this.env.AI.run("@cf/baai/bge-base-en-v1.5", { text: query });
  const embed = e.data[0];

  // Query Vectorize
  const matches = await this.env.VECTORIZE.query(embed, {
    topK: 8,
    returnMetadata: "all",
    filter: { tier: { $eq: "T1" } }   // metadata filter
  });

  const context = matches.matches.map(m => m.metadata.text).join("\n\n");
  // Generate via Anthropic-through-AIG
  return this.anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    messages: [
      { role: "user", content: `Context:\n${context}\n\nQuery: ${query}` }
    ]
  });
}
```

### Pattern C — Multi-provider failover

```ts
const r = await fetch(
  `https://gateway.ai.cloudflare.com/v1/${env.ACCOUNT_ID}/${env.AIG_NAME}/`,
  { method: "POST", body: JSON.stringify([
    { provider: "anthropic", endpoint: "v1/messages",
      headers: { "x-api-key": env.ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      query: { model: "claude-3-5-sonnet-20241022", max_tokens: 1024, messages } },
    { provider: "openai", endpoint: "chat/completions",
      headers: { authorization: `Bearer ${env.OPENAI_KEY}` },
      query: { model: "gpt-4o", messages } },
    { provider: "workers-ai", endpoint: "@cf/meta/llama-3.1-70b-instruct",
      query: { messages } }
  ])}
);
const stepUsed = r.headers.get("cf-aig-step");   // "1"=anthropic, "2"=openai, "3"=workers-ai
```

## Vectorize cookbook

### Create

```bash
wrangler vectorize create ai-ideator-concepts --dimensions=768 --metric=cosine
wrangler vectorize create-metadata-index ai-ideator-concepts --property-name=tier --type=string
wrangler vectorize create-metadata-index ai-ideator-concepts --property-name=ts --type=number
```

**Dimensions are permanent.** Match to the embedding model. `bge-base-en-v1.5` = 768. Don't guess.

### Upsert

```ts
const vectors = chunks.map((chunk, i) => ({
  id: `${docId}#${i}`,
  values: embeddings[i],
  metadata: { docId, chunkIndex: i, text: chunk.text, tier: chunk.tier }
}));
await env.VECTORIZE.upsert(vectors);
```

### Query

```ts
const r = await env.VECTORIZE.query(queryEmbedding, {
  topK: 5,
  returnMetadata: "all",
  // 8 metadata operators: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin
  filter: { tier: { $in: ["T1", "T2"] }, ts: { $gt: 1700000000000 } }
});
```

**Gotcha:** metadata indexes are NOT retroactive. Add the index BEFORE upserting — otherwise existing rows are invisible to filters using that field. Re-upsert if you forgot.

## AI Search vs DIY RAG

| Pick | When |
|---|---|
| **AI Search** (formerly AutoRAG) | Single-source RAG, opinionated chunking is fine, you don't want to maintain ingest |
| **DIY RAG** (Workers AI embed → Vectorize → LLM) | Multi-source, custom chunking strategy, fine-grained control |

For ai-ideator: DIY. The KB has nuanced tier and provenance metadata that AI Search wouldn't preserve.

## Prompt discipline (Cloudflare-runtime aware)

Cloudflare agents *hibernate*. The system prompt cannot assume "the conversation is fresh" — the agent might be waking up to a 2-hour-old chat and a single new message. Discipline:

| Mistake | Fix |
|---|---|
| "You are a helpful assistant. The user just said: ..." | "You are a helpful assistant. The conversation history is provided. Continue from where it left off." |
| Hardcoding the current date | Inject `new Date().toISOString()` into the system prompt at every call |
| Tool list embedded in prompt | Let the SDK's `tools` parameter handle it; don't duplicate |
| No format spec | Specify the output shape explicitly (model otherwise drifts) |
| `temperature: 1.0` for tool-use | `temperature: 0` for tool selection; raise only for creative free-text |

Run `scripts/prompt-lint.ts` over your system prompts. It flags the common mistakes.

## Cost control

```ts
// Per-call cap (Workers AI)
{ gateway: { cacheTtl: 600 }, max_tokens: 1024 }

// Per-tenant rate limit (AIG)
// Configure in the dashboard; alarms via Workers Analytics Engine
```

For ongoing observability, run `scripts/aig-cost-rollup.ts` daily — pulls AIG logs, rolls up by metadata tag, posts to Slack.

## Hand-offs

| Next concern | Skill |
|---|---|
| Test the model layer (mock `env.AI.run`) | `cf-agent-tests-and-evals` |
| Tools that USE the model | `cf-agent-tools-and-mcp` |
| RAG storage details | `cf-agent-state-and-storage` |
| AIG cost dashboards / alerts | `cf-agent-deploy-and-observe` |
| Per-user model selection (BYO key) | `cf-agent-auth-and-permissions` |

## Non-negotiables

1. **AIG in front of every LLM call.** Direct provider calls are an anti-pattern.
2. **Streaming responses are never cached.** Don't expect them to be.
3. **JSON mode disables streaming.** Tradeoff explicit.
4. **Vectorize dimensions are permanent.** Match to embedding model on day 1.
5. **Metadata indexes are not retroactive.** Create before upsert.
6. **Tag every call with `cf-aig-metadata`** so cost rollups by tenant/agent work.
7. **`temperature: 0` for tool selection.** Raise only for creative output.

## See also

- `references/model-catalog.md` — full Workers AI ID list with dims and tool-use support
- `references/ai-gateway-recipes.md` — caching, rate-limit, fallback, logs cookbook
- `references/vectorize-cookbook.md` — index design and operations
- `references/rag-patterns.md` — DIY vs AI Search, embedding strategy
- `references/prompt-discipline.md` — system prompt patterns for hibernating agents
- `scripts/prompt-lint.ts` — flag common system-prompt mistakes
- `scripts/aig-cost-rollup.ts` — daily cost rollup from AIG logs
