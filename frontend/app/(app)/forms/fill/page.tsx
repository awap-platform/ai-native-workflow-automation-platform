"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import FormAttachment from "../../../../components/forms/FormAttachment";
import FormRenderer from "../../../../components/forms/FormRenderer";
import { ErrorState, LoadingState } from "../../../../components/ui/QueryState";
import {
  errorStatus,
  type DocumentVersionDto,
  type FormSubmissionFileDto,
} from "../../../../lib/api";
import { clearFillValues, loadFillValues, saveFillValues } from "../../../../lib/forms/draft";
import {
  parseFormSchema,
  toSubmissionData,
  validateValues,
  type FieldIssue,
  type FormValues,
} from "../../../../lib/forms/schema";
import {
  useFormDefinition,
  useFormDefinitions,
  useFormSchemaVersion,
  useSubmitForm,
  useWorkflowInstances,
} from "../../../../lib/hooks/resources";

function mapSubmitError(error: unknown): string {
  switch (errorStatus(error)) {
    case 404:
      return "This form no longer exists (HTTP 404).";
    case 413:
      return "The submitted data or file is too large (HTTP 413).";
    case 415:
      return "A file type is not supported (HTTP 415).";
    case 403:
      return "A file was rejected by antivirus scanning (HTTP 403).";
    case 409:
      return "A file is still being scanned. Try again once it is promoted (HTTP 409).";
    case 400:
      return "The server rejected the values. Check the highlighted fields (HTTP 400).";
    default:
      return "Submit failed. Try again.";
  }
}

function toDocuments(files: FormSubmissionFileDto[]): DocumentVersionDto[] {
  return files.map((file, index) => ({
    id: `${file.fileId}-${index}`,
    fileId: file.fileId,
    version: 1,
    size: file.size,
    format: null,
    status: file.scanStatus,
    createdAt: new Date().toISOString(),
    name: file.name,
    scanStatus: file.scanStatus,
    scanError: null,
    downloadable: file.scanStatus === "PROMOTED",
  }));
}

/**
 * Fill route (phase 6): renders the same `FormRenderer` as the builder preview,
 * validates every visible field before submitting, maps server rejections to
 * actionable copy, keeps values across a back-navigation and shows submitted
 * files with the scan-gated download rule.
 */
export default function FillFormPage() {
  const formsQuery = useFormDefinitions();
  const instancesQuery = useWorkflowInstances();
  const forms = formsQuery.data ?? [];
  const instances = instancesQuery.data ?? [];
  const [formId, setFormId] = useState("");
  const [requestedVersion, setRequestedVersion] = useState<number | null>(null);
  const [instanceId, setInstanceId] = useState("");
  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<FieldIssue[]>([]);
  const [focusRequests, setFocusRequests] = useState(0);
  const [message, setMessage] = useState("");
  const [submittedFiles, setSubmittedFiles] = useState<FormSubmissionFileDto[]>([]);
  const [readOnlyView, setReadOnlyView] = useState(false);
  const initialized = useRef(false);

  const formQuery = useFormDefinition(formId);
  const versionQuery = useFormSchemaVersion(formId, requestedVersion);
  const submit = useSubmitForm(formId);
  const effectiveReadOnly = readOnlyView || requestedVersion !== null;

  const schemaJson = versionQuery.data?.schemaJson ?? formQuery.data?.schemaJson;
  const parsed = useMemo(() => parseFormSchema(schemaJson), [schemaJson]);
  const schema = parsed.schema;

  /* Deep link support: /forms/fill?formId=…&readonly=1 */
  useEffect(() => {
    if (initialized.current || typeof window === "undefined") {
      return;
    }
    initialized.current = true;
    const params = new URLSearchParams(window.location.search);
    const deepLink = params.get("formId");
    const version = Number.parseInt(params.get("version") ?? "", 10);
    if (deepLink || params.get("readonly") === "1" || Number.isFinite(version)) {
      queueMicrotask(() => {
        if (deepLink) {
          setFormId(deepLink);
        }
        if (params.get("readonly") === "1") {
          setReadOnlyView(true);
        }
        if (Number.isFinite(version) && version > 0) {
          setRequestedVersion(version);
          setReadOnlyView(true);
        }
      });
    }
  }, []);

  /* Restore preserved values when the selected form changes. */
  useEffect(() => {
    if (formId === "" || typeof window === "undefined") {
      return;
    }
    const stored = loadFillValues(window.sessionStorage, formId);
    if (stored) {
      queueMicrotask(() => {
        setValues(stored);
        setMessage("Restored your previous answers for this form.");
      });
    }
  }, [formId]);

  /* Preserve answers across a back-navigation (U6-10). */
  useEffect(() => {
    if (formId === "" || typeof window === "undefined") {
      return;
    }
    saveFillValues(window.sessionStorage, formId, values);
  }, [formId, values]);

  function setValue(fieldId: string, value: string) {
    setValues((current) => ({ ...current, [fieldId]: value }));
    setSubmittedFiles([]);
  }

  function handleSubmit() {
    setMessage("");
    if (!schema) {
      setMessage("This form has no readable schema.");
      return;
    }
    const issues = validateValues(schema, values);
    setErrors(issues);
    setFocusRequests((count) => count + 1);
    if (issues.length > 0) {
      setMessage(
        issues.length === 1
          ? "1 field needs attention."
          : `${issues.length} fields need attention.`,
      );
      return;
    }
    submit.mutate(
      {
        dataJson: JSON.stringify(toSubmissionData(schema, values)),
        workflowInstanceId: instanceId || null,
      },
      {
        onSuccess: (response) => {
          const files = response.files ?? [];
          setSubmittedFiles(files);
          setMessage(
            files.length === 0
              ? "Submitted"
              : `Submitted with ${files.length} file(s): ${files.map((file) => `${file.name} (${file.scanStatus})`).join(", ")}`,
          );
          setValues({});
          setErrors([]);
          if (typeof window !== "undefined") {
            clearFillValues(window.sessionStorage, formId);
          }
        },
        onError: (error) => setMessage(mapSubmitError(error)),
      },
    );
  }

  return (
    <div className="awap-form__fill">
      <h1 className="awap-form__heading">Fill Form</h1>
      {requestedVersion !== null && formQuery.data ? (
        <p role="status" className="awap-alert awap-alert-warning">
          Answered against version {requestedVersion}; current version {formQuery.data.version}.
          This is a read-only historical view.
        </p>
      ) : null}

      <div className="awap-form__toolbar">
        <label className="awap-form__field-label" htmlFor="fill-form">
          Form
        </label>
        <select
          id="fill-form"
          className="awap-form__control"
          aria-label="Form"
          value={formId}
          onChange={(event) => {
            setFormId(event.target.value);
            setValues({});
            setErrors([]);
            setSubmittedFiles([]);
            setMessage("");
          }}
        >
          <option value="">Select a form</option>
          {forms.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        <label className="awap-form__field-label" htmlFor="fill-instance">
          Workflow instance
        </label>
        <select
          id="fill-instance"
          className="awap-form__control"
          aria-label="Workflow instance"
          value={instanceId}
          onChange={(event) => setInstanceId(event.target.value)}
        >
          <option value="">(optional) Workflow instance</option>
          {instances.map((instance) => (
            <option key={instance.id} value={instance.id}>
              {instance.state} — {instance.id}
            </option>
          ))}
        </select>
        <label className="awap-form__checkbox" htmlFor="fill-read-only">
          <input
            id="fill-read-only"
            type="checkbox"
            checked={readOnlyView}
            onChange={(event) => setReadOnlyView(event.target.checked)}
          />
          <span>Read-only view</span>
        </label>
        {formQuery.data ? (
          <span className="awap-form__badge">Version {formQuery.data.version}</span>
        ) : null}
      </div>

      {formsQuery.isError && (
        <ErrorState error={formsQuery.error} message="Failed to load forms." />
      )}
      {formQuery.isError && (
        <ErrorState error={formQuery.error} message="Failed to load the selected form." />
      )}
      {formQuery.isFetching && <LoadingState label="Loading form…" />}
      {formQuery.data && parsed.error ? (
        <p className="awap-form__error" role="alert">
          {parsed.error}
        </p>
      ) : null}

      {schema && formId !== "" ? (
        <section className="awap-form__fill-body" aria-label="Form fields">
          <FormRenderer
            schema={schema}
            values={values}
            errors={errors}
            readOnly={effectiveReadOnly}
            idPrefix="fill"
            focusRequests={focusRequests}
            onChange={setValue}
            documents={toDocuments(submittedFiles)}
            formVersion={requestedVersion ?? formQuery.data?.version}
          />
          {!effectiveReadOnly ? (
            <button
              type="button"
              className="awap-form__button awap-form__button--primary"
              onClick={handleSubmit}
              disabled={submit.isPending}
            >
              {submit.isPending ? "Submitting…" : "Submit"}
            </button>
          ) : (
            <p className="awap-form__hint">
              Read-only view: the fields are disabled and nothing can be submitted.
            </p>
          )}
        </section>
      ) : null}

      {!formQuery.isFetching && formId === "" ? (
        <p className="awap-form__hint">Select a form to fill it in.</p>
      ) : null}

      {submittedFiles.length > 0 ? (
        <section className="awap-form__attachments" aria-labelledby="submitted-files-heading">
          <h2 id="submitted-files-heading" className="awap-form__panel-title">
            Submitted files
          </h2>
          {submittedFiles.map((file) => (
            <FormAttachment
              key={file.fileId}
              fileId={file.fileId}
              name={file.name}
              scanStatus={file.scanStatus}
              size={file.size}
            />
          ))}
        </section>
      ) : null}

      {message && (
        <p className="awap-form__status" role="status" aria-live="polite">
          {message}
        </p>
      )}
    </div>
  );
}
