/**
 * Minimal GitHub REST client shared by the repository tooling.
 *
 * `scripts/trivy-regression-notify.mjs` and `scripts/pr-comment-hygiene.mjs`
 * both need the same authenticated JSON request helper. Keeping a single copy
 * avoids duplicated code between the two tools (SonarQube Cloud measures it as
 * duplication on new code) and keeps the headers in one place.
 *
 * Every caller passes its own `fetchImpl`, so the whole module is unit-tested
 * without network access.
 */

export const DEFAULT_USER_AGENT = "awap-tooling";

/** Builds the headers every GitHub REST call in this repository uses. */
export function githubHeaders(token, hasBody, userAgent = DEFAULT_USER_AGENT) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": userAgent,
    "X-GitHub-Api-Version": "2022-11-28",
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
  };
}

/**
 * Performs one GitHub REST call and returns the parsed JSON body.
 * A 204 response resolves to `undefined`; any other non-2xx status throws with
 * the status, the method and (truncated) response text.
 */
export async function githubRequest(options = {}) {
  const {
    fetchImpl = fetch,
    token,
    url,
    method = "GET",
    body,
    userAgent = DEFAULT_USER_AGENT,
  } = options;
  const response = await fetchImpl(url, {
    method,
    headers: githubHeaders(token, body !== undefined, userAgent),
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
