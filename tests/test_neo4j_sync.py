from __future__ import annotations

import json

import pytest

from ai_ideator.analyzer.neo4j_sync import (
    _constraint_name,
    _load_graph_edges,
    _load_graph_nodes,
    _split_graph_ref,
)


def test_split_graph_ref_keeps_embedded_colons() -> None:
    assert _split_graph_ref("Paper:arxiv:1234.5678") == ("Paper", "arxiv:1234.5678")


def test_constraint_name_is_stable() -> None:
    assert _constraint_name("NoveltyClaim") == "noveltyclaim_id_unique"


def test_load_graph_nodes_normalizes_properties(tmp_path) -> None:
    path = tmp_path / "nodes.jsonl"
    path.write_text(
        json.dumps(
            {
                "id": "arxiv:1",
                "type": "Paper",
                "title": "Example",
                "published": None,
                "tags": ["a", "b"],
                "payload": {"nested": True},
            }
        )
        + "\n",
        encoding="utf-8",
    )

    rows = _load_graph_nodes(path)
    assert len(rows) == 1
    assert rows[0].label == "Paper"
    assert rows[0].node_id == "arxiv:1"
    assert rows[0].properties == {
        "title": "Example",
        "tags": ["a", "b"],
        "payload": '{"nested": true}',
    }


def test_load_graph_edges_parses_source_target_and_properties(tmp_path) -> None:
    path = tmp_path / "edges.jsonl"
    path.write_text(
        json.dumps(
            {
                "source": "Paper:arxiv:1",
                "target": "Tag:test-tag",
                "type": "TAGGED_AS",
                "weight": 2,
                "dims": ["x", "y"],
            }
        )
        + "\n",
        encoding="utf-8",
    )

    rows = _load_graph_edges(path)
    assert len(rows) == 1
    assert rows[0].source_label == "Paper"
    assert rows[0].source_id == "arxiv:1"
    assert rows[0].target_label == "Tag"
    assert rows[0].target_id == "test-tag"
    assert rows[0].rel_type == "TAGGED_AS"
    assert rows[0].properties == {"weight": 2, "dims": ["x", "y"]}


def test_invalid_label_is_rejected(tmp_path) -> None:
    path = tmp_path / "nodes.jsonl"
    path.write_text(
        json.dumps({"id": "1", "type": "not-valid-label", "name": "x"}) + "\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError):
        _load_graph_nodes(path)
