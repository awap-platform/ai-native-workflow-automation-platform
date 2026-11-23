# Visual baseline review checklist (issue 360)

A visual suite only proves "no change from the committed image". This checklist makes the baseline
itself reviewable and keeps a known defect from being enshrined as the expected state.

## Before committing a new or regenerated baseline

1. **Structural gate first.** The `e2e/layout-structure.spec.ts` assertions must pass: no
   checkbox/title/badge/SLA overlap, no visible selection label, and no horizontal overflow at
   320 px on the three-row task fixture.
2. **Compare against the design-system reference.** Open the regenerated image next to the
   `/design-system` reference (or the design-audit screenshot) and confirm tokens, spacing,
   typography, borders and contrast match. Do not accept a diff just because it is green.
3. **Check the identity chrome.** The shell must show a real tenant, role and locale. A baseline
   containing "Role: Unknown", "Tenant: Select tenant" or an empty locale is rejected.
4. **Check the data.** The task fixture has three rows with short, long and Turkish titles. A
   one-row fixture cannot catch multi-row overlap and is rejected.
5. **Check the extremes.** Review 320, 768, 1280 and 1920 px in light and dark. No clipping,
   overlap, horizontal scrollbar or excessive whitespace.
6. **Mask only dynamic text.** The SLA countdown may be masked or tolerated; masking a layout
   region is not allowed.
7. **Two consecutive clean runs.** Run the visual suite twice against the production build (port
   3100) and require both to pass before merge.
8. **Record the review.** Put the reviewer, date and a one-line summary in the PR description.

## When the baseline changes intentionally

- Regenerate only the affected route × state × viewport set.
- Explain why the pixels changed in the PR (layout fix, copy fix, design-system migration).
- Never regenerate to make a failing test pass without the structural and design checks above.

## Current fixture contract

| Area | Fixture |
|---|---|
| Session | `awap_session=1`, `awap_tenant=tenant-a`, `awap_role=MANAGER`, `awap_locale=en` |
| Tasks | `task-1` short, `task-long` long English, `task-tr` Turkish, all rendered in the inbox |
| States | Every visual route is captured in `empty` and `populated` where meaningful |
| Viewports | 320×800, 768×1024, 1280×800, 1920×1080 (plus the four legacy laptop widths) |
