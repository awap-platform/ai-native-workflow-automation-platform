import { clearSessionExpiry, setSessionExpiry } from "./auth";
import { safeReturnTo } from "./redirect";
import { recordServerClock } from "./serverClock";

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
  /** `APPROVAL` or `GENERIC`; older payloads may omit it. */
  taskType?: string | null;
  escalated?: boolean;
  /** Server-side SLA deadline; the countdown never invents one. */
  escalateAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
}

export interface WorkflowDefinitionDto {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: string;
  currentVersion: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  createdBy?: string | null;
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
  updatedAt?: string | null;
  parentInstanceId?: string | null;
}

export interface ExecutionLogDto {
  id: string;
  workflowInstanceId: string;
  nodeId: string | null;
  nodeType: string | null;
  action: string;
  payload: string | null;
  createdAt: string;
}

export interface SagaStepDto {
  id: string;
  stepOrder: number;
  nodeId: string;
  nodeType: string;
  actionType: string;
  compensationType: string | null;
  status: string;
  attempts: number;
  maxAttempts: number;
  retryBackoffMs: number;
  timeoutSeconds: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  compensatedAt: string | null;
}

export interface SagaDto {
  id: string;
  tenantId: string;
  workflowInstanceId: string;
  sagaKey: string;
  status: string;
  failureReason: string | null;
  compensationStartedAt: string | null;
  compensationCompletedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
  steps: SagaStepDto[];
}

export interface ReplayReportDto {
  instanceId: string;
  dryRun: boolean;
  result: string;
  errorCode?: string | null;
  projection: {
    instanceId: string;
    state: string;
    currentNodeId: string | null;
    nodeStatuses: Record<string, string>;
    appliedActions: number;
  } | null;
  divergences: Array<{ type: string; nodeId: string | null; detail: string | null }>;
  logRows: number;
  logPages: number;
  durationMs: number;
  stateHash: string;
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

/** Update payload with the updatedAt token loaded by the designer. */
export interface UpdateWorkflowPayload extends CreateWorkflowPayload {
  expectedUpdatedAt: string;
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
    throw new ApiError(
      response.status,
      await readErrorDetail(response, "Failed to load tenants"),
      correlationHeader(response),
      parseRetryAfter(response),
    );
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
    throw new ApiError(
      response.status,
      await readErrorDetail(response, "Registration failed"),
      correlationHeader(response),
    );
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

/** Reads `Retry-After` as seconds when the backend supplies one. */
export function parseRetryAfter(response: Response): number | undefined {
  const raw = response.headers?.get?.("retry-after");
  if (!raw) {
    return undefined;
  }
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds);
  }
  const date = Date.parse(raw);
  if (Number.isNaN(date)) {
    return undefined;
  }
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

/**
 * Enumeration-safe login.
 *
 * Invalid credentials, an unknown tenant and a forbidden account all return the
 * same message to the UI. Rate-limit and temporary-unavailability responses keep
 * their actionable copy and `Retry-After`.
 */
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
    const correlationId = correlationHeader(response);
    const retryAfter = parseRetryAfter(response);
    if (response.status === 429) {
      throw new ApiError(
        429,
        "Too many attempts. Please wait before trying again.",
        correlationId,
        retryAfter,
      );
    }
    if (response.status === 503) {
      throw new ApiError(
        503,
        "Sign-in is temporarily unavailable. Try again shortly.",
        correlationId,
        retryAfter,
      );
    }
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new ApiError(response.status, "Email or password is incorrect.", correlationId);
    }
    throw new ApiError(
      response.status,
      await readErrorDetail(response, "Login failed"),
      correlationId,
      retryAfter,
    );
  }
  const tokens = (await response.json()) as TokenDto;
  setSessionExpiry(tokens.expiresIn);
  return tokens;
}

/** Reads the correlation ID the backend echoes on every response (issue #191). */
export function correlationHeader(response: Response): string | undefined {
  const value = response.headers?.get?.("x-correlation-id");
  return value ?? undefined;
}

/** Error thrown by every API call; `status` lets the query layer classify retries. */
export class ApiError extends Error {
  readonly status: number;
  /** Correlation ID echoed by the backend, surfaced in error states for support. */
  readonly correlationId: string | undefined;
  /** Seconds until a rate-limited request may be retried. */
  readonly retryAfterSeconds: number | undefined;

  constructor(status: number, message: string, correlationId?: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.correlationId = correlationId;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** HTTP status of an error when it came from the API layer. */
export function errorStatus(error: unknown): number | undefined {
  return error instanceof ApiError ? error.status : undefined;
}

/** Correlation ID of an error when it came from the API layer. */
export function correlationIdOf(error: unknown): string | undefined {
  return error instanceof ApiError ? error.correlationId : undefined;
}

async function refreshAccessToken(): Promise<boolean> {
  try {
    const response = await fetch(`${apiBase()}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: "{}",
    });
    if (!response.ok) {
      if (response.status === 401) {
        clearSessionExpiry();
      }
      return false;
    }
    const tokens = (await response.json()) as TokenDto;
    if (tokens.expiresIn > 0) {
      setSessionExpiry(tokens.expiresIn);
    }
    return true;
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
    // `returnTo` is validated so a malicious query string cannot become an open redirect.
    const current = `${window.location.pathname}${window.location.search}`;
    const returnTo = safeReturnTo(current);
    const query = new URLSearchParams({ reason: "expired", returnTo });
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload re-runs the middleware auth check
    window.location.assign(`/?${query.toString()}`);
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
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  retried = false,
  extraHeaders?: Record<string, string>,
  signal?: AbortSignal,
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
    ...(signal === undefined ? {} : { signal }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  logApi(method, path, response.status, started);
  recordServerClock(response);

  if (response.status === 401 && !retried && (await refreshSession())) {
    return apiRequest<T>(method, path, body, true, extraHeaders, signal);
  }
  if (response.status === 401) {
    redirectToLogin();
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      await readErrorDetail(response, `${method} ${path.split("?")[0]} failed`),
      correlationHeader(response),
      parseRetryAfter(response),
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

const authFetch = <T>(path: string): Promise<T> => apiRequest<T>("GET", path);
const authPatch = <T>(path: string, body?: unknown): Promise<T> =>
  apiRequest<T>("PATCH", path, body);
const authPut = <T>(path: string, body: unknown): Promise<T> => apiRequest<T>("PUT", path, body);
const authPost = <T>(path: string, body: unknown): Promise<T> => apiRequest<T>("POST", path, body);
const authDelete = <T>(path: string): Promise<T> => apiRequest<T>("DELETE", path);
const authPostWithHeaders = <T>(
  path: string,
  body: unknown,
  headers?: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> => apiRequest<T>("POST", path, body, false, headers, signal);

export interface CurrentUserDto {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  role: string;
}

/** Profile of the authenticated user, used by onboarding and the shell. */
export function fetchCurrentUser(): Promise<CurrentUserDto> {
  return authFetch<CurrentUserDto>("/api/v1/auth/me");
}

export interface InvitationTenantDto {
  id: string;
  slug: string;
  name: string;
}

export interface AcceptInvitationPayload {
  fullName?: string;
  password?: string;
}

/**
 * Public invitation acceptance. Sends no auth redirect; the endpoint identifies
 * the invitee by the token. Existing users may omit the password.
 */
export async function acceptInvitation(
  token: string,
  payload: AcceptInvitationPayload = {},
): Promise<InvitationTenantDto> {
  const started = performance.now();
  const response = await fetch(
    `${apiBase()}/api/v1/tenant-invitations/${encodeURIComponent(token)}/accept`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await csrfHeaders()) },
      credentials: "include",
      body: JSON.stringify(payload),
    },
  );
  logApi("POST", `/api/v1/tenant-invitations/${token}/accept`, response.status, started);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      await readErrorDetail(response, "The invitation could not be accepted."),
      correlationHeader(response),
      parseRetryAfter(response),
    );
  }
  return (await response.json()) as InvitationTenantDto;
}

export interface InvitationDto {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  expiresAt: string;
  token: string;
}

/** Creates a tenant invitation; the response includes the one-time raw token. */
export function inviteTenantUser(
  tenantId: string,
  email: string,
  role: string,
): Promise<InvitationDto> {
  return authPost<InvitationDto>(`/api/v1/tenants/${encodeURIComponent(tenantId)}/invitations`, {
    email,
    role,
  });
}

export function listTasks(): Promise<TaskDto[]> {
  return authFetch<TaskDto[]>("/api/v1/tasks");
}

/** Tasks assigned to the signed-in user; the inbox "mine" view reads this contract directly. */
export function listMyTasks(): Promise<TaskDto[]> {
  return authFetch<TaskDto[]>("/api/v1/tasks/mine");
}

export function listWorkflowDefinitions(): Promise<WorkflowDefinitionDto[]> {
  return authFetch<WorkflowDefinitionDto[]>("/api/v1/workflow-definitions");
}

export function listWorkflowInstances(): Promise<WorkflowInstanceDto[]> {
  return authFetch<WorkflowInstanceDto[]>("/api/v1/workflow-instances");
}

export function fetchWorkflowInstance(id: string): Promise<WorkflowInstanceDto> {
  return authFetch<WorkflowInstanceDto>(`/api/v1/workflow-instances/${id}`);
}

export function fetchInstanceLogs(id: string): Promise<ExecutionLogDto[]> {
  return authFetch<ExecutionLogDto[]>(`/api/v1/workflow-instances/${id}/logs`);
}

export function fetchInstanceSaga(id: string): Promise<SagaDto> {
  return authFetch<SagaDto>(`/api/v1/workflow-instances/${id}/saga`);
}

export type InstanceAction = "retry" | "pause" | "resume" | "cancel" | "fail" | "recover";

/** Operator action on one instance; the response is the authoritative new state. */
export function runInstanceAction(
  id: string,
  action: InstanceAction,
): Promise<WorkflowInstanceDto> {
  return authPost<WorkflowInstanceDto>(`/api/v1/workflow-instances/${id}/${action}`, undefined);
}

/** Deterministic replay projection; writes only the audit row. */
export function replayDryRun(id: string): Promise<ReplayReportDto> {
  return authPost<ReplayReportDto>(
    `/api/v1/workflow-instances/${id}/replay?dryRun=true`,
    undefined,
  );
}

/** Applies the reference replay after a matching projection. */
export function replayInstance(id: string): Promise<WorkflowInstanceDto> {
  return authPost<WorkflowInstanceDto>(`/api/v1/workflow-instances/${id}/replay`, undefined);
}

export function compensateSaga(id: string): Promise<SagaDto> {
  return authPost<SagaDto>(`/api/v1/workflow-instances/${id}/saga/compensate`, undefined);
}

export function retrySagaStep(id: string, stepId: string): Promise<SagaDto> {
  return authPost<SagaDto>(
    `/api/v1/workflow-instances/${id}/saga/steps/${stepId}/retry`,
    undefined,
  );
}

export function createWorkflowDefinition(
  payload: CreateWorkflowPayload,
): Promise<WorkflowDefinitionDto> {
  return authPost<WorkflowDefinitionDto>("/api/v1/workflow-definitions", payload);
}

/** Updates an existing draft in place; a stale expectedUpdatedAt returns 409. */
export function updateWorkflowDefinition(
  id: string,
  payload: UpdateWorkflowPayload,
): Promise<WorkflowDefinitionDto> {
  return authPatch<WorkflowDefinitionDto>(
    `/api/v1/workflow-definitions/${encodeURIComponent(id)}`,
    payload,
  );
}

export function fetchWorkflowDefinition(id: string): Promise<WorkflowDefinitionDto> {
  return authFetch<WorkflowDefinitionDto>(`/api/v1/workflow-definitions/${id}`);
}

export interface WorkflowVersionDto {
  id?: string;
  version: number;
  definitionJson: string;
  status: string;
  archived: boolean;
  current: boolean;
  createdAt: string;
}

export function fetchWorkflowVersions(id: string): Promise<WorkflowVersionDto[]> {
  return authFetch<WorkflowVersionDto[]>(`/api/v1/workflow-definitions/${id}/versions`);
}

/** Publishes the latest draft version; a 409 means another tab published first. */
export function publishWorkflowDefinition(id: string): Promise<WorkflowDefinitionDto> {
  return authPost<WorkflowDefinitionDto>(`/api/v1/workflow-definitions/${id}/publish`, undefined);
}

export function rollbackWorkflowDefinition(
  id: string,
  version: number,
): Promise<WorkflowDefinitionDto> {
  return authPost<WorkflowDefinitionDto>(
    `/api/v1/workflow-definitions/${id}/rollback/${version}`,
    undefined,
  );
}

export function archiveWorkflowVersion(id: string, version: number): Promise<void> {
  return authPost<void>(
    `/api/v1/workflow-definitions/${id}/versions/${version}/archive`,
    undefined,
  );
}

export interface BpmnImportResultDto {
  definitionJson: string;
  warnings: string[];
}

export interface BpmnExportResultDto {
  bpmnXml: string;
}

/** Converts BPMN XML to a definition; the backend rejects XXE, invalid XML and oversized input. */
export function importWorkflowBpmn(bpmnXml: string): Promise<BpmnImportResultDto> {
  return authPost<BpmnImportResultDto>("/api/v1/workflow-definitions/bpmn/import", { bpmnXml });
}

export function exportWorkflowBpmn(definitionJson: string): Promise<BpmnExportResultDto> {
  return authPost<BpmnExportResultDto>("/api/v1/workflow-definitions/bpmn/export", {
    definitionJson,
  });
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

/** Saves a new version of an existing form; the server increments `version`. */
export function updateFormDefinition(
  id: string,
  name: string,
  schemaJson: string,
): Promise<FormDefinitionDto> {
  return authPut<FormDefinitionDto>(`/api/v1/forms/${id}`, { name, schemaJson });
}

export function approveTask(id: string, comment?: string): Promise<TaskDto> {
  return authPost<TaskDto>(`/api/v1/tasks/${id}/approve`, { comment });
}

export function rejectTask(id: string, comment?: string): Promise<TaskDto> {
  return authPost<TaskDto>(`/api/v1/tasks/${id}/reject`, { comment });
}

/** Assigns (or reassigns) a task; the response carries the authoritative status and version. */
export function assignTask(id: string, assigneeId: string): Promise<TaskDto> {
  return authPost<TaskDto>(`/api/v1/tasks/${id}/assign`, { assigneeId });
}

/** Claims an unassigned task for the signed-in user. */
export function claimTask(id: string): Promise<TaskDto> {
  return authPost<TaskDto>(`/api/v1/tasks/${id}/claim`, undefined);
}

/** Completes an assigned or in-progress task. */
export function completeTask(id: string): Promise<TaskDto> {
  return authPost<TaskDto>(`/api/v1/tasks/${id}/complete`, undefined);
}

/** Escalates to another assignee and restarts the one-hour SLA window on the server. */
export function escalateTask(id: string, assigneeId: string): Promise<TaskDto> {
  return authPost<TaskDto>(`/api/v1/tasks/${id}/escalate`, { assigneeId });
}

export type TaskActionKind = "approve" | "reject" | "complete" | "claim" | "assign" | "escalate";

export interface TaskActionInput {
  id: string;
  action: TaskActionKind;
  comment?: string;
  assigneeId?: string;
}

/** Single seam for every work item action so bulk execution reuses the same behaviour. */
export function runTaskAction({
  id,
  action,
  comment,
  assigneeId,
}: TaskActionInput): Promise<TaskDto> {
  switch (action) {
    case "approve":
      return approveTask(id, comment);
    case "reject":
      return rejectTask(id, comment);
    case "complete":
      return completeTask(id);
    case "claim":
      return claimTask(id);
    case "assign":
    case "escalate":
      if (!assigneeId) {
        return Promise.reject(new ApiError(400, "Choose an assignee first."));
      }
      return action === "assign" ? assignTask(id, assigneeId) : escalateTask(id, assigneeId);
  }
}

export function startWorkflowInstance(
  workflowDefinitionId: string,
  contextJson = "{}",
  idempotencyKey?: string,
): Promise<WorkflowInstanceDto> {
  return authPost<WorkflowInstanceDto>("/api/v1/workflow-instances", {
    workflowDefinitionId,
    contextJson,
    ...(idempotencyKey ? { idempotencyKey } : {}),
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

/** Immutable schema snapshot for the version a historical submission answered (#370). */
export interface FormSchemaVersionDto {
  id: string;
  formId: string;
  version: number;
  schemaJson: string;
  schemaHash: string;
  createdAt: string;
}

export function fetchFormSchemaVersion(id: string, version: number): Promise<FormSchemaVersionDto> {
  return authFetch<FormSchemaVersionDto>(
    `/api/v1/forms/${encodeURIComponent(id)}/versions/${version}`,
  );
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
  /** Version of the form definition that was answered (phase 6). */
  formVersion?: number;
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

/** Version history of one document, oldest first. */
export function listDocumentVersions(fileId: string): Promise<DocumentVersionDto[]> {
  return authFetch<DocumentVersionDto[]>(
    `/api/v1/documents/${encodeURIComponent(fileId)}/versions`,
  );
}

export function archiveDocumentVersion(versionId: string): Promise<DocumentVersionDto> {
  return authPost<DocumentVersionDto>(`/api/v1/documents/versions/${versionId}/archive`, {});
}

/** Soft-deletes a version. Used to clean up a pending slot after an interrupted upload. */
export function deleteDocumentVersion(versionId: string): Promise<DocumentVersionDto> {
  return authDelete<DocumentVersionDto>(
    `/api/v1/documents/versions/${encodeURIComponent(versionId)}`,
  );
}

export interface ScanRetryResponseDto {
  fileId: string;
  scanStatus: string;
  detail: string | null;
}

/** Re-queues a SCAN_FAILED file; any other scan state answers 409. */
export function retryDocumentScan(fileId: string): Promise<ScanRetryResponseDto> {
  return authPost<ScanRetryResponseDto>(
    `/api/v1/documents/${encodeURIComponent(fileId)}/retry-scan`,
    {},
  );
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
  nextAttemptAt?: string | null;
  createdAt: string;
  businessKey?: string | null;
  dedupeExpiresAt?: string | null;
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

/**
 * Chrome-only unread badge.
 *
 * A background badge must never refresh an expired token or redirect the user to
 * the login page. Unlike `fetchUnreadNotificationCount`, this helper returns
 * `null` for any failure and performs no auth side effects.
 */
export async function fetchUnreadNotificationCountSilent(): Promise<UnreadNotificationCountDto | null> {
  const headers: Record<string, string> = {};
  const tenant = activeTenantId();
  if (tenant) {
    headers["X-Tenant-Id"] = tenant;
  }
  try {
    const response = await fetch(`${apiBase()}/api/v1/notifications/unread-count`, {
      headers,
      credentials: "include",
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as UnreadNotificationCountDto;
  } catch {
    return null;
  }
}

export interface NotificationSuppressionDto {
  id: string;
  channel: string;
  recipient: string;
  reason: string;
  createdAt: string;
}

/** Recipients permanently blocked on one channel after a bounce or complaint. */
export function listNotificationSuppressions(): Promise<NotificationSuppressionDto[]> {
  return authFetch<NotificationSuppressionDto[]>("/api/v1/notifications/suppressions");
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

export interface CopilotCitationDto {
  index: number;
  title: string;
  document_id: string;
  chunk_index: number;
  score?: number | null;
}

export interface CopilotBudgetDto {
  remaining_tokens: number | null;
  monthly_budget_tokens: number | null;
  used_tokens: number | null;
  estimated_cost_micros: number | null;
}

export interface CopilotWarningDto {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
}

export interface CopilotGuardrailDto {
  policy: string | null;
  decision: string;
  score: number;
  version: string;
  unavailable: boolean;
}

export interface CopilotAuditDto {
  request_id: string;
  action: string;
  outcome: string | null;
  confidence: number;
  requires_human_approval: boolean;
  tool_calls: CopilotToolCallDto[];
  idempotency_key: string | null;
  correlation_id: string;
  prompt_key: string;
  prompt_version: string;
  prompt_hash: string;
  model: string | null;
  model_tier: string | null;
  routing_reason: string | null;
  proposal_id: string | null;
  proposal_hash: string | null;
  decision: string | null;
  retrieved_document_ids: string[];
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
  /** Phase 9 enrichment; older deployments may omit these fields. */
  outcome?: string | null;
  citations?: CopilotCitationDto[] | null;
  budget?: CopilotBudgetDto | null;
  warnings?: CopilotWarningDto[] | null;
  guardrail?: CopilotGuardrailDto | null;
  audit?: CopilotAuditDto | null;
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

export function copilotChat(
  payload: CopilotChatPayload,
  signal?: AbortSignal,
): Promise<CopilotResponseDto> {
  return authPostWithHeaders<CopilotResponseDto>(
    "/api/v1/copilot/chat",
    payload,
    idempotencyHeader(payload.idempotency_key),
    signal,
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
  signal?: AbortSignal,
): Promise<CopilotResponseDto> {
  return authPostWithHeaders<CopilotResponseDto>(
    "/api/v1/copilot/approvals",
    payload,
    idempotencyHeader(payload.idempotency_key),
    signal,
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

/* ------------------------------------------------------- phase 8 admin */

export interface AdminUserDto {
  id: string;
  email: string;
  fullName: string;
  role: string;
  deleted: boolean;
  createdAt: string;
}

export interface AdminGroupDto {
  id: string;
  name: string;
  memberCount: number;
}

export interface AdminRoleDto {
  name: string;
  rank: number;
  permissions: string[];
}

export interface AdminPermissionDto {
  name: string;
}

export interface AdminInvitationDto {
  id: string;
  email: string;
  role: string;
  consumed: boolean;
  expiresAt: string;
  createdAt: string;
}

export interface AdminIdentityDto {
  tenantId: string;
  plan: string;
  maxUsers: number;
  maxWorkflows: number;
  maxAiCallsPerMonth: number;
  usersUsed: number;
  workflowsUsed: number;
  users: AdminUserDto[];
  groups: AdminGroupDto[];
  roles: AdminRoleDto[];
  permissions: AdminPermissionDto[];
  invitations: AdminInvitationDto[];
}

export interface AdminOperateDto {
  tenantId: string;
  generatedAt: string;
  workflows: { total: number; published: number; draft: number };
  instances: { total: number; running: number; failed: number; completed: number };
  tasks: { total: number; open: number; completed: number };
  outbox: { pending: number; exhausted: number };
  dlq: { failed: number };
  jobs: Array<{ name: string; status: string; detail: string }>;
}

export interface AdminAuditEntryDto {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  oldValue: string | null;
  newValue: string | null;
  actorId: string | null;
  createdAt: string;
}

export interface AdminAuditPageDto {
  items: AdminAuditEntryDto[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface AdminDlqDeliveryDto {
  id: string;
  channel: string;
  recipient: string;
  templateKey: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export interface AdminDlqRetryDto {
  id: string;
  status: string;
  attempts: number;
  detail: string;
}

export interface AdminInvitationCreatedDto {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  token: string;
}

export interface BreakGlassLogDto {
  available: boolean;
  log: Record<string, unknown> | null;
}

export interface UsageMetricDto {
  key: string;
  unit: string;
  total: number;
  limit: number;
  remaining: number;
  days: Array<{ day: string; value: number }>;
}

export interface TenantUsageDto {
  tenantId: string;
  from: string;
  to: string;
  metrics: UsageMetricDto[];
}

function tenantQuery(tenantId?: string): string {
  return tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
}

export function fetchAdminIdentity(tenantId?: string): Promise<AdminIdentityDto> {
  return authFetch<AdminIdentityDto>(`/api/v1/admin/identity${tenantQuery(tenantId)}`);
}

export function fetchAdminOperate(tenantId?: string): Promise<AdminOperateDto> {
  return authFetch<AdminOperateDto>(`/api/v1/admin/operate${tenantQuery(tenantId)}`);
}

export function fetchAdminAudit(
  tenantId?: string,
  cursor?: string,
  limit = 25,
): Promise<AdminAuditPageDto> {
  const params = new URLSearchParams();
  if (tenantId) {
    params.set("tenantId", tenantId);
  }
  if (cursor) {
    params.set("cursor", cursor);
  }
  params.set("limit", String(limit));
  return authFetch<AdminAuditPageDto>(`/api/v1/admin/audit?${params.toString()}`);
}

export function updateAdminUserRole(
  tenantId: string | undefined,
  userId: string,
  role: string,
): Promise<AdminUserDto> {
  return authPut<AdminUserDto>(
    `/api/v1/admin/users/${encodeURIComponent(userId)}/role${tenantQuery(tenantId)}`,
    { role },
  );
}

export function deleteAdminUser(tenantId: string | undefined, userId: string): Promise<void> {
  return authDelete<void>(
    `/api/v1/admin/users/${encodeURIComponent(userId)}${tenantQuery(tenantId)}`,
  );
}

export function createAdminInvitation(
  tenantId: string | undefined,
  email: string,
  role: string,
): Promise<AdminInvitationCreatedDto> {
  return authPost<AdminInvitationCreatedDto>(`/api/v1/admin/invitations${tenantQuery(tenantId)}`, {
    email,
    role,
  });
}

export function fetchAdminDlq(tenantId?: string): Promise<AdminDlqDeliveryDto[]> {
  return authFetch<AdminDlqDeliveryDto[]>(`/api/v1/admin/dlq${tenantQuery(tenantId)}`);
}

export function retryAdminDlq(
  tenantId: string | undefined,
  deliveryId: string,
): Promise<AdminDlqRetryDto> {
  return authPost<AdminDlqRetryDto>(
    `/api/v1/admin/dlq/${encodeURIComponent(deliveryId)}/retry${tenantQuery(tenantId)}`,
    {},
  );
}

export function fetchBreakGlassLog(): Promise<BreakGlassLogDto> {
  return authFetch<BreakGlassLogDto>("/api/v1/admin/break-glass");
}

export function fetchTenantUsage(
  tenantId: string,
  from?: string,
  to?: string,
): Promise<TenantUsageDto> {
  const params = new URLSearchParams();
  if (from) {
    params.set("from", from);
  }
  if (to) {
    params.set("to", to);
  }
  const query = params.toString();
  return authFetch<TenantUsageDto>(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/usage${query ? `?${query}` : ""}`,
  );
}

/* -------------------------------------------------- phase 8 analytics */

export interface AnalyticsEventTotalDto {
  eventType: string;
  count: number;
  totalDurationMs: number;
  averageDurationMs: number;
}

export interface AnalyticsOverviewDto {
  dashboard: AnalyticsDashboardDto;
  eventTotals: AnalyticsEventTotalDto[];
  totalEvents: number;
}

export interface AnalyticsDrilldownRowDto {
  id: string;
  eventType: string;
  workflowInstanceId: string | null;
  taskId: string | null;
  nodeId: string | null;
  durationMs: number;
  occurredAt: string;
}

export interface AnalyticsDrilldownDto {
  from: string;
  to: string;
  eventType: string | null;
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  partial: boolean;
  detail: string | null;
  rows: AnalyticsDrilldownRowDto[];
}

export interface AnalyticsDrilldownParams extends AnalyticsDashboardParams {
  eventType?: string | undefined;
  page?: number | undefined;
  size?: number | undefined;
}

function analyticsQuery(params: AnalyticsDashboardParams = {}): string {
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
  return search.toString();
}

/** Single analytics metric source; cards, chart and totals all read this projection. */
export function fetchAnalyticsOverview(
  params: AnalyticsDashboardParams = {},
): Promise<AnalyticsOverviewDto> {
  const query = analyticsQuery(params);
  return authFetch<AnalyticsOverviewDto>(`/api/v1/analytics/overview${query ? `?${query}` : ""}`);
}

export function fetchAnalyticsDrilldown(
  params: AnalyticsDrilldownParams = {},
): Promise<AnalyticsDrilldownDto> {
  const search = new URLSearchParams(analyticsQuery(params));
  if (params.eventType) {
    search.set("eventType", params.eventType);
  }
  if (params.page !== undefined) {
    search.set("page", String(params.page));
  }
  if (params.size !== undefined) {
    search.set("size", String(params.size));
  }
  const query = search.toString();
  return authFetch<AnalyticsDrilldownDto>(`/api/v1/analytics/drilldown${query ? `?${query}` : ""}`);
}

export function analyticsExportUrl(params: AnalyticsDashboardParams = {}): string {
  const query = analyticsQuery(params);
  return `${apiBase()}/api/v1/analytics/export${query ? `?${query}` : ""}`;
}

export function adminAuditExportUrl(tenantId?: string, from?: string, to?: string): string {
  const params = new URLSearchParams();
  if (tenantId) {
    params.set("tenantId", tenantId);
  }
  if (from) {
    params.set("from", from);
  }
  if (to) {
    params.set("to", to);
  }
  const query = params.toString();
  return `${apiBase()}/api/v1/admin/audit/export${query ? `?${query}` : ""}`;
}
