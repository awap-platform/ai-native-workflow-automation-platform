import assert from "node:assert/strict";
import { test } from "node:test";

import {
  detectModifiedVersions,
  isVersionedPromptName,
  parseRegistry,
  validatePromptFiles,
  validateRegistry,
} from "../check-prompt-versions.mjs";

test("accepts versioned prompt names", () => {
  for (const name of ["chat-v1.md", "workflow-discovery-v2.1.md", "extract-v1.2.3.md"]) {
    assert.equal(isVersionedPromptName(name), true, name);
  }
});

test("rejects unversioned or malformed names", () => {
  for (const name of ["chat.md", "chat-v.md", "Chat-v1.md", "chat-1.md", "chat-v1.txt"]) {
    assert.equal(isVersionedPromptName(name), false, name);
  }
});

test("reports invalid prompt files and ignores non-Markdown files", () => {
  assert.deepEqual(validatePromptFiles(["chat.md", "notes.txt", "chat-v1.md"]), [
    "Prompt file does not match <key>-v<version>.md: chat.md",
  ]);
});

test("parses the registry and detects duplicate keys", () => {
  const { registry, errors } = parseRegistry('PROMPTS = {"chat": "chat-v1.md", "chat": "chat-v2.md"}');
  assert.equal(registry.get("chat"), "chat-v2.md");
  assert.deepEqual(errors, ["Duplicate prompt key in registry: chat"]);
});

test("enforces registry and file parity", () => {
  const errors = validateRegistry(
    ["chat-v1.md", "orphan-v1.md"],
    new Map([
      ["chat", "chat-v1.md"],
      ["missing", "missing-v1.md"],
    ]),
  );
  assert.deepEqual(errors, [
    "Registry key 'missing' points at a missing prompt file: missing-v1.md",
    "Prompt file is not registered: orphan-v1.md",
  ]);
});

test("detects modifications and deletions of immutable versions", () => {
  // The caller passes only git diff paths from --diff-filter=MD, so a newly added version file is
  // never in this list.
  assert.deepEqual(
    detectModifiedVersions([
      "ai-layer/app/prompts/chat-v1.md",
      "ai-layer/app/other.txt",
    ]),
    ["ai-layer/app/prompts/chat-v1.md"],
  );
});
