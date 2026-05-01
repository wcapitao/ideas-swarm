"""MiniMax M2.7 client (OpenAI-compatible /v1/chat/completions).

Why this exists: M2.7 is a reasoning model that emits <think>…</think> blocks
and that thinking eats the output budget (cap is 2048 tokens per docs). This
wrapper:
  - separates reasoning from content
  - retries on transient errors with exponential backoff
  - returns usage so we can track cost/throughput
  - raises a typed error on JSON-parse failure so callers can decide

Env vars (loaded from .env at import-time):
  MINIMAX_API_KEY    required
  MINIMAX_BASE_URL   default https://api.minimax.io/v1
  MINIMAX_MODEL      default MiniMax-M2.7
"""
from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

# .env loader (no python-dotenv dep needed for this simple format)
_ENV_PATH = Path(__file__).resolve().parents[3] / ".env"
if _ENV_PATH.exists():
    for _line in _ENV_PATH.read_text().splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _v = _line.split("=", 1)
        os.environ.setdefault(_k.strip(), _v.strip())


class MiniMaxError(RuntimeError):
    pass


class MiniMaxJSONError(MiniMaxError):
    """The model returned non-JSON content where JSON was required."""

    def __init__(self, msg: str, raw: str) -> None:
        super().__init__(msg)
        self.raw = raw


@dataclass
class ChatResult:
    content: str
    reasoning: str  # extracted <think>…</think> body, "" if none
    raw_content: str  # exact assistant message before stripping
    usage: dict[str, int]
    finish_reason: str
    model: str
    latency_s: float


_THINK_RE = re.compile(r"<think>(.*?)</think>", re.S | re.I)


def _split_thinking(text: str) -> tuple[str, str]:
    """Extract the last <think>…</think> block, return (content_without_think, thinking)."""
    thoughts = _THINK_RE.findall(text)
    cleaned = _THINK_RE.sub("", text).strip()
    return cleaned, "\n\n".join(t.strip() for t in thoughts)


class MiniMaxClient:
    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float = 180.0,
    ) -> None:
        self.api_key = api_key or os.environ.get("MINIMAX_API_KEY", "")
        if not self.api_key:
            raise MiniMaxError("MINIMAX_API_KEY not set")
        self.base_url = (base_url or os.environ.get("MINIMAX_BASE_URL", "https://api.minimax.io/v1")).rstrip("/")
        self.model = model or os.environ.get("MINIMAX_MODEL", "MiniMax-M2.7")
        self._client = httpx.Client(timeout=timeout)

    def __enter__(self) -> MiniMaxClient:
        return self

    def __exit__(self, *exc: Any) -> None:
        self._client.close()

    def chat(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int = 2048,
        temperature: float = 0.2,
        top_p: float = 0.95,
        max_retries: int = 4,
        extra: dict[str, Any] | None = None,
    ) -> ChatResult:
        url = f"{self.base_url}/chat/completions"
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "max_completion_tokens": max(64, min(max_tokens, 2048)),  # docs cap = 2048
            "temperature": max(0.01, min(temperature, 1.0)),  # docs range (0, 1]
            "top_p": max(0.01, min(top_p, 1.0)),
            "stream": False,
        }
        if extra:
            payload.update(extra)
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

        backoff = 1.5
        last_err: Exception | None = None
        for attempt in range(max_retries + 1):
            t0 = time.monotonic()
            try:
                r = self._client.post(url, headers=headers, json=payload)
                latency = time.monotonic() - t0
                if r.status_code in (429, 500, 502, 503, 504):
                    raise httpx.HTTPStatusError(f"retryable {r.status_code}", request=r.request, response=r)
                if r.status_code != 200:
                    snippet = r.text[:400]
                    raise MiniMaxError(f"HTTP {r.status_code}: {snippet}")
                data = r.json()
                choice = (data.get("choices") or [{}])[0]
                msg = (choice.get("message") or {}).get("content", "") or ""
                content, reasoning = _split_thinking(msg)
                return ChatResult(
                    content=content,
                    reasoning=reasoning,
                    raw_content=msg,
                    usage=data.get("usage", {}) or {},
                    finish_reason=choice.get("finish_reason", "") or "",
                    model=data.get("model", self.model),
                    latency_s=round(latency, 3),
                )
            except (httpx.TimeoutException, httpx.HTTPStatusError, httpx.NetworkError) as e:
                last_err = e
                if attempt >= max_retries:
                    break
                time.sleep(backoff**attempt)
        raise MiniMaxError(f"chat failed after {max_retries+1} attempts: {last_err}")

    def chat_json(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int = 2048,
        temperature: float = 0.1,
        max_retries: int = 4,
    ) -> tuple[dict[str, Any], ChatResult]:
        """Chat and parse content as JSON. Tolerant: salvages malformed/truncated JSON via json-repair."""
        result = self.chat(messages, max_tokens=max_tokens, temperature=temperature, max_retries=max_retries)
        text = result.content.strip()
        # Try direct parse first
        try:
            return json.loads(text), result
        except json.JSONDecodeError:
            pass
        # Try to extract a fenced ```json block
        fence = re.search(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", text, re.S | re.I)
        if fence:
            candidate = fence.group(1)
            try:
                return json.loads(candidate), result
            except json.JSONDecodeError:
                pass
        # Greedy slice between first { and last }
        start, end = text.find("{"), text.rfind("}")
        candidate = text[start : end + 1] if (start != -1 and end > start) else text
        try:
            return json.loads(candidate), result
        except json.JSONDecodeError:
            pass
        # Last resort: json-repair (handles truncation, stray quotes, swapped brackets)
        try:
            import json_repair  # type: ignore[import-untyped]
        except ImportError:
            raise MiniMaxJSONError(f"could not parse JSON from response (len={len(text)})", raw=text) from None
        try:
            repaired = json_repair.loads(candidate)
            if isinstance(repaired, dict):
                return repaired, result
            raise MiniMaxJSONError(f"repaired JSON is not an object (got {type(repaired).__name__})", raw=text)
        except Exception as e:
            raise MiniMaxJSONError(f"json-repair failed: {e}", raw=text) from e
