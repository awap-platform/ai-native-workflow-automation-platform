/**
 * Saved inbox views (phase 3).
 *
 * A saved view is just a named filter/search/sort triple; storing it in the browser keeps the
 * server contract untouched while still letting a reviewer jump back to "Overdue on my desk".
 */

import { TASK_FILTERS, TASK_SORTS, type InboxQuery } from "./inbox";

export interface SavedView {
  id: string;
  name: string;
  query: InboxQuery;
}

export const SAVED_VIEW_LIMIT = 8;
export const SAVED_VIEW_KEY = "awap_task_saved_views";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Rejects anything stored by an older build or hand-edited devtools value. */
export function parseSavedViews(raw: string | null): SavedView[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry): entry is SavedView => {
        if (!entry || typeof entry !== "object") {
          return false;
        }
        const view = entry as Partial<SavedView>;
        return (
          typeof view.id === "string" &&
          typeof view.name === "string" &&
          !!view.query &&
          TASK_FILTERS.includes(view.query.filter) &&
          TASK_SORTS.includes(view.query.sort) &&
          typeof view.query.search === "string"
        );
      })
      .slice(0, SAVED_VIEW_LIMIT);
  } catch {
    return [];
  }
}

export function listSavedViews(): SavedView[] {
  const store = storage();
  if (!store) {
    return [];
  }
  try {
    return parseSavedViews(store.getItem(SAVED_VIEW_KEY));
  } catch {
    return [];
  }
}

function persist(views: SavedView[]): SavedView[] {
  const store = storage();
  if (store) {
    try {
      store.setItem(SAVED_VIEW_KEY, JSON.stringify(views));
    } catch {
      // Quota or privacy mode: the caller still gets the updated list for this render.
    }
  }
  return views;
}

/** Adds a view, replacing a same-named one so re-saving a tweak does not duplicate it. */
export function saveView(name: string, query: InboxQuery): SavedView[] {
  const trimmed = name.trim();
  if (!trimmed) {
    return listSavedViews();
  }
  const existing = listSavedViews().filter((view) => view.name !== trimmed);
  const view: SavedView = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed.slice(0, 40),
    query: { ...query },
  };
  return persist([view, ...existing].slice(0, SAVED_VIEW_LIMIT));
}

export function deleteView(id: string): SavedView[] {
  return persist(listSavedViews().filter((view) => view.id !== id));
}

/* ------------------------------------------------------------------ store */

const EMPTY: SavedView[] = [];
const listeners = new Set<() => void>();
let snapshot: SavedView[] | null = null;

function emit(): void {
  snapshot = null;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeSavedViews(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Cached so `useSyncExternalStore` gets a stable array between renders. */
export function savedViewsSnapshot(): SavedView[] {
  if (snapshot === null) {
    snapshot = listSavedViews();
  }
  return snapshot;
}

export function savedViewsServerSnapshot(): SavedView[] {
  return EMPTY;
}

/** Mutating wrappers used by the UI; they notify every subscribed inbox. */
export function addSavedView(name: string, query: InboxQuery): void {
  saveView(name, query);
  emit();
}

export function removeSavedView(id: string): void {
  deleteView(id);
  emit();
}
