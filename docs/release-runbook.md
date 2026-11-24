# Release Runbook

This runbook covers the release flow required by issue #179: releases are produced by a bot
from Conventional Commits, the version bump and `CHANGELOG.md` entry are reviewable, and a tag
is created only after the release pull request is merged and the full CI run on `main` is green.

The phase-10 sections below cover the canary rollout, the rollback runbook (RTO < 30 minutes)
and the rollback drill. The machine-readable policy is
[`infra/release/canary-policy.json`](../infra/release/canary-policy.json), validated by
`scripts/check-release-policy.mjs` and `frontend/lib/__tests__/releaseReadiness.test.ts`.

## Flow

1. A pull request with Conventional Commit messages is merged to `main`.
2. CI runs on the merge commit and the `Release Checks` job lints every commit in the range.
3. When the whole `CI` workflow succeeds, the [`Release`](../.github/workflows/release.yml)
   workflow runs through `workflow_run` and release-please opens or updates the release PR.
4. The release PR contains the version bump (`package.json`), the `.release-please-manifest.json`
   update and the generated `CHANGELOG.md` entry. It is reviewed and the full CI runs on it.
5. Merging the release PR pushes to `main`; the resulting green `CI` run lets release-please
   create the tag and the GitHub release. The release job then dispatches
   [`cd.yml`](../.github/workflows/cd.yml) with the released tag.

`CHANGELOG.md` is owned by the bot. A human pull request that touches it fails the
`Release Checks` job (`scripts/release/changelog-guard.mjs`). Fix the change by reverting the
manual edit and letting the release PR regenerate the entry.

## Configuration

| File | Purpose |
|---|---|
| [`release-please-config.json`](../release-please-config.json) | Monorepo package, changelog sections, release PR title. |
| [`.release-please-manifest.json`](../.release-please-manifest.json) | Last released version per package. |
| [`release.yml`](../.github/workflows/release.yml) | Release PR flow, CI gate, tag creation, CD dispatch. |
| `scripts/release/dry-run.mjs` | Prints the next version and changelog entries. |
| `scripts/release/lint-commits.mjs` | commitlint over the whole push/PR range. |
| `scripts/release/changelog-guard.mjs` | Rejects manual `CHANGELOG.md` edits. |
| `scripts/release/token-preflight.mjs` | Actionable permission failure before release-please runs. |
| `scripts/release/verify-ci-gate.mjs` | Re-checks event, branch, conclusion and commit SHA. |

### Token

The release job uses a dedicated bot identity. The workflow supports either:

- **GitHub App (preferred):** set the `RELEASE_PLEASE_APP_ID` and `RELEASE_PLEASE_PRIVATE_KEY`
  repository secrets. The workflow mints an installation token with **Contents: Write**,
  **Pull requests: Write** and **Actions: Write**. The mint step only succeeds when the
  installation grants those permissions, so the preflight passes the minted token to
  release-please without a second repository permission check.
- **Fine-grained token fallback:** set `RELEASE_PLEASE_TOKEN` with **Contents: Read and write**,
  **Pull requests: Read and write**, and **Actions: Read and write** if the token itself dispatches
  CD. Classic token: the `repo` scope, plus `workflow` for `workflow_dispatch`.

The token must belong to a dedicated bot identity - a GitHub App installation token or a machine
user - not the maintainer's personal PAT. GitHub never counts a self-approval, so a release PR
authored by the single maintainer could not satisfy the required review.

A regular `GITHUB_TOKEN` cannot be used for the release PR: pull requests created with it do not
trigger CI, so the release PR would never receive the required checks and could never be merged.
The preflight fails with an actionable message when neither credential is configured or the token
cannot push to the repository, so the bot never fails halfway through a release. Tags created with
a bot token do trigger tag-push workflows, but the release job dispatches CD explicitly so the
released tag is deployed even when a repository restricts token-triggered workflows.

## Normal release

```sh
# Preview the next version and the generated changelog without changing anything
pnpm release:dry-run

# Or through the workflow (Actions -> Release -> Run workflow), which is dry-run only
node scripts/release/dry-run.mjs --dry-run --from v0.1.0 --to HEAD
```

Then:

1. Review and merge the release PR once the full CI is green. Branch protection requires all
   checks, so a red release PR cannot be merged and no tag is created.
2. Confirm the tag and release were created exactly once. Re-running the workflow on the same
   commit is idempotent: release-please finds the existing tag, `release_created` stays false and
   CD is not dispatched again. The `release-please` concurrency group serializes runs.
3. Confirm the CD job built and pushed the released tag.

## Emergency release

Use this only when a critical fix cannot wait for the normal flow. Never create a tag manually
on unverified code and never bypass branch protection.

1. Open an incident ticket with the reason, the owner and an expiry.
2. Merge the fix through a normal pull request with all required checks green.
3. Let release-please update the release PR. If the bot could not open it (token or API
   incidents), run it locally with the same config and manifest:

   ```sh
   npx release-please@17 release-pr \
     --repo-url "https://github.com/${GITHUB_REPOSITORY}" \
     --token "$RELEASE_PLEASE_TOKEN" \
     --target-branch main \
     --config-file release-please-config.json \
     --manifest-file .release-please-manifest.json
   ```

4. Review and merge the release PR. The tag is still created only after the subsequent green CI
   run on `main`, because that is what triggers the release workflow.
5. If the release workflow itself did not run, re-run the last `Release` workflow run for that
   green CI run (`gh run rerun <run-id>`); the same event payload and commit SHA are reused. Do
   not create the tag manually, do not force-push `main` and do not move a published tag.

## SBOM recovery for an existing tag

If the release job created the tag but failed before attaching the SBOMs (for example the v1.1.0
Maven working-directory defect), do **not** delete or move the tag. Regenerate and attach the assets
from the existing tag with the recovery job:

```sh
gh workflow run release.yml --ref main -f recover_tag=v1.1.0
```

The `Release SBOM Recovery` job checks out the tag, builds the backend/frontend/AI-layer SBOMs,
validates and merges the inventory, signs it with cosign keyless, and uploads
`*.cdx.json` plus `*.bundle` with `--clobber`. It never runs release-please and never dispatches CD.
The normal release path now invokes Maven with `-f backend/pom.xml`, and the release-workflow test
suite rejects a regression to the root-directory invocation.

## Rollback of a bad tag

Prefer a forward fix. A published tag must never be moved, and `main` must never be force-pushed.

1. Revert the offending commit on `main` with a Conventional Commit (`revert: ...`). Release-please
   will produce the next patch release.
2. Point the deployment back at the previous good image while the patch release is prepared:

   ```sh
   argocd app rollback awap <previous-revision>
   # or keep the previous image digest in the deployment manifest
   ```

3. If the tag itself was created on the wrong commit (for example a manual mistake), delete the
   GitHub release and its tag, then let release-please recreate them from the corrected history:

   ```sh
   gh release delete vX.Y.Z --yes --cleanup-tag
   ```

4. Do not edit `CHANGELOG.md` or the manifest by hand to repair a bad release. If a repair is
   unavoidable, open a pull request that changes the **manifest** and let release-please
   regenerate the changelog; the changelog guard will reject a manual changelog edit.
5. Record the incident, the previous digest and the recovery tag in the ticket.

## Troubleshooting

| Symptom | Action |
|---|---|
| `Release Checks` fails with a commitlint error | Amend or rebase the offending commit; the log names the SHA and subject. |
| `Release Checks` fails with `CHANGELOG.md is generated exclusively by release-please` | Revert the manual changelog edit. |
| `Release` fails in `Resolve and verify the release token` | Configure `RELEASE_PLEASE_APP_ID` + `RELEASE_PLEASE_PRIVATE_KEY` (preferred) or grant `RELEASE_PLEASE_TOKEN` the permissions listed above. |
| `Release` says `main advanced` | The next green CI run releases the newer main commit; nothing to do. |
| Release PR is not opened | Check the `Release` workflow run for the green `CI` run of the merge commit and the token preflight. |
| Tag exists but CD did not run | Run the `CD` workflow with the tag, or re-run the release job; `release_created` guards duplicate dispatches. |

## Canary rollout

Canary traffic is raised only after a clean observation window. The stages and
thresholds are the committed policy, not a spreadsheet:

| Stage | Traffic | Observation | Advance only when |
|---|---:|---:|---|
| 1 | 5% | 30 minutes | every release-guard alert is silent |
| 2 | 25% | 30 minutes | every release-guard alert is silent |
| 3 | 100% | 30 minutes | every release-guard alert is silent |

Automatic rollback thresholds (tighten-only relative to the global budgets):

| Signal | Budget |
|---|---:|
| Error rate | ≤ 1% |
| p95 server latency | ≤ 1.5 s |
| LCP | ≤ 2.5 s |
| CLS | ≤ 0.1 |
| TBT | ≤ 200 ms |
| INP | ≤ 200 ms |
| DLQ growth | 0 messages |

The alerts `AwapReleaseCanaryFailureRate`, `AwapReleaseCanaryLatencyP95` and
`AwapReleaseCanaryDlqGrowth` fire during the window and point at
[`operations-runbook.md#o35--release-guard-and-rollback`](operations-runbook.md#o35--release-guard-and-rollback).
The deployment mechanism shifts traffic between ReplicaSets (service weights or
an Argo Rollouts-style controller); the policy file is the source of truth for
the percentages and thresholds.

> Status: a controlled two-deployment drill was executed on 2026-11-24 against
> a local HTTP canary router. The drill promoted 5% → 25% → 100%, injected a
> 5xx and latency fault, rolled back to the stable deployment and measured
> **RTO 0.054 s**. Evidence:
> [`release/evidence/canary-drill.json`](release/evidence/canary-drill.json) and
> [`release/evidence/2026-11-24-canary-drill.md`](release/evidence/2026-11-24-canary-drill.md).
> A production traffic shift still requires a service window; that residual risk
> is recorded in the evidence `riskAcceptance` block.

## Rollback runbook (RTO < 30 minutes)

The recovery time objective is **under 30 minutes** from the rollback decision
to verified healthy traffic. The procedure is intentionally short:

1. **Decide (0–2 min).** A release-guard alert, a failed UAT step or a P1
   incident is enough. Do not wait for a second confirmation on a critical
   signal.
2. **Freeze (2–3 min).** Stop the rollout; no new stage may start. Record the
   decision, the alert and the current traffic weight in the incident ticket.
3. **Shift traffic back (3–10 min).** Point the service at the previous stable
   ReplicaSet/image digest (roll the deployment back to the last good tag). If
   Argo CD manages the app, `argocd app rollback awap <previous-revision>`.
4. **Verify (10–20 min).** Confirm `GET /actuator/health` is `UP`, the
   release-guard alerts resolve, error rate returns below 1%, and p95 latency
   returns below 1.5 s. Check `/api/rum` has no spike in error-shaped samples.
5. **Communicate (20–25 min).** Post the incident update with the previous
   digest, the failed digest and the alert evidence.
6. **Follow up (≤ 30 min).** Open a defect with the triggering metric and add a
   regression test or threshold adjustment through review. Never edit the
   running policy in place.

If the rollback itself fails, escalate to the database/CDC runbooks and use the
previous release tag; the release-please flow produces a patch release from the
reverted change.

## Rollback drill

The drill proves the runbook, not the product. Run it on staging before a major
release and after any change to the rollout mechanism.

1. Deploy the current staging tag and note the stable digest.
2. Deploy the next candidate to 5% and confirm both revisions are healthy.
3. Trigger a controlled failure (for example a synthetic 5xx or a temporary
   latency injection) and verify the release-guard alert fires.
4. Execute the rollback runbook from step 3 and time every phase.
5. Record the timestamps: decision, traffic shift, health verification and
   alert resolution. The total must stay under 30 minutes.
6. File the drill record in the release ticket, including any step that needed
   clarification.

> Status: the rollback drill was executed on 2026-11-24. Detection took 43 ms,
> restore completed at 62 ms from the injected fault, and the previous stable
> deployment served every post-rollback request. The drill also verified the
> alert route, the fallback channel, zero cross-tenant responses and an
> immediate feature-flag kill. Reproduce with
> `node scripts/canary/drill.mjs`; the gate is
> `node scripts/check-canary-evidence.mjs`.
