# 2026-11-12: Driver location implementation inspection and tooling

- **Area:** backend | tooling
- **Author:** @nnamdi-security (+ Codex)
- **Symptom:** Initial inspection assumed partner models already existed; they did not. An edit script expected a directory schema import absent from the actual service. Docker inspection initially lacked socket permission; shell globs and an unquoted GitHub API query were rejected by zsh.
- **Cause:** Assumptions about file organization and shell expansion before inspecting exact imports.
- **Fix / workaround:** Read actual modules, create the dedicated partner location model, adapt imports, quote API paths and use authorized Docker access. Resume only the unapplied edit steps. Use a dedicated disposable PostGIS container for #410, never development data.
- **Validation follow-up:** The first test launch timed out in automatic approval review before execution; retry succeeded. The admin-deactivation test initially called `set_active` instead of the existing `set_activation`; corrected the test to exercise the real service. The virtualenv console-script shebang points to an old checkout, so use `.venv/bin/python -m alembic` and disable login-shell directory changes.
- **Frontend validation:** The initial unqualified frontend test run inherited `VITE_USE_MOCKS=false` from the existing ignored `.env.local` and failed unrelated mock screens. Stopped it and reran with `VITE_USE_MOCKS=true VITE_VAPID_PUBLIC_KEY=` as the existing environment issue logs prescribe; no environment files were changed.
- **Sandbox follow-up:** The corrected mock-mode Vitest run stalled in the sandbox with no progress. Stopped it; the changed privacy page passed outside the sandbox (six tests), then launched the full suite outside the sandbox with two workers.
- **Contract parser regression:** The full frontend run exposed that the Zod profile schema stripped the new `location` summary. Added the agreed coordinate-free field to the typed parser with unknown-state/malformed-metadata regression coverage; no collection UI was added.
- **Status:** resolved
- **Refs:** #410, #423, `app/modules/partners/location.py`, `app/modules/partners/directory.py`.
