"use client";

import { useState, type DragEvent } from "react";

import {
  describeCondition,
  fieldLabel,
  NON_INPUT_TYPES,
  type FieldIssue,
  type FormField,
  type FormFieldType,
  type FormSchema,
} from "../../lib/forms/schema";
import { FIELD_DRAG_MIME } from "./FormFieldPalette";

/** MIME type used when an existing canvas row is dragged to a new position. */
export const ROW_DRAG_MIME = "application/x-awap-form-row";

export interface FormCanvasProps {
  schema: FormSchema;
  selectedId: string | null;
  issues: FieldIssue[];
  onSelect: (fieldId: string) => void;
  onMove: (fieldId: string, direction: -1 | 1) => void;
  onRemove: (fieldId: string) => void;
  onAdd: (type: FormFieldType, index?: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

function typeLabel(field: FormField): string {
  if (field.type === "SECTION") {
    return "Section";
  }
  if (field.type === "DIVIDER") {
    return "Divider";
  }
  return field.type.replace("_", " ").toLowerCase();
}

/**
 * Centre canvas: an ordered list of fields with drop zones for palette drops,
 * row drag-and-drop reordering and keyboard move buttons. Sections are rows of
 * type SECTION, so reordering a section also moves everything under it.
 */
export default function FormCanvas({
  schema,
  selectedId,
  issues,
  onSelect,
  onMove,
  onRemove,
  onAdd,
  onReorder,
}: FormCanvasProps) {
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const issueByField = new Map<string, string>();
  for (const issue of issues) {
    if (!issueByField.has(issue.fieldId)) {
      issueByField.set(issue.fieldId, issue.message);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, index: number) {
    event.preventDefault();
    setDropIndex(null);
    const paletteType = event.dataTransfer.getData(FIELD_DRAG_MIME);
    if (paletteType !== "") {
      onAdd(paletteType as FormFieldType, index);
      return;
    }
    const row = event.dataTransfer.getData(ROW_DRAG_MIME);
    if (row !== "") {
      onReorder(Number(row), index);
    }
  }

  const dropZone = (index: number) => (
    <div
      key={`drop-${index}`}
      className="awap-form__dropzone"
      data-active={dropIndex === index ? "true" : "false"}
      onDragOver={(event) => {
        if (
          event.dataTransfer.types.includes(FIELD_DRAG_MIME) ||
          event.dataTransfer.types.includes(ROW_DRAG_MIME)
        ) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropIndex(index);
        }
      }}
      onDragLeave={() => setDropIndex(null)}
      onDrop={(event) => handleDrop(event, index)}
    >
      <span className="awap-form__dropzone-label">Drop here</span>
    </div>
  );

  return (
    <section className="awap-form__canvas" aria-labelledby="form-canvas-heading" data-testid="form-canvas">
      <h2 id="form-canvas-heading" className="awap-form__panel-title">
        Form fields
      </h2>
      {schema.fields.length === 0 ? (
        <p className="awap-form__empty">
          Add a field from the palette. Drag it here or press Enter on a field type.
        </p>
      ) : null}
      <ol className="awap-form__rows">
        {schema.fields.map((field, index) => {
          const issue = issueByField.get(field.id);
          const label = fieldLabel(field);
          return (
            <li key={field.id} className="awap-form__row-item" data-field-id={field.id}>
              {dropZone(index)}
              <div
                className="awap-form__row"
                draggable
                data-selected={selectedId === field.id ? "true" : "false"}
                data-type={field.type}
                data-layout={NON_INPUT_TYPES.has(field.type) ? "true" : "false"}
                onDragStart={(event) => {
                  event.dataTransfer.setData(ROW_DRAG_MIME, String(index));
                  event.dataTransfer.effectAllowed = "move";
                }}
              >
                <button
                  type="button"
                  className="awap-form__row-select"
                  aria-label={`Select ${label}`}
                  aria-current={selectedId === field.id ? "true" : undefined}
                  onClick={() => onSelect(field.id)}
                >
                  <span className="awap-form__row-index" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="awap-form__row-text">
                    <span className="awap-form__row-label">{label}</span>
                    <span className="awap-form__row-meta">
                      {typeLabel(field)}
                      {field.required ? " · required" : ""}
                      {field.calculated ? ` · = ${field.calculated}` : ""}
                    </span>
                    {field.visibleWhen ? (
                      <span className="awap-form__row-rule">
                        {describeCondition(field.visibleWhen)}
                      </span>
                    ) : null}
                    {issue ? (
                      <span className="awap-form__row-issue">{issue}</span>
                    ) : null}
                  </span>
                </button>
                <div className="awap-form__row-actions">
                  <button
                    type="button"
                    className="awap-form__icon-button"
                    aria-label={`Move ${label} up`}
                    disabled={index === 0}
                    onClick={() => onMove(field.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="awap-form__icon-button"
                    aria-label={`Move ${label} down`}
                    disabled={index === schema.fields.length - 1}
                    onClick={() => onMove(field.id, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="awap-form__icon-button awap-form__icon-button--danger"
                    aria-label={`Remove ${label}`}
                    onClick={() => onRemove(field.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
            </li>
          );
        })}
        {schema.fields.length > 0 ? (
          <li className="awap-form__dropzone-item">{dropZone(schema.fields.length)}</li>
        ) : null}
      </ol>
    </section>
  );
}
