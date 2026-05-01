"""Smoke test the MiniMax key + endpoint via OpenAI-compatible /chat/completions.

Tries the configured MINIMAX_BASE_URL first; falls back through known endpoints
on auth/404 failures so we can identify which gateway hosts this key.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

API_KEY = os.environ.get("MINIMAX_API_KEY", "")
if not API_KEY:
    print("MINIMAX_API_KEY missing", file=sys.stderr)
    sys.exit(1)

# Probe order: configured first, then likely fallbacks.
CANDIDATES: list[tuple[str, str]] = [
    (os.environ.get("MINIMAX_BASE_URL", "https://api.minimax.io/v1"),
     os.environ.get("MINIMAX_MODEL", "MiniMax-M2")),
    ("https://api.minimax.io/v1", "MiniMax-M2"),
    ("https://api.minimaxi.com/v1", "MiniMax-M2"),
    ("https://api.minimaxi.chat/v1", "MiniMax-M2"),
    ("https://openrouter.ai/api/v1", "minimax/minimax-m2"),
]

PROMPT = "Reply with exactly: PONG"


def try_endpoint(base: str, model: str) -> tuple[bool, str]:
    url = f"{base.rstrip('/')}/chat/completions"
    # Per MiniMax docs: max_completion_tokens (NOT max_tokens), temperature (0,1].
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": PROMPT}],
        "max_completion_tokens": 64,
        "temperature": 0.1,
    }
    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=30) as c:
            r = c.post(url, headers=headers, json=payload)
        snippet = r.text[:300].replace(API_KEY, "***")
        if r.status_code == 200:
            data = r.json()
            content = (
                data.get("choices", [{}])[0].get("message", {}).get("content", "")
                or data.get("data", {}).get("text", "")
            )
            return True, f"200 OK · model={model} · content={content!r}"
        return False, f"{r.status_code} · {snippet}"
    except Exception as e:
        return False, f"EXC {type(e).__name__}: {e}"


def main() -> None:
    print(f"key prefix={API_KEY[:8]}…  len={len(API_KEY)}", file=sys.stderr)
    seen: set[tuple[str, str]] = set()
    for base, model in CANDIDATES:
        if (base, model) in seen:
            continue
        seen.add((base, model))
        ok, msg = try_endpoint(base, model)
        marker = "✓" if ok else "✗"
        print(f"{marker} {base}  model={model}\n    → {msg}\n", file=sys.stderr)
        if ok:
            print(json.dumps({"base_url": base, "model": model}))
            return
    print("No endpoint accepted the key.", file=sys.stderr)
    sys.exit(2)


if __name__ == "__main__":
    main()
