#!/usr/bin/env node
/**
 * Route bundle budget (UI/UX phase 0).
 *
 * Next.js 16 with Turbopack writes `.next/build-manifest.json` with
 * `rootMainFiles` and `pagesChunkGroupBootstrapParams`; older/webpack builds
 * write `.next/app-build-manifest.json` with `pages`. This script understands
 * both, sums the gzip size of the unique chunks per route and fails when a
 * route exceeds the budget (default 250 KB).
 *
 * Usage:
 *   node scripts/check-bundle-budget.mjs [--budget-kb 250]
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

export const DEFAULT_BUDGET_KB = 250;

/** Removes Next.js route-group segments (`/(app)`) from a manifest key. */
export function stripRouteGroups(key) {
  return key.replace(/\/\([^)]+\)/g, "");
}

/** Normalizes a manifest key (`/dashboard/page` or `/(app)/dashboard/page`). */
export function routeFromManifestKey(key) {
  const route = stripRouteGroups(key).replace(/\/page$/, "");
  return route === "" ? "/" : route;
}

/** Returns the route → files pairs for either supported manifest shape. */
export function manifestEntries(manifest) {
  const entries = [];
  const root = Array.isArray(manifest.rootMainFiles) ? manifest.rootMainFiles : [];

  const pages = manifest.pages ?? {};
  for (const [key, files] of Object.entries(pages)) {
    if (Array.isArray(files) && files.length > 0) {
      entries.push({ key, files: [...root, ...files] });
    }
  }

  const groups = manifest.pagesChunkGroupBootstrapParams ?? {};
  for (const [key, group] of Object.entries(groups)) {
    const other = Array.isArray(group?.otherChunks) ? group.otherChunks : [];
    entries.push({ key, files: [...root, ...other] });
  }

  return entries;
}

/**
 * Evaluates pre-computed route sizes against a byte budget.
 * Pure so the CLI can be tested without a Next.js build.
 */
export function evaluateBudget(entries, budgetBytes) {
  const violations = entries
    .filter((entry) => entry.gzipBytes > budgetBytes)
    .map((entry) => ({
      route: entry.route,
      gzipBytes: entry.gzipBytes,
      excessBytes: entry.gzipBytes - budgetBytes,
    }));
  return { ok: violations.length === 0, violations };
}

/** Sums the gzip size of the unique chunk files loaded by each route. */
export function computeRouteSizes(manifest, nextDir) {
  const byRoute = new Map();
  for (const entry of manifestEntries(manifest)) {
    // Route handlers and framework internals are not user-facing pages.
    if (
      entry.key.includes("/route") ||
      entry.key.startsWith("/api/") ||
      entry.key.startsWith("/_")
    ) {
      continue;
    }
    const route = routeFromManifestKey(entry.key);
    const existing = byRoute.get(route);
    const files = [...new Set(entry.files)];
    if (existing) {
      existing.files = [...new Set([...existing.files, ...files])];
    } else {
      byRoute.set(route, { route, files });
    }
  }

  const sizes = [];
  for (const { route, files } of byRoute.values()) {
    let gzipBytes = 0;
    for (const file of files) {
      const absolute = join(nextDir, file);
      if (!existsSync(absolute)) {
        continue;
      }
      gzipBytes += gzipSync(readFileSync(absolute), { level: 9 }).length;
    }
    sizes.push({ route, gzipBytes, files });
  }
  return sizes.sort((a, b) => b.gzipBytes - a.gzipBytes);
}

function parseBudget(argv) {
  const index = argv.indexOf("--budget-kb");
  if (index === -1) {
    return DEFAULT_BUDGET_KB;
  }
  const value = Number(argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_BUDGET_KB;
}

function findManifest(nextDir) {
  for (const name of ["app-build-manifest.json", "build-manifest.json"]) {
    const candidate = join(nextDir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const frontendRoot = join(here, "..");
  const nextDir = join(frontendRoot, ".next");
  const budgetKb = parseBudget(process.argv.slice(2));
  const budgetBytes = budgetKb * 1024;

  const manifestPath = findManifest(nextDir);
  if (!manifestPath) {
    // `pnpm budget` is safe to run before the first build; CI runs it after.
    console.log(`No Next.js build manifest in ${nextDir}. Run \`pnpm build\` first; skipping.`);
    return;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const sizes = computeRouteSizes(manifest, nextDir);
  const { ok, violations } = evaluateBudget(sizes, budgetBytes);

  console.log(`Route bundle budget: ${budgetKb} KB gzip (${manifestPath})`);
  for (const entry of sizes) {
    const kb = (entry.gzipBytes / 1024).toFixed(1);
    console.log(`  ${entry.route.padEnd(32)} ${kb.padStart(8)} KB`);
  }
  if (!ok) {
    console.error(`\n${violations.length} route(s) exceed the budget:`);
    for (const violation of violations) {
      console.error(
        `  ${violation.route}: ${(violation.gzipBytes / 1024).toFixed(1)} KB ` +
          `(${(violation.excessBytes / 1024).toFixed(1)} KB over)`,
      );
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
