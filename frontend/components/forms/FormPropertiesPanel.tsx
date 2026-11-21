"use client";

import {
  CONDITION_OPERATORS,
  expressionDependencies,
  fieldLabel,
  MAX_HELP_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_PATTERN_LENGTH,
  NON_INPUT_TYPES,
  type ConditionOperator,
  type FieldIssue,
  type FormField,
  type FormSchema,
} from "../../lib/forms/schema";

export interface FormPropertiesPanelProps {
  schema: FormSchema;
  field: FormField | null;
  issues: FieldIssue[];
  onPatch: (patch: Partial<FormField>) => void;
  onRename: (newId: string) => void;
  onRemove: () => void;
}

function numberOf(raw: string): number | undefined {
  if (raw.trim() === "") {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const TEXTUAL_TYPES = new Set(["TEXT", "TEXTAREA", "EMAIL", "PHONE"]);

/**
 * Right properties panel: every editable property of the selected field,
 * including its validation rules, conditional visibility and calculation. All
 * labels are React text, so a hostile label stays inert.
 */
export default function FormPropertiesPanel({
  schema,
  field,
  issues,
  onPatch,
  onRename,
  onRemove,
}: FormPropertiesPanelProps) {
  if (!field) {
    return (
      <section className="awap-form__properties" aria-labelledby="form-properties-heading">
        <h2 id="form-properties-heading" className="awap-form__panel-title">
          Properties
        </h2>
        <p className="awap-form__hint">Select a field on the canvas to edit it.</p>
      </section>
    );
  }

  const fieldIssues = issues.filter((issue) => issue.fieldId === field.id);
  const isLayout = NON_INPUT_TYPES.has(field.type);
  const isChoice = field.type === "SELECT" || field.type === "MULTI_SELECT";
  const otherFields = schema.fields.filter(
    (candidate) => candidate.id !== field.id && candidate.type !== "DIVIDER",
  );

  return (
    <section className="awap-form__properties" aria-labelledby="form-properties-heading">
      <h2 id="form-properties-heading" className="awap-form__panel-title">
        Properties
      </h2>
      <p className="awap-form__hint">
        {field.type} · {fieldLabel(field)}
      </p>

      <label className="awap-form__field-label" htmlFor="field-id">
        Field id
      </label>
      <input
        id="field-id"
        className="awap-form__control"
        value={field.id}
        spellCheck={false}
        onChange={(event) => onRename(event.target.value)}
      />
      <p className="awap-form__hint">
        Renaming updates conditional rules and calculations that reference it.
      </p>

      {field.type === "SECTION" ? (
        <>
          <label className="awap-form__field-label" htmlFor="field-title">
            Section title
          </label>
          <input
            id="field-title"
            className="awap-form__control"
            value={field.title ?? ""}
            maxLength={MAX_LABEL_LENGTH}
            onChange={(event) => onPatch({ title: event.target.value })}
          />
        </>
      ) : null}

      {!isLayout ? (
        <>
          <label className="awap-form__field-label" htmlFor="field-label">
            Label
          </label>
          <input
            id="field-label"
            className="awap-form__control"
            value={field.label ?? ""}
            maxLength={MAX_LABEL_LENGTH}
            onChange={(event) => onPatch({ label: event.target.value })}
          />
        </>
      ) : null}

      <label className="awap-form__field-label" htmlFor="field-help">
        {field.type === "SECTION" ? "Section description" : "Help text"}
      </label>
      <textarea
        id="field-help"
        className="awap-form__control awap-form__control--multiline"
        value={field.help ?? ""}
        maxLength={MAX_HELP_LENGTH}
        onChange={(event) => onPatch({ help: event.target.value })}
      />

      {!isLayout ? (
        <>
          <label className="awap-form__checkbox" htmlFor="field-required">
            <input
              id="field-required"
              type="checkbox"
              checked={field.required === true}
              disabled={Boolean(field.calculated)}
              onChange={(event) => onPatch({ required: event.target.checked })}
            />
            <span>Required</span>
          </label>

          {field.type === "TEXT" || field.type === "TEXTAREA" || field.type === "EMAIL" || field.type === "PHONE" ? (
            <>
              <label className="awap-form__field-label" htmlFor="field-minlength">
                Minimum length
              </label>
              <input
                id="field-minlength"
                className="awap-form__control"
                type="number"
                min={0}
                value={field.minLength ?? ""}
                onChange={(event) => onPatch({ minLength: numberOf(event.target.value) })}
              />
              <label className="awap-form__field-label" htmlFor="field-maxlength">
                Maximum length
              </label>
              <input
                id="field-maxlength"
                className="awap-form__control"
                type="number"
                min={0}
                value={field.maxLength ?? ""}
                onChange={(event) => onPatch({ maxLength: numberOf(event.target.value) })}
              />
              <label className="awap-form__field-label" htmlFor="field-pattern">
                Pattern (regular expression)
              </label>
              <input
                id="field-pattern"
                className="awap-form__control"
                value={field.pattern ?? ""}
                maxLength={MAX_PATTERN_LENGTH}
                spellCheck={false}
                onChange={(event) =>
                  onPatch({ pattern: event.target.value === "" ? undefined : event.target.value })
                }
              />
            </>
          ) : null}

          {field.type === "NUMBER" ? (
            <>
              <label className="awap-form__field-label" htmlFor="field-min">
                Minimum
              </label>
              <input
                id="field-min"
                className="awap-form__control"
                type="number"
                value={field.min ?? ""}
                onChange={(event) => onPatch({ min: numberOf(event.target.value) })}
              />
              <label className="awap-form__field-label" htmlFor="field-max">
                Maximum
              </label>
              <input
                id="field-max"
                className="awap-form__control"
                type="number"
                value={field.max ?? ""}
                onChange={(event) => onPatch({ max: numberOf(event.target.value) })}
              />
              <label className="awap-form__field-label" htmlFor="field-calculated">
                Calculated expression
              </label>
              <input
                id="field-calculated"
                className="awap-form__control"
                value={field.calculated ?? ""}
                placeholder="sum(units, shipping)"
                spellCheck={false}
                onChange={(event) =>
                  onPatch({
                    calculated: event.target.value.trim() === "" ? null : event.target.value,
                  })
                }
              />
              {field.calculated ? (
                <p className="awap-form__hint" data-testid="calculation-dependencies">
                  Uses:{" "}
                  {expressionDepsFor(field.calculated)}
                </p>
              ) : null}
            </>
          ) : null}

          {isChoice ? (
            <>
              <label className="awap-form__field-label" htmlFor="field-options">
                Options (one per line)
              </label>
              <textarea
                id="field-options"
                className="awap-form__control awap-form__control--multiline"
                value={(field.options ?? []).join("\n")}
                onChange={(event) =>
                  onPatch({
                    options: event.target.value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean),
                  })
                }
              />
            </>
          ) : null}

          <fieldset className="awap-form__rule">
            <legend className="awap-form__field-label">Conditional visibility</legend>
            <label className="awap-form__checkbox" htmlFor="condition-enabled">
              <input
                id="condition-enabled"
                type="checkbox"
                checked={Boolean(field.visibleWhen)}
                onChange={(event) =>
                  onPatch({
                    visibleWhen: event.target.checked
                      ? { fieldId: otherFields[0]?.id ?? "", operator: "IS_NOT_EMPTY" }
                      : null,
                  })
                }
              />
              <span>Only show this field when…</span>
            </label>
            {field.visibleWhen ? (
              <>
                <label className="awap-form__field-label" htmlFor="condition-field">
                  Field
                </label>
                <select
                  id="condition-field"
                  className="awap-form__control"
                  value={field.visibleWhen.fieldId}
                  onChange={(event) =>
                    onPatch({
                      visibleWhen: {
                        ...(field.visibleWhen ?? { operator: "EQUALS" as ConditionOperator }),
                        fieldId: event.target.value,
                      },
                    })
                  }
                >
                  <option value="">Choose a field</option>
                  {otherFields.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {fieldLabel(candidate)} ({candidate.id})
                    </option>
                  ))}
                </select>
                <label className="awap-form__field-label" htmlFor="condition-operator">
                  Operator
                </label>
                <select
                  id="condition-operator"
                  className="awap-form__control"
                  value={field.visibleWhen.operator}
                  onChange={(event) =>
                    onPatch({
                      visibleWhen: {
                        ...(field.visibleWhen ?? { fieldId: "" }),
                        operator: event.target.value as ConditionOperator,
                      },
                    })
                  }
                >
                  {CONDITION_OPERATORS.map((operator) => (
                    <option key={operator} value={operator}>
                      {operator.replace("_", " ").toLowerCase()}
                    </option>
                  ))}
                </select>
                {field.visibleWhen.operator !== "IS_EMPTY" &&
                field.visibleWhen.operator !== "IS_NOT_EMPTY" ? (
                  <>
                    <label className="awap-form__field-label" htmlFor="condition-value">
                      Value
                    </label>
                    <input
                      id="condition-value"
                      className="awap-form__control"
                      value={field.visibleWhen.value ?? ""}
                      onChange={(event) =>
                        onPatch({
                          visibleWhen: {
                            ...(field.visibleWhen ?? { fieldId: "", operator: "EQUALS" }),
                            value: event.target.value,
                          },
                        })
                      }
                    />
                  </>
                ) : null}
              </>
            ) : null}
          </fieldset>
        </>
      ) : null}

      {fieldIssues.length > 0 ? (
        <ul className="awap-form__issues" aria-label="Field problems">
          {fieldIssues.map((issue) => (
            <li key={issue.message} className="awap-form__issue">
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      <button type="button" className="awap-form__danger-button" onClick={onRemove}>
        Remove field
      </button>
      {TEXTUAL_TYPES.has(field.type) ? (
        <p className="awap-form__hint">Text values are escaped; markup is never rendered.</p>
      ) : null}
    </section>
  );
}

function expressionDepsFor(source: string): string {
  try {
    const dependencies = expressionDependencies(source);
    return dependencies.length === 0 ? "no fields" : dependencies.join(", ");
  } catch {
    return "invalid expression";
  }
}
