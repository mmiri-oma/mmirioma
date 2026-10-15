# Issue log

Every problem, error or surprise hit while working on MmiriOma, and how it was
resolved. Read it before starting work: it saves repeating the same mistakes.
The rules for adding entries are in [CLAUDE.md](CLAUDE.md#issue-log-logmd).

Newest entries first. Never put secrets, credentials, tokens or personal data
(real phone numbers, addresses) in this file.

## Entry template

```markdown
### YYYY-MM-DD: <short title>

- **Area:** backend | frontend | database | CI | tooling | GitHub | process
- **Author:** <GitHub username> (+ agent, if one was used)
- **Symptom:** what happened, with the exact error message if there was one.
- **Cause:** why it happened (or "unknown" if not found yet).
- **Fix / workaround:** what was done, or what to do next time.
- **Status:** resolved | workaround | open
- **Refs:** issue/PR numbers, files, commits.
```

---

### 2026-10-15: Push declined due to email privacy restrictions

- **Area:** GitHub
- **Author:** chidimmamogbo + Claude Code
- **Symptom:** `git push` failed with `! [remote rejected] ... (push declined
  due to email privacy restrictions)`. `gh pr create` then failed with `No
  commits between main and <branch>`, because the branch never reached GitHub.
- **Cause:** The commit author email was a private address, and the GitHub
  account blocks command-line pushes that would expose it.
- **Fix / workaround:** Re-author the unpushed commit with the account's
  no-reply address (`<id>+<login>@users.noreply.github.com`, shown by
  `gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"'`):
  `git -c user.email=<noreply> commit --amend --no-edit --reset-author`. To
  avoid it next time, set that address as `user.email` for the repository.
- **Status:** workaround
- **Refs:** PR #28

### 2026-10-15: `Session.flush(objects)` is deprecated in SQLAlchemy 2.1

- **Area:** backend
- **Author:** chidimmamogbo + Claude Code
- **Symptom:** Every orders integration test failed under `pytest -W error` with
  `sqlalchemy.exc.SADeprecationWarning: The `objects` parameter of
  `Session.flush` is deprecated`.
- **Cause:** `create_order` flushed only the new order (`session.flush([order])`)
  so its row existed before the `order_events` row referencing it.
- **Fix / workaround:** Add the order, call `session.flush()` with no
  arguments, then add the event. Only the order is pending at that point, so
  the behavior is the same.
- **Status:** resolved
- **Refs:** `backend/app/modules/orders/service.py`

### 2026-10-15: Port 5432 taken by another project's database container

- **Area:** tooling (database)
- **Author:** chidimmamogbo + Claude Code
- **Symptom:** `docker compose up -d` failed with `Bind for 127.0.0.1:5432
  failed: port is already allocated`. The MmiriOma PostGIS container never
  started, while `DATABASE_URL` in `.env` still pointed at `localhost:5432`,
  which reaches the other project's plain Postgres instead.
- **Cause:** A container from another local project published the same port.
- **Fix / workaround:** For S1-03 tests, a throwaway container was run on
  another port (`docker run -d --name mmirioma-s103-testdb -e POSTGRES_USER=mmirioma
  -e POSTGRES_PASSWORD=<local-only> -e POSTGRES_DB=mmirioma -p 127.0.0.1:5433:5432
  postgis/postgis:16-3.4`) and `DATABASE_URL`/`TEST_DATABASE_URL` were set to
  it for the commands only. Longer term: stop the other container while working
  here, or make the published port configurable in `compose.yaml` (needs team
  agreement). Check `docker ps` before `docker compose up`.
- **Status:** workaround
- **Refs:** `compose.yaml`, S1-03 (#4)

### 2026-10-15: Stacked PR #23 merged into its old base, not `main`

- **Area:** GitHub
- **Author:** nnamdi-security + Claude Code
- **Symptom:** The Sprint 1 restructure (`docs/process/sprint-1-plan.md`,
  prompt 04, the PR template and the G2/G3 rules in `CLAUDE.md`) was missing
  from `main` although PR #23 showed as merged.
- **Cause:** PR #23 was stacked on PR #16 (base `docs/ui-driven-workflow`).
  #16 was merged into `main` first; #23 was merged six minutes later into its
  unchanged base `docs/ui-driven-workflow`, so its commit never reached `main`.
- **Fix / workaround:** The next PR (`docs/auth-design`) was branched from
  `docs/ui-driven-workflow`, so it carries the restructure to `main`. For
  stacked PRs: after merging the lower PR, change the upper PR's base to
  `main` before merging it, or merge only from the top of the stack.
- **Status:** workaround
- **Refs:** PR #16, PR #23, commit 4594680

### 2026-10-14: Creating issues with `gh api -f` failed with HTTP 422

- **Area:** tooling (GitHub)
- **Author:** nnamdi-security + Claude Code
- **Symptom:** `gh api -X POST repos/.../issues -f "title=..." -F milestone=5
  -f "labels[]=P0" -f "assignees[]=..."` returned `gh: Validation Failed (HTTP
  422)`. No issue was created.
- **Cause:** unknown. The error details were not captured; a later test showed
  bracketed titles such as `[S1-13]` pass through `-f` unchanged, so that is
  not it.
- **Fix / workaround:** Build the request as a JSON file and send it with
  `gh api -X POST repos/mmiri-oma/mmirioma/issues --input issue.json`. This also
  avoids `gh issue create`/`edit` and their Projects (classic) bug. Print the
  full error body (`2>&1`) next time to find the cause.
- **Status:** workaround
- **Refs:** issues #17-#22

### 2026-10-14: Shell `while read` loop skipped the last item

- **Area:** tooling (shell)
- **Author:** nnamdi-security + Claude Code
- **Symptom:** A `while read sid n; do ...; done < targets.txt` loop updated 14
  of 15 issues; the last one (#22) was silently skipped.
- **Cause:** The file had no trailing newline, and `read` returns non-zero for
  a final line without one, so the loop ends before processing it.
- **Fix / workaround:** End generated files with a newline, or loop with
  `while read -r a b || [ -n "$a" ]; do`. Always compare the processed count
  with the expected count.
- **Status:** resolved
- **Refs:** issue #22

### 2026-10-14: GitHub API briefly unreachable

- **Area:** backend (security)
- **Author:** nnamdi-security + Claude Code
- **Symptom:** Caught in self-review before commit. The first version checked
  the login limit, awaited the password check, and only then recorded the
  failure. Many requests sent at once would all pass the check before any
  failure was counted, defeating the 5-attempt limit.
- **Cause:** Check-then-record split across an `await` (scrypt runs in a thread).
- **Fix / workaround:** Count the attempt in the same synchronous step as the
  check (`AuthRateLimits.begin_login`), and withdraw it only when the login
  succeeds. Rule of thumb: never put an `await` between checking a limit or
  capacity and recording its use. Regression test:
  `test_login_attempts_count_before_they_finish`.
- **Status:** resolved
- **Refs:** `backend/app/modules/auth/rate_limit.py`

### 2026-10-14: `npx prettier` reformatted a whole file in the wrong style

- **Area:** tooling (frontend)
- **Author:** nnamdi-security + Claude Code
- **Symptom:** Running `npx prettier --write` on `frontend/src/lib/api/client.ts`
  rewrote the entire file with double quotes and semicolons. The diff became
  unrelated noise.
- **Cause:** Prettier is not a project dependency and the repo has no prettier
  config, so `npx` used a global/cached copy with default settings.
- **Fix / workaround:** Reverted the file and reapplied only the intended edits.
  The existing code style matches
  `prettier --no-semi --single-quote --print-width 90`. Do not run prettier
  without those options. Adding prettier as a dev dependency needs approval
  (CLAUDE.md).
- **Status:** workaround
- **Refs:** `frontend/src/lib/api/client.ts`

### 2026-10-14: TypeScript TS7022 when a test variable is named `fetch`

- **Area:** frontend (tests)
- **Author:** nnamdi-security + Claude Code
- **Symptom:** `error TS7022: 'fetch' implicitly has type 'any' because it does
  not have a type annotation and is referenced directly or indirectly in its own
  initializer.`
- **Cause:** `const fetch = vi.fn<typeof fetch>(...)` refers to the local
  `fetch` it is declaring, not the global.
- **Fix / workaround:** Name the mock something else (`fetchMock`).
- **Status:** resolved
- **Refs:** `frontend/src/lib/api/auth.test.ts`

### 2026-10-14: Alembic autogenerate duplicated a CHECK constraint

- **Area:** database
- **Author:** nnamdi-security + Claude Code
- **Symptom:** The autogenerated migration for `users` contained two identical
  `role IN (...)` check constraints, one named `user_role` and one named
  `ck_users_user_role`.
- **Cause:** A column typed `sa.Enum(..., native_enum=False,
  create_constraint=True)` emits its own constraint, and autogenerate also
  listed the model's named constraint.
- **Fix / workaround:** In the migration, type the column `sa.String(20)` and keep
  only the explicitly named `ck_users_user_role`. `alembic check` stays clean.
  Always read autogenerated migrations before applying them.
  Recurred on 2026-10-15 for the three order status columns in `0003`; fixed
  the same way.
- **Status:** resolved
- **Refs:** `backend/alembic/versions/20261014_0002_add_users_and_user_sessions.py`,
  `backend/alembic/versions/20261015_0003_add_orders_and_order_events.py`

### 2026-10-14: "Value not echoed" tests gave false failures

- **Area:** backend (tests)
- **Author:** nnamdi-security + Claude Code
- **Symptom:** Tests asserting that an input does not appear in the response
  failed even though nothing was echoed. The input `0800000000` was found inside
  the fixed error message `...for example 08000000001`, and the password `short`
  was found inside pydantic's error type `string_too_short`.
- **Cause:** Test data that is a substring of fixed response text.
- **Fix / workaround:** Assert the exact fixed message, or use distinctive test
  values (for example `Pw7!xyz`) for "not echoed" checks.
- **Status:** resolved
- **Refs:** `backend/tests/test_phone.py`, `backend/tests/test_auth_api.py`

### 2026-10-14: Async engine must not be shared across event loops in tests

- **Area:** backend (tests)
- **Author:** nnamdi-security + Claude Code
- **Symptom:** Caught in design, not at runtime. Running service functions with
  `asyncio.run()` next to a `TestClient` would reuse the app's cached engine,
  whose asyncpg connections belong to the TestClient's event loop.
- **Cause:** `get_engine()` is cached per process, but asyncpg connections are
  tied to the event loop that created them.
- **Fix / workaround:** In tests, give direct service calls their own engine
  (`create_async_engine(TEST_DATABASE_URL)`) and dispose it afterwards.
- **Status:** resolved
- **Refs:** `backend/tests/test_auth_integration.py` (`run_service`)

### 2026-10-14: Backslash in a docstring joined two lines

- **Area:** backend
- **Author:** nnamdi-security + Claude Code
- **Symptom:** A shell example wrapped with `\` to satisfy ruff's 100-character
  limit (E501) rendered as one joined line.
- **Cause:** In a normal Python string, backslash-newline is a line
  continuation, so the newline disappears.
- **Fix / workaround:** Shorten the example instead of wrapping it, or use a raw
  docstring (`r"""..."""`).
- **Status:** resolved
- **Refs:** `backend/app/modules/auth/cli.py`

### 2026-10-14: GitHub milestone due date lost its time

- **Area:** GitHub
- **Author:** nnamdi-security + Claude Code
- **Symptom:** Setting the Sprint 1 milestone `due_on` to `2026-10-16T09:48:41Z`
  saved it as `2026-10-16T00:00:00Z`.
- **Cause:** GitHub milestones store a date only.
- **Fix / workaround:** Communicate the exact sprint cutoff time to the team
  separately.
- **Status:** workaround
- **Refs:** milestone "Sprint 1"

### 2026-10-14: Wrong GitHub username in the Sprint 1 issue pack

- **Area:** GitHub / process
- **Author:** nnamdi-security + Claude Code
- **Symptom:** The issue pack and `create_sprint1_issues.sh` used `bonavee120`,
  which is not assignable on the repo.
- **Cause:** Typo. The collaborator's login is `Bonvee120`.
- **Fix / workaround:** Corrected the script. Check usernames with
  `gh api repos/mmiri-oma/mmirioma/assignees --jq '.[].login'` before
  assigning.
- **Status:** resolved (pending confirmation that `Bonvee120` is Chukwuebuka)
- **Refs:** issues #7, #8, #12, #13

### 2026-10-14: `gh issue create --project` and `gh pr edit` fail

- **Area:** GitHub / tooling
- **Author:** nnamdi-security + Claude Code
- **Symptom:** `GraphQL: Projects (classic) is being deprecated in favor of the
  new Projects experience ... (repository.projects)`. No issues were created.
- **Cause:** The installed `gh` looks up Projects (classic) for `--project`.
- **Fix / workaround:** Create the issue without `--project`, then run
  `gh project item-add 1 --owner mmiri-oma --url <issue-url>`. Needs the
  `project` token scope (`gh auth refresh -s project`).
  `gh pr edit` fails the same way (`... (repository.pullRequest.projectCards)`).
  Edit PRs through the REST API instead:
  `gh api -X PATCH repos/mmiri-oma/mmirioma/pulls/<n> -F "body=@body.md"`.
  Upgrading `gh` may remove the need for both workarounds.
- **Status:** workaround
- **Refs:** issues #2–#13, PR #16, project "MmiriOma — MVP Development"
