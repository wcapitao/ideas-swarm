"""Verify all 410 papers have an analysis built from the FULL PDF (not abstract).

Strategy:
  1. Re-run analyze_papers --all with the patched schema (resumable; full text)
  2. For any paper still missing, retry PDF fetch with alternate URLs (already in extract.py)
     and re-run analyzer with --ids (full text)
  3. Last resort: tighter max_tokens on stragglers (still full text, just smaller output budget)

Never falls back to abstract — user requirement: full PDF for all.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATE_DIR = ROOT / "cybersec-papers" / "2026-04-17_to_2026-04-30"
MANIFEST = DATE_DIR / "manifest.jsonl"
ANALYSIS_DIR = DATE_DIR / "analysis"
PDF_DIR = DATE_DIR / "pdfs"


def manifest_records() -> list[dict]:
    return [json.loads(l) for l in MANIFEST.read_text().splitlines() if l.strip()]


def analysis_path(p: dict) -> Path:
    return ANALYSIS_DIR / f"{p['source']}__{p['id'].replace('/', '_')}.json"


def pdf_path(p: dict) -> Path:
    return PDF_DIR / f"{p['source']}__{p['id'].replace('/', '_')}.pdf"


def missing_analyses(papers: list[dict]) -> list[dict]:
    return [p for p in papers if not analysis_path(p).exists()]


def missing_pdfs(papers: list[dict]) -> list[dict]:
    return [p for p in papers if not pdf_path(p).exists() or pdf_path(p).stat().st_size < 1024]


def used_abstract_only(p: dict) -> bool:
    a = analysis_path(p)
    if not a.exists():
        return False
    try:
        d = json.loads(a.read_text())
        return (d.get("_meta") or {}).get("input_kind") == "abstract_only"
    except Exception:
        return False


def run(cmd: list[str]) -> int:
    print(f"\n>>> {' '.join(cmd)}", flush=True)
    return subprocess.call(cmd)


def main() -> None:
    papers = manifest_records()
    print(f"Manifest size: {len(papers)}")

    # Pass 1 — full-text retry of everything missing (patched schema, resumable)
    miss = missing_analyses(papers)
    print(f"Initial missing analyses: {len(miss)}")
    if miss:
        run(["python3", str(ROOT / "scripts" / "analyze_papers.py"), "--all", "--workers", "4"])

    # Pass 2 — anything analyzed only from abstract gets re-done from full text
    abstract_only = [p for p in papers if used_abstract_only(p)]
    if abstract_only:
        print(f"Papers analyzed only from abstract — redoing with full text: {len(abstract_only)}")
        # Force re-fetch of PDF (it'll be tried with all alternate URLs now)
        for p in abstract_only:
            ap = analysis_path(p)
            if ap.exists():
                ap.unlink()  # so analyze --ids will redo it
        ids = ",".join(f"{p['source']}:{p['id']}" for p in abstract_only)
        run([
            "python3", str(ROOT / "scripts" / "analyze_papers.py"),
            "--ids", ids, "--workers", "4",
        ])

    # Pass 3 — full-text targeted retry on still-missing (PDF alternates already tried in pass 1)
    miss = missing_analyses(papers)
    if miss:
        print(f"Still missing after pass 2: {len(miss)} — targeted full-text retry")
        ids = ",".join(f"{p['source']}:{p['id']}" for p in miss)
        run([
            "python3", str(ROOT / "scripts" / "analyze_papers.py"),
            "--ids", ids, "--workers", "2",
        ])

    # Pass 4 — tighter output for hard cases (still full text input)
    miss = missing_analyses(papers)
    if miss:
        print(f"Still missing after pass 3: {len(miss)} — tighter output cap")
        ids = ",".join(f"{p['source']}:{p['id']}" for p in miss)
        run([
            "python3", str(ROOT / "scripts" / "analyze_papers.py"),
            "--ids", ids, "--workers", "2", "--max-tokens", "1500",
        ])

    # Final report
    miss = missing_analyses(papers)
    pdfs_miss = missing_pdfs(papers)
    abstract_only_remaining = [p for p in papers if used_abstract_only(p)]

    print(f"\n=== final state ===")
    print(f"  papers in manifest:           {len(papers)}")
    print(f"  with analysis:                {len(papers) - len(miss)}")
    print(f"  with full PDF on disk:        {len(papers) - len(pdfs_miss)}")
    print(f"  analyses still abstract-only: {len(abstract_only_remaining)}")
    print(f"  papers with NO analysis:      {len(miss)}")

    if miss:
        print("\nUnresolved (no analysis):")
        for p in miss:
            print(f"  {p['source']}:{p['id']}  {p.get('title','')[:80]}")
    if pdfs_miss:
        print("\nPapers without a downloadable PDF (despite alternate URL attempts):")
        for p in pdfs_miss[:30]:
            print(f"  {p['source']}:{p['id']}  {p['url']}")
        if len(pdfs_miss) > 30:
            print(f"  …and {len(pdfs_miss)-30} more")

    sys.exit(0 if not miss else 1)


if __name__ == "__main__":
    main()
