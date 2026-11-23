# Phase 5 — Designer parity and workflow creation

Phase 5 turns `/workflows/designer` from a graph editor into a workflow-authoring surface: a
grouped, searchable palette; a properties panel for every node type; navigation, validation,
autosave, version history, publishing and BPMN interchange. The backend gains a minimal, hardened
BPMN converter; no existing endpoint or table changed.

## Delivered

| Area | What shipped |
|---|---|
| Palette | Events, Activities, Gateways, Structural and Extensions groups; case-insensitive search through the shared `Input` primitive; arrow-key cursor and Enter insertion; drag and button insertion preserved |
| Properties | Name, timeout, retry policy, assignees, form, AI action/prompt/schema, script, gateway guard, delay, webhook, sub-process and parallel-join fields rendered with `Input`, `Textarea`, `Select` and `Button` |
| Canvas | Process navigator, mini-map, explicit zoom in/out/fit controls rendered with the shared `Button` primitive and React Flow controls |
| Validation | Errors and warnings with click-to-focus; missing START blocks save, missing END warns, cycles and unreachable nodes are reported, invalid edge conditions block save |
| Autosave | Debounced localStorage draft keyed by tenant; restore after reload/crash; beforeunload and in-app navigation guards |
| Versions | Side-by-side snapshot comparison, rollback and archive using the existing version endpoints |
| Publish | Save-then-publish, post-publish summary with an instances CTA, 409 two-tab conflict copy that keeps the draft |
| Editing | Copy/paste, multi-select alignment, keyboard node/edge creation, existing undo/redo extended rather than duplicated |
| BPMN | Import and export with the engine node subset; DTD/XXE disabled; 400 with a line reference; 413 for oversized XML |
| Safety | Labels rendered as React text, hostile-label test, invalid SpEL blocked at save time, XXE rejected |

## Backend contract (additive)

| Endpoint | Use |
|---|---|
| `POST /api/v1/workflow-definitions/bpmn/import` | BPMN XML → internal definition JSON (tenant context, `WORKFLOW_CREATE`) |
| `POST /api/v1/workflow-definitions/bpmn/export` | Internal definition JSON → BPMN XML (tenant context, `WORKFLOW_CREATE`) |

Both are pure converters: they do not persist anything, so unsaved drafts can be exported and an
imported BPMN can be inspected before a save. The converter keeps the engine node type and config
in the `awap` extension namespace (`awap:nodeType`, `awap:config`), which is what makes the
supported subset round-trip losslessly. The parser rejects DOCTYPE declarations outright, disables
external entities, external DTD/schema access and XInclude, and caps input at one million
characters. The OpenAPI contract documents both paths plus the 413 response.

## Tests

| ID | Test |
|---|---|
| T5-01 | `BpmnXmlServiceTest.serializeAndParseRoundTripsTheDefinitionDeepEqual` and `workflowDesigner.test.ts` definition round-trip |
| T5-02 | `validateExpression` unit cases plus the backend dry-run; save is blocked while a condition is invalid |
| T5-03 | `workflowDesigner.test.ts` add/connect/delete plus the existing drag-drop E2E |
| T5-04 | Twenty undo/redo cycles in `workflowDesigner.test.ts` |
| T5-05 | `workflowDraft.test.ts` storage round-trip and the autosave/reload E2E |
| T5-06 | Publish E2E and `VersionHistoryPanel` tests; response status is `PUBLISHED` |
| T5-07 | Rollback E2E and `workflowVersions.test.ts` rollback candidates |
| T5-08 | Backend BPMN round-trip deep equality |
| T5-09 | `workflowPerformance.test.ts` asserts 500 nodes stay under two seconds |
| T5-10 | Keyboard-only palette search, insertion and transition composer E2E |
| T5-11 | `BpmnXmlServiceTest.rejectsDoctypeAndExternalEntities` |
| T5-12 | `visual/designer-canvas-1280x900.png` element baseline |
| T5-13 | [`designer-controls.test.tsx`](../../frontend/components/workflows/__tests__/designer-controls.test.tsx) asserts `awap-input`/`awap-textarea`/`awap-select` and `data-slot="button"` on the palette, properties and zoom controls |
| T5-14 | `designer selected-node properties match their element baselines` adds light/dark element baselines; the axe E2E scans the designer in both themes |

Unhappy paths covered: missing START blocked, missing END warning, cycle warning, disconnected
node error, invalid BPMN 400 with a line, oversized XML 413, tab-close guard, two-tab publish
conflict, long/hostile label truncation and escaping, and autosave after a crash (reload with the
draft still in storage).

## Design-system migration (issue 359)

The palette search, every property field and the zoom/fit controls now use the shared design-system
primitives instead of bare native elements, so border, height, focus ring, disabled and dark-mode
surfaces come from the same tokens as the rest of the product. A compact laptop layout keeps the
palette, canvas, properties and navigator usable at 1280 px and stacks them below 1024 px. The
element baselines for a selected START node are generated in light and dark themes; the axe E2E
scans the designer in both themes and fails on critical or serious findings.

## Risk mitigations

| Risk | Mitigation |
|---|---|
| R5-01 graph loss | Undo/redo is extended (twenty-cycle test), drafts autosave independently of save, save failures keep the browser draft, beforeunload and in-app guards warn |
| R5-02 BPMN round-trip | Engine type/config travel in the `awap` namespace; deep-equality test; unsupported constructs are rejected instead of silently dropped |
| R5-03 large graph freeze | Validation is a single DFS/adjacency pass; the 500-node interaction measurement (validate, connect, copy, align, serialize, parse) asserts the two-second budget |
| R5-04 invalid SpEL | Client mirror blocks save immediately and the backend dry-run re-validates every condition before persistence |
| R5-05 XSS via label | Names render as React text with no `dangerouslySetInnerHTML`; a hostile `<img onerror>` name is asserted to stay text |
| R5-06 concurrent edit/version conflict | Publish is an explicit operator action; a 409 shows conflict copy and never clears the draft; rollback/archive only enable for valid published, non-current versions |
| R5-07 XML XXE | DOCTYPE disallowed, external entities/DTD/schema disabled, secure processing enabled, plus a dedicated rejection test |
| R5-08 unpublished draft loss | localStorage drafts are separate from server saves; publish saves first; export works on unsaved state |

## Honest limitations

- BPMN diagram interchange (positions, lanes, edge waypoints) is **not** round-tripped. Positions are
  not part of the definition JSON either; the canvas regenerates a deterministic layout on import.
- Only the engine's node subset is supported. Boundary events, event-based gateways, choreographies
  and multi-instance markers are rejected with a 400 rather than approximated.
- There is no update-draft endpoint. Opening `?id=` loads the current version and publish/rollback
  target that id, but pressing **Save draft** creates a new definition; version history remains on
  the original id. This is why the designer labels the create path explicitly.
- Autosave is per-browser localStorage, not a server-side collaborative draft; two tabs do not
  merge. Publish conflicts surface from the backend response because publish has no ETag/If-Match.
- The in-app unsaved-changes guard intercepts ordinary same-origin link clicks; programmatic
  router navigation is not intercepted.
- Moving a node does not mark the draft dirty because positions are not persisted in the
  definition JSON.
