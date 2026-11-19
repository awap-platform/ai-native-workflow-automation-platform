#!/usr/bin/env node
/**
 * Hard-coded colour guard (UI/UX phase 1, risk R1-02).
 *
 * The design-system component and shell layers must consume tokens, not literal
 * hex values. `globals.css` is the single place where token values live.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCAN_DIRS = [
  "components/ui",
  "components/layout",
  "components/auth",
  "components/onboarding",
  "app/(app)/design-system",
];
const HEX_PATTERN = /#[0-9a-fA-F]{3,8}\b/g;

function listFiles(directory) {
  const files = [];
  const walk = (current) => {
    if (!existsSync(current)) {
      return;
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__" && entry.name !== "node_modules") {
          walk(join(current, entry.name));
        }
      } else if (entry.isFile() && /\.(tsx?|css)$/.test(entry.name)) {
        files.push(join(current, entry.name));
      }
    }
  };
  walk(directory);
  return files;
}

/** Returns `{ file, line, value }` for every hard-coded hex colour. */
export function scanHardcodedColors(root, directories = SCAN_DIRS) {
  const findings = [];
  for (const directory of directories) {
    for (const file of listFiles(join(root, directory))) {
      const relativePath = relative(root, file).split(sep).join("/");
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        const matches = line.match(HEX_PATTERN);
        if (!matches) {
          return;
        }
        for (const value of matches) {
          findings.push({ file: relativePath, line: index + 1, value });
        }
      });
    }
  }
  return findings;
}

export function formatReport(findings) {
  if (findings.length === 0) {
    return "hard-coded colours: 0";
  }
  const lines = [`hard-coded colours: ${findings.length}`];
  for (const finding of findings) {
    lines.push(`  ${finding.file}:${finding.line} ${finding.value}`);
  }
  return lines.join("\n");
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..");
  const findings = scanHardcodedColors(root);
  console.log(formatReport(findings));
  if (findings.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
