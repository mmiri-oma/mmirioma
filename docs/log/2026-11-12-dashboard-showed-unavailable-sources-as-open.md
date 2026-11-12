# 2026-11-12: Dashboard and live map showed unavailable and kind-less sources as open

- **Area:** backend
- **Author:** DevBonavee (+ Claude Code)
- **Symptom:** in review of PR #420, @nnamdi-security found that
  `sources.service.source_usability` returned `True` for an activated,
  unexpired source with `is_available = false` or `kind = null`, although
  #407 excludes both from every new order. `GET /admin/dashboard` counted them
  as usable and `GET /admin/live-map` showed them open
  (`frontend/src/features/admin/real/operations.ts`).
- **Cause:** #407 added the source-wide exclusions to the order-fit check
  (quotes, acceptance, C1, confirmation) but not to the older usability helper,
  which still applied only the four FR-012 safety reasons. No test covered the
  helper with the new fields.
- **Fix / workaround:** new pure `is_source_usable`: no `source_wide_reasons`
  and at least one activation passing `eligibility_reasons`; `source_usability`
  uses it. R2's four-value enum is unchanged. Regressions: a parametrized unit
  test (eligible, unavailable, no kind, expired, suspended, revoked, none) and
  an integration test of the live map and dashboard. When adding an exclusion,
  search every caller of `eligibility_reasons` for other places that decide
  "usable".
- **Status:** resolved
- **Refs:** #407, PR #420 review, `backend/app/modules/sources/service.py`
