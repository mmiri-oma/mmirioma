# 2026-11-02: MarketingHeader test failed with "No QueryClient set"

- **Area:** frontend
- **Author:** Oluwaseyi Oyewunmi (+ agent)
- **Symptom:** `marketing.test.tsx > MarketingHeader > opens the mobile menu ...`
  failed with `Error: No QueryClient set, use QueryClientProvider to set one`.
- **Cause:** The redesigned header shows the support phone from
  `useSupportContact()` (TanStack Query), and the test rendered the header
  with only a router.
- **Fix / workaround:** Render it inside `AppProviders` in the test, like the
  route tests do.
- **Status:** resolved
- **Refs:** `frontend/src/features/marketing/marketing.test.tsx`, `MarketingParts.tsx`.
