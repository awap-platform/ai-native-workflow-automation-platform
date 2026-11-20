import type { WorkflowEdge, WorkflowNode } from "./workflowGraph";

/** Storage key prefix for designer drafts; the tenant scope is appended by {@link draftKey}. */
export const DRAFT_STORAGE_PREFIX = "awap:designer-draft:";

export interface DesignerDraft {
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  definitionId: string | null;
  savedAt: string;
}

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Scoped key so two tenants on the same browser never restore each other's draft. */
export function draftKey(tenantId?: string | null): string {
  return `${DRAFT_STORAGE_PREFIX}${tenantId?.trim() || "default"}`;
}

export function serializeDraft(draft: Omit<DesignerDraft, "savedAt"> & { savedAt?: string }): string {
  return JSON.stringify({ ...draft, savedAt: draft.savedAt ?? new Date().toISOString() });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses a stored draft defensively; corrupt or partial payloads are ignored instead of crashing. */
export function parseDraft(raw: string | null): DesignerDraft | null {
  if (raw === null || raw === "") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    return null;
  }
  const nodes = parsed.nodes.filter(
    (node): node is WorkflowNode =>
      isRecord(node) &&
      typeof node.id === "string" &&
      typeof node.type === "string" &&
      isRecord(node.position) &&
      isRecord(node.data),
  );
  const edges = parsed.edges.filter(
    (edge): edge is WorkflowEdge =>
      isRecord(edge) &&
      typeof edge.id === "string" &&
      typeof edge.source === "string" &&
      typeof edge.target === "string",
  );
  return {
    name: typeof parsed.name === "string" ? parsed.name : "",
    nodes,
    edges,
    definitionId: typeof parsed.definitionId === "string" ? parsed.definitionId : null,
    savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date(0).toISOString(),
  };
}

export function saveDraft(
  storage: DraftStorage,
  key: string,
  draft: Omit<DesignerDraft, "savedAt">,
): boolean {
  try {
    storage.setItem(key, serializeDraft(draft));
    return true;
  } catch {
    // Quota errors or a disabled storage backend must never break editing.
    return false;
  }
}

export function loadDraft(storage: DraftStorage, key: string): DesignerDraft | null {
  try {
    return parseDraft(storage.getItem(key));
  } catch {
    return null;
  }
}

export function clearDraft(storage: DraftStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Ignore unavailable storage.
  }
}

/** The browser only shows the unload prompt when a handler calls preventDefault. */
export function requestUnloadGuard(event: { preventDefault: () => void }, dirty: boolean): boolean {
  if (!dirty) {
    return false;
  }
  event.preventDefault();
  return true;
}

export interface NavigationClick {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

function anchorFrom(target: EventTarget | null): { href: string } | null {
  const element = target as Element | null;
  const anchor = element?.closest?.("a[href]");
  if (!anchor) {
    return null;
  }
  const href = anchor.getAttribute("href");
  return href === null ? null : { href };
}

/**
 * In-app navigation guard. A modified click (new tab/window), a non-primary button or an
 * external link is left alone; a same-origin navigation with unsaved work asks for confirmation.
 */
export type NavigationGuardDecision = "allow" | "block" | "ignore";

export function guardNavigation(
  click: NavigationClick,
  dirty: boolean,
  confirmChange: (message: string) => boolean,
  currentOrigin = typeof window === "undefined" ? "http://localhost" : window.location.origin,
): NavigationGuardDecision {
  if (!dirty || click.defaultPrevented || click.button !== 0) {
    return "ignore";
  }
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) {
    return "ignore";
  }
  const anchor = anchorFrom(click.target);
  if (anchor === null || anchor.href.startsWith("#") || anchor.href.startsWith("mailto:")) {
    return "ignore";
  }
  let url: URL;
  try {
    url = new URL(anchor.href, currentOrigin);
  } catch {
    return "ignore";
  }
  if (url.origin !== currentOrigin) {
    return "ignore";
  }
  return confirmChange("You have unsaved changes. Leave the designer and discard them?")
    ? "allow"
    : "block";
}

/** Autosave debounce shared by the page and its unit tests. */
export const AUTOSAVE_DELAY_MS = 800;

export function shouldAutosave(
  dirty: boolean,
  nodes: readonly unknown[],
  edges: readonly unknown[],
): boolean {
  return dirty && (nodes.length > 0 || edges.length > 0);
}
