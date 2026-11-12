# 2026-11-12: Click-through found a dialog cut off on short screens and a stale Edit after a 409

- **Area:** frontend
- **Author:** DevBonavee (+ Claude Code)
- **Symptom:** clicking through the #407 Water sources screen against the real
  backend (`VITE_USE_MOCKS=false`) found two problems the unit and screen tests
  did not catch.
  1. With the new supplier fields, the Edit dialog was taller than a 650 px
     window. The shared `ConfirmDialog` had no maximum height, so its title and
     buttons were off screen and could not be reached (Playwright: "element is
     outside of the viewport" on **Save changes**).
  2. After Activate answered 409 `water_source_kind_required` because another
     admin had cleared the kind, **Edit source** opened Edit from the page's
     stale copy. Kind read "Borehole", **Save changes** stayed disabled, and the
     admin could not set the kind without picking a different one.
- **Cause:** 1. `ConfirmDialog` was written for short confirmations; jsdom has
  no layout, so tests could not see the overflow. 2. The page reused the
  source object it was holding instead of the server's current one.
- **Fix / workaround:** 1. `ConfirmDialog` caps the panel at the screen height
  (`max-h-full`) and only the body scrolls (`min-h-0 overflow-y-auto`), so the
  title and buttons stay in view, checked at 1036 × 647 and 360 × 740. 2. Edit
  source reloads the list (`fetchQuery`, `staleTime: 0`) and opens Edit with the
  fresh source; a screen test now checks Kind reads "Not set yet". Click
  through long dialogs at a short window height, and check what a dialog
  opens from after a 409.
- **Status:** resolved
- **Refs:** #407, `frontend/src/components/ui/ConfirmDialog.tsx`,
  `frontend/src/features/admin/pages/WaterSources.tsx`
