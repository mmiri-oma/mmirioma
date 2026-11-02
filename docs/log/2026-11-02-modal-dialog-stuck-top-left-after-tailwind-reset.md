# 2026-11-02: Modal dialog showed in the top-left corner instead of centred

- **Area:** frontend
- **Author:** Oluwaseyi Oyewunmi (+ agent)
- **Symptom:** The landing page's "Do we deliver to you?" pop-up (a native
  `<dialog>` opened with `showModal()`) appeared in the top-left corner.
- **Cause:** Tailwind's preflight sets `margin: 0` on every element, which
  removes the browser's `margin: auto` that centres a modal dialog.
- **Fix / workaround:** Set `margin: auto` on the dialog's own class
  (`.wl-area-dialog` in `waterline.css`); Tailwind dialogs use `m-auto`.
- **Status:** resolved
- **Refs:** `frontend/src/features/marketing/landing/AreaCheckDialog.tsx`, `waterline.css`.
