import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ALLOWED_WITHOUT_IMPORT,
  checkRepository,
  collectImports,
  importCandidates,
  parseRuntimeDependencies,
  unusedRuntimeDependencies,
} from "../check-python-deps.mjs";

const PYPROJECT = `
[project]
name = "sample"
dependencies = [
  "fastapi>=0.135",
  "grpcio>=1.85.1",
  "protobuf>=7.36.2",
  "uvicorn>=0.35",
  "langchain==1.4.5",
]

[dependency-groups]
dev = [
  "pytest>=8",
]
`;

test("only runtime dependencies are parsed", () => {
  assert.deepEqual(parseRuntimeDependencies(PYPROJECT), [
    "fastapi",
    "grpcio",
    "protobuf",
    "uvicorn",
    "langchain",
  ]);
});

test("distribution aliases map to top-level imports", () => {
  assert.deepEqual(importCandidates("grpcio"), ["grpc"]);
  assert.deepEqual(importCandidates("protobuf"), ["google"]);
  assert.deepEqual(importCandidates("langchain-core"), ["langchain_core"]);
  assert.ok(ALLOWED_WITHOUT_IMPORT.has("uvicorn"));
});

test("an unused runtime dependency is reported", () => {
  const imports = new Set(["fastapi", "grpc", "google"]);

  assert.deepEqual(
    unusedRuntimeDependencies(
      ["fastapi", "grpcio", "protobuf", "uvicorn", "langchain"],
      imports,
    ),
    ["langchain"],
  );
});

test("imports are collected from indented code and nested packages", async () => {
  const root = await mkdtemp(join(tmpdir(), "awap-deps-"));
  await mkdir(join(root, "app", "nested"), { recursive: true });
  await writeFile(join(root, "app", "nested", "a.py"), "import grpc\nfrom google.protobuf import json_format\n");
  await writeFile(join(root, "app", "b.py"), "def f():\n    from langgraph.graph import StateGraph\n");
  await writeFile(join(root, "app", "c.py"), "from . import local\n");

  const imports = await collectImports(root);

  assert.deepEqual([...imports].sort(), ["google", "grpc", "langgraph"]);
});

test("the real AI-layer dependency set is fully used", async () => {
  const result = await checkRepository("ai-layer");

  assert.deepEqual(result.unused, []);
  assert.ok(result.dependencies.includes("langgraph"));
  assert.ok(!result.dependencies.includes("langchain"));
});
