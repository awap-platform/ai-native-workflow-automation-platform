import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  archiveDocumentVersion,
  archiveWorkflowVersion,
  approveTask,
  attachTaskFile,
  createAdminInvitation,
  createDocumentUpload,
  createFormDefinition,
  createWorkflowDefinition,
  compensateSaga,
  deleteAdminUser,
  exportWorkflowBpmn,
  fetchAdminAudit,
  fetchAdminDlq,
  fetchAdminIdentity,
  fetchAdminOperate,
  fetchAnalyticsDashboard,
  fetchAnalyticsDrilldown,
  fetchAnalyticsOverview,
  fetchAnalyticsSummary,
  fetchBreakGlassLog,
  fetchFormDefinition,
  fetchInstanceLogs,
  fetchInstanceSaga,
  fetchTaskActivity,
  fetchTaskAttachments,
  fetchTaskComments,
  fetchWorkflowDefinition,
  fetchWorkflowInstance,
  fetchWorkflowVersions,
  fetchFormDefinitions,
  fetchOrganizationTree,
  fetchTenantUsage,
  fetchTenants,
  getDocumentDownloadUrl,
  healthCheck,
  importWorkflowBpmn,
  listDocuments,
  listDocumentVersions,
  retryDocumentScan,
  listMyTasks,
  listTasks,
  listWorkflowDefinitions,
  listWorkflowInstances,
  publishWorkflowDefinition,
  registerTenant,
  rejectTask,
  createTaskComment,
  deleteTaskComment,
  replayDryRun,
  replayInstance,
  retryAdminDlq,
  retrySagaStep,
  rollbackWorkflowDefinition,
  runInstanceAction,
  runTaskAction,
  startWorkflowInstance,
  submitForm,
  updateAdminUserRole,
  updateFormDefinition,
  validateWorkflowExpression,
  type AnalyticsDashboardParams,
  type AnalyticsDrilldownParams,
  type CreateWorkflowPayload,
  type RegisterTenantPayload,
  type SubmitFormPayload,
  type TaskActionInput,
} from "../api";
import { queryKeys } from "../queryKeys";

/* ---------------------------------------------------------------- tasks */

/** Tenant task list. */
export function useTaskComments(taskId: string) {
  return useQuery({
    queryKey: queryKeys.tasks.comments(taskId || "none"),
    queryFn: () => fetchTaskComments(taskId),
    enabled: taskId !== "",
  });
}

export function useTaskAttachments(taskId: string) {
  return useQuery({
    queryKey: queryKeys.tasks.attachments(taskId || "none"),
    queryFn: () => fetchTaskAttachments(taskId),
    enabled: taskId !== "",
  });
}

export function useTaskActivity(taskId: string) {
  return useQuery({
    queryKey: queryKeys.tasks.activity(taskId || "none"),
    queryFn: () => fetchTaskActivity(taskId),
    enabled: taskId !== "",
  });
}

export function useAddTaskComment(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => createTaskComment(taskId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.comments(taskId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.activity(taskId) });
    },
  });
}

export function useDeleteTaskComment(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => deleteTaskComment(taskId, commentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.comments(taskId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.activity(taskId) });
    },
  });
}

export function useAttachTaskFile(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) => attachTaskFile(taskId, fileId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.attachments(taskId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.activity(taskId) });
    },
  });
}

export function useTasks() {
  return useQuery({ queryKey: queryKeys.tasks.list(), queryFn: listTasks });
}

/**
 * Tasks assigned to the current user. The inbox only asks for this list when the "mine" filter is
 * active, so every other view makes one tenant-scoped request instead of two.
 */
export function useMyTasks(enabled = true) {
  return useQuery({ queryKey: queryKeys.tasks.mine(), queryFn: listMyTasks, enabled });
}

/**
 * Runs any work-item action (approve, reject, complete, claim, assign, escalate).
 *
 * The response replaces the row in the cached list so the inbox updates before the revalidation
 * finishes; a failed mutation leaves the cache untouched, which keeps a 409 from silently
 * rewriting what the reviewer sees.
 */
export function useTaskAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TaskActionInput) => runTaskAction(input),
    onSuccess: (task) => {
      queryClient.setQueryData(queryKeys.tasks.list(), (current: (typeof task)[] | undefined) =>
        current?.map((entry) => (entry.id === task.id ? task : entry)),
      );
      return queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
}

/** Approve or reject a task; both decisions refresh the list the pages render. */
export function useDecideTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, approve, comment }: { id: string; approve: boolean; comment: string }) =>
      approve ? approveTask(id, comment) : rejectTask(id, comment),
    // The response is authoritative: write it into the cache before revalidating so the list
    // shows the new status immediately and a failed request leaves the cache untouched.
    onSuccess: (task) => {
      queryClient.setQueryData(queryKeys.tasks.list(), (current: (typeof task)[] | undefined) =>
        current?.map((entry) => (entry.id === task.id ? task : entry)),
      );
      return queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
}

/* ----------------------------------------------------------- workflows */

/** Published and draft workflow definitions. */
export function useWorkflowDefinitions() {
  return useQuery({
    queryKey: queryKeys.workflowDefinitions.list(),
    queryFn: listWorkflowDefinitions,
  });
}

/** Workflow instances; `refetchInterval` drives the live instance screen. */
export function useWorkflowInstances(options: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.workflowInstances.list(),
    queryFn: listWorkflowInstances,
    ...(options.refetchInterval ? { refetchInterval: options.refetchInterval } : {}),
  });
}

/** One instance with polling so operator actions and engine progress converge quickly. */
export function useWorkflowInstance(id: string, refetchInterval = 0) {
  return useQuery({
    queryKey: queryKeys.workflowInstances.detail(id),
    queryFn: () => fetchWorkflowInstance(id),
    refetchInterval,
  });
}

/** Execution log rows for the instance timeline; redacted in the view, never in the cache. */
export function useInstanceLogs(id: string) {
  return useQuery({
    queryKey: queryKeys.workflowInstances.logs(id),
    queryFn: () => fetchInstanceLogs(id),
  });
}

/** Saga projection; a 404 from the API means the instance has no saga yet. */
export function useInstanceSaga(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.workflowInstances.saga(id),
    queryFn: () => fetchInstanceSaga(id),
    enabled,
    retry: false,
  });
}

/** Every operator action on one instance; the response replaces the cached detail. */
export function useInstanceAction(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: Parameters<typeof runInstanceAction>[1]) => runInstanceAction(id, action),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflowInstances.all });
    },
  });
}

/** Dry-run replay projection; never mutates the cached instance. */
export function useReplayDryRun(id: string) {
  return useMutation({ mutationFn: () => replayDryRun(id) });
}

/** Applies the reference replay and refreshes the monitor. */
export function useReplayInstance(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => replayInstance(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.workflowInstances.all }),
  });
}

export function useCompensateSaga(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => compensateSaga(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.workflowInstances.all }),
  });
}

export function useRetrySagaStep(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (stepId: string) => retrySagaStep(id, stepId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.workflowInstances.all }),
  });
}

/** Starts an instance and refreshes every instance view (dashboard, instances). */
export function useStartWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workflowDefinitionId,
      contextJson,
      idempotencyKey,
    }: {
      workflowDefinitionId: string;
      contextJson: string;
      idempotencyKey?: string;
    }) =>
      idempotencyKey
        ? startWorkflowInstance(workflowDefinitionId, contextJson, idempotencyKey)
        : startWorkflowInstance(workflowDefinitionId, contextJson),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.workflowInstances.all }),
  });
}

/** Saves a designer draft and refreshes the workflows list. */
export function useCreateWorkflowDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateWorkflowPayload) => createWorkflowDefinition(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.workflowDefinitions.all }),
  });
}

/** Validates one condition expression; a designer-side dry run, no cache to invalidate. */
export function useValidateWorkflowExpression() {
  return useMutation({
    mutationFn: (expression: string) => validateWorkflowExpression(expression),
  });
}

/** One definition, used when the designer opens from `?id=`. */
export function useWorkflowDefinition(id: string | null) {
  return useQuery({
    queryKey: queryKeys.workflowDefinitions.detail(id ?? "none"),
    queryFn: () => fetchWorkflowDefinition(id as string),
    enabled: id !== null && id !== "",
  });
}

/** Version snapshots for comparison, rollback and archive. */
export function useWorkflowVersions(id: string | null) {
  return useQuery({
    queryKey: queryKeys.workflowDefinitions.versions(id ?? "none"),
    queryFn: () => fetchWorkflowVersions(id as string),
    enabled: id !== null && id !== "",
  });
}

export function usePublishWorkflowDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => publishWorkflowDefinition(id),
    onSuccess: (_result, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflowDefinitions.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflowDefinitions.versions(id) });
    },
  });
}

export function useRollbackWorkflowDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      rollbackWorkflowDefinition(id, version),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflowDefinitions.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workflowDefinitions.versions(variables.id),
      });
    },
  });
}

export function useArchiveWorkflowVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      archiveWorkflowVersion(id, version),
    onSuccess: (_result, variables) =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflowDefinitions.versions(variables.id),
      }),
  });
}

/** BPMN conversion mutations; both are stateless converters. */
export function useImportWorkflowBpmn() {
  return useMutation({ mutationFn: (xml: string) => importWorkflowBpmn(xml) });
}

export function useExportWorkflowBpmn() {
  return useMutation({
    mutationFn: (definitionJson: string) => exportWorkflowBpmn(definitionJson),
  });
}

/* ---------------------------------------------------------- documents */

/** Document versions for the scan table. */
export function useDocuments() {
  return useQuery({ queryKey: queryKeys.documents.list(), queryFn: listDocuments });
}

/** Lazily loads the version history of one document (only when the row is expanded). */
export function useDocumentVersions(fileId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.documents.versions(fileId),
    queryFn: () => listDocumentVersions(fileId),
    enabled: enabled && fileId.length > 0,
  });
}

/** Re-queues a failed scan and refreshes the tenant list. */
export function useRetryDocumentScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) => retryDocumentScan(fileId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents.all }),
  });
}

/** Stages a document upload (presign + PUT to object storage) and refreshes the list. */
export function useUploadDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const slot = await createDocumentUpload(file.name, file.type, file.size);
      const response = await fetch(slot.uploadUrl, {
        method: "PUT",
        ...(file.type ? { headers: { "Content-Type": file.type } } : {}),
        body: file,
      });
      if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}`);
      }
      return slot;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents.all }),
  });
}

/** Archives a document version and refreshes the list. */
export function useArchiveDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) => archiveDocumentVersion(versionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents.all }),
  });
}

/** Resolves a presigned download URL just in time. */
export function useDocumentDownloadUrl() {
  return useMutation({
    mutationFn: (fileId: string) => getDocumentDownloadUrl(fileId),
  });
}

/* -------------------------------------------------------------- forms */

/** Form definitions available to fill. */
export function useFormDefinitions() {
  return useQuery({ queryKey: queryKeys.forms.list(), queryFn: fetchFormDefinitions });
}

/** One form definition with its schema, loaded only when an id is selected. */
export function useFormDefinition(formId: string) {
  return useQuery({
    queryKey: queryKeys.forms.detail(formId),
    queryFn: () => fetchFormDefinition(formId),
    enabled: formId !== "",
  });
}

/** Submits a filled form and refreshes the form list (submission counts are server-side). */
export function useSubmitForm(formId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: SubmitFormPayload) => submitForm(formId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.forms.all }),
  });
}

/** Creates a form definition from the builder. */
export function useCreateFormDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, schemaJson }: { name: string; schemaJson: string }) =>
      createFormDefinition(name, schemaJson),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.forms.all }),
  });
}

/** Saves a new version of an existing form definition (server bumps `version`). */
export function useUpdateFormDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name, schemaJson }: { id: string; name: string; schemaJson: string }) =>
      updateFormDefinition(id, name, schemaJson),
    onSuccess: (updated) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.forms.detail(updated.id) }),
  });
}

/* ---------------------------------------------------------- analytics */

/** Analytics aggregates for the selected window. */
export function useAnalyticsSummary(from?: string, to?: string) {
  return useQuery({
    queryKey: queryKeys.analytics.summary(from, to),
    queryFn: () => fetchAnalyticsSummary(from, to),
  });
}

/** Advanced dashboard aggregations (percentiles, rates, bottlenecks and trends). */
export function useAnalyticsDashboard(
  from?: string,
  to?: string,
  granularity?: "DAY" | "WEEK" | "MONTH",
  groupBy?: "EVENT_TYPE" | "NODE" | "WORKFLOW",
  limit?: number,
) {
  return useQuery({
    queryKey: queryKeys.analytics.dashboard(from, to, granularity, groupBy, limit),
    queryFn: () => fetchAnalyticsDashboard({ from, to, granularity, groupBy, limit }),
  });
}

/* ------------------------------------------------------- organization */

/** Company -> department -> team tree. */
export function useOrganizationTree() {
  return useQuery({ queryKey: queryKeys.organizationTree.all, queryFn: fetchOrganizationTree });
}

/* ------------------------------------------------------------ tenants */

/** Tenant memberships shown by the tenant switcher. */
export function useTenantMemberships() {
  return useQuery({ queryKey: queryKeys.tenantMemberships.all, queryFn: fetchTenants });
}

/** Public health probe used by contract tests and the dashboard footer. */
export function useHealthCheck() {
  return useQuery({ queryKey: queryKeys.health.status(), queryFn: healthCheck, staleTime: 0 });
}

/** Self-service tenant registration (public flow, no cache to invalidate). */
export function useRegisterTenant() {
  return useMutation({ mutationFn: (payload: RegisterTenantPayload) => registerTenant(payload) });
}

/* ------------------------------------------------ phase 8 analytics */

/** Single analytics metric source for cards, chart and totals. */
export function useAnalyticsOverview(params: AnalyticsDashboardParams = {}, enabled = true) {
  return useQuery({
    queryKey: queryKeys.analytics.overview(
      params.from,
      params.to,
      params.granularity,
      params.groupBy,
      params.limit,
    ),
    queryFn: () => fetchAnalyticsOverview(params),
    enabled,
  });
}

/** One drill-down page behind a card or chart bucket. */
export function useAnalyticsDrilldown(params: AnalyticsDrilldownParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.analytics.drilldown(
      params.from,
      params.to,
      params.eventType,
      params.page,
      params.size,
    ),
    queryFn: () => fetchAnalyticsDrilldown(params),
    enabled,
  });
}

/* ---------------------------------------------------- phase 8 admin */

export function useAdminIdentity(tenantId: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.admin.identity(tenantId),
    queryFn: () => fetchAdminIdentity(tenantId ?? undefined),
    enabled,
  });
}

export function useAdminOperate(tenantId: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.admin.operate(tenantId),
    queryFn: () => fetchAdminOperate(tenantId ?? undefined),
    enabled,
  });
}

export function useAdminAudit(tenantId: string | null, cursor: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.admin.audit(tenantId, cursor),
    queryFn: () => fetchAdminAudit(tenantId ?? undefined, cursor ?? undefined),
    enabled,
  });
}

export function useAdminDlq(tenantId: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.admin.dlq(tenantId),
    queryFn: () => fetchAdminDlq(tenantId ?? undefined),
    enabled,
  });
}

export function useBreakGlassLog() {
  return useQuery({
    queryKey: queryKeys.admin.breakGlass(),
    queryFn: fetchBreakGlassLog,
  });
}

export function useTenantUsage(tenantId: string | null, from?: string, to?: string) {
  return useQuery({
    queryKey: queryKeys.admin.usage(tenantId, from, to),
    queryFn: () => fetchTenantUsage(tenantId as string, from, to),
    enabled: tenantId !== null,
  });
}

export function useUpdateAdminUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      tenantId,
      userId,
      role,
    }: {
      tenantId: string | null;
      userId: string;
      role: string;
    }) => updateAdminUserRole(tenantId ?? undefined, userId, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.all }),
  });
}

export function useDeleteAdminUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tenantId, userId }: { tenantId: string | null; userId: string }) =>
      deleteAdminUser(tenantId ?? undefined, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.all }),
  });
}

export function useCreateAdminInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      tenantId,
      email,
      role,
    }: {
      tenantId: string | null;
      email: string;
      role: string;
    }) => createAdminInvitation(tenantId ?? undefined, email, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.all }),
  });
}

export function useRetryAdminDlq() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tenantId, deliveryId }: { tenantId: string | null; deliveryId: string }) =>
      retryAdminDlq(tenantId ?? undefined, deliveryId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.all }),
  });
}
