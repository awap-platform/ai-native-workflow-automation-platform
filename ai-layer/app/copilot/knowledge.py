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
MAX_SNIPPET_CHARS = 320
MAX_SUMMARY_CHARS = 1_200
MAX_SOURCES = 3

_UNTRUSTED_MARKERS = (
    "ignore previous",
    "disregard previous",
    "system prompt",
    "reveal your instructions",
    "you are now",
    "jailbreak",
    "developer mode",
)
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+")

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


@dataclass(frozen=True)
class KnowledgeSummary:
    """Deterministic, bounded summary with explicit source citations."""

    answer: str
    citations: list[str]
    document_ids: list[str]
    chunk_refs: list[str]
    truncated: bool


def neutralize_untrusted(text: str) -> str:
    """Treat retrieved document text as data: strip known instruction-like sentences."""
    normalized = (text or "").strip()
    if not normalized:
        return ""
    sentences = _SENTENCE_BOUNDARY.split(normalized)
    safe = [
        sentence
        for sentence in sentences
        if not any(marker in sentence.lower() for marker in _UNTRUSTED_MARKERS)
    ]
    if len(safe) != len(sentences):
        safe.append("[untrusted instruction removed]")
    return " ".join(safe)


def build_summary_prompt(hits: Iterable[Any], query: str) -> str:
    """Build the grounded prompt used by the deterministic summarizer.

    Only tenant hits returned by the backend are included; callers must pass the tenant-filtered
    result set. This function is exposed so tests can assert no foreign or instruction-bearing
    content enters the prompt.
    """
    lines = []
    for index, hit in enumerate(hits or [], start=1):
        if not isinstance(hit, dict):
            continue
        title = neutralize_untrusted(str(hit.get("title") or hit.get("fileId", "document")))
        snippet = neutralize_untrusted(str(hit.get("snippet") or ""))[:MAX_SNIPPET_CHARS]
        chunk = hit.get("chunkIndex", 0)
        lines.append(f"[{index}] {title} (chunk {chunk}): {snippet}")
    return f"Query: {query}\nAnswer only from these tenant chunks:\n" + "\n".join(lines)


def summarize_hits(
    hits: Iterable[Any] | None, query: str, max_sources: int = MAX_SOURCES
) -> KnowledgeSummary:
    """Summarize the top tenant chunks and cite every source.

    The summary is deterministic and bounded: snippets are truncated, injection-like sentences are
    removed, and the final answer never exceeds ``MAX_SUMMARY_CHARS``. An empty hit set returns an
    empty summary; the no-answer guard remains authoritative for user-facing wording.
    """
    usable = [hit for hit in (hits or []) if isinstance(hit, dict)]
    usable.sort(key=lambda hit: float(hit.get("score", 0.0) or 0.0), reverse=True)
    selected = usable[: max(1, max_sources)]
    lines: list[str] = []
    citations: list[str] = []
    document_ids: list[str] = []
    chunk_refs: list[str] = []
    source_truncated = False
    for index, hit in enumerate(selected, start=1):
        file_id = str(hit.get("fileId") or hit.get("id") or f"document-{index}")
        title = neutralize_untrusted(str(hit.get("title") or file_id))
        raw_snippet = str(hit.get("snippet") or "")
        if len(raw_snippet) > MAX_SNIPPET_CHARS:
            source_truncated = True
        snippet = neutralize_untrusted(raw_snippet)[:MAX_SNIPPET_CHARS]
        chunk = hit.get("chunkIndex", 0)
        if snippet:
            lines.append(f"- {title}: {snippet}")
        citations.append(f"[{index}] {title} ({file_id}, chunk {chunk})")
        if file_id not in document_ids:
            document_ids.append(file_id)
        chunk_refs.append(f"{file_id}#{chunk}")
    body = "\n".join(lines) if lines else "The retrieved chunks contained no usable text."
    answer = f"Grounded summary from your tenant documents:\n{body}\nSources:\n" + "\n".join(
        citations
    )
    truncated = source_truncated or len(answer) > MAX_SUMMARY_CHARS
    if len(answer) > MAX_SUMMARY_CHARS:
        answer = answer[:MAX_SUMMARY_CHARS].rstrip() + "…"
    return KnowledgeSummary(
        answer=answer,
        citations=citations,
        document_ids=document_ids,
        chunk_refs=chunk_refs,
        truncated=truncated,
    )
