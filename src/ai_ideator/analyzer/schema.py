"""Schema for paper analyses produced by MiniMax M2.7.

Design notes:
- `characteristics` is the queryable spine. Each item is one *dimension* that
  the paper exposes (e.g. "throughput", "false-positive-rate", "circuit-size").
- A characteristic always has a `value` (free-form string for fidelity) and a
  `value_numeric` when extractable, with `unit` and `direction` so we can rank.
- We intentionally let the model pick dimension *names* freely. A separate
  canonicalization pass clusters synonyms (throughput/speed → canonical) so
  cross-paper queries work.
- Everything is optional except paper_id + at least one characteristic, so
  imperfect outputs still flow through the index.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Direction = Literal["higher_is_better", "lower_is_better", "neutral", "unknown"]
Confidence = Literal["high", "medium", "low"]
# Kept loose intentionally — papers blend categories ("theoretical+systems",
# "empirical+tool"). Canonicalization happens later in the index step.
ResearchType = str
ContributionType = str


class Characteristic(BaseModel):
    """One measurable dimension the paper exposes."""

    model_config = ConfigDict(extra="ignore")

    dimension: str = Field(..., description="Short canonical name, snake_case (e.g. 'attack_success_rate')")
    what_it_measures: str = Field("", description="One sentence: what this dimension represents")
    unit: str = Field("", description="Unit of measurement (%, ms, bits, queries, qubits, etc.) or '' if dimensionless")
    direction: Direction = "unknown"

    value: str = Field("", description="Best human-readable value as stated in the paper")
    value_numeric: float | None = Field(None, description="Numeric value if cleanly extractable")
    value_class: str = Field("", description="Bucket: 'numeric', 'parametric', 'qualitative-strong', 'qualitative-weak', 'asymptotic'")

    vs_baseline: str = Field("", description="Comparison statement (e.g. '12pp better than X', 'matches SOTA')")
    evidence: str = Field("", description="How the value is supported: 'theoretical proof', 'benchmark on N tasks', 'case study', etc.")
    confidence: Confidence = "medium"
    context: str = Field("", description="Conditions/scope: 'on Llama-3-8B', 'in honest-majority setting', etc.")

    # Tolerate the model emitting null/None for free-form string fields.
    @field_validator("what_it_measures", "unit", "value", "value_class", "vs_baseline", "evidence", "context", mode="before")
    @classmethod
    def _none_to_empty_str(cls, v: Any) -> Any:
        return "" if v is None else v

    @field_validator("direction", mode="before")
    @classmethod
    def _direction_default(cls, v: Any) -> Any:
        if v is None or v == "":
            return "unknown"
        return v

    @field_validator("confidence", mode="before")
    @classmethod
    def _confidence_default(cls, v: Any) -> Any:
        if v is None or v == "":
            return "medium"
        return v


class Topic(BaseModel):
    model_config = ConfigDict(extra="ignore")
    what: str = Field("", description="One sentence: what the paper does")
    how: str = Field("", description="One sentence: the technical mechanism")
    why_matters: str = Field("", description="One sentence: why a builder should care")

    @field_validator("what", "how", "why_matters", mode="before")
    @classmethod
    def _none_to_empty(cls, v: Any) -> Any:
        return "" if v is None else v


class Applicability(BaseModel):
    model_config = ConfigDict(extra="ignore")
    good_for: list[str] = Field(default_factory=list, description="Use cases where this approach shines")
    not_for: list[str] = Field(default_factory=list, description="Cases where it fails or is inappropriate")
    requires: list[str] = Field(default_factory=list, description="Preconditions / dependencies / assumptions")


class Classification(BaseModel):
    model_config = ConfigDict(extra="ignore")
    research_type: ResearchType = "other"
    contribution_type: list[ContributionType] = Field(default_factory=list)
    maturity: str = "unknown"  # loose; canonicalize in index step
    domain: str = Field("", description="Top-level subfield (e.g. 'AI security', 'cryptographic protocols', 'systems security')")

    @field_validator("research_type", "maturity", "domain", mode="before")
    @classmethod
    def _none_to_default(cls, v: Any) -> Any:
        return "" if v is None else v


class PaperAnalysis(BaseModel):
    """The full analysis record for one paper."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    # Identity
    paper_id: str = Field(..., description="Stable id, e.g. 'arxiv:2604.18697v1' or 'iacr:2026/822'")

    # Organizational metadata
    tags: list[str] = Field(default_factory=list, description="5-15 lowercase-hyphenated free-form tags")
    categories: dict[str, str | list[str]] = Field(
        default_factory=dict,
        description="{'primary': str, 'secondary': [str]}",
    )
    classification: Classification = Field(default_factory=Classification)

    # Substance
    topic: Topic = Field(default_factory=Topic)
    characteristics: list[Characteristic] = Field(default_factory=list)
    applicability: Applicability = Field(default_factory=Applicability)
    novelty: list[str] = Field(default_factory=list, description="Concrete novelty claims, max 5")
    open_problems: list[str] = Field(default_factory=list, description="Limitations or open questions")

    # Provenance (filled by the runner, not the model)
    meta: dict[str, str | int | float] = Field(default_factory=dict, alias="_meta")

    # Drop characteristics that are missing the only required field (dimension).
    @field_validator("characteristics", mode="before")
    @classmethod
    def _drop_invalid_chars(cls, v: Any) -> Any:
        if not isinstance(v, list):
            return []
        cleaned = []
        for c in v:
            if isinstance(c, dict) and (c.get("dimension") or "").strip():
                cleaned.append(c)
        return cleaned

    @field_validator("tags", "novelty", "open_problems", mode="before")
    @classmethod
    def _ensure_list(cls, v: Any) -> Any:
        if v is None:
            return []
        if isinstance(v, str):
            return [v]
        return v
