#!/usr/bin/env node
// Protobuf breaking-change guard for the backend <-> AI-layer contract (issue #291).
//
// Wire compatibility is a narrow promise: field numbers and wire types are forever, names may only
// change inside an already-migrated window, and additions are always safe. This script compares the
// current `.proto` with a committed baseline and fails on removal, renumbering, type changes and
// removed RPCs. Run `--write` only when the change is intentional and reviewed.

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const DEFAULT_PROTO = "contracts/proto/ai/v1/copilot.proto";
export const DEFAULT_BASELINE = "contracts/proto/ai/v1/baseline.json";

const FIELD =
  /(?:^|\n)\s*(?:(optional|repeated)\s+)?(map<[^>]+>|[\w.]+)\s+(\w+)\s*=\s*(\d+)\s*;/g;
const ENUM_VALUE = /(?:^|\n)\s*(\w+)\s*=\s*(\d+)\s*;/g;
const RPC = /rpc\s+(\w+)\s*\(\s*([\w.]+)\s*\)\s*returns\s*\(\s*([\w.]+)\s*\)/g;

export function stripComments(source) {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/** Returns `{ name, body }` for every top-level `message`/`enum`/`service` block. */
export function namedBlocks(source, keyword) {
  const blocks = [];
  const header = new RegExp(`\\b${keyword}\\s+(\\w+)\\s*\\{`, "g");
  let match;
  while ((match = header.exec(source)) !== null) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let end = source.length;
    for (let index = open; index < source.length; index += 1) {
      if (source[index] === "{") {
        depth += 1;
      } else if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    blocks.push({ name: match[1], body: source.slice(open + 1, end) });
    header.lastIndex = end;
  }
  return blocks;
}

export function parseProto(source) {
  const clean = stripComments(source);
  const contract = { messages: {}, enums: {}, services: {} };
  for (const { name, body } of namedBlocks(clean, "message")) {
    const fields = {};
    for (const match of body.matchAll(FIELD)) {
      fields[Number(match[4])] = {
        name: match[3],
        type: match[2],
        label: match[1] ?? "singular",
      };
    }
    contract.messages[name] = { fields };
  }
  for (const { name, body } of namedBlocks(clean, "enum")) {
    const values = {};
    for (const match of body.matchAll(ENUM_VALUE)) {
      values[Number(match[2])] = match[1];
    }
    contract.enums[name] = { values };
  }
  for (const { name, body } of namedBlocks(clean, "service")) {
    const methods = {};
    for (const match of body.matchAll(RPC)) {
      methods[match[1]] = { input: match[2], output: match[3] };
    }
    contract.services[name] = { methods };
  }
  return contract;
}

function compareFields(message, baseline, current, errors) {
  for (const [number, field] of Object.entries(baseline.fields ?? {})) {
    const actual = current.fields?.[number];
    if (!actual) {
      errors.push(`message ${message}: field ${number} (${field.name}) was removed`);
      continue;
    }
    if (actual.name !== field.name) {
      errors.push(
        `message ${message}: field ${number} renamed ${field.name} -> ${actual.name}`,
      );
    }
    if (actual.type !== field.type) {
      errors.push(
        `message ${message}: field ${number} type changed ${field.type} -> ${actual.type}`,
      );
    }
    if (actual.label !== field.label) {
      errors.push(
        `message ${message}: field ${number} label changed ${field.label} -> ${actual.label}`,
      );
    }
  }
  for (const [number, field] of Object.entries(current.fields ?? {})) {
    const previous = Object.entries(baseline.fields ?? {}).find(
      ([, candidate]) => candidate.name === field.name,
    );
    if (previous && Number(previous[0]) !== Number(number)) {
      errors.push(`message ${message}: field ${field.name} renumbered ${previous[0]} -> ${number}`);
    }
  }
}

export function compareContract(baseline, current) {
  const errors = [];
  for (const [message, fields] of Object.entries(baseline.messages ?? {})) {
    const now = current.messages?.[message];
    if (!now) {
      errors.push(`message ${message} was removed`);
      continue;
    }
    compareFields(message, fields, now, errors);
  }
  for (const [name, values] of Object.entries(baseline.enums ?? {})) {
    const now = current.enums?.[name];
    if (!now) {
      errors.push(`enum ${name} was removed`);
      continue;
    }
    for (const [number, value] of Object.entries(values.values ?? {})) {
      if (now.values?.[number] !== value) {
        errors.push(`enum ${name}: value ${number} (${value}) was removed or renamed`);
      }
    }
  }
  for (const [name, service] of Object.entries(baseline.services ?? {})) {
    const now = current.services?.[name];
    if (!now) {
      errors.push(`service ${name} was removed`);
      continue;
    }
    for (const [method, signature] of Object.entries(service.methods ?? {})) {
      const actual = now.methods?.[method];
      if (!actual) {
        errors.push(`service ${name}: rpc ${method} was removed`);
        continue;
      }
      if (actual.input !== signature.input || actual.output !== signature.output) {
        errors.push(`service ${name}: rpc ${method} signature changed`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export async function main(argv = process.argv.slice(2)) {
  const protoPath = argv.find((argument) => argument.endsWith(".proto")) ?? DEFAULT_PROTO;
  const baselineIndex = argv.indexOf("--baseline");
  const baselinePath =
    baselineIndex >= 0 && argv[baselineIndex + 1] ? argv[baselineIndex + 1] : DEFAULT_BASELINE;
  const current = parseProto(await readFile(protoPath, "utf8"));
  if (argv.includes("--write")) {
    await writeFile(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`Wrote the protobuf baseline to ${baselinePath}.`);
    return 0;
  }
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const result = compareContract(baseline, current);
  if (result.ok) {
    console.log(`Protobuf contract is backward compatible with ${baselinePath}.`);
    return 0;
  }
  console.error("Breaking protobuf changes detected:");
  result.errors.forEach((error) => console.error(`  - ${error}`));
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
