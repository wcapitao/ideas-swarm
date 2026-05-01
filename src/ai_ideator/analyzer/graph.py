"""Emit a typed property graph from the canonicalized indexes.

Outputs:
  graph/nodes.jsonl          one node per line: {id, type, properties}
  graph/edges.jsonl          one edge per line: {source, target, type, properties}
  graph/graph.graphml        GraphML for Gephi/Cytoscape
  graph/metrics/correlation_matrix.csv     dim × dim Pearson r over papers measuring both
  graph/metrics/pareto_fronts.json         Pareto-non-dominated papers per (dim_a, dim_b) pair
  graph/metrics/centrality.json            PageRank + degree on the paper-paper similarity graph
  graph/metrics/dimension_summary.json     n_papers, mean/median/min/max per dimension

No LLM calls — purely deterministic over the canonicalized data.
"""
from __future__ import annotations

import csv
import itertools
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

import networkx as nx


def _safe_load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _pearson(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n < 3:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if dx == 0 or dy == 0:
        return None
    return num / (dx * dy)


def _pareto_front(points: list[tuple[float, float, str]], dir_a: str, dir_b: str) -> list[dict[str, Any]]:
    """points = [(a, b, paper_id)]. Returns non-dominated points."""

    def better_a(x: float, y: float) -> bool:
        return x > y if dir_a == "higher_is_better" else x < y

    def better_b(x: float, y: float) -> bool:
        return x > y if dir_b == "higher_is_better" else x < y

    front: list[tuple[float, float, str]] = []
    for a, b, pid in points:
        dominated = False
        for a2, b2, pid2 in points:
            if pid2 == pid:
                continue
            # p2 dominates p iff p2 is at-least-as-good in both and strictly better in one
            ge_a = (not better_a(a, a2)) and (not (a == a2 and not better_a(a2, a)))
            ge_b = (not better_b(b, b2)) and (not (b == b2 and not better_b(b2, b)))
            # Simplified: dominates if better-or-equal in both and strictly better in at least one
            ge_a = a2 == a or better_a(a2, a)
            ge_b = b2 == b or better_b(b2, b)
            strict = better_a(a2, a) or better_b(b2, b)
            if ge_a and ge_b and strict:
                dominated = True
                break
        if not dominated:
            front.append((a, b, pid))
    return [{"value_a": a, "value_b": b, "paper_id": pid} for a, b, pid in front]


def build_graph(date_dir: Path) -> dict[str, Any]:
    out_dir = date_dir / "graph"
    metrics_dir = out_dir / "metrics"
    out_dir.mkdir(parents=True, exist_ok=True)
    metrics_dir.mkdir(parents=True, exist_ok=True)

    enriched_path = date_dir / "enriched.jsonl"
    if not enriched_path.exists():
        raise FileNotFoundError(f"{enriched_path} missing — run build_indexes first")
    papers = [json.loads(l) for l in enriched_path.read_text().splitlines() if l.strip()]

    nodes: dict[tuple[str, str], dict[str, Any]] = {}  # (type, id) → record
    edges: list[dict[str, Any]] = []

    def add_node(ntype: str, nid: str, **props: Any) -> None:
        key = (ntype, nid)
        if key not in nodes:
            nodes[key] = {"id": nid, "type": ntype, **props}
        else:
            for k, v in props.items():
                nodes[key].setdefault(k, v)

    def add_edge(src_t: str, src_id: str, etype: str, dst_t: str, dst_id: str, **props: Any) -> None:
        edges.append({
            "source": f"{src_t}:{src_id}",
            "target": f"{dst_t}:{dst_id}",
            "type": etype,
            **props,
        })

    # ---- emit nodes + edges
    paper_dim_values: dict[str, dict[str, float]] = defaultdict(dict)  # paper → dim → value_numeric
    dim_directions: dict[str, list[str]] = defaultdict(list)
    paper_tags: dict[str, set[str]] = defaultdict(set)

    for p in papers:
        pid = f"{p['source']}:{p['id']}"
        a = p.get("analysis") or {}
        topic = a.get("topic") or {}
        cls = a.get("classification") or {}

        add_node(
            "Paper", pid,
            title=p.get("title", ""),
            url=p.get("url", ""),
            published=p.get("published", "")[:10],
            relevance_score=p.get("relevance_score", 0),
            domain=cls.get("domain", ""),
            research_type=cls.get("research_type", ""),
            maturity=cls.get("maturity", ""),
            topic_what=topic.get("what", ""),
        )

        # Tags
        for t in a.get("tags") or []:
            add_node("Tag", t)
            add_edge("Paper", pid, "TAGGED_AS", "Tag", t)
            paper_tags[pid].add(t)

        # Domain / categories
        dom = (cls.get("domain") or "").strip()
        if dom:
            add_node("Domain", dom)
            add_edge("Paper", pid, "IN_DOMAIN", "Domain", dom)
        primary_cat = ((a.get("categories") or {}).get("primary") or "").strip()
        if primary_cat:
            add_node("Domain", primary_cat)
            add_edge("Paper", pid, "IN_DOMAIN", "Domain", primary_cat)

        # Authors
        for au in p.get("authors") or []:
            au = (au or "").strip()
            if au:
                add_node("Author", au)
                add_edge("Paper", pid, "AUTHORED_BY", "Author", au)

        # Characteristics → dimensions
        for c in a.get("characteristics") or []:
            dim = c["dimension"]
            add_node("Dimension", dim, unit=c.get("unit", ""))
            add_edge(
                "Paper", pid, "MEASURES", "Dimension", dim,
                value=c.get("value", ""),
                value_numeric=c.get("value_numeric"),
                unit=c.get("unit", ""),
                direction=c.get("direction", "unknown"),
                confidence=c.get("confidence", "medium"),
                evidence=c.get("evidence", ""),
                vs_baseline=c.get("vs_baseline", ""),
                context=c.get("context", ""),
            )
            if c.get("direction"):
                dim_directions[dim].append(c["direction"])
            if c.get("value_numeric") is not None:
                paper_dim_values[pid][dim] = float(c["value_numeric"])

        # Novelty / open problems / use cases / requirements
        for n in a.get("novelty") or []:
            add_node("NoveltyClaim", n)
            add_edge("Paper", pid, "PROPOSES", "NoveltyClaim", n)
        for op in a.get("open_problems") or []:
            add_node("OpenProblem", op)
            add_edge("Paper", pid, "IDENTIFIES", "OpenProblem", op)
        appl = a.get("applicability") or {}
        for uc in appl.get("good_for") or []:
            add_node("UseCase", uc)
            add_edge("Paper", pid, "SUITED_FOR", "UseCase", uc)
        for uc in appl.get("not_for") or []:
            add_node("UseCase", uc)
            add_edge("Paper", pid, "UNSUITED_FOR", "UseCase", uc)
        for rq in appl.get("requires") or []:
            add_node("Requirement", rq)
            add_edge("Paper", pid, "REQUIRES", "Requirement", rq)

    # ---- derived: SHARES_DIMENSION (paper × paper, weight = #shared)
    dim_to_papers: dict[str, list[str]] = defaultdict(list)
    for pid, dims in paper_dim_values.items():
        for d in dims:
            dim_to_papers[d].append(pid)
    shared_pairs: dict[tuple[str, str], list[str]] = defaultdict(list)
    for d, ps in dim_to_papers.items():
        for a, b in itertools.combinations(sorted(set(ps)), 2):
            shared_pairs[(a, b)].append(d)
    for (a, b), shared in shared_pairs.items():
        if len(shared) >= 1:
            add_edge("Paper", a, "SHARES_DIMENSION", "Paper", b, weight=len(shared), dims=shared[:10])

    # ---- write nodes/edges
    with (out_dir / "nodes.jsonl").open("w", encoding="utf-8") as f:
        for n in nodes.values():
            f.write(json.dumps(n, ensure_ascii=False) + "\n")
    with (out_dir / "edges.jsonl").open("w", encoding="utf-8") as f:
        for e in edges:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")

    # ---- NetworkX object + GraphML export (paper-paper subgraph for visualization)
    G = nx.Graph()
    for n in nodes.values():
        if n["type"] == "Paper":
            G.add_node(n["id"], **{k: str(v)[:200] for k, v in n.items() if k not in ("id", "type")})
    for e in edges:
        if e["type"] == "SHARES_DIMENSION":
            src = e["source"].split(":", 1)[1]
            dst = e["target"].split(":", 1)[1]
            G.add_edge(src, dst, weight=e.get("weight", 1))
    nx.write_graphml(G, out_dir / "graph.graphml")

    # ---- correlation matrix between dimensions
    dim_list = sorted(dim_to_papers.keys())
    corr_rows: list[list[Any]] = []
    for da in dim_list:
        row: list[Any] = [da]
        for db in dim_list:
            if da == db:
                row.append(1.0)
                continue
            xs, ys = [], []
            for pid in dim_to_papers[da]:
                if db in paper_dim_values[pid]:
                    xs.append(paper_dim_values[pid][da])
                    ys.append(paper_dim_values[pid][db])
            r = _pearson(xs, ys)
            row.append(round(r, 3) if r is not None else "")
        corr_rows.append(row)
    with (metrics_dir / "correlation_matrix.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["dimension"] + dim_list)
        w.writerows(corr_rows)

    # ---- Pareto fronts for top dimension pairs (by n_papers measuring both)
    pair_overlap: list[tuple[int, str, str]] = []
    for i, da in enumerate(dim_list):
        for db in dim_list[i + 1 :]:
            both = [pid for pid in dim_to_papers[da] if db in paper_dim_values[pid]]
            if len(both) >= 3:
                pair_overlap.append((len(both), da, db))
    pair_overlap.sort(reverse=True)
    pareto = []
    for n_pts, da, db in pair_overlap[:50]:
        dir_a = max(set(dim_directions[da]), key=dim_directions[da].count) if dim_directions[da] else "unknown"
        dir_b = max(set(dim_directions[db]), key=dim_directions[db].count) if dim_directions[db] else "unknown"
        points = [
            (paper_dim_values[pid][da], paper_dim_values[pid][db], pid)
            for pid in dim_to_papers[da] if db in paper_dim_values[pid]
        ]
        front = _pareto_front(points, dir_a, dir_b)
        pareto.append({
            "dim_a": da, "dim_b": db,
            "dir_a": dir_a, "dir_b": dir_b,
            "n_points": n_pts, "n_front": len(front),
            "front": front,
            "all_points": [{"a": a, "b": b, "paper_id": pid} for a, b, pid in points],
        })
    (metrics_dir / "pareto_fronts.json").write_text(json.dumps(pareto, ensure_ascii=False, indent=2))

    # ---- centrality on paper-paper similarity graph
    if G.number_of_nodes() > 0 and G.number_of_edges() > 0:
        pr = nx.pagerank(G, weight="weight")
        deg = dict(G.degree(weight="weight"))
        centrality = {
            "pagerank_top": [{"paper_id": p, "score": round(s, 5)} for p, s in sorted(pr.items(), key=lambda kv: -kv[1])[:50]],
            "degree_top": [{"paper_id": p, "weighted_degree": d} for p, d in sorted(deg.items(), key=lambda kv: -kv[1])[:50]],
        }
    else:
        centrality = {"pagerank_top": [], "degree_top": []}
    (metrics_dir / "centrality.json").write_text(json.dumps(centrality, ensure_ascii=False, indent=2))

    # ---- per-dimension stats
    dim_stats: list[dict[str, Any]] = []
    for d, ps in dim_to_papers.items():
        vals = [paper_dim_values[pid][d] for pid in ps]
        if vals:
            dim_stats.append({
                "dimension": d,
                "n_papers": len(ps),
                "min": min(vals),
                "max": max(vals),
                "mean": round(sum(vals) / len(vals), 4),
                "direction": max(set(dim_directions[d]), key=dim_directions[d].count) if dim_directions[d] else "unknown",
            })
    dim_stats.sort(key=lambda x: -x["n_papers"])
    (metrics_dir / "dimension_summary.json").write_text(json.dumps(dim_stats, ensure_ascii=False, indent=2))

    return {
        "nodes": len(nodes),
        "edges": len(edges),
        "node_types": {t: sum(1 for n in nodes.values() if n["type"] == t) for t in {n["type"] for n in nodes.values()}},
        "edge_types": {t: sum(1 for e in edges if e["type"] == t) for t in {e["type"] for e in edges}},
        "dimensions_with_numeric": len([d for d in dim_to_papers if dim_to_papers[d]]),
        "pareto_pairs": len(pareto),
    }
