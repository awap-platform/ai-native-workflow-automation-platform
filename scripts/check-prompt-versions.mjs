#!/usr/bin/env node
// Prompt version governance (issue #289 / ADR-0008).
//
// Validates the immutable version-file naming schema, the registry/file parity and rejects a diff
// that edits, renames or deletes an existing prompt version.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*-v\d+(?:\.\d+){0,2}\.md$/;

export function isVersionedPromptName(name) {
  return NAME_PATTERN.test(name);
}

export function validatePromptFiles(files) {
  const errors = [];
  for (const name of files) {
    if (!name.endsWith(".md")) {
      continue;
    }
    if (!isVersionedPromptName(name)) {
      errors.push(`Prompt file does not match <key>-v<version>.md: ${name}`);
    }
  }
  return errors;
}

export function parseRegistry(source) {
  const errors = [];
  const registry = new Map();
  const pattern = /"([a-z0-9_]+)"\s*:\s*"([^"]+\.md)"/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const [, key, file] = match;
    if (registry.has(key)) {
      errors.push(`Duplicate prompt key in registry: ${key}`);
    }
    registry.set(key, file);
  }
  return { registry, errors };
}

export function validateRegistry(files, registry) {
  const errors = [];
  const used = new Map();
  for (const [key, file] of registry.entries()) {
    if (!files.includes(file)) {
      errors.push(`Registry key '${key}' points at a missing prompt file: ${file}`);
    }
    if (!isVersionedPromptName(file)) {
      errors.push(`Registry key '${key}' points at an invalid version file: ${file}`);
    }
    if (used.has(file)) {
      errors.push(`Prompt file '${file}' is registered by both '${used.get(file)}' and '${key}'`);
    }
    used.set(file, key);
  }
  for (const file of files) {
    if (file.endsWith(".md") && ![...registry.values()].includes(file)) {
      errors.push(`Prompt file is not registered: ${file}`);
    }
  }
  return errors;
}

export function detectModifiedVersions(paths) {
  return paths.filter(
    (path) =>
      path.startsWith("ai-layer/app/prompts/") &&
      path.endsWith(".md") &&
      isVersionedPromptName(path.split("/").at(-1)),
  );
}

export function changedPromptPaths(base) {
  try {
    const output = execFileSync(
      "git",
      ["diff", "--name-only", "--diff-filter=MD", `${base}...HEAD`, "--", "ai-layer/app/prompts"],
      { encoding: "utf8" },
    );
    return output.split("\n").filter(Boolean);
  } catch (error) {
    throw new Error(`Cannot diff prompt files against ${base}: ${error.message}`);
  }
}

export function check({ promptsDir = "ai-layer/app/prompts", registryPath = "ai-layer/app/copilot/prompts.py", base = null } = {}) {
  const files = readdirSync(promptsDir);
  const source = readFileSync(registryPath, "utf8");
  const { registry, errors: registryErrors } = parseRegistry(source);
  const errors = [
    ...validatePromptFiles(files),
    ...registryErrors,
    ...validateRegistry(files, registry),
  ];
  if (base) {
    const modified = detectModifiedVersions(changedPromptPaths(base));
    for (const path of modified) {
      errors.push(`An existing prompt version is immutable; create a new version instead: ${path}`);
    }
  }
  return { files, registry, errors };
}

export function main(argv = process.argv.slice(2)) {
  const baseIndex = argv.indexOf("--base");
  const base = baseIndex >= 0 ? argv[baseIndex + 1] : null;
  const result = check({ base });
  if (result.errors.length > 0) {
    result.errors.forEach((error) => console.error(`FAIL: ${error}`));
    return 1;
  }
  console.log(
    `Prompt version governance passed: ${result.registry.size} registered immutable prompt(s).`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
