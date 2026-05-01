# ai-ideator — Agentic Ideation System Architecture

| Field | Value |
|---|---|
| **Document ID** | `ARCH-001` |
| **Version** | `0.1 (draft for product/engineering review)` |
| **Status** | `Proposed` |
| **Owner** | modernwinds@gmail.com |
| **Last updated** | 2026-05-01 |
| **Supersedes** | — |
| **Related** | `docs/CONCEPT.md`, `docs/ROADMAP.md`, `kb/SCHEMA.md`, `CLAUDE.md` |
| **Hand-off** | See §15 — every CF-skill (cf-agent-*) that owns a sub-system |

> **Reading order.** §1–§3 set the frame and improvements over the original plan. §4–§9 are the architecture proper (agents, primitives, data plane, schemas). §10–§13 are the operational guarantees (control flow, observability, failure, security). §14 lists open questions; §15 is the implementation phasing; §16 hands off to specialist skills.

---

## 1. Context and problem statement

### 1.1 Mission

Build an **agentic LLM workflow that produces structured, novel, traceable ideas via combinatorial creativity**. The thesis is anchored in `docs/CONCEPT.md` (Hume → Koestler → Boden → Fauconnier-Turner → Mednick): novelty is a function of distance between recombined concepts, and quality is a function of disciplined evaluation. Free-form ideas are not the artifact — **structured blends with full provenance are**.

### 1.2 The system in one diagram

```
                                 ┌──────────────────────────────────────┐
                                 │             USER / EXT AGENT          │
                                 └───────────────────┬───────────────────┘
                                                     │ goal text
                                                     ▼
                                       ┌──────────────────────────┐
                                       │     IdeatorAgent          │  AIChatAgent (DO, SQLite)
                                       │   (front door, per-user)  │  name = user-${userId}
                                       └────────┬──────────┬───────┘
                                  spawn goal DO │          │ persist transcript
                                                ▼          │
                                  ┌──────────────────────┐ │
                                  │   GoalSession         │ │  Agent (DO, SQLite)
                                  │   name = goal-${id}   │ │  per-goal state machine
                                  └──┬─────┬─────┬─────┬──┘ │
                                     │     │     │     │    │
                ┌────────────────────┘     │     │     └──────────────────────────┐
                ▼                          ▼     ▼                                ▼
   ┌─────────────────────┐   ┌──────────────────┐   ┌───────────────────┐   ┌──────────────────┐
   │   TopicScout         │   │ ParametersForger │   │ CombinatorWorkflow│   │ EvaluatorCouncil │
   │ (callable on Goal)   │   │ (callable on Goal)│   │ WorkflowEntrypoint│   │ Queue + Workers  │
   │ goal → topic specs   │   │ goal → 2+ rubrics │   │ Stage 3–8 loop    │   │ N heterogeneous  │
   └────────┬─────────────┘   └────────┬─────────┘   │ idempotent steps  │   │ LLM judges, vote │
            │                          │             └────────┬──────────┘   └────┬─────────────┘
            │ topic specs              │ rubrics              │                   │
            ▼                          │                      │ retrieve / merge  │
   ┌─────────────────────┐             │                      │ score / writeback │
   │ HERD_QUEUE          │             │                      │                   │
   │ (Cloudflare Queues) │             │                      ▼                   │
   └────────┬────────────┘             │            ┌─────────────────────┐       │
            │ one msg per topic        │            │ Concept Graph        │◄──────┘
            ▼                          │            │ (Neo4j Aura, ext.)   │
   ┌─────────────────────┐             │            │ + Vectorize mirror   │
   │  ConceptHerder       │             │            └─────────▲────────────┘
   │  Agent (DO, SQLite)  │             │                      │
   │  name = topic-${id}  │             │                      │ upsert
   │  Browser Run / pup-  │             │                      │
   │  peteer for fetch    │             │                      │
   └────────┬─────────────┘             │            ┌─────────┴────────────┐
            │ raw artifact ref          │            │  ConceptForge         │
            ▼                          │            │  Worker (Queue cons.) │
   ┌─────────────────────┐             │            │  enrich → wiki →      │
   │ R2: raw/<topic>/...  │            │            │  concepts → embed     │
   └────────┬────────────┘             │            └────────▲─────────────┘
            │ object-put event         │                     │
            ▼                          │                     │ ENRICH_QUEUE
   ┌─────────────────────┐             │                     │
   │ ENRICH_QUEUE         │────────────┴────────────────────┘
   └─────────────────────┘   (background herding from EditorialCron lands here too)
```

### 1.3 Two pipelines, one data substrate

The original plan describes two activities that share infrastructure but have different SLAs and ownership. **A clean architecture treats them as separate pipelines that converge on the same persistent stores.**

| Pipeline | Trigger | SLA | Output |
|---|---|---|---|
| **A. Knowledge-base growth** (background) | Cron, hooks, manual | Hours–days; no user waiting | New concepts in graph; wiki articles in `kb/wiki/`; embeddings in Vectorize |
| **B. Goal-driven ideation** (interactive) | User asks Ideator for ideas | Minutes; user is waiting | Ranked structured blends with provenance |

Pipeline B will *opportunistically* invoke Pipeline A when its retrieval layer has insufficient coverage on a topic — but the agents that do the work are the **same** ConceptHerder + ConceptForge components. Splitting them logically while sharing the implementation is the central architectural choice. (Improvement #1 over the original plan.)

### 1.4 Out of scope for this document

- ML model details for the predictor learned in Stage 5 (covered when Phase 4 begins).
- Specific UI design beyond "useAgentChat over WebSocket" (covered in `cf-agent-realtime-and-frontend`).
- The Knowledge Base content rules (`kb/SCHEMA.md` already covers them).

---

## 2. Guiding principles

These are the non-negotiables. Every design choice below is downstream of them.

1. **Stella Principle** — deterministic work runs in scripts/Workers, not LLMs. LLMs perform judgment only (extraction, blending, evaluation). Concretely: file I/O, embedding lookups, JSON parsing, ranking math, dedup, retries, fan-out — all code. Synthesis, scoring, blending — LLM.
2. **Provenance is mandatory.** Every output concept can be traced through `Combination` nodes to its input `Concept` ids and ultimately to a `raw/` artifact and a wiki article. No untraceable ideas leave the system.
3. **One source of truth per concept.** A concept that appears in five papers is one `Concept` node, with five `Source` records. Enforced at ConceptForge by content-hash dedup and fuzzy name match before insert.
4. **Every LLM call has a budget** — token cap, cost ceiling, max retries — and a structured output schema (Zod on TS side, Pydantic on Python side).
5. **Idempotency by deterministic IDs.** `Combination.id = hash(goal_id ‖ sorted(input_ids) ‖ method)`. Re-running a goal does not duplicate work.
6. **Cloudflare primitives only on the runtime side.** No external orchestrators (Airflow, Temporal). Cloudflare Workflows + Queues + DO schedules are the orchestration substrate. (See `CLAUDE.md` — runtime decision is Cloudflare Agents SDK; not Anthropic Agent SDK in this repo.)
7. **AI Gateway in front of every LLM call.** Caching, fallback, rate limit, observability. Non-negotiable from the CF skill suite.
8. **Secrets never broadcast.** `this.sql` for tokens; `setState` only for UI-visible state. (CF non-negotiable #1.)
9. **SQLite-backed DOs from day one.** `new_sqlite_classes`. Irreversible if you start with KV-backed; never start KV-backed. (CF non-negotiable #3.)

---

## 3. Improvements over the original plan

This document accepts the original plan's structural choices (graph DB schema, parameter system, eight-stage workflow). It diverges from the original plan in **eleven** specific places. Each delta is called out so the product/engineering team can challenge it explicitly during review.

| # | Original plan said | This document says | Why |
|---|---|---|---|
| **D1** | Two herding flows ("background cron" and "topic-driven for a goal") implemented by the same agent | One agent class, two **invocation paths** that converge on `HERD_QUEUE` | Decouples discovery (who asks) from execution (who fetches). Lets us cap herder concurrency and dedupe at one chokepoint. |
| **D2** | Indexing agent triggered "as soon as it gets new concepts" | Indexing is a **stateless Queue consumer Worker** (`ConceptForge`), not an agent | Indexing has no per-instance state, no UI, no scheduling. Making it an agent is mis-classification; it would burn a DO per paper. Stella Principle. |
| **D3** | Topic Agent calls "3 herders" for 3 topics | Topic Agent emits N topic specs onto `HERD_QUEUE`; the queue's concurrency/DLQ semantics handle fan-out | Backpressure, retry, and observability come for free. Decoupling means topic count can vary without changing the herder. |
| **D4** | "1, 2, 3 hop distance" between concepts | **Phase 3a** uses **vector-distance buckets** (near/medium/far cosine bands) until enough kept Combinations exist to make graph hops meaningful (~1k merges); **Phase 3b** introduces hop-distance retrieval | The graph starts empty. Hop distance is undefined on a sparse graph. Vector distance is a clean retrieval-side proxy for Mednick's "remote associates". |
| **D5** | Parameters Agent produces "≥2 groups of parameters" with no contract | A **rubric set** is N≥2 rubrics designed to be **orthogonal by category mix** — one rubric weights `constraint`+`cost` heavily, another `behavior`+`maturity`, another `surprise`+`emergent`. Each rubric runs the full Stages 3–7 loop independently | "Diversification" is only meaningful if the rubrics select different tuples. Orthogonal category weighting forces this; "2 groups, vibes-based" does not. |
| **D6** | Council "evaluates each of the top 3 ideas of each group" | Each judge is **independent** (no judge sees other scores), aggregation is **median + dispersion**, quorum is configurable, and the loop has a **hard budget cap** (max additional retrieve+merge rounds = 3) | Independence is the entire point of an LLM jury. Without it, you get correlated noise. Budget caps prevent runaway recursion when nothing passes. |
| **D7** | Combinatory loop runs "dozens, hundreds, or thousands of times" | The loop runs as a **`WorkflowEntrypoint`** with one `step.do` per merge, idempotent on `(goal_id, tuple_hash, method)`, with `step.sleep` between batches to respect AI Gateway budgets | Workflows survive deploys, retry per step, and have automatic durable execution. Sub-agents do not, and an `Agent`'s `schedule()` cannot reliably cap thousands of iterations. |
| **D8** | Graph DB is Neo4j or Memgraph | **Neo4j Aura (managed)** + **Vectorize as the embedding mirror** for fast KNN inside Workers; Workers call Aura via authenticated HTTP (Bolt-over-HTTPS or REST), with **Hyperdrive for connection pooling**. Lineage and analytics queries run on Aura; vector retrieval runs on Vectorize | Workers cannot hold long-lived TCP connections to a self-hosted graph DB economically. Aura's HTTP API + Vectorize's CF-native KNN gives us both worlds. Avoids splitting embedding storage across two systems. |
| **D9** | Provider plurality in council is implicit | **Explicit roster**: DeepSeek (configured as default per `~/.claude/projects/-home-athena-ai-ideator/memory/`), Anthropic Claude, OpenAI GPT, optionally Google Gemini — all routed through one AI Gateway namespace. The roster is configuration, not code | Different providers have different failure correlations; that is the council's value. AIG fallback chains protect against single-vendor outages. |
| **D10** | "Concepts" in herding/indexing == "Concepts" in graph | Two-tier model: **WikiArticle** (citation, in `kb/wiki/`, conforms to `kb/SCHEMA.md`) ≠ **Concept** (atomic graph node, extracted from one or more wiki articles). One wiki article can yield many concepts; one concept can be supported by many articles | Already implied by `docs/CONCEPT.md` and `docs/ROADMAP.md` Phase 1, but never made explicit in the original ideation plan. Without this distinction, the graph collides citations and atoms and provenance breaks. |
| **D11** | Provenance only mentioned in passing | A `correlation_id == goal_id` is propagated through every span (DO RPC, Queue message, Workflow step, AIG log, Vectorize query). Final user-facing answer renders the lineage from this | Multi-agent systems are unobservable without correlation IDs. This is a hard requirement, not a nice-to-have. |
| **D12** | Paper-level enrichment metadata is loosely connected to concepts | Three explicit flows: **(a)** seed-parameter inheritance at extraction time (paper tier, research_type, retrieval date → Concept's Provenance + Maturity category parameters); **(b)** an explicit `CITED_FROM` edge from Concept → WikiArticle carrying tier, relevance score, role, passage anchor; **(c)** a derived `source_quality_score` on the Concept that plugs into the Stage 5 prediction function as a confidence multiplier | Without this, a fresh concept has zero priors and the predictor has nothing to weight on before merge feedback accumulates. Conflating "trustworthiness of the underlying claim" (inherited) with "merge performance" (learned) collapses two different signals; the predictor needs both. See §8.5 for the schema and §5.4 for the extraction flow. |

---

## 4. Logical agent roster

The system has **five agents** (DO-backed) and **three workers** (stateless / pipeline). Agents are the things with persistent identity and state; workers are the things that process messages and exit.

### 4.1 Agents

| Agent | Class | Naming key | Persists | Triggered by |
|---|---|---|---|---|
| **IdeatorAgent** | `AIChatAgent` (from `@cloudflare/ai-chat`) | `user-${userId}` | chat transcript, user preferences, list of past goals | user message over WS, external agent over RPC |
| **GoalSession** | `Agent` | `goal-${goalId}` | goal state machine, rubric set, candidate pool, top-K, council verdicts | spawned by IdeatorAgent on a new ideation request |
| **ConceptHerder** | `Agent` | `topic-${topicSlug}` (slug = normalized lowercase, e.g. `monsters-folklore`) | open browsing session, anti-dedup bloom filter for this topic, last fetched cursor | message on `HERD_QUEUE` (from EditorialCron, IdeatorAgent, or TopicScout) |
| **TopicScout** | `@callable()` on `GoalSession` (no separate DO) | n/a | nothing persistent | goal start |
| **ParametersForger** | `@callable()` on `GoalSession` (no separate DO) | n/a | rubric set written into GoalSession state | goal start, after TopicScout completes |

> **Why TopicScout / ParametersForger are not their own DOs.** Each is one LLM call with a Zod-validated output. Spawning a Durable Object for a single judgment call wastes the DO's storage and lifecycle features and makes tracing harder. They are exposed as **callable methods on `GoalSession`** to give them a clear surface and isolation in tests. The original plan called them "agents" — the architectural counter is that this is a *role*, not a *runtime object*. (Improvement D2 applied at smaller scale.)

### 4.2 Workers (stateless / pipeline)

| Worker | Type | Trigger | Output |
|---|---|---|---|
| **ConceptForge** | Queue consumer Worker | `ENRICH_QUEUE` (one message per raw artifact) | Wiki article in `kb/wiki/`, Concept rows in graph, embeddings in Vectorize |
| **EvaluatorCouncil** | Queue consumer Worker (one consumer per provider, fan-out) | `EVAL_QUEUE` (one message per (idea, judge) pair) | Score row written to `EVAL_RESULTS` table; aggregator step in CombinatorWorkflow reads quorum |
| **EditorialCron** | Cron-triggered Worker | Cloudflare cron schedule (`0 */6 * * *` e.g.) | Topic specs onto `HERD_QUEUE` based on KB coverage gaps |

### 4.3 Workflow

| Workflow | Class | Trigger | Steps |
|---|---|---|---|
| **CombinatorWorkflow** | `WorkflowEntrypoint` | `step.do` invoked from `GoalSession` after rubrics resolved | Stages 3–8 of the original eight-stage spec, each as one or more `step.do` blocks; `step.sleep` between batches to respect AIG rate limits |

---

## 5. Cloudflare-primitive mapping (six-decision spec per agent)

This is the per-agent fill of the six decisions enforced by `cf-agent-architect`. **No code goes in until this table is signed off** (CF skill discipline).

### 5.1 IdeatorAgent

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Base class | `AIChatAgent` from `@cloudflare/ai-chat` | Browser chat UI; native `useAgentChat` bridge; persisted transcript; not the deprecated `agents/ai-chat-agent` shim |
| 2 | Naming | `user-${session.userId}` | Per-user isolation; one Ideator per user; chat history private |
| 3 | Transport | WebSocket primary + HTTP `onRequest` for webhooks/external-agent calls | Hibernates while idle (cost); external agent integrations come over HTTP |
| 4 | State model | `setState` for UI status (`status: 'thinking' \| 'idle'`); `this.sql` for OAuth tokens, list of past `goal_id`s, user preferences | Tokens must NOT broadcast to all sockets |
| 5 | Time + persistence | `this.schedule()` for transcript-cleanup reminders; spawns `CombinatorWorkflow` for actual ideation | The Ideator is the front door, not the workhorse |
| 6 | Topology | Spawns `GoalSession` (sub-agent), `ConceptHerder` (sub-agent indirectly via Queue), and `CombinatorWorkflow` | One DO per concern; goal lifecycle distinct from chat lifecycle |

### 5.2 GoalSession

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Base class | `Agent` | No chat surface — it's an orchestrator with state; UI status via parent Ideator broadcast |
| 2 | Naming | `goal-${goalId}` (server-generated UUIDv7) | One DO per active ideation; never reuse a goal id |
| 3 | Transport | RPC (server-to-server only); no WS | The Ideator owns the user-facing socket; GoalSession is not directly addressable from clients |
| 4 | State model | `setState` for `{phase: 'topic-scouting' \| 'rubric' \| 'retrieve' \| 'merging' \| 'eval' \| 'done', progress: 0..1}` (read by Ideator and forwarded to UI); `this.sql` for rubric set, retrieved candidate ids, top-K, council scores | Phase + progress is UI-visible; rubric and intermediate scoring is not (and may be large) |
| 5 | Time + persistence | `this.schedule()` for stalled-goal timeouts; `this.runWorkflow('CombinatorWorkflow', {...})` to launch the loop | Workflow does the durable multi-step work |
| 6 | Topology | Sub-agent of Ideator; itself parent to `CombinatorWorkflow` and (indirectly) `ConceptHerder` | "Compose, don't substitute" pattern from cf-agent-architect §1 |

### 5.3 ConceptHerder

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Base class | `Agent` | Browsing session has per-topic state (cookies, last cursor, bloom filter of seen URLs); Queue consumer alone can't hold this |
| 2 | Naming | `topic-${topicSlug}` (e.g. `topic-night-vision`, `topic-monsters-folklore`) | Multiple goals targeting the same topic share one herder → debounce duplicate fetches; bloom filter is reused |
| 3 | Transport | RPC + HTTP webhooks (e.g., to receive callbacks from long-running scrape jobs) | Not user-facing |
| 4 | State model | `this.sql` for fetched-URL bloom filter, last cursor per source (arxiv, semantic-scholar, news, etc.); `setState` for `{currentlyFetching: bool, lastError?: string}` for ops dashboards | Source tokens (e.g., S2 API key) live in `env.*` secrets, NOT state |
| 5 | Time + persistence | `this.schedule({minutes: 5})` for retry-on-source-failure backoff; long fetch jobs run inside the DO body; very long PDF processing is offloaded to ConceptForge via Queue | Browser fetches are short. Indexing (LLM-heavy) is the right place for Workflows or Queue. |
| 6 | Topology | Sibling of GoalSession; both are sub-agents of Ideator's worker entry | Neither is a child of the other — they are independently addressable by their key |

**Browser tooling.** Use `@cloudflare/puppeteer` (Cloudflare Browser Run) for any dynamically-rendered source. For arxiv/IACR/semantic-scholar (static + APIs), use plain `fetch()` — Stella Principle says don't run a browser when an API exists. Concrete table:

| Source | Primary | Fallback |
|---|---|---|
| arXiv | `export.arxiv.org/api/query` (already in `cybersec-papers/fetch.py` pattern) | Browser Run on abs page |
| Semantic Scholar | Graph API | — |
| IACR ePrint | HTML listing via fetch | — |
| News / blogs | Browser Run | RSS where available |
| Generic PDF | Direct fetch + `pdfjs` in a Worker | Browser Run print-to-PDF |

### 5.4 ConceptForge (worker, not agent)

| Trait | Choice | Rationale |
|---|---|---|
| Type | Queue consumer Worker | Stateless per message; idempotent via content-hash key |
| Triggered by | `ENRICH_QUEUE` (R2 object-put events also publish here) | One message per raw artifact |
| LLM provider | DeepSeek primary via AI Gateway, with fallback chain to Claude Haiku | Per project memory; AIG enforces budget |
| Steps | 1) hash artifact; check `processed_artifacts` table; bail if seen. 2) parse (PDF→markdown / HTML→markdown). 3) one LLM call with structured output (Pydantic-mirroring Zod schema) → enrichment record (`tier`, `domain`, `tags`, `categories`, `classification.research_type`, `classification.contribution_type`, `key_thesis`, `key_concepts`, `relevance_score`). 4) write `kb/wiki/<domain>/<slug>.md` matching `kb/SCHEMA.md`; persist a `WikiArticle` graph node with the enrichment fields as properties. 5) extract Concept atoms (one LLM call producing `Concept[]`, each with `name`, `description`, and the **inherited seed parameters** derived from step 3's enrichment record per the §8.5 mapping table — Provenance.confidence from tier, Maturity.evidence + readiness_level from research_type/contribution_type, etc.). 6) embed Concept names+definitions via Workers AI `@cf/baai/bge-m3` (1024-dim, matches the graph spec). 7) upsert Concept nodes to Aura, embeddings to Vectorize, and **one `CITED_FROM` edge per (Concept, WikiArticle) pair** carrying tier/relevance_score/role/passage_anchor (§8.5). 8) recompute the affected concepts' `source_quality_score`, `citation_count`, `citation_diversity` (deterministic Cypher; no LLM). | Steps 1–2 and 4–8 are deterministic; only steps 3 and 5 invoke an LLM. Stella-clean. The seed parameters and citation edges (D12) are produced from the **same** enrichment LLM call — no additional model hop. |
| Idempotency key | `sha256(artifact_bytes)` for raw; `sha256(wiki_article_path)` for wiki; `sha256(concept_name + concept_definition)` for concept; `(concept_id, wiki_article_id)` is the primary key on `CITED_FROM` so re-running a paper updates rather than duplicates the edge | Replaying a message is a no-op; new citations layer in cleanly |
| Failure handling | DLQ after 3 retries; DLQ messages are surfaced to a `kb/CHANGELOG.md` weekly report | A paper that won't index is a content problem, not a runtime problem — engineer-eyes-on |

### 5.5 CombinatorWorkflow

| Trait | Choice | Rationale |
|---|---|---|
| Class | `WorkflowEntrypoint` | Multi-step, durable, retries-per-step, survives deploys |
| Steps | (see §7.4) | One `step.do` per *batch* of merges to keep the workflow small; merges within a batch fan out to Queue or are inlined depending on size |
| Idempotency | Each merge is keyed `combo-{goalId}-{tupleHash}-{method}`; `step.do` name matches; replay is safe | Workflow guarantees `step.do` runs once per name |
| Concurrency | Up to 8 concurrent batches per workflow run (configurable); each batch ≤ 16 merges | AIG rate limits dictate the ceiling; 8×16=128 in flight is a safe default |
| Sleeps | `step.sleep('1s')` between batches when AIG returns 429 (read from response header by the wrapper) | Backpressure |
| Sub-agent rule | Workflow can NOT call `this.schedule()` (sub-agent caveat); does not need to — workflow has its own `step.sleep` | cf-agent-workflows-and-scheduling §1 |

### 5.6 EvaluatorCouncil (worker, not agent)

| Trait | Choice | Rationale |
|---|---|---|
| Type | Queue consumer Worker, **one consumer config per provider** (i.e. four bindings sharing the same code path differing only in env binding) | Provider isolation: a DeepSeek outage does not stop Claude evaluations |
| Trigger | `EVAL_QUEUE` (one message = `{ideaId, judgeId, rubricGroup, ideaPayload, rubric}`) | Fan-out via the queue, not via parallel calls |
| Output | Row in `eval_results` (D1) keyed `(ideaId, judgeId, rubricGroup)`; `runId` from CombinatorWorkflow propagated for correlation | Aggregator (a `step.do` in CombinatorWorkflow) reads the table after `await Promise.all(steps)` resolves |
| Provider plurality | DeepSeek + Claude + GPT + Gemini (Phase 4); the panel size and providers are config | D9 |
| Quorum + aggregation | Median of N scores per rubric parameter; flag dispersion (stdev>0.25 → mark `high_disagreement`) for human spot-check | LLM juries are noisy; median + dispersion is the standard robust statistic |
| Failure handling | If a provider fails, retry once via AIG fallback; if still fails, the council proceeds with quorum-1 (logged as `degraded_quorum`) | Don't stall a goal because one provider is flaky |

### 5.7 EditorialCron (worker)

| Trait | Choice | Rationale |
|---|---|---|
| Type | Cron-triggered Worker (`scheduled()` handler) | One-shot per cron firing |
| Schedule | `0 */6 * * *` (every 6 hours) — adjustable | Background — not on the user's clock |
| Job | 1) Read coverage diagnostics from graph (which domains/topics have <K active concepts? which T1 articles in `kb/INDEX.md` have no Concept extraction yet?). 2) Emit topic specs to `HERD_QUEUE` for under-covered topics. 3) Write a `kb/LOG.md` entry. | Stella Principle — coverage analysis is a deterministic SQL query, not an LLM call |

---

## 6. Data plane

### 6.1 Storage map

| Concern | Store | Why |
|---|---|---|
| Raw fetched artifacts (PDFs, HTML, JSON dumps) | **R2** (`r2://ai-ideator-raw/<topic>/<yyyy-mm>/<sha256>.<ext>`) | Cheap object storage; immutable once written; object-put events drive `ENRICH_QUEUE` |
| Wiki articles (`kb/wiki/...`) | **GitHub** (the project repo) — written via authored commits from ConceptForge | Wiki articles are reviewable artifacts; they belong in source control. CF KV/R2 would hide them from review. |
| Concept embeddings | **Vectorize** (1024-dim, cosine; index name `concepts-v1`) | Native Workers KNN; sub-50ms queries inside Workflow steps |
| Graph (Concept, Combination, Goal, edges, parameters) | **Neo4j Aura** (managed, HTTPS) | Lineage and analytics queries (§1.6 of original spec) need a real graph DB |
| Intermediate per-goal state | DO SQLite (inside `GoalSession`) | Survives hibernation; private to the goal |
| Council scores | **D1** (`eval_results` table) | Relational fits well; CombinatorWorkflow reads via SQL aggregation |
| LLM call audit log | **AI Gateway logs** + Logpush to R2 | Single source of truth for cost & latency |
| Per-paper enrichment cache | **KV** keyed by content hash | Fast bail-out on duplicate ingest |
| Secrets (DeepSeek key, Aura creds, S2 key) | **Workers Secrets** (`wrangler secret put`) | Never in `setState`, never in `.dev.vars` committed |

### 6.2 Why two stores for embeddings (Vectorize) and graph (Aura)

Vectorize is fast for "give me top-100 concepts near this query embedding" but it has no edges and no Cypher. Aura has the schema from the original plan but doing vector KNN inside Aura forces all candidate retrieval through an HTTP hop with worse p99 than Vectorize.

**Resolution:** Vectorize is a denormalized projection of `Concept.embedding`. Source of truth is the Concept node in Aura. ConceptForge upserts both in a single transaction (compensating delete on Vectorize if Aura write fails). Stage 3a queries Vectorize; Stage 3b/c queries Aura. (D8.)

### 6.3 Bindings (`wrangler.jsonc` — deferred to `cf-agent-deploy-and-observe` for full canonical form)

```jsonc
{
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [
      { "name": "IDEATOR",   "class_name": "IdeatorAgent" },
      { "name": "GOAL",      "class_name": "GoalSession" },
      { "name": "HERDER",    "class_name": "ConceptHerder" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["IdeatorAgent", "GoalSession", "ConceptHerder"] }
  ],
  "queues": {
    "producers": [
      { "binding": "HERD_QUEUE",   "queue": "ai-ideator-herd" },
      { "binding": "ENRICH_QUEUE", "queue": "ai-ideator-enrich" },
      { "binding": "EVAL_QUEUE",   "queue": "ai-ideator-eval" }
    ],
    "consumers": [
      { "queue": "ai-ideator-herd",   "max_batch_size": 1, "max_concurrency": 8 },
      { "queue": "ai-ideator-enrich", "max_batch_size": 1, "max_concurrency": 16, "dead_letter_queue": "ai-ideator-enrich-dlq" },
      { "queue": "ai-ideator-eval",   "max_batch_size": 1, "max_concurrency": 32 }
    ]
  },
  "vectorize": [{ "binding": "VECTORIZE", "index_name": "concepts-v1" }],
  "d1_databases": [{ "binding": "DB", "database_name": "ai-ideator", "database_id": "..." }],
  "r2_buckets": [{ "binding": "RAW", "bucket_name": "ai-ideator-raw" }],
  "ai": { "binding": "AI" },
  "workflows": [{ "name": "CombinatorWorkflow", "binding": "COMBINATOR_WF", "class_name": "CombinatorWorkflow" }],
  "triggers": { "crons": ["0 */6 * * *"] },
  "vars": { "AIG_GATEWAY_ID": "ai-ideator" }
}
```

> The full canonical form, including DLQ wiring and Logpush, is owned by `cf-agent-deploy-and-observe` at implementation time. The above is a **shape contract** for review.

---

## 7. Control flow

### 7.1 Sequence — ideation request, happy path

```
USER         IdeatorAgent     GoalSession    HERD_QUEUE    ConceptHerder    ENRICH_QUEUE    ConceptForge    Vectorize/Aura    CombinatorWorkflow    EVAL_QUEUE    EvaluatorCouncil
 │  goal      │                │              │             │                │                │              │                  │                       │            │
 │───────────►│                │              │             │                │                │              │                  │                       │            │
 │            │ create goalId  │              │             │                │                │              │                  │                       │            │
 │            │───────────────►│ persist goal │             │                │                │              │                  │                       │            │
 │            │                │ TopicScout() │             │                │                │              │                  │                       │            │
 │            │                │──── LLM ───► AIG (cached?) │                │                │              │                  │                       │            │
 │            │                │              │ topic specs │                │                │              │                  │                       │            │
 │            │                │─────────────►│             │                │                │              │                  │                       │            │
 │            │                │              │────────────►│ fetch via API/ │                │              │                  │                       │            │
 │            │                │              │             │ Browser Run    │                │              │                  │                       │            │
 │            │                │              │             │ R2 put         │                │              │                  │                       │            │
 │            │                │              │             │ ──────────────►│ ENRICH_QUEUE   │              │                  │                       │            │
 │            │                │              │             │                │ ──────────────►│ enrich+embed │                  │                       │            │
 │            │                │              │             │                │                │ ────────────►│ upsert           │                       │            │
 │            │                │ (poll cover. │             │                │                │              │                  │                       │            │
 │            │                │  threshold)  │             │                │                │              │                  │                       │            │
 │            │                │ ParametersForger() ───── LLM ──► AIG ──► rubric set                                              │                       │            │
 │            │                │ runWorkflow('CombinatorWorkflow', {goalId, rubricSet}) ──────────────────────►│                       │            │
 │            │                │              │             │                │                │              │ Stage 3 retrieve │                       │            │
 │            │                │              │             │                │                │              │◄─────────────────│                       │            │
 │            │                │              │             │                │                │              │ Stage 4 tuples   │                       │            │
 │            │                │              │             │                │                │              │ Stage 5 predict  │                       │            │
 │            │                │              │             │                │                │              │ Stage 6 merges   │                       │            │
 │            │                │              │             │                │                │              │                  │ for each merge ──────►│            │
 │            │                │              │             │                │                │              │                  │                       │ ──────────►│ judge × N
 │            │                │              │             │                │                │              │                  │                       │            │ write D1
 │            │                │              │             │                │                │              │                  │ Stage 7 aggregate ◄───│            │
 │            │                │              │             │                │                │              │                  │ Stage 8 writeback                  │
 │            │                │ workflow done                                                                                   │                                    │
 │            │ broadcast result                                                                                                                                       │
 │◄─────────── ideas + provenance                                                                                                                                      │
```

### 7.2 Three trigger paths into HERD_QUEUE

```
[A] EditorialCron     ─►  scheduled coverage diff   ─►  topic specs
[B] User-direct call  ─►  IdeatorAgent.fetchTopic   ─►  topic specs           ──►  HERD_QUEUE  ──►  ConceptHerder
[C] Goal-driven       ─►  GoalSession ► TopicScout  ─►  topic specs
```

Whoever puts a topic spec on the queue, the message contract is identical:

```ts
type TopicSpec = {
  topicSlug: string;             // canonical lowercase slug
  topicLabel: string;             // human-readable
  parentDomain: string;           // one of the kb/SCHEMA.md domains, or 'unclassified'
  sources: ('arxiv'|'s2'|'iacr'|'web'|'rss')[];
  maxArtifacts: number;           // hard cap; the herder stops at this
  reason: 'cron-coverage-gap' | 'user-request' | 'goal-driven';
  correlationId: string;          // goal_id if goal-driven; cron-run-id if cron; user-msg-id if user
  budgetUsd: number;              // hard ceiling for AIG calls related to this topic
};
```

The herder writes one record to its `topic_runs` SQL table per spec for traceability, regardless of trigger source.

### 7.3 Backpressure and budgets

| Stage | Backpressure mechanism |
|---|---|
| HERD_QUEUE → ConceptHerder | Queue `max_concurrency: 8`. Herder respects per-source rate limits (arxiv: 1 req/s; S2: 100/min). |
| R2-put → ENRICH_QUEUE | Auto via R2 event notifications; one message per object. |
| ENRICH_QUEUE → ConceptForge | Queue `max_concurrency: 16`. AIG rate limit per provider is the ceiling. |
| Workflow merge batches | Workflow honors AIG 429 by `step.sleep`; configurable via env `AIG_BACKOFF_MS`. |
| EVAL_QUEUE → Council | Queue `max_concurrency: 32`. Per-provider AIG fallback chains. |
| Goal budget | `GoalSession` carries a `budgetUsd` field; CombinatorWorkflow checks `remaining_budget` before each batch and aborts cleanly with `partial_result: true` if exhausted. |

### 7.4 CombinatorWorkflow steps (mapping to original §3 stages)

```
Stage 1  — already done by GoalSession before workflow spawn (Goal node persisted).
Stage 2  — already done by ParametersForger (rubricSet resolved).

Workflow body:
  for each rubric R in rubricSet:
    step.do(`retrieve-${R.id}`)        — Stage 3a (Vectorize KNN) + 3b (Aura SQL on HAS_SCORE) + 3c merge
    step.do(`tuples-${R.id}`)          — Stage 4 (sample 50–200 tuples)
    step.do(`predict-${R.id}`)         — Stage 5 (linear predictor; takes top 5–20)
    for each batch B of top tuples:
      step.do(`merge-${R.id}-${B.id}`) — Stage 6 (one merge = one Combination + Concept, persisted to Aura)
      for each merge in batch:
        EVAL_QUEUE.send({ideaId, judgeId: each, rubric: R, runId})
      step.do(`aggregate-${R.id}-${B.id}`) — Stage 7 reads D1 quorum, writes actual_score back to Aura
    step.do(`writeback-${R.id}`)       — Stage 8 nudges parameter scores; appends predictor training row

  step.do('rank-and-return')           — collects top-K per rubric, builds the user-facing answer
```

Idempotency: every `step.do` name includes `goalId`, `R.id`, and `B.id`. A retry hits the same step name and the workflow runtime returns the cached output (cf-agent-workflows-and-scheduling §3).

### 7.5 The "fewer than 3 ideas pass council" loop

The original plan says: "if the goal is to get at least 3 ideas, this council must at least give good evaluation notes to at least 3, otherwise more ideas from the graph are obtained to be evaluated."

This is a recursive condition that needs a hard stop. The workflow implements:

```
attemptsLeft = 3   // configurable; D6
while top-K < requested AND attemptsLeft > 0:
  step.do(`expand-retrieve-${attempt}`)  — broaden the candidate pool (relax distance band, add sibling concepts)
  step.do(`merge-extra-${attempt}`)       — generate 8 more merges
  step.do(`eval-extra-${attempt}`)        — fan to council
  attemptsLeft--

if top-K still < requested:
  return { ideas: best-of-what-we-have, partial: true, reason: 'council_quorum_below_target' }
```

`partial: true` is rendered to the user as a soft warning; the workflow finishes successfully so the next run benefits from the predictor updates. (D6.)

---

## 8. Persistence schema (deltas from the original spec)

The original §1 graph schema and §2 parameter system are accepted in full. The deltas this document adds:

### 8.1 Concept node — added fields

```
Concept (additions)
   primary_citation_id   : string       // id of the highest-tier WikiArticle on a CITED_FROM edge;
                                        //   denormalized for fast lookup. Authoritative source is the edge set.
   citation_count        : int          // number of CITED_FROM edges; updated transactionally
   citation_diversity    : float        // (# distinct domains across cited articles) / citation_count
   source_quality_score  : float        // weighted aggregate over CITED_FROM (see §8.5);
                                        //   plugs into Stage 5 predictor (§8.6)
   correlation_ids       : string[]     // goal_ids that introduced this concept; "who paid for it"
```

> Per D10 + D12: the *path* to a wiki article and the raw artifact key are **not** scalar fields on `Concept` — they live on the `CITED_FROM` edge and on the `WikiArticle` / `RawArtifact` nodes respectively. This keeps the many-to-many relationship honest and lets new citations layer in without rewriting the concept.

### 8.2 Combination node — added fields

```
Combination (additions)
   workflow_run_id    : string      // CF Workflows run id; for log lookup
   workflow_step_name : string      // exact step.do name; replay key
   council_dispersion : float       // stdev of judge scores; flags noisy verdicts
   council_size       : int         // N judges that returned (degraded quorum visible)
   ai_gateway_log_ids : string[]    // pointers to AIG log rows for this merge's LLM calls
```

### 8.3 New auxiliary tables (D1, not Aura)

```sql
-- Council results, before aggregation
CREATE TABLE eval_results (
  idea_id        TEXT NOT NULL,
  judge_id       TEXT NOT NULL,
  rubric_id      TEXT NOT NULL,
  rubric_param   TEXT NOT NULL,
  score          REAL NOT NULL,
  confidence     REAL NOT NULL,
  notes          TEXT,
  run_id         TEXT NOT NULL,
  goal_id        TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  PRIMARY KEY (idea_id, judge_id, rubric_id, rubric_param)
);

-- Idempotency cache for ConceptForge
CREATE TABLE processed_artifacts (
  artifact_hash  TEXT PRIMARY KEY,
  wiki_path      TEXT,
  concept_ids    TEXT,    -- JSON array
  processed_at   TEXT NOT NULL,
  forge_version  TEXT NOT NULL
);

-- Predictor training set (Stage 8c)
CREATE TABLE predictor_training (
  combination_id TEXT PRIMARY KEY,
  goal_id        TEXT NOT NULL,
  features       TEXT NOT NULL,   -- JSON: tuple features used by Stage 5
  predicted      REAL NOT NULL,
  actual         REAL NOT NULL,
  prediction_err REAL NOT NULL,
  created_at     TEXT NOT NULL
);
```

### 8.4 Vectorize index spec

```
Index name: concepts-v1
Dimension:  1024
Metric:     cosine
Metadata:   { concept_id: string, status: enum, domain: string, last_updated: epoch }
```

`concept_id` is the FK to the Aura `Concept` node. The metadata fields support pre-filter on Vectorize before vector match (e.g., status=active, domain=monsters).

### 8.5 Citation model — `WikiArticle` node + `CITED_FROM` edge + seed-parameter mapping (D12)

A new node type and a new edge type formalize the link between paper-level enrichment and concept-level state.

```
WikiArticle
   id              : UUID
   path            : string          "kb/wiki/<domain>/<slug>.md"
   body_hash       : string          sha256 of article body at extraction time
   title           : string
   authors         : string[]
   year            : int             null for concept articles
   tier            : enum {T1, T2, T3}
   domain          : string          one of kb/SCHEMA.md domains
   research_type   : string          "empirical-study" | "theoretical-analysis"
                                     | "deployed-system" | "survey" | ...
   contribution    : string[]        e.g. ["algorithmic-design","theoretical-result"]
   relevance_score : float           paper-level heuristic score from enrichment
   tags            : string[]        from enrichment (free vocabulary)
   categories      : Map<string, any>
   retrieved       : timestamp
   created_at      : timestamp
   created_by      : string          "ConceptForge v0.3"
```

```
RawArtifact
   id        : UUID
   r2_key    : string                "raw/<topic>/<yyyy-mm>/<sha256>.<ext>"
   sha256    : string                content hash; primary dedup key
   mime      : string
   bytes     : int
   fetched_at: timestamp
   fetched_by: string                ConceptHerder DO name
```

**Edges:**

```
(Concept) ─[:CITED_FROM {
     tier             : enum {T1, T2, T3},   // copied from WikiArticle for fast filter
     relevance_score  : float,                // copied from WikiArticle
     year             : int,
     role             : enum {primary, supporting, contradicts},
     extracted_by     : string,               // ConceptForge version + LLM model
     extracted_at     : timestamp,
     passage_anchor   : string                // e.g. "section 4 ¶2" — citation back to source
}]──► (WikiArticle)

(WikiArticle) ─[:DERIVED_FROM]──► (RawArtifact)
```

**Primary key on `CITED_FROM`** is `(Concept.id, WikiArticle.id)` — replaying a paper updates rather than duplicates an edge. New citations to existing concepts simply add new edges.

#### Seed-parameter mapping (extraction-time inheritance)

When ConceptForge step 5 produces a Concept atom, the **same enrichment LLM call's output** populates the Concept's initial parameters per this table. These are seed values; Stage 8 feedback (§3.5 of original spec) nudges them as the concept participates in merges.

| WikiArticle field | → Concept parameter | Category | Mapping |
|---|---|---|---|
| `tier` | seed `confidence` on every parameter | Provenance | T1 → 0.9, T2 → 0.7, T3 → 0.5 |
| `research_type` | `evidence` | Maturity | empirical-study → empirical; theoretical-analysis → theoretical; survey → secondary; deployed-system → empirical |
| `research_type` + `contribution` | `readiness_level` (1–9 TRL-style) | Maturity | deployed-system → 8; empirical-study → 6; theoretical-analysis → 4; survey → 3; speculative → 2 |
| `year` + `retrieved` | `last_validated` | Provenance | ISO timestamp |
| `created_by` (ConceptForge id) | `source` | Provenance | `"llm:conceptforge:<version>"` |
| Author-stated invariants in the paper text | `hard_constraint` / `soft_constraint` entries | Constraint | Extracted in the same LLM call (structured output schema includes a `constraints[]` field) |
| Author-stated failure modes / limitations | `failure_mode`, `substitutability` | Behavior | Extracted in the same LLM call |
| `relevance_score` | retrieval-rank multiplier (NOT a concept parameter) | n/a — Stage 3a/b ranking signal | Applied at retrieval time, not stored on the concept |

> The mapping is **deterministic code**, not an LLM judgment. The enrichment LLM produces structured fields; the mapping then fills the parameter bag. Stella-clean. (When the enrichment output is ambiguous — e.g., `research_type` is a novel string — the mapping defaults to the lowest-confidence bucket and flags the concept for human review via the standard `kb/LOG.md` path.)

#### Derived aggregate: `source_quality_score`

Recomputed on every `CITED_FROM` insert/update via a deterministic Cypher query (no LLM):

```
source_quality_score(c) =
   Σ_e∈CITED_FROM(c)   tier_weight(e.tier) * role_weight(e.role) * recency_factor(e.year)
   ─────────────────────────────────────────────────────────────────────────────────────
                                   citation_count(c) + 1

   tier_weight   : T1 → 1.0   T2 → 0.7   T3 → 0.4
   role_weight   : primary → 1.0   supporting → 0.7   contradicts → -0.5
   recency_factor: max(0.5, 1.0 − (now.year − e.year) / 50)   // gentle decay over 50 years
```

The `+1` in the denominator is shrinkage — a concept with one supporting citation does not get the same score as one with five. Range is approximately `[-0.5, 1.0]`; negative values flag concepts whose citations principally contradict them (rare, but useful — e.g., debunked claims).

### 8.6 Stage 5 prediction function — `source_quality_score` multiplier

The original §3.5 prediction function had a `confidence` term inside `effective_score`. With D12, the `source_quality_score` joins it as an additional multiplier:

```
effective_score(c, p) =
       c.parameter_scores[p].value
     · c.parameter_scores[p].confidence            ← per-parameter confidence (learned)
     · f(c.source_quality_score)                   ← per-concept claim-trustworthiness (inherited)

     where f(q) = clamp(0.5 + 0.5 · q,  min=0.25, max=1.25)
```

`f` is a soft sigmoid-shaped clamp: a high-quality concept (`q≈1.0`) gets a 25% boost; a poorly-cited or contradicted concept (`q≈-0.5`) is dampened to 25% of nominal but never zeroed (so a marginally-cited concept can still surface if the predictor likes it). This keeps the predictor from pathologically over-weighting recency or tier.

The **two systems remain separable** by design (D12 rationale):

| Question the system answers | Field | Updated by |
|---|---|---|
| "How well does concept *c* perform when used in merges for goal *g*?" | `c.parameter_scores[*]` (learned per parameter, per goal class via predictor) | Stage 8 feedback loop, after each merge with known outcome |
| "How trustworthy is the underlying claim that concept *c* asserts?" | `c.source_quality_score` + `c.parameter_scores[*].confidence` (provenance/maturity seed) | At extraction (inherited from paper); recomputed when new `CITED_FROM` edges layer in |

A concept can be *highly trusted* (T1 paper, replicated, mature) but a *poor merge participant* (it produces sterile combinations) — and vice versa. Collapsing them into a single field would prevent the predictor from learning that distinction.

### 8.7 Required indexes for the citation model

```cypher
CREATE INDEX wiki_id          FOR (w:WikiArticle) ON (w.id);
CREATE INDEX wiki_path        FOR (w:WikiArticle) ON (w.path);
CREATE INDEX wiki_tier        FOR (w:WikiArticle) ON (w.tier);
CREATE INDEX raw_sha256       FOR (r:RawArtifact) ON (r.sha256);
CREATE INDEX cited_from_tier  FOR ()-[e:CITED_FROM]-() ON (e.tier);
CREATE INDEX cited_from_role  FOR ()-[e:CITED_FROM]-() ON (e.role);
CREATE INDEX concept_quality  FOR (c:Concept) ON (c.source_quality_score);
```

The `cited_from_tier` and `cited_from_role` edge indexes support the common retrieval filter "give me candidate concepts whose primary citation is T1," which the Stage 3 retriever runs every goal.

---

## 9. Provenance and evaluation rendering

What the user sees at the end is the artifact of this whole system. It MUST surface:

```
Idea: "<output concept name>"
Description: "<output concept description>"

Built from:
  • <input concept name> — from kb/wiki/<domain>/<slug>.md (T1, "<paper title>", 2024)
  • <input concept name> — from kb/wiki/<domain>/<slug>.md (T2, "<news article>", 2026)
  • <input concept name> — from kb/wiki/<domain>/<slug>.md (T1, "<book>", 1965)

Method: <method label>
Strategy: <one paragraph from the merge prompt>

Rubric used: <rubric name>
  fear_factor:         0.82  (median of 4 judges, dispersion 0.07)
  uncanniness:         0.78  (median of 4 judges, dispersion 0.12)
  isolation_resonance: 0.69  (median of 4 judges, dispersion 0.05)
  filmability:         0.91  (median of 4 judges, dispersion 0.04)

Lineage: <ancestor count> ancestor concepts; deepest path = <N> hops
  (clickable in UI; rendered server-side in CLI/API)

Run: workflow=<run_id>  goal=<goal_id>  cost=$<X>  duration=<Ys>
```

This is the **final cite-everything contract** that distinguishes this system from "ChatGPT for ideas" (per §1.4 of `docs/CONCEPT.md`).

---

## 10. Observability, cost, and SLOs

### 10.1 Correlation ID propagation

`correlation_id := goal_id` (or `cron-run-id` for KB growth flows). Propagated through:

| Hop | Mechanism |
|---|---|
| Ideator → GoalSession | RPC argument |
| GoalSession → HERD_QUEUE | TopicSpec.correlationId |
| HERD_QUEUE → ConceptHerder | message field |
| ConceptHerder → R2 | R2 object metadata `x-amz-meta-correlation-id` |
| R2 event → ENRICH_QUEUE | preserved by R2 event payload |
| ConceptForge → AIG | `cf-aig-metadata` header |
| ConceptForge → Vectorize / Aura | metadata field |
| GoalSession → CombinatorWorkflow | workflow params |
| Workflow → EVAL_QUEUE | message field |
| Council → D1 | `run_id, goal_id` columns |

A single `correlation_id` returns the full ribbon of the run from CF logs + AIG logs + D1 queries. **This is the difference between observable and unobservable.**

### 10.2 SLOs (initial targets, to be refined post-Phase 3)

| Metric | Target |
|---|---|
| Goal time-to-first-idea (warm cache, 4 rubrics, 8 merges/rubric) | p50 ≤ 60s, p95 ≤ 180s |
| Goal time-to-final (council settled) | p50 ≤ 4 min, p95 ≤ 12 min |
| ConceptForge time per artifact | p50 ≤ 30s |
| Per-goal AIG spend (cap) | $1.00 hard, $0.40 soft |
| Council provider fallback success rate | ≥ 99.5% (≥ 1 provider returns) |
| KB growth (background) | ≥ 10 new concepts / day per active topic during cron |

### 10.3 Dashboards (must exist before Phase 4 ships)

- **AIG dashboard** — per-provider latency, error rate, $/call, by `cf-aig-metadata.purpose` tag (`enrich`, `extract`, `merge`, `eval`).
- **Workflow dashboard** — runs by status, p99 step latency, retry counts.
- **Per-goal trace view** — given `goal_id`, show every span (DO call, queue msg, AIG call, workflow step) on one timeline. Built from CF Logs + AIG Logpush + D1 join.

---

## 11. Failure modes and mitigations

| Failure | Detected by | Mitigation |
|---|---|---|
| LLM provider outage | AIG error rate > 50% over 1 min | AIG fallback chain (configured per call site); council degrades to quorum-1 |
| Browser Run hung | Per-fetch timeout (60s) | DLQ to `ai-ideator-herd-dlq`; ConceptHerder marks topic as `degraded` in state |
| Concept dedup collision (false positive) | Same name + similar definition ≠ same concept | Dedup is gated on `cosine(emb_a, emb_b) > 0.92` AND `Levenshtein(name_a, name_b) ≤ 2`; conflicts log a `CONTRADICTION` block (per `kb/SCHEMA.md`) for human triage |
| Council unanimous rejection of every idea | top-K = 0 after 3 expansions | Workflow returns `partial: true, ideas: []` with an automatic post-mortem entry on `kb/LOG.md` (rubric may be unsatisfiable) |
| Vectorize / Aura write skew (one succeeds, one fails) | ConceptForge transactional wrapper detects | Compensating delete on the successful side; message returned to ENRICH_QUEUE |
| Stale parameter scores | §1.6 of original spec — periodic `confidence < 0.5 OR last_updated < now-90d` query | Background job emits `HERD_QUEUE` topic specs to refresh |
| Goal exceeds budget mid-run | CombinatorWorkflow checks `remaining_budget` before each batch | Workflow finishes cleanly with `partial: true`; user sees what completed |
| DO hibernation losing in-memory state | All durable state is in `this.sql` or `setState` | (Already prevented by design — but reviewers should sanity check that no caches in plain class fields hold goal-critical state) |

---

## 12. Security posture

| Surface | Rule |
|---|---|
| Secrets (DeepSeek, Aura, S2 API key) | `wrangler secret put`, accessed via `env.*`. **Never in `setState`** — that broadcasts to all WS clients. |
| OAuth tokens (if/when user auth is added) | `this.sql` only. Per-connection identity via `connection.serializeAttachment({userId, role})`. |
| User-authored prompts | Sanitized for control characters before forwarding to AIG; structured-output schema + `outputSchema` enforcement on all LLM calls. |
| Artifacts from the open web | All R2 puts pass through a content-type whitelist (PDF, HTML, JSON, MD); sniffed binary mismatch → reject with DLQ entry. |
| External agent calling Ideator | HMAC-signed HTTP; rate-limited per caller via Workers KV counter. |
| Council judge transcripts | Stored with the goal; not exposed to other goals (per-goal SQL isolation). |
| AIG BYO keys | Each provider key loaded as a CF secret; AIG handles routing. Rotation via `wrangler secret put` (no code change). |

---

## 13. The role of skill-bound primitives

This document is the architecture spec. Implementation is owned by the specialist skills in `.claude/skills/cf-*` per `CLAUDE.md` §"Skill activation hints":

| Sub-system | Owning skill |
|---|---|
| Agent base classes, spawning topology | `cf-agent-architect` (this skill — frame validation) |
| Sub-agent decomposition, supervisor pattern | `cf-agent-multi-agent-orchestration` |
| Tool registration, MCP server (if we expose ideation as MCP) | `cf-agent-tools-and-mcp` |
| DO state, SQL, Vectorize integration, hibernation | `cf-agent-state-and-storage` |
| `schedule()`, alarms, Workflows, Queues | `cf-agent-workflows-and-scheduling` |
| WebSocket, SSE, useAgentChat, frontend bridge | `cf-agent-realtime-and-frontend` |
| Workers AI, AI Gateway, Vectorize embeddings, model selection | `cf-agent-models-and-gateway` |
| OAuth, scopes, secret hygiene, permission posture | `cf-agent-auth-and-permissions` |
| `wrangler.jsonc` final form, migrations, CI/CD, Logpush | `cf-agent-deploy-and-observe` |
| Vitest pool, DO-level tests, golden-set evals, AIG eval flow | `cf-agent-tests-and-evals` |

Each skill produces its own implementation artifact. This document is the contract those artifacts conform to.

---

## 14. Open architectural questions (honest list)

These are unresolved as of v0.1 of this document. Each blocks an implementation decision; each gets an ADR before code ships.

1. **Authentication strategy.** External users will eventually need auth. Workers OAuth Provider (`workers-oauth-provider`) vs Cloudflare Access vs BYO IdP — undecided. Owns: `cf-agent-auth-and-permissions`.
2. **Frontend scope.** Phase 5 in the existing ROADMAP says "CLI first, then API, then maybe UI." This document assumes `useAgentChat` will exist eventually but the WS surface is also usable from a CLI shim. Defer until Phase 5.
3. **Predictor model class.** §3.5 of original spec says "linear function for v1, then learned model after ~1000 labeled merges." Where does the learned model live — Workers AI? External? D1-stored coefficients? Owns: `cf-agent-models-and-gateway`. Needs ADR.
4. **Aura cost vs self-hosted graph.** Aura's free tier is small; production cost may be material. Alternative: run Memgraph on a single VPS and hit it from Workers via HTTP. Trade-off analysis needed by Phase 3.
5. **Concept extraction granularity.** ROADMAP §"Phase 1" already flags this as the central design question. Pilot with ~200 concepts before committing. This doc defers to that pilot.
6. **Council size and provider mix.** N=4 is the proposal; could be 3 (cost) or 5 (robustness). Tied to budget and to AIG provider availability.
7. **MCP exposure.** Should the Ideator be exposed as an MCP tool (so other agents — Claude Desktop, Cursor — can ask it for ideas)? If yes, add `McpAgent` composition. Defer past Phase 5.
8. **GitHub commit posture for wiki articles.** ConceptForge will need write access to this repo. Tradeoffs: deploy bot vs. PR-based human review (slower but safer). Recommendation: PR-based for first 200 articles, then auto-merge if a quality gate (kb-lint + schema check) passes.

---

## 15. Phasing — implementation order

This extends `docs/ROADMAP.md` Phase 3 with the architectural decomposition above. Within each milestone, all `cf-*` skills run in their natural order (architect → state-and-storage → tools-and-mcp → workflows → models-and-gateway → tests-and-evals → deploy-and-observe).

### Milestone M1 — KB pipeline online (extends Phase 0/1 of ROADMAP)

- [ ] R2 bucket + ENRICH_QUEUE + ConceptForge worker
- [ ] ConceptForge produces wiki articles matching `kb/SCHEMA.md` for the existing `cybersec-papers/` corpus (sanity check — same outputs as the existing `analysis/` directory)
- [ ] Vectorize index `concepts-v1` populated
- [ ] D1 `processed_artifacts` table live
- [ ] `kb-lint` passes against ConceptForge output

### Milestone M2 — Background herding (extends Phase 0)

- [ ] ConceptHerder DO (`@cloudflare/puppeteer` for HTML, fetch for arxiv/S2/IACR)
- [ ] HERD_QUEUE wired
- [ ] EditorialCron wired (scheduled coverage gap detection)
- [ ] One end-to-end ingest from cron → R2 → ENRICH → wiki article merged via PR

### Milestone M3 — Ideator + GoalSession spine (Phase 3 starts here)

- [ ] IdeatorAgent (`AIChatAgent`) live with `useAgentChat` smoke test
- [ ] GoalSession DO with state machine; TopicScout + ParametersForger as `@callable()` methods
- [ ] Manual end-to-end: user asks for ideas; system creates Goal, scouts topics, resolves rubric, no merging yet
- [ ] All correlation-id plumbing in place

### Milestone M4 — CombinatorWorkflow online

- [ ] Aura Concept/Combination/Goal schema deployed
- [ ] CombinatorWorkflow with Stages 3–6 wired (no eval yet)
- [ ] First end-to-end run: 4 rubrics × 8 merges → 32 candidate Combinations stored in Aura

### Milestone M5 — EvaluatorCouncil + writeback

- [ ] EVAL_QUEUE + per-provider council consumers
- [ ] D1 `eval_results` aggregator step in Workflow
- [ ] Stage 7 + 8 (post-merge eval, parameter score writeback)
- [ ] First "user-visible idea" demo with full provenance render (per §9)

### Milestone M6 — Predictor v1 → v2

- [ ] Linear predictor (Stage 5) calibrated against 1k+ Combinations
- [ ] ADR for v2 predictor (open question §14.3 resolved)
- [ ] Nightly retrain job (own Worker; not in the goal-critical path)

### Milestone M7 — Production readiness

- [ ] Logpush configured; per-goal trace view dashboard
- [ ] Hard budget caps verified end-to-end
- [ ] DLQ playbook documented in `docs/runbook.md`
- [ ] Eval suite (`cf-agent-tests-and-evals`) green on golden-set goals

---

## 16. Hand-off matrix

| Section of this doc | Hand-off to | Output artifact |
|---|---|---|
| §5.1–5.3 (agent class specs) | `cf-agent-architect` (validate per agent), then `cf-agent-state-and-storage` | TS class skeletons, migrations |
| §5.4 (ConceptForge) | `cf-agent-models-and-gateway` (LLM prompts + AIG routing), `cf-agent-workflows-and-scheduling` (Queue consumer ergonomics) | Worker source + AIG config |
| §5.5 (CombinatorWorkflow) | `cf-agent-workflows-and-scheduling` | Workflow class + step contracts |
| §5.6 (EvaluatorCouncil) | `cf-agent-models-and-gateway` (provider fallback chains), `cf-agent-tests-and-evals` (judge prompt evals) | Worker source per provider |
| §6 (storage) | `cf-agent-state-and-storage` (Vectorize), `cf-agent-deploy-and-observe` (R2/D1 bindings) | Final `wrangler.jsonc`, migrations |
| §7 (control flow) | `cf-agent-workflows-and-scheduling` (workflow), `cf-agent-multi-agent-orchestration` (sub-agent topology) | Sequence verification tests |
| §10 (observability) | `cf-agent-deploy-and-observe` | Logpush + dashboards |
| §11 (failure modes) | `cf-agent-tests-and-evals` | Failure-injection tests |
| §12 (security) | `cf-agent-auth-and-permissions` | Hook recipes, secret rotation runbook |
| §14 (open questions) | One ADR each in `docs/adr/` | ADR-002 through ADR-009 |

---

## 17. Glossary

| Term | Meaning |
|---|---|
| **Concept** | Atomic graph node — one claim, object, or idea, embedding-indexed, traceable to one or more wiki articles. |
| **WikiArticle** | Markdown file under `kb/wiki/<domain>/<slug>.md` conforming to `kb/SCHEMA.md`. The citation. |
| **Combination** | A merge event — one or more input Concepts produced one or more output Concepts under a goal. The merge ledger. |
| **Goal** | A user request with a description and a rubric set. |
| **Rubric** | An ordered list of `Parameter` objects with weights — one evaluation criterion set. |
| **Rubric set** | N≥2 rubrics applied independently to diversify the candidate pool. |
| **Hop distance** | Graph distance between two Concept nodes through Combination edges. Defined only when the graph is dense enough; vector distance is the proxy until then. |
| **Topic spec** | A unit of work for ConceptHerder: which topic, which sources, what budget. |
| **Council** | Set of independent LLM judges scoring a candidate idea against a rubric; aggregated by median. |
| **Correlation ID** | The `goal_id` (or `cron-run-id`) propagated through every span for end-to-end tracing. |
| **AIG** | Cloudflare AI Gateway — the only path LLM calls take in this system. |
| **Stella Principle** | Deterministic work in code, judgment in LLMs. Per `CLAUDE.md`. |

---

## Appendix A — Comparison to the original plan, line by line

For reviewers who have read the original plan and want to pinpoint exact diffs, here is the original plan's narrative remapped to this document's sections:

| Original plan paragraph | This document |
|---|---|
| "An agent that browses the web with Playwright" | §5.3 ConceptHerder; §5.4 ConceptForge separates browsing from indexing |
| "Concepts stored in different folders by topic" | §6.1 R2 layout `r2://ai-ideator-raw/<topic>/<yyyy-mm>/...` |
| "Activated by cron jobs, user, or hooks" | §7.2 Three trigger paths into HERD_QUEUE; same message contract for all three |
| "Second agent processes them exactly the way we processed cybersec papers" | §5.4 ConceptForge mirrors the `cybersec-papers/enriched.jsonl` shape; M1 sanity-check is "produces same fields as the existing `analysis/` dir" |
| "No paper can be empty or return error, if so, retry" | §5.4 idempotency cache + DLQ + max-retries 3; §11 failure table |
| "Standardize the format of all concepts so they all follow the same json pattern" | Pydantic (Python ConceptForge) and Zod (TS) sharing a single source-of-truth schema; canonical name `Concept` per §1.1 of the original spec |
| "Create indexes so it's easier for agents to find the right papers" | Vectorize `concepts-v1` + Aura indexes from §1.5 of original spec |
| "Main agent receives request and redirects" | §5.1 IdeatorAgent + §5.2 GoalSession |
| "Topic agent comes up with all possible topics" | §5.1 TopicScout (callable on GoalSession; D2 small-scale) |
| "Ask 3 herding agents, one per topic" | §5.3 ConceptHerder, named per-topic; Topic Scout emits N spec messages, queue does the fan-out (D3) |
| "As soon as they gather concepts, this triggers the second agent" | §6.1 R2 object-put → ENRICH_QUEUE → ConceptForge — auto, decoupled (D2/D3) |
| "Parameters agent creates ≥2 groups of parameters" | §5.1 ParametersForger; §3 D5 defines what "groups" means (orthogonal category mix) |
| "Combinatory agent — one of the most important steps" | §5.5 CombinatorWorkflow; §7.4 step mapping |
| "Iteratively for dozens, hundreds, or thousands of times" | §7.4 batch loop; §7.3 budget-driven termination |
| "1, 2, 3 hops of distance between them" | §3 D4 — vector-distance bands until graph is dense, hop bands after |
| "Each combination must be stored on graph properly, all data must be stored" | §8 schema deltas; the original §1 graph spec accepted in full |
| "Council of agents, each with a different LLM provider" | §5.6 EvaluatorCouncil; §3 D9 provider roster; §3 D6 independence + median + dispersion + budget cap |
| "Considering each original parameters of evaluation, including feasibility and how good it is to reach the goal" | §3.5 of original spec retained; §9 user-facing render shows median per parameter |
| "If the goal is at least 3 ideas, this council must give good notes to at least 3, otherwise more ideas from graph" | §7.5 expansion loop with 3-attempt cap and partial-result fallback |
| "Main agent provides them to the user and provides how each idea was obtained" | §9 final provenance render contract |

> **End of architecture document v0.1.** Reviewers: comments inline as `> REVIEW(name): …` blocks; a v0.2 will incorporate them and graduate `Status: Proposed` to `Status: Accepted`.
