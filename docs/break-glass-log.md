# Break-glass log

Single-maintainer break-glass windows, newest first. The machine-readable source is
[`settings/break-glass-log.json`](../settings/break-glass-log.json); the tests fail when this table
and the JSON diverge. The JSON keeps the active incident at the top level and every earlier window
under `history`, so the Phase 8 audit console always renders the current exception.

## Incident #389 — issues #366, #367, #368, #369, #370, #371, #372, #373, #374, #375 and #284

Incident [#389](https://github.com/awap-platform/ai-native-workflow-automation-platform/issues/389)
authorised the single-maintainer break-glass merges for the sequential issues #366–#375 and the
re-verification of #284.

### Incident scope

| Field | Value |
|-------|-------|
| Incident | #389 |
| Owner approving the exception | `@koraysrn` |
| Reason | Single maintainer; GitHub never counts a self-approval against required_approving_review_count=1. |
| Expiry | `2026-11-25T23:59:59Z` |
| Scope | Only required_approving_review_count is lowered to 0 for the duration of a single merge. enforce_admins, required status checks, force-push/deletion blocks and the drift workflow stay unchanged. |
| Unchanged | `enforce_admins=true`, required status checks, force-push/deletion blocks, drift workflow |
| Restore | `scripts/apply-branch-protection.sh --apply` then `--verify` immediately after every merge |

### Merged PRs

Every row had all required status checks green **before** the approval count was lowered. The
approval count was restored to 1 and verified with `--verify` immediately after each merge.

| Issue | PR | Merge commit | Merged at (UTC) | Checks green | Restore `--apply` | Restore `--verify` |
|-------|----|--------------|-----------------|--------------|-------------------|--------------------|
| #366 | #388 | `936a7c8786842814f04364f4be9bd77a9b66995f` | 2026-11-24T15:17:37Z | yes | updated | matches |
| #367 | #390 | `e00d5b489262873781f61f0d9ff84906470c7d7b` | 2026-11-24T15:54:28Z | yes | updated | matches |
| #368 | #391 | `d84c1a8c0201eaf506df2d3fdeb027fe55ed1745` | 2026-11-24T17:16:54Z | yes | updated | matches |
| #369 | #392 | `45e97660689bcc59a35f0a04b2629fd8eb79a3fc` | 2026-11-24T18:53:32Z | yes | updated | matches |
| #370 | #393 | `bc15c7e39fd7a568914e514fef46831015a2e132` | 2026-11-24T20:19:22Z | yes | updated | matches |
| #371 | #394 | `055fd041216f6725d739f4282b080691b44fc22b` | 2026-11-24T21:58:42Z | yes | updated | matches |
| #372 | #395 | `72da2da4fe586e5d0118d2274d69b64a35a0c013` | 2026-11-25T12:15:48Z | yes | updated | matches |
| #373 | #396 | `f24e05f0a9a6b6814e784c60941ba3538bc46cb4` | 2026-11-25T14:18:08Z | yes | updated | matches |
| #374 | #397 | `1f0d1f0f3a5d443db60d7a50c306a62df578ecd9` | 2026-11-25T18:06:14Z | yes | updated | matches |
| #375 | #398 | `81ee10d418b5789abc15f7cd3e632c0bb14b89ab` | 2026-11-25T19:32:11Z | yes | updated | matches |
| #284 | #386 | `9404740eb04db183f79cdbf36b375c61f3081a0f` | 2026-11-23T21:34:17Z | yes | updated | matches |

PR #386 (#284) merged before this window opened; it is listed because the final `main` run
re-executed its Copilot journey spec with the code from this window in place.

### Post-incident proof

| Check | Value |
|-------|-------|
| Live approval count | `1` |
| `enforce_admins` | `true` |
| Drift failure observed during the exception | none — an early `required_approving_review_count` drift during the #398 retries was converged with `--apply` before the next merge |
| Final drift run (green) | run `45686163037` (green, `81ee10d`) |
| Green `main` CI run | run `45686163172` (green, `81ee10d`) |
| Green `main` CI commit | `81ee10d418b5789abc15f7cd3e632c0bb14b89ab` |

### Closure

Incident #389 is closed by the governance PR that recorded this evidence. It cannot authorise any
further merge: the next single-maintainer exception needs its own incident, its own expiry and its own
rows in both this table and the JSON log.

## Incident #257 (closed, kept as history)

### Incident scope

| Field | Value |
|-------|-------|
| Incident | #257 |
| Owner approving the exception | `@koraysrn` |
| Reason | One maintainer; GitHub never counts a self-approval against `required_approving_review_count=1` |
| Expiry | `2026-11-13T23:59:59Z` |
| Scope | Only the approval count is lowered to 0 for one merge at a time |
| Unchanged | `enforce_admins=true`, required status checks, force-push/deletion blocks, drift workflow |
| Restore | `scripts/apply-branch-protection.sh --apply` then `--verify` immediately after every merge |

### Merged PRs

Every row required all required status checks to be green **before** the approval count was
lowered. Restore was executed immediately after the merge.

| Issue | PR | Merge commit | Merged at (UTC) | Checks green | Restore `--apply` | Restore `--verify` |
|-------|----|--------------|-----------------|--------------|-------------------|--------------------|
| — (CI fix) | #258 | `8e5b408a415a8f4b56aead84f9de471834930c92` | 2026-11-11T15:47:36Z | yes | updated | matches |
| #197 | #256 | `d8560f5dc8dc4d7a3fa8b87f91086b0e12f3846c` | 2026-11-11T16:35:03Z | yes | updated | matches |
| #198 | #260 | `3163d070ceebcf67041a1d8567da40430857cf1d` | 2026-11-11T17:11:53Z | yes | updated | matches |
| #199 | #261 | `556c1a3be1e508ce0ed92c68dafe5aaf38f0e682` | 2026-11-11T17:51:32Z | yes | updated | matches |
| #200 | #262 | `0a5eb19fd8e19737d547bcb7ed52a5436bc793f6` | 2026-11-11T18:42:53Z | yes | updated | matches |
| #201 | #263 | `d88971efc57e060f723a6d45461103ac4b1a1116` | 2026-11-11T22:15:20Z | yes | updated | matches |
| #202 | #264 | `2c5c05a40b353f7f346cc7666ab8c342255cc7ce` | 2026-11-11T23:26:42Z | yes | updated | matches |
| #203 | #265 | `bc01efb60fbb2eaaaa1164403d367ba116831fc4` | 2026-11-12T12:39:57Z | yes | updated | matches |
| #204 | #266 | `f21823c96b7bb01df5674d7a4c7e942fc899a80d` | 2026-11-12T13:56:07Z | yes | updated | matches |
| #205 | #267 | `aeed9e9a374f20174e114bce04d6901eaf9899fc` | 2026-11-12T14:29:32Z | yes | updated | matches |

PR #258 (CI image build fix) carried no issue of its own but was part of the same sequential
pipeline; it is recorded here for completeness.

### Post-incident proof

| Check | Value |
|-------|-------|
| Live approval count | `1` |
| `enforce_admins` | `true` |
| Drift failure observed during the exception | none — every exception window was shorter than the drift schedule |
| Last drift run inside the incident | run `43235325197` (green, `f21823c`) |
| Final drift run (green) | run `43240412231` (green, `aeed9e9`) |
| Green `main` CI run | run `43237731691` (green, `aeed9e9`) |
| Green `main` CI commit | `aeed9e9a374f20174e114bce04d6901eaf9899fc` |

The previous incident [#243](https://github.com/awap-platform/ai-native-workflow-automation-platform/issues/243)
covered issues #189–#196 and remains closed; its record is superseded by this one in the JSON log.

### Closure rule

Incident #257 is closed by the governance PR that introduced this log. It cannot authorise any
further merge. Every future single-maintainer break-glass must:

1. open a **new** incident with its own reason, scope, owner and expiry;
2. append its merges to [`settings/break-glass-log.json`](../settings/break-glass-log.json) and this
   table in the same PR;
3. restore protection with `--apply` and `--verify` immediately after each merge; and
4. attach the restore output, the final drift run and the green `main` CI run before closing it.

## Runtime visibility (Phase 8)

The Phase 8 audit console reads a backend classpath copy of this log at
`/api/v1/admin/break-glass` and renders the incident, owner, reason, scope, expiry and merge table.
The copy is kept byte-identical to the reviewed source by
[`BreakGlassLogServiceTest`](../backend/identity/src/test/java/com/awap/identity/application/BreakGlassLogServiceTest.java).
An unreadable snapshot reports `available=false` and the console renders an explicit unavailable
state; it never implies that no exception exists.

This view is read-only. It does not authorise a merge, and the closure rules above remain in force.
