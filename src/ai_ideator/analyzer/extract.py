"""PDF download + text extraction.

- Downloads PDFs from arXiv / IACR with simple parallelism + politeness gap
- Extracts plaintext via pymupdf
- Trims references / appendix tail to keep token cost down
"""
from __future__ import annotations

import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

import httpx
import pymupdf  # PyMuPDF

UA = "ai-ideator-cybersec-analyzer/0.1 (mailto:modernwinds@gmail.com)"


def pdf_urls_for(source: str, paper_id: str) -> list[str]:
    """Return candidate PDF URLs in preference order. We try each in turn."""
    if source == "arxiv":
        urls = [f"https://arxiv.org/pdf/{paper_id}.pdf"]
        # Version-stripping fallback: arxiv 2604.17238v2 → 2604.17238 (latest)
        m = re.match(r"(.+?)v\d+$", paper_id)
        if m:
            urls.append(f"https://arxiv.org/pdf/{m.group(1)}.pdf")
        # Mirror at export.arxiv.org
        urls.append(f"https://export.arxiv.org/pdf/{paper_id}.pdf")
        return urls
    if source == "iacr":
        # paper_id is like "2026/822"
        return [
            f"https://eprint.iacr.org/{paper_id}.pdf",
            f"https://eprint.iacr.org/archive/{paper_id}.pdf",
        ]
    raise ValueError(f"unknown source: {source}")


def pdf_url_for(source: str, paper_id: str) -> str:
    """Single-URL helper kept for backwards compatibility."""
    return pdf_urls_for(source, paper_id)[0]


def safe_filename(source: str, paper_id: str) -> str:
    return f"{source}__{paper_id.replace('/', '_')}.pdf"


@dataclass
class DownloadResult:
    paper_id: str
    source: str
    path: Path | None
    bytes: int
    error: str = ""


def download_pdfs(
    papers: list[dict],
    out_dir: Path,
    *,
    workers: int = 6,
    politeness_s: float = 0.0,
    timeout: float = 90.0,
) -> list[DownloadResult]:
    out_dir.mkdir(parents=True, exist_ok=True)
    results: list[DownloadResult] = []

    def _fetch(p: dict) -> DownloadResult:
        src, pid = p["source"], p["id"]
        out_path = out_dir / safe_filename(src, pid)
        if out_path.exists() and out_path.stat().st_size > 1024:
            return DownloadResult(pid, src, out_path, out_path.stat().st_size)
        urls = pdf_urls_for(src, pid)
        last_err = ""
        for url in urls:
            try:
                with httpx.Client(timeout=timeout, headers={"User-Agent": UA}, follow_redirects=True) as c:
                    r = c.get(url)
                if r.status_code != 200:
                    last_err = f"HTTP {r.status_code} @ {url}"
                    continue
                data = r.content
                if len(data) < 1024 or not data[:4] == b"%PDF":
                    last_err = f"not a PDF @ {url}"
                    continue
                out_path.write_bytes(data)
                if politeness_s:
                    time.sleep(politeness_s)
                return DownloadResult(pid, src, out_path, len(data))
            except Exception as e:
                last_err = f"{type(e).__name__}: {e} @ {url}"
                continue
        return DownloadResult(pid, src, None, 0, error=last_err or "all candidate URLs failed")

    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = [ex.submit(_fetch, p) for p in papers]
        for fut in as_completed(futures):
            results.append(fut.result())
    return results


# Drop noisy tail sections that are usually low-value for analysis.
_TAIL_HEADERS = re.compile(
    r"^(references|bibliography|acknowledg(e?ments?)|appendix|appendices|supplementary material)\b",
    re.I | re.M,
)


def extract_text(pdf_path: Path, *, max_chars: int = 200_000) -> str:
    doc = pymupdf.open(pdf_path)
    pages = []
    try:
        for page in doc:
            pages.append(page.get_text("text"))
    finally:
        doc.close()
    text = "\n".join(pages)
    # Normalize whitespace
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Trim tail at first 'References' / 'Appendix' header
    m = _TAIL_HEADERS.search(text)
    if m and m.start() > 1500:
        text = text[: m.start()].rstrip()
    if len(text) > max_chars:
        # Keep head (intro/methods) + tail (results/conclusion) — drop middle
        head = text[: int(max_chars * 0.65)]
        tail = text[-int(max_chars * 0.30) :]
        text = head + "\n\n[…middle truncated for length…]\n\n" + tail
    return text.strip()
