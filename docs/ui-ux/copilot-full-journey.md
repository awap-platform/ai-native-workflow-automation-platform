# Full Copilot journey evidence (issue 284)

This page records how the final Phase 2 acceptance scenario is proven. The implementation lives in
the live-stack Playwright suite; nothing is mocked on the journey path.

## Scenario

1. A real tenant user signs in with the seeded plan.
2. A published workflow is created with **START → AI_TASK → END**. The deterministic definition uses
   a hedging prompt so the local heuristic provider returns low confidence; the live-provider
   definition uses a substantive prompt.
3. The user sends a natural-language request (`start <workflow>`) to
   `/api/v1/copilot/chat`. The first response requires confirmation and creates **no** instance.
4. Confirming the high-risk start creates exactly one instance and one `create_workflow_instance`
   tool call.
5. Replaying the same idempotency key returns the same instance; no duplicate process is created.
6. The instance is `WAITING` and the AI node emits exactly one `AI_HITL_REQUIRED` audit entry; the
   approval task description states the confidence was below the configured threshold.
7. Approving through the real task API resumes the node and completes the workflow.
8. The decision comment persists, exactly one approval task exists, exactly one `NODE_COMPLETED`
   audit row exists for the AI node, and the Copilot metrics counted two logical requests.

## Deterministic PR mode

| Item | Value |
|---|---|
| Spec | [`frontend/e2e/copilot-journey.spec.ts`](../../frontend/e2e/copilot-journey.spec.ts) |
| Helper | [`frontend/e2e/copilotJourney.ts`](../../frontend/e2e/copilotJourney.ts) |
| Provider | Local heuristic (`AI_PROVIDER=local`) |
| CI wiring | `AI_NODE_ENABLED: "true"`, `AI_LAYER_ENABLED: "true"` in `.github/workflows/ci.yml` |
| Guard | [`frontend/scripts/test/copilot-e2e-coverage.test.mjs`](../../frontend/scripts/test/copilot-e2e-coverage.test.mjs) keeps the assertions and CI wiring from regressing |

## Nightly live-provider mode

| Item | Value |
|---|---|
| Spec | [`frontend/e2e/copilot-live-provider.spec.ts`](../../frontend/e2e/copilot-live-provider.spec.ts) |
| Workflow | [`.github/workflows/copilot-nightly.yml`](../../.github/workflows/copilot-nightly.yml) |
| Provider | OpenAI-compatible (`AI_PROVIDER=openai`) |
| Enabling | Repository variable `COPILOT_NIGHTLY_ENABLED=true` |
| Required secrets | `AI_OPENAI_API_KEY` (optional `AI_OPENAI_BASE_URL`); model from `AI_OPENAI_MODEL` or `gpt-4o-mini` |
| Trigger | Nightly at 03:00 UTC and manual dispatch |
| Skip behaviour | The job is skipped unless `COPILOT_NIGHTLY_ENABLED=true`; the secret must exist when enabling |

The workflow records the configured model version in the run log before executing the spec.

## Honest limitations

- Confidence, model and tier are recorded by the AI node service in backend logs and its audit
  storage; the task API does not expose them, so the E2E asserts the HITL handover, the task copy,
  the audit actions and the correlation IDs rather than a per-node confidence field.
- The nightly variant depends on an external provider and can fail for reasons unrelated to the
  product; it is deliberately not a required PR check.
