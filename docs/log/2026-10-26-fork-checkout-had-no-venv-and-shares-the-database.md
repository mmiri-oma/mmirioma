# 2026-10-26: The fork checkout had no virtualenv and shares the database with the main repo

- **Area:** database
- **Author:** nnamdi-security (+ Claude Code)
- **Symptom:** in a fresh clone of the fork, `scripts/versions.sh` printed
  `backend/.venv not found`, and there was no `.env`. The local PostGIS
  container is shared with a checkout of `mmiri-oma/mmirioma`, whose test
  database `mmirioma_test` was at revision `0013`, the same number as the
  fork's head, while the fork was about to add its own `0014`.
- **Cause:** each checkout needs its own virtualenv. Both repositories number
  migrations independently, so upgrading one shared test database with the
  fork's `0014` would break the main repo's `alembic check` (or its own
  `0014` later).
- **Fix / workaround:** `cd backend && python3.14 -m venv .venv &&
  .venv/bin/pip install -r requirements-dev.txt`, and a separate database
  for the fork: `CREATE DATABASE mmirioma_fork_test`, then
  `DATABASE_URL=<…>/mmirioma_fork_test alembic upgrade head`, and run
  integration tests with `TEST_DATABASE_URL` pointing at it. Never point
  the fork's migrations at `mmirioma_test` or `mmirioma`.
- **Seen again (Daveoski + agent, 2026-11-03):** this checkout had no
  `backend/.venv`; the system Python failed with `ModuleNotFoundError: No module
  named 'geoalchemy2'` and `ruff: command not found`. Fixed as above, on Windows:
  `py -3.14 -m venv .venv && .venv/Scripts/python -m pip install -r
  requirements-dev.txt`, then run tools as `.venv/Scripts/python -m pytest` and
  `-m ruff`. Check the folder is ignored with `git check-ignore -v .venv/` (with
  the slash) before it exists.
- **Seen again (DevBonavee + Claude Code, 2026-11-12, #407):** this checkout had no
  `backend/.venv`, no `.env` and no `frontend/node_modules`, and Docker Desktop was not
  running (`failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`).
  Fixed the first and third with `py -3.14 -m venv .venv` plus `pip install -r
  requirements-dev.txt`, and `npm ci`; the database checks wait for Docker.
- **Status:** workaround
- **Refs:** #30
