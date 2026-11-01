# Auth contract

Requirements: FR-001, FR-002, FR-003, FR-004, NFR-001, NFR-002 · Acceptance tests: T-07, T-15, T-16

Status: agreed (G3) by @nnamdi-security (frontend and backend owner) on
2026-10-15. Written in S1-01, implemented in S1-02, including rate limiting.
Screens: [docs/design/authentication.md](../design/authentication.md).

**Phone verification (2026-10-17, SRS v0.2 FR-003/FR-004): agreed** by
@Cloudcrackamara (frontend, PR #45 review, 2026-10-18) and @nnamdi-security
(backend and contract owner). Checked against the
[phone verification design](../design/phone-verification.md): every screen
element maps to this contract with no change. That design was approved (G2)
on 2026-10-19; the screens are not built yet.

**Partner amendment (2026-10-26, #47): agreed** by @nnamdi-security
(technical lead, #36). Partner self sign-up and driver phone verification,
from [partners.md](partners.md). See [Changes](#changes).

**Change password (2026-10-26, #8): agreed** by @nnamdi-security
(technical lead, #36), with @chidimmamogbo's decisions, and **built in #56**
([authentication.md](../features/authentication.md)). See
[Change password](#change-password-8).

## Roles

| Role | Who | Can |
| --- | --- | --- |
| `customer` | Households and small businesses | Register, sign in, create orders, read **only their own** orders (FR-001) |
| `admin` | Dispatcher/administrator (SRS treats these as one role) | Read and manage all orders, assign drivers, manage accounts |
| `driver` | Delivery partner | See **only jobs assigned to them**, with only the delivery details needed (FR-001, PRD §4) |

- Roles are enforced on the server for every request. The client never sends a
  role; `POST /auth/register` always creates a `customer`.
- Staff accounts (`admin`, `driver`) are created by the technical lead with a
  command-line tool, not through the API. There is no self-registration for
  staff, with one exception: partners (role `driver`) sign up with
  `POST /auth/partner-register` and start `pending` until an admin approves
  them ([partners.md](partners.md#approval-status)). Admins still
  come only from the command-line tool.
- Inactive accounts cannot sign in, and their existing sessions stop working
  immediately (FR-002).

## Phone verification (FR-003, FR-004)

Replaces the Sprint 1 agreement (manual verification by a dispatcher, orders
allowed before verification), following SRS v0.2:

- Customers register with name, phone and password. `phone_verified` starts as
  `false`.
- The customer verifies the phone with a **6-digit SMS code** before placing
  their first order. `POST /orders` from an unverified customer returns 403
  `phone_not_verified` ([orders.md](orders.md)).
- A code expires **5 minutes** after it is sent and allows **5 attempts**;
  the fifth wrong code voids it. Codes work once. Requesting a new code voids
  the previous one.
- Per phone number: one code per **60 seconds** and **3 per rolling hour**.
  Per IP: 10 code requests per hour and 30 code checks per 15 minutes.
- **Phone change:** the code goes to the **new** number, after the current
  password is checked. The account keeps its number until the new one is
  verified; then the new number becomes the sign-in identifier and is
  verified. Sessions stay signed in.
- Codes are sent by Termii in production and by a mock provider in
  development (codes appear in the backend log). If SMS fails, nothing is
  stored and no verification is claimed (503 `sms_unavailable`).
- Customers and drivers use `POST /auth/phone-verification` and `/verify`;
  a partner verifies the phone before an admin can approve them
  ([partners.md](partners.md#approval-status), decision 9). The
  phone-change endpoints stay customer only. Admins get 403 `forbidden`, and
  drivers get 403 `forbidden` on phone change.

| Method | Path | Auth | Body | Success | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/auth/phone-verification` | customer or driver + CSRF | none | 202 `PhoneCodeSent` | 409 `phone_already_verified`, 429 `too_many_attempts`, 503 `sms_unavailable` |
| POST | `/auth/phone-verification/verify` | customer or driver + CSRF | `{code}` | 200 `User` (`phone_verified: true`) | 400 `verification_code_invalid`, 400 `verification_code_expired`, 422 `validation_error`, 429 `too_many_attempts` |
| POST | `/auth/phone-change` | customer + CSRF | `{phone, password}` | 202 `PhoneCodeSent` (to the new number) | 403 `password_incorrect`, 409 `phone_unchanged`, 409 `phone_already_registered`, 422 `validation_error`, 429 `too_many_attempts`, 503 `sms_unavailable` |
| GET | `/auth/phone-verification/status` | customer or driver | none | 200 `PhoneCodeStatus` | 400 `verification_code_expired` (no usable code) |
| GET | `/auth/phone-change/status` | customer | none | 200 `PhoneCodeStatus` | 400 `verification_code_expired` (no usable code) |
| POST | `/auth/phone-change/verify` | customer + CSRF | `{code}` | 200 `User` (new `phone`, `phone_verified: true`) | 400 `verification_code_invalid`, 400 `verification_code_expired`, 409 `phone_already_registered`, 422 `validation_error`, 429 `too_many_attempts` |

`PhoneCodeSent`:

```json
{
  "phone": "+2348000000001",
  "expires_at": "2026-10-17T09:05:00Z",
  "resend_available_at": "2026-10-17T09:01:00Z",
  "delivery_status": "accepted"
}
```

`delivery_status` (added 2026-10-31, optional for clients, always `accepted`
here) says the SMS provider **took** the message. That is not proof the phone
received it: a number on Nigeria's Do-Not-Disturb list or a network that
refuses the message still shows as accepted. The two status endpoints read the
provider's delivery report:

```json
{
  "delivery_status": "failed",
  "expires_at": "2026-10-17T09:05:00Z",
  "resend_available_at": "2026-10-17T09:01:00Z"
}
```

- `delivery_status`: `accepted` (handed to the carrier, no report yet),
  `delivered` (the carrier reported it reached the handset) or `failed` (the
  carrier or provider reported it did not arrive: DND, rejected, expired or
  failed). An unreadable or missing report stays `accepted`, never `delivered`.
- The client polls about every 5 seconds while `accepted`; the server asks the
  provider at most every 3 seconds per code. On `failed` the client says the
  code did not reach the phone and offers "Send a new code".
- A failed delivery changes no limit: the 60-second cooldown, 3 codes per hour,
  5-minute expiry and 5 attempts all stand (FR-003).
- A failure to hand the message over is still 503 `sms_unavailable`, with the
  same customer message whatever the cause. The cause (Sender ID, route not
  enabled, empty wallet, account) is logged for operators only
  (`reason=...`), never returned.

- `code` is exactly 6 digits; surrounding spaces are trimmed. Anything else is
  422 `validation_error` with `loc` `["body", "code"]`.
- `verification_code_invalid` has `details: {"attempts_remaining": n}`; at 0
  the code is void and the customer must request a new one.
- `verification_code_expired` covers every "no usable code" case: never
  requested, expired, replaced by a newer code, attempts used up, or already
  used. The client shows one "request a new code" message.
- 429 `too_many_attempts` has `Retry-After` and
  `details: {"retry_after_seconds": n}`, as for sign-in. For the 60-second
  cooldown the client can also use `resend_available_at`.
- `password_incorrect` is 403, not 401: the session is still valid. Wrong
  passwords count against the sign-in failure limits for the account's phone.

## Identifier and password rules

- Everyone signs in with **phone number + password**.
- Phone: Nigerian mobile number. Accepted inputs `08000000001`,
  `2348000000001`, `+2348000000001` (spaces and dashes ignored). Stored and
  returned as `+234` followed by 10 digits starting with 7, 8 or 9.
- Password: 8–128 characters. No composition rules (NIST SP 800-63B). Stored
  only as a salted scrypt hash.

## Sessions

| Property | Value |
| --- | --- |
| Cookie name | `mmirioma_session` |
| Contents | Random opaque token (not the user ID); only its keyed hash is stored |
| Flags | `HttpOnly`; `Secure` (configurable, forced on in production); `SameSite=Lax` (configurable); `Path=/` |
| Lifetime | Absolute, `SESSION_MAX_AGE_SECONDS` (default 7 days). No sliding renewal |
| Revocation | Server-side: logout, account deactivation; a password change ends every other session of the account (#8) |

A new session is created at every login and registration. Old sessions are not
reused.

## CSRF

Login, registration and `GET /auth/me` return a `csrf_token` tied to the
session. Every `POST`/`PUT`/`PATCH`/`DELETE` made with a session must send it:

```
X-CSRF-Token: <csrf_token>
```

A missing or wrong token returns 403 `csrf_failed`. `POST /auth/login` and
`POST /auth/register` are exempt because they start a session. The frontend
keeps the token in memory and re-reads it from `GET /auth/me` after a page load.

## User object

```json
{
  "id": "0b8f1c5e-2a7d-4d3e-9a51-6f0c2b7e9d14",
  "name": "Sample Customer",
  "phone": "+2348000000001",
  "role": "customer",
  "phone_verified": false
}
```

Only the signed-in user's own object is returned by these endpoints.

## Endpoints

| Method | Path | Auth | Body | Success | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/auth/register` | none | `{name, phone, password}` | 201 `Session` + cookie | 409 `phone_already_registered`, 422 `validation_error`, 429 `too_many_attempts` |
| POST | `/auth/partner-register` | none | see [partners.md](partners.md#post-authpartner-register) | 201 `Session` + cookie, role `driver` | 409 `phone_already_registered`, 422 `validation_error`, 429 `too_many_attempts` (shares the registration limit) |
| POST | `/auth/login` | none | `{phone, password}` | 200 `Session` + cookie | 401 `invalid_credentials`, 422 `validation_error`, 429 `too_many_attempts` |
| POST | `/auth/logout` | session + CSRF | none | 204, cookie cleared | 401 `not_authenticated`, 403 `csrf_failed` |
| GET | `/auth/me` | session | none | 200 `Session` | 401 `not_authenticated` |

`Session` response body:

```json
{ "user": { "...": "User object" }, "csrf_token": "q3V1...", "expires_at": "2026-10-21T09:30:00Z" }
```

### Behavior notes

- `invalid_credentials` is returned for a wrong password, an unknown phone and an
  inactive account alike, so login does not reveal which accounts exist.
- `phone_already_registered` does reveal that a phone is registered. This is
  accepted for usability; the per-IP registration limit below is the mitigation.
- **Rate limits (NFR-002).** 429 `too_many_attempts` comes with a `Retry-After`
  header (seconds) and `details: {"retry_after_seconds": n}`:
  - login: 5 failed attempts per phone and 50 per IP within 15 minutes. While a
    phone is limited, even the correct password gets 429. A successful login
    clears that phone's count.
  - registration: 20 attempts per IP per hour, whatever the outcome.
  The UI should show the wait and keep the entered phone number (NFR-012).
- `name` is trimmed, 1–100 characters.

Examples: [examples/auth-session.json](examples/auth-session.json),
[examples/error-invalid-credentials.json](examples/error-invalid-credentials.json).

## Change password (#8)

The fork's Change password screen (`/profile/password` for customers, and the
same screen in the partner and admin apps) had no endpoint. Agreed in #8, built in #56:

| Method | Path | Auth | Body | Success | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/auth/password` | session + CSRF, any role | `{current_password, new_password}` | 204 | 401 `not_authenticated`, 403 `csrf_failed`, 403 `password_incorrect`, 422 `validation_error`, 429 `too_many_attempts` |

Request ([examples/change-password-request.json](examples/change-password-request.json)):

```json
{ "current_password": "sample-current-password", "new_password": "sample-new-password" }
```

Rules:

- `current_password` must be the account's password. A wrong one is 403
  `password_incorrect` (not 401: the session is still valid), as for
  `POST /auth/phone-change`, and counts against the **sign-in failure
  limits** for the account's phone (5 per 15 minutes). While that phone is
  limited, even the right password gets 429 `too_many_attempts`, so this
  endpoint cannot be used to guess passwords faster than login
  (NFR-002). Example:
  [examples/error-password-incorrect.json](examples/error-password-incorrect.json).
- `new_password` follows the [password rules](#identifier-and-password-rules)
  (8-128 characters, no composition rules); otherwise 422 `validation_error`
  with `loc` `["body", "new_password"]`. It is stored only as a salted scrypt
  hash. Whether it may equal the current one is not checked (no SRS rule).
- **Other sessions end** (decided by @chidimmamogbo, 2026-10-26): on success,
  every other session of the account is revoked server-side
  (`user_sessions`); this session stays signed in and keeps its CSRF token.
  A device signed in with a leaked password is signed out.
- An audit row (NFR-004) records `password_changed` with the actor and no
  password, hash or session data.
- Confirming the new password ("New password again") is done on the screen
  only; the server receives it once.
- No SMS or email is sent about the change (no email provider; FR-050 lists
  no such message).

Frontend note: the mock (`mockChangePassword`) answers 400
`invalid_current_password`; the link issue changes it to 403
`password_incorrect`, as here.

## Planned (not in Sprint 1)

- Dispatcher-controlled manual verification as a fallback when SMS is
  unavailable (FR-003 allows it; it needs the written procedure first).
- Admin activates or deactivates accounts through the API (FR-002). Sprint 1
  uses the command-line tool.
- Rate limiting of quote and order endpoints (NFR-002). Code endpoints are
  limited as described above.

## Open questions

1. The written manual phone-verification procedure, needed only for the
   fallback above. Automated SMS verification replaces it as the normal path
   (SRS v0.2).
2. ~~Customer screens for entering a code and changing a phone~~: built in
   the fork in #6 (PR #52,
   [phone-verification.md](../design/phone-verification.md)).
3. Password reset when the password is forgotten. Not proposed in #8: it
   needs an SMS reset code flow and its limits. The screen
   (`/forgot-password`) tells people to call the support number.

## Changes

| Date | Change | Agreed by |
| --- | --- | --- |
| 2026-10-31 | Additive: `delivery_status` on `PhoneCodeSent`, and `GET /auth/phone-verification/status` and `GET /auth/phone-change/status` (Termii delivery reports). No existing field, status or error code changes | Proposed in the `fix/termii-otp-and-driver-area` branch; needs one reviewer's agreement in the PR |
| 2026-10-26 | Change password (#8): `POST /auth/password`; a change ends the account's other sessions | @nnamdi-security (technical lead, #36), with @chidimmamogbo's decisions on #8 |
| 2026-10-26 | Partner amendment (#47, [partners.md](partners.md)): partners sign up with `POST /auth/partner-register`, the one exception to "no self-registration for staff"; drivers may use the phone-verification endpoints (not phone change); admins still come only from the command-line tool | @nnamdi-security (technical lead, #36), with @chidimmamogbo's decisions on #47 |
| 2026-10-17 | Phone verification (SRS v0.2 FR-003, FR-004) | @Cloudcrackamara (2026-10-18), @nnamdi-security |
| 2026-10-15 | Agreed (G3), S1-01 | @nnamdi-security |
