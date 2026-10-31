# 2026-10-31: Airtel and Glo customers do not receive verification codes (MTN does)

- **Area:** backend (SMS provider)
- **Author:** nnamdi-security + agent
- **Symptom:** In production, MTN numbers receive the 6-digit code and Airtel
  and Glo numbers do not. The app reported the code as sent.
- **Cause:** (1) App defect, fixed: the code counted as sent as soon as Termii
  answered `"code": "ok"`, which only means accepted for the carrier. Nothing
  read the delivery report, so a message dropped for an Airtel or Glo number
  looked like a success. (2) The reason the carriers drop it is account-level at
  Termii (route, Sender ID, DND) and **could not be proven from the code or
  without the Termii account**. Number format was checked and is correct
  (`234XXXXXXXXXX`). Shortlist to confirm with Termii: `TERMII_CHANNEL` is not
  `dnd`; the `dnd` route is not active for Airtel/Glo; the Sender ID is not
  `active` on every network.
- **Fix / workaround:** The app now stores the delivery status of each code,
  shows "The code did not reach your phone" with a resend, and logs the refusal
  reason without the number or code. Required Termii actions and the diagnostic
  command are in `docs/features/sms.md`, "Delivery to every network". No
  channel was switched.
- **Status:** open until Termii confirms the route and Sender ID for Airtel and
  Glo, and a code reaches an Airtel and a Glo phone.
- **Refs:** `docs/features/sms.md`, `docs/features/phone-verification.md`,
  `docs/api/auth.md`, migration `0023`.
