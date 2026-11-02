# 2026-11-02: npm ci warns EBADENGINE on Node 25

- **Area:** tooling
- **Author:** Oluwaseyi Oyewunmi (+ agent)
- **Symptom:** `npm ci` in `frontend/` printed `npm warn EBADENGINE` (Node
  v25.6.1 on the machine, the project expects Node 24) and then installed
  523 packages. Lint, typecheck, tests and the dev server all worked.
- **Cause:** The README requires Node.js 24; the machine had Node 25.
- **Fix / workaround:** Harmless for this work. Use Node 24 (for example
  `nvm install 24 && nvm use 24`) to match CI before trusting a borderline
  result.
- **Status:** workaround
- **Refs:** `README.md` prerequisites, `frontend/package.json`.
