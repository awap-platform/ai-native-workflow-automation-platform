/** Version comparison and rollback helpers for the designer. */

export interface WorkflowVersionSnapshot {
  id?: string;
  version: number;
  definitionJson: string;
  status: string;
  archived: boolean;
  current: boolean;
  createdAt: string;
}

interface DefinitionNode {
  id: string;
  type?: string;
  name?: string;
  config?: unknown;
}

interface DefinitionTransition {
  id: string;
  from: string;
  to: string;
  condition?: string;
}

export interface ParsedDefinition {
  nodes: DefinitionNode[];
  transitions: DefinitionTransition[];
}

export interface VersionDiff {
  nodesAdded: string[];
  nodesRemoved: string[];
  nodesChanged: string[];
  transitionsAdded: string[];
  transitionsRemoved: string[];
  transitionsChanged: string[];
  summary: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses a snapshot defensively; invalid JSON returns null so the UI can show a warning. */
export function parseDefinition(json: string): ParsedDefinition | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.nodes)) {
    return null;
  }
  const nodes = parsed.nodes.flatMap((raw): DefinitionNode[] => {
    if (!isRecord(raw) || typeof raw.id !== "string") {
      return [];
    }
    return [
      {
        id: raw.id,
        ...(typeof raw.type === "string" ? { type: raw.type } : {}),
        ...(typeof raw.name === "string" ? { name: raw.name } : {}),
        ...("config" in raw ? { config: raw.config } : {}),
      },
    ];
  });
  const rawTransitions = Array.isArray(parsed.transitions)
    ? parsed.transitions
    : Array.isArray(parsed.edges)
      ? parsed.edges
      : [];
  const transitions = rawTransitions.flatMap((raw): DefinitionTransition[] => {
    if (
      !isRecord(raw) ||
      typeof raw.id !== "string" ||
      typeof raw.from !== "string" ||
      typeof raw.to !== "string"
    ) {
      return [];
    }
    return [
      {
        id: raw.id,
        from: raw.from,
        to: raw.to,
        ...(typeof raw.condition === "string" ? { condition: raw.condition } : {}),
      },
    ];
  });
  return { nodes, transitions };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

/**
 * Compares two definition snapshots by id. Node config and transition conditions are compared with
 * a canonical JSON encoding so key order never produces a false change.
 */
export function compareDefinitionVersions(fromJson: string, toJson: string): VersionDiff {
  const from = parseDefinition(fromJson);
  const to = parseDefinition(toJson);
  if (from === null || to === null) {
    return {
      nodesAdded: [],
      nodesRemoved: [],
      nodesChanged: [],
      transitionsAdded: [],
      transitionsRemoved: [],
      transitionsChanged: [],
      summary: ["One of the versions has an invalid definition snapshot."],
    };
  }
  const fromNodes = new Map(from.nodes.map((node) => [node.id, node]));
  const toNodes = new Map(to.nodes.map((node) => [node.id, node]));
  const nodesAdded = to.nodes.filter((node) => !fromNodes.has(node.id)).map((node) => node.id);
  const nodesRemoved = from.nodes.filter((node) => !toNodes.has(node.id)).map((node) => node.id);
  const nodesChanged = from.nodes.flatMap((node) => {
    const target = toNodes.get(node.id);
    if (!target) {
      return [];
    }
    return canonical(node) === canonical(target) ? [] : [node.id];
  });

  const fromTransitions = new Map(from.transitions.map((transition) => [transition.id, transition]));
  const toTransitions = new Map(to.transitions.map((transition) => [transition.id, transition]));
  const transitionsAdded = to.transitions
    .filter((transition) => !fromTransitions.has(transition.id))
    .map((transition) => transition.id);
  const transitionsRemoved = from.transitions
    .filter((transition) => !toTransitions.has(transition.id))
    .map((transition) => transition.id);
  const transitionsChanged = from.transitions.flatMap((transition) => {
    const target = toTransitions.get(transition.id);
    if (!target) {
      return [];
    }
    return canonical(transition) === canonical(target) ? [] : [transition.id];
  });

  const summary: string[] = [];
  if (nodesAdded.length > 0) {
    summary.push(`${nodesAdded.length} node(s) added`);
  }
  if (nodesRemoved.length > 0) {
    summary.push(`${nodesRemoved.length} node(s) removed`);
  }
  if (nodesChanged.length > 0) {
    summary.push(`${nodesChanged.length} node(s) changed`);
  }
  if (transitionsAdded.length > 0) {
    summary.push(`${transitionsAdded.length} transition(s) added`);
  }
  if (transitionsRemoved.length > 0) {
    summary.push(`${transitionsRemoved.length} transition(s) removed`);
  }
  if (transitionsChanged.length > 0) {
    summary.push(`${transitionsChanged.length} transition(s) changed`);
  }
  return {
    nodesAdded,
    nodesRemoved,
    nodesChanged,
    transitionsAdded,
    transitionsRemoved,
    transitionsChanged,
    summary: summary.length === 0 ? ["No changes between these versions."] : summary,
  };
}

/** Published, non-archived versions can be rolled back to; the current one is excluded. */
export function rollbackCandidates(
  versions: readonly WorkflowVersionSnapshot[],
): WorkflowVersionSnapshot[] {
  return versions.filter(
    (version) => version.status === "PUBLISHED" && !version.archived && !version.current,
  );
}

/** The version displayed when the history panel opens. */
export function latestComparable(
  versions: readonly WorkflowVersionSnapshot[],
): WorkflowVersionSnapshot | null {
  return versions.find((version) => !version.archived) ?? versions[0] ?? null;
}

/** Post-publish summary shown to the operator before they leave the designer. */
export function publishSummary(version: WorkflowVersionSnapshot): string {
  return `Version ${version.version} is published and is now the current version.`;
}
