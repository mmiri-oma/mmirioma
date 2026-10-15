# Auth contract

Requirements: FR-001, FR-002, FR-003, NFR-001, NFR-002 · Acceptance tests: T-07

Status: agreed (G3) by @nnamdi-security (frontend and backend owner) on
2026-10-15. Written in S1-01, implemented in S1-02, including rate limiting.
Screens: [docs/design/authentication.md](../design/authentication.md).

## Roles

| Role | Who | Can |
| --- | --- | --- |
| `customer` | Households and small businesses | Register, sign in, create orders, read **only their own** orders (FR-001) |
| `admin` | Dispatcher/administrator (SRS treats these as one role) | Read and manage all orders, assign drivers, manage accounts |
| `driver` | Delivery partner | See **only jobs assigned to them**, with only the delivery details needed (FR-001, PRD §4) |

- Roles are enforced on the server for every request. The client never sends a
  role; registration always creates a `customer`.
- Staff accounts (`admin`, `driver`) are created by the technical lead with a
  command-line tool, not through the API. There is no self-registration for staff.
- Inactive accounts cannot sign in, and their existing sessions stop working
  immediately (FR-002).

## Customer contact verification (FR-003)

Agreed for Sprint 1 (resolves SRS §12.4 / PRD §13.5 for the pilot):

- Customers register with name, phone and password. `phone_verified` starts as
  `false`.
- A dispatcher confirms possession of the phone using a documented manual pilot
  procedure. No automated OTP exists; the UI must not claim automated
  verification.
- A customer with an unverified phone **can** create an order, but a dispatcher
  **cannot confirm** it until the phone is verified (FR-003). The verification
  endpoint is a later issue; until then `phone_verified` is always `false` for
  customers.

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
| Revocation | Server-side: logout, account deactivation |

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

## Planned (not in Sprint 1)

- Dispatcher marks a customer phone as verified (FR-003).
- Admin activates or deactivates accounts through the API (FR-002). Sprint 1
  uses the command-line tool.
- Rate limiting of quote, OTP and order endpoints (NFR-002).

## Open questions

1. The written manual phone-verification procedure (who checks, how, what is
   recorded). Needed before the first real order is confirmed.
