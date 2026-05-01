"""Sync the local property-graph artifacts into Neo4j via the Query API.

The repo already emits a deterministic graph at:

  graph/nodes.jsonl
  graph/edges.jsonl

This module pushes those artifacts into a live Neo4j instance using the
official HTTP Query API. It avoids a hard dependency on the Neo4j driver and
fits the existing Python tooling already used for KB preprocessing.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

import httpx

from ai_ideator.analyzer.graph import build_graph

_LABEL_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
_CONSTRAINT_NAME_RE = re.compile(r"[^A-Za-z0-9_]+")


class Neo4jQueryAPIError(RuntimeError):
    """Raised when the Query API returns one or more query errors."""

    def __init__(self, message: str, *, errors: Sequence[dict[str, Any]] | None = None) -> None:
        super().__init__(message)
        self.errors = list(errors or [])


@dataclass(frozen=True)
class GraphNodeRow:
    label: str
    node_id: str
    properties: dict[str, Any]


@dataclass(frozen=True)
class GraphEdgeRow:
    source_label: str
    source_id: str
    target_label: str
    target_id: str
    rel_type: str
    properties: dict[str, Any]


def _chunked(items: Sequence[Any], size: int) -> Iterable[Sequence[Any]]:
    if size <= 0:
        raise ValueError("chunk size must be > 0")
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _validate_label(label: str) -> str:
    if not _LABEL_RE.fullmatch(label):
        raise ValueError(f"invalid Neo4j label/type: {label!r}")
    return label


def _constraint_name(label: str) -> str:
    safe = _CONSTRAINT_NAME_RE.sub("_", label).strip("_").lower()
    if not safe:
        raise ValueError(f"could not derive constraint name from {label!r}")
    return f"{safe}_id_unique"


def _split_graph_ref(value: str) -> tuple[str, str]:
    label, sep, entity_id = value.partition(":")
    if not sep or not label or not entity_id:
        raise ValueError(f"invalid graph ref: {value!r}")
    return _validate_label(label), entity_id


def _coerce_property_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, bool, int, float)):
        return value
    if isinstance(value, list):
        coerced = [_coerce_property_value(item) for item in value]
        if all(item is None or isinstance(item, (str, bool, int, float)) for item in coerced):
            return [item for item in coerced if item is not None]
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _normalize_properties(properties: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key, value in properties.items():
        coerced = _coerce_property_value(value)
        if coerced is not None:
            normalized[key] = coerced
    return normalized


def _load_graph_nodes(path: Path) -> list[GraphNodeRow]:
    rows: list[GraphNodeRow] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        raw = json.loads(line)
        label = _validate_label(raw["type"])
        node_id = str(raw["id"])
        props = {k: v for k, v in raw.items() if k not in {"id", "type"}}
        rows.append(GraphNodeRow(label=label, node_id=node_id, properties=_normalize_properties(props)))
    return rows


def _load_graph_edges(path: Path) -> list[GraphEdgeRow]:
    rows: list[GraphEdgeRow] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        raw = json.loads(line)
        source_label, source_id = _split_graph_ref(raw["source"])
        target_label, target_id = _split_graph_ref(raw["target"])
        rel_type = _validate_label(raw["type"])
        props = {k: v for k, v in raw.items() if k not in {"source", "target", "type"}}
        rows.append(
            GraphEdgeRow(
                source_label=source_label,
                source_id=source_id,
                target_label=target_label,
                target_id=target_id,
                rel_type=rel_type,
                properties=_normalize_properties(props),
            )
        )
    return rows


class Neo4jQueryAPIClient:
    """Thin client for Neo4j's HTTP Query API."""

    def __init__(
        self,
        *,
        base_url: str,
        username: str,
        password: str,
        database: str = "neo4j",
        timeout: float = 30.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.database = database
        self._client = httpx.Client(
            base_url=self.base_url,
            auth=(username, password),
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "Neo4jQueryAPIClient":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def run_query(
        self,
        statement: str,
        *,
        parameters: dict[str, Any] | None = None,
        include_counters: bool = False,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"statement": statement}
        if parameters:
            payload["parameters"] = parameters
        if include_counters:
            payload["includeCounters"] = True

        response = self._client.post(f"/db/{self.database}/query/v2", json=payload)
        response.raise_for_status()
        body = response.json()
        errors = body.get("errors") or []
        if errors:
            summary = "; ".join(
                f"{err.get('code', 'UNKNOWN')}: {err.get('message', '').strip()}" for err in errors
            )
            raise Neo4jQueryAPIError(summary or "Neo4j query failed", errors=errors)
        return body


def _ensure_node_constraints(client: Neo4jQueryAPIClient, labels: Iterable[str]) -> int:
    count = 0
    for label in sorted(set(labels)):
        query = (
            f"CREATE CONSTRAINT {_constraint_name(label)} IF NOT EXISTS "
            f"FOR (n:{label}) REQUIRE n.id IS UNIQUE"
        )
        client.run_query(query, include_counters=True)
        count += 1
    return count


def _upsert_nodes(client: Neo4jQueryAPIClient, rows: Sequence[GraphNodeRow]) -> dict[str, int]:
    body = client.run_query(
        "UNWIND $rows AS row MERGE (n:$(row.label) {id: row.id}) SET n += row.properties",
        parameters={
            "rows": [
                {
                    "label": row.label,
                    "id": row.node_id,
                    "properties": row.properties,
                }
                for row in rows
            ]
        },
        include_counters=True,
    )
    counters = body.get("counters") or {}
    return {
        "nodes_created": int(counters.get("nodesCreated", 0)),
        "properties_set": int(counters.get("propertiesSet", 0)),
        "labels_added": int(counters.get("labelsAdded", 0)),
    }


def _upsert_edges(client: Neo4jQueryAPIClient, rows: Sequence[GraphEdgeRow]) -> dict[str, int]:
    body = client.run_query(
        (
            "UNWIND $rows AS row "
            "MATCH (src:$(row.source_label) {id: row.source_id}) "
            "MATCH (dst:$(row.target_label) {id: row.target_id}) "
            "MERGE (src)-[r:$(row.rel_type)]->(dst) "
            "SET r += row.properties"
        ),
        parameters={
            "rows": [
                {
                    "source_label": row.source_label,
                    "source_id": row.source_id,
                    "target_label": row.target_label,
                    "target_id": row.target_id,
                    "rel_type": row.rel_type,
                    "properties": row.properties,
                }
                for row in rows
            ]
        },
        include_counters=True,
    )
    counters = body.get("counters") or {}
    return {
        "relationships_created": int(counters.get("relationshipsCreated", 0)),
        "properties_set": int(counters.get("propertiesSet", 0)),
    }


def sync_graph_to_neo4j(
    date_dir: Path,
    *,
    client: Neo4jQueryAPIClient,
    batch_size: int = 250,
    ensure_constraints: bool = True,
    rebuild_if_missing: bool = True,
) -> dict[str, Any]:
    """Push graph JSONL artifacts into Neo4j and return sync stats."""
    graph_dir = date_dir / "graph"
    nodes_path = graph_dir / "nodes.jsonl"
    edges_path = graph_dir / "edges.jsonl"

    if rebuild_if_missing and (not nodes_path.exists() or not edges_path.exists()):
        build_graph(date_dir)

    if not nodes_path.exists() or not edges_path.exists():
        raise FileNotFoundError(
            f"graph artifacts missing under {graph_dir}; run build_graph first"
        )

    node_rows = _load_graph_nodes(nodes_path)
    edge_rows = _load_graph_edges(edges_path)

    constraints_created = 0
    if ensure_constraints:
        constraints_created = _ensure_node_constraints(client, (row.label for row in node_rows))

    node_counters = {"nodes_created": 0, "properties_set": 0, "labels_added": 0}
    for batch in _chunked(node_rows, batch_size):
        stats = _upsert_nodes(client, batch)
        for key, value in stats.items():
            node_counters[key] += value

    edge_counters = {"relationships_created": 0, "properties_set": 0}
    for batch in _chunked(edge_rows, batch_size):
        stats = _upsert_edges(client, batch)
        for key, value in stats.items():
            edge_counters[key] += value

    return {
        "database": client.database,
        "constraints_ensured": constraints_created,
        "node_rows": len(node_rows),
        "edge_rows": len(edge_rows),
        **node_counters,
        "relationship_properties_set": edge_counters["properties_set"],
        "relationships_created": edge_counters["relationships_created"],
    }
