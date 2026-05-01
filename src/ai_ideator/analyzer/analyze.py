"""Per-paper analysis orchestrator.

Given a manifest record + (optional) full text, produces a PaperAnalysis JSON
file under analysis/<source>__<id>.json. Resumable: existing files are skipped
unless force=True.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .client import ChatResult, MiniMaxClient, MiniMaxJSONError
from .prompts import build_messages
from .schema import PaperAnalysis


def paper_canonical_id(p: dict) -> str:
    return f"{p['source']}:{p['id']}"


def analysis_filename(p: dict) -> str:
    return f"{p['source']}__{p['id'].replace('/', '_')}.json"


@dataclass
class AnalyzeOutcome:
    paper_id: str
    path: Path | None
    ok: bool
    skipped: bool = False
    error: str = ""
    usage: dict[str, int] | None = None
    latency_s: float = 0.0
    model: str = ""


def _coerce(d: dict[str, Any], paper_id: str) -> dict[str, Any]:
    """Ensure the model's output validates; backfill minimal fields if missing."""
    d.setdefault("paper_id", paper_id)
    if d.get("paper_id") != paper_id:
        # Trust our id, not the model's
        d["paper_id"] = paper_id
    PaperAnalysis.model_validate(d)  # raises on bad shape
    return d


def analyze_paper(
    paper: dict,
    *,
    body: str,
    out_dir: Path,
    client: MiniMaxClient,
    force: bool = False,
    max_tokens: int = 2048,
) -> AnalyzeOutcome:
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / analysis_filename(paper)
    pid = paper_canonical_id(paper)

    if out_path.exists() and not force:
        return AnalyzeOutcome(pid, out_path, ok=True, skipped=True)

    messages = build_messages(
        paper_id=pid,
        source=paper["source"],
        title=paper.get("title", ""),
        authors=paper.get("authors", []),
        categories=paper.get("categories", []),
        comment=paper.get("comment", ""),
        body=body,
    )

    t0 = time.monotonic()
    try:
        parsed, result = client.chat_json(messages, max_tokens=max_tokens, temperature=0.1)
        d = _coerce(parsed, pid)
    except MiniMaxJSONError as e:
        # Persist the raw text for debugging, mark failure
        debug_path = out_dir / (analysis_filename(paper) + ".raw.txt")
        debug_path.write_text(e.raw, encoding="utf-8")
        return AnalyzeOutcome(pid, None, ok=False, error=f"JSON parse: {e}", latency_s=time.monotonic() - t0)
    except Exception as e:
        return AnalyzeOutcome(pid, None, ok=False, error=f"{type(e).__name__}: {e}", latency_s=time.monotonic() - t0)

    d["_meta"] = {
        "analyzed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": result.model,
        "input_kind": "full_text" if len(body) > 2500 else "abstract_only",
        "input_chars": len(body),
        "prompt_tokens": int(result.usage.get("prompt_tokens", 0)),
        "completion_tokens": int(result.usage.get("completion_tokens", 0)),
        "total_tokens": int(result.usage.get("total_tokens", 0)),
        "latency_s": result.latency_s,
        "finish_reason": result.finish_reason,
    }
    out_path.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    return AnalyzeOutcome(
        pid,
        out_path,
        ok=True,
        usage=result.usage,
        latency_s=result.latency_s,
        model=result.model,
    )
