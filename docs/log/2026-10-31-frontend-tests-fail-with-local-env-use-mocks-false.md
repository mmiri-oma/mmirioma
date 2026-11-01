# 2026-10-31: Frontend tests failed locally because `.env.local` sets `VITE_USE_MOCKS=false`

- **Area:** tooling
- **Author:** nnamdi-security + agent
- **Symptom:** `npm test` showed dozens of failures in mock-mode tests, for
  example `ApiError: Unable to reach the server. Check your connection and try
  again.` with `Caused by: Error: connect ECONNREFUSED 127.0.0.1:8000`
  (`useSession.draft.test.tsx`, `VerifyPhone.test.tsx`, `PartnerSignup`...).
- **Cause:** `frontend/.env.local` (git-ignored) had `VITE_USE_MOCKS=false`.
  `vite.config.ts` lets that value force the real API in tests too, so
  mock-mode tests called a backend that was not running. CI has no
  `.env.local`, so it was not affected.
- **Fix / workaround:** Run the tests with the variable overridden:
  `VITE_USE_MOCKS=true npm test`. The process environment wins over the file.
  The file was not edited (it is the developer's own).
- **Status:** workaround
- **Refs:** `frontend/vite.config.ts` (`serveMocks`), `frontend/.env.example`.
