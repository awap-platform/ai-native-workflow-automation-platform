import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  checkDocuments,
  extractMarkdownLinks,
  parseCapabilityRows,
  validateRows,
} from "../check-capability-matrix.mjs";

const HEADER = [
  "## Capability status",
  "",
  "| ID | Capability | Status | Evidence | Issue |",
  "|---|---|---|---|---|",
];

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "awap-capabilities-"));
  for (const [relativePath, contents] of Object.entries(files)) {
    const full = join(root, relativePath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents, "utf8");
  }
  return root;
}

function validationErrors(rows, root = process.cwd(), docPath = "docs/test.md") {
  return validateRows(rows, { root, docPath });
}

test("extractMarkdownLinks ignores code spans and keeps relative targets", () => {
  const links = extractMarkdownLinks(
    "[`Test.java`](../backend/src/test/java/Test.java) and `[inline](ignored.md)`",
  );
  assert.deepEqual(links, ["../backend/src/test/java/Test.java"]);
});

test("parseCapabilityRows reads only the capability status table", () => {
  const markdown = [
    "## Other",
    "| ID | Capability | Status | Evidence | Issue |",
    "|---|---|---|---|---|",
    "| NOPE-ONE | Wrong table | Implemented | [x](x) | #1 |",
    "",
    ...HEADER,
    "| COP-TOOLS | Tools | Implemented | [`A.java`](../backend/a/ATest.java) | #305 |",
    "",
    "## After",
  ].join("\n");
  const rows = parseCapabilityRows(markdown);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "COP-TOOLS");
  assert.equal(rows[0].status, "Implemented");
});

test("an Implemented row with an existing test file passes", () => {
  const root = fixture({
    "backend/src/test/java/ATest.java": "class ATest {}",
    "docs/test.md": "unused",
  });
  try {
    const rows = [
      {
        id: "COP-TOOLS",
        capability: "Tools",
        status: "Implemented",
        evidence: "[`ATest.java`](../backend/src/test/java/ATest.java)",
        issue: "#305",
      },
    ];
    assert.deepEqual(validationErrors(rows, root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an Implemented row without evidence fails", () => {
  const errors = validationErrors([
    { id: "COP-TOOLS", capability: "Tools", status: "Implemented", evidence: "see tests", issue: "#1" },
  ]);
  assert.ok(errors.some((error) => error.includes("without a test link")));
});

test("an Implemented row pointing at a non-test file fails", () => {
  const root = fixture({ "docs/readme.md": "# readme" });
  try {
    const errors = validationErrors(
      [
        {
          id: "COP-TOOLS",
          capability: "Tools",
          status: "Implemented",
          evidence: "[readme](readme.md)",
          issue: "#1",
        },
      ],
      root,
    );
    assert.ok(errors.some((error) => error.includes("is not a test file")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a broken evidence link fails", () => {
  const errors = validationErrors([
    {
      id: "COP-TOOLS",
      capability: "Tools",
      status: "Implemented",
      evidence: "[missing](../backend/does/not/ExistTest.java)",
      issue: "#1",
    },
  ]);
  assert.ok(errors.some((error) => error.includes("does not exist")));
});

test("Partial and Planned rows must link an issue", () => {
  const missing = validationErrors([
    { id: "COP-BUDGET", capability: "Budget", status: "Partial", evidence: "", issue: "later" },
    { id: "COP-LIMIT", capability: "Limit", status: "Planned", evidence: "", issue: "" },
  ]);
  assert.equal(
    missing.filter((error) => error.includes("must link an issue")).length,
    2,
  );

  const valid = validationErrors([
    { id: "COP-BUDGET", capability: "Budget", status: "Partial", evidence: "", issue: "#294" },
    { id: "COP-LIMIT", capability: "Limit", status: "Planned", evidence: "", issue: "#294" },
  ]);
  assert.deepEqual(valid, []);
});

test("unknown statuses, malformed ids and duplicates are rejected", () => {
  const errors = validationErrors([
    { id: "COP", capability: "Short id", status: "Implemented", evidence: "", issue: "#1" },
    { id: "COP-ONE", capability: "One", status: "Done", evidence: "", issue: "#1" },
    { id: "COP-ONE", capability: "Duplicate", status: "Planned", evidence: "", issue: "#1" },
  ]);
  assert.ok(errors.some((error) => error.includes("invalid capability id 'COP'")));
  assert.ok(errors.some((error) => error.includes("has status 'Done'")));
  assert.ok(errors.some((error) => error.includes("duplicate capability id 'COP-ONE'")));
});

test("checkDocuments aggregates rows and rejects duplicate ids across documents", () => {
  const root = fixture({
    "backend/src/test/java/ATest.java": "class ATest {}",
    "docs/one.md": [
      ...HEADER,
      "| COP-ONE | One | Implemented | [`ATest.java`](../backend/src/test/java/ATest.java) | #1 |",
    ].join("\n"),
    "docs/two.md": [
      ...HEADER,
      "| COP-ONE | Duplicate | Planned | — | #2 |",
      "| COP-TWO | Two | Partial | — | #3 |",
    ].join("\n"),
  });
  try {
    const { rows, errors } = checkDocuments({ root, docs: ["docs/one.md", "docs/two.md"] });
    assert.equal(rows.length, 3);
    assert.ok(errors.some((error) => error.includes("duplicate capability id 'COP-ONE'")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkDocuments rejects a document without a capability table", () => {
  const root = fixture({ "docs/empty.md": "# Nothing here\n" });
  try {
    const { errors } = checkDocuments({ root, docs: ["docs/empty.md"] });
    assert.ok(errors.some((error) => error.includes("no '## Capability status' table")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the repository capability matrices are valid", () => {
  const root = resolve(import.meta.dirname, "../..");
  const { rows, errors } = checkDocuments({ root });
  assert.deepEqual(errors, []);
  assert.ok(rows.length >= 25, `expected at least 25 capabilities, found ${rows.length}`);
});
