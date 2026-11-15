"""Graded retrieval metrics and gate tests (issue #293)."""

from __future__ import annotations

import json

import pytest

from eval.retrieval_metrics import (
    EXIT_GATE_FAILED,
    EXIT_INVALID,
    EXIT_OK,
    GATE_NDCG,
    Metrics,
    RetrievalMetricError,
    evaluate,
    gate_failures,
    load_fixture,
    main,
    ndcg_at_k,
    precision_at_k,
    recall_at_k,
    reciprocal_rank,
)


def test_hand_computed_metrics_match_the_fixture() -> None:
    assert recall_at_k(["a", "x", "b"], {"a": 1, "b": 1}, 3) == 1.0
    assert recall_at_k(["a", "x", "b"], {"a": 1, "b": 1}, 1) == 0.5
    assert precision_at_k(["a", "x", "b"], {"a": 1, "b": 1}, 3) == pytest.approx(2 / 3)
    assert precision_at_k(["a", "x", "b"], {"a": 1, "b": 1}, 2) == 0.5
    assert reciprocal_rank(["x", "a"], {"a": 1}) == 0.5
    assert reciprocal_rank(["x", "y"], {"a": 1}) == 0.0
    assert ndcg_at_k(["a", "b"], {"a": 3, "b": 1}, 2) == pytest.approx(1.0)
    assert ndcg_at_k(["b", "a"], {"a": 3, "b": 1}, 2) == pytest.approx(0.7098, abs=1e-4)
    assert ndcg_at_k(["x"], {"a": 3}, 2) == 0.0


def test_the_evaluation_fixture_passes_the_gate() -> None:
    queries, k = load_fixture("eval/knowledge_retrieval_graded.v1.json")
    metrics = evaluate(queries, k)

    assert metrics.recall == 1.0
    assert metrics.precision == pytest.approx(2 / 3)
    assert metrics.mrr == 1.0
    assert metrics.ndcg == pytest.approx(1.0)
    assert gate_failures(metrics) == []


def test_a_metric_below_its_gate_is_reported() -> None:
    metrics = Metrics(recall=0.5, precision=0.2, mrr=0.4, ndcg=GATE_NDCG - 0.1, k=5)

    failures = gate_failures(metrics)

    assert any("recall_at_k" in failure for failure in failures)
    assert any("precision_at_k" in failure for failure in failures)
    assert any("mrr" in failure for failure in failures)
    assert any("ndcg_at_k" in failure for failure in failures)


def test_invalid_metric_inputs_are_rejected() -> None:
    with pytest.raises(RetrievalMetricError):
        recall_at_k([], {}, 5)
    with pytest.raises(RetrievalMetricError):
        recall_at_k(["a"], {"a": 1}, 0)
    with pytest.raises(RetrievalMetricError):
        precision_at_k(["a"], {"a": 1}, 0)
    with pytest.raises(RetrievalMetricError):
        ndcg_at_k(["a"], {"a": 1}, 0)
    with pytest.raises(RetrievalMetricError):
        evaluate([], 5)


def test_invalid_fixtures_are_rejected(tmp_path) -> None:
    cases = [
        ("missing.json", None),
        ("bad.json", "{"),
        ("empty.json", json.dumps({"queries": []})),
        (
            "k.json",
            json.dumps(
                {
                    "k": 0,
                    "queries": [{"id": "a", "query": "q", "relevant": {"d": 1}, "returned": []}],
                }
            ),
        ),
        (
            "no-relevant.json",
            json.dumps({"queries": [{"id": "a", "query": "q", "relevant": {}, "returned": []}]}),
        ),
        (
            "bad-grade.json",
            json.dumps(
                {"queries": [{"id": "a", "query": "q", "relevant": {"d": 0}, "returned": []}]}
            ),
        ),
        (
            "dup.json",
            json.dumps(
                {
                    "queries": [
                        {"id": "a", "query": "q", "relevant": {"d": 1}, "returned": []},
                        {"id": "a", "query": "q", "relevant": {"d": 1}, "returned": []},
                    ]
                }
            ),
        ),
    ]
    for name, content in cases:
        path = tmp_path / name
        if content is not None:
            path.write_text(content, encoding="utf-8")
        with pytest.raises(RetrievalMetricError):
            load_fixture(path)


def test_the_cli_gates_valid_and_invalid_fixtures(tmp_path, capsys) -> None:
    valid = tmp_path / "valid.json"
    valid.write_text(
        json.dumps(
            {
                "k": 2,
                "queries": [
                    {
                        "id": "a",
                        "query": "q",
                        "relevant": {"d": 3, "e": 1},
                        "returned": ["d", "e"],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    invalid = tmp_path / "invalid.json"
    invalid.write_text("{}", encoding="utf-8")

    assert main(["--fixture", str(valid), "--gate"]) == EXIT_OK
    assert main(["--fixture", str(valid)]) == EXIT_OK
    assert main(["--fixture", str(invalid)]) == EXIT_INVALID
    assert "INVALID" in capsys.readouterr().err


def test_the_cli_returns_a_gate_failure(tmp_path, capsys) -> None:
    failing = tmp_path / "failing.json"
    failing.write_text(
        json.dumps(
            {
                "k": 2,
                "queries": [
                    {
                        "id": "a",
                        "query": "q",
                        "relevant": {"d": 3},
                        "returned": ["x", "y"],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    assert main(["--fixture", str(failing), "--gate"]) == EXIT_GATE_FAILED
    assert "GATE FAILED" in capsys.readouterr().err
