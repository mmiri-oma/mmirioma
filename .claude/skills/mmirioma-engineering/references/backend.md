# Backend conventions (FastAPI, SQLAlchemy 2, Pydantic v2, Alembic)

Official docs (match installed versions from `scripts/versions.sh`):
FastAPI https://fastapi.tiangolo.com/ · Starlette https://starlette.dev/ ·
SQLAlchemy https://docs.sqlalchemy.org/en/21/ (project pins 2.1) ·
Pydantic https://docs.pydantic.dev/latest/ · Alembic https://alembic.sqlalchemy.org/

## Module layout

```
backend/app/modules/<module>/
  models.py     # SQLAlchemy models (Base + UUIDPrimaryKeyMixin + TimestampMixin)
  schemas.py    # Pydantic request/response models
  service.py    # business logic; takes AsyncSession; no FastAPI imports
  router.py     # thin: parse -> authorize -> call service -> return schema
```

- Register routers in `app/api/v1/router.py`. Import models in `alembic/env.py`.
- Modules use each other's **service functions**, never each other's tables or private helpers.
- `app/core/` is infrastructure only.

## FastAPI

- Dependencies: `Annotated[AsyncSession, Depends(get_db_session)]`; define `Annotated` aliases for repeated ones.
- Startup/shutdown via the existing `lifespan`; never `@app.on_event`.
- Return annotations or `response_model` on every endpoint; correct status codes (201 create, 204 delete).
- Domain errors: `raise APIError(HTTPStatus.CONFLICT, "slot_unavailable", "...")`. Use the SRS error names where they exist (`quote_expired`, `slot_unavailable`, `manual_quote_required`). Document them with `responses={...: {"model": ErrorResponse}}`.
- No blocking calls in `async def`. Configuration only via `get_settings()`.

## Pydantic v2

- `ConfigDict`, `field_validator`, `model_validator`, `model_dump`, `model_validate`, `from_attributes=True`.
- Never v1 APIs: `class Config`, `@validator`, `@root_validator`, `.dict()`, `.json()`, `.parse_obj()`, `orm_mode`.
- Separate input and output schemas (`OrderCreate`, `OrderRead`). Never expose internal fields or other customers' data.
- Constrain inputs: `Field(gt=0, le=...)`, `max_length`, `Literal` or `StrEnum` for fixed choices. Litres are integers.

## SQLAlchemy 2 (async)

- `Mapped[...]` + `mapped_column(...)`; `select()` with `session.execute()` / `session.scalars()` / `session.get()`. Never `session.query()`.
- No lazy loading in async code: use `selectinload()` / `joinedload()`, or `lazy="raise"`.
- The service owns the transaction: one `await session.commit()` per unit of work. Never share a session across concurrent tasks.
- **Money:** `BigInteger` columns named `*_kobo` or `*_minor_units`. If an intermediate calculation needs fractions, use `Decimal` and convert to kobo with a documented rounding rule. Never `float`.
- **Statuses:** explicit enumerations (`StrEnum` + a DB enum or check constraint), not free text.
- **Concurrency (NFR-010/011, FR-025/026):** enforce with database guarantees: unique constraints (idempotency keys, payment references), `SELECT ... FOR UPDATE` (`.with_for_update()`) or conditional `UPDATE ... WHERE reserved < capacity`. Never use check-then-insert in Python alone.
- **Audit (NFR-004):** write an `order_events` / `audit_logs` row in the same transaction as the change it records.
- Public references are non-guessable (FR-027); never expose sequential IDs.
- Datetimes are timezone-aware UTC (`datetime.now(UTC)`, never `utcnow()`). Convert to Africa/Lagos only for display.
- Geospatial: PostGIS via GeoAlchemy2 only after approval and adding it to `requirements.txt`; SRID 4326.
- Index foreign keys and common filters (status, date, zone).

## Migrations

1. Change models, then from `backend/`: `alembic revision --autogenerate -m "<imperative summary>"`.
2. **Read and edit the script.** Autogenerate misses renames, data migrations, enum changes, server defaults, and PostGIS details.
3. Write a correct `downgrade()`, or explain in it why one is impossible.
4. Test: `alembic upgrade head` → `alembic downgrade -1` → `alembic upgrade head` → `alembic check`.
5. Never edit migrations already merged to `main`. Never drop or rewrite data without an approved plan. Never use `create_all()` outside tests.

## Security and validation

- Validate every input at the boundary. Never trust client-sent prices, totals, roles, or statuses.
- Authorize per object in the service or a dependency: "may this user act on *this* order?" (FR-001, T-07).
- SQL only through SQLAlchemy constructs or `text()` with bound parameters.
- Never log or return secrets, phone numbers, addresses, or payment references in full (NFR-015).
- Rate limiting (NFR-002) exists only for login and registration (`app/modules/auth/rate_limit.py`, in-memory, single process). Reuse `SlidingWindowLimiter` for quote, OTP and order endpoints. Request IDs (NFR-015) are not implemented yet. Propose an approach (and any dependency) before adding one.
- New settings go in `Settings`, `.env.example`, and `docs/architecture/backend.md`. No secrets in code, tests, or docs.
- CORS stays an explicit origin. Add new custom headers to `allow_headers`.
