"""Sync the local graph artifacts into Neo4j via the HTTP Query API."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from ai_ideator.analyzer.neo4j_sync import Neo4jQueryAPIClient, sync_graph_to_neo4j  # noqa: E402


def _default_date_dir() -> Path:
    return ROOT / "cybersec-papers" / "2026-04-17_to_2026-04-30"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--date-dir",
        type=Path,
        default=_default_date_dir(),
        help="Folder containing enriched.jsonl and graph/*.jsonl",
    )
    parser.add_argument(
        "--neo4j-url",
        default=os.environ.get("NEO4J_URL", "http://localhost:7474"),
        help="Neo4j base URL, e.g. http://localhost:7474 or https://db.example.com:7473",
    )
    parser.add_argument(
        "--neo4j-username",
        default=os.environ.get("NEO4J_USERNAME", "neo4j"),
        help="Neo4j username",
    )
    parser.add_argument(
        "--neo4j-password",
        default=os.environ.get("NEO4J_PASSWORD"),
        help="Neo4j password",
    )
    parser.add_argument(
        "--neo4j-database",
        default=os.environ.get("NEO4J_DATABASE", "neo4j"),
        help="Target Neo4j database name",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=250,
        help="Rows per upsert batch",
    )
    parser.add_argument(
        "--skip-constraints",
        action="store_true",
        help="Do not create/ensure per-label unique id constraints",
    )
    parser.add_argument(
        "--no-rebuild",
        action="store_true",
        help="Do not auto-run build_graph when graph artifacts are missing",
    )
    return parser


def main() -> None:
    args = _parser().parse_args()
    if not args.neo4j_password:
        raise SystemExit("missing Neo4j password: pass --neo4j-password or set NEO4J_PASSWORD")

    with Neo4jQueryAPIClient(
        base_url=args.neo4j_url,
        username=args.neo4j_username,
        password=args.neo4j_password,
        database=args.neo4j_database,
    ) as client:
        stats = sync_graph_to_neo4j(
            args.date_dir,
            client=client,
            batch_size=args.batch_size,
            ensure_constraints=not args.skip_constraints,
            rebuild_if_missing=not args.no_rebuild,
        )
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
