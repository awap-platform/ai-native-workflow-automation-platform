# ADR-0008: AI prompt versioning and change control

- Status: Accepted
- Date: 2026-11-15
- Owners: AI Layer maintainers (`@awap-platform/maintainers`)
- Related: C11, issue #289

## Context

Prompts are product behaviour. A one-line wording change can alter routing, extraction, approval
advice or knowledge answers. The AI layer previously exposed a single `PROMPT_VERSION` and loaded
files such as `chat-v1.md`, but had no ownership, review, rollout, rollback or evaluation contract.
An edit to an existing file could silently change production behaviour and bypass the golden set.

## Decision

1. **Immutable version files.** Every prompt is a Markdown file named
   `<key>-v<major>[.<minor>[.<patch>]].md` under `ai-layer/app/prompts/`. An existing version file is
   never edited, renamed or deleted. A change creates a new version file and updates the registry in
   `ai-layer/app/copilot/prompts.py`.
2. **Registry is the source of truth.** Each logical key maps to exactly one active file. A missing
   file or an unknown key fails closed at load time. The registry, not the filesystem, decides which
   version is active.
3. **Traceability.** Every `CopilotResponse` contains `prompt_key`, `prompt_version` and the
   SHA-256 `prompt_hash`. Every `audit_decision` tool payload contains `promptKey`,
   `promptVersion` and `promptHash`, so an AI decision can be reproduced from the immutable file.
4. **Review and evaluation.** A prompt change requires:
   - CODEOWNERS review from the AI maintainers,
   - a new version file (never an edit),
   - a golden-set report from `python -m eval.evaluate --mode deterministic --gate`,
   - a recorded model/provider note when the evaluation uses a live provider.
5. **Rollout.** Deploy the new file with the registry pointing at it. The previous version remains in
   the repository and can be restored by changing the registry entry in a reviewed PR.
6. **Rollback.** Re-point the registry to the previous immutable file. No data migration is
   required; audit rows already identify the version and hash that was used.
7. **CI enforcement.**
   - `scripts/check-prompt-versions.mjs` validates the naming schema, registry/file parity and
     duplicates.
   - Pull requests fail when the diff modifies or deletes an existing prompt version file.
   - The AI Layer job runs the checker and its negative tests.
8. **Deprecation.** A version may only be removed from the registry, never deleted from the
   repository. The ADR history and audit trail remain reproducible.

## Consequences

- Prompt changes are additive and reviewable; the blast radius of an accidental edit is contained by
  CI.
- Responses and audits grow by one hash field; this is intentional traceability.
- Operators must create a new file rather than editing an old one, which is enforced mechanically.

## Pull-request checklist

- [ ] New prompt file follows `<key>-v<version>.md`.
- [ ] `PROMPTS` registry points at the new file.
- [ ] Golden-set evaluation report is attached/linked.
- [ ] `prompt_key`, `prompt_version` and `prompt_hash` are asserted by tests.
- [ ] Rollback target is named in the PR description.
- [ ] CODEOWNERS review is present.
