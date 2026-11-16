function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080";
}

export interface TaskDto {
  id: string;
  tenantId: string;
  workflowInstanceId: string | null;
  title: string;
  description: string | null;
  assigneeId: string | null;
  status: string;
  version: number;
  decisionComment: string | null;
}

export interface WorkflowDefinitionDto {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: string;
  currentVersion: number;
}

export interface WorkflowInstanceDto {
  id: string;
  tenantId: string;
  workflowDefinitionId: string;
  workflowVersion: number;
  state: string;
  contextJson: string;
  idempotencyKey: string | null;
  createdAt: string;
}

export interface FormDefinitionDto {
  id: string;
  tenantId: string;
  name: string;
  schemaJson: string;
  version: number;
  createdAt: string;
}

export interface HealthDto {
  status: string;
}

export interface CreateWorkflowPayload {
  name: string;
  description?: string;
  definitionJson: string;
}

export interface CompanyDto {
  id: string;
  name: string;
}

/** Reads the XSRF-TOKEN cookie written by Spring's CookieCsrfTokenRepository. */
function csrfToken(): string | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
  const token = match?.[1];
  return token ? decodeURIComponent(token) : undefined;
}

/**
 * Returns the CSRF header, bootstrapping the readable cookie first when this is the SPA's first
 * state-changing request. A GET alone never makes Spring generate the token.
 */
async function csrfHeaders(): Promise<Record<string, string>> {
  let token = csrfToken();
  if (!token) {
    const started = performance.now();
    const response = await fetch(`${apiBase()}/api/v1/auth/csrf`, {
      credentials: "include",
    });
    logApi("GET", "/api/v1/auth/csrf", response.status, started);
    token = csrfToken();
  }
  return token ? { "X-XSRF-TOKEN": token } : {};
}

/** Reads the active tenant cookie set by the tenant switcher. */
function activeTenantId(): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const match = document.cookie.match(/(?:^|;\s*)awap_tenant=([^;]*)/);
  const value = match?.[1];
  return value ? decodeURIComponent(value) : null;
}

/** Logs an API call to the browser console for local diagnostics. */
function logApi(method: string, path: string, status: number, started: number): void {
  console.log(
    `[api] ${method} ${path} -> ${status} (${Math.round(performance.now() - started)}ms)`,
  );
}

/** Calls the public actuator health endpoint used by the shared consumer contract. */
export async function healthCheck(): Promise<HealthDto> {
  const started = performance.now();
  const response = await fetch(`${apiBase()}/actuator/health`);
  logApi("GET", "/actuator/health", response.status, started);
  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`);
  }
  return (await response.json()) as HealthDto;
}

export interface TenantMembershipDto {
  tenantId: string;
  role: string;
}

export async function fetchTenants(): Promise<TenantMembershipDto[]> {
  const response = await fetch(`${apiBase()}/api/v1/auth/tenants`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to load tenants with status ${response.status}`);
  }
  return (await response.json()) as TenantMembershipDto[];
}

export interface TenantDto {
  id: string;
  slug: string;
  name: string;
  plan: string;
  maxUsers: number;
  maxWorkflows: number;
  maxAiCallsPerMonth: number;
  active: boolean;
}

export interface RegisterTenantPayload {
  slug: string;
  name: string;
  adminEmail: string;
  adminPassword: string;
  adminFullName: string;
}

export async function registerTenant(payload: RegisterTenantPayload): Promise<TenantDto> {
  const started = performance.now();
  const response = await fetch(`${apiBase()}/api/v1/tenants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  logApi("POST", "/api/v1/tenants", response.status, started);
  if (!response.ok) {
    throw new Error(await readErrorDetail(response, "Registration failed"));
  }
  return (await response.json()) as TenantDto;
}

/** Extracts the RFC 7807 `detail` (or `title`) from a failed response, if present. */
async function readErrorDetail(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown; title?: unknown };
    if (typeof body.detail === "string") {
      return body.detail;
    }
    if (typeof body.title === "string") {
      return body.title;
    }
  } catch {
    // Response was not JSON; fall through to the generic message.
  }
  return `${fallback} (HTTP ${response.status})`;
}

export interface TokenDto {
  accessToken: string | null;
  refreshToken: string | null;
  expiresIn: number;
}

export async function login(
  tenantSlug: string,
  email: string,
  password: string,
): Promise<TokenDto> {
  const response = await fetch(`${apiBase()}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ tenantSlug, email, password }),
  });
  if (!response.ok) {
    throw new Error("Login failed");
  }
  return (await response.json()) as TokenDto;
}

/** Error thrown by every API call; `status` lets the query layer classify retries. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** HTTP status of an error when it came from the API layer. */
export function errorStatus(error: unknown): number | undefined {
  return error instanceof ApiError ? error.status : undefined;
}

async function refreshAccessToken(): Promise<boolean> {
  try {
    const response = await fetch(`${apiBase()}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: "{}",
    });
    return response.ok;
  } catch {
    return false;
  }
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Refreshes the access token at most once across concurrent 401s. Without single-flight every
 * parallel query that receives a 401 would call `/auth/refresh`, rotating the refresh cookie
 * repeatedly and racing itself. The shared promise is cleared once it settles so the next
 * expiry can refresh again.
 */
export function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Navigation seam so tests can observe the redirect without navigating jsdom. */
export const navigation = {
  redirectToLogin(): void {
    // A full navigation re-runs the middleware auth check and clears in-memory server state.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload re-runs the middleware auth check
    window.location.assign("/");
  },
};

function redirectToLogin(): never {
  navigation.redirectToLogin();
  throw new ApiError(401, "Unauthorized");
}

/**
 * One request path for every verb: cookie credentials, tenant header, CSRF for mutations, a single
 * retry after a successful refresh, and a typed `ApiError` for the query layer.
 */
async function apiRequest<T>(
  method: "GET" | "POST" | "PUT" | "PATCH",
  path: string,
  body?: unknown,
  retried = false,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (method === "GET") {
    const token = csrfToken();
    if (token) {
      headers["X-XSRF-TOKEN"] = token;
    }
  } else {
    Object.assign(headers, await csrfHeaders());
  }
  const tenant = activeTenantId();
  if (tenant) {
    headers["X-Tenant-Id"] = tenant;
  }
  if (extraHeaders) {
    Object.assign(headers, extraHeaders);
  }
  const started = performance.now();
  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers,
    credentials: "include",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  logApi(method, path, response.status, started);

  if (response.status === 401 && !retried && (await refreshSession())) {
    return apiRequest<T>(method, path, body, true, extraHeaders);
  }
  if (response.status === 401) {
    redirectToLogin();
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      await readErrorDetail(response, `${method} ${path.split("?")[0]} failed`),
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

const authFetch = <T>(path: string): Promise<T> => apiRequest<T>("GET", path);
const authPatch = <T>(path: string): Promise<T> => apiRequest<T>("PATCH", path);
const authPut = <T>(path: string, body: unknown): Promise<T> => apiRequest<T>("PUT", path, body);
const authPost = <T>(path: string, body: unknown): Promise<T> => apiRequest<T>("POST", path, body);
const authPostWithHeaders = <T>(
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<T> => apiRequest<T>("POST", path, body, false, headers);

export function listTasks(): Promise<TaskDto[]> {
  return authFetch<TaskDto[]>("/api/v1/tasks");
}

export function listWorkflowDefinitions(): Promise<WorkflowDefinitionDto[]> {
  return authFetch<WorkflowDefinitionDto[]>("/api/v1/workflow-definitions");
}

export function listWorkflowInstances(): Promise<WorkflowInstanceDto[]> {
  return authFetch<WorkflowInstanceDto[]>("/api/v1/workflow-instances");
}

export function createWorkflowDefinition(
  payload: CreateWorkflowPayload,
): Promise<WorkflowDefinitionDto> {
  return authPost<WorkflowDefinitionDto>("/api/v1/workflow-definitions", payload);
}

export interface ExpressionFieldErrorDto {
  field: string;
  message: string;
}

export interface ExpressionValidationDto {
  valid: boolean;
  errors: ExpressionFieldErrorDto[];
}

/**
 * Dry-runs an edge or node condition. A blank expression is valid and means the transition is
 * unconditional; field-level errors are returned for inline rendering in the designer.
 */
export function validateWorkflowExpression(expression: string): Promise<ExpressionValidationDto> {
  return authPost<ExpressionValidationDto>("/api/v1/workflow-definitions/validate-expression", {
    expression,
  });
}

export function createFormDefinition(name: string, schemaJson: string): Promise<FormDefinitionDto> {
  return authPost<FormDefinitionDto>("/api/v1/forms", { name, schemaJson });
}

export function approveTask(id: string, comment?: string): Promise<TaskDto> {
  return authPost<TaskDto>(`/api/v1/tasks/${id}/approve`, { comment });
}

export function rejectTask(id: string, comment?: string): Promise<TaskDto> {
  return authPost<TaskDto>(`/api/v1/tasks/${id}/reject`, { comment });
}

export function startWorkflowInstance(
  workflowDefinitionId: string,
  contextJson = "{}",
): Promise<WorkflowInstanceDto> {
  return authPost<WorkflowInstanceDto>("/api/v1/workflow-instances", {
    workflowDefinitionId,
    contextJson,
  });
}

export function listCompanies(): Promise<CompanyDto[]> {
  return authFetch<CompanyDto[]>("/api/v1/organizations/companies");
}

export interface OrgUserDto {
  id: string;
  email: string;
  fullName: string;
}

export interface TeamTreeDto {
  id: string;
  name: string;
  users: OrgUserDto[];
}

export interface DepartmentTreeDto {
  id: string;
  name: string;
  teams: TeamTreeDto[];
}

export interface CompanyTreeDto {
  id: string;
  name: string;
  departments: DepartmentTreeDto[];
}

export function fetchOrganizationTree(): Promise<CompanyTreeDto[]> {
  return authFetch<CompanyTreeDto[]>("/api/v1/organizations/tree");
}

export interface FormDefinitionDetailDto extends FormDefinitionDto {
  schemaJson: string;
}

export function fetchFormDefinitions(): Promise<FormDefinitionDto[]> {
  return authFetch<FormDefinitionDto[]>("/api/v1/forms");
}

export function fetchFormDefinition(id: string): Promise<FormDefinitionDetailDto> {
  return authFetch<FormDefinitionDetailDto>(`/api/v1/forms/${id}`);
}

export interface SubmitFormPayload {
  dataJson: string;
  workflowInstanceId?: string | null;
  nodeExecutionId?: string | null;
}

export interface FormSubmissionFileDto {
  fileId: string;
  name: string;
  size: number;
  contentType: string | null;
  scanStatus: string;
}

export interface FormSubmissionDto {
  id: string;
  formId: string;
  workflowInstanceId: string | null;
  dataJson: string;
  submittedBy: string | null;
  createdAt: string;
  files: FormSubmissionFileDto[];
}

export function submitForm(formId: string, payload: SubmitFormPayload): Promise<FormSubmissionDto> {
  return authPost<FormSubmissionDto>(`/api/v1/forms/${formId}/submissions`, payload);
}

export interface AnalyticsAggregateDto {
  day: string;
  eventType: string;
  count: number;
  totalDurationMs: number;
  averageDurationMs: number;
}

export function fetchAnalyticsSummary(
  from?: string,
  to?: string,
): Promise<AnalyticsAggregateDto[]> {
  const params = new URLSearchParams();
  if (from) {
    params.set("from", from);
  }
  if (to) {
    params.set("to", to);
  }
  const query = params.toString();
  return authFetch<AnalyticsAggregateDto[]>(`/api/v1/analytics/summary${query ? `?${query}` : ""}`);
}

export interface AnalyticsPercentileSetDto {
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  sampleCount: number;
}

export interface AnalyticsTimeBucketDto {
  bucket: string;
  total: number;
  counts: Record<string, number>;
}

export interface AnalyticsBottleneckDto {
  nodeId: string;
  count: number;
  averageDurationMs: number;
  p95DurationMs: number;
}

export interface AnalyticsGroupSummaryDto {
  key: string;
  count: number;
  averageDurationMs: number;
  p95DurationMs: number;
}

export interface AnalyticsDashboardDto {
  from: string;
  to: string;
  granularity: string;
  timezone: string;
  dataCompleteness: {
    dailyTotalsAvailable: boolean;
    rawEventsAvailable: boolean;
    sampleCount: number;
  };
  dailyTotals: AnalyticsAggregateDto[];
  timeBuckets: AnalyticsTimeBucketDto[];
  workflowDuration: AnalyticsPercentileSetDto;
  taskCycleTime: AnalyticsPercentileSetDto;
  approvalLatency: AnalyticsPercentileSetDto;
  failureRate: number;
  slaBreachRate: number;
  bottlenecks: AnalyticsBottleneckDto[];
  groups: AnalyticsGroupSummaryDto[];
  trend: {
    currentCount: number;
    previousCount: number;
    delta: number;
  };
}

export interface AnalyticsDashboardParams {
  from?: string | undefined;
  to?: string | undefined;
  granularity?: "DAY" | "WEEK" | "MONTH" | undefined;
  groupBy?: "EVENT_TYPE" | "NODE" | "WORKFLOW" | undefined;
  limit?: number | undefined;
}

/** Advanced dashboard aggregations; every value comes from the backend contract. */
export function fetchAnalyticsDashboard(
  params: AnalyticsDashboardParams = {},
): Promise<AnalyticsDashboardDto> {
  const search = new URLSearchParams();
  if (params.from) {
    search.set("from", params.from);
  }
  if (params.to) {
    search.set("to", params.to);
  }
  if (params.granularity) {
    search.set("granularity", params.granularity);
  }
  if (params.groupBy) {
    search.set("groupBy", params.groupBy);
  }
  if (params.limit !== undefined) {
    search.set("limit", String(params.limit));
  }
  const query = search.toString();
  return authFetch<AnalyticsDashboardDto>(`/api/v1/analytics/dashboard${query ? `?${query}` : ""}`);
}

export interface DocumentVersionDto {
  id: string;
  fileId: string;
  version: number;
  size: number;
  format: string | null;
  status: string;
  createdAt: string;
  /** Display name from the quarantine record; escaped by React before rendering. */
  name: string | null;
  /** Antivirus lifecycle: QUARANTINED, SCANNING, CLEAN, PROMOTED, INFECTED or SCAN_FAILED. */
  scanStatus: string | null;
  scanError: string | null;
  /** True only after the file reached PROMOTED and a presigned download can be issued. */
  downloadable: boolean;
}

/** Absolute URL of the tenant-scoped document scan SSE stream. */
export function documentScanEventsUrl(fileId?: string): string {
  const query = fileId ? `?fileId=${encodeURIComponent(fileId)}` : "";
  return `${apiBase()}/api/v1/documents/events${query}`;
}

export interface CreateDocumentResponseDto {
  fileId: string;
  uploadUrl: string;
  version: DocumentVersionDto;
}

export function listDocuments(): Promise<DocumentVersionDto[]> {
  return authFetch<DocumentVersionDto[]>("/api/v1/documents");
}

export function createDocumentUpload(
  name: string,
  contentType: string,
  size: number,
): Promise<CreateDocumentResponseDto> {
  return authPost<CreateDocumentResponseDto>("/api/v1/documents", {
    name,
    contentType,
    size,
  });
}

export function getDocumentDownloadUrl(fileId: string): Promise<{ downloadUrl: string }> {
  return authFetch<{ downloadUrl: string }>(`/api/v1/documents/${fileId}/download`);
}

export function archiveDocumentVersion(versionId: string): Promise<DocumentVersionDto> {
  return authPost<DocumentVersionDto>(`/api/v1/documents/versions/${versionId}/archive`, {});
}

export interface NotificationTemplateDto {
  id: string;
  templateKey: string;
  locale: string;
  subject: string;
  body: string;
  version: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNotificationTemplatePayload {
  templateKey: string;
  locale: string;
  subject: string;
  body: string;
}

export interface UpdateNotificationTemplatePayload {
  expectedVersion: number;
  subject: string;
  body: string;
}

export interface NotificationTemplatePreviewDto {
  subject: string;
  body: string;
  placeholders: string[];
}

export function listNotificationTemplates(
  templateKey?: string,
): Promise<NotificationTemplateDto[]> {
  const query = templateKey ? `?templateKey=${encodeURIComponent(templateKey)}` : "";
  return authFetch<NotificationTemplateDto[]>(`/api/v1/notification-templates${query}`);
}

export function createNotificationTemplate(
  payload: CreateNotificationTemplatePayload,
): Promise<NotificationTemplateDto> {
  return authPost<NotificationTemplateDto>("/api/v1/notification-templates", payload);
}

export function updateNotificationTemplate(
  id: string,
  payload: UpdateNotificationTemplatePayload,
): Promise<NotificationTemplateDto> {
  return authPut<NotificationTemplateDto>(
    `/api/v1/notification-templates/${encodeURIComponent(id)}`,
    payload,
  );
}

export function archiveNotificationTemplate(id: string): Promise<NotificationTemplateDto> {
  return authPost<NotificationTemplateDto>(
    `/api/v1/notification-templates/${encodeURIComponent(id)}/archive`,
    {},
  );
}

export function activateNotificationTemplate(id: string): Promise<NotificationTemplateDto> {
  return authPost<NotificationTemplateDto>(
    `/api/v1/notification-templates/${encodeURIComponent(id)}/activate`,
    {},
  );
}

export function previewNotificationTemplate(payload: {
  templateKey?: string;
  locale?: string;
  subject?: string;
  body?: string;
  variablesJson?: string;
}): Promise<NotificationTemplatePreviewDto> {
  return authPost<NotificationTemplatePreviewDto>(
    "/api/v1/notification-templates/preview",
    payload,
  );
}

export interface NotificationDeliveryDto {
  id: string;
  channel: string;
  recipient: string;
  templateKey: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  read: boolean;
  readAt: string | null;
}

export interface UnreadNotificationCountDto {
  count: number;
}

export function listNotifications(unreadOnly = false): Promise<NotificationDeliveryDto[]> {
  const query = unreadOnly ? "?unreadOnly=true" : "";
  return authFetch<NotificationDeliveryDto[]>(`/api/v1/notifications${query}`);
}

export function fetchUnreadNotificationCount(): Promise<UnreadNotificationCountDto> {
  return authFetch<UnreadNotificationCountDto>("/api/v1/notifications/unread-count");
}

export function markNotificationRead(id: string): Promise<NotificationDeliveryDto> {
  return authPatch<NotificationDeliveryDto>(`/api/v1/notifications/${encodeURIComponent(id)}/read`);
}

export function markNotificationUnread(id: string): Promise<NotificationDeliveryDto> {
  return authPatch<NotificationDeliveryDto>(
    `/api/v1/notifications/${encodeURIComponent(id)}/unread`,
  );
}

export interface CopilotToolCallDto {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  ok: boolean;
  error: string | null;
}

export interface CopilotResponseDto {
  answer: string;
  action: string;
  confidence: number;
  requires_human_approval: boolean;
  tool_calls: CopilotToolCallDto[];
  data: unknown;
  model: string | null;
  model_tier: string | null;
  prompt_version: string;
  correlation_id: string;
  idempotency_key: string | null;
}

export interface CopilotChatPayload {
  message: string;
  action?: string;
  context?: Record<string, unknown>;
  idempotency_key?: string;
  confirm_high_risk?: boolean;
}

export interface CopilotApprovalPayload {
  workflow_instance_id: string;
  title: string;
  description?: string;
  assignee_id?: string;
  /** Explicit human confirmation for the second call; never set by the transport. */
  confirm?: boolean;
  /** Proposal id and payload hash returned by the proposal step (issue #296). */
  proposal_id?: string;
  proposal_hash?: string;
  idempotency_key?: string;
}

export function copilotChat(payload: CopilotChatPayload): Promise<CopilotResponseDto> {
  return authPostWithHeaders<CopilotResponseDto>(
    "/api/v1/copilot/chat",
    payload,
    idempotencyHeader(payload.idempotency_key),
  );
}

function idempotencyHeader(key?: string): Record<string, string> | undefined {
  return key ? { "Idempotency-Key": key } : undefined;
}

export function copilotTasks(): Promise<CopilotResponseDto> {
  return authFetch<CopilotResponseDto>("/api/v1/copilot/tasks");
}

/**
 * Propose (confirm=false) or confirm (confirm=true) an approval task.
 *
 * The first call creates nothing and returns a proposal id/hash; the caller must echo both on the
 * confirmed second call. The UI never sends `confirm: true` without a proposal.
 */
export function copilotApprovalAssistance(
  payload: CopilotApprovalPayload,
): Promise<CopilotResponseDto> {
  return authPostWithHeaders<CopilotResponseDto>(
    "/api/v1/copilot/approvals",
    payload,
    idempotencyHeader(payload.idempotency_key),
  );
}

export function copilotTaskDecision(
  taskId: string,
  decision: "approve" | "reject" | "complete",
  comment?: string,
  confirmHighRisk = false,
  idempotencyKey?: string,
): Promise<CopilotResponseDto> {
  return authPostWithHeaders<CopilotResponseDto>(
    `/api/v1/copilot/tasks/${encodeURIComponent(taskId)}/complete`,
    { decision, comment, confirm_high_risk: confirmHighRisk },
    idempotencyHeader(idempotencyKey),
  );
}

export function copilotKnowledgeSearch(query: string): Promise<CopilotResponseDto> {
  return authPost<CopilotResponseDto>("/api/v1/copilot/knowledge/search", { query, limit: 10 });
}
