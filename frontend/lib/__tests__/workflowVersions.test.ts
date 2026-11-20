import {
  compareDefinitionVersions,
  latestComparable,
  parseDefinition,
  publishSummary,
  rollbackCandidates,
  type WorkflowVersionSnapshot,
} from "../workflowVersions";

const v1 = JSON.stringify({
  nodes: [
    { id: "s", type: "START", name: "Start" },
    { id: "t", type: "TASK", name: "Review", config: { timeoutSeconds: 30 } },
    { id: "e", type: "END", name: "End" },
  ],
  transitions: [
    { id: "a", from: "s", to: "t" },
    { id: "b", from: "t", to: "e" },
  ],
});

const v2 = JSON.stringify({
  nodes: [
    { id: "s", type: "START", name: "Start" },
    { id: "t", type: "TASK", name: "Review", config: { timeoutSeconds: 60 } },
    { id: "f", type: "APPROVAL", name: "Approve" },
    { id: "e", type: "END", name: "End" },
  ],
  transitions: [
    { id: "a", from: "s", to: "t" },
    { id: "c", from: "t", to: "f" },
    { id: "b", from: "f", to: "e", condition: "#amount > 100" },
  ],
});

function version(overrides: Partial<WorkflowVersionSnapshot>): WorkflowVersionSnapshot {
  return {
    version: 1,
    definitionJson: v1,
    status: "DRAFT",
    archived: false,
    current: false,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("version comparison", () => {
  it("reports added, removed and changed nodes and transitions", () => {
    const diff = compareDefinitionVersions(v1, v2);
    expect(diff.nodesAdded).toEqual(["f"]);
    expect(diff.nodesRemoved).toEqual([]);
    expect(diff.nodesChanged).toEqual(["t"]);
    expect(diff.transitionsAdded).toEqual(["c"]);
    expect(diff.transitionsRemoved).toEqual([]);
    expect(diff.transitionsChanged).toEqual(["b"]);
    expect(diff.summary).toEqual([
      "1 node(s) added",
      "1 node(s) changed",
      "1 transition(s) added",
      "1 transition(s) changed",
    ]);
  });

  it("ignores object key order in config", () => {
    const left = JSON.stringify({
      nodes: [{ id: "n", type: "TASK", config: { a: 1, b: 2 } }],
      transitions: [],
    });
    const right = JSON.stringify({
      nodes: [{ id: "n", type: "TASK", config: { b: 2, a: 1 } }],
      transitions: [],
    });
    expect(compareDefinitionVersions(left, right).nodesChanged).toEqual([]);
  });

  it("reports no changes for identical snapshots and a warning for invalid JSON", () => {
    expect(compareDefinitionVersions(v1, v1).summary).toEqual([
      "No changes between these versions.",
    ]);
    expect(compareDefinitionVersions("not json", v1).summary).toEqual([
      "One of the versions has an invalid definition snapshot.",
    ]);
  });

  it("parses transitions from the legacy edges key", () => {
    const parsed = parseDefinition(
      JSON.stringify({ nodes: [{ id: "n" }], edges: [{ id: "e", from: "n", to: "n" }] }),
    );
    expect(parsed?.transitions).toEqual([{ id: "e", from: "n", to: "n" }]);
  });
});

describe("rollback and publish helpers", () => {
  const versions = [
    version({ version: 3, status: "PUBLISHED", current: true }),
    version({ version: 2, status: "PUBLISHED" }),
    version({ version: 1, status: "PUBLISHED", archived: true }),
    version({ version: 4, status: "DRAFT" }),
  ];

  it("offers only published non-archived non-current versions for rollback", () => {
    expect(rollbackCandidates(versions).map((item) => item.version)).toEqual([2]);
  });

  it("selects the latest non-archived version for the comparison panel", () => {
    expect(latestComparable(versions)?.version).toBe(3);
    expect(latestComparable([])).toBeNull();
  });

  it("produces a post-publish summary", () => {
    expect(publishSummary(version({ version: 7 }))).toContain("Version 7 is published");
  });
});
