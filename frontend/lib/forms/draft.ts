/**
 * Autosave for the form builder and value preservation for the fill route
 * (UI/UX phase 6: builder autosave, U6-10 back-navigation).
 *
 * Storage is wrapped in try/catch because a full or disabled storage backend
 * must never break editing. Drafts are tenant scoped so two tenants on the same
 * browser never restore each other's unpublished schema.
 */

import type { FormField } from "./schema";

export const FORM_DRAFT_PREFIX = "awap:form-builder-draft:";
export const FORM_FILL_PREFIX = "awap:form-fill-values:";
export const AUTOSAVE_DELAY_MS = 600;

export interface FormDraft {
  name: string;
  fields: FormField[];
  formId: string | null;
  readOnly: boolean;
  savedAt: string;
}

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function formDraftKey(tenantId?: string | null): string {
  return `${FORM_DRAFT_PREFIX}${tenantId?.trim() || "default"}`;
}

export function fillValuesKey(formId: string): string {
  return `${FORM_FILL_PREFIX}${formId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses a stored builder draft defensively; corrupt payloads are ignored. */
export function parseFormDraft(raw: string | null): FormDraft | null {
  if (raw === null || raw === "") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.fields)) {
    return null;
  }
  const fields = parsed.fields.filter(
    (field): field is FormField =>
      isRecord(field) && typeof field.id === "string" && typeof field.type === "string",
  );
  return {
    name: typeof parsed.name === "string" ? parsed.name : "",
    fields,
    formId: typeof parsed.formId === "string" ? parsed.formId : null,
    readOnly: parsed.readOnly === true,
    savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date(0).toISOString(),
  };
}

export function saveFormDraft(
  storage: DraftStorage,
  key: string,
  draft: Omit<FormDraft, "savedAt">,
): boolean {
  try {
    storage.setItem(key, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
}

export function loadFormDraft(storage: DraftStorage, key: string): FormDraft | null {
  try {
    return parseFormDraft(storage.getItem(key));
  } catch {
    return null;
  }
}

export function clearFormDraft(storage: DraftStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Ignore unavailable storage.
  }
}

/** Fill values survive an in-app navigation and a browser back to the fill route. */
export function saveFillValues(
  storage: DraftStorage,
  formId: string,
  values: Record<string, string>,
): void {
  if (formId === "") {
    return;
  }
  try {
    storage.setItem(fillValuesKey(formId), JSON.stringify(values));
  } catch {
    // Ignore quota errors; the in-memory state still works.
  }
}

export function loadFillValues(
  storage: DraftStorage,
  formId: string,
): Record<string, string> | null {
  if (formId === "") {
    return null;
  }
  try {
    const raw = storage.getItem(fillValuesKey(formId));
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        values[key] = value;
      }
    }
    return values;
  } catch {
    return null;
  }
}

export function clearFillValues(storage: DraftStorage, formId: string): void {
  try {
    storage.removeItem(fillValuesKey(formId));
  } catch {
    // Ignore unavailable storage.
  }
}

/** Signature used to decide whether a draft differs from the saved definition. */
export function draftSignature(name: string, fields: FormField[]): string {
  const sorted = fields.map((field) => JSON.stringify(field));
  return `${name}\u0000${sorted.join("\u0001")}`;
}
