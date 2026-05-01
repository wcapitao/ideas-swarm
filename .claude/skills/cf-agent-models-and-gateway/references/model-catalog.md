# Workers AI model catalog (curated)

Models you'll actually use in a Cloudflare Agent. Full catalog at https://developers.cloudflare.com/workers-ai/models/.

## Text generation

| Model ID | Use for | Tool-use | Stream | Notes |
|---|---|---|---|---|
| `@cf/meta/llama-3.1-8b-instruct` | Default chat baseline | No (text-only) | Yes | Cheap, fast, fine for simple chat |
| `@cf/meta/llama-3.1-70b-instruct` | Higher-quality chat | No | Yes | Slower; use when 8b underperforms |
| `@cf/qwen/qwen3-instruct` | Tool-calling chat | Yes (native) | Yes | Strong tool selection |
| `@hf/nousresearch/hermes-2-pro-mistral-7b` | Tool-calling | Yes (canonical) | Yes | Cloudflare's flagship Workers AI tool-use model |
| `@cf/deepseek-ai/deepseek-r1-distill` | Reasoning + tools | Yes | Yes | Slow but strong on hard tasks |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | Mid-size multilingual | Yes | Yes | Good non-English support |

For Anthropic / OpenAI models, route through AI Gateway. Don't use `env.AI.run` for non-CF models.

## Embeddings

| Model ID | Dim | Use for | Pricing tier |
|---|---|---|---|
| `@cf/baai/bge-small-en-v1.5` | 384 | Cheap RAG, smaller index | Lower per-vector |
| `@cf/baai/bge-base-en-v1.5` | 768 | **Default for most agents** | Mid |
| `@cf/baai/bge-large-en-v1.5` | 1024 | Higher recall, larger index | Higher |
| `@cf/baai/bge-m3` | 1024 | Multilingual + multi-granularity | Higher |

**The dimension is permanent for the index.** Switching from `bge-small` (384) to `bge-base` (768) means rebuilding the Vectorize index from scratch. Pick once.

For ai-ideator's KB scale (hundreds to low thousands of chunks), `bge-base-en-v1.5` (768) is the sweet spot.

## Classification / NLI / re-ranking

| Model ID | Use for |
|---|---|
| `@cf/baai/bge-reranker-base` | Reranking top-K Vectorize results before LLM input |
| `@cf/huggingface/distilbert-sst-2-int8` | Sentiment |
| `@cf/cross-encoder/ms-marco-minilm-l-12-v2` | Cross-encoder reranking |

The reranker is the unsung hero of RAG quality — Vectorize gets you top-50, the reranker gets you top-5 worth showing the LLM.

## Speech

| Model ID | Use for |
|---|---|
| `@cf/openai/whisper` | ASR / transcription |
| `@cf/myshell-ai/melotts` | TTS |

Wire via the `withVoice` agent layer if needed (rare).

## Image (rarely needed for ai-ideator)

| Model ID | Use for |
|---|---|
| `@cf/black-forest-labs/flux-1-schnell` | Fast text-to-image |
| `@cf/lykon/dreamshaper-8-lcm` | Stable Diffusion variant |

## Pricing model

Workers AI bills in **Neurons** — abstract units mapped to model cost. Free tier covers experimentation; production costs accrue on Neurons consumed per call. See https://developers.cloudflare.com/workers-ai/platform/pricing/.

## When to pick what

| Need | Pick |
|---|---|
| Default agent chat, no tools | `@cf/meta/llama-3.1-8b-instruct` |
| Default agent chat, with tools | `@hf/nousresearch/hermes-2-pro-mistral-7b` |
| Quality chat with strong tools | `@cf/qwen/qwen3-instruct` |
| Reasoning-heavy single-shot | `@cf/deepseek-ai/deepseek-r1-distill` |
| Top-shelf chat (cost no object) | Anthropic `claude-3-5-sonnet-20241022` via AIG |
| Embeddings (default) | `@cf/baai/bge-base-en-v1.5` |
| Reranking | `@cf/baai/bge-reranker-base` |
| Judge model for evals | `claude-3-5-sonnet-20241022` via AIG (default), `@cf/meta/llama-3.1-70b-instruct` (cheap tier) |

## Model selection checklist

Before locking in a model, ask:

1. Does it need tool-use? (Removes most `cf-meta/llama-*-instruct` from the list.)
2. Does it need streaming? (Removes JSON-mode if mutually exclusive.)
3. What's the per-call latency budget? (8b<70b, claude-haiku<claude-sonnet.)
4. What's the per-call cost ceiling? (Bench actual costs against AIG logs — not docs.)
5. What language(s)? (English-only → bge-en; mixed → bge-m3 or qwen.)
6. What context window do you actually need? (Most agents use <16k.)

Lock these into the architecture spec from `cf-agent-architect`. Pin model IDs in `wrangler.jsonc` `vars` so a model switch is a config change, not a code change.
