"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import FormCanvas from "../../../../components/forms/FormCanvas";
import FormFieldPalette from "../../../../components/forms/FormFieldPalette";
import FormPropertiesPanel from "../../../../components/forms/FormPropertiesPanel";
import FormRenderer from "../../../../components/forms/FormRenderer";
import {
  useCreateFormDefinition,
  useFormDefinition,
  useFormDefinitions,
  useUpdateFormDefinition,
} from "../../../../lib/hooks/resources";
import { useActiveTenant } from "../../../../lib/hooks/useActiveTenant";
import {
  AUTOSAVE_DELAY_MS,
  clearFormDraft,
  draftSignature,
  formDraftKey,
  loadFormDraft,
  saveFormDraft,
  type FormDraft,
} from "../../../../lib/forms/draft";
import {
  createField,
  fieldLabel,
  parseFormSchema,
  schemaIssues,
  validateValues,
  type FieldIssue,
  type FormField,
  type FormFieldType,
  type FormSchema,
  type FormValues,
} from "../../../../lib/forms/schema";

const DEFAULT_PREVIEW_VALUE = "";

/** Rewrites every reference to `oldId` when a field is renamed. */
function renameReferences(fields: FormField[], oldId: string, newId: string): FormField[] {
  const pattern = new RegExp(`\\b${oldId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  return fields.map((field) => {
    const next: FormField = { ...field };
    if (field.id === oldId) {
      next.id = newId;
    }
    if (field.visibleWhen && field.visibleWhen.fieldId === oldId) {
      next.visibleWhen = { ...field.visibleWhen, fieldId: newId };
    }
    if (field.calculated) {
      next.calculated = field.calculated.replace(pattern, newId);
    }
    return next;
  });
}

/**
 * Phase 6 form builder: palette on the left, canvas in the centre, properties on
 * the right, a preview that shares the fill renderer, schema validation with
 * cycle detection, drag-and-drop ordering and a tenant-scoped autosaved draft.
 */
export default function FormBuilderPage() {
  const tenant = useActiveTenant();
  const definitions = useFormDefinitions();
  const createForm = useCreateFormDefinition();
  const updateForm = useUpdateFormDefinition();

  const [name, setName] = useState("");
  const [fields, setFields] = useState<FormField[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formId, setFormId] = useState("");
  const [version, setVersion] = useState<number | null>(null);
  const [mode, setMode] = useState<"build" | "preview">("build");
  const [readOnly, setReadOnly] = useState(false);
  const [previewValues, setPreviewValues] = useState<FormValues>({});
  const [previewErrors, setPreviewErrors] = useState<FieldIssue[]>([]);
  const [focusRequests, setFocusRequests] = useState(0);
  const [message, setMessage] = useState("");
  const [draftNotice, setDraftNotice] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [savedSignature, setSavedSignature] = useState("");
  const [loadId, setLoadId] = useState("");
  const appliedDefinition = useRef<string | null>(null);

  const definitionQuery = useFormDefinition(loadId);
  const draftKey = formDraftKey(tenant);

  const schema = useMemo<FormSchema>(() => ({ name, version: version ?? undefined, fields }), [
    name,
    version,
    fields,
  ]);
  const issues = useMemo(() => schemaIssues(schema), [schema]);
  const selected = fields.find((field) => field.id === selectedId) ?? null;
  const signature = draftSignature(name, fields);
  const dirty = hydrated && signature !== savedSignature;

  /* Restore the autosaved draft once, before autosave starts writing. */
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const draft: FormDraft | null = loadFormDraft(window.localStorage, draftKey);
    if (draft) {
      queueMicrotask(() => {
        setName(draft.name);
        setFields(draft.fields);
        setFormId(draft.formId ?? "");
        setReadOnly(draft.readOnly);
        setMessage("Draft restored from this browser.");
        setHydrated(true);
      });
      return;
    }
    queueMicrotask(() => setHydrated(true));
  }, [draftKey]);

  /* Debounced autosave, skipped until the draft has been restored. */
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") {
      return;
    }
    const timer = setTimeout(() => {
      const saved = saveFormDraft(window.localStorage, draftKey, {
        name,
        fields,
        formId: formId === "" ? null : formId,
        readOnly,
      });
      if (saved) {
        setDraftNotice(`Draft autosaved at ${new Date().toLocaleTimeString()}.`);
      }
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hydrated, name, fields, formId, readOnly, draftKey]);

  /* Warn before leaving with unsaved builder changes. */
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  /* Apply a loaded definition exactly once per selection. */
  useEffect(() => {
    const loaded = definitionQuery.data;
    if (!loaded || appliedDefinition.current === loaded.id) {
      return;
    }
    appliedDefinition.current = loaded.id;
    const parsed = parseFormSchema(loaded.schemaJson);
    if (!parsed.schema) {
      queueMicrotask(() => setMessage(parsed.error ?? "The saved schema could not be read."));
      return;
    }
    queueMicrotask(() => {
      setName(loaded.name);
      setFields(parsed.schema?.fields ?? []);
      setFormId(loaded.id);
      setVersion(loaded.version);
      setSavedSignature(draftSignature(loaded.name, parsed.schema?.fields ?? []));
      setMessage(`Loaded version ${loaded.version}.`);
    });
  }, [definitionQuery.data]);

  function addField(type: FormFieldType, index?: number) {
    const field = createField({ fields }, type);
    setFields((current) => {
      const next = [...current];
      next.splice(index ?? next.length, 0, field);
      return next;
    });
    setSelectedId(field.id);
    setMode("build");
  }

  function patchField(patch: Partial<FormField>) {
    setFields((current) =>
      current.map((field) => (field.id === selectedId ? { ...field, ...patch } : field)),
    );
  }

  function renameField(newId: string) {
    if (!selected || newId === selected.id || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(newId)) {
      return;
    }
    setFields((current) => renameReferences(current, selected.id, newId));
    setSelectedId(newId);
  }

  function removeField(fieldId: string) {
    setFields((current) => current.filter((field) => field.id !== fieldId));
    if (selectedId === fieldId) {
      setSelectedId(null);
    }
  }

  function moveField(fieldId: string, direction: -1 | 1) {
    setFields((current) => {
      const index = current.findIndex((field) => field.id === fieldId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) {
        return current;
      }
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (moved) {
        next.splice(target, 0, moved);
      }
      return next;
    });
  }

  function reorder(fromIndex: number, toIndex: number) {
    setFields((current) => {
      if (
        fromIndex < 0 ||
        fromIndex >= current.length ||
        toIndex < 0 ||
        toIndex > current.length
      ) {
        return current;
      }
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) {
        return current;
      }
      next.splice(fromIndex < toIndex ? toIndex - 1 : toIndex, 0, moved);
      return next;
    });
  }

  async function save() {
    setMessage("");
    if (issues.length > 0) {
      setMessage(`Fix ${issues.length} schema problem(s) before saving.`);
      return;
    }
    if (name.trim() === "") {
      setMessage("Give the form a name before saving.");
      return;
    }
    const schemaJson = JSON.stringify({ name, version: version ?? 1, fields });
    try {
      const saved = formId
        ? await updateForm.mutateAsync({ id: formId, name, schemaJson })
        : await createForm.mutateAsync({ name, schemaJson });
      setFormId(saved.id);
      setVersion(saved.version);
      setSavedSignature(draftSignature(name, fields));
      setMessage(
        formId
          ? `Saved version ${saved.version}.`
          : `Created the form with version ${saved.version}.`,
      );
      if (typeof window !== "undefined") {
        clearFormDraft(window.localStorage, draftKey);
      }
      setDraftNotice("");
    } catch {
      setMessage("Save failed. The draft stays in this browser.");
    }
  }

  function validatePreview() {
    setPreviewErrors(validateValues(schema, previewValues));
    setFocusRequests((count) => count + 1);
  }

  function startNew() {
    setFormId("");
    setVersion(null);
    setFields([]);
    setName("");
    setSelectedId(null);
    setPreviewValues({});
    setPreviewErrors([]);
    setSavedSignature("");
    setMessage("Started a new form.");
  }

  const saving = createForm.isPending || updateForm.isPending;

  return (
    <div className="awap-form-builder">
      <header className="awap-form__toolbar">
        <div>
          <h1 className="awap-form__heading">Form Builder</h1>
          <p className="awap-form__hint">
            {version === null ? "Unsaved form" : `Version ${version}`}
            {dirty ? " · unsaved changes" : ""}
          </p>
        </div>
        <label className="awap-form__field-label" htmlFor="form-name">
          Form name
        </label>
        <input
          id="form-name"
          className="awap-form__control"
          value={name}
          placeholder="Form name"
          aria-label="Form name"
          onChange={(event) => setName(event.target.value)}
        />
        <label className="awap-form__field-label" htmlFor="load-form">
          Load a saved form
        </label>
        <select
          id="load-form"
          className="awap-form__control"
          value={loadId}
          onChange={(event) => setLoadId(event.target.value)}
        >
          <option value="">Select a form</option>
          {(definitions.data ?? []).map((definition) => (
            <option key={definition.id} value={definition.id}>
              {definition.name} (v{definition.version})
            </option>
          ))}
        </select>
        <button type="button" className="awap-form__button" onClick={startNew}>
          New form
        </button>
        <button
          type="button"
          className="awap-form__button awap-form__button--primary"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving…" : formId ? "Save new version" : "Save form"}
        </button>
        <button
          type="button"
          className="awap-form__button"
          aria-pressed={mode === "preview"}
          onClick={() => setMode(mode === "preview" ? "build" : "preview")}
        >
          {mode === "preview" ? "Back to builder" : "Preview"}
        </button>
        <label className="awap-form__checkbox" htmlFor="builder-read-only">
          <input
            id="builder-read-only"
            type="checkbox"
            checked={readOnly}
            onChange={(event) => setReadOnly(event.target.checked)}
          />
          <span>Read-only view</span>
        </label>
      </header>

      <div className="awap-form__messages">
        <p role="status" aria-live="polite">
          {message}
        </p>
        <p role="status" aria-live="polite" className="awap-form__hint">
          {draftNotice}
        </p>
        {issues.length > 0 ? (
          <ul className="awap-form__issues" aria-label="Schema problems" data-testid="schema-issues">
            {issues.map((issue) => (
              <li key={`${issue.fieldId}-${issue.message}`} className="awap-form__issue">
                {issue.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {mode === "preview" ? (
        <section className="awap-form__preview" aria-label="Form preview" data-testid="form-preview">
          <h2 className="awap-form__panel-title">Preview</h2>
          <p className="awap-form__hint">
            The preview uses the same renderer as the fill route{readOnly ? " (read-only)" : ""}.
          </p>
          <FormRenderer
            schema={schema}
            values={previewValues}
            errors={previewErrors}
            readOnly={readOnly}
            idPrefix="preview"
            focusRequests={focusRequests}
            onChange={(fieldId, value) =>
              setPreviewValues((current) => ({ ...current, [fieldId]: value || DEFAULT_PREVIEW_VALUE }))
            }
          />
          <div className="awap-form__row-actions">
            <button type="button" className="awap-form__button" onClick={validatePreview}>
              Validate preview
            </button>
            <button
              type="button"
              className="awap-form__button"
              onClick={() => {
                setPreviewValues({});
                setPreviewErrors([]);
              }}
            >
              Clear preview values
            </button>
          </div>
        </section>
      ) : (
        <div className="awap-form__layout" data-read-only={readOnly ? "true" : "false"}>
          <FormFieldPalette onAdd={(type) => addField(type)} />
          <FormCanvas
            schema={schema}
            selectedId={selectedId}
            issues={issues}
            onSelect={setSelectedId}
            onMove={moveField}
            onRemove={removeField}
            onAdd={addField}
            onReorder={reorder}
          />
          <FormPropertiesPanel
            schema={schema}
            field={selected}
            issues={issues}
            onPatch={patchField}
            onRename={renameField}
            onRemove={() => {
              if (selected) {
                removeField(selected.id);
              }
            }}
          />
        </div>
      )}

      {readOnly ? (
        <p className="awap-form__readonly-banner" role="status">
          Read-only: use Preview to inspect how the saved version renders without editing.
        </p>
      ) : null}

      <p className="awap-form__hint">
        Selected: {selected ? fieldLabel(selected) : "none"}. Fields stay escaped as text; markup is
        never rendered.
      </p>
    </div>
  );
}
