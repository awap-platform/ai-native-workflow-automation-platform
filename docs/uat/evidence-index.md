# UAT evidence index (issue 365)

**Status: template, not executed.** Replace every `<...>` with a real link or value and attach this
page to the release ticket only after the sessions run.

## Build and environment

| Field | Value |
|---|---|
| Release candidate tag | `<tag>` |
| Environment and region | `<staging ...>` |
| Seed data version | `<seed commit or id>` |
| Session dates | `<date range>` |
| Moderator | `<name>` |
| Consent + retention record | `<link>` |

## Participants

| Participant | Persona | Consent recorded | Browser / AT | Sessions |
|---|---|---|---|---|
| `<P1>` | `<approver>` | `<yes/no>` | `<Chrome / NVDA>` | `<UAT-01…>` |

## Task evidence

| Task | Evidence link | Outcome | Time on task | Notes |
|---|---|---|---|---|
| UAT-01 | `<link>` | `<pass/fail>` | `<seconds>` | `<notes>` |
| UAT-02 | `<link>` | `<pass/fail>` | `<seconds>` | `<notes>` |
| UAT-03 | `<link>` | `<pass/fail>` | `<seconds>` | `<notes>` |
| UAT-04 | `<link>` | `<pass/fail>` | `<seconds>` | `<notes>` |
| UAT-05 | `<link>` | `<pass/fail>` | `<seconds>` | `<notes>` |
| UAT-06 | `<link>` | `<pass/fail>` | `<seconds>` | `<notes>` |
| UAT-07 | `<link>` | `<pass/fail>` | `<seconds>` | `<notes>` |
| UAT-08 | `<link>` | `<pass/fail>` | `<seconds>` | `<notes>` |
| UAT-09 | `<link>` | `<pass/fail>` | `<seconds>` | `<notes>` |
| UAT-10 | `<link>` | `<pass/fail>` | `<seconds>` | `<notes>` |

## Findings and triage

| Finding | Severity | Issue | Owner | Status |
|---|---|---|---|---|
| `<F1>` | `<P0/P1/P2>` | `<#issue>` | `<owner>` | `<open/closed>` |

## Gate and decision

| Field | Value |
|---|---|
| Results file | `<docs/uat/results.json>` |
| Gate command output | `<paste pnpm uat:check output>` |
| Task success rate | `<xx%>` (≥ 90% required) |
| SUS average | `<xx>` (≥ 80 required) |
| Tenant-isolation observations | `<0 required>` |
| Open P0 findings | `<0 required>` |
| Decision | `<go / no-go>` |
| Sign-off | `<product + QA + security>` |

Until this table is filled with real evidence, UAT is **not executed** and the programme must not
be declared operationally closed.
