# CLAUDE.md

Guidance for Claude Code and other contributors working in this repository.

## Project

MmiriOma is a technology-enabled water delivery platform in Enugu, Nigeria. The
MVP covers customer water ordering, configurable pricing, delivery scheduling,
dispatch, driver assignments, delivery confirmation, and administration.

**Before implementing any feature, read the PRD and SRS**
(`MmiriOma_MVP_PRD.md` and `MmiriOma_MVP_SRS.md` at the repo root; the SRS is
normative) and follow them. If a
requirement is missing, ambiguous, or conflicts with this file, ask; do not guess
business rules (pricing, order states, dispatch logic, payments).

## Architecture

Modular monolith: one FastAPI service, one PostgreSQL/PostGIS database, one React app.

```
backend/
  app/
    main.py            # app factory: middleware, error handlers, routers
    core/              # cross-cutting infrastructure only
      config.py        # pydantic-settings; get_settings()
      database.py      # async engine, get_db_session dependency
      models.py        # Base, naming convention, UUID/timestamp mixins
      errors.py        # APIError + consistent error envelope
    api/v1/            # versioned router aggregation, health probes
    modules/<name>/    # one package per business domain (orders, pricing, ...)
    shared/            # small utilities genuinely shared across modules
  alembic/             # migrations
  tests/
frontend/
  src/
    lib/api/           # centralized HTTP client and typed endpoint functions
    components/
docs/
  architecture/        # cross-cutting design (backend.md, frontend.md)
  features/            # one document per implemented feature
```

Read `docs/architecture/` before changing configuration, the database layer,
error handling, health checks, or the frontend API client.

- Each business module owns its models, schemas, services, and router. Modules
  talk to each other through service functions, not by reaching into each
  other's tables or internals.
- `core/` holds infrastructure only, never business logic.

## Approved technology stack

- Backend: Python 3.14, FastAPI, SQLAlchemy 2 (async, asyncpg), Alembic (psycopg
  for migrations), pydantic / pydantic-settings, PostgreSQL 16 + PostGIS.
- Frontend: React 19, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query,
  React Hook Form, Zod, lucide-react.
- Testing: Pytest, Vitest. Lint: ruff, ESLint.
- Infrastructure: Docker Compose. CI: GitHub Actions.

**Do not introduce new frameworks, libraries, services, or infrastructure**
(e.g. Redis, Celery, message queues, other databases, ORMs, state managers, UI
kits, Flutter, AI integrations) **without explicit approval.** Propose it first,
with the reason.

## Monorepo conventions

- Backend commands run from `backend/` with its virtualenv; frontend commands from
  `frontend/`.
- Backend dependencies: pinned in `backend/requirements.txt` (runtime) and
  `backend/requirements-dev.txt` (dev). Frontend: `frontend/package.json` with
  the committed `package-lock.json`.
- Keep docs and commands Bash-compatible (Linux and Git Bash on Windows). Do not
  assume PowerShell.
- Do not modify files unrelated to the task.

## Backend standards

- Fully type-annotated code; ruff must pass (`ruff check .`, `ruff format .`).
- Async all the way: use `AsyncSession` via the `get_db_session` dependency. Never
  block the event loop (no sync DB drivers, `requests`, or `time.sleep` in handlers).
- Read configuration only through `get_settings()`; never `os.environ` in app code.
- Models inherit `Base`, and use `UUIDPrimaryKeyMixin` and `TimestampMixin`. All
  datetimes are timezone-aware (UTC).
- Keep route handlers thin: validation in pydantic schemas, logic in services.
- Prefer simple functions and modules over abstract base classes, repositories,
  or generic layers until there is a real need.
- Do not create placeholder or stub features that look operational but are not.

## API contract

- All endpoints live under `/api/v1`. Breaking changes require a new version.
- Request and response bodies are pydantic models with explicit types.
- Errors always use the envelope from `app/core/errors.py`:
  `{"error": {"code": "snake_case_code", "message": "Human readable", "details": null}}`.
  Raise `APIError(status, code, message, details)`; never return ad-hoc error dicts.
  Validation errors (422) use code `validation_error` with `details` as a list of
  `{loc, msg, type}`.
- Never leak exception messages, stack traces, SQL, or secrets in responses.
- Use correct HTTP status codes (201 create, 204 no content, 404, 409, 422, 503...).
- Frontend calls the API only through `src/lib/api/client.ts`, which sends
  credentials and converts failures to `ApiError`.

## Database and migrations

- Every schema change goes through an Alembic migration in `backend/alembic/versions/`.
  Never alter the database by hand or with `Base.metadata.create_all`.
- Generate with `alembic revision --autogenerate -m "..."`, then **review and edit**
  the script. Autogenerate does not catch everything (renames, data migrations,
  PostGIS specifics).
- Import new model modules in `alembic/env.py` so autogenerate sees them.
- Migrations must be reversible where reasonably possible, and must not drop or
  rewrite production data without an explicit, reviewed plan.
- Never edit a migration that has been merged to `main`; add a new one.
- `alembic check` must pass in CI (models and migrations in sync).
- Spatial data uses PostGIS (SRID 4326 unless the SRS says otherwise).

## Testing

- Every change ships with tests. Bug fixes include a regression test.
- Backend: `pytest`. Unit tests must not need a database or network; override
  dependencies instead. Tests that need a real database are marked
  `@pytest.mark.integration` and run only when `TEST_DATABASE_URL` is set.
- Frontend: Vitest; mock `fetch` / the API client rather than calling servers.
- Tests never use production services or real credentials.
- Before declaring work done, run: backend `ruff check . && ruff format --check . && pytest`;
  frontend `npm run lint && npm run typecheck && npm test && npm run build`.

## Maintainability

- New features must include appropriate automated tests.
- Business logic lives in module services, not in API routers. Routers parse the
  request, call a service, and shape the response.
- Money is stored, calculated, and sent as **integer kobo** in NGN (SRS §5,
  BR-01). Use `BigInteger` columns named `*_kobo` or `*_minor_units`, Python
  `int`, and integer JSON fields such as `total_minor_units` (SRS §6). Never use
  `float`. If an intermediate step produces fractions (e.g. a percentage fee),
  compute it with `decimal.Decimal` and convert to whole kobo with a documented
  rounding rule. Convert to naira only for display.
- Database migrations must be reviewed by a person and tested (`alembic upgrade
  head`, `alembic downgrade -1`, `alembic check`) before merge.
- Never introduce unnecessary dependencies.
- Never silently change a shared API contract (paths, fields, types, status
  codes, error codes). Contract changes need explicit agreement, a note in the
  PR, and updated docs and tests.
- Do not introduce unrelated architectural changes in a feature task; propose
  them separately.

## Code documentation (mandatory)

Every developer must be able to open an unfamiliar module, understand its
purpose, trace its execution, and maintain it.

### Python

- Use **Google-style docstrings** for public modules, classes, functions,
  methods, and business services, with `Args:`, `Returns:` / `Yields:`, and
  `Raises:` sections where they apply.
- Explain non-obvious algorithms and important decisions (the "why").
- Explain complex business rules in detail, especially **pricing,
  authorization, payments, and delivery state transitions**. State the rule,
  its source (PRD/SRS section), and edge cases.
- Use descriptive variable and function names.
- Do not write comments that repeat what the code obviously does.

```python
def calculate_quote_total_kobo(rule: PricingRule, quantity_litres: int) -> int:
    """Return the all-inclusive quote total in kobo for a quantity.

    Sums the active rule's water cost, zone fee, and handling fees (FR-022).
    Amounts are integer kobo throughout (SRS §5), so no rounding is needed.

    Args:
        rule: Active pricing rule for the service zone and water category.
        quantity_litres: Requested quantity in whole litres.

    Returns:
        The total in kobo.

    Raises:
        APIError: 422 ``manual_quote_required`` if the quantity is outside the
            rule's supported band (FR-021).
    """
```

(Example only: this function does not exist.)

### React and TypeScript

- Use **JSDoc/TSDoc** for exported components, hooks, utilities, and complex
  functions (`@param`, `@returns`, `@throws` where useful).
- Document important component props and behavior (put TSDoc on props interface
  fields).
- Explain non-obvious state management and effects: why an effect exists, what
  it depends on, and how it cleans up.
- Keep components focused and reusable.
- Avoid redundant JSX comments.

### General

- Write documentation in clear, straightforward English.
- Prefer readable code over excessive comments.
- Documentation must match actual behavior. Update docstrings, comments, and
  Markdown docs in the same change that alters behavior.
- Never leave misleading or outdated comments. If you find one, fix it.

## Feature documentation (mandatory)

Every significant feature must have a Markdown document in `docs/features/`,
e.g. `docs/features/authentication.md`, `docs/features/orders.md`,
`docs/features/pricing.md`. Write or update it in the same pull request as the
feature. Each document must cover:

1. Overview and purpose.
2. Feature workflow.
3. Important files and their responsibilities.
4. Database models and relationships.
5. API endpoints and request/response behavior.
6. Important business rules.
7. Authentication and authorization requirements.
8. Error handling and edge cases.
9. Testing instructions.
10. Known limitations.

Write "None" for a section that genuinely does not apply rather than omitting it.
Do not create placeholder feature documents: only document functionality that
actually exists.

## UI-driven workflow

Features are built design first. Follow
`docs/process/ui-driven-development.md`:

1. Slice scoped from SRS requirement IDs.
2. Claude Design prompt written in `docs/design/prompts/`, reusing the shared
   design system (`00-design-system.md`).
3. Design generated, recorded in `docs/design/<slice>.md`, and reviewed against
   the SRS by the technical lead.
4. API contract derived from the screens and agreed in `docs/api/`.
5. Frontend (against mocks) and backend (against the contract) built in
   parallel, then integrated.

Rules:

- **Do not implement an endpoint or screen without an agreed contract in
  `docs/api/`.** If none exists, write or propose it first.
- Designs decide what a screen shows and which actions it offers; the SRS
  decides business rules. Never add fields, statuses, prices or permissions
  because a design "seems to need" them: raise an open question instead.
- Frontend work implements every state in the approved design (empty, loading,
  error, success, each error code).
- When writing a design prompt, include the honesty rules from the process
  document (no invented prices, no false confirmation or tracking, no
  water-quality claims, sample data labelled).

## Issue log (`LOG.md`)

`LOG.md` at the repo root records every problem hit while working on the
project. This applies to every team member and every coding agent.

- **Read `LOG.md` before starting a task.** If a known issue applies, follow its
  recorded fix instead of rediscovering it.
- **Add an entry for every issue or error you encounter**: failed commands,
  test or CI failures, tooling or dependency problems, migration problems,
  confusing framework behavior, wrong data in plans or issues, and mistakes
  you had to undo. Log it even if you fixed it in minutes.
- Use the entry template at the top of `LOG.md`, newest entries first. Include
  the exact error message, the cause, the fix or workaround, and a status
  (`resolved`, `workaround`, `open`). Name the author (GitHub username, plus
  "+ agent" when one was used).
- Add entries in the same branch and PR as the work they came from. Update the
  status of an existing entry rather than duplicating it.
- Never put secrets, credentials, tokens or personal data in `LOG.md`.
- Agents: mention new `LOG.md` entries in your final report to the user.

## Modern framework standards

- Follow the current official documentation that matches the project's
  **pinned** dependency versions (see `backend/requirements*.txt` and
  `frontend/package.json` / `package-lock.json`).
- Consult official documentation for anything unfamiliar, security-sensitive,
  or version-dependent. Prefer official sources over blog posts:
  - FastAPI: https://fastapi.tiangolo.com/
  - SQLAlchemy: https://docs.sqlalchemy.org/en/20/ (the project pins 2.1; use the
    matching version selector, https://docs.sqlalchemy.org/en/21/)
  - Pydantic: https://docs.pydantic.dev/latest/
  - Alembic: https://alembic.sqlalchemy.org/
  - React: https://react.dev/
  - TypeScript: https://www.typescriptlang.org/docs/
  - Vite: https://vite.dev/guide/
  - Tailwind CSS: https://tailwindcss.com/docs/
- When documentation must be checked:
  1. Identify the installed dependency version.
  2. Consult the applicable official documentation.
  3. Confirm compatibility.
  4. Implement the recommended, supported approach.
  5. Document important architectural decisions (in `docs/architecture/` or the
     feature document).
- If current documentation cannot be accessed, say so. **Never claim
  verification that did not occur.**
- Do not upgrade dependencies blindly. Upgrades are separate, deliberate changes
  with release notes reviewed.
- Avoid deprecated functionality; treat deprecation warnings in tests as bugs.
- Conventions in use:
  - Python typing on all code; `X | None`, built-in generics (`list[str]`).
  - FastAPI dependencies declared with `Annotated[T, Depends(...)]`.
  - FastAPI `lifespan` for startup/shutdown, never `@app.on_event`.
  - Pydantic v2 APIs: `model_config`, `field_validator`, `model_validator`,
    `model_dump`, `model_validate`; never v1 `class Config`, `@validator`,
    `.dict()`, `.parse_obj()`.
  - SQLAlchemy 2-style: `Mapped[...]` / `mapped_column`, `select()` with
    `session.execute()` / `session.scalars()`; never the legacy `session.query()`.
  - React function components and hooks; TypeScript strict-style checks as
    configured in `tsconfig.app.json`.
  - Tailwind CSS v4 via the `@tailwindcss/vite` plugin and Vite conventions from
    the official docs.

## Security

- Never commit secrets. `.env` files are git-ignored; only `.env.example` is tracked.
  Never hardcode passwords, tokens, or keys, including in tests or CI beyond
  throwaway CI-only values.
- `VITE_*` variables are public (bundled into the browser); never put secrets there.
- CORS uses the explicit `FRONTEND_URL` origin with credentials; never `"*"`.
- Validate all input at the API boundary; use SQLAlchemy parameter binding, never
  string-formatted SQL.
- Authentication is not implemented yet. When it is, it will use secure
  HttpOnly cookie sessions signed with `SESSION_SECRET`; follow the SRS.
- Do not log secrets, credentials, or personal data (phone numbers, addresses).

## Git workflow

- Branch from `main` using `feat/...`, `fix/...`, `chore/...`, `docs/...`.
- Small, focused commits with imperative messages (Conventional Commits style
  preferred, e.g. `feat(orders): add order creation endpoint`).
- Open pull requests against `main`; CI must pass. PR descriptions state what
  changed, why, how it was tested, and any migration or config impact.
- **Do not commit, push, merge, rebase, or switch branches without explicit
  permission from the user.**
