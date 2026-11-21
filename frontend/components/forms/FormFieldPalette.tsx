"use client";

import { useMemo, useState } from "react";

import { FIELD_TYPES, NON_INPUT_TYPES, type FormFieldType } from "../../lib/forms/schema";

/** MIME type used when a palette entry is dropped on the canvas. */
export const FIELD_DRAG_MIME = "application/x-awap-form-field";

interface PaletteEntry {
  type: FormFieldType;
  label: string;
}

const GROUPS: Array<{ title: string; entries: PaletteEntry[] }> = [
  {
    title: "Basic",
    entries: [
      { type: "TEXT", label: "Single line text" },
      { type: "TEXTAREA", label: "Paragraph text" },
      { type: "NUMBER", label: "Number" },
    ],
  },
  {
    title: "Contact",
    entries: [
      { type: "EMAIL", label: "Email address" },
      { type: "PHONE", label: "Phone number" },
    ],
  },
  {
    title: "Date & time",
    entries: [
      { type: "DATE", label: "Date" },
      { type: "DATETIME", label: "Date and time" },
    ],
  },
  {
    title: "Choice",
    entries: [
      { type: "SELECT", label: "Dropdown" },
      { type: "MULTI_SELECT", label: "Checkbox list" },
      { type: "BOOLEAN", label: "Yes / no" },
    ],
  },
  {
    title: "Attachment",
    entries: [{ type: "FILE", label: "File upload" }],
  },
  {
    title: "Layout",
    entries: [
      { type: "SECTION", label: "Section heading" },
      { type: "DIVIDER", label: "Divider" },
    ],
  },
];

/** Every palette type must appear exactly once; the unit test asserts this. */
export const PALETTE_TYPES: FormFieldType[] = GROUPS.flatMap((group) =>
  group.entries.map((entry) => entry.type),
);

export interface FormFieldPaletteProps {
  onAdd: (type: FormFieldType) => void;
}

/**
 * Left palette: grouped native buttons with a search filter. Buttons are
 * draggable (`FIELD_DRAG_MIME`) and also insert on click/Enter, so the builder
 * works with a pointer, a keyboard and a screen reader.
 */
export default function FormFieldPalette({ onAdd }: FormFieldPaletteProps) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const groups = useMemo(
    () =>
      GROUPS.map((group) => ({
        title: group.title,
        entries: group.entries.filter(
          (entry) =>
            needle === "" ||
            entry.label.toLowerCase().includes(needle) ||
            entry.type.toLowerCase().includes(needle),
        ),
      })).filter((group) => group.entries.length > 0),
    [needle],
  );

  const total = groups.reduce((sum, group) => sum + group.entries.length, 0);

  return (
    <section className="awap-form__palette" aria-labelledby="form-palette-heading">
      <h2 id="form-palette-heading" className="awap-form__panel-title">
        Field types
      </h2>
      <label className="awap-form__field-label" htmlFor="form-palette-search">
        Search field types
      </label>
      <input
        id="form-palette-search"
        className="awap-form__control"
        type="search"
        value={query}
        placeholder="Filter fields"
        onChange={(event) => setQuery(event.target.value)}
      />
      {total === 0 ? (
        <p className="awap-form__hint" role="status">
          No field type matches “{query}”.
        </p>
      ) : null}
      {groups.map((group) => (
        <div key={group.title} className="awap-form__palette-group">
          <h3 className="awap-form__palette-group-title">{group.title}</h3>
          <ul className="awap-form__palette-list">
            {group.entries.map((entry) => (
              <li key={entry.type}>
                <button
                  type="button"
                  className="awap-form__palette-button"
                  aria-label={entry.type}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(FIELD_DRAG_MIME, entry.type);
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => onAdd(entry.type)}
                >
                  <span aria-hidden="true">{entry.label}</span>
                  <span className="awap-form__palette-hint" aria-hidden="true">
                    {NON_INPUT_TYPES.has(entry.type) ? "layout" : entry.type.toLowerCase()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="awap-form__hint">
        {FIELD_TYPES.length} field types. Drag onto the canvas or press Enter to append.
      </p>
    </section>
  );
}
