# 2026-11-12: `python` is not on the PATH in Git Bash on Windows

- **Area:** tooling
- **Author:** Cloudcrackamara + Claude Code
- **Symptom:** A one-off script to insert a row into
  `docs/process/ui-driven-development.md` failed with
  `/usr/bin/bash: line 12: python: command not found`. Nothing was changed.
- **Cause:** In this Git Bash session outside `backend/`'s virtualenv there is
  no `python` command. The project's Python lives in the backend virtualenv.
- **Fix / workaround:** Made the edit with the editor instead. For a script
  outside the backend, activate the virtualenv first or do not depend on
  Python for a documentation edit.
- **Status:** workaround
- **Refs:** #411, `docs/process/ui-driven-development.md`.
