"""End-to-end analyzer runner.

Usage:
  python3 scripts/analyze_papers.py --sample 5            # smoke test on top 5 ranked
  python3 scripts/analyze_papers.py --all                 # everything in manifest
  python3 scripts/analyze_papers.py --ids arxiv:2604.x,iacr:2026/822
  python3 scripts/analyze_papers.py --abstracts-only      # skip PDF fetch, use manifest abstracts

Resumable: skips papers that already have an analysis file unless --force.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# Make src importable when running as a script
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from ai_ideator.analyzer.analyze import (  # noqa: E402
    AnalyzeOutcome,
    analyze_paper,
    analysis_filename,
    paper_canonical_id,
)
from ai_ideator.analyzer.client import MiniMaxClient  # noqa: E402
from ai_ideator.analyzer.extract import (  # noqa: E402
    download_pdfs,
    extract_text,
    safe_filename,
)

DATA_DIR = ROOT / "cybersec-papers" / "2026-04-17_to_2026-04-30"
MANIFEST = DATA_DIR / "manifest.jsonl"
PDF_DIR = DATA_DIR / "pdfs"
TEXT_DIR = DATA_DIR / "text"
ANALYSIS_DIR = DATA_DIR / "analysis"


def load_manifest() -> list[dict]:
    return [json.loads(l) for l in MANIFEST.read_text().splitlines() if l.strip()]


def select_papers(papers: list[dict], args: argparse.Namespace) -> list[dict]:
    if args.ids:
        wanted = {x.strip() for x in args.ids.split(",") if x.strip()}
        return [p for p in papers if paper_canonical_id(p) in wanted]
    if args.sample:
        # Take the top-N by relevance_score (already sorted in manifest)
        return papers[: args.sample]
    if args.all:
        return papers
    raise SystemExit("must pass --sample N, --all, or --ids …")


def get_text_for(paper: dict, *, abstracts_only: bool) -> tuple[str, str]:
    """Return (body_text, kind) where kind is 'full_text' or 'abstract'."""
    if abstracts_only:
        return paper.get("abstract", ""), "abstract"
    pdf_path = PDF_DIR / safe_filename(paper["source"], paper["id"])
    if not pdf_path.exists():
        return paper.get("abstract", ""), "abstract"
    text_path = TEXT_DIR / (safe_filename(paper["source"], paper["id"]).replace(".pdf", ".txt"))
    if text_path.exists():
        return text_path.read_text(encoding="utf-8"), "full_text"
    try:
        text = extract_text(pdf_path, max_chars=200_000)
        TEXT_DIR.mkdir(parents=True, exist_ok=True)
        text_path.write_text(text, encoding="utf-8")
        return text, "full_text"
    except Exception as e:
        print(f"[extract] {paper['id']} failed: {e}", file=sys.stderr)
        return paper.get("abstract", ""), "abstract"


def fmt_usage(outcomes: list[AnalyzeOutcome]) -> str:
    ok = [o for o in outcomes if o.ok and not o.skipped]
    skipped = [o for o in outcomes if o.skipped]
    failed = [o for o in outcomes if not o.ok]
    pt = sum((o.usage or {}).get("prompt_tokens", 0) for o in ok)
    ct = sum((o.usage or {}).get("completion_tokens", 0) for o in ok)
    avg_lat = (sum(o.latency_s for o in ok) / len(ok)) if ok else 0
    return (
        f"ok={len(ok)} skipped={len(skipped)} failed={len(failed)}  "
        f"tokens prompt={pt} completion={ct} total={pt+ct}  avg_latency={avg_lat:.1f}s"
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, help="Analyze top-N papers (by relevance_score)")
    ap.add_argument("--all", action="store_true", help="Analyze every paper in manifest")
    ap.add_argument("--ids", type=str, default="", help="Comma-separated 'source:id' selectors")
    ap.add_argument("--abstracts-only", action="store_true", help="Skip PDF fetch; use manifest abstracts")
    ap.add_argument("--force", action="store_true", help="Re-analyze papers that already have output")
    ap.add_argument("--workers", type=int, default=4, help="Concurrent M2.7 calls")
    ap.add_argument("--max-tokens", type=int, default=2048, help="Output token cap (max 2048)")
    args = ap.parse_args()

    papers = load_manifest()
    selected = select_papers(papers, args)
    print(f"Selected {len(selected)} papers from {len(papers)} in manifest", file=sys.stderr)

    # 1) Get PDFs unless abstracts-only
    if not args.abstracts_only:
        print(f"Downloading PDFs to {PDF_DIR} …", file=sys.stderr)
        dl = download_pdfs(selected, PDF_DIR, workers=6)
        ok = sum(1 for d in dl if d.path)
        bad = [d for d in dl if not d.path]
        print(f"PDFs: ok={ok}/{len(dl)}", file=sys.stderr)
        for d in bad[:5]:
            print(f"  PDF FAIL {d.source}:{d.paper_id}  {d.error}", file=sys.stderr)
        if len(bad) > 5:
            print(f"  …and {len(bad)-5} more failures", file=sys.stderr)

    # 2) Analyze
    ANALYSIS_DIR.mkdir(parents=True, exist_ok=True)
    outcomes: list[AnalyzeOutcome] = []
    t0 = time.monotonic()

    def _job(p: dict) -> AnalyzeOutcome:
        body, _kind = get_text_for(p, abstracts_only=args.abstracts_only)
        if not body.strip():
            return AnalyzeOutcome(paper_canonical_id(p), None, ok=False, error="empty body")
        with MiniMaxClient() as client:
            return analyze_paper(
                p, body=body, out_dir=ANALYSIS_DIR,
                client=client, force=args.force, max_tokens=args.max_tokens,
            )

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        futures = {ex.submit(_job, p): p for p in selected}
        for i, fut in enumerate(as_completed(futures), 1):
            o = fut.result()
            outcomes.append(o)
            tag = "✓" if o.ok and not o.skipped else ("→" if o.skipped else "✗")
            note = "skipped" if o.skipped else (o.error or f"{o.latency_s:.1f}s")
            print(f"[{i}/{len(selected)}] {tag} {o.paper_id}  {note}", file=sys.stderr)

    elapsed = time.monotonic() - t0
    print(f"\nDone in {elapsed:.1f}s · {fmt_usage(outcomes)}", file=sys.stderr)
    print(f"Outputs in: {ANALYSIS_DIR}", file=sys.stderr)


if __name__ == "__main__":
    main()
