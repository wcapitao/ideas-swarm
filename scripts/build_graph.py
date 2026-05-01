"""Build the property graph + DoF metrics from enriched.jsonl."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from ai_ideator.analyzer.graph import build_graph  # noqa: E402

DATE_DIR = ROOT / "cybersec-papers" / "2026-04-17_to_2026-04-30"


def main() -> None:
    stats = build_graph(DATE_DIR)
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
