# 2026-11-02: Zones query added twice to the order address step

- **Area:** frontend
- **Author:** Oluwaseyi Oyewunmi (+ agent)
- **Symptom:** `tsc -b` failed with `error TS2451: Cannot redeclare block-scoped variable 'zones'`
  in `DeliveryDetails.tsx` after wiring "Use my location".
- **Cause:** The screen already called `useServiceZones()` (for "areas
  ready"); the same line was added again for the location match.
- **Fix / workaround:** Removed the second line and reused `zones`. Check
  what a screen already loads before adding a query.
- **Status:** resolved
- **Refs:** `frontend/src/features/customer/pages/order/DeliveryDetails.tsx`.
