# Backend foundation

How the FastAPI backend is configured, talks to the database, reports errors,
and reports its health. Business modules build on these pieces.

Versions this document was written against: FastAPI 0.143, Starlette 1.8,
SQLAlchemy 2.1.4, Pydantic 2.14, pydantic-settings 2.15, Alembic 1.20,
asyncpg 0.32, psycopg 3.3, Python 3.14.

## Request flow

```
uvicorn app.main:app
  └─ create_app()                      app/main.py
       ├─ get_settings()               validates environment once
       ├─ CORSMiddleware               FRONTEND_URL only, credentials allowed
       ├─ register_exception_handlers  every error -> error envelope
       └─ api_router (/api/v1)         app/api/v1/router.py
            ├─ health.router           /health, /health/ready
            │    └─ Depends(get_db_session) -> AsyncSession (asyncpg)
            └─ auth.router             /auth/* (app/modules/auth)
```

On shutdown, the `lifespan` handler calls `dispose_engine()` to close pooled
connections. The engine is created lazily on first use, so importing the app
never connects to the database.

## Configuration (`app/core/config.py`)

`get_settings()` returns a cached `Settings` (pydantic-settings) instance. Real
environment variables take precedence over the repository-root `.env` file, which
is shared with Docker Compose. Unknown variables (such as `POSTGRES_PASSWORD`) are
ignored. Application code must read configuration only through `get_settings()`.

| Variable         | Type / allowed values                       | Default                 |
| ---------------- | ------------------------------------------- | ----------------------- |
| `APP_ENV`        | `development`, `test`, `production`         | `development`           |
| `APP_DEBUG`      | bool                                        | `false`                 |
| `DATABASE_URL`   | `postgresql+asyncpg://user:pass@host:port/db` | required, no default  |
| `FRONTEND_URL`   | absolute http(s) origin, no path            | `http://localhost:5173` |
| `SESSION_SECRET` | string                                      | random per process      |
| `SESSION_MAX_AGE_SECONDS` | int, 300 to 2592000 (30 days)      | `604800` (7 days)       |
| `SESSION_COOKIE_SECURE` | bool, or unset                       | unset: on in production only |
| `SESSION_COOKIE_SAMESITE` | `lax`, `strict`, `none`            | `lax`                   |

Validation rules:

- `DATABASE_URL` must use the `postgresql+asyncpg` driver and name a database.
  It is a `SecretStr`, so the password is masked in `repr()` and logs.
- `FRONTEND_URL` has any trailing slash removed, because CORS compares origins
  exactly. Values with a path, query, or fragment are rejected.
- `SESSION_SECRET` keys the HMAC of stored session tokens and derives CSRF
  tokens (see [authentication](../features/authentication.md)). Outside
  production an unset value becomes a random token per process, so sessions do
  not survive a restart. Changing it signs everyone out.
- `SESSION_COOKIE_SAMESITE=none` requires a secure cookie. Use it only when the
  frontend and API are on different sites.
- When `APP_ENV=production`, startup fails if `APP_DEBUG` is true,
  `SESSION_SECRET` is unset or shorter than 32 characters, `FRONTEND_URL`
  is not `https`, or `SESSION_COOKIE_SECURE` is explicitly false.
- `APP_DEBUG=true` turns on SQL statement logging (`echo`) and Starlette's debug
  traceback page. SQL logs can contain personal data; never enable it on shared
  environments.

`Settings.sync_database_url` is the same URL with the `postgresql+psycopg`
driver. Only Alembic uses it.

## Database (`app/core/database.py`, `app/core/models.py`)

- **Engine:** a single `AsyncEngine` from `get_engine()`, using asyncpg with
  `pool_pre_ping=True` and a 5-second connect timeout.
- **Sessions:** `get_db_session` is a FastAPI dependency that yields one
  `AsyncSession` per request from `async_sessionmaker(expire_on_commit=False)`,
  which is SQLAlchemy's recommended setting for asyncio. The session closes when
  the request ends, which rolls back anything not committed, so handlers or
  services must call `await session.commit()` explicitly. An `AsyncSession` must
  not be shared between concurrent tasks.
- **Models:** all models inherit `Base`. Its metadata uses a fixed constraint
  naming convention (`pk_<table>`, `fk_<table>_<col>_<referred>`, ...) so
  migrations are deterministic. `Mapped[datetime]` defaults to
  `TIMESTAMP WITH TIME ZONE`.
- **Mixins:**
  - `UUIDPrimaryKeyMixin`: `id: UUID` primary key, generated in Python (`uuid4`).
  - `TimestampMixin`: `created_at` and `updated_at`, both defaulting to the
    database `now()`. `updated_at` is refreshed by ORM updates only; bulk
    `UPDATE` statements must set it themselves.

Tables so far: `users` and `user_sessions` (revision `0002`, auth module).

### Migrations (`alembic/`)

- `alembic/env.py` uses a **synchronous psycopg** connection built from
  `DATABASE_URL`, so migration scripts stay plain and there is no second URL to
  manage. Autogenerate compares against `Base.metadata`. New model modules must be
  imported in `env.py` or autogenerate will not see them.
- The migration connection pins `search_path=public`. The `postgis/postgis` image
  adds the `tiger` and `topology` schemas to the default search path; without
  pinning it, autogenerate would try to drop about 40 PostGIS tables.
  `spatial_ref_sys` is also excluded explicitly.
- Revision `0001` runs `CREATE EXTENSION IF NOT EXISTS postgis`. Its downgrade
  does nothing on purpose: the Docker image installs PostGIS and dependent
  extensions when the database is created, so dropping it would fail or remove
  objects this migration does not own.
- CI runs `alembic upgrade head` and `alembic check` against a fresh PostGIS
  container. Commands are listed in the README.

## Error handling (`app/core/errors.py`)

Every error response has the same body:

```json
{ "error": { "code": "not_found", "message": "Not Found", "details": null } }
```

Clients should branch on `code`, which is stable. `message` is for people and may
change.

| Source                                    | Status | `code`                     | `details`                     |
| ----------------------------------------- | ------ | -------------------------- | ----------------------------- |
| `raise APIError(status, code, msg, det, headers)` | given | given              | given                         |
| Framework HTTP errors (unknown route, 405)| as raised | derived from status phrase (`not_found`, `method_not_allowed`) | `null` |
| Request validation (pydantic)             | 422    | `validation_error`         | list of `{loc, msg, type}`    |
| Any other exception                       | 500    | `internal_server_error`    | `null`                        |

- Validation details intentionally omit pydantic's `input` and `ctx` fields:
  `input` can echo secrets back, and `ctx` can contain exception objects that
  cannot be serialized.
- Unexpected exceptions are logged with a traceback server-side. The client only
  receives the generic message.
- Response headers on HTTP errors (for example `Allow` on 405) are preserved.
  `APIError` accepts optional `headers` too (for example `Retry-After` on 429).
- Application code should raise `APIError`, not `fastapi.HTTPException`, so it
  can choose a specific `code`.

Known limitations:

- With `APP_DEBUG=true`, unhandled exceptions render Starlette's HTML debug page
  instead of the 500 envelope.
- 500 responses from unhandled exceptions are produced outside the CORS
  middleware and carry no CORS headers. A browser on another origin therefore
  reports them as network errors. 4xx and 503 responses are not affected.

## CORS

`CORSMiddleware` allows exactly one origin, `FRONTEND_URL`, with
`allow_credentials=True` so the session cookie is sent. Methods
(`GET, POST, PUT, PATCH, DELETE, OPTIONS`) and request headers
(`Accept, Content-Type, Authorization, X-CSRF-Token`) are listed explicitly. Wildcards are not
used. Any new custom request header must be added to `allow_headers`.

## Health endpoints (`app/api/v1/health.py`)

| Endpoint                   | Purpose   | Touches DB | Success                                    | Failure |
| -------------------------- | --------- | ---------- | ------------------------------------------ | ------- |
| `GET /api/v1/health`       | liveness  | no         | 200 `{"status":"ok","service":"mmirioma-api"}` | n/a |
| `GET /api/v1/health/ready` | readiness | `SELECT 1` | 200 `{"status":"ready","database":"ok"}`   | 503 `service_unavailable` |

The readiness check is bounded by a 5-second overall timeout, which includes
waiting for a pooled connection. On failure only the exception type is logged,
so hostnames and credentials do not reach logs or clients. Use `/health` for
"is the process alive" probes and `/health/ready` for routing traffic.

## Testing

From `backend/` with the virtualenv active:

```bash
pytest                      # unit tests; no database needed
TEST_DATABASE_URL="$(grep '^DATABASE_URL=' ../.env | cut -d= -f2-)" pytest   # + DB integration
```

- `tests/conftest.py` sets a test environment before importing the app. Its
  `DATABASE_URL` points at a closed port and is only used to prove that readiness
  returns 503.
- Readiness success/failure is tested by overriding `get_db_session`.
- `tests/test_errors.py` covers the envelope for validation, `APIError`, and
  unexpected errors.
- Tests marked `integration` run only when `TEST_DATABASE_URL` is set. CI sets it.
