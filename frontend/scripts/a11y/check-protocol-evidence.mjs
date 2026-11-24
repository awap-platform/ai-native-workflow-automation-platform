#!/usr/bin/env node
/**
 * Evidence gate for the manual screen-reader protocol (issue #366).
 *
 * It enforces the structure of `docs/accessibility/evidence/*.json` and ties
 * every protocol row back to an executable test or a committed spec. It never
 * claims a physical NVDA/VoiceOver run: an automated run must say so, and a
 * deferred physical run must carry an explicit risk acceptance.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const EVIDENCE_DIR = join(ROOT, "docs/accessibility/evidence");
const PROTOCOL = join(ROOT, "docs/accessibility/manual-pass-protocol.md");

const JOURNEY_IDS = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10"];
const UNHAPPY_IDS = ["U1", "U2", "U3", "U4", "U5", "U6"];
const VALID_RESULTS = new Set(["PASS", "FAIL", "NOT_EXECUTED"]);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
}

/** Every evidence row must point at a file that really contains the ID. */
function validateEvidenceLink(root, row) {
  if (typeof row.evidence !== "string" || row.evidence.trim() === "") {
    return [`${row.id}: evidence path is missing`];
  }
  const [pathPart, anchor] = row.evidence.split("#");
  const absolute = join(root, pathPart);
  if (!existsSync(absolute)) {
    return [`${row.id}: evidence file does not exist (${pathPart})`];
  }
  const source = readFileSync(absolute, "utf8");
  if (anchor && !source.includes(anchor)) {
    return [`${row.id}: evidence file does not contain the anchor ${anchor}`];
  }
  if (!anchor && !source.includes(row.id)) {
    return [`${row.id}: evidence file does not mention ${row.id}`];
  }
  return [];
}

function validateRows(rows, requiredIds, label, root) {
  const errors = [];
  if (!Array.isArray(rows)) {
    return [`${label} must be an array`];
  }
  const seen = new Map(rows.map((row) => [row?.id, row]));
  for (const id of requiredIds) {
    const row = seen.get(id);
    if (!row) {
      errors.push(`${label}: missing ${id}`);
      continue;
    }
    if (!VALID_RESULTS.has(row.result)) {
      errors.push(`${id}: result must be PASS, FAIL or NOT_EXECUTED`);
    }
    if (row.result !== "PASS") {
      errors.push(`${id}: release-blocking result ${row.result}`);
    }
    errors.push(...validateEvidenceLink(root, row));
  }
  for (const row of rows) {
    if (!requiredIds.includes(row?.id)) {
      errors.push(`${label}: unknown id ${row?.id}`);
    }
  }
  return errors;
}

export function validateEvidence(evidence, root = ROOT) {
  const errors = [];
  if (!evidence || typeof evidence !== "object") {
    return ["evidence must be a JSON object"];
  }
  if (evidence.issue !== 366) {
    errors.push("issue must be 366");
  }
  if (typeof evidence.executedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(evidence.executedAt)) {
    errors.push("executedAt must be an ISO date");
  }
  if (typeof evidence.executor !== "string" || evidence.executor.trim() === "") {
    errors.push("executor is required");
  }
  if (!["physical-at", "automated-accessibility-tree-protocol"].includes(evidence.executionMode)) {
    errors.push("executionMode must be physical-at or automated-accessibility-tree-protocol");
  }
  const assistiveTechnology = Array.isArray(evidence.assistiveTechnology)
    ? evidence.assistiveTechnology
    : [];
  if (assistiveTechnology.length < 2) {
    errors.push("assistiveTechnology must record both NVDA and VoiceOver");
  }
  for (const entry of assistiveTechnology) {
    for (const key of ["name", "version", "browser", "platform"]) {
      if (typeof entry?.[key] !== "string" || entry[key].trim() === "") {
        errors.push(`assistiveTechnology entry is missing ${key}`);
      }
    }
  }
  if (evidence.executionMode === "automated-accessibility-tree-protocol") {
    if (typeof evidence.limitations !== "string" || evidence.limitations.trim() === "") {
      errors.push("an automated run must state its limitations");
    }
    if (!evidence.riskAcceptance || evidence.riskAcceptance.required !== true) {
      errors.push("an automated run must carry riskAcceptance.required=true");
    }
  }
  if (evidence.riskAcceptance?.required === true) {
    for (const key of ["owner", "reason"]) {
      if (
        typeof evidence.riskAcceptance[key] !== "string" ||
        evidence.riskAcceptance[key].trim() === ""
      ) {
        errors.push(`riskAcceptance is missing ${key}`);
      }
    }
  }
  errors.push(...validateRows(evidence.journeys, JOURNEY_IDS, "journeys", root));
  errors.push(...validateRows(evidence.unhappyPaths, UNHAPPY_IDS, "unhappyPaths", root));

  if (!Array.isArray(evidence.findings)) {
    errors.push("findings must be an array");
  } else {
    for (const finding of evidence.findings) {
      if (finding?.severity === "P0" || finding?.severity === "P1") {
        errors.push(`${finding.id ?? "finding"}: open ${finding.severity} finding blocks release`);
      }
    }
  }
  const counts = evidence.severityCounts ?? {};
  if (counts.P0 !== 0 || counts.P1 !== 0) {
    errors.push("severityCounts.P0 and severityCounts.P1 must both be 0");
  }
  return errors;
}

/** The protocol document must describe every ID the gate requires. */
export function validateProtocolDocument(root = ROOT) {
  const protocolPath =
    root === ROOT ? PROTOCOL : join(root, "docs/accessibility/manual-pass-protocol.md");
  const source = readFileSync(protocolPath, "utf8");
  return [...JOURNEY_IDS, ...UNHAPPY_IDS]
    .filter((id) => !new RegExp(`\\b${id}\\b`).test(source))
    .map((id) => `protocol document is missing ${id}`);
}

/** Chooses the newest evidence file unless an explicit path is passed. */
export function latestEvidence(root = ROOT) {
  const evidenceDir = join(root, "docs/accessibility/evidence");
  const files = readdirSync(evidenceDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    throw new Error(`no evidence files under ${evidenceDir}`);
  }
  return join(evidenceDir, files[files.length - 1]);
}

export function runCheck(path = latestEvidence()) {
  const errors = [...validateProtocolDocument(), ...validateEvidence(readJson(path))];
  return { path, errors };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const { path, errors } = runCheck(process.argv[2]);
    if (errors.length > 0) {
      console.error(`Screen-reader protocol evidence failed (${path}):`);
      for (const error of errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }
    console.log(`Screen-reader protocol evidence is complete and consistent: ${path}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
