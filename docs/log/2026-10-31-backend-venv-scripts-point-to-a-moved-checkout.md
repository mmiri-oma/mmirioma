# 2026-10-31: `alembic` in `backend/.venv` points to a checkout that no longer exists

- **Area:** tooling
- **Author:** nnamdi-security + agent
- **Symptom:** `.venv/bin/alembic upgrade head` failed with
  `bad interpreter: /home/<user>/Documents/Mmirioma-fork/mmirioma/backend/.venv/bin/python3.14: no such file or directory`.
  `pytest` showed skipped-test paths under `Mmirioma-fork/...` as well.
- **Cause:** the virtualenv was created in an earlier checkout and the folder
  was moved or copied; console scripts keep the old absolute interpreter path in
  their first line.
- **Fix / workaround:** Run the tools as modules, which use the working
  interpreter: `python -m alembic ...`, `python -m pytest ...`. To fix for good,
  recreate the venv: `python -m venv .venv && pip install -r requirements-dev.txt`.
- **Status:** workaround
- **Refs:** `.claude/skills/mmirioma-engineering/scripts/check.sh` runs
  `$VENV_BIN/alembic`, so `check.sh --db` fails the same way until the venv is
  recreated.
