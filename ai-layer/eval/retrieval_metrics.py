"""Graded retrieval evaluation (issue #293).

Fixtures contain a query, a graded relevance map (`docId -> grade`) and the ranked document ids the
hybrid retriever returned. The evaluator reports Recall@k, Precision@k, MRR and nDCG@k and fails a
gate when any mean falls below its threshold.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

GATE_RECALL = 0.90
GATE_PRECISION = 0.60
GATE_MRR = 0.90
GATE_NDCG = 0.85

EXIT_OK = 0
EXIT_GATE_FAILED = 1
EXIT_INVALID = 2


class RetrievalMetricError(ValueError):
    """Raised when the graded fixture is invalid."""


@dataclass(frozen=True)
class GradedQuery:
    id: str
    query: str
    relevant: dict[str, int]
    returned: tuple[str, ...]


@dataclass(frozen=True)
class Metrics:
    recall: float
    precision: float
    mrr: float
    ndcg: float
    k: int

    def as_dict(self) -> dict[str, float | int]:
        return {
            "recall_at_k": round(self.recall, 6),
            "precision_at_k": round(self.precision, 6),
            "mrr": round(self.mrr, 6),
            "ndcg_at_k": round(self.ndcg, 6),
            "k": self.k,
        }


def recall_at_k(returned: Sequence[str], relevant: dict[str, int], k: int) -> float:
    relevant_ids = set(relevant)
    if not relevant_ids:
        raise RetrievalMetricError("each query needs at least one relevant document")
    if k <= 0:
        raise RetrievalMetricError("k must be positive")
    found = sum(1 for document in returned[:k] if document in relevant_ids)
    return found / len(relevant_ids)


def precision_at_k(returned: Sequence[str], relevant: dict[str, int], k: int) -> float:
    if k <= 0:
        raise RetrievalMetricError("k must be positive")
    return sum(1 for document in returned[:k] if document in relevant) / k


def reciprocal_rank(returned: Sequence[str], relevant: dict[str, int]) -> float:
    for rank, document in enumerate(returned, 1):
        if document in relevant:
            return 1.0 / rank
    return 0.0


def ndcg_at_k(returned: Sequence[str], relevant: dict[str, int], k: int) -> float:
    if k <= 0:
        raise RetrievalMetricError("k must be positive")
    dcg = sum(
        (2 ** relevant.get(document, 0) - 1) / math.log2(rank + 1)
        for rank, document in enumerate(returned[:k], 1)
    )
    ideal = sorted(relevant.values(), reverse=True)[:k]
    idcg = sum((2**grade - 1) / math.log2(rank + 1) for rank, grade in enumerate(ideal, 1))
    return dcg / idcg if idcg > 0 else 0.0


def evaluate(queries: Sequence[GradedQuery], k: int) -> Metrics:
    if not queries:
        raise RetrievalMetricError("at least one query is required")
    count = len(queries)
    return Metrics(
        recall=sum(recall_at_k(query.returned, query.relevant, k) for query in queries) / count,
        precision=sum(precision_at_k(query.returned, query.relevant, k) for query in queries)
        / count,
        mrr=sum(reciprocal_rank(query.returned, query.relevant) for query in queries) / count,
        ndcg=sum(ndcg_at_k(query.returned, query.relevant, k) for query in queries) / count,
        k=k,
    )


def gate_failures(metrics: Metrics) -> list[str]:
    failures = []
    for name, value, threshold in (
        ("recall_at_k", metrics.recall, GATE_RECALL),
        ("precision_at_k", metrics.precision, GATE_PRECISION),
        ("mrr", metrics.mrr, GATE_MRR),
        ("ndcg_at_k", metrics.ndcg, GATE_NDCG),
    ):
        if value < threshold:
            failures.append(f"{name}={value:.4f} is below the {threshold:.2f} gate")
    return failures


def load_fixture(path: str | Path) -> tuple[list[GradedQuery], int]:
    fixture_path = Path(path)
    if not fixture_path.is_file():
        raise RetrievalMetricError(f"Retrieval fixture not found: {fixture_path}")
    try:
        payload = json.loads(fixture_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as ex:
        raise RetrievalMetricError(f"Retrieval fixture is not valid JSON: {ex.msg}.") from ex
    raw_queries = payload.get("queries") if isinstance(payload, dict) else None
    k = payload.get("k", 5) if isinstance(payload, dict) else 5
    if not isinstance(raw_queries, list) or not raw_queries:
        raise RetrievalMetricError("Retrieval fixture must contain a non-empty 'queries' array.")
    if not isinstance(k, int) or k <= 0:
        raise RetrievalMetricError("'k' must be a positive integer.")
    queries: list[GradedQuery] = []
    seen: set[str] = set()
    for index, raw in enumerate(raw_queries, 1):
        where = f"queries[{index}]"
        if not isinstance(raw, dict):
            raise RetrievalMetricError(f"{where}: each query must be a JSON object.")
        for field in ("id", "query"):
            if not isinstance(raw.get(field), str) or not raw[field].strip():
                raise RetrievalMetricError(f"{where}: '{field}' must be a non-empty string.")
        if raw["id"] in seen:
            raise RetrievalMetricError(f"{where}: duplicate id '{raw['id']}'.")
        seen.add(raw["id"])
        relevant = raw.get("relevant")
        returned = raw.get("returned")
        if not isinstance(relevant, dict) or not relevant:
            raise RetrievalMetricError(f"{where}: 'relevant' must be a non-empty object.")
        for document, grade in relevant.items():
            if not isinstance(document, str) or not document:
                raise RetrievalMetricError(f"{where}: relevance keys must be document ids.")
            if not isinstance(grade, int) or grade <= 0:
                raise RetrievalMetricError(f"{where}: relevance grades must be positive integers.")
        if not isinstance(returned, list) or not all(
            isinstance(document, str) for document in returned
        ):
            raise RetrievalMetricError(f"{where}: 'returned' must be an array of document ids.")
        queries.append(
            GradedQuery(
                id=raw["id"],
                query=raw["query"],
                relevant=dict(relevant),
                returned=tuple(returned),
            )
        )
    return queries, k


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate graded knowledge retrieval metrics.")
    parser.add_argument("--fixture", required=True)
    parser.add_argument("--k", type=int, default=None)
    parser.add_argument("--gate", action="store_true")
    parser.add_argument("--output", default=None)
    args = parser.parse_args(argv)
    try:
        queries, fixture_k = load_fixture(args.fixture)
        k = args.k if args.k is not None else fixture_k
        metrics = evaluate(queries, k)
    except RetrievalMetricError as ex:
        print(f"INVALID: {ex}", file=sys.stderr)
        return EXIT_INVALID
    report = metrics.as_dict()
    if args.output:
        Path(args.output).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    if not args.gate:
        return EXIT_OK
    failures = gate_failures(metrics)
    if failures:
        for failure in failures:
            print(f"GATE FAILED: {failure}", file=sys.stderr)
        return EXIT_GATE_FAILED
    print("Retrieval gate passed.")
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
