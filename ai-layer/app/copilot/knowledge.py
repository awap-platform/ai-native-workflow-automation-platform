"""Knowledge-search confidence and no-answer guard (issue #281 / C2, C12).

An empty OpenSearch result must never become a confident factual answer. This module turns the raw
hits into an explicit assessment: ``SUCCESS``, ``LOW_CONFIDENCE``, ``NO_ANSWER`` or
``SEARCH_UNAVAILABLE``. The assessment is server-side and deterministic, so a model cannot ignore a
low-confidence instruction.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

DEFAULT_MIN_SCORE = 0.35
DEFAULT_MIN_HITS = 1

SUCCESS = "SUCCESS"
NO_ANSWER = "NO_ANSWER"
LOW_CONFIDENCE = "LOW_CONFIDENCE"
SEARCH_UNAVAILABLE = "SEARCH_UNAVAILABLE"

_TOKEN_SPLIT = re.compile(r"[^\w]+", re.UNICODE)


@dataclass(frozen=True)
class KnowledgeAssessment:
    """Server-side decision for one knowledge-search result set."""

    confidence: float
    outcome: str
    relevant_hits: int
    top_score: float


def _tokens(text: str) -> set[str]:
    return {token for token in _TOKEN_SPLIT.split((text or "").lower()) if len(token) > 2}


def assess_hits(
    hits: Iterable[Any] | None,
    query: str,
    *,
    min_score: float = DEFAULT_MIN_SCORE,
    min_hits: int = DEFAULT_MIN_HITS,
    threshold: float = 0.7,
) -> KnowledgeAssessment:
    """Compute confidence from hit count, score threshold and snippet relevance."""
    usable = [hit for hit in (hits or []) if isinstance(hit, dict)]
    if not usable:
        return KnowledgeAssessment(
            confidence=0.0, outcome=NO_ANSWER, relevant_hits=0, top_score=0.0
        )

    scores = []
    for hit in usable:
        try:
            scores.append(float(hit.get("score", 0.0) or 0.0))
        except TypeError, ValueError:
            scores.append(0.0)
    top_score = max(scores) if scores else 0.0

    query_tokens = _tokens(query)
    relevant = 0
    if query_tokens:
        for hit in usable:
            haystack = f"{hit.get('title', '')} {hit.get('snippet', '')}".lower()
            if any(token in haystack for token in query_tokens):
                relevant += 1
    else:  # nothing to match on; rely on the score alone
        relevant = len(usable)

    score_confidence = min(top_score / max(min_score * 2, 1e-6), 1.0)
    hit_confidence = min(len(usable) / max(min_hits, 1), 1.0)
    relevance_confidence = relevant / len(usable)
    confidence = 0.5 * score_confidence + 0.25 * hit_confidence + 0.25 * relevance_confidence
    if top_score < min_score:
        confidence *= 0.5
    if len(usable) < max(min_hits, 1):
        confidence *= 0.5
    if relevant == 0:
        confidence = min(confidence, 0.3)
    confidence = round(max(0.0, min(confidence, 0.99)), 4)

    if relevant == 0:
        outcome = NO_ANSWER
    elif confidence < threshold:
        outcome = LOW_CONFIDENCE
    else:
        outcome = SUCCESS
    return KnowledgeAssessment(
        confidence=confidence, outcome=outcome, relevant_hits=relevant, top_score=top_score
    )


def unavailable() -> KnowledgeAssessment:
    """An OpenSearch/transport failure is not evidence that no document exists."""
    return KnowledgeAssessment(
        confidence=0.0, outcome=SEARCH_UNAVAILABLE, relevant_hits=0, top_score=0.0
    )
