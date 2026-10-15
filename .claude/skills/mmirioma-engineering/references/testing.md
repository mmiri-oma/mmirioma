# Testing standards

NFR-032 requires automated tests for calculation, access control, order transitions,
duplicate checkout, and payment reconciliation before any demo deployment.

## Backend (pytest)

- Unit tests need no database or network. Override dependencies, e.g.
  `client.app.dependency_overrides[get_db_session] = fake_session`. Use the `client` fixture from `tests/conftest.py`.
- Anything that relies on real SQL behavior (constraints, locking, concurrency, migrations) is an integration test: `@pytest.mark.integration`, runs when `TEST_DATABASE_URL` is set (CI sets it). Async tests use `@pytest.mark.anyio`.
- Map SRS acceptance tests to test names, e.g. `test_t05_concurrent_bookings_only_one_gets_last_slot`.
- Cover: happy path; 422 validation; each domain error code; authorization denials for every role (T-07); invalid state transitions (T-08); boundary values (0, negative, max capacity); kobo rounding edges.
- Concurrency (T-05, T-06): run real concurrent requests or sessions against the database. Do not rely on mocks.
- Assert the full error envelope (`code`), not just the status.
- Every bug fix gets a regression test that fails without the fix.
- No real credentials, production URLs, or external services. Demo fixtures must be flagged as simulated (NFR-031).

## Frontend (Vitest)

- Test endpoint functions with `createApiClient({ baseUrl, fetch: mockFetch })`: success, envelope errors, network errors, aborts.
- Component tests: add `// @vitest-environment jsdom` at the top of the file and use Testing Library (`@testing-library/react`, `user-event`). Query by role and label; inject data through props or context, never real servers.

## Migrations

`alembic upgrade head` → `alembic downgrade -1` → `alembic upgrade head` → `alembic check`, against the local Docker database.
