import { NODE_TYPES, type WorkflowNodeType } from "./workflowDesigner";

export type PaletteGroupId = "events" | "activities" | "gateways" | "structural" | "extensions";

export interface PaletteGroup {
  id: PaletteGroupId;
  label: string;
  description: string;
}

export interface PaletteItem {
  type: WorkflowNodeType;
  label: string;
  group: PaletteGroupId;
  keywords: readonly string[];
}

/** Palette groups in BPMN reading order. */
export const PALETTE_GROUPS: readonly PaletteGroup[] = [
  { id: "events", label: "Events", description: "Start, end and timers" },
  { id: "activities", label: "Activities", description: "Human and AI work" },
  { id: "gateways", label: "Gateways", description: "Branching and joins" },
  { id: "structural", label: "Structural", description: "Embedded processes" },
  { id: "extensions", label: "Extensions", description: "Integrations and scripts" },
];

const GROUP_BY_TYPE: Record<WorkflowNodeType, PaletteGroupId> = {
  START: "events",
  END: "events",
  DELAY: "events",
  TASK: "activities",
  APPROVAL: "activities",
  FORM: "activities",
  AI_TASK: "activities",
  DECISION: "gateways",
  CONDITION: "gateways",
  PARALLEL_GATEWAY: "gateways",
  MERGE_GATEWAY: "gateways",
  SUB_PROCESS: "structural",
  WEBHOOK: "extensions",
  AI: "extensions",
  SCRIPT: "extensions",
};

const KEYWORDS: Record<WorkflowNodeType, readonly string[]> = {
  START: ["start", "trigger", "begin"],
  END: ["end", "finish", "complete"],
  DELAY: ["delay", "wait", "timer"],
  TASK: ["task", "human", "todo"],
  APPROVAL: ["approval", "review", "sign off"],
  FORM: ["form", "input", "questionnaire"],
  AI_TASK: ["ai", "assistant", "extract", "summarize"],
  DECISION: ["decision", "branch", "if", "exclusive"],
  CONDITION: ["condition", "spel", "guard"],
  PARALLEL_GATEWAY: ["parallel", "fork", "split"],
  MERGE_GATEWAY: ["merge", "join", "parallel"],
  SUB_PROCESS: ["sub process", "child", "call activity"],
  WEBHOOK: ["webhook", "http", "integration"],
  AI: ["ai", "model", "prompt"],
  SCRIPT: ["script", "code", "spel"],
};

export const PALETTE_ITEMS: readonly PaletteItem[] = NODE_TYPES.map((type) => ({
  type,
  label: titleCase(type),
  group: GROUP_BY_TYPE[type],
  keywords: KEYWORDS[type],
}));

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

/** Case-insensitive palette search over the type, label and keywords. */
export function filterPaletteItems(query: string): PaletteItem[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") {
    return [...PALETTE_ITEMS];
  }
  return PALETTE_ITEMS.filter((item) => {
    const haystack = [item.type, item.label, ...item.keywords].join(" ").toLowerCase();
    return haystack.includes(normalized);
  });
}

/** Items grouped for rendering; groups with no match are omitted. */
export function paletteByGroup(query = ""): Array<PaletteGroup & { items: PaletteItem[] }> {
  const items = filterPaletteItems(query);
  return PALETTE_GROUPS.map((group) => ({
    ...group,
    items: items.filter((item) => item.group === group.id),
  })).filter((group) => group.items.length > 0);
}

/** Wraps the keyboard cursor inside the filtered result list. */
export function nextPaletteIndex(current: number, count: number, delta: number): number {
  if (count <= 0) {
    return -1;
  }
  return (((current + delta) % count) + count) % count;
}

/** Maps the palette keyboard contract to an index, or null when the key is not a navigation key. */
export function paletteNavigationIndex(
  key: string,
  current: number,
  count: number,
): number | null {
  switch (key) {
    case "ArrowDown":
      return nextPaletteIndex(current < 0 ? -1 : current, count, 1);
    case "ArrowUp":
      return nextPaletteIndex(current < 0 ? count : current, count, -1);
    case "Home":
      return count > 0 ? 0 : -1;
    case "End":
      return count > 0 ? count - 1 : -1;
    default:
      return null;
  }
}
