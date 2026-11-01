# Admin driver directory

Requirements: FR-001, FR-002, FR-003, FR-013, FR-031, BR-03, NFR-003, NFR-004
· Contract: [admin-directory.md](../api/admin-directory.md#drivers), "Drivers"
(agreed, G3, 2026-10-28, #43) · Issue: #45 (the drivers part) · Related:
[partners.md](../api/partners.md) (the approval status and the partner's own
profile), [admin-dispatch.md](admin-dispatch.md) (assignments and the withdraw)

## 1. Overview and purpose

A partner who signs up (`POST /auth/partner-register`) starts **pending**: they
can sign in but cannot go online or be offered jobs. Staff need a place to find
partners, check the vehicle in person, and approve, suspend or deactivate them.
This feature adds four admin endpoints under `/api/v1/admin/drivers`: the
list, one driver's detail, approve or suspend (`approval`), and activate or
deactivate (`activation`). It lets the admin Riders screen leave its mock
(linked in a later issue, lane D).

The design says "rider" (Keke) and "driver" (Tanker), together "partner"; the
server role is `driver` for both. Staff do **not** create driver accounts
(decided 2026-10-26): partners sign themselves up, so there is no create
endpoint.

## 2. Feature workflow

1. A dispatcher opens the Riders page. The page asks for the list
   (`GET /admin/drivers`) by name, with pills for Keke, Tanker, Pending and
   Suspended and counts over every driver.
2. For a pending partner the dispatcher checks the vehicle, plate and papers in
   person, then approves with the verified vehicle: its description, safe
   payload in litres and the transfer methods (`POST .../approval`). The
   partner gets an in-app `account` message and can go online themselves.
3. To stop a partner working, suspend them (`approval`, a reason is required).
   To stop them signing in at all, deactivate them (`activation`, a reason is
   required). Both take back a job that was only offered, and both are refused
   while the partner holds an accepted job.

## 3. Important files and their responsibilities

| File | Responsibility |
| --- | --- |
| `backend/app/modules/partners/directory.py` | The queries and the rules: search, counts, approval with the vehicle, activation, the audit rows and the notification |
| `backend/app/modules/partners/admin_directory_router.py` | The four endpoints; translates between HTTP and the service |
| `backend/app/modules/partners/admin_directory_schemas.py` | Query and body validation, and the response objects |
| `backend/app/modules/partners/schemas.py` | `partner_vehicle_read`, the one vehicle object the partner's own profile and this directory both return |
| `backend/app/modules/dispatch/service.py` | `live_assignment_of_driver` and `job_counts_by_driver`; the existing `withdraw_assignment` takes back an offered job |
| `backend/app/api/v1/router.py` | Registers the router |
| `backend/tests/test_admin_drivers_api.py` | Roles, CSRF, query and body rules, and the bodies against the contract examples (no database) |
| `backend/tests/test_admin_drivers_integration.py` | The queries, rules, audit rows and notifications against a real database |

## 4. Database models and relationships

No new table, column or migration (`alembic check` is clean). The feature
reads `users` (role `driver`), `driver_profiles`, `vehicle_profiles`,
`driver_service_zones`, `service_zones` and `assignments`, and writes
`driver_profiles` (approval status, availability, transfer methods, the link to
the vehicle profile), `vehicle_profiles`, `users.is_active`, `notifications`
and `audit_logs`. `delivery_type` stays on `driver_profiles` (decided
2026-10-28): every driver has a profile and a pending partner has no vehicle
profile yet.

## 5. API endpoints and request/response behavior

| Method | Path | Success | Errors |
| --- | --- | --- | --- |
| GET | `/admin/drivers` | 200 `AdminDriverPage` | 401, 403, 422 `validation_error` |
| GET | `/admin/drivers/{id}` | 200 `AdminDriver` | 401, 403, 404 `driver_not_found` |
| POST | `/admin/drivers/{id}/approval` | 200 `AdminDriver` | 401, 403 (`forbidden`, `csrf_failed`), 404 `driver_not_found`, 409 `driver_inactive`, 409 `partner_phone_not_verified`, 409 `driver_has_accepted_job`, 422 `validation_error` |
| POST | `/admin/drivers/{id}/activation` | 200 `AdminDriver` | 401, 403, 404 `driver_not_found`, 409 `driver_has_accepted_job`, 422 `validation_error` |

- **List:** filters `delivery_type`, `approval_status`, `is_active`, `q`
  (trimmed, 1-100 characters), `limit` (1-100, default 50) and `offset`. The page
  has `items`, `total`, `limit`, `offset` and `counts` (`all`, `keke`, `tanker`,
  `pending`, `inactive`, `available`) over every driver, ignoring the filters.
- **Approval body:** `approval_status` (`approved` or `suspended`, never
  `pending`), `reason` (required, 5-500 characters, to suspend; optional to
  approve) and `vehicle` (`description` 1-50, `safe_payload_litres` 1-100,000,
  `transfer_methods` of `ground` and `overhead`, each once). Unknown fields are
  refused.
- **Activation body:** `is_active` and `reason` (required, 5-500 characters, to
  deactivate; optional to activate).
- Each write returns the whole driver.

Examples: [admin-drivers-page.json](../api/examples/admin-drivers-page.json),
[admin-driver-approval-request.json](../api/examples/admin-driver-approval-request.json),
[admin-driver-suspension-request.json](../api/examples/admin-driver-suspension-request.json),
[admin-driver-activation-request.json](../api/examples/admin-driver-activation-request.json),
[error-partner-phone-not-verified.json](../api/examples/error-partner-phone-not-verified.json).
The API tests check each response body equals its example.

## 6. Important business rules

- **Approval is not activation** (FR-002). Approval says whether the partner may
  work; activation says whether the account can sign in. Activating a driver
  changes neither their availability nor their approval status, so only an
  `approved` partner can be offered work again.
- **Approving** needs an active account (409 `driver_inactive`) and a verified
  phone (409 `partner_phone_not_verified`, FR-003), and the vehicle the
  administrator checked in person (FR-013): required for a partner with no
  verified vehicle yet (422 `validation_error`, `loc` `["body", "vehicle"]`),
  optional otherwise, and then it replaces the verified fields. The
  declared plate and capacity are the partner's own and never change.
  Approving never turns availability on: the partner goes online themselves.
- **The vehicle profile.** The server creates a vehicle profile, or updates the
  one linked to this driver, links it and stores the transfer methods on the
  driver profile. A vehicle profile also linked to **another** driver (the
  command-line tool can share one) is never changed for one driver; a new
  profile is created for this one instead (BR-03: dispatch reads only the
  verified payload).
- **Suspending** turns availability off at once, and needs a reason. A partner
  can go from `suspended` back to `approved` with no new vehicle when a
  verified one is linked.
- **A job is never stranded.** Suspending or deactivating takes back a job that
  was only `offered` the way the dispatcher's withdraw does (the order returns
  to `confirmed`, reason `reassigned`, the partner is told). An `accepted` job
  is not touched and the change is refused with 409 `driver_has_accepted_job`;
  let it end first (open question 12, decided).
- **Repeats are harmless.** Asking for the state the partner is already in, with
  no `vehicle`, returns them unchanged and writes no audit row or message. This
  check comes first, so it also answers 200 for a deactivated account asking
  for the state it already has.
- **The partner is told** of a status change by an in-app `account` message
  ("Your account was approved" or "Your account was suspended"). The staff
  reason is an internal note and is not copied into it. A vehicle correction with
  the same status sends nothing.
- **Audit (NFR-004).** `driver_approved`, `driver_suspended`, `driver_activated`
  and `driver_deactivated` name the administrator and the driver's account;
  `details` holds the reason and, when a vehicle was recorded, its profile id,
  payload and transfer methods. Never a phone or a plate.
- **Counts.** `available` uses the dashboard's definition (active, approved and
  available) so the header and the dashboard agree. `pending` counts active
  accounts only. `live_jobs` and `completed_jobs` count `offered` or
  `accepted` and `completed` assignments. `delivered_jobs` counts the
  `completed` assignments whose order is `delivered`: a failed or cancelled
  job also ends `completed`, so only `delivered_jobs` is the Riders page's
  "Trips" (#275, `job_counts_by_driver` in `dispatch/service.py`, one join on
  the order).
- **Search.** `q` matches a part of the name, the vehicle type (the verified
  description, or the declared kind `keke` or `tanker`, so a pending partner is
  found) and, with 4 or more digits, the phone in `+234…` or `0…` form.

## 7. Authentication and authorization requirements

Every endpoint needs a signed-in, active `admin` (`CurrentAdmin`); customers
and drivers get 403 `forbidden` (FR-001), signed-out callers 401
`not_authenticated`. Both `POST` endpoints also need the `X-CSRF-Token` header
(403 `csrf_failed`). Responses carry phones, which only staff may see (NFR-003).
A deactivated account's sessions stop working because the auth layer checks
`users.is_active` on every request.

## 8. Error handling and edge cases

- A malformed id, a bad filter, a blank or over-long `q`, a body the rules
  refuse (a reason that is too short, a vehicle with a suspension, a duplicate
  transfer method, a payload outside 1-100,000) is 422 `validation_error` and
  nothing is called or saved.
- The Riders panel checks a suspension's reason itself (trimmed, at least 5
  characters) when "Suspend rider" is pressed, and shows the message under the
  box without opening the confirm sheet; the server still checks it. A
  reactivation's reason is optional, so it is not checked. The box is emptied
  once an action is saved, so the next one (suspend, then reactivate) starts
  with no text (#294).
- Every refusal rolls back: no status, vehicle, audit row or message is left
  behind (the integration tests check each).
- Two administrators acting on one driver at once are serialized by a row lock
  on the account and profile. An offer the driver accepts between the check
  and the withdraw is reported as `driver_has_accepted_job`.
- An id that belongs to a customer or an admin is 404 `driver_not_found`.

## 9. Testing instructions

```bash
cd backend
.venv/bin/pytest tests/test_admin_drivers_api.py            # no database
# With a migrated throwaway database (never the dev one):
TEST_DATABASE_URL=postgresql+asyncpg://... .venv/bin/pytest tests/test_admin_drivers_integration.py
.venv/bin/ruff check . && .venv/bin/ruff format --check .
```

## 10. Known limitations

- A driver account with **no dispatch profile** is not listed and answers 404
  `driver_not_found`, so it cannot be activated or deactivated here. Such an
  account cannot work anyway (dispatch answers `no_driver_profile`).
- No push or SMS to the partner: only the in-app `account` message
  ([partners.md](../api/partners.md#notifications)).
- Changing a partner's zones, name or phone is not in the contract.
- The staff reason is stored in the audit log only; the partner is not shown it.
- **Frontend (#220):** the Riders page reads these endpoints in real-API mode
  (`frontend/src/lib/api/adminDirectory.ts`, `features/admin/real/directory.ts`,
  mapping in `docs/architecture/api-mapping.md`, "Admin customers and drivers"). It
  lists active accounts only, so a deactivated account is never shown as
  "suspended": opened by its link it is an error ("This account is deactivated.").
  It has no fleet code, "Today", rating, payout due, documents or reported issues
  (no source). Approving a partner with no verified vehicle collects it (vehicle,
  safe payload in litres, transfer method) with what the partner declared shown as
  a claim; a suspended partner who already has one is approved with nothing extra.
  Suspending asks for a reason, and a refused field shows the server's words under
  it. The "Suspended" pill has no count (the server has none). Tests:
  `features/admin/directory.screens.test.tsx`.
- The phone and vehicle-type search is a substring match without an index, which
  is fine for the pilot's number of partners.
