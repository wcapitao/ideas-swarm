# Neo4j Graph Sync

This repo already produces a deterministic property graph from analyzed papers:

- `graph/nodes.jsonl`
- `graph/edges.jsonl`
- `graph/graph.graphml`

The Neo4j sync layer pushes those JSONL artifacts into a live Neo4j database so
the graph can be queried with Cypher instead of only inspected as files.

## What was added

- `src/ai_ideator/analyzer/neo4j_sync.py`
  - Query API client
  - graph artifact loaders
  - batched node and relationship upserts
  - per-label `id` uniqueness constraints
- `scripts/sync_graph_to_neo4j.py`
  - CLI entrypoint for syncing a date folder into Neo4j
- `tests/test_neo4j_sync.py`
  - parsing and normalization tests for the sync layer

## Design

The implementation uses Neo4j's HTTP Query API rather than the Bolt driver.
That fits the existing Python tooling and avoids introducing a separate runtime
path just to import graph artifacts.

The sync flow is:

1. Read `graph/nodes.jsonl` and `graph/edges.jsonl`.
2. Rebuild them first with `build_graph()` if they are missing.
3. Ensure a unique `id` constraint for each node label seen in the export.
4. `UNWIND` batches of node rows and `MERGE` them by `{id}`.
5. `UNWIND` batches of edge rows and `MERGE` relationships between matched endpoints.
6. Return sync counters as JSON.

## Cypher shape

Nodes are written as:

```cypher
UNWIND $rows AS row
MERGE (n:$(row.label) {id: row.id})
SET n += row.properties
```

Relationships are written as:

```cypher
UNWIND $rows AS row
MATCH (src:$(row.source_label) {id: row.source_id})
MATCH (dst:$(row.target_label) {id: row.target_id})
MERGE (src)-[r:$(row.rel_type)]->(dst)
SET r += row.properties
```

Dynamic labels and relationship types are validated before they are used, so the
import stays generic without concatenating unchecked values into Cypher.

## Configuration

Environment variables:

- `NEO4J_URL`
- `NEO4J_USERNAME`
- `NEO4J_PASSWORD`
- `NEO4J_DATABASE`

Defaults:

- URL: `http://localhost:7474`
- username: `neo4j`
- database: `neo4j`

## Usage

```bash
python scripts/sync_graph_to_neo4j.py \
  --date-dir ./cybersec-papers/2026-04-17_to_2026-04-30 \
  --neo4j-url http://localhost:7474 \
  --neo4j-username neo4j \
  --neo4j-password '...'
```

Optional flags:

- `--batch-size <n>`
- `--skip-constraints`
- `--no-rebuild`

## Operational notes

- The Query API returns `202` even for many query failures, so the client checks
  the response body for `errors` and raises on them.
- Self-hosted Neo4j versions earlier than `5.25` may require Query API
  enablement in server config.
- Constraint creation is idempotent via `IF NOT EXISTS`.
- Complex property values that do not map cleanly to Neo4j property types are
  JSON-encoded before upload.

## Scope

This sync layer imports the current analysis graph export. It does **not**
implement the full ARCH-001 application graph yet:

- no `WikiArticle` / `Concept` extraction pipeline
- no `CITED_FROM` / `DERIVED_FROM` write path
- no Vectorize coordination
- no Worker-side Neo4j integration

It is an import bridge from the current Python graph artifacts to a real graph
database.
