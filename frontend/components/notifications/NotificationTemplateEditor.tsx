"use client";

import { useEffect, useMemo, useState } from "react";
import type { NotificationTemplateDto, NotificationTemplatePreviewDto } from "../../lib/api";
import {
  useActivateNotificationTemplate,
  useArchiveNotificationTemplate,
  useCreateNotificationTemplate,
  useNotificationTemplates,
  usePreviewNotificationTemplate,
  useUpdateNotificationTemplate,
} from "../../lib/hooks/useNotificationTemplates";
import {
  describeTemplateError,
  emptyVariables,
  parseVariables,
  templatePlaceholders,
  unusedVariables,
  validateTemplateLength,
  validateTemplateText,
  validateTemplateVariables,
} from "../../lib/notificationTemplates";

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const LOCALE_PATTERN = /^[A-Za-z]{2}([_-][A-Za-z]{2})?$/;

interface EditorState {
  templateKey: string;
  locale: string;
  subject: string;
  body: string;
}

const EMPTY_TEMPLATE: EditorState = {
  templateKey: "",
  locale: "en",
  subject: "",
  body: "",
};

function snapshot(template: NotificationTemplateDto): EditorState {
  return {
    templateKey: template.templateKey,
    locale: template.locale,
    subject: template.subject,
    body: template.body,
  };
}

/**
 * Creates and edits tenant templates with placeholder validation, a substitute-variable preview, a
 * stored-template preview, optimistic version checks and an unsaved-change guard.
 */
export default function NotificationTemplateEditor() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedActive, setSelectedActive] = useState(false);
  const [expectedVersion, setExpectedVersion] = useState<number | null>(null);
  const [templateKey, setTemplateKey] = useState(EMPTY_TEMPLATE.templateKey);
  const [locale, setLocale] = useState(EMPTY_TEMPLATE.locale);
  const [subject, setSubject] = useState(EMPTY_TEMPLATE.subject);
  const [body, setBody] = useState(EMPTY_TEMPLATE.body);
  const [initial, setInitial] = useState<EditorState>(EMPTY_TEMPLATE);
  const [variablesJson, setVariablesJson] = useState('{\n  "name": "Ada"\n}');
  const [previewResult, setPreviewResult] = useState<NotificationTemplatePreviewDto | null>(null);
  const [previewSource, setPreviewSource] = useState<"draft" | "stored" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const templatesQuery = useNotificationTemplates();
  const preview = usePreviewNotificationTemplate();
  const create = useCreateNotificationTemplate();
  const update = useUpdateNotificationTemplate();
  const archive = useArchiveNotificationTemplate();
  const activate = useActivateNotificationTemplate();
  const available = templatesQuery.data ?? [];

  const dirty =
    templateKey !== initial.templateKey ||
    locale !== initial.locale ||
    subject !== initial.subject ||
    body !== initial.body;

  const parsedVariables = useMemo(() => parseVariables(variablesJson), [variablesJson]);
  const placeholders = useMemo(
    () => templatePlaceholders(`${subject}\n${body}`),
    [body, subject],
  );
  const warnings = useMemo(() => {
    if ("error" in parsedVariables) {
      return [];
    }
    const combined = `${subject}\n${body}`;
    return [
      ...emptyVariables(combined, parsedVariables.variables).map(
        (key) => `Variable "${key}" is empty; the preview renders a blank.`,
      ),
      ...unusedVariables(combined, parsedVariables.variables).map(
        (key) => `Variable "${key}" is supplied but never used by this template.`,
      ),
    ];
  }, [body, parsedVariables, subject]);

  useEffect(() => {
    if (!dirty) {
      return;
    }
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  const validationError = (): string | null => {
    if (!LOCALE_PATTERN.test(locale.trim())) {
      return "Locale must look like 'en' or 'en-US'.";
    }
    const length = validateTemplateLength(body);
    if (length) {
      return length;
    }
    const syntax = validateTemplateText(subject) ?? validateTemplateText(body);
    if (syntax) {
      return syntax;
    }
    const parsed = parseVariables(variablesJson);
    if ("error" in parsed) {
      return parsed.error;
    }
    return (
      validateTemplateVariables(subject, parsed.variables) ??
      validateTemplateVariables(body, parsed.variables)
    );
  };

  const applySaved = (template: NotificationTemplateDto, message: string) => {
    const next = snapshot(template);
    setSelectedId(template.id);
    setSelectedActive(template.active);
    setExpectedVersion(template.version);
    setTemplateKey(next.templateKey);
    setLocale(next.locale);
    setSubject(next.subject);
    setBody(next.body);
    setInitial(next);
    setNotice(message);
  };

  const chooseTemplate = (template: NotificationTemplateDto) => {
    if (dirty && !window.confirm("Discard unsaved changes?")) {
      return;
    }
    const next = snapshot(template);
    setSelectedId(template.id);
    setSelectedActive(template.active);
    setExpectedVersion(template.version);
    setTemplateKey(next.templateKey);
    setLocale(next.locale);
    setSubject(next.subject);
    setBody(next.body);
    setInitial(next);
    setPreviewResult(null);
    setPreviewSource(null);
    setError(null);
    setNotice(null);
  };

  const startNewTemplate = () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) {
      return;
    }
    setSelectedId(null);
    setSelectedActive(false);
    setExpectedVersion(null);
    setTemplateKey(EMPTY_TEMPLATE.templateKey);
    setLocale(EMPTY_TEMPLATE.locale);
    setSubject(EMPTY_TEMPLATE.subject);
    setBody(EMPTY_TEMPLATE.body);
    setInitial(EMPTY_TEMPLATE);
    setPreviewResult(null);
    setPreviewSource(null);
    setError(null);
    setNotice(null);
  };

  const onPreview = () => {
    setError(null);
    setNotice(null);
    setPreviewResult(null);
    setPreviewSource(null);
    const problem = validationError();
    if (problem) {
      setError(problem);
      return;
    }
    const parsed = parseVariables(variablesJson);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    preview.mutate(
      {
        templateKey,
        locale,
        subject,
        body,
        variablesJson: JSON.stringify(parsed.variables),
      },
      {
        onSuccess: (data) => {
          setPreviewResult(data);
          setPreviewSource("draft");
        },
        onError: (cause) =>
          setError(describeTemplateError(cause, templateKey.trim(), locale.trim())),
      },
    );
  };

  /** Previews the stored revision, which is how an unknown key/locale becomes visible. */
  const onPreviewStored = () => {
    setError(null);
    setNotice(null);
    setPreviewResult(null);
    setPreviewSource(null);
    const key = templateKey.trim();
    if (!KEY_PATTERN.test(key)) {
      setError("Template key must use lowercase letters, digits, '.', '_' or '-'.");
      return;
    }
    if (!LOCALE_PATTERN.test(locale.trim())) {
      setError("Locale must look like 'en' or 'en-US'.");
      return;
    }
    const parsed = parseVariables(variablesJson);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    preview.mutate(
      { templateKey: key, locale: locale.trim(), variablesJson: JSON.stringify(parsed.variables) },
      {
        onSuccess: (data) => {
          setPreviewResult(data);
          setPreviewSource("stored");
        },
        onError: (cause) => setError(describeTemplateError(cause, key, locale.trim())),
      },
    );
  };

  const onSave = () => {
    setError(null);
    setNotice(null);
    const problem = validationError();
    if (problem) {
      setError(problem);
      return;
    }
    const key = templateKey.trim();
    if (!KEY_PATTERN.test(key)) {
      setError("Template key must use lowercase letters, digits, '.', '_' or '-'.");
      return;
    }
    if (selectedId && expectedVersion !== null) {
      update.mutate(
        { id: selectedId, payload: { expectedVersion, subject, body } },
        {
          onSuccess: (template) => applySaved(template, "Template saved."),
          onError: (cause) => setError(describeTemplateError(cause, key, locale.trim())),
        },
      );
      return;
    }
    create.mutate(
      { templateKey: key, locale, subject, body },
      {
        onSuccess: (template) => applySaved(template, "Template saved."),
        onError: (cause) => setError(describeTemplateError(cause, key, locale.trim())),
      },
    );
  };

  const onArchive = () => {
    if (!selectedId) {
      return;
    }
    setError(null);
    archive.mutate(selectedId, {
      onSuccess: (template) =>
        applySaved(template, "Template archived. Deliveries fall back to the built-in default."),
      onError: (cause) => setError(describeTemplateError(cause, templateKey, locale)),
    });
  };

  const onActivate = () => {
    if (!selectedId) {
      return;
    }
    setError(null);
    activate.mutate(selectedId, {
      onSuccess: (template) => applySaved(template, "Template activated."),
      onError: (cause) => setError(describeTemplateError(cause, templateKey, locale)),
    });
  };

  return (
    <section aria-labelledby="template-editor-heading" className="awap-page awap-form-wide">
      <h1 id="template-editor-heading" className="awap-page-title">
        Notification templates
      </h1>

      {error ? (
        <p role="alert" className="awap-alert awap-alert-danger m-0">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" aria-live="polite" className="awap-alert m-0">
          {notice}
        </p>
      ) : null}

      <section aria-labelledby="template-list-heading" className="awap-stack">
        <h2 id="template-list-heading" className="awap-section-title">
          Existing templates
        </h2>
        {templatesQuery.isLoading ? <p>Loading templates…</p> : null}
        {templatesQuery.isError ? (
          <p role="alert" className="awap-error">
            Templates could not be loaded.
          </p>
        ) : null}
        {templatesQuery.isSuccess && available.length === 0 ? (
          <p className="awap-muted">No tenant templates yet. The built-in EN/TR fallbacks stay active.</p>
        ) : null}
        <ul className="awap-list" aria-label="Existing notification templates">
          {available.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                className="awap-button awap-button-ghost"
                onClick={() => chooseTemplate(template)}
                aria-pressed={selectedId === template.id}
              >
                {template.templateKey} · {template.locale} · v{template.version} ·{" "}
                {template.active ? "active" : "archived"}
              </button>
            </li>
          ))}
        </ul>
        <div>
          <button type="button" className="awap-button" onClick={startNewTemplate}>
            New template
          </button>
        </div>
      </section>

      <div className="awap-form">
        <label className="awap-label" htmlFor="template-key">
          Template key
          <input
            id="template-key"
            className="awap-input"
            value={templateKey}
            disabled={selectedId !== null}
            onChange={(event) => setTemplateKey(event.target.value)}
          />
        </label>
        <label className="awap-label" htmlFor="template-locale">
          Locale
          <input
            id="template-locale"
            className="awap-input"
            list="template-locale-options"
            value={locale}
            disabled={selectedId !== null}
            onChange={(event) => setLocale(event.target.value)}
          />
        </label>
        <datalist id="template-locale-options">
          <option value="en" />
          <option value="tr" />
        </datalist>
        <label className="awap-label" htmlFor="template-subject">
          Subject
          <input
            id="template-subject"
            className="awap-input"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
        </label>
        <label className="awap-label" htmlFor="template-body">
          Body
          <textarea
            id="template-body"
            className="awap-textarea"
            rows={4}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        <label className="awap-label" htmlFor="template-variables">
          Variables JSON
          <textarea
            id="template-variables"
            className="awap-textarea"
            rows={4}
            value={variablesJson}
            onChange={(event) => setVariablesJson(event.target.value)}
          />
        </label>

        <section aria-labelledby="template-placeholders-heading" data-testid="template-placeholders">
          <h2 id="template-placeholders-heading" className="awap-section-title">
            Placeholders
          </h2>
          <p className="awap-muted m-0">
            {placeholders.length === 0
              ? "No placeholders detected."
              : "Detected placeholders:"}
          </p>
          {placeholders.length > 0 ? (
            <ul className="awap-inline" aria-label="Detected placeholders">
              {placeholders.map((placeholder) => (
                <li key={placeholder} className="awap-chip">{`{{${placeholder}}}`}</li>
              ))}
            </ul>
          ) : null}
        </section>

        {warnings.length > 0 ? (
          <div role="status" aria-live="polite" data-testid="template-warnings" className="awap-alert awap-alert-warning">
            <p className="m-0 font-semibold">Check the preview variables</p>
            <ul className="m-0">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {expectedVersion !== null ? (
          <p className="awap-muted m-0" data-testid="template-version">
            Editing revision v{expectedVersion}. Saving requires that exact revision; a concurrent
            edit is rejected instead of overwriting it.
          </p>
        ) : null}

        <div className="awap-inline">
          <button
            type="button"
            className="awap-button awap-button-primary"
            onClick={onPreview}
            aria-label="Preview template"
          >
            Preview
          </button>
          <button
            type="button"
            className="awap-button"
            onClick={onPreviewStored}
            aria-label="Preview saved template"
          >
            Preview saved
          </button>
          <button type="button" className="awap-button" onClick={onSave} aria-label="Save template">
            Save
          </button>
          {selectedId ? (
            <button
              type="button"
              className="awap-button"
              onClick={onArchive}
              aria-label="Archive template"
            >
              Archive
            </button>
          ) : null}
          {selectedId && !selectedActive ? (
            <button
              type="button"
              className="awap-button"
              onClick={onActivate}
              aria-label="Activate template"
            >
              Activate
            </button>
          ) : null}
        </div>
      </div>

      {previewResult ? (
        <section aria-labelledby="template-preview-heading" className="awap-stack" data-testid="template-preview">
          <h2 id="template-preview-heading" className="awap-section-title">
            Preview {previewSource === "stored" ? "(stored template)" : "(draft)"}
          </h2>
          <p data-testid="preview-subject" className="m-0 font-semibold">
            {previewResult.subject}
          </p>
          <p data-testid="preview-body" aria-live="polite" className="m-0">
            {previewResult.body}
          </p>
          <p className="m-0">
            Placeholders: {previewResult.placeholders.join(", ") || "none"}
          </p>
        </section>
      ) : null}
    </section>
  );
}
