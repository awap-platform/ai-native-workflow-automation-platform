"use client";

import { useMemo } from "react";

import type { DocumentVersionDto } from "../../lib/api";
import {
  computeCalculatedValues,
  fieldLabel,
  isFieldVisible,
  parseMultiSelect,
  visibleEntries,
  type FieldIssue,
  type FormField,
  type FormSchema,
  type FormValues,
} from "../../lib/forms/schema";
import FormAttachment from "./FormAttachment";
import FormErrorSummary from "./FormErrorSummary";
import FormFileField from "./FormFileField";

export interface FormRendererProps {
  schema: FormSchema;
  values: FormValues;
  onChange?: (fieldId: string, value: string) => void;
  errors?: FieldIssue[];
  /** Read-only rendering (preview snapshot, submitted response). */
  readOnly?: boolean;
  /** Prefix for every control id; the error summary links back to these ids. */
  idPrefix?: string;
  /** Increment on submit; moves focus to the error summary (T6-08). */
  focusRequests?: number;
  onFileUploaded?: (fieldId: string, fileId: string) => void;
  onFileCleared?: (fieldId: string) => void;
  /** Tenant documents used to gate FILE downloads in read-only mode. */
  documents?: DocumentVersionDto[];
  emptyMessage?: string;
  /** Immutable form version this renderer is bound to (issue #370). */
  formVersion?: number | undefined;
}

function inputType(field: FormField): string {
  switch (field.type) {
    case "NUMBER":
      return "number";
    case "EMAIL":
      return "email";
    case "PHONE":
      return "tel";
    case "DATE":
      return "date";
    case "DATETIME":
      return "datetime-local";
    default:
      return "text";
  }
}

function describedBy(controlId: string, hasHelp: boolean, hasError: boolean): string | undefined {
  const ids: string[] = [];
  if (hasHelp) {
    ids.push(`${controlId}-help`);
  }
  if (hasError) {
    ids.push(`${controlId}-error`);
  }
  return ids.length === 0 ? undefined : ids.join(" ");
}

/**
 * The single form renderer used by the builder preview and the fill route, so
 * the preview can never drift from the real form (T6-07). Visibility,
 * calculated values and multi-select parsing come from the shared schema rules.
 */
export default function FormRenderer({
  schema,
  values,
  onChange,
  errors = [],
  readOnly = false,
  idPrefix = "form",
  focusRequests = 0,
  onFileUploaded,
  onFileCleared,
  documents = [],
  emptyMessage = "This form has no fields yet.",
  formVersion,
}: FormRendererProps) {
  const computed = useMemo(() => computeCalculatedValues(schema, values).values, [schema, values]);
  const entries = useMemo(() => visibleEntries(schema, computed), [schema, computed]);
  const errorByField = useMemo(() => {
    const map = new Map<string, string>();
    for (const issue of errors) {
      if (!map.has(issue.fieldId)) {
        map.set(issue.fieldId, issue.message);
      }
    }
    return map;
  }, [errors]);

  const inputFields = entries.filter((entry) => entry.kind === "field");
  if (inputFields.length === 0 && entries.length === 0) {
    return <p className="awap-form__empty">{emptyMessage}</p>;
  }

  function change(fieldId: string, value: string) {
    if (!readOnly) {
      onChange?.(fieldId, value);
    }
  }

  return (
    <div
      className="awap-form-renderer"
      data-testid="form-renderer"
      data-form-version={formVersion ?? undefined}
    >
      <FormErrorSummary errors={errors} focusRequests={focusRequests} idPrefix={idPrefix} />
      {entries.map((entry) => {
        if (entry.kind === "section") {
          return (
            <section
              key={entry.field.id}
              className="awap-form__section"
              aria-labelledby={`${idPrefix}-${entry.field.id}-heading`}
            >
              <h2 id={`${idPrefix}-${entry.field.id}-heading`} className="awap-form__section-title">
                {fieldLabel(entry.field)}
              </h2>
              {entry.field.help ? <p className="awap-form__hint">{entry.field.help}</p> : null}
            </section>
          );
        }
        if (entry.kind === "divider") {
          return <hr key={entry.field.id} className="awap-form__divider" />;
        }
        const field = entry.field;
        const controlId = `${idPrefix}-${field.id}`;
        const label = fieldLabel(field);
        const helpId = `${controlId}-help`;
        const errorId = `${controlId}-error`;
        const error = errorByField.get(field.id);
        const value = computed[field.id] ?? "";
        const required = field.required === true && !field.calculated;
        const described = describedBy(controlId, Boolean(field.help), Boolean(error));
        const calculated = Boolean(field.calculated);

        if (field.type === "BOOLEAN") {
          return (
            <div
              key={field.id}
              className="awap-form__field"
              data-field-id={field.id}
              data-field-type={field.type}
            >
              <label className="awap-form__checkbox" htmlFor={controlId}>
                <input
                  id={controlId}
                  type="checkbox"
                  checked={value === "true"}
                  disabled={readOnly}
                  aria-required={required}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={described}
                  onChange={(event) => change(field.id, String(event.target.checked))}
                />
                <span>
                  {label}
                  {required ? <span className="awap-form__required"> (required)</span> : null}
                </span>
              </label>
              {field.help ? (
                <p id={helpId} className="awap-form__hint">
                  {field.help}
                </p>
              ) : null}
              {error ? (
                <p id={errorId} className="awap-form__error">
                  {error}
                </p>
              ) : null}
            </div>
          );
        }

        if (field.type === "MULTI_SELECT") {
          const selected = parseMultiSelect(value);
          return (
            <fieldset
              key={field.id}
              className="awap-form__field awap-form__group"
              data-field-id={field.id}
              data-field-type={field.type}
              aria-required={required}
              aria-invalid={error ? true : undefined}
              aria-describedby={described}
            >
              <legend className="awap-form__label">
                {label}
                {required ? <span className="awap-form__required"> (required)</span> : null}
              </legend>
              {(field.options ?? []).map((option, index) => {
                const optionId = `${controlId}-${index}`;
                return (
                  <label key={option} className="awap-form__checkbox" htmlFor={optionId}>
                    <input
                      id={optionId}
                      type="checkbox"
                      value={option}
                      checked={selected.includes(option)}
                      disabled={readOnly}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...selected, option]
                          : selected.filter((entryValue) => entryValue !== option);
                        change(field.id, JSON.stringify(next));
                      }}
                    />
                    <span>{option}</span>
                  </label>
                );
              })}
              {field.help ? (
                <p id={helpId} className="awap-form__hint">
                  {field.help}
                </p>
              ) : null}
              {error ? (
                <p id={errorId} className="awap-form__error">
                  {error}
                </p>
              ) : null}
            </fieldset>
          );
        }

        if (field.type === "SELECT") {
          return (
            <div
              key={field.id}
              className="awap-form__field"
              data-field-id={field.id}
              data-field-type={field.type}
            >
              <label className="awap-form__label" htmlFor={controlId}>
                {label}
                {required ? <span className="awap-form__required"> (required)</span> : null}
              </label>
              <select
                id={controlId}
                className="awap-form__control"
                value={value}
                disabled={readOnly}
                aria-required={required}
                aria-invalid={error ? true : undefined}
                aria-describedby={described}
                onChange={(event) => change(field.id, event.target.value)}
              >
                <option value="">Select…</option>
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              {field.help ? (
                <p id={helpId} className="awap-form__hint">
                  {field.help}
                </p>
              ) : null}
              {error ? (
                <p id={errorId} className="awap-form__error">
                  {error}
                </p>
              ) : null}
            </div>
          );
        }

        if (field.type === "FILE") {
          const document = documents.find((entryValue) => entryValue.fileId === value);
          return (
            <div
              key={field.id}
              className="awap-form__field"
              data-field-id={field.id}
              data-field-type={field.type}
            >
              <span className="awap-form__label">
                {label}
                {required ? <span className="awap-form__required"> (required)</span> : null}
              </span>
              {readOnly ? (
                document ? (
                  <FormAttachment
                    fileId={document.fileId}
                    name={document.name ?? document.fileId}
                    scanStatus={document.scanStatus}
                    size={document.size}
                  />
                ) : (
                  <p className="awap-form__hint">No file attached.</p>
                )
              ) : (
                <FormFileField
                  fieldId={field.id}
                  onUploaded={(fileId) => {
                    change(field.id, fileId);
                    onFileUploaded?.(field.id, fileId);
                  }}
                  onCleared={() => {
                    change(field.id, "");
                    onFileCleared?.(field.id);
                  }}
                />
              )}
              {field.help ? (
                <p id={helpId} className="awap-form__hint">
                  {field.help}
                </p>
              ) : null}
              {error ? (
                <p id={errorId} className="awap-form__error">
                  {error}
                </p>
              ) : null}
            </div>
          );
        }

        if (field.type === "TEXTAREA") {
          return (
            <div
              key={field.id}
              className="awap-form__field"
              data-field-id={field.id}
              data-field-type={field.type}
            >
              <label className="awap-form__label" htmlFor={controlId}>
                {label}
                {required ? <span className="awap-form__required"> (required)</span> : null}
              </label>
              <textarea
                id={controlId}
                className="awap-form__control"
                value={value}
                placeholder={field.placeholder ?? ""}
                readOnly={readOnly}
                aria-required={required}
                aria-invalid={error ? true : undefined}
                aria-describedby={described}
                onChange={(event) => change(field.id, event.target.value)}
              />
              {field.help ? (
                <p id={helpId} className="awap-form__hint">
                  {field.help}
                </p>
              ) : null}
              {error ? (
                <p id={errorId} className="awap-form__error">
                  {error}
                </p>
              ) : null}
            </div>
          );
        }

        return (
          <div
            key={field.id}
            className="awap-form__field"
            data-field-id={field.id}
            data-field-type={field.type}
          >
            <label className="awap-form__label" htmlFor={controlId}>
              {label}
              {required ? <span className="awap-form__required"> (required)</span> : null}
            </label>
            <input
              id={controlId}
              className="awap-form__control"
              type={inputType(field)}
              value={value}
              placeholder={field.placeholder ?? ""}
              min={field.min ?? undefined}
              max={field.max ?? undefined}
              minLength={field.minLength ?? undefined}
              maxLength={field.maxLength ?? undefined}
              readOnly={readOnly || calculated}
              aria-readonly={calculated || undefined}
              aria-required={required}
              aria-invalid={error ? true : undefined}
              aria-describedby={described}
              data-calculated={calculated ? "true" : undefined}
              onChange={(event) => change(field.id, event.target.value)}
            />
            {field.help ? (
              <p id={helpId} className="awap-form__hint">
                {field.help}
              </p>
            ) : null}
            {error ? (
              <p id={errorId} className="awap-form__error">
                {error}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Number of input entries the renderer will draw for the current values. */
export function renderedFieldIds(schema: FormSchema, values: FormValues): string[] {
  const computed = computeCalculatedValues(schema, values).values;
  return schema.fields
    .filter((field) => field.type !== "SECTION" && field.type !== "DIVIDER")
    .filter((field) => isFieldVisible(field, computed))
    .map((field) => field.id);
}
