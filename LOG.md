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

### 2026-10-16: Running the full test suite against the dev database deleted the demo accounts

- **Area:** backend (tests)
- **Author:** nnamdi-security + Claude Code
- **Symptom:** After `pytest` with `TEST_DATABASE_URL` set to the local
  development database (the `DATABASE_URL` in `.env`), the seeded demo
  accounts no longer existed and demo sign-in returned 401
  `invalid_credentials`.
- **Cause:** `tests/test_demo_seed_integration.py` deletes every account in the
  reserved demo phone block (and its orders) before and after its tests, as
  its header warns. Pointing `TEST_DATABASE_URL` at the dev database wipes the
  demo data.
- **Fix / workaround:** Re-ran `python -m app.modules.demo.seed`. Use a
  separate test database for `TEST_DATABASE_URL` (another database name on
  the same server), or re-seed after running the integration tests. Re-seed
  before a demo rehearsal.
- **Status:** workaround
- **Refs:** S1-11 (#12), `backend/tests/test_demo_seed_integration.py`

### 2026-10-16: Orders created by demo accounts are not marked Simulated

- **Area:** backend (demo data)
- **Author:** nnamdi-security + Claude Code
- **Symptom:** In the S1-11 demo rehearsal, the request sent through the app
  by Demo Customer One appeared in the staff list without the Simulated tag;
  the four seeded orders had it.
- **Cause:** `is_simulated` is set only by the seed command
  (`create_order(..., is_simulated=True)`); `POST /orders` always creates a
  real order, whoever the customer is. A demo order would count in real
  figures (BR-09).
- **Fix / workaround:** `POST /orders` now stores an order as simulated when a
  demo account (reserved phone block and "Demo" name,
  `app/shared/demo_accounts.py`) places it. Checked in the rehearsal: the live
  order shows the Simulated tag.
- **Status:** resolved (PR #43)
- **Refs:** S1-11 (#12), S1-18 (#22), `backend/app/modules/demo/seed.py`

### 2026-10-15: ruff S608 flagged SQL built with an f-string in a test

- **Area:** backend (tests)
- **Author:** chidimmamogbo + Claude Code
- **Symptom:** `ruff check .` failed with `S608 Possible SQL injection vector
  through string-based query construction` in the demo seed integration test's
  cleanup, which spliced a shared subquery into three `DELETE` statements.
- **Cause:** The values were bound parameters, but the statement text was
  assembled with f-strings, which the rule (rightly) cannot tell apart from
  unsafe interpolation.
- **Fix / workaround:** Write each statement out in full as a constant string
  with `%(name)s` parameters. Do not silence S608 with `noqa`.
- **Status:** resolved
- **Refs:** `backend/tests/test_demo_seed_integration.py`
### 2026-10-16: My orders briefly showed the old list after sending a request

- **Area:** frontend
- **Author:** nnamdi-security + Claude Code
- **Symptom:** In the S1-10 end-to-end run, "View my orders" right after
  sending a request first rendered the cached list without the new order,
  then refetched. On slow mobile data the customer would see their list
  without the request they had just sent.
- **Cause:** `invalidateQueries` only marks inactive queries stale; they
  refetch when next mounted, and the stale data shows first.
- **Fix / workaround:** After a create (and after a 409 "already received"),
  invalidate with `refetchType: 'all'` so the list refetches immediately,
  while the customer is on Request received. Use this for any cache the next
  screen shows right after a mutation.
- **Status:** resolved
- **Refs:** S1-10 (#11), `RequestWaterPage.tsx`

### 2026-10-15: Main JS chunk passed Vite's 500 kB warning with the customer screens

- **Area:** frontend
- **Author:** Cloudcrackamara + Claude Code
- **Symptom:** `npm run build` succeeds but warns "(!) Some chunks are larger
  than 500 kB after minification". `dist/assets/index-*.js` is 522 kB (161 kB
  gzipped); it was 486 kB before S1-05.
- **Cause:** The whole app (customer, staff, auth) is one bundle; the
  customer ordering screens added about 36 kB.
- **Fix / workaround:** None yet. Route-level code splitting (`React.lazy`
  per app area) would fix it, but it is an architectural change outside
  S1-05; propose it separately.
- **Status:** open
- **Refs:** S1-05, `frontend/src/App.tsx`

### 2026-10-15: Cancelling a radio click did not keep the old choice (React + jsdom)

- **Area:** frontend
- **Author:** Cloudcrackamara + Claude Code
- **Symptom:** The "locks the form while sending" test failed (`expected
  false to be true`): clicking another quantity tile while the request was
  sending changed the choice, although the tile's `onClick` called
  `preventDefault()`.
- **Cause:** React detects a radio change during the click event, before the
  cancelled click restores the old selection; in jsdom the old radio stayed
  unchecked. Ignoring `onChange` as well did not help.
- **Fix / workaround:** Use native `disabled` on the radios while sending.
  React Hook Form keeps the value of a field disabled through the DOM (only
  its own `disabled` register option drops it); the retry tests confirm the
  values are still sent.
- **Status:** resolved
- **Refs:** S1-05, `frontend/src/features/customer-orders/components/QuantityTiles.tsx`

### 2026-10-15: ESLint `react-hooks/refs` rejected `handleSubmit(fn)` in render

- **Area:** frontend
- **Author:** Cloudcrackamara + Claude Code
- **Symptom:** `Error: Cannot access refs during render … Passing a ref to a
  function may read its value during render  react-hooks/refs` on
  `const send = handleSubmit(async (values) => { if (sendingRef.current) … })`.
- **Cause:** `handleSubmit(...)` runs during render, and the rule cannot tell
  that the callback only reads the ref later, on submit.
- **Fix / workaround:** Build the handler at submit time:
  `const send = (event?: FormEvent) => handleSubmit(sendValues, showInvalid)(event)`.
- **Status:** resolved
- **Refs:** S1-05, `frontend/src/features/customer-orders/pages/RequestWaterPage.tsx`

### 2026-10-15: `tsc` rejected a `Uint8Array` parameter for `crypto.getRandomValues`

- **Area:** frontend (tests)
- **Author:** Cloudcrackamara + Claude Code
- **Symptom:** `error TS2345: Argument of type 'Uint8Array<ArrayBufferLike>' is
  not assignable to parameter of type 'ArrayBufferView<ArrayBuffer>'` in a
  test stub of `crypto`. Vitest still passed; only `npm run typecheck` failed.
- **Cause:** TypeScript 6 makes typed arrays generic over their buffer; a bare
  `Uint8Array` annotation may be backed by a `SharedArrayBuffer`, which
  `getRandomValues` does not accept.
- **Fix / workaround:** Annotate as `Uint8Array<ArrayBuffer>`.
- **Status:** resolved
- **Refs:** S1-05, `frontend/src/features/customer-orders/requestForm.test.ts`

### 2026-10-15: `npm ci` failed with EPERM while the dev server was running

- **Area:** tooling (frontend)
- **Author:** Cloudcrackamara + Claude Code
- **Symptom:** `npm run typecheck` reported `Cannot find module
  '@testing-library/react'` (packages in the lockfile but missing from
  `node_modules`). `npm ci` then failed: `EPERM: operation not permitted,
  unlink '…\node_modules\@rolldown\binding-win32-x64-msvc\rolldown-binding.win32-x64-msvc.node'`,
  leaving `node_modules` half deleted.
- **Cause:** On Windows a running `npm run dev` (Vite) keeps the rolldown
  native binary open, so npm cannot delete it.
- **Fix / workaround:** Stop the dev server (and any other Vite/Vitest
  process) before `npm ci` or `npm install`, then run it again.
- **Status:** resolved
- **Refs:** S1-05

### 2026-10-15: `python` is not available in Git Bash on this Windows machine

- **Area:** tooling
- **Author:** Cloudcrackamara + Claude Code
- **Symptom:** A script run with `python - <<'EOF'` failed: `bash: python:
  command not found`.
- **Cause:** Python is not on the Git Bash `PATH` here (the backend
  virtualenv was not active).
- **Fix / workaround:** Edit files with the editor tools or `sed`, or
  activate `backend/.venv` first when Python is really needed.
- **Status:** workaround
- **Refs:** S1-05

### 2026-10-15: `gh` not signed in, so the issue could not be read from GitHub

- **Area:** tooling (GitHub)
- **Author:** Cloudcrackamara + Claude Code
- **Symptom:** `gh issue view 6` failed: "To get started with GitHub CLI,
  please run:  gh auth login". The new `gh` install was also not yet on
  `PATH` in the open terminal.
- **Cause:** GitHub CLI was installed in the same session and never
  authenticated; `PATH` changes apply only to new terminals.
- **Fix / workaround:** Run `gh auth login` once, and open a new terminal.
  The issue scope was taken from `docs/process/sprint-1-plan.md` (S1-05) in
  the meantime.
- **Status:** workaround
- **Refs:** issue #6

### 2026-10-15: `git switch main` failed on a stale local `main`

- **Area:** tooling (git)
- **Author:** nnamdi-security + Claude Code
- **Symptom:** `git switch main` failed with `Your local changes to the
  following files would be overwritten by checkout: .gitignore`, and a
  following `git merge --ff-only origin/main` silently fast-forwarded the
  feature branch instead of `main`.
- **Cause:** The local `main` branch had not been updated since the first
  commits, so its `.gitignore` differed from the uncommitted local change.
  Work had been done on feature branches created from `origin/main`.
- **Fix / workaround:** Move the branch without a checkout, then switch:
  `git fetch origin && git branch -f main origin/main && git switch main`
  (safe when the current branch already contains `origin/main`). Check
  `git branch --show-current` after every switch in scripts.
- **Status:** resolved
- **Refs:** S1-10 integration check

### 2026-10-15: Integration tests stalled because Docker Desktop was not running

- **Area:** tooling (database)
- **Author:** chidimmamogbo + Claude Code
- **Symptom:** `pytest tests/test_orders_integration.py` printed nothing for
  over 6 minutes and had to be stopped. `docker ps` then failed with `failed
  to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine
  ... The system cannot find the file specified.`
- **Cause:** Docker Desktop had been closed (for example after a restart), so
  the test database container was down. pytest gives no hint of this when its
  output is piped through `tail`.
- **Fix / workaround:** Start Docker Desktop, wait for `docker info` to
  succeed, start the database container, and wait for `pg_isready` before
  running integration tests. On this machine Docker Desktop is a per-user
  install at `%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe`, not
  under `Program Files`.
- **Status:** resolved
- **Refs:** S1-03 (#4)

### 2026-10-15: Nested heredocs in one Git Bash command failed to parse

- **Area:** tooling (shell)
- **Author:** chidimmamogbo + Claude Code
- **Symptom:** A single command containing a `python - <<'EOF'` heredoc
  followed by a `cat >> file <<'EOF'` heredoc failed with
  `bash: -c: line 136: unexpected EOF while looking for matching '''`.
  Nothing ran, so no file was changed.
- **Cause:** Not confirmed. Two heredocs with the same delimiter, inside one
  `bash -c` string whose bodies contained quotes, were not parsed as expected.
- **Fix / workaround:** Make multi-line file edits with an editor (or one
  heredoc per command with distinct delimiters). Check `git status` after a
  failed scripted edit to confirm nothing was half-applied.
- **Status:** workaround
- **Refs:** `backend/tests/test_orders_integration.py`

### 2026-10-15: Hiding a table column with `display: none` shifted the other cells

- **Area:** frontend
- **Author:** nnamdi-security + Claude Code
- **Symptom:** In the admin orders table at 900 px, the "Preferred date" and
  "Created" values overlapped after the address column was hidden below
  desktop width (screenshot check).
- **Cause:** With `table-layout: fixed` and a `<colgroup>`, hidden
  (`display: none`) cells do not remove their `<col>`, so the remaining cells
  are laid out against the wrong column widths.
- **Fix / workaround:** Keep every column at every table width (truncate long
  text instead), or render a different layout below the breakpoint. Check
  table layouts at 768, 900 and 1280 px with a screenshot.
- **Status:** resolved
- **Refs:** S1-09, `frontend/src/features/admin-orders/OrderList.tsx`

### 2026-10-15: Removing several issue assignees with `gh api -f` did nothing

- **Area:** tooling (GitHub)
- **Author:** nnamdi-security + Claude Code
- **Symptom:** A loop of `gh api -X DELETE repos/.../issues/N/assignees -f
  "assignees[]=<login>"` removed the single assignee on most issues, but on
  #12, #13 and #19 (several assignees) the departed members were still listed,
  with no error.
- **Cause:** Not confirmed. The same call sent as a JSON body worked at once,
  so the form-encoded array is the likely cause.
- **Fix / workaround:** Send the array as JSON:
  `echo '{"assignees":["a","b"]}' | gh api -X DELETE .../assignees --input -`.
  Print the issue's assignees afterwards to confirm.
- **Status:** workaround
- **Refs:** issues #12, #13, #19

### 2026-10-15: Redirect after sign-in/sign-out lost to the route guard

- **Area:** frontend
- **Author:** nnamdi-security + Claude Code
- **Symptom:** New jsdom flow tests failed: staff returned to `/admin/orders`
  without their filters after signing in (`expected '/admin/orders' to be
  '/admin/orders?status=quote_requested'`); the one-time notice after
  creating an account and the "You've signed out." toast never appeared.
  The static-HTML tests could not catch this.
- **Cause:** The screens set the session, then called `navigate()`. React
  Router v7 runs navigations as transitions (low priority), so React first
  rendered the new session at the old URL, and that screen's own redirect
  (`<Navigate>` to the app home, or the guard's redirect to sign-in) won.
- **Fix / workaround:** Redirect declaratively from session state instead of
  calling `navigate()` after the change: the sign-in page renders
  `<Navigate to={from ?? home}>` once signed in; account creation passes the
  one-time-notice state in its own `<Navigate>`; sign-out only clears the
  session, marked "by user", and the guard shows the signed-out landing with
  the toast. Regression tests in `flows.test.tsx`.
- **Status:** resolved
- **Refs:** S1-17, PR #29

### 2026-10-15: Passing `login` directly as a TanStack `mutationFn`

- **Area:** frontend
- **Author:** nnamdi-security + Claude Code
- **Symptom:** `tsc -b` failed: `Type '(input: LoginInput, client?: ApiClient)
  => Promise<Session>' is not assignable to type 'MutationFunction<Session,
  LoginInput>'. Types of parameters 'client' and 'context' are incompatible.`
- **Cause:** TanStack Query v5 calls `mutationFn(variables, context)`. The
  API functions take an optional second `client` argument, so passing them
  directly would have sent requests through the mutation context object
  instead of the API client.
- **Fix / workaround:** Wrap them: `mutationFn: (values) => login(values)`.
  Do the same for any API function with optional extra parameters (queries
  too: `queryFn` receives a context object).
- **Status:** resolved
- **Refs:** S1-17, `frontend/src/features/auth/pages/`

### 2026-10-15: Static-HTML screen tests: camelCase attributes, no form defaults

- **Area:** frontend (tests)
- **Author:** nnamdi-security + Claude Code
- **Symptom:** `expected '<link rel="preload"…' to contain
  'autocomplete="new-password"'` and `… to contain 'value="0800 000 0001"'`.
- **Cause:** `react-dom/server` writes some attributes in React's camelCase
  (`autoComplete`, `readOnly`, `maxLength`). React Hook Form sets default
  values through refs after mount, so they never appear in static HTML.
- **Fix / workaround:** Assert the camelCase spelling. Do not test form
  default values with static rendering; they need a DOM test environment
  (not installed; needs approval).
- **Status:** workaround
- **Refs:** S1-17, `frontend/src/features/auth/screens.test.tsx`

### 2026-10-15: No browser available to check the auth screens visually

- **Area:** tooling
- **Author:** nnamdi-security + Claude Code
- **Symptom:** The agent environment has no browser tool and no Chrome or
  Chromium install, so the S1-17 screens could not be clicked through or
  screenshotted.
- **Cause:** Wrong diagnosis: only `google-chrome`/`chromium` on `PATH` were
  checked. Playwright's browsers are cached in `~/.cache/ms-playwright`
  (found during S1-09). The full `chromium-*/chrome-linux64/chrome` hangs
  with `--headless=new`; the dedicated
  `chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell`
  works: `chrome-headless-shell --no-sandbox --disable-gpu --hide-scrollbars
  --window-size=1280,1000 --virtual-time-budget=8000 --screenshot=out.png URL`.
  For signed-in staff pages, a local stand-in for `GET /api/v1/auth/me` (with
  CORS for the dev origin) avoids needing a database.
- **Fix / workaround:** Verified instead with typecheck, lint, build, the
  generated CSS, static-HTML screen tests, every module served by the dev
  server, and the exact API calls (CORS preflight, register, duplicate, me,
  logout with and without CSRF, wrong password, 429 with
  `retry_after_seconds`) made with curl from the dev-server origin. A person
  must still click through the screens in a browser before merge. Since S1-09,
  screenshots are possible with the headless shell above.
- **Status:** resolved
- **Refs:** S1-17

### 2026-10-15: LOG.md entry lost its heading in a merge

- **Area:** process (GitHub)
- **Author:** Daveoski + Claude Code
- **Symptom:** Merging `origin/docs/auth-design` into `davidui` conflicted in
  `LOG.md`. On `docs/auth-design`, the rate-limit entry ("Rate limit could be
  bypassed with concurrent login requests") carries the heading "GitHub API
  briefly unreachable", which has no body of its own.
- **Cause:** An earlier merge of new entries placed above the rate-limit
  entry kept the new heading and dropped the old one.
- **Fix / workaround:** On `davidui`, both sides' entries were kept, newest
  first, and the rate-limit heading restored. The "GitHub API briefly
  unreachable" entry's body needs to be recovered by its author. When
  resolving `LOG.md` conflicts, check that every heading still sits on its own
  body.
- **Status:** resolved (the "GitHub API briefly unreachable" entry was
  restored from commit 67cf95a in PR #29)
- **Refs:** PR #25, `LOG.md`

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

### 2026-10-14: GitHub API briefly unreachable

- **Area:** tooling (GitHub)
- **Author:** nnamdi-security + Claude Code
- **Symptom:** `error connecting to api.github.com ... check your internet
  connection or https://githubstatus.com` right after a successful `git push`.
- **Cause:** Transient network or GitHub outage; it recovered within minutes.
- **Fix / workaround:** Retry. When a fetch-edit-write sequence fails part way,
  check that nothing was half-applied (here an empty PR body was caught before
  it was sent).
- **Status:** resolved
- **Refs:** PR #16

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

### 2026-10-14: Testing Library and jsdom added for S1-09 component tests

- **Area:** tooling (frontend)
- **Author:** Daveoski + Claude Code
- **Symptom:** S1-09 (#10) requires component tests, but the skill said
  Testing Library was "not installed" and should be proposed first.
- **Cause:** The component-test tooling had not been set up yet.
- **Fix / workaround:** Added dev-only `@testing-library/react`,
  `@testing-library/dom`, `@testing-library/user-event` and `jsdom` on the
  `davidui` branch. Component tests opt in with `// @vitest-environment jsdom`.
  The skill notes were updated to match. Needs lead approval in the PR.
- **Status:** open
- **Refs:** #10, `frontend/package.json`, `frontend/vite.config.ts`

### 2026-10-14: React Router `<Link to={{ state }}>` silently drops the state

- **Area:** frontend
- **Author:** Daveoski + Claude Code
- **Symptom:** "Back to orders" lost the directory filters. The test failed with
  `expected '/admin/orders' to be '/admin/orders?status=en_route'`.
- **Cause:** `state` was put inside the `to` object. React Router ignores it
  there. It must be the separate `state` prop.
- **Fix / workaround:** `<Link to={path} state={{ fromSearch }}>`. Regression
  test: "returns to the directory with the filters it came from".
- **Status:** resolved
- **Refs:** `frontend/src/features/admin-orders/OrderList.tsx`

### 2026-10-14: ESLint `react-refresh/only-export-components` errors

- **Area:** frontend (lint)
- **Author:** Daveoski + Claude Code
- **Symptom:** `Fast refresh only works when a file only exports components`
  for `Button.tsx` (exported `buttonClasses`) and a test helper with an inline
  component.
- **Cause:** A `.tsx` file that exports components must not also export plain
  functions or constants, and a file exporting functions must not define components.
- **Fix / workaround:** Move shared helpers into `.ts` files
  (`buttonVariants.ts`, `reference.ts`). The test helper uses
  `createMemoryRouter` instead of a probe component.
- **Status:** resolved
- **Refs:** `frontend/src/components/ui/buttonVariants.ts`

### 2026-10-14: Headless Chrome screenshots cannot go below 512 px wide

- **Area:** tooling
- **Author:** Daveoski + Claude Code
- **Symptom:** `chrome --headless --window-size=390,…` screenshots looked
  clipped on the right, as if the page overflowed.
- **Cause:** Headless Chrome enforces a 512 px minimum viewport
  (`innerWidth` reported 512). The page itself was fine.
- **Fix / workaround:** For phone-width screenshots, load the page in a
  390 px-wide `<iframe>` inside a local HTML file and screenshot that.
- **Status:** workaround
- **Refs:** S1-09 PR screenshots

### 2026-10-14: `gh` CLI not installed on a Windows dev machine

- **Area:** GitHub
- **Author:** Daveoski + Claude Code
- **Symptom:** `gh: command not found` in Git Bash.
- **Cause:** The GitHub CLI is optional and was not installed.
- **Fix / workaround:** Read public issues with
  `curl https://api.github.com/repos/mmiri-oma/mmirioma/issues/<n>`. Open
  PRs in the GitHub web UI.
- **Status:** workaround
- **Refs:** team GitHub guide §4

### 2026-10-14: Rate limit could be bypassed with concurrent login requests

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
