"""Print a human-readable report from indexes + graph metrics.

Use after build_indexes + build_graph have run.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATE_DIR = ROOT / "cybersec-papers" / "2026-04-17_to_2026-04-30"


def _load(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def main() -> None:
    stats = _load(DATE_DIR / "stats.json")
    dim_summary = _load(DATE_DIR / "graph" / "metrics" / "dimension_summary.json") if (DATE_DIR / "graph" / "metrics" / "dimension_summary.json").exists() else []
    pareto = _load(DATE_DIR / "graph" / "metrics" / "pareto_fronts.json") if (DATE_DIR / "graph" / "metrics" / "pareto_fronts.json").exists() else []

    print("=" * 78)
    print(f"AI-IDEATOR · cybersecurity corpus 2026-04-17 → 2026-04-30")
    print("=" * 78)
    if stats:
        print(f"\n[corpus]")
        print(f"  papers analyzed:        {stats.get('papers_analyzed', '?')} / {stats.get('papers_in_manifest', '?')}")
        print(f"  unique dimensions:      {stats.get('unique_dimensions_canonical', '?')} (canonical) / {stats.get('unique_dimensions_raw', '?')} (raw)")
        print(f"  unique tags:            {stats.get('unique_tags_canonical', '?')} / {stats.get('unique_tags_raw', '?')}")
        print(f"  unique units:           {stats.get('unique_units_canonical', '?')} / {stats.get('unique_units_raw', '?')}")
        print(f"  unique domains:         {stats.get('unique_domains', '?')}")
        print(f"  unique authors:         {stats.get('unique_authors', '?')}")

        print(f"\n[top dimensions — # of papers measuring each]")
        for d in stats.get("top_dimensions", [])[:15]:
            print(f"  {d['n_papers']:>4}  {d['name']}")

        print(f"\n[top tags]")
        for t in stats.get("top_tags", [])[:15]:
            print(f"  {t['n_papers']:>4}  {t['name']}")

    if dim_summary:
        print(f"\n[dimensions with rankable numbers — top 10 by paper count]")
        print(f"  {'n':>4}  {'min':>10}  {'max':>10}  {'mean':>10}  dimension (direction)")
        for d in dim_summary[:10]:
            print(f"  {d['n_papers']:>4}  {d['min']:>10.3g}  {d['max']:>10.3g}  {d['mean']:>10.3g}  {d['dimension']} ({d['direction']})")

    if pareto:
        print(f"\n[Pareto trade-offs — top 5 dimension pairs by overlap]")
        for p in pareto[:5]:
            print(f"  {p['dim_a']} ({p['dir_a']}) × {p['dim_b']} ({p['dir_b']})  ·  {p['n_points']} papers, {p['n_front']} on frontier")
            for f in p["front"][:3]:
                print(f"    front: a={f['value_a']:.3g} b={f['value_b']:.3g}  {f['paper_id']}")

    print(f"\n[where to look]")
    print(f"  manifest:                {DATE_DIR}/manifest.jsonl")
    print(f"  enriched (manifest+ana): {DATE_DIR}/enriched.jsonl")
    print(f"  per-paper analyses:      {DATE_DIR}/analysis/")
    print(f"  cross-paper indexes:     {DATE_DIR}/index_*.json")
    print(f"  graph nodes/edges:       {DATE_DIR}/graph/{{nodes,edges}}.jsonl")
    print(f"  graph for Gephi:         {DATE_DIR}/graph/graph.graphml")
    print(f"  trade-off geometry:      {DATE_DIR}/graph/metrics/")


if __name__ == "__main__":
    main()
