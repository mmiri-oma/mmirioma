# 2026-11-04: Project-review frontend tests timed out under load

- **Area:** frontend
- **Author:** Daveoski + agent
- **Symptom:** After fast-forwarding to `main` at `59bda1a`, the full frontend run reported 1,570 passed, 2 failed and 57 skipped tests. Three suites (`operations.screens.test.tsx`, `support.screens.test.tsx`, and `waterSources.screens.test.tsx`) failed setup with `Hook timed out in 10000ms`. `CodeStep.test.tsx` could not find `Customer step`, and `PartnerAccount.test.tsx` could not find the `Verify` link; both failure snapshots still showed loading screens.
- **Cause:** Consistent with local timing pressure while frontend checks and the backend suite ran concurrently; contention was not independently measured. The existing logs describe the same hook timeout and partner-account timing pattern. Both CI jobs for promotion PR #405 passed.
- **Fix / workaround:** Reran only the five affected files with `npm test -- --reporter=dot --maxWorkers=2 --hookTimeout=60000 src/features/admin/operations.screens.test.tsx src/features/admin/support.screens.test.tsx src/features/admin/waterSources/waterSources.screens.test.tsx src/features/partner/pages/CodeStep.test.tsx src/features/partner/pages/PartnerAccount.test.tsx`. All 5 files and 69 tests passed. Application and test code were unchanged.
- **Seen again (DevBonavee + Claude Code, 2026-11-12, #407):** a full `npm test` on Windows
  failed only `PartnerAccount.test.tsx > profile phone verification link > offers "Verify"
  while the phone is not verified` (1,688 passed), with no `.env.local` present, so not the
  VAPID cause in `2026-11-03-partneraccount-verify-test-fails-with-a-local-vapid-key.md`.
  Run alone, the file passed (5 of 5). The #407 branch does not touch partner code.
- **Status:** workaround
- **Refs:** PR #405; `2026-10-31-directory-screens-test-hook-timed-out-locally.md`; `2026-11-03-two-frontend-tests-fail-locally-on-windows.md`.
