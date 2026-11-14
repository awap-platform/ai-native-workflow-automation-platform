# Copilot golden-set evaluation protocol (issue #279)

The golden set is the single source of truth for Copilot workflow-matching accuracy. It is a
versioned JSONL file of synthetic, tenant-scoped requests. CI re-runs the real Copilot
classification and workflow-discovery path against it and fails when the agreed gates regress.

## Dataset

`golden_set.v1.jsonl` has one JSON object per line:

| Field | Meaning |
|---|---|
| `id` | Stable, unique identifier used by the recorded fixtures |
| `locale` | `tr` or `en` |
| `request` | Synthetic natural-language request (never real PII) |
| `expected_action` | One of the `CopilotAction` values |
| `expected_workflow_id` / `expected_workflow_name` | Expected workflow for workflow-bearing requests, otherwise `null` |
| `risk_class` | `low`, `medium`, `high` or `critical` |
| `tenant_scope` | Synthetic tenant key; slices are reported per tenant |

`fixtures/backend_tools.v1.json` records the `/internal/tools/*` responses per entry, so PR CI runs
offline and deterministically. The fixtures contain only published, tenant-scoped workflows.

## Running

```bash
cd ai-layer
uv run python -m eval.evaluate --mode deterministic --gate --baseline eval/baseline.v1.json
# nightly, against the real backend:
uv run python -m eval.evaluate --mode live --gate --baseline eval/baseline.v1.json
```

Every run is written to `eval/results/<date>-<git-sha>.json` and compared with
`baseline.v1.json`. Exit codes are `0` (green), `1` (gate/slice regression), `2` (invalid dataset)
and `3` (incomplete run, never scored as zero).

## Gates

- Classification Precision ≥ **0.90**
- Classification Recall ≥ **0.90**
- Workflow-match Precision/Recall ≥ **0.90**
- Every locale, tenant, action and risk slice ≥ **0.85** (slices with at least two samples)

## Adding or reviewing entries

1. Add a synthetic row with a new stable `id` and a matching fixture entry.
2. A second engineer reviews the label and the fixture for tenant scoping and PII.
3. Run the evaluator locally; a new entry that lowers a slice requires an explicit PR discussion.
4. Never edit labels to make a run green. Rotate held-out entries each release and record the new
   baseline in the same PR with the exact confusion matrix from the run artifact.

## Approving a new baseline

A prompt, routing, model or discovery change that improves every gated metric may update
`baseline.v1.json` by copying the `metrics` object from the committed run artifact. Any regression
needs an ADR-style note in the PR and a linked follow-up issue. The baseline must name the model,
prompt version and git SHA it was produced from.
