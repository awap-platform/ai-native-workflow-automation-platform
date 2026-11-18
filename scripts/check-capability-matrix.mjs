#!/usr/bin/env node
/**
 * Capability matrix checker (issue #309).
 *
 * Documentation that claims a capability must point at the test that proves it. This checker reads
 * the `## Capability status` tables in the AI Copilot and AI/SCRIPT security documents and enforces:
 *
 * - status is one of Implemented, Partial or Planned;
 * - an Implemented row links at least one existing test file;
 * - a Partial or Planned row links an issue (`#123`);
 * - capability ids are well formed and unique across the checked documents.
 *
 * Usage: node scripts/check-capability-matrix.mjs [--root <dir>] [--docs a.md,b.md]
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const STATUSES = ["Implemented", "Partial", "Planned"];
export const DEFAULT_DOCS = ["docs/ai-copilot.md", "docs/ai-and-script-security.md"];

const REQUIRED_HEADERS = ["id", "capability", "status", "evidence", "issue"];
const ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/;
const TEST_PATH_PATTERNS = [
  /(^|\/)tests?\//,
  /(^|\/)e2e\//,
  /\.spec\.[cm]?[jt]sx?$/,
  /(Test|IT|Tests)\.java$/,
  /(^|\/)test_[^/]+\.py$/,
];
const LINK_PATTERN = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** Extracts the markdown link targets from one table cell, ignoring inline code spans. */
export function extractMarkdownLinks(cell) {
  const withoutCodeSpans = cell.replace(/`[^`]*`/g, "");
  return [...withoutCodeSpans.matchAll(LINK_PATTERN)].map((match) => match[1].trim());
}

/** Parses every `## Capability status` table in a document. */
export function parseCapabilityRows(markdown) {
  const rows = [];
  let inSection = false;
  let headers = null;
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (/^#{2,4}\s+Capability status\b/i.test(line)) {
      inSection = true;
      headers = null;
      continue;
    }
    if (!inSection) {
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      inSection = false;
      continue;
    }
    if (!line.startsWith("|")) {
      if (headers) {
        break;
      }
      continue;
    }
    const cells = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
    if (!headers) {
      headers = cells.map((cell) => cell.toLowerCase());
      continue;
    }
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) {
      continue;
    }
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

/** Validates parsed rows; returns a list of human-readable errors. */
export function validateRows(rows, { root, docPath }) {
  const errors = [];
  const seen = new Map();
  for (const row of rows) {
    const id = (row.id ?? "").replaceAll("`", "");
    if (!ID_PATTERN.test(id)) {
      errors.push(`${docPath}: invalid capability id '${row.id ?? ""}'`);
      continue;
    }
    if (!row.capability) {
      errors.push(`${docPath}: ${id} has no capability description`);
    }
    if (seen.has(id)) {
      errors.push(`${docPath}: duplicate capability id '${id}' (already used in ${seen.get(id)})`);
    } else {
      seen.set(id, docPath);
    }
    if (!STATUSES.includes(row.status)) {
      errors.push(
        `${docPath}: ${id} has status '${row.status ?? ""}' (expected ${STATUSES.join(", ")})`,
      );
      continue;
    }
    if (row.status === "Implemented") {
      const links = extractMarkdownLinks(row.evidence ?? "");
      if (links.length === 0) {
        errors.push(`${docPath}: ${id} is Implemented without a test link`);
        continue;
      }
      for (const target of links) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) {
          errors.push(`${docPath}: ${id} evidence '${target}' must be a repository test file`);
          continue;
        }
        const file = resolve(dirname(resolve(root, docPath)), target.split("#")[0]);
        if (!existsSync(file)) {
          errors.push(`${docPath}: ${id} evidence '${target}' does not exist`);
          continue;
        }
        const normalized = file.split(sep).join("/");
        if (!TEST_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) {
          errors.push(`${docPath}: ${id} evidence '${target}' is not a test file`);
        }
      }
    } else if (!/#\d+/.test(row.issue ?? "")) {
      errors.push(`${docPath}: ${id} is ${row.status} and must link an issue (for example #294)`);
    }
  }
  return errors;
}

/** Checks every configured document; returns the rows seen and the accumulated errors. */
export function checkDocuments({ root = process.cwd(), docs = DEFAULT_DOCS } = {}) {
  const errors = [];
  const rows = [];
  const ids = new Map();
  for (const docPath of docs) {
    const file = resolve(root, docPath);
    if (!existsSync(file)) {
      errors.push(`${docPath}: document does not exist`);
      continue;
    }
    const parsed = parseCapabilityRows(readFileSync(file, "utf8"));
    if (parsed.length === 0) {
      errors.push(`${docPath}: no '## Capability status' table found`);
      continue;
    }
    const headers = Object.keys(parsed[0]);
    for (const header of REQUIRED_HEADERS) {
      if (!headers.includes(header)) {
        errors.push(`${docPath}: capability table is missing the '${header}' column`);
      }
    }
    for (const row of parsed) {
      rows.push({ docPath, ...row });
    }
    errors.push(...validateRows(parsed, { root, docPath }));
    for (const row of parsed) {
      const id = (row.id ?? "").replaceAll("`", "");
      if (id && ids.has(id)) {
        errors.push(`${docPath}: duplicate capability id '${id}' (already used in ${ids.get(id)})`);
      } else if (id) {
        ids.set(id, docPath);
      }
    }
  }
  return { rows, errors };
}

function parseArgs(argv) {
  const options = { root: process.cwd(), docs: DEFAULT_DOCS };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root" && argv[index + 1]) {
      options.root = resolve(argv[index + 1]);
      index += 1;
    } else if (argv[index] === "--docs" && argv[index + 1]) {
      options.docs = argv[index + 1]
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      index += 1;
    }
  }
  return options;
}

function main() {
  const { rows, errors } = checkDocuments(parseArgs(process.argv.slice(2)));
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`FAIL: ${error}`);
    }
    console.error(`Capability matrix check failed with ${errors.length} error(s).`);
    process.exitCode = 1;
    return;
  }
  console.log(`Capability matrix check passed for ${rows.length} capabilities.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
