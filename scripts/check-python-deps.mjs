#!/usr/bin/env node
// Runtime dependency usage guard for the AI layer (issue #295).
//
// Every package in `[project].dependencies` must be imported by `ai-layer/app` or `ai-layer/eval`,
// unless it is explicitly allowlisted as used outside Python imports (e.g. uvicorn is the Docker
// entrypoint). Dev-only dependencies are ignored.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const DEFAULT_ROOT = "ai-layer";

/** Distribution name -> top-level import names when they differ. */
export const IMPORT_ALIASES = {
  grpcio: ["grpc"],
  protobuf: ["google"],
};

/** Dependencies used outside Python imports, with the reason they are legitimate. */
export const ALLOWED_WITHOUT_IMPORT = new Map([
  ["uvicorn", "ASGI console entrypoint in ai-layer/Dockerfile"],
]);

export function normalizeDistribution(name) {
  return name.trim().toLowerCase().replaceAll("_", "-").replaceAll(".", "-");
}

export function parseRuntimeDependencies(pyproject) {
  const block = pyproject.match(/\[project\][\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (!block) {
    return [];
  }
  return block[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith('"') || line.startsWith("'"))
    .map((line) => line.match(/^["']([A-Za-z0-9_.-]+)/)?.[1])
    .filter(Boolean)
    .map(normalizeDistribution);
}

export function importCandidates(distribution) {
  return IMPORT_ALIASES[distribution] ?? [distribution.replaceAll("-", "_")];
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "__pycache__" || entry.isDirectory() === false) {
      if (entry.name.endsWith(".py")) {
        files.push(join(directory, entry.name));
      }
      continue;
    }
    files.push(...(await walk(join(directory, entry.name))));
  }
  return files;
}

export async function collectImports(root) {
  const modules = new Set();
  for (const directory of ["app", "eval"]) {
    let files;
    try {
      files = await walk(join(root, directory));
    } catch {
      continue;
    }
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const line of source.split("\n")) {
        const match = line.match(/^\s*(?:from\s+([A-Za-z_][\w.]*)\s+import|import\s+([A-Za-z_][\w.]*))/);
        if (match) {
          modules.add((match[1] ?? match[2]).split(".")[0]);
        }
      }
    }
  }
  return modules;
}

export function unusedRuntimeDependencies(dependencies, imports) {
  return dependencies.filter((distribution) => {
    if (ALLOWED_WITHOUT_IMPORT.has(distribution)) {
      return false;
    }
    return !importCandidates(distribution).some((candidate) => imports.has(candidate));
  });
}

export async function checkRepository(root = DEFAULT_ROOT) {
  const pyproject = await readFile(join(root, "pyproject.toml"), "utf8");
  const dependencies = parseRuntimeDependencies(pyproject);
  const imports = await collectImports(root);
  return {
    dependencies,
    imports: [...imports].sort(),
    unused: unusedRuntimeDependencies(dependencies, imports),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const root = argv.find((argument) => !argument.startsWith("--")) ?? DEFAULT_ROOT;
  const result = await checkRepository(root);
  if (result.unused.length === 0) {
    console.log(
      `All ${result.dependencies.length} AI-layer runtime dependencies are used or allowlisted.`,
    );
    return 0;
  }
  console.error("Unused AI-layer runtime dependencies:");
  for (const dependency of result.unused) {
    console.error(`  - ${dependency}`);
  }
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
