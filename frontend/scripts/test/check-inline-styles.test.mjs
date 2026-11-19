import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  compareToBaseline,
  formatReport,
  scanInlineStyles,
} from "../check-inline-styles.mjs";

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "inline-style-"));
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, content, "utf8");
  }
  return root;
}

test("counts inline style attributes per file", () => {
  const root = fixture({
    "app/page.tsx": "const a = <div style={{ color: 'red' }} />;",
    "components/card.tsx": "const b = <div style={{}} className='x' />;const c = <p style={{}} />;",
    "app/clean.tsx": "const d = <div className='x' />;",
  });
  const counts = scanInlineStyles(root);
  assert.deepEqual(counts, { "app/page.tsx": 1, "components/card.tsx": 2 });
});

test("fails when a file exceeds its baseline", () => {
  const comparison = compareToBaseline(
    { "app/page.tsx": 2 },
    { "app/page.tsx": { count: 1 } },
  );
  assert.equal(comparison.ok, false);
  assert.deepEqual(comparison.violations, [
    { file: "app/page.tsx", actual: 2, allowed: 1 },
  ]);
  assert.match(formatReport({ "app/page.tsx": 2 }, comparison), /New or increased inline styles/);
});

test("fails when a new file introduces an inline style", () => {
  const comparison = compareToBaseline({ "app/new.tsx": 1 }, {});
  assert.equal(comparison.ok, false);
  assert.equal(comparison.violations[0].file, "app/new.tsx");
});

test("passes when counts decrease and reports stale baseline entries", () => {
  const comparison = compareToBaseline(
    { "app/page.tsx": 1 },
    { "app/page.tsx": { count: 2 }, "app/removed.tsx": { count: 2 } },
  );
  assert.equal(comparison.ok, true);
  assert.deepEqual(comparison.stale, ["app/removed.tsx"]);
  assert.equal(comparison.total, 1);
});
