"""Golden-set Precision/Recall evaluation for Copilot workflow matching (issue #279).

The harness runs the *real* Copilot classification and workflow-discovery path (the same
``CopilotAgent`` nodes used in production) and scores the result against a versioned JSONL
golden set. Two execution modes exist:

* ``deterministic`` (default, used in PR CI): a recorded-fixture backend tool client satisfies the
  exact ``BackendToolClient`` contract, so the run is fast, offline and reproducible.
* ``live`` (nightly): the real backend is called through ``BackendToolClient``.

Every run is written to ``eval/results/<date>-<git-sha>.json`` and compared with the previous
baseline. The process fails closed: an empty dataset, a malformed row or an incomplete run never
produces a perfect score.

Exit codes:
    0  evaluation completed and every gate passed
    1  evaluation completed but a Precision/Recall gate or a slice regressed
    2  the dataset or fixtures are invalid (clear validation error)
    3  the run is incomplete (for example a provider timeout) and must not be scored as zero
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import subprocess
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from app.copilot.agent import CopilotAgent, LlmClient
from app.copilot.models import CopilotAction, CopilotRequest, SecurityContext, ToolCall
from app.copilot.tools import BackendToolClient, ToolRegistry

# --------------------------------------------------------------------------- gates
GATE_PRECISION = 0.90
GATE_RECALL = 0.90
GATE_SLICE = 0.85

VALID_LOCALES = {"tr", "en"}
VALID_RISK_CLASSES = {"low", "medium", "high", "critical"}
VALID_ACTIONS = {action.value for action in CopilotAction}

# Synthetic golden-set requests only: an email address or a phone number would leak real data.
_PII_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PII_PHONE = re.compile(r"(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)")

EXIT_OK = 0
EXIT_GATE_FAILED = 1
EXIT_INVALID_DATASET = 2
EXIT_INCOMPLETE = 3


class DatasetError(ValueError):
    """Raised when the golden set or its fixtures are invalid."""


class IncompleteRunError(RuntimeError):
    """Raised when a prediction cannot be produced and must not be scored as zero."""


# --------------------------------------------------------------------------- data model
@dataclass(frozen=True)
class GoldenEntry:
    """One reviewable golden-set row."""

    id: str
    locale: str
    request: str
    expected_action: str
    expected_workflow_id: str | None
    expected_workflow_name: str | None
    risk_class: str
    tenant_scope: str


@dataclass
class Prediction:
    """The Copilot's prediction for one golden entry."""

    predicted_action: str
    proposed_workflows: list[dict[str, Any]] = field(default_factory=list)
    confidence: float = 0.0
    requires_human_approval: bool = False
    outcome: str = "UNKNOWN"
    blocked: bool = False
    error: str | None = None


@dataclass(frozen=True)
class ConfusionCounts:
    tp: int
    fp: int
    fn: int

    @property
    def precision(self) -> float:
        denominator = self.tp + self.fp
        return 1.0 if denominator == 0 else self.tp / denominator

    @property
    def recall(self) -> float:
        denominator = self.tp + self.fn
        return 1.0 if denominator == 0 else self.tp / denominator

    @property
    def f1(self) -> float:
        precision, recall = self.precision, self.recall
        return 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)

    def as_dict(self) -> dict[str, float | int]:
        return {
            "tp": self.tp,
            "fp": self.fp,
            "fn": self.fn,
            "precision": round(self.precision, 6),
            "recall": round(self.recall, 6),
            "f1": round(self.f1, 6),
        }


# --------------------------------------------------------------------------- validation
def _validate_entry(raw: Any, line_number: int) -> GoldenEntry:
    where = f"golden set line {line_number}"
    if not isinstance(raw, dict):
        raise DatasetError(f"{where}: each row must be a JSON object.")
    required = {
        "id",
        "locale",
        "request",
        "expected_action",
        "expected_workflow_id",
        "expected_workflow_name",
        "risk_class",
        "tenant_scope",
    }
    missing = sorted(required - raw.keys())
    if missing:
        raise DatasetError(f"{where}: missing required field(s): {', '.join(missing)}.")

    for key in ("id", "locale", "request", "expected_action", "risk_class", "tenant_scope"):
        if not isinstance(raw[key], str) or not raw[key].strip():
            raise DatasetError(f"{where}: '{key}' must be a non-empty string.")
    if raw["locale"] not in VALID_LOCALES:
        raise DatasetError(f"{where}: unsupported locale '{raw['locale']}'.")
    if raw["expected_action"] not in VALID_ACTIONS:
        raise DatasetError(f"{where}: unknown expected_action '{raw['expected_action']}'.")
    if raw["risk_class"] not in VALID_RISK_CLASSES:
        raise DatasetError(f"{where}: unknown risk_class '{raw['risk_class']}'.")
    for optional in ("expected_workflow_id", "expected_workflow_name"):
        value = raw[optional]
        if value is not None and (not isinstance(value, str) or not value.strip()):
            raise DatasetError(f"{where}: '{optional}' must be null or a non-empty string.")
    if raw["request"].strip() == "":
        raise DatasetError(f"{where}: 'request' must not be blank.")
    if _PII_EMAIL.search(raw["request"]) or _PII_PHONE.search(raw["request"]):
        raise DatasetError(
            f"{where}: 'request' looks like real PII; golden entries must be synthetic."
        )
    return GoldenEntry(
        id=raw["id"].strip(),
        locale=raw["locale"],
        request=raw["request"].strip(),
        expected_action=raw["expected_action"],
        expected_workflow_id=raw["expected_workflow_id"],
        expected_workflow_name=raw["expected_workflow_name"],
        risk_class=raw["risk_class"],
        tenant_scope=raw["tenant_scope"].strip(),
    )


def load_dataset(path: str | Path) -> list[GoldenEntry]:
    """Load and validate a JSONL golden set; an empty dataset fails closed."""
    dataset_path = Path(path)
    if not dataset_path.is_file():
        raise DatasetError(f"Golden set not found: {dataset_path}")
    entries: list[GoldenEntry] = []
    seen: set[str] = set()
    for line_number, line in enumerate(dataset_path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            raw = json.loads(line)
        except json.JSONDecodeError as ex:
            raise DatasetError(f"golden set line {line_number}: invalid JSON ({ex.msg}).") from ex
        entry = _validate_entry(raw, line_number)
        if entry.id in seen:
            raise DatasetError(f"golden set line {line_number}: duplicate id '{entry.id}'.")
        seen.add(entry.id)
        entries.append(entry)
    if not entries:
        raise DatasetError("Golden set is empty; refusing to report a perfect score.")
    return entries


def load_fixtures(path: str | Path) -> dict[str, Any]:
    """Load the recorded backend-tool fixtures used by deterministic mode."""
    fixture_path = Path(path)
    if not fixture_path.is_file():
        raise DatasetError(f"Fixture file not found: {fixture_path}")
    try:
        payload = json.loads(fixture_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as ex:
        raise DatasetError(f"Fixture file is not valid JSON: {ex.msg}.") from ex
    if not isinstance(payload, dict) or not isinstance(payload.get("entries"), dict):
        raise DatasetError("Fixture file must contain an 'entries' object.")
    return payload


# --------------------------------------------------------------------------- predictors
class Predictor(Protocol):
    async def predict(self, entry: GoldenEntry) -> Prediction: ...


def _security(entry: GoldenEntry) -> SecurityContext:
    return SecurityContext(
        tenant_id=entry.tenant_scope,
        user_id="00000000-0000-0000-0000-00000000e2e0",
        role="TENANT_ADMIN",
        correlation_id=f"eval-{entry.id}",
    )


class FixtureBackendClient:
    """Recorded backend tool client that satisfies the real ``BackendToolClient`` contract."""

    def __init__(self, fixtures: dict[str, Any] | None = None) -> None:
        self.fixtures = fixtures or {}
        self.calls: list[str] = []

    async def call(
        self,
        tool_name: str,
        payload: dict[str, Any],
        security: SecurityContext,
        idempotency_key: str | None = None,
    ) -> Any:
        self.calls.append(tool_name)
        if tool_name == "find_workflow":
            return list(self.fixtures.get("find_workflow", []))
        if tool_name == "audit_decision":
            return {"recorded": True}
        if tool_name == "get_user":
            return {"fullName": "Golden Set Evaluator"}
        if tool_name == "query_tasks":
            return []
        if tool_name == "search_documents":
            return []
        if tool_name in {
            "create_workflow_instance",
            "complete_task",
            "create_approval",
            "send_notification",
            "assign_task",
        }:
            raise AssertionError(
                f"Evaluation must never invoke the state-changing tool '{tool_name}'."
            )
        return {"recorded": True}


class DeterministicPredictor:
    """Runs the real agent against recorded fixtures (offline, reproducible)."""

    def __init__(self, fixtures: dict[str, Any]) -> None:
        self.fixtures = fixtures

    def _client(self, entry: GoldenEntry) -> FixtureBackendClient:
        entry_fixture = self.fixtures.get("entries", {}).get(entry.id)
        if entry_fixture is None:
            raise DatasetError(f"No fixture recorded for golden entry '{entry.id}'.")
        return FixtureBackendClient(entry_fixture)

    def _agent(self, client: FixtureBackendClient) -> CopilotAgent:
        return CopilotAgent(
            tools=ToolRegistry(client),  # type: ignore[arg-type]
            llm=LlmClient(base_url="", api_key=""),
            confidence_threshold=0.7,
        )

    async def predict(self, entry: GoldenEntry) -> Prediction:
        client = self._client(entry)
        agent = self._agent(client)
        try:
            classified = await agent.run(CopilotRequest(message=entry.request), _security(entry))
            discovered = await agent.run(
                CopilotRequest(message=entry.request, action=CopilotAction.DISCOVER_WORKFLOW),
                _security(entry),
            )
        except Exception as ex:  # a provider/transport failure is incomplete, never a zero
            raise IncompleteRunError(f"entry '{entry.id}' could not be evaluated: {ex}") from ex

        proposed: list[dict[str, Any]] = []
        if isinstance(discovered.data, list):
            proposed = [item for item in discovered.data if isinstance(item, dict)]
        outcome = _audit_outcome(classified.tool_calls)
        return Prediction(
            predicted_action=classified.action.value,
            proposed_workflows=proposed,
            confidence=float(classified.confidence),
            requires_human_approval=bool(classified.requires_human_approval),
            outcome=outcome,
            blocked="prompt-injection" in classified.answer.lower(),
        )


class LivePredictor:
    """Runs the real agent against the real backend (nightly)."""

    def __init__(self, client: BackendToolClient | None = None) -> None:
        self.client = client or BackendToolClient()

    async def predict(self, entry: GoldenEntry) -> Prediction:
        agent = CopilotAgent(
            tools=ToolRegistry(self.client),  # type: ignore[arg-type]
            llm=LlmClient(base_url="", api_key=""),
            confidence_threshold=0.7,
        )
        try:
            classified = await agent.run(CopilotRequest(message=entry.request), _security(entry))
            discovered = await agent.run(
                CopilotRequest(message=entry.request, action=CopilotAction.DISCOVER_WORKFLOW),
                _security(entry),
            )
        except Exception as ex:
            raise IncompleteRunError(f"entry '{entry.id}' could not be evaluated: {ex}") from ex
        proposed: list[dict[str, Any]] = []
        if isinstance(discovered.data, list):
            proposed = [item for item in discovered.data if isinstance(item, dict)]
        return Prediction(
            predicted_action=classified.action.value,
            proposed_workflows=proposed,
            confidence=float(classified.confidence),
            requires_human_approval=bool(classified.requires_human_approval),
            outcome=_audit_outcome(classified.tool_calls),
            blocked="prompt-injection" in classified.answer.lower(),
        )


def _audit_outcome(tool_calls: Sequence[ToolCall]) -> str:
    for call in reversed(list(tool_calls)):
        if call.name == "audit_decision" and isinstance(call.arguments, dict):
            outcome = call.arguments.get("outcome")
            if isinstance(outcome, str):
                return outcome
    return "UNKNOWN"


# --------------------------------------------------------------------------- metrics
def confusion_counts(
    expected: Sequence[str], predicted: Sequence[str]
) -> dict[str, ConfusionCounts]:
    """Multiclass confusion counts, one entry per index."""
    classes = sorted(set(expected) | set(predicted))
    counts: dict[str, ConfusionCounts] = {}
    for label in classes:
        tp = sum(1 for e, p in zip(expected, predicted, strict=False) if e == label and p == label)
        fp = sum(1 for e, p in zip(expected, predicted, strict=False) if e != label and p == label)
        fn = sum(1 for e, p in zip(expected, predicted, strict=False) if e == label and p != label)
        counts[label] = ConfusionCounts(tp=tp, fp=fp, fn=fn)
    return counts


def aggregate(counts: Sequence[ConfusionCounts]) -> ConfusionCounts:
    return ConfusionCounts(
        tp=sum(item.tp for item in counts),
        fp=sum(item.fp for item in counts),
        fn=sum(item.fn for item in counts),
    )


def confusion_matrix(
    entries: Sequence[GoldenEntry], predictions: Sequence[Prediction]
) -> dict[str, dict[str, int]]:
    matrix: dict[str, dict[str, int]] = {}
    for entry, prediction in zip(entries, predictions, strict=False):
        row = matrix.setdefault(entry.expected_action, {})
        row[prediction.predicted_action] = row.get(prediction.predicted_action, 0) + 1
    return matrix


def workflow_counts(
    entries: Sequence[GoldenEntry], predictions: Sequence[Prediction]
) -> ConfusionCounts:
    """Precision/Recall of the workflows the Copilot proposes for workflow-bearing entries."""
    tp = fp = fn = 0
    for entry, prediction in zip(entries, predictions, strict=False):
        if entry.expected_workflow_id is None:
            continue
        proposed = {
            str(item.get("id"))
            for item in prediction.proposed_workflows
            if isinstance(item, dict) and item.get("id")
        }
        expected = entry.expected_workflow_id
        if expected in proposed:
            tp += 1
        else:
            fn += 1
        fp += len(proposed - {expected})
    return ConfusionCounts(tp=tp, fp=fp, fn=fn)


def calibration(
    entries: Sequence[GoldenEntry], predictions: Sequence[Prediction]
) -> list[dict[str, Any]]:
    """Confidence calibration for workflow-bearing entries."""
    buckets: dict[str, list[tuple[float, bool]]] = {}
    for entry, prediction in zip(entries, predictions, strict=False):
        if entry.expected_workflow_id is None:
            continue
        lower = min(0.8, int(prediction.confidence * 5) / 5)
        key = f"{lower:.1f}-{lower + 0.2:.1f}"
        proposed = {
            str(item.get("id"))
            for item in prediction.proposed_workflows
            if isinstance(item, dict) and item.get("id")
        }
        buckets.setdefault(key, []).append(
            (prediction.confidence, entry.expected_workflow_id in proposed)
        )
    report: list[dict[str, Any]] = []
    for key in sorted(buckets):
        values = buckets[key]
        report.append(
            {
                "bucket": key,
                "count": len(values),
                "accuracy": round(sum(1 for _, hit in values if hit) / len(values), 6),
                "avg_confidence": round(sum(conf for conf, _ in values) / len(values), 6),
            }
        )
    return report


def _slice_metrics(
    entries: Sequence[GoldenEntry], predictions: Sequence[Prediction]
) -> dict[str, Any]:
    classification = aggregate(
        list(
            confusion_counts(
                [e.expected_action for e in entries], [p.predicted_action for p in predictions]
            ).values()
        )
    )
    workflows = workflow_counts(entries, predictions)
    return {
        "classification": classification.as_dict(),
        "workflow_match": workflows.as_dict(),
        "support": len(entries),
    }


def _group(
    entries: Sequence[GoldenEntry],
    predictions: Sequence[Prediction],
    key: str,
) -> dict[str, Any]:
    grouped: dict[str, list[int]] = {}
    for index, entry in enumerate(entries):
        group_key = getattr(entry, key)
        grouped.setdefault(group_key, []).append(index)
    result: dict[str, Any] = {}
    for group_key, indices in sorted(grouped.items()):
        result[group_key] = _slice_metrics(
            [entries[i] for i in indices], [predictions[i] for i in indices]
        )
    return result


# --------------------------------------------------------------------------- report + gate
def build_report(
    entries: Sequence[GoldenEntry],
    predictions: Sequence[Prediction],
    *,
    dataset_path: str,
    mode: str,
    git_sha: str,
    incomplete: bool,
    errors: Sequence[str] = (),
) -> dict[str, Any]:
    classification = confusion_counts(
        [entry.expected_action for entry in entries],
        [prediction.predicted_action for prediction in predictions],
    )
    overall = aggregate(list(classification.values()))
    workflows = workflow_counts(entries, predictions)
    report: dict[str, Any] = {
        "generated_at": datetime.now(UTC).isoformat(),
        "git_sha": git_sha,
        "dataset": {"path": dataset_path, "count": len(entries)},
        "mode": mode,
        "incomplete": incomplete,
        "errors": list(errors),
        "metrics": {
            "classification": overall.as_dict(),
            "workflow_match": workflows.as_dict(),
            "accuracy": round(overall.tp / len(entries), 6) if entries else 0.0,
            "confusion_matrix": confusion_matrix(entries, predictions),
            "calibration": calibration(entries, predictions),
        },
        "slices": {
            "locale": _group(entries, predictions, "locale"),
            "tenant": _group(entries, predictions, "tenant_scope"),
            "action": _group(entries, predictions, "expected_action"),
            "risk": _group(entries, predictions, "risk_class"),
        },
        "predictions": [
            {
                "id": entry.id,
                "locale": entry.locale,
                "tenant_scope": entry.tenant_scope,
                "expected_action": entry.expected_action,
                "predicted_action": prediction.predicted_action,
                "expected_workflow_id": entry.expected_workflow_id,
                "proposed_workflow_ids": [
                    str(item.get("id"))
                    for item in prediction.proposed_workflows
                    if isinstance(item, dict) and item.get("id")
                ],
                "confidence": round(prediction.confidence, 6),
                "requires_human_approval": prediction.requires_human_approval,
                "outcome": prediction.outcome,
                "blocked": prediction.blocked,
            }
            for entry, prediction in zip(entries, predictions, strict=False)
        ],
    }
    report["gate"] = {"passed": not incomplete, "thresholds": _thresholds(), "violations": []}
    if not incomplete:
        violations = gate_violations(report)
        report["gate"] = {
            "passed": not violations,
            "thresholds": _thresholds(),
            "violations": violations,
        }
    return report


def _thresholds() -> dict[str, float]:
    return {
        "precision": GATE_PRECISION,
        "recall": GATE_RECALL,
        "slice_precision": GATE_SLICE,
        "slice_recall": GATE_SLICE,
    }


def gate_violations(report: dict[str, Any]) -> list[str]:
    violations: list[str] = []
    classification = report["metrics"]["classification"]
    if classification["precision"] < GATE_PRECISION:
        violations.append(
            f"classification precision {classification['precision']:.3f} < {GATE_PRECISION:.2f}"
        )
    if classification["recall"] < GATE_RECALL:
        violations.append(
            f"classification recall {classification['recall']:.3f} < {GATE_RECALL:.2f}"
        )
    workflows = report["metrics"]["workflow_match"]
    if workflows["tp"] + workflows["fp"] > 0 and workflows["precision"] < GATE_PRECISION:
        violations.append(f"workflow precision {workflows['precision']:.3f} < {GATE_PRECISION:.2f}")
    if workflows["tp"] + workflows["fn"] > 0 and workflows["recall"] < GATE_RECALL:
        violations.append(f"workflow recall {workflows['recall']:.3f} < {GATE_RECALL:.2f}")

    for slice_group, slices in report["slices"].items():
        for name, metrics in slices.items():
            support = metrics["support"]
            if support < 2:
                continue  # a single sample is not a stable slice
            classification_slice = metrics["classification"]
            if classification_slice["precision"] < GATE_SLICE:
                violations.append(
                    f"slice {slice_group}/{name} precision "
                    f"{classification_slice['precision']:.3f} < {GATE_SLICE:.2f}"
                )
            if classification_slice["recall"] < GATE_SLICE:
                violations.append(
                    f"slice {slice_group}/{name} recall "
                    f"{classification_slice['recall']:.3f} < {GATE_SLICE:.2f}"
                )
            workflow_slice = metrics["workflow_match"]
            if workflow_slice["tp"] + workflow_slice["fp"] > 0 and (
                workflow_slice["precision"] < GATE_SLICE
            ):
                violations.append(
                    f"slice {slice_group}/{name} workflow precision "
                    f"{workflow_slice['precision']:.3f} < {GATE_SLICE:.2f}"
                )
            if workflow_slice["tp"] + workflow_slice["fn"] > 0 and (
                workflow_slice["recall"] < GATE_SLICE
            ):
                violations.append(
                    f"slice {slice_group}/{name} workflow recall "
                    f"{workflow_slice['recall']:.3f} < {GATE_SLICE:.2f}"
                )
    return violations


# --------------------------------------------------------------------------- baseline
def compare_baseline(report: dict[str, Any], baseline: dict[str, Any]) -> dict[str, Any]:
    """Compare the current run against the previous baseline metrics."""
    deltas: dict[str, Any] = {}
    for metric in ("classification", "workflow_match"):
        current = report["metrics"][metric]
        previous = baseline.get("metrics", {}).get(metric, {})
        deltas[metric] = {
            key: round(float(current[key]) - float(previous.get(key, 0.0)), 6)
            for key in ("precision", "recall", "f1")
        }
    deltas["improved"] = all(
        deltas[metric][key] >= 0
        for metric in ("classification", "workflow_match")
        for key in ("precision", "recall", "f1")
    )
    deltas["baseline_generated_at"] = baseline.get("generated_at")
    deltas["baseline_git_sha"] = baseline.get("git_sha")
    return deltas


def write_result(report: dict[str, Any], output_dir: str | Path, date: str, sha: str) -> Path:
    directory = Path(output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{date}-{sha[:12]}.json"
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def _git_sha() -> str:
    override = os.getenv("GIT_SHA") or os.getenv("GITHUB_SHA")
    if override:
        return override
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except Exception:
        return "unknown"


# --------------------------------------------------------------------------- orchestration
async def evaluate(entries: Sequence[GoldenEntry], predictor: Predictor) -> list[Prediction]:
    """Evaluate every entry; a prediction failure surfaces as an incomplete run."""
    predictions: list[Prediction] = []
    for entry in entries:
        predictions.append(await predictor.predict(entry))
    return predictions


def run(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", default="eval/golden_set.v1.jsonl")
    parser.add_argument("--fixtures", default="eval/fixtures/backend_tools.v1.json")
    parser.add_argument("--mode", choices=("deterministic", "live"), default="deterministic")
    parser.add_argument("--output-dir", default="eval/results")
    parser.add_argument("--baseline", default=None)
    parser.add_argument("--gate", action="store_true")
    parser.add_argument("--git-sha", default=None)
    args = parser.parse_args(argv)

    try:
        entries = load_dataset(args.dataset)
        fixtures = load_fixtures(args.fixtures) if args.mode == "deterministic" else {"entries": {}}
    except DatasetError as ex:
        print(f"INVALID DATASET: {ex}", file=sys.stderr)
        return EXIT_INVALID_DATASET

    predictor: Predictor = (
        DeterministicPredictor(fixtures) if args.mode == "deterministic" else LivePredictor()
    )
    incomplete = False
    errors: list[str] = []
    predictions: list[Prediction] = []
    try:
        predictions = asyncio.run(evaluate(entries, predictor))
    except (IncompleteRunError, DatasetError) as ex:
        incomplete = True
        errors.append(str(ex))
        predictions = [Prediction(predicted_action="UNKNOWN", error=str(ex)) for _ in entries]

    sha = args.git_sha or _git_sha()
    report = build_report(
        entries,
        predictions,
        dataset_path=args.dataset,
        mode=args.mode,
        git_sha=sha,
        incomplete=incomplete,
        errors=errors,
    )

    if args.baseline:
        baseline_path = Path(args.baseline)
        if baseline_path.is_file():
            baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
            report["baseline"] = compare_baseline(report, baseline)
        else:
            report["baseline"] = {"baseline_generated_at": None, "baseline_git_sha": None}

    date = datetime.now(UTC).strftime("%Y-%m-%d")
    path = write_result(report, args.output_dir, date, sha)
    print(json.dumps(report["metrics"], indent=2, ensure_ascii=False))
    print(f"Result written to {path}")

    if incomplete:
        print("INCOMPLETE RUN: no score is reported for the failed entries.", file=sys.stderr)
        return EXIT_INCOMPLETE
    if args.gate and not report["gate"]["passed"]:
        for violation in report["gate"]["violations"]:
            print(f"GATE FAILED: {violation}", file=sys.stderr)
        return EXIT_GATE_FAILED
    print("All gates passed.")
    return EXIT_OK


def main() -> None:
    raise SystemExit(run())


if __name__ == "__main__":
    main()
