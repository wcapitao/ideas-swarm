# Cloudflare AI Stack — Technical Brief for Agents SDK Authors

> Scope: Workers AI, AI Gateway, Vectorize, AutoRAG (now AI Search), and how they compose with the Cloudflare Agents SDK. Audience: someone writing specialist-level LLM playbooks for an Agents-SDK-on-Workers stack. Every load-bearing claim is cited.

---

## 1. Workers AI binding

### 1.1 The `env.AI.run()` shape

Workers AI is exposed to a Worker (or Pages Function or Durable Object — including an Agent) as a single binding declared in `wrangler.toml`/`wrangler.jsonc`:

```toml
[ai]
binding = "AI"
```

```json
{ "ai": { "binding": "AI" } }
```

Source: [Workers AI bindings](https://developers.cloudflare.com/workers-ai/configuration/bindings/).

The whole API surface is one method:

```ts
const answer = await env.AI.run(model, options, gatewayOpts?);
```

- `model` — the model ID, e.g. `@cf/meta/llama-3.1-8b-instruct`.
- `options` — input payload. Common keys: `prompt`, `messages`, `stream`, `max_tokens`, plus model-specific ones (`response_format` for JSON mode, `tools` for function calling, `lora` for LoRA adapters).
- Third arg — gateway routing options (covered in §2).

Source: [Workers AI bindings](https://developers.cloudflare.com/workers-ai/configuration/bindings/), [AI Gateway + Workers AI binding](https://developers.cloudflare.com/ai-gateway/integrations/aig-workers-ai-binding/).

There are no API keys to manage — the binding is authenticated by the Worker's own identity. This matters inside an Agent: zero secrets to leak, and zero round-trip to a key vault on cold start.

### 1.2 Streaming

Pass `stream: true` and the binding returns a `ReadableStream` of Server-Sent Events that you can pipe straight back to the client:

```ts
const stream = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
  prompt: "What is the origin of the phrase 'Hello, World'",
  stream: true,
});
return new Response(stream, {
  headers: { 'content-type': 'text/event-stream' },
});
```

Source: [Workers AI bindings](https://developers.cloudflare.com/workers-ai/configuration/bindings/).

This is the only mode you should use for chat UIs — non-streaming responses sit on the GPU until the full completion is done, which kills perceived latency on 70B-class models.

### 1.3 Tool / function calling

Tool calling on Workers AI requires a model that has been fine-tuned for it. The catalog flags these with a "function calling" property; the canonical example is `@hf/nousresearch/hermes-2-pro-mistral-7b`. Several Qwen3 and DeepSeek-R1 variants also support it.

Source: [Function calling](https://developers.cloudflare.com/workers-ai/features/function-calling/), [Workers AI models](https://developers.cloudflare.com/workers-ai/models/).

Two implementation paths:

1. **Embedded function calling** via the `@cloudflare/ai-utils` package — exposes `runWithTools()`, `createToolsFromOpenAPISpec()`, and `autoTrimTools()`. Cloudflare's docs claim this collapses a 77-line manual loop to 31 lines.
2. **Traditional** — you manage the messages → tool_call → tool_result → next-turn loop yourself.

Source: [Function calling](https://developers.cloudflare.com/workers-ai/features/function-calling/).

For Agents SDK work, pick `runWithTools` only when you want a one-shot helper inside a tool. For the agent loop itself, you usually want manual control because the Agents SDK already owns turn orchestration.

### 1.4 LoRA fine-tunes

Workers AI supports LoRA adapters (open beta, free) on a subset of models — Mistral, Gemma, and Llama variants. Constraints:

- Adapter rank ≤ 8 (up to 32 for "larger ranks").
- Adapter file size < 300 MB.
- Files must be named exactly `adapter_config.json` and `adapter_model.safetensors`.
- Max 100 LoRAs per account.
- `model_type` must be set to `mistral`, `gemma`, or `llama` in `adapter_config.json` before upload.

Upload via Wrangler or REST:

```bash
npx wrangler ai finetune create <model_name> <finetune_name> <folder_path>
```

Use it at inference time with the `lora` parameter:

```ts
await env.AI.run('@cf/mistralai/mistral-7b-instruct-v0.2-lora', {
  messages: [{ role: 'user', content: 'Hello world' }],
  lora: 'finetune_id_or_name',
});
```

Source: [LoRA fine-tunes](https://developers.cloudflare.com/workers-ai/features/fine-tunes/loras/).

### 1.5 Embedding models you'll actually use

| Model ID | Dimensions | Use |
|---|---|---|
| `@cf/baai/bge-small-en-v1.5` | 384 | cheapest; good for ANN over short text |
| `@cf/baai/bge-base-en-v1.5` | 768 | default — matches Cohere `embed-multilingual-v2.0` |
| `@cf/baai/bge-large-en-v1.5` | 1024 | best recall, 2.6× the cost of small |
| `@cf/google/embeddinggemma-300m` | varies | newer, multilingual |

Source: [Workers AI models](https://developers.cloudflare.com/workers-ai/models/).

For text-gen, the workhorses are `@cf/meta/llama-3.1-8b-instruct`, `@cf/meta/llama-3.1-70b-instruct`, `@cf/mistral/mistral-7b-instruct-v0.1` (LoRA-supported), `@cf/qwen/qwen3-30b-a3b-fp8` (function calling + reasoning), and `@cf/deepseek/deepseek-r1-distill-qwen-32b` (reasoning). For images, `@cf/black-forest-labs/flux-1-schnell` and `@cf/stabilityai/stable-diffusion-xl-base-1.0`. For speech, `@cf/openai/whisper` and `@cf/openai/whisper-large-v3-turbo`.

Source: [Workers AI models](https://developers.cloudflare.com/workers-ai/models/).

### 1.6 Pricing — Neurons

Cloudflare measures Workers AI compute in Neurons, "our way of measuring AI outputs across different models, representing the GPU compute needed to perform your request."

- **Free allocation:** 10,000 Neurons/day on every plan, resets at 00:00 UTC.
- **Paid rate:** $0.011 per 1,000 Neurons over the daily allocation (Workers Paid plan only).
- **Free plan:** hard-capped at 10,000 Neurons/day; over-cap requests fail.

Per-model bands:

- LLMs: $0.027–$0.950 per 1M input tokens; output costs more.
- Embeddings: $0.012–$0.204 per 1M tokens.
- Image: $0.0000528–$0.015 per tile/step.
- Audio: $0.0002–$0.030 per minute or per character.

Source: [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).

### 1.7 Limits you actually hit

Per-model per-account rate limits (req/min):

- Text generation: 300 (range 150–1,500 by model).
- Text embeddings: 3,000 (BGE: 1,500).
- Image classification / object detection: 3,000.
- Text classification: 2,000.
- Text-to-image: 720 (some Stable Diffusion variants 1,500).
- ASR / image-to-text / translation: 720.
- Summarization: 1,500.

Source: [Workers AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/).

Beta models can have lower limits while Cloudflare scales them. Custom higher limits via the Limit Increase form.

---

## 2. AI Gateway primer — the four value props

AI Gateway sits transparently in front of any LLM call and adds caching, rate limiting, retries/fallbacks, and logging/analytics. "Only one line of code to get started" — you change the base URL (or pass `gateway:` to the Workers AI binding) and your provider SDK keeps working unchanged.

Source: [AI Gateway overview](https://developers.cloudflare.com/ai-gateway/).

### 2.1 Caching

Cache key = hash of (provider, endpoint, model, auth header, full request body). Any change to messages, tools, or model parameters cuts a new cache entry. Set TTL with the `cf-aig-cache-ttl` header (min 60 s, max 1 month). Caching is currently text + image only — **streaming responses are not cached.**

```ts
const r = await env.AI.run('@cf/meta/llama-3.1-8b-instruct',
  { prompt: 'Define entropy.' },
  { gateway: { id: 'my-gw', cacheTtl: 3600 } });
```

Source: [Caching](https://developers.cloudflare.com/ai-gateway/configuration/caching/).

### 2.2 Rate limiting

Configure on the gateway (Dashboard → AI > AI Gateway > Settings, or POST via API with `rate_limiting_interval`, `rate_limiting_limit`, `rate_limiting_technique`). Two techniques:

- **Fixed window:** "no more than X requests in a 10-minute window," windows aligned to wall clock.
- **Sliding window:** "no more than X requests in the last 10 minutes," continuously evaluated.

Over-limit requests get HTTP **429**.

Source: [Rate limiting](https://developers.cloudflare.com/ai-gateway/configuration/rate-limiting/).

### 2.3 Fallbacks

When the primary provider errors or hits a configured timeout, AIG retries against the next provider in your list. The successful provider is reported in the `cf-aig-step` response header (0 = primary, 1+ = fallback rank). Wired through the Universal Endpoint:

```bash
curl https://gateway.ai.cloudflare.com/v1/{account}/{gw} \
  --header 'Content-Type: application/json' \
  --data '[
    { "provider":"workers-ai", "endpoint":"@cf/meta/llama-3.1-8b-instruct",
      "headers":{"Authorization":"Bearer {cf_token}"},
      "query":{"messages":[{"role":"user","content":"What is Cloudflare?"}]} },
    { "provider":"openai", "endpoint":"chat/completions",
      "headers":{"Authorization":"Bearer {openai_token}"},
      "query":{"model":"gpt-4o-mini","messages":[{"role":"user","content":"What is Cloudflare?"}]} }
  ]'
```

Source: [Fallbacks](https://developers.cloudflare.com/ai-gateway/configuration/fallbacks/), [Universal endpoint](https://developers.cloudflare.com/ai-gateway/universal/).

### 2.4 Logs & analytics

Every request gets logged by default: prompt, response, provider, timestamp, status, token usage, cost, duration, plus DLP actions if guardrails are on. Per-request overrides:

- `cf-aig-collect-log: false` — drop the entire log for this request.
- `cf-aig-collect-log-payload: false` — keep metadata, drop raw body.
- `cf-aig-metadata: {"user_id":"..."}` — attach custom metadata that becomes filterable in the Logs view.

Analytics dashboard tracks Requests, Token Usage, Costs, Errors, and cached-response percentage. Programmatic access via the GraphQL Analytics API at `https://api.cloudflare.com/client/v4/graphql` with dimensions on model, provider, gateway, and timestamp.

Source: [Logging](https://developers.cloudflare.com/ai-gateway/observability/logging/), [Analytics](https://developers.cloudflare.com/ai-gateway/observability/analytics/).

---

## 3. Universal endpoint vs provider-specific endpoint

Two ways to talk to AIG:

- **Provider-specific endpoint** — `https://gateway.ai.cloudflare.com/v1/{account}/{gw}/{provider}` plus the provider's normal pathname. Drop-in for the provider's SDK by overriding `baseURL`. Supports streaming, all SDK features.
- **Universal endpoint** — `https://gateway.ai.cloudflare.com/v1/{account}/{gw}` (no provider segment). POST a JSON **array** of `{provider, endpoint, headers, query}` objects. AIG tries entry 0 first; on error/timeout, falls through to entry 1, etc.

Source: [Universal endpoint](https://developers.cloudflare.com/ai-gateway/universal/), [Anthropic provider](https://developers.cloudflare.com/ai-gateway/providers/anthropic/), [OpenAI provider](https://developers.cloudflare.com/ai-gateway/providers/openai/).

**Decision rule:**

- Single provider, normal SDK ergonomics, streaming chat — **provider-specific**. Override the Anthropic or OpenAI SDK's `baseURL` and you're done.
- Multi-provider failover (e.g. Anthropic primary → OpenAI fallback → Workers AI fallback), or you want to route on cost/availability without writing the retry logic — **universal**.

The universal endpoint requires you to write request bodies in each provider's native shape, but the response comes back in the format of whichever provider actually answered. That can complicate streaming consumers — see §10.

---

## 4. AI Gateway from inside an Agent — without losing streaming

The Agents SDK gives you `this.env` inside any Agent class, exactly like a normal Worker. Three patterns by call type:

### 4.1 Workers AI through AIG (cheapest path)

```ts
import { Agent } from 'agents';

export class MyAgent extends Agent<Env> {
  async onRequest(req: Request) {
    const stream = await this.env.AI.run(
      '@cf/meta/llama-3.1-8b-instruct',
      { messages: [...], stream: true },
      { gateway: { id: 'my-gw', skipCache: false, cacheTtl: 3360 } },
    );
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  }
}
```

Source: [Agents using AI models](https://developers.cloudflare.com/agents/api-reference/using-ai-models/), [AIG + Workers AI binding](https://developers.cloudflare.com/ai-gateway/integrations/aig-workers-ai-binding/).

### 4.2 Anthropic through AIG (keeps streaming)

```ts
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: this.env.ANTHROPIC_API_KEY,
  baseURL: `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GW_ID}/anthropic`,
});

const stream = anthropic.messages.stream({
  model: 'claude-sonnet-4-5',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'hi' }],
});
```

Source: [Anthropic via AIG](https://developers.cloudflare.com/ai-gateway/providers/anthropic/).

### 4.3 OpenAI through AIG (keeps streaming)

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: this.env.OPENAI_API_KEY,
  baseURL: `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GW_ID}/openai`,
});

const stream = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'hi' }],
  stream: true,
});
```

Source: [OpenAI via AIG](https://developers.cloudflare.com/ai-gateway/providers/openai/).

**Why provider-specific over universal here:** the SDK keeps emitting deltas natively, and your tool-call parsing, function-call schema validation, and refusal handling all keep working. The universal endpoint changes the response wire format and breaks SDK streaming helpers. Use universal **only** when you actually want cross-provider failover for the same logical request.

---

## 5. AI Gateway evaluations + guardrails

### 5.1 Evaluations

You build datasets by filtering the Logs tab — pick a slice of real production requests and freeze it. Then you run evaluators against the dataset to score performance, latency, and cost trade-offs. The current evaluator is **human feedback (open beta)**; Cloudflare states the framework is designed to grow with additional evaluators.

Source: [Evaluations](https://developers.cloudflare.com/ai-gateway/evaluations/).

For production agent work today, treat AIG evaluations as a labeling/triage UI on top of your real traffic — useful for spotting drift, but not a substitute for an offline eval harness with deterministic scoring.

### 5.2 Guardrails

A safety proxy that intercepts both the user prompt and the model response, evaluates against hazard categories (violence, hate, sexual content among others), and either flags (logs) or blocks. Configurable per gateway and per direction (prompt vs. response). Works against the major providers — OpenAI, Anthropic, DeepSeek, etc.

Source: [Guardrails](https://developers.cloudflare.com/ai-gateway/guardrails/).

The hooks here are coarse — useful for compliance posture, not a replacement for input/output sanitizers in your tool layer.

---

## 6. Vectorize cookbook

Vectorize is a globally distributed vector DB exposed as a Worker binding. Tight integration with Workers AI embeddings, R2 (for source files), KV, and D1 (for joined metadata).

Source: [Vectorize overview](https://developers.cloudflare.com/vectorize/).

### 6.1 Create the index

```bash
# 768-dim cosine — matches @cf/baai/bge-base-en-v1.5
npx wrangler vectorize create concepts \
  --dimensions=768 --metric=cosine
```

Three required inputs: name (kebab-case), dimensions (must match your embedding model exactly), and distance metric (`cosine` | `euclidean` | `dot-product`). **Dimensions and metric are immutable.** You cannot change them post-creation; you create a new index and re-embed.

Source: [Create indexes](https://developers.cloudflare.com/vectorize/best-practices/create-indexes/).

### 6.2 Bind it to your Worker

```toml
[[vectorize]]
binding = "CONCEPTS"
index_name = "concepts"
```

### 6.3 Embed → upsert → query (full shape)

```ts
type Env = {
  AI: Ai;
  CONCEPTS: VectorizeIndex;
};

export default {
  async fetch(req: Request, env: Env) {
    // 1. Embed via Workers AI
    const docs = ['Combinatorial creativity is...', 'Self-Refine (Madaan 2023)...'];
    const { data: embeddings } = await env.AI.run(
      '@cf/baai/bge-base-en-v1.5',
      { text: docs },
    );

    // 2. Upsert with metadata
    await env.CONCEPTS.upsert(
      embeddings.map((values, i) => ({
        id: `doc-${i}`,
        values,
        metadata: { source: 'kb', tier: 'T1', topic: 'creativity' },
        namespace: 'phase-0',
      })),
    );

    // 3. Query with metadata filter
    const { data: [qVec] } = await env.AI.run(
      '@cf/baai/bge-base-en-v1.5',
      { text: ['What is combinatorial creativity?'] },
    );
    const matches = await env.CONCEPTS.query(qVec, {
      topK: 5,
      filter: { tier: { $eq: 'T1' }, topic: { $in: ['creativity', 'reasoning'] } },
      returnMetadata: 'all',
    });
    return Response.json(matches);
  },
};
```

Sources: [Client API](https://developers.cloudflare.com/vectorize/reference/client-api/), [Metadata filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/).

### 6.4 What the API actually exposes

| Method | Signature | Notes |
|---|---|---|
| `insert` | `(vectors: Vector[]) => Promise<MutationId>` | Skips IDs that already exist. |
| `upsert` | `(vectors: Vector[]) => Promise<MutationId>` | Full-replace by ID (not merge). |
| `query` | `(vector: number[], options) => Promise<Match[]>` | `topK` default 5, max 100 (50 with values/metadata). |
| `getByIds` | `(ids: string[]) => Promise<Vector[]>` | Returns full vectors with metadata. |
| `deleteByIds` | `(ids: string[]) => Promise<MutationId>` | Async; completes within seconds. |

Mutations return a `MutationId`; the docs note vectors become queryable "within seconds." Don't gate user reads on the mutation immediately.

Source: [Client API](https://developers.cloudflare.com/vectorize/reference/client-api/).

### 6.5 Metadata filter operators

`$eq`, `$ne`, `$in`, `$nin`, `$lt`, `$lte`, `$gt`, `$gte`. Supported value types: string, number, boolean. **Important constraint:** "Vectors upserted before a metadata index was created won't have their metadata contained in that index." Build your metadata-index plan **before** the first big upsert. Each metadata index covers only the first **64 bytes** of a string field, so don't try to index article titles.

Source: [Metadata filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/).

### 6.6 Limits you should design around

- 10 M vectors per index (max).
- Max 1,536 dimensions per vector, 32-bit precision.
- 10 KiB metadata per vector.
- 10 metadata indexes per Vectorize index.
- 50,000 namespaces per index (Workers Paid; 1,000 on Free).
- 100 indexes per account on Free; 50,000 on Workers Paid.
- Upsert batch: 1,000 (Workers binding) / 5,000 (HTTP API). Total upload ≤ 100 MB.
- `topK` ≤ 100 without values/metadata, ≤ 50 with them.

Source: [Vectorize limits](https://developers.cloudflare.com/vectorize/platform/limits/).

### 6.7 Pricing — dimension-priced, not vector-priced

- **Stored:** $0.05 per 100 M dimensions/month (after 5 M free dimensions on Free tier; 10 M included on Paid).
- **Queried:** $0.01 per 1 M queried dimensions (after 30 M/month on Free; 50 M included on Paid).
- Inactive indexes are not billed.

Cost scales linearly with dimension count: 1024-dim BGE-large is ~2.7× the cost of 384-dim BGE-small for identical traffic. Pick the smallest dim that hits your recall target.

Source: [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/).

---

## 7. AutoRAG (now AI Search) vs DIY RAG

Cloudflare renamed AutoRAG → **AI Search**. It is a managed RAG primitive that owns the entire pipeline: data ingestion (R2 buckets, websites, direct upload), chunking, embedding, indexing, hybrid retrieval (semantic + keyword), and metadata filtering. You point it at a source, query it with natural language, and it gives you grounded answers. Instances created after April 16, 2026 ship with managed storage.

Sources: [AI Search overview](https://developers.cloudflare.com/ai-search/), [AI Search getting started](https://developers.cloudflare.com/ai-search/get-started/).

### When AI Search is the right answer

- Documentation search, internal knowledge bases, per-tenant file search.
- You want continuous re-indexing as the source changes — AI Search automates this.
- You don't have strong opinions on chunker, embedding model, or retrieval strategy.
- You want a fast path to a production agent tool: "search the docs."

### When you DIY (Workers AI + Vectorize + your own glue)

- You need to control chunking — semantic chunking, sentence-window, parent-document, late-chunking, etc.
- You need a custom embedding model (LoRA, multilingual, multimodal).
- You need a hybrid score blending you can tune (BM25 weight, MMR re-rank, cross-encoder rerank).
- Your data isn't documents — it's structured records, conversations, code, tabular rows, where pipelines diverge from the document-RAG happy path.
- You need to filter on more than 10 metadata fields, or non-trivial metadata (>64 B per index field).
- You want every retrieval call traceable back to a deterministic embed-and-search step (Stella Principle).

For the **ai-ideator** project's combinatorial creativity use case, DIY RAG wins: concept ontology and atomic-concept extraction are weird enough that the canned chunker won't preserve our atomicity guarantee.

---

## 8. Composing the AI stack inside an Agents SDK agent

### 8.1 Chat agent with cached prompts (cheap path, all-Cloudflare)

```ts
export class ChatAgent extends Agent<Env, { messages: Msg[] }> {
  async onMessage(ws: WebSocket, raw: string) {
    const msg = JSON.parse(raw);
    this.setState({ messages: [...this.state.messages, msg] });

    const stream = await this.env.AI.run(
      '@cf/meta/llama-3.1-8b-instruct',
      { messages: this.state.messages, stream: true },
      {
        gateway: { id: 'chat-gw', cacheTtl: 3600 },
        // x-session-affinity gets you Workers AI prompt-prefix caching
        extraHeaders: { 'x-session-affinity': this.name },
      },
    );

    for await (const chunk of stream) ws.send(chunk);
  }
}
```

`x-session-affinity` routes requests with the same key to the same model instance, so Workers AI can reuse prefill tensors across turns within one Agent instance. Combined with AIG response caching for repeated prompts, you cut both compute and tokens.

Sources: [Agents using AI models](https://developers.cloudflare.com/agents/api-reference/using-ai-models/), [Workers AI prompt caching](https://developers.cloudflare.com/workers-ai/features/prompt-caching/), [AIG caching](https://developers.cloudflare.com/ai-gateway/configuration/caching/).

### 8.2 Agent with retrieval (Workers AI embed + Vectorize + LLM through AIG)

```ts
export class IdeaAgent extends Agent<Env> {
  async onRequest(req: Request) {
    const { question } = await req.json();

    // 1. Embed query
    const { data: [qVec] } = await this.env.AI.run(
      '@cf/baai/bge-base-en-v1.5',
      { text: [question] },
    );

    // 2. Retrieve concepts
    const { matches } = await this.env.CONCEPTS.query(qVec, {
      topK: 8,
      filter: { tier: { $in: ['T1', 'T2'] } },
      returnMetadata: 'all',
    });

    // 3. Generate via Anthropic through AIG (streaming)
    const anthropic = new Anthropic({
      apiKey: this.env.ANTHROPIC_API_KEY,
      baseURL: `https://gateway.ai.cloudflare.com/v1/${this.env.CF_ACCOUNT_ID}/ideator-gw/anthropic`,
    });
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      system: buildSystemPrompt(matches),
      messages: [{ role: 'user', content: question }],
    });
    return new Response(toSSE(stream), {
      headers: { 'content-type': 'text/event-stream' },
    });
  }
}
```

This is the Stella-clean shape: Workers AI does the deterministic embed, Vectorize does the deterministic retrieval, Claude does the judgment. AIG owns the cache + log + cost layer.

### 8.3 Agent with multi-provider fallback (AIG universal endpoint)

```ts
const res = await fetch(
  `https://gateway.ai.cloudflare.com/v1/${ACCOUNT}/${GW}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([
      { provider: 'anthropic', endpoint: 'v1/messages',
        headers: { 'x-api-key': env.ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        query: { model: 'claude-sonnet-4-5', max_tokens: 1024, messages } },
      { provider: 'openai', endpoint: 'chat/completions',
        headers: { Authorization: `Bearer ${env.OPENAI_KEY}` },
        query: { model: 'gpt-4o', messages } },
      { provider: 'workers-ai', endpoint: '@cf/meta/llama-3.1-70b-instruct',
        headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` },
        query: { messages } },
    ]),
  },
);
const usedStep = res.headers.get('cf-aig-step'); // 0=anthropic, 1=openai, 2=cf
```

Use this only when the request is genuinely interchangeable across providers (e.g. summarization, translation, vanilla chat). For tool-using agents, the providers' tool-call wire formats diverge enough that universal-endpoint fallback breaks the tool loop.

Source: [Universal endpoint](https://developers.cloudflare.com/ai-gateway/universal/).

---

## 9. Limits + pricing summary

| Layer | Free tier | Paid rate | Key unit |
|---|---|---|---|
| Workers AI | 10,000 Neurons/day | $0.011 / 1,000 Neurons | Neuron = GPU compute unit |
| AI Gateway | Included with Workers | Pass-through provider costs | (gateway itself is free) |
| Vectorize stored | 5 M dimensions | $0.05 / 100 M dimensions/month (after 10 M included on Paid) | dimension·month |
| Vectorize queries | 30 M queried dims/month | $0.01 / 1 M queried dimensions (after 50 M included on Paid) | queried dimension |

Sources: [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/).

**Mental model:** AI Gateway itself doesn't charge you — it's pure infra. You pay for Workers AI Neurons or your provider's tokens, and AIG's caching is what reduces that bill. Vectorize is separately billed per dimension stored and per dimension queried; cost is dominated by your embedding-model dimension count, not by index size.

---

## 10. Gotchas

1. **Streaming + caching don't compose.** AIG caching is text/image-only — streaming responses bypass the cache. Source: [Caching](https://developers.cloudflare.com/ai-gateway/configuration/caching/). For chat UX, streaming wins; for batch summarization, prefer non-streaming so you can cache.
2. **Vector dimension lock-in.** Vectorize index dimensions and metric are immutable. Switching from BGE-small (384) to BGE-base (768) means a new index and a full re-embed. Plan dimension before the first upsert. Source: [Create indexes](https://developers.cloudflare.com/vectorize/best-practices/create-indexes/).
3. **Metadata index is retroactive-blind.** Vectors upserted before a metadata index existed will not appear in that index — they're invisible to filters on that field. Define metadata indexes first. Source: [Metadata filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/).
4. **64-byte metadata index ceiling.** Don't index long strings; hash them or use enum-style category fields. Source: [Metadata filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/).
5. **JSON mode doesn't stream.** "JSON Mode currently doesn't support streaming." If you need structured output and streaming, use tool calling with a single tool, not JSON mode. Source: [JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/).
6. **Universal endpoint changes wire format.** The response shape on the universal endpoint reflects whichever provider answered, which can break SDK consumers expecting a specific format. Use provider-specific endpoints when you want SDK ergonomics; reserve universal for cross-provider failover. Source: [Universal endpoint](https://developers.cloudflare.com/ai-gateway/universal/).
7. **Function calling requires a function-tuned model.** Plain Llama-3.1-8B won't honor `tools` reliably. Use `@hf/nousresearch/hermes-2-pro-mistral-7b`, Qwen3, or DeepSeek variants flagged for function calling. Source: [Function calling](https://developers.cloudflare.com/workers-ai/features/function-calling/).
8. **LoRA can't be quantized.** LoRA adapters work only with non-quantized base models, and require exact filenames + a `model_type` of `mistral`/`gemma`/`llama`. Source: [LoRA fine-tunes](https://developers.cloudflare.com/workers-ai/features/fine-tunes/loras/).
9. **Beta models have lower rate limits.** "Beta models may have lower rate limits while we work on performance and scale." Source: [Workers AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/). Don't bet a customer-facing path on a beta model without checking the per-model figure.
10. **Cache key is sensitive to everything in the body.** Including tool definitions and message order. If your agent dynamically reorders tools or appends timestamps to system prompts, you'll never get a cache hit. Stabilize prefixes. Source: [Caching](https://developers.cloudflare.com/ai-gateway/configuration/caching/).
11. **`cf-aig-step` is your fallback observability hook.** Read it on every response when using fallbacks; surface it in logs/metrics so you can see how often you're failing over and to which provider. Source: [Fallbacks](https://developers.cloudflare.com/ai-gateway/configuration/fallbacks/).
12. **Free Workers plan hard-fails over 10 K Neurons/day.** Don't put a Free-plan deploy in front of public traffic — there's no overage path. Source: [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).
13. **AI Search vs AutoRAG naming.** The product was renamed; existing AutoRAG references in older docs/blog posts point at AI Search. Source: [AI Search](https://developers.cloudflare.com/ai-search/).
14. **Per-region model availability isn't documented in the limits page.** The limits page covers rate, not geography. Cloudflare doesn't publish a per-region model availability matrix; treat regional fallback as a Cloudflare-internal concern, but if a model is in beta in your account, expect cold-start latency variance. Source: [Workers AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/).

---

## Appendix — URL index

- Workers AI: https://developers.cloudflare.com/workers-ai/
- Workers AI bindings: https://developers.cloudflare.com/workers-ai/configuration/bindings/
- Workers AI models: https://developers.cloudflare.com/workers-ai/models/
- Workers AI function calling: https://developers.cloudflare.com/workers-ai/features/function-calling/
- Workers AI JSON mode: https://developers.cloudflare.com/workers-ai/features/json-mode/
- Workers AI prompt caching: https://developers.cloudflare.com/workers-ai/features/prompt-caching/
- Workers AI LoRA: https://developers.cloudflare.com/workers-ai/features/fine-tunes/loras/
- Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Workers AI limits: https://developers.cloudflare.com/workers-ai/platform/limits/
- AI Gateway: https://developers.cloudflare.com/ai-gateway/
- AI Gateway providers: https://developers.cloudflare.com/ai-gateway/providers/
- AI Gateway universal endpoint: https://developers.cloudflare.com/ai-gateway/universal/
- AI Gateway caching: https://developers.cloudflare.com/ai-gateway/configuration/caching/
- AI Gateway rate limiting: https://developers.cloudflare.com/ai-gateway/configuration/rate-limiting/
- AI Gateway fallbacks: https://developers.cloudflare.com/ai-gateway/configuration/fallbacks/
- AI Gateway logging: https://developers.cloudflare.com/ai-gateway/observability/logging/
- AI Gateway analytics: https://developers.cloudflare.com/ai-gateway/observability/analytics/
- AI Gateway evaluations: https://developers.cloudflare.com/ai-gateway/evaluations/
- AI Gateway guardrails: https://developers.cloudflare.com/ai-gateway/guardrails/
- AI Gateway + Workers AI binding: https://developers.cloudflare.com/ai-gateway/integrations/aig-workers-ai-binding/
- AI Gateway Anthropic: https://developers.cloudflare.com/ai-gateway/providers/anthropic/
- AI Gateway OpenAI: https://developers.cloudflare.com/ai-gateway/providers/openai/
- Vectorize: https://developers.cloudflare.com/vectorize/
- Vectorize create indexes: https://developers.cloudflare.com/vectorize/best-practices/create-indexes/
- Vectorize client API: https://developers.cloudflare.com/vectorize/reference/client-api/
- Vectorize metadata filtering: https://developers.cloudflare.com/vectorize/reference/metadata-filtering/
- Vectorize limits: https://developers.cloudflare.com/vectorize/platform/limits/
- Vectorize pricing: https://developers.cloudflare.com/vectorize/platform/pricing/
- AI Search (formerly AutoRAG): https://developers.cloudflare.com/ai-search/
- AI Search getting started: https://developers.cloudflare.com/ai-search/get-started/
- Agents SDK: https://developers.cloudflare.com/agents/
- Agents SDK using AI models: https://developers.cloudflare.com/agents/api-reference/using-ai-models/
