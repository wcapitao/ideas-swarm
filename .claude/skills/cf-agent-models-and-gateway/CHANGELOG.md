# Changelog

## v0.1.0 — 2026-04-30

Initial skill, derived from `docs/research/cf-ai-stack.md` (Workers AI / AIG / Vectorize / AI Search) and `cf-agents-core.md` §9.

The cardinal rule (AIG in front of every LLM call) is the spine. Streaming-not-cached, JSON-mode-no-streaming, and dimension-lock-in are the three permanent decisions. Three full integration patterns (cached chat, retrieval, multi-provider failover) are copy-pasteable.

The AutoRAG → AI Search rename is captured. Default embedding model is `@cf/baai/bge-base-en-v1.5` (768 dim) — sweet spot for ai-ideator-style RAG.
