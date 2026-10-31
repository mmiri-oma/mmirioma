---
description: Take one Linking MVP issue in this repo from start to an open PR
argument-hint: <issue number>
---

Work issue #$ARGUMENTS in `mmiri-oma/mmirioma`. Follow the
steps in order; each ends on its **Done when**. Ask the user before every git
action that changes history or the remote (branch, commit, push, PR), as
CLAUDE.md requires.

## 1. Load the issue

1. `gh issue view $ARGUMENTS --repo mmiri-oma/mmirioma --json title,body,labels,comments`.
   Use `--json`: outside a terminal, `--comments` prints only the comments
   and leaves out the issue body.
2. Read CLAUDE.md, starting with "Team workflow", and your lane in
   `docs/process/linking-plan.md`.
3. For each issue on the "Depends on" line, check it is closed
   (`gh issue view <n> --repo mmiri-oma/mmirioma --json state`).
   An open dependency means stop: tell the user which one and why it blocks.
4. Search the log for known problems in this area:
   `grep -ril "<words>" docs/log LOG.md`.
5. Read every file the Scope names, plus `docs/architecture/api-mapping.md`
   and the contract in `docs/api/`.

**Done when:** you have told the user, in a few lines, the goal, the files you
will change, every "Done when" item of the issue, and any question the issue
or the SRS leaves open, and the user has answered those questions.

## 2. Branch

`git switch development && git pull`, then, with the user's OK,
`git switch -c <feat|fix|docs|chore>/$ARGUMENTS-<short-slug>`.

**Done when:** you are on the new branch with a clean tree.

## 3. Do the work

Use the `mmirioma-engineering` skill for the standards. By issue type:

- **Link:** replace each function's `notConnected(...)` branch with an
  adapter in the feature's `real/` folder that calls the client in
  `frontend/src/lib/api/` and converts with `docs/architecture/api-mapping.md`.
  Pages and components keep their props. A field the backend lacks gets the
  screen's empty or error state and a line in the PR, never invented data.
- **Contract:** write `docs/api/<name>.md` as `Status: proposed` from the
  fork's screens and mocks; every business rule cites the SRS, and anything
  the SRS leaves open is an open question.
- **Backend:** build exactly the agreed contract, with an Alembic migration
  for any schema change and integer kobo for money.
- **Design:** record the design in `docs/design/<slice>.md` with every state.

Stay inside the files your lane owns. A needed change to a shared file or
another lane's file goes to the user first.

**Done when:** every "Done when" item of the issue is met, with tests written
for each adapter or endpoint (success and at least one error code).

## 4. Verify

Run the checks for every area you touched, from CLAUDE.md "Testing":

- Frontend, in `frontend/`: `npm run lint && npm run typecheck && npm test && npm run build`
- Backend, in `backend/` with the virtualenv: `ruff check . && ruff format --check . && pytest`
  (plus `alembic upgrade head`, `alembic downgrade -1`, `alembic check` for a migration)

For a link issue, ask the user to click through the screen against the local
backend (`VITE_USE_MOCKS=false`, demo seed loaded) and report what they saw.

**Done when:** every command passes and, for a link issue, the user has
confirmed the click-through. Record each problem you hit on the way as a new
file in `docs/log/` (template in `docs/log/README.md`).

## 5. Open the PR

With the user's OK: commit in Conventional Commits style, push to `origin`,
and open the PR against `development` (never `main`) using
`.github/pull_request_template.md`, with `Closes #$ARGUMENTS`; `development` is
the default branch, so the keyword closes the issue when the PR merges. CODEOWNERS requests the reviewers.
Then wait for CI: `gh pr checks <pr> --repo mmiri-oma/mmirioma --watch`.

**Done when:** the PR is open with both CI jobs green. A red job means
fix, push, and wait again.

## 6. Report

Tell the user: the PR link, what changed, the checks you ran and their
results, new `docs/log/` entries, and any gap left for another issue.
