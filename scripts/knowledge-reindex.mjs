#!/usr/bin/env node
// Blue/green reindex for the awap-knowledge index (issue #293).
//
// 1. Create a new index whose name matches the awap-knowledge* template.
// 2. Reindex the live alias into it.
// 3. Switch the alias atomically only after a successful reindex.
//
// A reindex failure never touches the alias, so the old index keeps serving traffic.

import process from "node:process";
import { pathToFileURL } from "node:url";

export const DEFAULT_ALIAS = "awap-knowledge";

export function buildCreateIndex(index) {
  return { method: "PUT", path: `/${index}`, body: {} };
}

export function buildReindex(sourceIndex, targetIndex) {
  return {
    method: "POST",
    path: "/_reindex?wait_for_completion=true&refresh=true",
    body: { source: { index: sourceIndex }, dest: { index: targetIndex } },
  };
}

export function buildAliasSwitch(oldIndex, newIndex, alias) {
  return {
    method: "POST",
    path: "/_aliases",
    body: {
      actions: [
        { remove: { index: oldIndex, alias } },
        { add: { index: newIndex, alias } },
      ],
    },
  };
}

export function buildAliasAdd(index, alias) {
  return { method: "POST", path: `/${index}/_alias/${alias}`, body: {} };
}

/**
 * Runs the reindex plan. `request` receives `{ method, path, body }` and returns the parsed JSON.
 * The alias switch is the last step, so any earlier failure leaves the old alias intact.
 */
export async function applyReindex({
  request,
  sourceIndex,
  targetIndex,
  alias = DEFAULT_ALIAS,
  existingAlias = true,
}) {
  await request(buildCreateIndex(targetIndex));
  const result = await request(buildReindex(sourceIndex, targetIndex));
  const failures = Number(result?.failures ?? 0);
  if (!Number.isFinite(failures) || failures > 0) {
    throw new Error(`Reindex finished with ${failures} failures; the old alias is unchanged.`);
  }
  if (existingAlias) {
    await request(buildAliasSwitch(sourceIndex, targetIndex, alias));
  } else {
    await request(buildAliasAdd(targetIndex, alias));
  }
  return { targetIndex, alias, failures };
}

function parseArgs(argv) {
  const options = { endpoint: "http://localhost:9200", alias: DEFAULT_ALIAS, existingAlias: true };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--no-alias") {
      options.existingAlias = false;
    } else if (value.startsWith("--")) {
      options[value.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.source || !options.target) {
    console.error("Usage: knowledge-reindex.mjs --source <index> --target <index> [--alias awap-knowledge]");
    return 2;
  }
  const request = async ({ method, path, body }) => {
    const response = await fetch(`${options.endpoint}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!response.ok) {
      throw new Error(`OpenSearch ${method} ${path} returned ${response.status}.`);
    }
    return response.json().catch(() => ({}));
  };
  try {
    const result = await applyReindex({
      request,
      sourceIndex: options.source,
      targetIndex: options.target,
      alias: options.alias,
      existingAlias: options.existingAlias,
    });
    console.log(
      `Reindexed ${options.source} -> ${result.targetIndex}; alias ${result.alias} switched.`,
    );
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
