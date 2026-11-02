# 2026-11-02: React hooks lint rejected refs from a hook object and setState in an effect

- **Area:** frontend
- **Author:** Oluwaseyi Oyewunmi (+ agent)
- **Symptom:** `npm run lint` failed with
  `Error: Cannot access refs during render` (react-hooks/refs) on
  `<div ref={road.ref} className={cx('wl-road', road.play && 'wl-play')}>`,
  `Error: Calling setState synchronously within an effect can trigger cascading renders`
  in `CookieConsent.tsx`, and `react-refresh/only-export-components` for
  helper functions exported from component files.
- **Cause:** eslint-plugin-react-hooks 7 treats any property read on an
  object that holds a ref as reading the ref during render. Resetting form
  state from an effect when the banner reopened is the cascading-render
  pattern the rule forbids. Fast Refresh needs component files to export
  only components.
- **Fix / workaround:** Return refs from custom hooks as a tuple
  (`const [roadRef, roadPlay] = usePlayOnView()`); reset state by giving the
  panel a new `key` instead of an effect; move pure helpers to
  `landing/logic.ts`.
- **Status:** resolved
- **Refs:** `frontend/src/features/marketing/Landing.tsx`, `CookieConsent.tsx`, `landing/logic.ts`.
