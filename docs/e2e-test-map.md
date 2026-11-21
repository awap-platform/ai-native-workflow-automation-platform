# E2E test map (Playwright)

The suite lives in [`frontend/e2e`](../frontend/e2e) and runs in two modes:

- **PR mode** (`pnpm test:e2e`): the Next.js dev server is started by `webServer`, the API is
  mocked per spec, no database is required. Fast and deterministic. The live journey spec is
  ignored by [`playwright.config.ts`](../frontend/playwright.config.ts) unless
  `E2E_LIVE_STACK=1`.
- **Stack mode** (`E2E_LIVE_STACK=1`, the CI `e2e` job): `docker compose` provides Postgres/Kafka,
  MinIO, ClamAV, the fake webhook, the built backend and the frontend; `e2e/global-setup.ts` waits
  for `GET /actuator/health` and the frontend, then seeds a tenant through `POST /api/v1/tenants`.
  The job sets `KAFKA_ENABLED=true` so the outbox relay delivers analytics, `CLAMAV_ENABLED=true`
  for the real scan pipeline, `MINIO_PUBLIC_ENDPOINT=http://localhost:9000` so presigned URLs point
  at the host-published port, and `FILE_SCAN_INTERVAL_MS=1000` so a scan completes within the test
  budget. `AI_NODE_ENABLED=true` lets the Copilot journey start a real AI_TASK workflow and observe
  the low-confidence HITL handover. Buckets are created by the `minio-init` provisioner (re-run in
  the foreground before the suite), so the backend keeps `FILE_MANAGE_BUCKETS=false`. The in-network
  `fake-webhook` is the allowlisted and SSRF-trusted target for the combined scenario; its
  `/control`, `/reset` and `/requests` endpoints are published on port 9099 for assertions.

Both modes use one worker (fixtures stay deterministic) and retry once on CI with traces,
screenshots and video retained on failure.

| Acceptance criterion (issue #128 §6/#7, issue #158) | Spec | Mode |
|---|---|---|
| Register a tenant and return to login | [`auth-journey.spec.ts`](../frontend/e2e/auth-journey.spec.ts) — `registration` | mocked |
| Wrong password shows an inline error and does not navigate | `auth-journey.spec.ts` — `login` | mocked |
| Login redirects to the dashboard | `auth-journey.spec.ts` — `login` | mocked |
| A user without an active tenant is routed to tenant selection | `auth-journey.spec.ts` — `session` | mocked |
| Protected routes redirect an expired session to login | `auth-journey.spec.ts` — `session` | mocked |
| Tenant isolation: the active tenant travels in `X-Tenant-Id` | [`tenant-isolation.spec.ts`](../frontend/e2e/tenant-isolation.spec.ts) | mocked |
| A cross-tenant rejection renders no foreign rows | `tenant-isolation.spec.ts` | mocked |
| No critical/serious axe violations on the shell | [`accessibility.spec.ts`](../frontend/e2e/accessibility.spec.ts) | mocked |
| CSP, HSTS and friends on every response | [`security-headers.spec.ts`](../frontend/e2e/security-headers.spec.ts) | mocked |
| Seeded tenant exists for live journeys | [`global-setup.ts`](../frontend/e2e/global-setup.ts) | stack |
| A user logs in, selects the seeded tenant and sees the dashboard counts from the real API | [`live-journey.spec.ts`](../frontend/e2e/live-journey.spec.ts) — `dashboard` | stack |
| A published workflow starts and the instance reaches COMPLETED | `live-journey.spec.ts` — `workflow` | stack |
| A task is approved and the API status becomes APPROVED | `live-journey.spec.ts` — `task` | stack |
| A new document is uploaded, scanned and PROMOTED before download is enabled | `live-journey.spec.ts` — `document` | stack |
| Analytics aggregates include WORKFLOW_COMPLETED and the page renders the real count | `live-journey.spec.ts` — `analytics` | stack |
| A DECISION node gets two conditional edges through the inspector | [`workflow-designer-conditions.spec.ts`](../frontend/e2e/workflow-designer-conditions.spec.ts) — `branches` | mocked |
| Save is blocked while an edge condition is invalid | `workflow-designer-conditions.spec.ts` — `guard` | mocked |
| The legend and axe checks pass on the designer | `workflow-designer-conditions.spec.ts` — `accessibility` | mocked |
| An upload flows through live status to PROMOTED and enables download | [`document-scan-live.spec.ts`](../frontend/e2e/document-scan-live.spec.ts) — `uploads` | mocked |
| Scan status updates rows without a refresh and gates download on PROMOTED | `document-scan-live.spec.ts` — `updates` | mocked |
| INFECTED shows an alert, an aria-live announcement and keeps download disabled | `document-scan-live.spec.ts` — `announces` | mocked |
| A clean PDF traverses QUARANTINED → SCANNING → CLEAN → PROMOTED (real MinIO + ClamAV), the SSE stream reports every transition and the presigned GET works only after promotion | [`document-scan-real.spec.ts`](../frontend/e2e/document-scan-real.spec.ts) — `clean` | stack |
| EICAR reaches INFECTED and the download is forbidden (real ClamAV) | `document-scan-real.spec.ts` — `infected` | stack |
| 500 MB and unsupported formats are rejected with 413/415 and tenant B cannot download tenant A's file | `document-scan-real.spec.ts` — `limits` | stack |
| DECISION routes to PARALLEL; TASK, WEBHOOK and DELAY all report before MERGE completes; exactly one HMAC-signed webhook request, one completion notification and the completed analytics aggregate exist; a clean PDF is PROMOTED in the same run; the backend health endpoint reports the AI layer `UP` | [`combined-automation-live.spec.ts`](../frontend/e2e/combined-automation-live.spec.ts) — `combined` | stack |
| A failed parallel branch prevents MERGE from completing and fails the workflow | `combined-automation-live.spec.ts` — `branch failure` | stack |
| A webhook that keeps returning 5xx exhausts its attempt budget, reaches DEAD and fails the workflow | `combined-automation-live.spec.ts` — `retry DLQ` | stack |
| An EICAR upload reaches INFECTED and stays undownloadable | `combined-automation-live.spec.ts` — `infected` | stack |
| A paused instance does not advance on task approval until it is resumed | `combined-automation-live.spec.ts` — `paused` | stack |
| A natural-language Copilot request previews, confirms and starts exactly one instance; the AI_TASK waits for HITL, approval completes the workflow, the correlation ID is echoed end to end, a duplicate key replays the same instance and metrics count the two logical calls | [`copilot-journey.spec.ts`](../frontend/e2e/copilot-journey.spec.ts) — `copilot HITL` | stack |
| Nightly live-provider variant of the Copilot journey against a configured OpenAI-compatible provider | [`copilot-live-provider.spec.ts`](../frontend/e2e/copilot-live-provider.spec.ts) — `live provider` | stack + `E2E_AI_LIVE_PROVIDER=1` |

## Backend knowledge and analytics E2E (issue #308)

The knowledge search and advanced analytics journey is a JUnit suite rather than a Playwright spec,
because indexing, hybrid retrieval and the PostgreSQL aggregates are backend concerns:

| Acceptance criterion (issue #308) | Test | Mode |
|---|---|---|
| A seeded document is chunked, PII-redacted, indexed and returned by tenant-scoped search | `KnowledgeAnalyticsE2ETest` — `seededDocumentIsIndexedSearchedAndCountedAsAnAnalyticsStep` | PR (in-memory OpenSearch fake) |
| The search/process step lands in the daily aggregate, percentiles, bottleneck and group summary | same test | PR |
| Tenant A never sees tenant B documents or aggregates; a foreign hit in the response is dropped | `tenantIsolationHoldsForIndexingSearchAndAnalytics`, `aForeignTenantDocumentInTheResultIsFilteredOut` | PR |
| An empty index is an explicit no-answer; an OpenSearch outage returns no hits and increments the fallback counter | `emptyIndexReturnsAnExplicitNoAnswer`, `openSearchOutageDegradesToNoHitsWithoutAFabricatedAnswer` | PR |
| An analytics sink outage never breaks the search path | `analyticsSinkOutageNeverFailsTheSearchPath` | PR |
| Blank/malformed content is rejected without an exception or a partial document | `malformedContentIsRejectedSafely` | PR |
| The same journey against a real OpenSearch container, including the kNN branch and index refresh polling | `KnowledgeAnalyticsOpenSearchIntegrationTest` | stack (Testcontainers) |

The deterministic suite runs in the `e2e` CI job (`Knowledge search and analytics E2E contract`) and
in the `backend` job; the Testcontainers variant runs in the `backend` job and skips itself when
Docker is unavailable.

## Phase 7 documents, notifications and templates

All Phase 7 journeys are deterministic Playwright tests with mocked HTTP/SSE transports, so they run
in the dependency-free PR `e2e` job:

| Acceptance criterion | Test | Mode |
|---|---|---|
| T7-01 upload → QUARANTINED → SCANNING → CLEAN → PROMOTED, download only at PROMOTED | [`phase-7-documents-notifications.spec.ts`](../frontend/e2e/phase-7-documents-notifications.spec.ts) — `T7-01` | PR |
| Interrupted upload aborts the PUT and deletes the pending version | same spec — `cancels an interrupted upload` | PR |
| T7-02 INFECTED alert, download blocked | same spec — `T7-02` | PR |
| T7-03 unsupported format (415) rejected locally and server 413 surfaced | same spec — `T7-03` | PR |
| T7-04 version list and archive | same spec — `T7-04` | PR |
| SCAN_FAILED re-queue | same spec — `re-queues a SCAN_FAILED scan` | PR |
| T7-05 read/unread transition decrements the badge | same spec — `T7-05` | PR |
| Filters and bulk read | same spec — `filters notifications and performs a bulk read` | PR |
| T7-06 template preview with variables | same spec — `T7-06` | PR |
| Empty-variable warning does not block preview | same spec — `warns about an empty variable` | PR |
| T7-08 axe on the INFECTED alert | same spec — `T7-02` AxeBuilder assertion | PR |
| T7-09 SSE drop → polling fallback | same spec — `T7-09` | PR |
| T7-10 timeline/inbox visual diff < 0.1% | [`visual-baseline.spec.ts`](../frontend/e2e/visual-baseline.spec.ts) — `documents`, `notifications` | PR |

## Conventions

- Seed values come from [`lib/e2eSeed.ts`](../frontend/lib/e2eSeed.ts); the live journey and the
  global setup both call `seedPlan()` with the same `E2E_SEED_SUFFIX`, so the slug/email include
  the CI run id and parallel or nightly runs never collide. A repeated run with the same suffix
  reuses the tenant (409 is treated as success).
- The live journey is environment-gated rather than skipped: `playwright.config.ts` excludes it
  from the dependency-free PR run, so no `test.skip` is introduced.
- The nightly live-provider run sets `E2E_AI_LIVE_PROVIDER=1`, `AI_PROVIDER=openai`,
  `AI_OPENAI_BASE_URL`, `AI_OPENAI_API_KEY` and `AI_OPENAI_MODEL`; the scheduler records the model
  version in the run log. PR CI always uses the deterministic local heuristic provider.
- No `test.skip` is allowed without a linked issue and an expiry date.
- Artifacts: `frontend/playwright-report` (HTML) and `frontend/test-results` (trace/video/screenshot)
  are uploaded by the `e2e` job on every run/failure respectively; the live journey runs in the
  same job, so its traces and videos use the same pipeline.
