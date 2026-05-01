"""Fetch cybersecurity paper abstracts from arXiv cs.CR and IACR ePrint.

Outputs:
  manifest.jsonl    one JSON record per paper (canonical data)
  papers.md         human-readable list grouped by source
  ranked.md         top-N ranked by relevance heuristic
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

OUT_DIR = Path(__file__).parent / "2026-04-17_to_2026-04-30"
START = date(2026, 4, 17)
END = date(2026, 4, 30)

ARXIV_API = "http://export.arxiv.org/api/query"
ARXIV_NS = {"a": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}
IACR_LISTING = "https://eprint.iacr.org/{year}/"

UA = "ai-ideator-cybersec-fetch/0.1 (mailto:modernwinds@gmail.com)"


def http_get(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch_arxiv() -> list[dict]:
    """arXiv API: cat:cs.CR within submittedDate range, paginated."""
    papers: list[dict] = []
    start = 0
    page_size = 200
    q = (
        f"cat:cs.CR AND submittedDate:["
        f"{START.strftime('%Y%m%d')}0000 TO {END.strftime('%Y%m%d')}2359]"
    )
    while True:
        params = {
            "search_query": q,
            "start": str(start),
            "max_results": str(page_size),
            "sortBy": "submittedDate",
            "sortOrder": "descending",
        }
        url = f"{ARXIV_API}?{urllib.parse.urlencode(params)}"
        print(f"[arxiv] page start={start}", file=sys.stderr)
        body = http_get(url)
        root = ET.fromstring(body)
        entries = root.findall("a:entry", ARXIV_NS)
        if not entries:
            break
        for e in entries:
            arxiv_id = (e.findtext("a:id", "", ARXIV_NS) or "").rsplit("/", 1)[-1]
            title = re.sub(r"\s+", " ", (e.findtext("a:title", "", ARXIV_NS) or "")).strip()
            summary = re.sub(r"\s+", " ", (e.findtext("a:summary", "", ARXIV_NS) or "")).strip()
            published = e.findtext("a:published", "", ARXIV_NS) or ""
            updated = e.findtext("a:updated", "", ARXIV_NS) or ""
            authors = [
                (a.findtext("a:name", "", ARXIV_NS) or "").strip()
                for a in e.findall("a:author", ARXIV_NS)
            ]
            cats = [c.attrib.get("term", "") for c in e.findall("a:category", ARXIV_NS)]
            primary = e.find("arxiv:primary_category", ARXIV_NS)
            primary_cat = primary.attrib.get("term", "") if primary is not None else ""
            comment = (e.findtext("arxiv:comment", "", ARXIV_NS) or "").strip()
            papers.append(
                {
                    "source": "arxiv",
                    "id": arxiv_id,
                    "url": f"https://arxiv.org/abs/{arxiv_id}",
                    "title": title,
                    "abstract": summary,
                    "authors": authors,
                    "primary_category": primary_cat,
                    "categories": cats,
                    "published": published,
                    "updated": updated,
                    "comment": comment,
                }
            )
        if len(entries) < page_size:
            break
        start += page_size
        time.sleep(3.1)  # arXiv rate limit
    return papers


def fetch_iacr() -> list[dict]:
    """IACR ePrint year listing, filter by publish date.

    Block pattern (one paper):
      <a href="/2026/NNN">2026/NNN</a> ... <small>Last updated:&nbsp; YYYY-MM-DD</small>
      <div class="papertitle">TITLE</div>
      ... category-XXX">CATNAME</small>
      <div class="summaryauthors">A, B, and C</div>
      <div id="abstract-2026-NNN" class="paper-abstract">ABSTRACT</div>
    """
    year = START.year
    url = IACR_LISTING.format(year=year)
    print(f"[iacr] fetching {url}", file=sys.stderr)
    html = http_get(url).decode("utf-8", errors="replace")

    # Anchor on the paper ID link, slice each block to the next ID link.
    id_iter = list(
        re.finditer(r'<a href="/(\d{4}/\d{3,5})">(\d{4}/\d{3,5})</a>', html)
    )
    papers: list[dict] = []
    for i, m in enumerate(id_iter):
        pid = m.group(1)
        start_idx = m.start()
        end_idx = id_iter[i + 1].start() if i + 1 < len(id_iter) else len(html)
        block = html[start_idx:end_idx]

        m_date = re.search(r"Last updated:&nbsp;\s*(\d{4}-\d{2}-\d{2})", block)
        pub_date = m_date.group(1) if m_date else ""
        if not pub_date:
            continue
        try:
            d = datetime.strptime(pub_date, "%Y-%m-%d").date()
        except ValueError:
            continue
        if not (START <= d <= END):
            continue

        m_title = re.search(r'<div class="papertitle">(.*?)</div>', block, re.S)
        title = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m_title.group(1))).strip() if m_title else ""

        m_auth = re.search(r'<div class="summaryauthors">(.*?)</div>', block, re.S)
        authors: list[str] = []
        if m_auth:
            raw = re.sub(r"<[^>]+>", "", m_auth.group(1)).strip()
            raw = re.sub(r",?\s+and\s+", ",", raw)
            authors = [a.strip() for a in raw.split(",") if a.strip()]

        m_abs = re.search(r'<div id="abstract-[^"]+" class="paper-abstract">(.*?)</div>', block, re.S)
        abstract = ""
        if m_abs:
            abstract = re.sub(r"<[^>]+>", " ", m_abs.group(1))
            abstract = re.sub(r"\s+", " ", abstract).strip()

        m_cat = re.search(r'category category-([A-Z]+)">([^<]+)</small>', block)
        category = m_cat.group(2).strip() if m_cat else ""

        papers.append(
            {
                "source": "iacr",
                "id": pid,
                "url": f"https://eprint.iacr.org/{pid}",
                "title": title,
                "abstract": abstract,
                "authors": authors,
                "primary_category": category or "cryptography",
                "categories": ["cs.CR", "crypto"] + ([category] if category else []),
                "published": pub_date,
                "updated": pub_date,
                "comment": "",
            }
        )
    return papers


# Relevance heuristic — no LLM. Signals:
#   1. Cross-listing count (>1 cs.* category suggests broader interest)
#   2. Abstract length (>500 chars suggests substantive write-up)
#   3. Author count (collaboration signal, but capped to avoid huge consortia)
#   4. Title keyword score (high-impact security topics)
#   5. Comment field mentions venue acceptance (USENIX/CCS/NDSS/Oakland/Eurocrypt/Crypto)
#
# These are crude but interpretable. User can re-rank with an LLM later.

HOT_KEYWORDS = {
    # AI security & ML
    "llm": 3, "large language model": 3, "prompt injection": 4, "jailbreak": 4,
    "adversarial": 2, "model stealing": 3, "deepfake": 2, "rag": 2, "agent": 2,
    "ai safety": 3, "ml security": 3, "federated": 2,
    # Crypto
    "post-quantum": 3, "zero-knowledge": 3, "zk": 2, "snark": 3, "stark": 2,
    "homomorphic": 2, "lattice": 2, "mpc": 2, "threshold": 2,
    # Systems / offensive
    "supply chain": 4, "side channel": 3, "spectre": 3, "rowhammer": 3,
    "kernel": 2, "firmware": 2, "fuzzing": 2, "rop": 2, "uaf": 2,
    "vulnerability": 1, "0-day": 4, "zero-day": 4, "cve": 1, "exploit": 2,
    # Network / web
    "tls": 1, "dns": 1, "bgp": 2, "tor": 2, "smtp": 1,
    "phishing": 2, "ransomware": 3, "apt": 2, "c2": 2, "malware": 1,
    # Privacy
    "differential privacy": 3, "anonymity": 2, "metadata": 1,
    # Formal
    "formal verification": 2, "model checking": 1, "smt": 1,
    # Hot venues
    "usenix": 3, "ccs": 3, "ndss": 3, "s&p": 3, "oakland": 3,
    "eurocrypt": 3, "crypto 2026": 2, "asiacrypt": 2,
}


def score_paper(p: dict) -> tuple[float, dict]:
    breakdown = {}
    score = 0.0

    cats = p.get("categories", [])
    cs_cats = [c for c in cats if c.startswith("cs.")]
    cross = max(0, len(cs_cats) - 1)
    breakdown["cross_listing"] = cross * 1.5
    score += breakdown["cross_listing"]

    abs_len = len(p.get("abstract", ""))
    if abs_len > 1500:
        breakdown["abstract_len"] = 3
    elif abs_len > 800:
        breakdown["abstract_len"] = 2
    elif abs_len > 400:
        breakdown["abstract_len"] = 1
    else:
        breakdown["abstract_len"] = 0
    score += breakdown["abstract_len"]

    authors = len(p.get("authors", []))
    if 3 <= authors <= 10:
        breakdown["author_count"] = 1
    else:
        breakdown["author_count"] = 0
    score += breakdown["author_count"]

    text = (p.get("title", "") + " " + p.get("abstract", "") + " " + p.get("comment", "")).lower()
    kw_score = 0
    matched = []
    for kw, w in HOT_KEYWORDS.items():
        # Word-boundary match avoids "rop" hitting "Europe", "tor" hitting "tutor", etc.
        pattern = r"(?<![a-z0-9])" + re.escape(kw) + r"(?![a-z0-9])"
        if re.search(pattern, text):
            kw_score += w
            matched.append(kw)
    breakdown["keywords"] = kw_score
    breakdown["matched_keywords"] = matched
    score += kw_score

    comment = p.get("comment", "").lower()
    venue_hit = any(v in comment for v in ("usenix", "ccs", "ndss", "s&p", "oakland", "eurocrypt", "asiacrypt"))
    breakdown["venue_acceptance"] = 4 if venue_hit else 0
    score += breakdown["venue_acceptance"]

    return score, breakdown


def write_outputs(papers: list[dict]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    scored = []
    for p in papers:
        s, br = score_paper(p)
        p2 = {**p, "relevance_score": round(s, 2), "score_breakdown": br}
        scored.append(p2)
    scored.sort(key=lambda x: x["relevance_score"], reverse=True)

    with (OUT_DIR / "manifest.jsonl").open("w", encoding="utf-8") as f:
        for p in scored:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")

    by_source: dict[str, list[dict]] = {}
    for p in scored:
        by_source.setdefault(p["source"], []).append(p)

    with (OUT_DIR / "papers.md").open("w", encoding="utf-8") as f:
        f.write(f"# Cybersecurity papers — {START} to {END}\n\n")
        f.write(f"Total: **{len(scored)}** papers across {len(by_source)} source(s).\n\n")
        for src, items in by_source.items():
            f.write(f"## {src} ({len(items)})\n\n")
            for p in items:
                f.write(f"### [{p['title']}]({p['url']})\n")
                f.write(f"- **id:** `{p['id']}`  ")
                f.write(f"**date:** {p.get('published','')[:10]}  ")
                f.write(f"**cat:** {p.get('primary_category','')}  ")
                f.write(f"**score:** {p['relevance_score']}\n")
                if p.get("authors"):
                    auth = ", ".join(p["authors"][:6])
                    if len(p["authors"]) > 6:
                        auth += f", +{len(p['authors'])-6} more"
                    f.write(f"- **authors:** {auth}\n")
                if p.get("comment"):
                    f.write(f"- **note:** {p['comment']}\n")
                if p.get("abstract"):
                    f.write(f"\n> {p['abstract']}\n\n")
                f.write("\n")

    with (OUT_DIR / "ranked.md").open("w", encoding="utf-8") as f:
        f.write(f"# Top-ranked cybersecurity papers — {START} to {END}\n\n")
        f.write("Ranked by heuristic (cross-listing, abstract substance, hot-topic keywords, venue acceptance). ")
        f.write("Crude but interpretable — see `score_breakdown` in `manifest.jsonl` for the why.\n\n")
        top = scored[: min(150, len(scored))]
        for i, p in enumerate(top, 1):
            f.write(f"## {i}. [{p['title']}]({p['url']})  \n")
            f.write(f"`{p['source']}:{p['id']}` · score **{p['relevance_score']}** · ")
            f.write(f"matched: {', '.join(p['score_breakdown'].get('matched_keywords', [])) or '—'}\n\n")
            if p.get("abstract"):
                f.write(f"> {p['abstract']}\n\n")

    print(f"\nDone. {len(scored)} papers written to {OUT_DIR}/", file=sys.stderr)
    for src, items in by_source.items():
        print(f"  {src}: {len(items)}", file=sys.stderr)


def main() -> None:
    all_papers: list[dict] = []
    try:
        all_papers.extend(fetch_arxiv())
    except Exception as e:
        print(f"[arxiv] FAILED: {e}", file=sys.stderr)
    try:
        all_papers.extend(fetch_iacr())
    except Exception as e:
        print(f"[iacr] FAILED: {e}", file=sys.stderr)

    if not all_papers:
        print("No papers fetched. Aborting.", file=sys.stderr)
        sys.exit(1)
    write_outputs(all_papers)


if __name__ == "__main__":
    main()
