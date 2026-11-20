/**
 * Decision-comment drafts (risk R3-06).
 *
 * A half-written rejection reason must survive an accidental tab close. Drafts are per task and
 * per browser, written synchronously on every keystroke (the payload is tiny) and removed as soon
 * as the decision is accepted. Storage failures degrade to in-memory behaviour instead of blocking
 * the reviewer.
 */

export const DRAFT_LIMIT = 2000;
const PREFIX = "awap_task_draft:";

const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function key(taskId: string): string {
  return `${PREFIX}${taskId}`;
}

/** Trims to the server's limit so an oversized paste cannot produce a 400 later. */
export function clampDraft(text: string): string {
  return text.slice(0, DRAFT_LIMIT);
}

export function saveDraft(taskId: string, text: string): void {
  const value = clampDraft(text);
  memory.set(taskId, value);
  const store = storage();
  if (!store) {
    return;
  }
  try {
    if (value) {
      store.setItem(key(taskId), value);
    } else {
      store.removeItem(key(taskId));
    }
  } catch {
    // Quota or privacy mode: the in-memory copy still protects the current tab.
  }
}

export function loadDraft(taskId: string): string {
  const store = storage();
  if (store) {
    try {
      const stored = store.getItem(key(taskId));
      if (stored !== null) {
        return stored;
      }
    } catch {
      // fall through to memory
    }
  }
  return memory.get(taskId) ?? "";
}

export function clearDraft(taskId: string): void {
  memory.delete(taskId);
  const store = storage();
  if (!store) {
    return;
  }
  try {
    store.removeItem(key(taskId));
  } catch {
    // nothing to do
  }
}
