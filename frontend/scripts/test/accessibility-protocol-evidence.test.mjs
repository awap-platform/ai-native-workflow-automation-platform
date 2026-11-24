import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateEvidence, validateProtocolDocument } from "../a11y/check-protocol-evidence.mjs";

const JOURNEYS = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10"];
const UNHAPPY = ["U1", "U2", "U3", "U4", "U5", "U6"];

/** Creates a temp tree with one evidence source per row. */
function evidenceTree() {
  const root = mkdtempSync(join(tmpdir(), "a11y-evidence-"));
  const specDir = join(root, "frontend/e2e");
  const docDir = join(root, "docs/accessibility");
  mkdirSync(specDir, { recursive: true });
  mkdirSync(docDir, { recursive: true });
  const rows = [...JOURNEYS, ...UNHAPPY].map((id) => `${id}: placeholder\n`).join("");
  writeFileSync(join(specDir, "protocol.spec.ts"), rows);
  writeFileSync(join(docDir, "manual-pass-protocol.md"), rows);
  return root;
}

function validEvidence() {
  return {
    issue: 366,
    executedAt: "2026-11-24",
    executor: "release-engineering",
    executionMode: "automated-accessibility-tree-protocol",
    assistiveTechnology: [
      { name: "NVDA", version: "2025.1", browser: "Chrome 141", platform: "Windows 11" },
      { name: "VoiceOver", version: "macOS 15", browser: "Safari 18", platform: "macOS" },
    ],
    journeys: JOURNEYS.map((id) => ({
      id,
      result: "PASS",
      evidence: "frontend/e2e/protocol.spec.ts",
    })),
    unhappyPaths: UNHAPPY.map((id) => ({
      id,
      result: "PASS",
      evidence: "frontend/e2e/protocol.spec.ts",
    })),
    findings: [],
    severityCounts: { P0: 0, P1: 0 },
    limitations: "Automated accessibility-tree run; physical AT attestation is tracked separately.",
    riskAcceptance: {
      required: true,
      owner: "release-engineering",
      reason: "Physical AT is not available on the Linux CI runner.",
    },
  };
}

test("accepts a complete automated-protocol evidence file", () => {
  assert.deepEqual(validateEvidence(validEvidence(), evidenceTree()), []);
});

test("rejects a missing journey and a release-blocking finding", () => {
  const evidence = validEvidence();
  evidence.journeys = evidence.journeys.filter((row) => row.id !== "T7");
  evidence.findings = [{ id: "F1", severity: "P1", summary: "Focus trap" }];
  const errors = validateEvidence(evidence, evidenceTree());
  assert.ok(errors.some((error) => error.includes("missing T7")));
  assert.ok(errors.some((error) => error.includes("open P1")));
});

test("rejects a non-PASS row and an unknown row", () => {
  const evidence = validEvidence();
  evidence.unhappyPaths[0].result = "NOT_EXECUTED";
  evidence.unhappyPaths.push({ id: "U99", result: "PASS", evidence: "x" });
  const errors = validateEvidence(evidence, evidenceTree());
  assert.ok(errors.some((error) => error.includes("release-blocking result")));
  assert.ok(errors.some((error) => error.includes("unknown id U99")));
});

test("rejects an automated run that claims no limitation or no risk acceptance", () => {
  const evidence = validEvidence();
  evidence.limitations = "";
  evidence.riskAcceptance = { required: false };
  const errors = validateEvidence(evidence, evidenceTree());
  assert.ok(errors.some((error) => error.includes("state its limitations")));
  assert.ok(errors.some((error) => error.includes("riskAcceptance.required=true")));
});

test("rejects a dangling evidence path", () => {
  const evidence = validEvidence();
  evidence.journeys[0].evidence = "frontend/e2e/missing.spec.ts";
  const errors = validateEvidence(evidence, evidenceTree());
  assert.ok(errors.some((error) => error.includes("does not exist")));
});

test("the committed protocol document names every row", () => {
  assert.deepEqual(validateProtocolDocument(), []);
});
