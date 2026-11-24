# Phase 6 — Form builder and form filling

Phase 6 replaces the two-line form screens with a full authoring and filling
surface: a three-pane builder (palette, canvas, properties), every field type in
the schema, conditional visibility, calculations, drag-and-drop ordering,
preview parity with the real fill route, form versioning and a scan-gated file
experience. Validation rules are mirrored in `FormService`, so bypassing the UI
still fails with `400`, `403`, `409`, `413`, `415` or `404`.

## Delivered

| Area | What shipped |
|---|---|
| Builder layout | Left palette (grouped, searchable, draggable), centre canvas with drop zones, right properties panel |
| Field types | TEXT, TEXTAREA, NUMBER, EMAIL, PHONE, DATE, DATETIME, BOOLEAN, SELECT, MULTI_SELECT, FILE plus layout-only SECTION and DIVIDER |
| Validation | Required, min/max length, regex pattern, numeric min/max, option membership and type format; the same rules run in `FormService` |
| Conditions | `visibleWhen` with EQUALS, NOT_EQUALS, CONTAINS, GREATER_THAN, LESS_THAN, IS_EMPTY and IS_NOT_EMPTY; hidden fields are neither required nor validated (client and server) |
| Calculations | `sum`, `avg`, `min`, `max`, `abs`, `round`, arithmetic and parentheses; dependency-ordered evaluation and cycle detection on both sides |
| Ordering | Native HTML5 drag-and-drop for palette inserts and row reordering, plus `Move up`/`Move down` keyboard buttons |
| Preview | The builder preview and `/forms/fill` render through the same `FormRenderer`, so the visible fields cannot drift |
| Versioning | Builder loads an existing definition, saves a new version (server increments `version`) and shows the version badge; submissions record `formVersion` |
| Read-only | Preview and fill both support a read-only rendering; no submit control is shown |
| Files | Quarantine upload with live scan status; submitted attachments show a download only for `PROMOTED`, and `INFECTED` files are blocked with an explanation |
| Errors | `FormErrorSummary` is a `role="alert"` list; a submit attempt moves focus to it and each entry focuses its control |
| Autosave | Tenant-scoped localStorage draft (600 ms debounce) restored after a reload or crash; fill answers survive back-navigation via sessionStorage |
| Security | Labels and help render as React text (no `dangerouslySetInnerHTML`), schema ≤ 200 KB, submission data ≤ 1 MB, text ≤ 10,000 characters, regex ≤ 200 characters, and field ids are restricted to `[A-Za-z_][A-Za-z0-9_]*` |

## Schema contract (additive)

`form_definitions.schema_json` keeps the `{ "fields": [...] }` shape and gains
optional per-field properties:

| Property | Meaning |
|---|---|
| `label`, `help`, `placeholder`, `title` | Display text (escaped as React text) |
| `required`, `minLength`, `maxLength`, `pattern`, `min`, `max`, `options` | Validation rules |
| `visibleWhen` | `{ fieldId, operator, value? }` |
| `calculated` | NUMBER-only expression evaluated from other field values |

`form_submissions` gains `form_version INTEGER NOT NULL DEFAULT 1`
(migration [`V60__form_submission_version.sql`](../../backend/identity/src/main/resources/db/migration/V60__form_submission_version.sql)).
`FormSubmissionResponse.formVersion` exposes it. The layout field types
`SECTION` and `DIVIDER` extend `FormFieldType`; they never take a value and
cannot be `required`.

## Backend enforcement

| Rule | Behaviour |
|---|---|
| Unknown, duplicate or malformed field id | `400` at create/update |
| SELECT/MULTI_SELECT without options, required layout field, unparseable regex, `min > max`, invalid or cyclic calculation, unknown condition/calculation reference | `400` at create/update |
| Schema > 200 KB, submission `dataJson` > 1 MB | `413` |
| Required field missing, blank or empty array (only when visible) | `400` |
| Length, pattern, numeric bounds, option membership, email/phone/date/date-time/boolean format | `400` |
| Calculated value different from the server recomputation | `400` |
| Text longer than the hard 10,000-character cap | `400` |
| Hidden field supplied by a client | Ignored: not required, not validated and not resolved as a file |
| File not tenant-owned / infected / not promoted / unsupported extension / over 500 MB | `404` / `403` / `409` / `415` / `413` from the file module |

## Tests

| ID | Test |
|---|---|
| T6-01 | [`schema.test.ts`](../../frontend/lib/forms/__tests__/schema.test.ts) — one rejection per field type plus a happy path for every type |
| T6-02 | `schema.test.ts` — required missing/empty/whitespace/multi-select-empty blocks submit; `false` and `0` are not empty |
| T6-03 | `schema.test.ts` — min/max length, regex pattern and numeric bound messages |
| T6-04 | `schema.test.ts` and [`form-builder-phase6.spec.ts`](../../frontend/e2e/form-builder-phase6.spec.ts) — conditional show/hide in both the builder preview and the fill route |
| T6-05 | [`FormAttachment.test.tsx`](../../frontend/components/forms/__tests__/FormAttachment.test.tsx) — PROMOTED creates the download link; E2E asserts the enabled button |
| T6-06 | `FormAttachment.test.tsx` — INFECTED disables the button and never calls the endpoint; E2E asserts the blocked copy |
| T6-07 | [`FormRenderer.test.tsx`](../../frontend/components/forms/__tests__/FormRenderer.test.tsx) (identical markup and field list) and the E2E DOM-signature comparison between preview and fill |
| T6-08 | `FormRenderer.test.tsx` focuses the summary and then the field; the accessibility suite scans both screens with axe |
| T6-09 | `schema.test.ts` — 100 fields validated ten times under one second |
| T6-10 | E2E element baselines `form-builder-phase6.spec.ts-snapshots/visual-form-preview-renderer-1280x900-chromium-linux.png` and `…visual-form-fill-renderer-1280x900-chromium-linux.png` at 0.1% tolerance, plus DOM-signature and bounding-box equality |

Unhappy paths covered by [`form-builder-phase6.spec.ts`](../../frontend/e2e/form-builder-phase6.spec.ts)
and [`FormServicePhase6Test`](../../backend/identity/src/test/java/com/awap/form/application/FormServicePhase6Test.java):

| ID | Unhappy path |
|---|---|
| U6-01 | Empty required field blocks submit and focuses the summary |
| U6-02 | Malformed schema JSON and an empty `fields` array are rejected |
| U6-03 | A client that skips the UI still fails: required/pattern/number/calculation rules run in `FormService` |
| U6-04 | Submission data above 1 MB → `413` |
| U6-05 | Unsupported file extension → `415` (file module) |
| U6-06 | Deleted/missing form → `404`, surfaced as “no longer exists” |
| U6-07 | INFECTED attachment cannot be downloaded |
| U6-08 | Pending (not promoted) file → `409`, surfaced with retry copy |
| U6-09 | Hostile label (`<img onerror>`, `<script>`) stays text; emoji and RTL survive |
| U6-10 | Back-navigation restores fill answers and the builder draft |

## Visual baselines

Two deterministic element baselines live in
[`e2e/form-builder-phase6.spec.ts-snapshots/`](../../frontend/e2e/form-builder-phase6.spec.ts-snapshots):
`visual-form-preview-renderer-1280x900-chromium-linux.png` (builder preview) and
`visual-form-fill-renderer-1280x900-chromium-linux.png` (fill route). Both compare
at `maxDiffPixelRatio: 0.001`. The same test also compares the rendered field
signature (id, type, control tag, control type and text) and the element boxes,
which is what proves the preview and fill surfaces render the same form.

## Risk mitigations

| Risk | Mitigation |
|---|---|
| R6-01 client-only validation bypass | Every rule is re-run in `FormService`; calculations are recomputed and compared; hidden fields are ignored rather than trusted |
| R6-02 regex denial of service | Patterns are capped at 200 characters, text at 10,000 characters and patterns are compiled once at schema save, so an invalid pattern never reaches submission |
| R6-03 hostile label XSS | Labels/help/options are React text; `dangerouslySetInnerHTML` is absent; unit and E2E tests assert markup stays inert |
| R6-04 preview drifts from the real form | One `FormRenderer` for preview and fill, plus a DOM-signature and bounding-box parity test |
| R6-05 calculated value mismatch | Dependency-ordered evaluation on both sides, a cycle check that blocks saving, and server-side recomputation with a 1e-9 tolerance |
| R6-06 unsaved builder work | Debounced draft autosave, restore on load, `beforeunload` guard while dirty and a “Save failed — draft stays” message |
| R6-07 file smuggled past the scan gate | The file module resolves every referenced id and only returns `PROMOTED` files; the attachment UI mirrors that rule |

## Honest limitations

- Form history is now versioned per row (issue #370): every create/update writes
  an immutable `form_schema_snapshots` row keyed by `(form_id, version)` with a
  SHA-256 hash. The historical read is
  `GET /api/v1/forms/{id}/versions/{version}`; `/forms/fill?formId=…&version=N`
  fetches that snapshot, forces read-only mode and shows the answered-vs-current
  version banner. Legacy submissions without a snapshot remain readable against
  the current schema with an explicit warning.
- **Drag-and-drop is covered by component-level `drop` events and the keyboard
  path in E2E.** There is no pointer-drag Playwright test; reordering is also
  available as buttons, which is the accessibility contract that is tested.
- **Condition evaluation is intentionally small.** Only the seven operators
  above are supported; there are no AND/OR groups or cross-form conditions.
- **Calculated fields are NUMBER-only.** No text concatenation or lookups.
- **The 500 MB / extension checks happen when a file id is resolved**, not when
  the upload starts in the browser; the upload control shows the server error.
- **React Compiler's set-state-in-effect rule** forced the one-time draft and
  deep-link reads into a microtask; the behaviour is unchanged but the read is
  not synchronous with mount.

## Gate

```bash
cd frontend
pnpm typecheck
pnpm lint
pnpm jest
pnpm lint:inline
pnpm lint:colors
pnpm budget
pnpm build && pnpm exec next start -p 3100
E2E_EXTERNAL_STACK=1 E2E_BASE_URL=http://localhost:3100 pnpm test:e2e
cd ../backend && ./mvnw -B clean verify && cd .. && make coverage-baseline
node scripts/check-doc-links.mjs
node scripts/openapi-controller-coverage.mjs
```
