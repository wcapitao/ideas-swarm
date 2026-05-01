"""Canonicalize analyses and build cross-paper indexes.

Inputs:
  analysis/*.json     produced by analyze.py
  manifest.jsonl      original manifest

Outputs (all in the same date folder):
  enriched.jsonl              manifest joined with analysis (one line per paper)
  index_dimensions.json       canonical_dim → [{paper_id, value, value_numeric, unit, direction, ...}], sorted by value_numeric
  index_tags.json             tag → [paper_ids]
  index_domains.json          domain → [paper_ids]
  index_authors.json          author → [paper_ids]
  index_baselines.json        baseline_method (mentioned in vs_baseline) → [{paper_id, dimension, our_value, their_value, factor}]
  vocab_dimensions.csv        dim_raw, dim_canonical, count, unit_canonical
  vocab_tags.csv              tag_raw, tag_canonical, count
  vocab_units.csv             unit_raw, unit_canonical, count
  stats.json                  corpus-level stats
"""
from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

# ---------------- canonicalization rules (deterministic, no LLM) ----------------

# Hyphen↔underscore normalization for dimension names (snake_case canonical).
# Tags stay hyphenated (kebab-case).
_HYPHEN_TO_UNDER = re.compile(r"-+")
_NON_ALNUM = re.compile(r"[^a-z0-9_]+")
_MULTI_UNDER = re.compile(r"_+")


def canonical_dimension(name: str) -> str:
    """Snake_case, lowercase, no punctuation. throughput-qps → throughput_qps."""
    s = name.strip().lower()
    s = _HYPHEN_TO_UNDER.sub("_", s)
    s = _NON_ALNUM.sub("_", s)
    s = _MULTI_UNDER.sub("_", s).strip("_")
    return s


def canonical_tag(tag: str) -> str:
    """kebab-case, lowercase."""
    s = tag.strip().lower()
    s = re.sub(r"_+", "-", s)
    s = re.sub(r"[^a-z0-9-]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s


# Unit aliasing — common synonyms to one canonical form.
UNIT_ALIASES = {
    "milliseconds": "ms",
    "millisecond": "ms",
    "ms": "ms",
    "seconds": "s",
    "second": "s",
    "s": "s",
    "minutes": "min",
    "min": "min",
    "hours": "h",
    "hour": "h",
    "h": "h",
    "percentage": "%",
    "percent": "%",
    "pct": "%",
    "%": "%",
    "percentage points": "pp",
    "pp": "pp",
    "bits": "bits",
    "bit": "bits",
    "bytes": "B",
    "kb": "KB",
    "kilobytes": "KB",
    "mb": "MB",
    "megabytes": "MB",
    "gb": "GB",
    "gigabytes": "GB",
    "queries": "queries",
    "query": "queries",
    "tokens": "tokens",
    "token": "tokens",
    "count": "count",
    "ratio": "ratio",
    "probability": "probability",
    "prob": "probability",
    "spearman correlation": "r",
    "pearson correlation": "r",
    "correlation": "r",
    "qps": "qps",
    "ops/s": "ops/s",
    "fps": "fps",
    "none": "",
    "n/a": "",
    "binary": "bool",
}


def canonical_unit(u: str) -> str:
    s = u.strip().lower()
    if not s:
        return ""
    return UNIT_ALIASES.get(s, s)


# Direction normalization
_DIRECTION_OK = {"higher_is_better", "lower_is_better", "neutral", "unknown"}

_DIRECTION_GUESS = {
    # higher_is_better keywords
    "rate": None,  # ambiguous — depends on context
    "accuracy": "higher_is_better",
    "f1": "higher_is_better",
    "auc": "higher_is_better",
    "precision": "higher_is_better",
    "recall": "higher_is_better",
    "throughput": "higher_is_better",
    "speedup": "higher_is_better",
    # lower_is_better
    "latency": "lower_is_better",
    "time": "lower_is_better",
    "cost": "lower_is_better",
    "size": "lower_is_better",
    "overhead": "lower_is_better",
    "fpr": "lower_is_better",
    "asr": "lower_is_better",
    "false_positive": "lower_is_better",
    "false_negative": "lower_is_better",
    "memory": "lower_is_better",
}


def canonical_direction(d: str, dim_name: str = "") -> str:
    s = (d or "").strip().lower().replace(" ", "_")
    if s in _DIRECTION_OK:
        return s
    # Heuristic fallback from dimension name
    for kw, guess in _DIRECTION_GUESS.items():
        if guess and kw in dim_name.lower():
            return guess
    return "unknown"


# ---------------- index build ----------------


def _safe_load(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def build_indexes(date_dir: Path) -> dict[str, Any]:
    analysis_dir = date_dir / "analysis"
    manifest_path = date_dir / "manifest.jsonl"

    manifest = {f"{m['source']}:{m['id']}": m for m in (json.loads(l) for l in manifest_path.read_text().splitlines() if l.strip())}

    analyses: list[dict[str, Any]] = []
    for p in sorted(analysis_dir.glob("*.json")):
        d = _safe_load(p)
        if d and isinstance(d, dict) and d.get("paper_id"):
            analyses.append(d)

    # ---- vocab counters
    dim_raw_counter: Counter[str] = Counter()
    dim_canon_counter: Counter[str] = Counter()
    tag_raw_counter: Counter[str] = Counter()
    tag_canon_counter: Counter[str] = Counter()
    unit_raw_counter: Counter[str] = Counter()
    unit_canon_counter: Counter[str] = Counter()

    # ---- indexes
    idx_dim: dict[str, list[dict[str, Any]]] = defaultdict(list)
    idx_tag: dict[str, list[str]] = defaultdict(list)
    idx_dom: dict[str, list[str]] = defaultdict(list)
    idx_auth: dict[str, list[str]] = defaultdict(list)
    idx_baseline: dict[str, list[dict[str, Any]]] = defaultdict(list)

    # ---- enriched output
    enriched_lines: list[str] = []

    for a in analyses:
        pid = a["paper_id"]
        m = manifest.get(pid, {})

        # domain / categories
        dom_raw = ((a.get("classification") or {}).get("domain") or "").strip()
        if dom_raw:
            dom_c = canonical_tag(dom_raw)
            idx_dom[dom_c].append(pid)

        cats_primary = (a.get("categories") or {}).get("primary", "")
        if cats_primary:
            idx_dom[canonical_tag(cats_primary)].append(pid)

        # tags
        canonical_tags_for_paper: list[str] = []
        for t in a.get("tags") or []:
            tag_raw_counter[t] += 1
            tc = canonical_tag(t)
            if tc:
                tag_canon_counter[tc] += 1
                canonical_tags_for_paper.append(tc)
                idx_tag[tc].append(pid)

        # authors
        for au in m.get("authors") or []:
            au = (au or "").strip()
            if au:
                idx_auth[au].append(pid)

        # characteristics
        canonical_chars: list[dict[str, Any]] = []
        for c in a.get("characteristics") or []:
            dim_raw = (c.get("dimension") or "").strip()
            if not dim_raw:
                continue
            dim_raw_counter[dim_raw] += 1
            dim_c = canonical_dimension(dim_raw)
            dim_canon_counter[dim_c] += 1

            unit_raw = (c.get("unit") or "").strip()
            if unit_raw:
                unit_raw_counter[unit_raw] += 1
            unit_c = canonical_unit(unit_raw)
            if unit_c:
                unit_canon_counter[unit_c] += 1

            direction = canonical_direction(c.get("direction") or "", dim_c)

            entry = {
                "paper_id": pid,
                "dimension_raw": dim_raw,
                "dimension": dim_c,
                "value": c.get("value", ""),
                "value_numeric": c.get("value_numeric"),
                "value_class": (c.get("value_class") or "").strip(),
                "unit_raw": unit_raw,
                "unit": unit_c,
                "direction": direction,
                "vs_baseline": (c.get("vs_baseline") or "").strip(),
                "evidence": (c.get("evidence") or "").strip(),
                "confidence": (c.get("confidence") or "medium").strip(),
                "context": (c.get("context") or "").strip(),
            }
            idx_dim[dim_c].append(entry)
            canonical_chars.append(entry)

            # Baseline extraction: parse "X ms (MethodName)" pattern from vs_baseline
            vb = entry["vs_baseline"]
            m_baseline = re.search(r"\(([^)]+(?:et al\.?|\d{4}|method|baseline|sota)[^)]*)\)", vb, re.I) if vb else None
            if m_baseline:
                bname = m_baseline.group(1).strip()
                num_m = re.search(r"(\d[\d,]*(?:\.\d+)?)\s*([a-zA-Zµ%]*)", vb)
                their_val = None
                if num_m:
                    try:
                        their_val = float(num_m.group(1).replace(",", ""))
                    except ValueError:
                        their_val = None
                factor = None
                if their_val and entry["value_numeric"]:
                    try:
                        factor = round(their_val / float(entry["value_numeric"]), 2)
                    except (ZeroDivisionError, ValueError):
                        factor = None
                idx_baseline[canonical_tag(bname)].append({
                    "paper_id": pid,
                    "dimension": dim_c,
                    "our_value": entry["value_numeric"],
                    "their_value": their_val,
                    "factor": factor,
                    "raw": vb,
                })

        # enriched record (manifest + analysis joined)
        enriched = {
            **{k: v for k, v in m.items() if k not in ("score_breakdown",)},
            "analysis": {
                "tags": canonical_tags_for_paper,
                "categories": a.get("categories") or {},
                "classification": a.get("classification") or {},
                "topic": a.get("topic") or {},
                "characteristics": canonical_chars,
                "applicability": a.get("applicability") or {},
                "novelty": a.get("novelty") or [],
                "open_problems": a.get("open_problems") or [],
                "_meta": a.get("_meta") or {},
            },
        }
        enriched_lines.append(json.dumps(enriched, ensure_ascii=False))

    # Sort dimension index entries: by direction, value_numeric ranks first.
    for dim, items in idx_dim.items():
        # Determine majority direction
        dirs = [it["direction"] for it in items if it["direction"] != "unknown"]
        majority = Counter(dirs).most_common(1)[0][0] if dirs else "unknown"
        reverse = (majority == "higher_is_better")

        def _key(it: dict[str, Any]) -> tuple[int, float]:
            v = it["value_numeric"]
            # nulls last
            return (0 if v is not None else 1, -v if (v is not None and reverse) else (v or 0))

        items.sort(key=_key)
        # tag majority direction onto the index header
        idx_dim[dim] = items  # list, header info goes in stats

    # Dedup id lists
    for d in (idx_tag, idx_dom, idx_auth):
        for k in list(d.keys()):
            d[k] = sorted(set(d[k]))

    # ---- write outputs
    (date_dir / "enriched.jsonl").write_text("\n".join(enriched_lines) + "\n", encoding="utf-8")

    def _write_json(name: str, obj: Any) -> None:
        (date_dir / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")

    _write_json("index_dimensions.json", {
        "_about": "canonical dimension → ranked papers measuring it (sorted by majority direction)",
        "_count": len(idx_dim),
        "data": dict(sorted(idx_dim.items(), key=lambda kv: -len(kv[1]))),
    })
    _write_json("index_tags.json", {
        "_about": "canonical tag → papers carrying it",
        "_count": len(idx_tag),
        "data": dict(sorted(idx_tag.items(), key=lambda kv: -len(kv[1]))),
    })
    _write_json("index_domains.json", {
        "_count": len(idx_dom),
        "data": dict(sorted(idx_dom.items(), key=lambda kv: -len(kv[1]))),
    })
    _write_json("index_authors.json", {
        "_count": len(idx_auth),
        "data": dict(sorted(idx_auth.items(), key=lambda kv: -len(kv[1]))),
    })
    _write_json("index_baselines.json", {
        "_about": "baseline method named in vs_baseline → {our paper, dim, factor}",
        "_count": len(idx_baseline),
        "data": dict(sorted(idx_baseline.items(), key=lambda kv: -len(kv[1]))),
    })

    # vocab CSVs
    def _csv(name: str, header: list[str], rows: list[list[Any]]) -> None:
        with (date_dir / name).open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(header)
            w.writerows(rows)

    _csv("vocab_dimensions.csv", ["raw", "canonical", "count_raw", "count_canonical"], [
        [r, canonical_dimension(r), c, dim_canon_counter[canonical_dimension(r)]]
        for r, c in dim_raw_counter.most_common()
    ])
    _csv("vocab_tags.csv", ["raw", "canonical", "count"], [
        [r, canonical_tag(r), c] for r, c in tag_raw_counter.most_common()
    ])
    _csv("vocab_units.csv", ["raw", "canonical", "count"], [
        [r, canonical_unit(r), c] for r, c in unit_raw_counter.most_common()
    ])

    stats = {
        "papers_analyzed": len(analyses),
        "papers_in_manifest": len(manifest),
        "unique_dimensions_raw": len(dim_raw_counter),
        "unique_dimensions_canonical": len(dim_canon_counter),
        "unique_tags_raw": len(tag_raw_counter),
        "unique_tags_canonical": len(tag_canon_counter),
        "unique_units_raw": len(unit_raw_counter),
        "unique_units_canonical": len(unit_canon_counter),
        "unique_domains": len(idx_dom),
        "unique_authors": len(idx_auth),
        "top_dimensions": [{"name": k, "n_papers": len(v)} for k, v in list(sorted(idx_dim.items(), key=lambda kv: -len(kv[1])))[:25]],
        "top_tags": [{"name": k, "n_papers": len(v)} for k, v in list(sorted(idx_tag.items(), key=lambda kv: -len(kv[1])))[:25]],
        "top_domains": [{"name": k, "n_papers": len(v)} for k, v in list(sorted(idx_dom.items(), key=lambda kv: -len(kv[1])))[:25]],
    }
    _write_json("stats.json", stats)
    return stats
