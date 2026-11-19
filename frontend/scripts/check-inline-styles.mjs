#!/usr/bin/env node
/**
 * Inline-style ratchet guard (UI/UX phase 0).
 *
 * The CSP can only drop `style-src-attr 'unsafe-inline'` once React `style`
 * attributes are gone. This guard scans the app for `style={` occurrences and
 * compares them with a committed baseline. Existing debt is recorded once; any
 * new occurrence or file fails the check, so the number can only go down.
 *
 * Usage:
 *   node scripts/check-inline-styles.mjs --check
 *   node scripts/check-inline-styles.mjs --write-baseline
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".next",
  ".swc",
  "e2e",
  "__tests__",
  "test-results",
  "playwright-report",
  "a11y-report",
  "scripts",
  "public",
]);

const SCAN_ROOTS = ["app", "components", "lib"];
const STYLE_PATTERN = /\bstyle=\{/g;

/** Recursively lists `.tsx` files under a directory, skipping generated dirs. */
export function listSourceFiles(root) {
  const files = [];
  const walk = (directory) => {
    if (!existsSync(directory)) {
      return;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          walk(join(directory, entry.name));
        }
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")) {
        files.push(join(directory, entry.name));
      }
    }
  };
  walk(root);
  return files;
}

/** Counts inline style attributes per file, relative to the frontend root. */
export function scanInlineStyles(root, scanRoots = SCAN_ROOTS) {
  const counts = {};
  for (const scanRoot of scanRoots) {
    for (const file of listSourceFiles(join(root, scanRoot))) {
      const source = readFileSync(file, "utf8");
      const matches = source.match(STYLE_PATTERN);
      if (matches && matches.length > 0) {
        const key = relative(root, file).split(sep).join("/");
        counts[key] = matches.length;
      }
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Compares the current counts with the baseline. Only regressions (a count above
 * the recorded allowance, including new files) are failures. Entries that have
 * disappeared are reported as stale so the baseline can be tightened.
 */
export function compareToBaseline(counts, baseline) {
  const violations = [];
  for (const [file, actual] of Object.entries(counts)) {
    const allowed = baseline[file]?.count ?? 0;
    if (actual > allowed) {
      violations.push({ file, actual, allowed });
    }
  }
  const stale = Object.keys(baseline).filter((file) => !(file in counts));
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return { ok: violations.length === 0, violations, stale, total };
}

export function formatReport(counts, comparison) {
  const lines = [
    `inline-style guard: ${comparison.total} occurrence(s) across ${Object.keys(counts).length} file(s)`,
  ];
  if (comparison.violations.length > 0) {
    lines.push("New or increased inline styles:");
    for (const violation of comparison.violations) {
      lines.push(`  ${violation.file}: ${violation.actual} (allowed ${violation.allowed})`);
    }
  }
  if (comparison.stale.length > 0) {
    lines.push("Stale baseline entries (remove them to tighten the ratchet):");
    for (const file of comparison.stale) {
      lines.push(`  ${file}`);
    }
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  return {
    check: argv.includes("--check"),
    writeBaseline: argv.includes("--write-baseline"),
  };
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..");
  const baselinePath = join(here, "inline-style-baseline.json");
  const args = parseArgs(process.argv.slice(2));

  if (!args.check && !args.writeBaseline) {
    console.error("Usage: check-inline-styles.mjs --check | --write-baseline");
    process.exitCode = 2;
    return;
  }

  const counts = scanInlineStyles(root);

  if (args.writeBaseline) {
    const baseline = Object.fromEntries(
      Object.entries(counts).map(([file, count]) => [file, { count }]),
    );
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
    console.log(`Wrote inline-style baseline with ${Object.keys(baseline).length} entry/entries.`);
    return;
  }

  if (!existsSync(baselinePath)) {
    console.error(
      "Missing scripts/inline-style-baseline.json. Run --write-baseline once and commit the file.",
    );
    process.exitCode = 1;
    return;
  }

  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const comparison = compareToBaseline(counts, baseline);
  console.log(formatReport(counts, comparison));
  if (!comparison.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
