import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { formatReport, scanHardcodedColors } from "../check-hardcoded-colors.mjs";

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "hardcoded-colors-"));
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, content, "utf8");
  }
  return root;
}

test("reports hex colours with file and line", () => {
  const root = fixture({
    "components/ui/card.tsx": "const a = <div className=\"bg-[#ff0000]\" />;",
    "components/ui/ok.tsx": "const b = <div className=\"bg-primary\" />;",
  });
  const findings = scanHardcodedColors(root);
  assert.deepEqual(findings, [
    { file: "components/ui/card.tsx", line: 1, value: "#ff0000" },
  ]);
  assert.match(formatReport(findings), /hard-coded colours: 1/);
});

test("passes when every colour is a token", () => {
  const root = fixture({
    "components/ui/card.tsx": "const a = <div className=\"bg-surface text-foreground\" />;",
    "components/layout/shell.tsx": "const b = <div className=\"border-border\" />;",
  });
  assert.deepEqual(scanHardcodedColors(root), []);
  assert.equal(formatReport([]), "hard-coded colours: 0");
});

test("ignores test files", () => {
  const root = fixture({
    "components/ui/__tests__/card.test.tsx": "const a = '#ff0000';",
  });
  assert.deepEqual(scanHardcodedColors(root), []);
});
