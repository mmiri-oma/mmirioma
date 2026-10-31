# 2026-10-31: Local dev database `mmirioma_fork` did not match the migrations; an agent downgraded it

- **Area:** database
- **Author:** nnamdi-security + agent
- **Symptom:** `python -m alembic upgrade head` against the `DATABASE_URL` in
  `.env` (database `mmirioma_fork`, at revision `0017`) failed at 0017 -> 0018:
  `psycopg.errors.DuplicateColumn: column "kind" of relation "water_sources" already exists`.
  Then `alembic check` said `Target database is not up to date.`
- **Cause:** that database was built from a different migration lineage (the
  fork's earlier numbering), so it already had columns this repo's 0018 adds
  while its `alembic_version` said 0017.
- **Mistake by the agent:** the commands were chained
  (`upgrade; downgrade -1; upgrade; check`) without first checking the database.
  The `downgrade -1` therefore ran `0017 -> 0016` on this database and undid
  migration 0017 (order delivery details and the picked service zone, #21). The
  database is now at `0016`. Its 4 users and 4 orders still exist; the columns
  and values 0017 added to `orders` were dropped. It is a local dev database.
- **Fix / workaround:** Do not use `mmirioma_fork` for checks. Verify
  migrations on a fresh database
  (`create database mmirioma_otp_check`, `DATABASE_URL=... python -m alembic upgrade head`),
  which passed up, down, up and `alembic check`. To repair the dev database:
  recreate it (`drop database mmirioma_fork; create database ...` then
  `alembic upgrade head` and the demo seed) or restore from a backup if the data
  matters.
- **Status:** open (the dev database still needs recreating by its owner)
- **Refs:** migration `0023` (this branch), `docs/architecture/` database notes.
