"""Build cross-paper indexes from analysis/*.json.

Resumable: just reads the analysis dir, no model calls.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from ai_ideator.analyzer.index import build_indexes  # noqa: E402

DATE_DIR = ROOT / "cybersec-papers" / "2026-04-17_to_2026-04-30"


def main() -> None:
    stats = build_indexes(DATE_DIR)
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
