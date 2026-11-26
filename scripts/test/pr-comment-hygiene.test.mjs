import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  COVERAGE_DELTA_MARKER,
  botMatcher,
  compareComments,
  dedupeBotComments,
  listComments,
  main,
  parseArgs,
  pickNewestPerAuthor,
  pickStickyTarget,
  upsertStickyComment,
  withMarker,
} from "../pr-comment-hygiene.mjs";

const CI_WORKFLOW = new URL("../../.github/workflows/ci.yml", import.meta.url);
const HYGIENE_WORKFLOW = new URL(
  "../../.github/workflows/pr-comment-hygiene.yml",
  import.meta.url,
);

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (payload === undefined ? "" : JSON.stringify(payload)),
  };
}

function comment({ id, login = "github-actions[bot]", body = "hello", createdAt }) {
  return {
    id,
    user: { login },
    body,
    created_at: createdAt ?? new Date(id * 1000).toISOString(),
  };
}

function fakeGitHub(options = {}) {
  const { comments = [], createId = 900, failDeleteIds = [] } = options;
  const calls = [];
  let nextId = createId;
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    calls.push({ url, method, body });
    if (method === "GET" && url.includes("/comments?")) {
      const parsed = new URL(url);
      const page = Number(parsed.searchParams.get("page") ?? "1");
      const perPage = Number(parsed.searchParams.get("per_page") ?? "100");
      const start = (page - 1) * perPage;
      return jsonResponse(comments.slice(start, start + perPage));
    }
    if (method === "POST") {
      nextId += 1;
      return jsonResponse({ id: nextId, body: body.body });
    }
    if (method === "PATCH") {
      return jsonResponse({ id: Number(url.split("/").at(-1)), body: body.body });
    }
    if (method === "DELETE") {
      const id = Number(url.split("/").at(-1));
      return failDeleteIds.includes(id)
        ? jsonResponse({ message: "server error" }, 500)
        : jsonResponse(undefined, 204);
    }
    throw new Error(`Unhandled ${method} ${url}`);
  };
  return { fetchImpl, calls };
}

test("botMatcher recognises the GitHub Actions bot and every Sonar login", () => {
  const matches = botMatcher();
  assert.equal(matches("github-actions[bot]"), true);
  assert.equal(matches("GitHub-Actions[bot]"), true);
  assert.equal(matches("sonarqubecloud[bot]"), true);
  assert.equal(matches("sonarcloud[bot]"), true);
  assert.equal(matches("SonarQubeCloud Bot"), true);
  assert.equal(matches("renovate[bot]"), false);
  assert.equal(matches("koraysrn"), false);
  assert.equal(matches(undefined), false);
});

test("compareComments orders by creation time and falls back to the id", () => {
  const older = comment({ id: 5, createdAt: "2026-01-01T00:00:00Z" });
  const newer = comment({ id: 4, createdAt: "2026-01-02T00:00:00Z" });
  const sameInstant = comment({ id: 6, createdAt: "2026-01-01T00:00:00Z" });
  assert.ok(compareComments(older, newer) < 0);
  assert.ok(compareComments(newer, older) > 0);
  assert.ok(compareComments(older, sameInstant) < 0);
  assert.equal(compareComments(older, older), 0);
});

test("pickNewestPerAuthor keeps the newest comment per managed bot only", () => {
  const comments = [
    comment({ id: 1 }),
    comment({ id: 2 }),
    comment({ id: 3, login: "sonarqubecloud[bot]" }),
    comment({ id: 4, login: "sonarqubecloud[bot]" }),
    comment({ id: 5, login: "koraysrn" }),
  ];
  const { kept, stale } = pickNewestPerAuthor(comments, botMatcher());
  assert.deepEqual(
    kept.map((item) => item.id).sort(),
    [2, 4],
  );
  assert.deepEqual(
    stale.map((item) => item.id).sort(),
    [1, 3],
  );
});

test("pickNewestPerAuthor ignores unmanaged authors entirely", () => {
  const comments = [
    comment({ id: 1, login: "koraysrn" }),
    comment({ id: 2, login: "renovate[bot]" }),
  ];
  const { kept, stale } = pickNewestPerAuthor(comments, botMatcher());
  assert.deepEqual(kept, []);
  assert.deepEqual(stale, []);
});

test("pickStickyTarget only considers marker comments from a managed bot", () => {
  const marker = COVERAGE_DELTA_MARKER;
  const comments = [
    comment({ id: 1, body: `${marker}\nfirst` }),
    comment({ id: 2, body: `${marker}\nsecond` }),
    comment({ id: 3, body: "no marker" }),
    comment({ id: 4, body: `${marker}\nhuman wrote this`, login: "koraysrn" }),
  ];
  const { target, stale } = pickStickyTarget(comments, { marker });
  assert.equal(target.id, 2);
  assert.deepEqual(
    stale.map((item) => item.id),
    [1],
  );
  assert.throws(() => pickStickyTarget(comments, {}), /requires a marker/);
});

test("withMarker prefixes the marker once", () => {
  assert.equal(withMarker("body", "<!--m-->"), "<!--m-->\nbody");
  assert.equal(withMarker("<!--m-->\nbody", "<!--m-->"), "<!--m-->\nbody");
});

test("listComments follows pagination until the last page", async () => {
  const comments = [1, 2, 3, 4, 5].map((id) => comment({ id }));
  const { fetchImpl, calls } = fakeGitHub({ comments });
  const listed = await listComments({
    fetchImpl,
    token: "t",
    repository: "acme/awap",
    prNumber: 12,
    perPage: 2,
  });
  assert.equal(listed.length, 5);
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /repos\/acme\/awap\/issues\/12\/comments\?per_page=2&page=1/);
});

test("upsertStickyComment creates the first comment with the marker", async () => {
  const { fetchImpl, calls } = fakeGitHub({ comments: [], createId: 500 });
  const result = await upsertStickyComment({
    fetchImpl,
    token: "t",
    repository: "acme/awap",
    prNumber: 7,
    marker: COVERAGE_DELTA_MARKER,
    body: "delta",
    log: () => {},
  });
  assert.equal(result.action, "created");
  assert.deepEqual(result.deleted, []);
  const post = calls.find((call) => call.method === "POST");
  assert.equal(post.body.body, `${COVERAGE_DELTA_MARKER}\ndelta`);
});

test("upsertStickyComment patches the newest marked comment and deletes the older ones", async () => {
  const comments = [
    comment({ id: 10, body: `${COVERAGE_DELTA_MARKER}\nold` }),
    comment({ id: 11, body: `${COVERAGE_DELTA_MARKER}\nprevious` }),
  ];
  const { fetchImpl, calls } = fakeGitHub({ comments });
  const result = await upsertStickyComment({
    fetchImpl,
    token: "t",
    repository: "acme/awap",
    prNumber: 7,
    marker: COVERAGE_DELTA_MARKER,
    body: "fresh",
    log: () => {},
  });
  assert.equal(result.action, "updated");
  assert.equal(result.commentId, 11);
  assert.deepEqual(result.deleted, [10]);
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  const patch = calls.find((call) => call.method === "PATCH");
  assert.match(patch.url, /\/issues\/comments\/11$/);
  const deletes = calls.filter((call) => call.method === "DELETE");
  assert.equal(deletes.length, 1);
  assert.match(deletes[0].url, /\/issues\/comments\/10$/);
});

test("upsertStickyComment supports a dry run without writing", async () => {
  const { fetchImpl, calls } = fakeGitHub({ comments: [] });
  const result = await upsertStickyComment({
    fetchImpl,
    token: "t",
    repository: "acme/awap",
    prNumber: 7,
    marker: COVERAGE_DELTA_MARKER,
    body: "delta",
    dryRun: true,
    log: () => {},
  });
  assert.equal(result.dryRun, true);
  assert.equal(calls.filter((call) => call.method !== "GET").length, 0);
});

test("dedupeBotComments keeps the newest SonarQube comment and the newest Actions comment", async () => {
  const comments = [
    comment({ id: 1 }),
    comment({ id: 2 }),
    comment({ id: 3, login: "sonarqubecloud[bot]" }),
    comment({ id: 4, login: "sonarqubecloud[bot]" }),
    comment({ id: 5, login: "koraysrn" }),
  ];
  const { fetchImpl, calls } = fakeGitHub({ comments });
  const result = await dedupeBotComments({
    fetchImpl,
    token: "t",
    repository: "acme/awap",
    prNumber: 3,
    log: () => {},
  });
  assert.deepEqual(
    result.kept.map((item) => item.id).sort(),
    [2, 4],
  );
  assert.deepEqual(result.deleted.sort(), [1, 3]);
  const deletes = calls.filter((call) => call.method === "DELETE");
  assert.deepEqual(
    deletes.map((call) => Number(call.url.split("/").at(-1))).sort(),
    [1, 3],
  );
});

test("dedupeBotComments reports a failed deletion and keeps the newest comment", async () => {
  const messages = [];
  const { fetchImpl, calls } = fakeGitHub({
    comments: [comment({ id: 1 }), comment({ id: 2 })],
    failDeleteIds: [1],
  });
  const result = await dedupeBotComments({
    fetchImpl,
    token: "t",
    repository: "acme/awap",
    prNumber: 3,
    log: (message) => messages.push(message),
  });
  assert.deepEqual(result.kept.map((item) => item.id), [2]);
  assert.deepEqual(result.deleted, []);
  assert.ok(messages.some((message) => message.includes("::warning::Could not delete comment 1")));
  assert.equal(calls.filter((call) => call.url.endsWith("/issues/comments/2")).length, 0);
});

test("parseArgs reads the sticky options and rejects unknown flags", () => {
  const options = parseArgs([
    "sticky",
    "--pr",
    "42",
    "--marker",
    "<!--m-->",
    "--body-file=delta.md",
    "--bot",
    "github-actions[bot]",
    "--bot-prefix",
    "sonar",
    "--dry-run",
  ]);
  assert.equal(options.mode, "sticky");
  assert.equal(options.prNumber, "42");
  assert.equal(options.marker, "<!--m-->");
  assert.equal(options.bodyFile, "delta.md");
  assert.deepEqual(options.botLogins, ["github-actions[bot]"]);
  assert.deepEqual(options.botPrefixes, ["sonar"]);
  assert.equal(options.dryRun, true);
  assert.throws(() => parseArgs(["sticky", "--nope"]), /Unknown option/);
  assert.throws(() => parseArgs(["sticky", "--pr"]), /requires a value/);
});

test("main requires a token, a PR number and a marker before touching GitHub", async () => {
  // The usage errors are written to stderr; keep the test output readable.
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await main(["dedupe", "--pr", "1"], {}, () => {}), 2);
    assert.equal(
      await main(["dedupe"], { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "acme/awap" }, () => {}),
      2,
    );
    assert.equal(
      await main(
        ["sticky", "--pr", "1"],
        { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "acme/awap" },
        () => {},
      ),
      2,
    );
    assert.equal(await main(["sticky", "--help"], {}, () => {}), 0);
  } finally {
    console.error = originalError;
  }
});

test("the CI workflow refreshes one coverage comment instead of appending", async () => {
  const workflow = await readFile(CI_WORKFLOW, "utf8");
  assert.doesNotMatch(workflow, /gh pr comment/);
  assert.match(workflow, /node scripts\/pr-comment-hygiene\.mjs sticky/);
  assert.match(workflow, /<!-- awap-coverage-baseline-delta -->/);
});

test("the hygiene workflow dedupes bot comments on updates and after CI", async () => {
  const workflow = await readFile(HYGIENE_WORKFLOW, "utf8");
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \[CI\]/);
  assert.match(workflow, /pull-requests: write/);
  assert.match(workflow, /node scripts\/pr-comment-hygiene\.mjs dedupe/);
  assert.match(workflow, /node --test "scripts\/test\/pr-comment-hygiene\.test\.mjs"/);
});
