"""Retrieval evaluation for the knowledge no-answer guard (issue #281).

The fixture contains relevant, irrelevant and ambiguous questions with the hits the backend would
return. The evaluator reports both answer-level Precision/Recall (did the guard answer when it
should?) and document-level Precision/Recall (were the returned documents the expected ones?).
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.copilot.knowledge import (
    DEFAULT_MIN_HITS,
    DEFAULT_MIN_SCORE,
    SUCCESS,
    assess_hits,
)

GATE_PRECISION = 0.85
GATE_RECALL = 0.85

EXIT_OK = 0
EXIT_GATE_FAILED = 1
EXIT_INVALID = 2


class RetrievalFixtureError(ValueError):
    """Raised when the retrieval fixture is invalid."""


@dataclass(frozen=True)
class RetrievalQuery:
    id: str
    locale: str
    query: str
    expect_answer: bool
    expected_file_ids: tuple[str, ...]
    returned: tuple[dict[str, Any], ...]


def load_fixture(path: str | Path) -> list[RetrievalQuery]:
    fixture_path = Path(path)
    if not fixture_path.is_file():
        raise RetrievalFixtureError(f"Retrieval fixture not found: {fixture_path}")
    try:
        payload = json.loads(fixture_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as ex:
        raise RetrievalFixtureError(f"Retrieval fixture is not valid JSON: {ex.msg}.") from ex
    raw_queries = payload.get("queries") if isinstance(payload, dict) else None
    if not isinstance(raw_queries, list) or not raw_queries:
        raise RetrievalFixtureError("Retrieval fixture must contain a non-empty 'queries' array.")
    queries: list[RetrievalQuery] = []
    seen: set[str] = set()
    for index, raw in enumerate(raw_queries, 1):
        where = f"queries[{index}]"
        if not isinstance(raw, dict):
            raise RetrievalFixtureError(f"{where}: each query must be a JSON object.")
        for field in ("id", "locale", "query"):
            if not isinstance(raw.get(field), str) or not raw[field].strip():
                raise RetrievalFixtureError(f"{where}: '{field}' must be a non-empty string.")
        if not isinstance(raw.get("expect_answer"), bool):
            raise RetrievalFixtureError(f"{where}: 'expect_answer' must be a boolean.")
        if raw["id"] in seen:
            raise RetrievalFixtureError(f"{where}: duplicate id '{raw['id']}'.")
        seen.add(raw["id"])
        expected = raw.get("expected_file_ids", [])
        returned = raw.get("returned", [])
        if not isinstance(expected, list) or not isinstance(returned, list):
            raise RetrievalFixtureError(
                f"{where}: 'expected_file_ids' and 'returned' must be arrays."
            )
        queries.append(
            RetrievalQuery(
                id=raw["id"],
                locale=raw["locale"],
                query=raw["query"].strip(),
                expect_answer=raw["expect_answer"],
                expected_file_ids=tuple(str(item) for item in expected),
                returned=tuple(item for item in returned if isinstance(item, dict)),
            )
        )
    return queries


def evaluate(
    queries: Sequence[RetrievalQuery],
    *,
    threshold: float = 0.7,
    min_score: float = DEFAULT_MIN_SCORE,
    min_hits: int = DEFAULT_MIN_HITS,
) -> dict[str, Any]:
    answer_tp = answer_fp = answer_fn = answer_tn = 0
    doc_tp = doc_fp = doc_fn = 0
    rows: list[dict[str, Any]] = []
    per_locale: dict[str, dict[str, int]] = {}

    for item in queries:
        assessment = assess_hits(
            item.returned,
            item.query,
            min_score=min_score,
            min_hits=min_hits,
            threshold=threshold,
        )
        answered = assessment.outcome == SUCCESS
        if answered and item.expect_answer:
            answer_tp += 1
            verdict = "TP"
        elif answered and not item.expect_answer:
            answer_fp += 1
            verdict = "FP"
        elif not answered and item.expect_answer:
            answer_fn += 1
            verdict = "FN"
        else:
            answer_tn += 1
            verdict = "TN"

        # Document Precision/Recall only applies when the guard actually answers: an explicit
        # NO_ANSWER/LOW_CONFIDENCE result discards the hits and must not be counted as retrieval.
        if answered:
            returned_ids = {str(hit.get("fileId")) for hit in item.returned if hit.get("fileId")}
            expected_ids = set(item.expected_file_ids)
            doc_tp += len(returned_ids & expected_ids)
            doc_fp += len(returned_ids - expected_ids)
            doc_fn += len(expected_ids - returned_ids)

        bucket = per_locale.setdefault(item.locale, {"tp": 0, "fp": 0, "fn": 0, "tn": 0})
        bucket[verdict.lower()] += 1
        rows.append(
            {
                "id": item.id,
                "locale": item.locale,
                "expected_answer": item.expect_answer,
                "answered": answered,
                "outcome": assessment.outcome,
                "confidence": assessment.confidence,
                "verdict": verdict,
            }
        )

    answer_precision = _ratio(answer_tp, answer_tp + answer_fp)
    answer_recall = _ratio(answer_tp, answer_tp + answer_fn)
    doc_precision = _ratio(doc_tp, doc_tp + doc_fp)
    doc_recall = _ratio(doc_tp, doc_tp + doc_fn)

    slices: dict[str, Any] = {}
    for locale, counts in sorted(per_locale.items()):
        slices[locale] = {
            "answer_precision": _ratio(counts["tp"], counts["tp"] + counts["fp"]),
            "answer_recall": _ratio(counts["tp"], counts["tp"] + counts["fn"]),
            "support": counts["tp"] + counts["fp"] + counts["fn"] + counts["tn"],
        }

    violations = []
    if answer_precision < GATE_PRECISION:
        violations.append(f"answer precision {answer_precision:.3f} < {GATE_PRECISION:.2f}")
    if answer_recall < GATE_RECALL:
        violations.append(f"answer recall {answer_recall:.3f} < {GATE_RECALL:.2f}")
    if doc_precision < GATE_PRECISION:
        violations.append(f"document precision {doc_precision:.3f} < {GATE_PRECISION:.2f}")
    if doc_recall < GATE_RECALL:
        violations.append(f"document recall {doc_recall:.3f} < {GATE_RECALL:.2f}")
    for locale, metrics in slices.items():
        if metrics["support"] < 2:
            continue
        if metrics["answer_precision"] < GATE_PRECISION:
            violations.append(f"slice {locale} answer precision below gate")
        if metrics["answer_recall"] < GATE_RECALL:
            violations.append(f"slice {locale} answer recall below gate")

    return {
        "threshold": threshold,
        "count": len(queries),
        "answer": {
            "tp": answer_tp,
            "fp": answer_fp,
            "fn": answer_fn,
            "tn": answer_tn,
            "precision": round(answer_precision, 6),
            "recall": round(answer_recall, 6),
        },
        "documents": {
            "tp": doc_tp,
            "fp": doc_fp,
            "fn": doc_fn,
            "precision": round(doc_precision, 6),
            "recall": round(doc_recall, 6),
        },
        "slices": slices,
        "queries": rows,
        "gate": {"passed": not violations, "violations": violations},
    }


def _ratio(numerator: int, denominator: int) -> float:
    return 1.0 if denominator == 0 else numerator / denominator


def run(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", default="eval/knowledge_retrieval.v1.json")
    parser.add_argument("--threshold", type=float, default=0.7)
    parser.add_argument("--gate", action="store_true")
    args = parser.parse_args(argv)

    try:
        queries = load_fixture(args.fixture)
    except RetrievalFixtureError as ex:
        print(f"INVALID RETRIEVAL FIXTURE: {ex}", file=sys.stderr)
        return EXIT_INVALID

    report = evaluate(queries, threshold=args.threshold)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    if args.gate and not report["gate"]["passed"]:
        for violation in report["gate"]["violations"]:
            print(f"RETRIEVAL GATE FAILED: {violation}", file=sys.stderr)
        return EXIT_GATE_FAILED
    print("Retrieval gate passed.")
    return EXIT_OK


def main() -> None:
    raise SystemExit(run())


if __name__ == "__main__":
    main()
