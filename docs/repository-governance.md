# Repository Governance

This document defines the protection of the `main` branch, the issue/PR label taxonomy, the milestone structure and the merge policy as code. The policy is enforced by the idempotent [`scripts/apply-branch-protection.sh`](../scripts/apply-branch-protection.sh): `--apply` creates or updates the protection, `--verify` fails on drift and `--dry-run` prints the planned calls without changing GitHub. A scheduled [`branch-protection-drift.yml`](../.github/workflows/branch-protection-drift.yml) job reads the live settings and fails when they diverge. [`settings/branch-protection.json`](../settings/branch-protection.json) is a generated snapshot of `--expected`; regenerate it with `scripts/apply-branch-protection.sh --expected > settings/branch-protection.json` and let the test suite prove it is in sync.

## Branch protection - `main`

| Rule | Value |
|---|---|
| Require pull request | Yes |
| Direct push | Disallowed |
| Enforce admins | Yes |
| Require conversation resolution | Yes |
| Dismiss stale reviews | Yes |
| Required approving review count | 0 (permanent single-maintainer policy, see below) |
| Require code owner reviews | No (single-maintainer exception, see below) |
| Allow force pushes | No |
| Allow deletions | No |
| Strict status checks | Yes |

### Required status checks

The names are defined once in the `REQUIRED_CHECKS` array of [`apply-branch-protection.sh`](../scripts/apply-branch-protection.sh). The script validates every name against the job names in [`ci.yml`](../.github/workflows/ci.yml) and [`version-compatibility.yml`](../.github/workflows/version-compatibility.yml), and against the per-matrix contexts derived from [`docker-build.yml`](../.github/workflows/docker-build.yml); an unknown name or an unlisted unconditional job/matrix entry fails the run, so renaming or reshaping a workflow cannot leave a PR permanently pending.

- `Backend`
- `Frontend`
- `AI Layer`
- `Verify Versions`
- `Vulnerability Scan`
- `Secret Scan`
- `Dependency Scan`
- `Code Quality`
- `Docker Build / Build Images (awap-backend, backend/Dockerfile, .)`
- `Docker Build / Build Images (awap-frontend, frontend/Dockerfile, .)`
- `Docker Build / Build Images (awap-ai-layer, ai-layer/Dockerfile, .)`
- `End-to-End Tests`
- `API Lint`
- `Observability Checks`
- `CDC Checks`
- `Load Tests`
- `Branch Protection`
- `Release Checks`

`Contract Verification` (`pact-gate`) is intentionally not required: it only runs once `PACT_BROKER_BASE_URL` is configured, so requiring it would leave every PR pending on a repository without a Pact Broker. The reusable Docker workflow reports one context per matrix entry, so the three expanded names above are required instead of the bare `Docker Build` caller job; the script derives them from [`docker-build.yml`](../.github/workflows/docker-build.yml) and fails if the matrix changes without the policy following.

### Single-maintainer merge policy (permanent, reviewed)

The `awap-platform/maintainers` team currently has a single member and GitHub never counts a self-approval, so `required_approving_review_count` is **0 by policy**. That value is a reviewed decision, not drift and not an exception window: the snapshot and the test suite encode it, so the drift job stays green without a temporary patch.

What still gates every merge, and must not be weakened:

- every name in the required-status-check list above must be green on the current head (`strict: true`);
- `enforce_admins` stays enabled, so no account bypasses the checks;
- conversation resolution, the force-push block and the deletion block stay enabled;
- the protection itself is never deleted.

Break-glass remains for the rules that are still enforced - a missing required check after a workflow rename, an unprotected branch, a disabled rule - and is documented in runbook [O22](operations-runbook.md#o22--branch-protection-drift-and-break-glass-issue-178): open an incident ticket, converge with `--apply` and prove it with `--verify`. Every merge made while the policy was temporarily different is appended to [`settings/break-glass-log.json`](../settings/break-glass-log.json) and [`docs/break-glass-log.md`](break-glass-log.md); the branch-protection test suite rejects a log that diverges from the committed JSON.

- `require_code_owner_reviews` stays off while the repository has a single maintainer. When a second maintainer is added, raise the approval count to 1 and enable the code-owner rule in the same reviewed policy change.
- Automation that must merge without an interactive review (for example release automation) still uses a dedicated GitHub App with the minimum required permissions. Never disable protection globally to unblock a bot.

### Drift detection

[`branch-protection-drift.yml`](../.github/workflows/branch-protection-drift.yml) runs daily at 06:00 UTC, on `workflow_dispatch`, and on pushes that change the workflow, the script, its tests or the policy snapshot. It uses the `BRANCH_PROTECTION_TOKEN` repository secret (repository admin: read and write; a classic token needs the `repo` scope) and runs:

```sh
scripts/apply-branch-protection.sh --verify --repo owner/repo
```

A divergence prints one `DRIFT <field>: expected ..., got ...` line per differing field and fails the job. The failure summary points at `--apply` and O22.

## Merge policy

- Squash merge is mandatory; merge commits and rebase are disabled.
- The head branch is deleted automatically after merge.
- Commit messages must follow Conventional Commits ([`commitlint.config.cjs`](../commitlint.config.cjs)).
  The required `Release Checks` job runs commitlint over every commit in the push/PR range,
  not only over the commit being authored, and validates the pull request title because a
  squash merge turns it into the final `main` commit message.
- Releases are produced by release-please from Conventional Commits. The bot opens a release
  pull request with the version bump and the `CHANGELOG.md` entry; it is reviewed and tested
  like any other PR and the tag is created only after it merges and the full CI run on `main`
  is green. `CHANGELOG.md` is bot-owned: a human edit fails the changelog guard. See the
  [release runbook](release-runbook.md).

## Repository security settings

These are repository settings, not code, and the transfer to the `awap-platform`
organisation reset them. Keep this table as the reviewed state; the `gh` command
in the last column is the check:

| Setting | Required state | Verification |
|---|---|---|
| Secret scanning | Enabled | `gh api repos/OWNER/REPO --jq '.security_and_analysis.secret_scanning.status'` |
| Secret scanning push protection | Enabled | `... .security_and_analysis.secret_scanning_push_protection.status` |
| Secret scanning non-provider patterns | Enabled (needs GitHub Secret Protection enabled for the organisation) | `... .security_and_analysis.secret_scanning_non_provider_patterns.status` |
| Secret scanning validity checks | Enabled (same entitlement) | `... .security_and_analysis.secret_scanning_validity_checks.status` |
| Dependabot alerts | Enabled | `gh api repos/OWNER/REPO/vulnerability-alerts -i` returns `204` |
| Dependabot security updates | Enabled | `... .security_and_analysis.dependabot_security_updates.status` |
| Private vulnerability reporting | Enabled | `gh api repos/OWNER/REPO/private-vulnerability-reporting --jq .enabled` |
| Code scanning | The `CodeQL` workflow (advanced setup) | the required check plus the `CodeQL` job in [`ci.yml`](../.github/workflows/ci.yml) |
| Default workflow token | Read-only, with per-workflow `permissions:` blocks | `gh api repos/OWNER/REPO/actions/permissions/workflow` |

Do not enable `sha_pinning_required` until every `uses:` reference is pinned to a
commit SHA; the workflows currently pin major tags.

## Labels and milestones

The label taxonomy, milestone structure, ownership and merge policy are defined once in [`settings/repository-governance.json`](../settings/repository-governance.json). The tables below are validated against that file by [`scripts/test/apply-repo-governance.test.mjs`](../scripts/test/apply-repo-governance.test.mjs), so the documentation cannot silently diverge from the desired state.

### Labels

| Label | Description | Color | Owner |
|---|---|---|---|
| `kind/bug` | Bug fix or correction | `d73a4a` | `@awap-platform/maintainers` |
| `kind/feature` | New feature or request | `a2eeef` | `@awap-platform/maintainers` |
| `kind/chore` | Maintenance, tooling or infra work | `c5def5` | `@awap-platform/maintainers` |
| `area/backend` | Backend (Java / Spring Boot) | `ffa221` | `@awap-platform/maintainers` |
| `area/frontend` | Frontend (Next.js / React) | `168700` | `@awap-platform/maintainers` |
| `area/ai` | AI layer (Python / FastAPI) | `5319e7` | `@awap-platform/maintainers` |
| `priority/p0` | Critical - must ship first | `b60205` | `@awap-platform/maintainers` |
| `priority/p1` | High priority | `d93f0b` | `@awap-platform/maintainers` |
| `priority/p2` | Medium priority | `fbca04` | `@awap-platform/maintainers` |
| `priority/p3` | Low priority | `0e8a16` | `@awap-platform/maintainers` |
| `phase/preparation` | Preparation phase (repo, CI/CD, security foundations) | `e4e669` | `@awap-platform/maintainers` |
| `phase/core-mvp` | Core MVP phase | `0e8a16` | `@awap-platform/maintainers` |
| `phase/expansion` | Post-MVP expansion | `0075ca` | `@awap-platform/maintainers` |

Every label has an accountable owner. GitHub labels do not store an owner field, so the owner is governance metadata: the person or team that reviews changes to the label, its automation filters and its replacement plan.

> **Note - phase naming:** The planning documents originally used `phase/on-faz`, `phase/faz-0` and `phase/faz-1`. These were renamed to `phase/preparation`, `phase/core-mvp` and `phase/expansion` for clarity and consistency with the milestone names.

### Milestones

| Milestone | Description | Owner |
|---|---|---|
| `Preparation Phase` | Preparation phase - repo, CI/CD and security foundations | `@awap-platform/maintainers` |
| `Phase 0 - Core MVP` | Phase 0 - core MVP | `@awap-platform/maintainers` |
| `Phase 1 - Expansion` | Phase 1 - post-MVP expansion | `@awap-platform/maintainers` |

### Applying and verifying the taxonomy

[`scripts/apply-repo-governance.sh`](../scripts/apply-repo-governance.sh) reads the desired state and is safe to re-run:

```sh
scripts/apply-repo-governance.sh --dry-run --repo owner/repo   # plan, no GitHub mutation
scripts/apply-repo-governance.sh --apply   --repo owner/repo   # create/update labels, milestones and merge policy
scripts/apply-repo-governance.sh --verify  --repo owner/repo   # exit 1 on missing or drifted items
```

- `--dry-run` is the default. It validates the JSON and prints every planned call without contacting GitHub.
- `--apply` is idempotent. It creates missing labels and milestones, updates a label whose description or color drifted, updates a milestone whose description or state drifted, and updates the merge policy only when a value differs. It then applies branch protection through `scripts/apply-branch-protection.sh`.
- `--verify` fails on a missing or drifted label or milestone, including duplicate milestone titles. It reports unknown labels and milestones but does not delete them. The read-only check does not verify the merge policy: `--apply` keeps it in sync, but the repository settings fields are not readable with a read-only `GITHUB_TOKEN`.
- `--prune` is only valid with `--apply` or `--dry-run`. It deletes live labels that are absent from the desired state. It never deletes a desired label and it never deletes a milestone.

`--verify` only needs read access. The scheduled workflow uses the built-in `GITHUB_TOKEN` with `issues: read`; a manual `--apply` needs repository admin (classic token scope `repo`; fine-grained tokens need Contents: read, Issues: read/write and Administration: read/write).

### Drift detection

[`repository-governance-drift.yml`](../.github/workflows/repository-governance-drift.yml) runs weekly on Monday at 07:00 UTC, on `workflow_dispatch`, and on pushes that change the workflow, the desired state, the script, its tests or this document. It uses the built-in `GITHUB_TOKEN` with `issues: read` and runs:

```sh
scripts/apply-repo-governance.sh --verify --repo owner/repo
```

Missing or drifted labels or milestones fail the job. Unknown labels and milestones are published in the job summary as `UNKNOWN` lines; they are informational and are never deleted automatically. The failure summary points at `--apply`, `--prune` and runbook O24.

### Label and milestone lifecycle

- **Add.** Add the label or milestone to `settings/repository-governance.json` in the same PR that updates this table, then run `--dry-run` and `--apply`.
- **Change.** Edit the desired description, color, state or owner in the JSON and run `--apply`; an idempotent second run makes no changes.
- **Rename.** Treat a rename as a new label plus a retirement. GitHub issues and saved filters keep the old name until they are updated. Add the new label first, move the automation and filters, then retire the old label.
- **Retire a label without breaking existing issues.** Keep the old label during a migration window while both labels exist. `--verify` reports it as `UNKNOWN` but does not fail and does not delete it. Update every automation rule, saved filter, dashboard query and external integration to the replacement label, then run `--apply --prune` explicitly. `--prune` never deletes a label listed in the desired state.
- **Retire a milestone.** Milestones are never deleted by the script because deleting one silently detaches every issue that referenced it. Remove the milestone from the desired state, then close or delete it manually in GitHub only after no open issue references it.
- **Revive a retired label.** Add it back to the desired state and run `--apply`; a missing label is recreated with the reviewed color and description.
