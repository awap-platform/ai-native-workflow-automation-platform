import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyReindex,
  buildAliasAdd,
  buildAliasSwitch,
  buildCreateIndex,
  buildReindex,
} from "../knowledge-reindex.mjs";

function recorder() {
  const calls = [];
  return {
    calls,
    request: async (request) => {
      calls.push(request);
      return { failures: 0 };
    },
  };
}

test("the reindex and alias-switch payloads match OpenSearch", () => {
  assert.deepEqual(buildCreateIndex("awap-knowledge-2026"), {
    method: "PUT",
    path: "/awap-knowledge-2026",
    body: {},
  });
  assert.deepEqual(buildReindex("awap-knowledge", "awap-knowledge-2026"), {
    method: "POST",
    path: "/_reindex?wait_for_completion=true&refresh=true",
    body: {
      source: { index: "awap-knowledge" },
      dest: { index: "awap-knowledge-2026" },
    },
  });
  assert.deepEqual(buildAliasSwitch("awap-knowledge", "awap-knowledge-2026", "awap-knowledge"), {
    method: "POST",
    path: "/_aliases",
    body: {
      actions: [
        { remove: { index: "awap-knowledge", alias: "awap-knowledge" } },
        { add: { index: "awap-knowledge-2026", alias: "awap-knowledge" } },
      ],
    },
  });
  assert.deepEqual(buildAliasAdd("awap-knowledge-2026", "awap-knowledge"), {
    method: "POST",
    path: "/awap-knowledge-2026/_alias/awap-knowledge",
    body: {},
  });
});

test("a successful reindex creates, reindexes, then switches the alias", async () => {
  const { calls, request } = recorder();

  const result = await applyReindex({
    request,
    sourceIndex: "awap-knowledge-1",
    targetIndex: "awap-knowledge-2",
  });

  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.path}`),
    [
      "PUT /awap-knowledge-2",
      "POST /_reindex?wait_for_completion=true&refresh=true",
      "POST /_aliases",
    ],
  );
  assert.deepEqual(result, { targetIndex: "awap-knowledge-2", alias: "awap-knowledge", failures: 0 });
});

test("a reindex failure leaves the alias untouched", async () => {
  const calls = [];
  const request = async (call) => {
    calls.push(call);
    if (call.path.startsWith("/_reindex")) {
      return { failures: 2 };
    }
    return {};
  };

  await assert.rejects(
    () =>
      applyReindex({
        request,
        sourceIndex: "awap-knowledge-1",
        targetIndex: "awap-knowledge-2",
      }),
    /old alias is unchanged/,
  );

  assert.equal(calls.length, 2);
  assert.ok(!calls.some((call) => call.path === "/_aliases"));
});

test("a request error before the switch also leaves the alias untouched", async () => {
  const calls = [];
  const request = async (call) => {
    calls.push(call);
    if (call.path === "/awap-knowledge-2") {
      throw new Error("create failed");
    }
    return {};
  };

  await assert.rejects(
    () =>
      applyReindex({
        request,
        sourceIndex: "awap-knowledge-1",
        targetIndex: "awap-knowledge-2",
      }),
    /create failed/,
  );

  assert.equal(calls.length, 1);
});

test("a first-time alias is added to the new index", async () => {
  const { calls, request } = recorder();

  await applyReindex({
    request,
    sourceIndex: "awap-knowledge-1",
    targetIndex: "awap-knowledge-2",
    existingAlias: false,
  });

  assert.equal(calls.at(-1).path, "/awap-knowledge-2/_alias/awap-knowledge");
});
