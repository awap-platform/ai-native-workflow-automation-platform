#!/usr/bin/env node
/**
 * Pull-request comment hygiene: at most one current comment per bot.
 *
 * Two sources of duplicate comments exist on this repository:
 *
 *   - the CI backend job published the coverage-baseline delta with
 *     `gh pr comment` on every `synchronize` event, appending one comment per
 *     push instead of refreshing a single one;
 *   - the SonarQube Cloud GitHub App decorates the pull request after every
 *     analysis, which accumulates `sonarqubecloud[bot]` comments.
 *
 * Modes:
 *
 *   sticky   Keep exactly one managed comment identified by a marker: patch the
 *            newest marked comment, delete the older marked ones and create the
 *            comment when none exists yet.
 *   dedupe   Keep only the newest comment of every managed bot and delete the
 *            rest, so a PR update never leaves a wall of superseded bot output.
 *
 * The GitHub API client accepts an injectable `fetchImpl`, so every branch is
 * unit-tested without network access.
 */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

/** GitHub Actions comments are written by this login. */
export const DEFAULT_BOT_LOGINS = ["github-actions[bot]"];

/**
 * SonarQube Cloud's GitHub App login changed with the product rebrand, so the
 * bot is matched by a plain login prefix instead of one exact login. A literal
 * prefix (never a caller-supplied regular expression) keeps operator input from
 * turning into a regex injection.
 */
export const DEFAULT_BOT_PREFIXES = ["sonar"];

/** Marker that makes the coverage comment findable across workflow runs. */
export const COVERAGE_DELTA_MARKER = "<!-- awap-coverage-baseline-delta -->";

/** Returns a predicate that recognises comments written by a managed bot. */
export function botMatcher(options = {}) {
  const logins = new Set(
    (options.botLogins ?? DEFAULT_BOT_LOGINS).map((login) => String(login).toLowerCase()),
  );
  const prefixes = (options.botPrefixes ?? DEFAULT_BOT_PREFIXES)
    .map((prefix) => String(prefix).toLowerCase())
    .filter((prefix) => prefix.length > 0);
  return (login) => {
    const value = String(login ?? "").toLowerCase();
    if (value.length === 0) {
      return false;
    }
    return logins.has(value) || prefixes.some((prefix) => value.startsWith(prefix));
  };
}

function commentOrder(comment) {
  const created = Date.parse(comment?.created_at ?? "") || 0;
  const id = Number(comment?.id) || 0;
  return [created, id];
}

/** Orders two comments from oldest to newest. */
export function compareComments(left, right) {
  const [leftCreated, leftId] = commentOrder(left);
  const [rightCreated, rightId] = commentOrder(right);
  if (leftCreated !== rightCreated) {
    return leftCreated - rightCreated;
  }
  return leftId - rightId;
}

/**
 * Splits managed comments into the newest one per author (`kept`) and every
 * superseded comment (`stale`). A comment whose login is not managed is ignored.
 */
export function pickNewestPerAuthor(comments, matches) {
  const newest = new Map();
  const stale = [];
  for (const comment of Array.isArray(comments) ? comments : []) {
    const login = String(comment?.user?.login ?? "");
    if (!matches(login)) {
      continue;
    }
    const key = login.toLowerCase();
    const current = newest.get(key);
    if (!current) {
      newest.set(key, comment);
      continue;
    }
    if (compareComments(comment, current) > 0) {
      stale.push(current);
      newest.set(key, comment);
    } else {
      stale.push(comment);
    }
  }
  return { kept: [...newest.values()], stale };
}

/**
 * Finds the sticky comment to refresh. Only comments that carry the marker and
 * were written by a managed bot qualify, so a human quoting the marker is safe.
 */
export function pickStickyTarget(comments, options = {}) {
  const marker = options.marker;
  const matches = options.matches ?? botMatcher(options);
  if (!marker) {
    throw new Error("pickStickyTarget requires a marker");
  }
  const managed = (Array.isArray(comments) ? comments : []).filter(
    (comment) =>
      matches(String(comment?.user?.login ?? "")) &&
      String(comment?.body ?? "").includes(marker),
  );
  if (managed.length === 0) {
    return { target: undefined, stale: [] };
  }
  const ordered = [...managed].sort(compareComments);
  return { target: ordered[ordered.length - 1], stale: ordered.slice(0, -1) };
}

/** Ensures the sticky marker is the first line of the published body. */
export function withMarker(body, marker) {
  const text = String(body ?? "").trim();
  return text.includes(marker) ? text : `${marker}\n${text}`;
}

function splitRepository(repository) {
  const [owner, repo] = String(repository ?? "").split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repository "${repository ?? ""}"; expected "owner/repo"`);
  }
  return { owner, repo };
}

function githubHeaders(token, hasBody) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "awap-pr-comment-hygiene",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
  };
}

async function githubRequest({ fetchImpl = fetch, token, url, method = "GET", body }) {
  const response = await fetchImpl(url, {
    method,
    headers: githubHeaders(token, body !== undefined),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`GitHub API ${response.status} ${method} ${url}: ${text.slice(0, 500)}`);
  }
  if (response.status === 204) {
    return undefined;
  }
  const text = await response.text();
  return text.length > 0 ? JSON.parse(text) : undefined;
}

/** Lists every conversation comment of a pull request. */
export async function listComments(options = {}) {
  const {
    fetchImpl = fetch,
    token,
    repository,
    prNumber,
    perPage = 100,
    maxPages = 20,
  } = options;
  const { owner, repo } = splitRepository(repository);
  const comments = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url =
      `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments` +
      `?per_page=${perPage}&page=${page}`;
    const batch = await githubRequest({ fetchImpl, token, url });
    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }
    comments.push(...batch);
    if (batch.length < perPage) {
      break;
    }
  }
  return comments;
}

export async function createComment(options = {}) {
  const { fetchImpl = fetch, token, repository, prNumber, body } = options;
  const { owner, repo } = splitRepository(repository);
  return githubRequest({
    fetchImpl,
    token,
    url: `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    method: "POST",
    body: { body },
  });
}

export async function updateComment(options = {}) {
  const { fetchImpl = fetch, token, repository, commentId, body } = options;
  const { owner, repo } = splitRepository(repository);
  return githubRequest({
    fetchImpl,
    token,
    url: `https://api.github.com/repos/${owner}/${repo}/issues/comments/${commentId}`,
    method: "PATCH",
    body: { body },
  });
}

export async function deleteComment(options = {}) {
  const { fetchImpl = fetch, token, repository, commentId } = options;
  const { owner, repo } = splitRepository(repository);
  return githubRequest({
    fetchImpl,
    token,
    url: `https://api.github.com/repos/${owner}/${repo}/issues/comments/${commentId}`,
    method: "DELETE",
  });
}

/**
 * Deletes every managed bot comment except the newest one per author.
 * Returns the kept comments and the deleted ids.
 */
export async function dedupeBotComments(options = {}) {
  const {
    fetchImpl = fetch,
    token,
    repository,
    prNumber,
    botLogins,
    botPrefixes,
    dryRun = false,
    log = console.log,
  } = options;
  const comments = await listComments({ fetchImpl, token, repository, prNumber });
  const matches = botMatcher({ botLogins, botPrefixes });
  const { kept, stale } = pickNewestPerAuthor(comments, matches);
  const deleted = [];
  for (const comment of stale) {
    if (dryRun) {
      log(`[dry-run] would delete comment ${comment.id} by ${comment.user?.login}`);
      deleted.push(comment.id);
      continue;
    }
    // One failed deletion must not hide the health of the remaining ones.
    try {
      await deleteComment({
        fetchImpl,
        token,
        repository,
        commentId: comment.id,
      });
      deleted.push(comment.id);
      log(`Deleted superseded comment ${comment.id} by ${comment.user?.login}`);
    } catch (error) {
      log(`::warning::Could not delete comment ${comment.id}: ${error.message}`);
    }
  }
  log(
    `Kept ${kept.length} bot comment(s)` +
      (kept.length > 0 ? ` (${kept.map((comment) => `${comment.user?.login}#${comment.id}`).join(", ")})` : "") +
      `; deleted ${deleted.length}.`,
  );
  return { kept, deleted };
}

/**
 * Refreshes the single sticky comment marked by `marker`: older marked comments
 * are deleted, the newest is patched, and a new comment is created when none
 * exists yet.
 */
export async function upsertStickyComment(options = {}) {
  const {
    fetchImpl = fetch,
    token,
    repository,
    prNumber,
    marker,
    body,
    botLogins,
    botPrefixes,
    dryRun = false,
    log = console.log,
  } = options;
  if (!marker) {
    throw new Error("upsertStickyComment requires a marker");
  }
  const comments = await listComments({ fetchImpl, token, repository, prNumber });
  const { target, stale } = pickStickyTarget(comments, {
    marker,
    matches: botMatcher({ botLogins, botPrefixes }),
  });
  const payload = withMarker(body, marker);

  if (dryRun) {
    log(
      target
        ? `[dry-run] would update comment ${target.id} and delete ${stale.length} superseded one(s)`
        : "[dry-run] would create the sticky comment",
    );
    return { action: target ? "updated" : "created", dryRun: true, commentId: target?.id, deleted: stale.map((comment) => comment.id) };
  }

  const deleted = [];
  let action;
  let commentId;
  if (target) {
    await updateComment({ fetchImpl, token, repository, commentId: target.id, body: payload });
    action = "updated";
    commentId = target.id;
    log(`Updated sticky comment ${target.id}.`);
  } else {
    const created = await createComment({ fetchImpl, token, repository, prNumber, body: payload });
    action = "created";
    commentId = created?.id;
    // The API-assigned id is not written to the log: it is remote input, and a
    // newline inside it would let a crafted response forge log lines (S5145).
    log("Created the sticky comment.");
  }
  for (const comment of stale) {
    try {
      await deleteComment({ fetchImpl, token, repository, commentId: comment.id });
      deleted.push(comment.id);
      log(`Deleted superseded marker comment ${comment.id}.`);
    } catch (error) {
      log(`::warning::Could not delete comment ${comment.id}: ${error.message}`);
    }
  }
  return { action, commentId, deleted };
}

const MODES = new Set(["sticky", "dedupe"]);

const USAGE = `Usage: pr-comment-hygiene.mjs <sticky|dedupe> --pr <number> [options]

Options:
  --pr <number>            Pull request number (required).
  --repository <owner/repo> Repository (default: $GITHUB_REPOSITORY).
  --body-file <path>       Sticky body (sticky mode); "-" reads stdin.
  --body <markdown>        Sticky body (sticky mode) when no file is given.
  --marker <string>        Sticky marker; required in sticky mode.
  --bot <login>            Additional managed bot login (repeatable).
  --bot-prefix <text>      Additional managed bot login prefix (repeatable).
  --dry-run                Print the planned calls without changing GitHub.
  --help                   Print this message.
`;

/** Parses argv into a plain options object. Throws on unknown options. */
export function parseArgs(argv) {
  const options = { dryRun: false, help: false, botLogins: [], botPrefixes: [] };
  const positionals = [];
  const valueFlags = {
    "--pr": "prNumber",
    "--repository": "repository",
    "--body-file": "bodyFile",
    "--body": "body",
    "--marker": "marker",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument === "--bot" || argument === "--bot-prefix") {
      const key = argument === "--bot" ? "botLogins" : "botPrefixes";
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      options[key].push(value);
      index += 1;
      continue;
    }
    const [flag, inlineValue] = argument.includes("=")
      ? [argument.slice(0, argument.indexOf("=")), argument.slice(argument.indexOf("=") + 1)]
      : [argument, undefined];
    const key = valueFlags[flag];
    if (key) {
      const value = inlineValue ?? argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${flag} requires a value`);
      }
      options[key] = value;
      if (inlineValue === undefined) {
        index += 1;
      }
      continue;
    }
    if (argument.startsWith("--")) {
      throw new Error(`Unknown option ${argument}`);
    }
    positionals.push(argument);
  }
  if (positionals.length > 1) {
    throw new Error(`Unexpected argument ${positionals[1]}`);
  }
  return { ...options, mode: positionals[0] };
}

async function readBody(options) {
  if (options.body !== undefined) {
    return options.body;
  }
  if (options.bodyFile === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  if (options.bodyFile !== undefined) {
    return readFile(options.bodyFile, "utf8");
  }
  return undefined;
}

export async function main(argv = process.argv.slice(2), env = process.env, log = console.log) {
  const options = parseArgs(argv);
  if (options.help) {
    log(USAGE);
    return 0;
  }
  if (!MODES.has(options.mode)) {
    console.error(USAGE);
    return 2;
  }
  const token = env.GITHUB_TOKEN ?? env.GH_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN or GH_TOKEN must be set.");
    return 2;
  }
  const repository = options.repository ?? env.GITHUB_REPOSITORY;
  if (!options.prNumber) {
    console.error("--pr is required.");
    return 2;
  }
  if (options.mode === "sticky" && !options.marker) {
    console.error("--marker is required in sticky mode.");
    return 2;
  }

  const common = {
    token,
    repository,
    prNumber: options.prNumber,
    botLogins: options.botLogins.length > 0 ? options.botLogins : undefined,
    botPrefixes: options.botPrefixes.length > 0 ? options.botPrefixes : undefined,
    dryRun: options.dryRun,
    log,
  };

  if (options.mode === "dedupe") {
    await dedupeBotComments(common);
    return 0;
  }
  const body = await readBody(options);
  if (body === undefined) {
    console.error("sticky mode requires --body-file or --body.");
    return 2;
  }
  await upsertStickyComment({ ...common, marker: options.marker, body });
  return 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
