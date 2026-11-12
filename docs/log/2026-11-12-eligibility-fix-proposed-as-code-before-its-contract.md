# 2026-11-12: Eligibility fix proposed as code before its contract

- **Area:** process
- **Author:** Cloudcrackamara + Claude Code
- **Symptom:** While #411 (DSP-02) was blocked on #407, #408 and #410, the
  agent proposed fixing two known defects in `eligibility_problems`
  (`backend/app/modules/dispatch/service.py`) straight away, as "safe now":
  the missing service-zone check and the missing transfer-method check
  (FR-031). No code was written; the mistake was found when the issue was
  loaded with `/work-issue 411`.
- **Cause:** Each new check adds a value to `details.reasons` of
  `driver_not_eligible`. That is a change to an agreed contract
  (`docs/api/deliveries.md`, "Driver eligibility", which says zones and
  transfer methods are not checked), so it needs G3 first. It would also have
  repeated a recorded problem: `frontend/src/lib/api/adminDispatch.ts` parses
  `reasons` with a closed `z.enum`, so an unknown reason makes the driver list
  fail as `invalid_response`
  (`2026-10-26-new-eligibility-reason-breaks-the-admin-dispatch-client.md`).
  The log was searched only after the proposal was made.
- **Fix / workaround:** The groundwork became a contract-only pull request:
  the proposed section "Automatic dispatch and reassignment (#411)" in
  `docs/api/deliveries.md`, which names the two new reasons and requires the
  client change in the same pull request as the backend. Before calling a
  backend fix "safe", check whether it changes a value a contract lists, and
  search `docs/log/` first.
- **Status:** resolved
- **Refs:** #411, `docs/api/deliveries.md`, `docs/api/orders.md`,
  `docs/api/admin-operations.md`.
