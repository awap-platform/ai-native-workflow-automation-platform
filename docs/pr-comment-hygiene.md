# PR comment hygiene

A pull request that is pushed to many times used to turn into a wall of bot
output:

- the backend CI job published the coverage-baseline delta with `gh pr comment`,
  so every `synchronize` event appended another comment;
- the SonarQube Cloud GitHub App decorates the pull request after every
  analysis, so every push added one more `sonarqubecloud[bot]` comment.

[`scripts/pr-comment-hygiene.mjs`](../scripts/pr-comment-hygiene.mjs) keeps the
conversation to **one current comment per bot**.

## Sticky comment (GitHub Actions)

The coverage delta is now a *sticky* comment. The CI step calls:

```bash
node scripts/pr-comment-hygiene.mjs sticky \
  --pr "$PR_NUMBER" \
  --marker "<!-- awap-coverage-baseline-delta -->" \
  --body-file backend/target/coverage-baseline-delta.md
```

The script lists the pull-request comments, finds the ones written by a managed
bot that carry the marker, patches the newest one with the fresh body and
deletes the older marked comments. The first run creates the comment and
prefixes the marker automatically.

The marker makes the lookup deterministic: a comment that merely quotes the text
is never touched, and a renamed step cannot create a second sticky comment.

## Bot dedupe (SonarQube Cloud and GitHub Actions)

[`pr-comment-hygiene.yml`](../.github/workflows/pr-comment-hygiene.yml) runs
`node scripts/pr-comment-hygiene.mjs dedupe --pr <number>` and keeps only the
newest comment of every managed bot. Older comments - including the ones
appended before this workflow existed - are deleted.

Managed authors are:

- `github-actions[bot]` (exact login);
- any login matching `^sonar`, so the SonarQube Cloud bot keeps working across
  the `sonarcloud[bot]` → `sonarqubecloud[bot]` rename.

Use `--bot <login>` and `--bot-pattern <regex>` to extend the list without
editing the script. `--dry-run` prints the planned calls instead of changing
GitHub.

## Triggers and timing

| Trigger | Why |
|---|---|
| `pull_request` (`opened`, `synchronize`, `reopened`, `ready_for_review`) | Clears the comments superseded by the push as soon as the PR is updated. |
| `workflow_run` (`CI` → `completed`) | Runs after the analysis, when the SonarQube Cloud decoration for the current run exists, and removes the previous one. |
| `workflow_dispatch` (`pr`) | Manual cleanup of a single pull request. |

The post-CI pass waits briefly before deleting, because the SonarQube Cloud app
posts its decoration asynchronously once the quality gate has been computed.

Forked pull requests receive a read-only `GITHUB_TOKEN` for `pull_request`
workflows, so the early pass is skipped for forks; the `workflow_run` pass runs
in the base repository with write access and performs the cleanup instead.

## Required permission

Deleting a comment on a pull request needs `pull-requests: write`. The workflow
requests exactly that plus `contents: read` for the checkout.

## Local check

```bash
node --test "scripts/test/pr-comment-hygiene.test.mjs"

GITHUB_TOKEN="$(gh auth token)" GITHUB_REPOSITORY=owner/repo \
  node scripts/pr-comment-hygiene.mjs dedupe --pr 123 --dry-run
```

The dedupe run is recorded in the workflow log for every deleted comment, and a
failed deletion emits a `::warning::` annotation without failing the run.

## Limitations

- Only conversation comments are managed; inline review comments
  (`pulls/comments`) and the SonarQube check run are never touched.
- The script keeps the newest comment **per bot**, not one comment in total: the
  coverage delta and the quality-gate decoration still describe different
  things, so both survive.
- Deleting a comment written by another account needs write access to the pull
  request. If the token ever loses that permission the script warns and leaves
  the comment in place instead of failing the workflow.
