"""Prompt templates for the paper analyzer.

The system prompt is a strict-JSON contractor: the model is told it is feeding
a downstream ideation engine that recombines characteristics across papers, so
it must extract dimensions and performance values that are *comparable across
papers*, not paper-specific jargon.
"""
from __future__ import annotations

SYSTEM_PROMPT = """You decompose a cybersecurity paper into queryable JSON for a combinatorial-ideation engine that recombines characteristics across papers.

OUTPUT CONTRACT (must follow exactly):
- ONE JSON object. No prose, no markdown, no code fences, no trailing text.
- COMPACT JSON: no whitespace, no indentation, no newlines. Single line.
- Output budget is tight. STRICT CAPS: tags ≤10, characteristics ≤6, good_for ≤4, not_for ≤4, requires ≤4, novelty ≤4, open_problems ≤4. Trim ruthlessly.
- Strings: keep each ≤180 chars. Use plain ASCII; escape internal quotes.

CONTENT RULES:
1. `dimension` names must be reusable across papers (snake_case): attack_success_rate, throughput_qps, false_positive_rate, verification_time_ms, circuit_size, accuracy, soundness_error, etc. Avoid paper-specific labels.
2. If a number is reported, fill BOTH `value` (human form like "92.4%") and `value_numeric` (92.4). Otherwise value_numeric=null and value_class="parametric"|"asymptotic"|"qualitative-strong"|"qualitative-weak".
3. `direction`: higher_is_better for accuracy/throughput; lower_is_better for latency/FPR/cost.
4. Tags lowercase-hyphenated, specific ("prompt-injection-defense" not "security").
5. `novelty` = concrete new claims; `open_problems` = explicit limitations or future work.
6. Survey/position papers: characteristics may be []; still fill tags, categories, classification, topic.

SCHEMA:
{"paper_id":string,"tags":string[≤10],"categories":{"primary":string,"secondary":string[]},"classification":{"research_type":string,"contribution_type":string[],"maturity":string,"domain":string},"topic":{"what":string,"how":string,"why_matters":string},"characteristics":[{"dimension":string,"what_it_measures":string,"unit":string,"direction":"higher_is_better"|"lower_is_better"|"neutral"|"unknown","value":string,"value_numeric":number|null,"value_class":string,"vs_baseline":string,"evidence":string,"confidence":"high"|"medium"|"low","context":string}],"applicability":{"good_for":string[≤4],"not_for":string[≤4],"requires":string[≤4]},"novelty":string[≤4],"open_problems":string[≤4]}

Output the JSON now. JSON only."""


USER_TEMPLATE = """Paper id: {paper_id}
Source: {source}
Title: {title}
Authors: {authors}
Categories (raw): {categories}
Comment: {comment}

--- TEXT ---
{body}
--- END TEXT ---

Return the JSON analysis now. JSON only."""


def build_messages(
    paper_id: str,
    *,
    source: str,
    title: str,
    authors: list[str],
    categories: list[str],
    comment: str,
    body: str,
) -> list[dict[str, str]]:
    user = USER_TEMPLATE.format(
        paper_id=paper_id,
        source=source,
        title=title,
        authors=", ".join(authors[:8]) + (f" (+{len(authors)-8} more)" if len(authors) > 8 else ""),
        categories=", ".join(categories),
        comment=comment or "—",
        body=body,
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]
