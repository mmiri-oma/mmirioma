# Partner accounts: sign-up, profile, going online, notifications

Requirements: FR-001, FR-002, FR-003, FR-013, FR-031, FR-032, FR-050,
NFR-002, NFR-004 · Contract: [partners.md](../api/partners.md) and its
[auth.md](../api/auth.md) amendment (agreed 2026-10-26, #47) · Issue: #61 ·
Related: [driver-assignment.md](driver-assignment.md),
[service-zones.md](service-zones.md), [partner-app.md](partner-app.md)

## 1. Overview and purpose

Keke riders and tanker drivers share one server role, `driver`. Until now a
driver account existed only if the technical lead made one with the
command-line tool. This feature lets a partner sign up in the app, see their
own profile, change two preferences, go online or offline, and read the
messages the server leaves them.

A partner who signs up is **pending**: they can sign in, but they cannot go
online and no job is offered to them until an admin approves them. The admin
approval endpoint is not part of this feature; it is in the admin driver
directory ([admin-drivers.md](admin-drivers.md), #45).

## 2. Feature workflow

1. The partner signs up (`POST /auth/partner-register`) with a name, phone,
   password (the new-password rule, [authentication.md](authentication.md)),
   the 18+ and Terms acceptance, Keke or tanker, plate, a tanker's capacity in gallons, and a
   service zone from `GET /service-zones`. The server creates the account
   and a driver profile in one transaction, `pending` and offline, and signs
   them in.
2. The partner verifies their phone with the existing SMS code endpoints
   (`/auth/phone-verification`, `/verify`), which now accept drivers. An
   admin can approve a partner only with a verified phone
   ([admin-drivers.md](admin-drivers.md)).
3. An admin checks the vehicle and papers in person and approves the partner
   (`POST /admin/drivers/{id}/approval`, [admin-drivers.md](admin-drivers.md)),
   linking a vehicle profile with the verified safe payload and setting the
   transfer methods.
4. The approved partner goes online (`PUT /driver/availability`). Dispatch
   can now offer them jobs.
5. Each offer, withdraw or cancellation of a job the partner held leaves an
   in-app message, read with `GET /driver/notifications` and marked read with
   `POST /driver/notifications/read`.

Drivers set up with the command-line tool skip steps 1 to 3: the migration
marked existing ones `approved`, and `set-driver` creates new ones
`approved`, since the technical lead checked them first.

## 3. Important files

| File | Responsibility |
| --- | --- |
| `backend/app/modules/partners/schemas.py` | Request and response bodies; the sign-up field rules |
| `backend/app/modules/partners/service.py` | Sign-up, profile, preferences, availability; audit rows |
| `backend/app/modules/partners/router.py` | `/driver/profile`, `/driver/availability`, `/driver/notifications` |
| `backend/app/modules/auth/router.py` | `POST /auth/partner-register`; drivers on the two phone-verification endpoints |
| `backend/app/modules/auth/dependencies.py` | `CurrentCustomerOrDriver` |
| `backend/app/modules/notifications/` | The `notifications` table, its service (add, list, mark read) and the notification bodies shared with customers (`schemas.py`); see [notifications.md](notifications.md) |
| `backend/app/modules/dispatch/models.py` | `ApprovalStatus`, `DeliveryType`, `TransferMethod`, the new `DriverProfile` columns, `DriverServiceZone` |
| `backend/app/modules/dispatch/service.py` | The `not_approved` reason; the `assigned` and `reassigned` messages |
| `backend/app/modules/dispatch/plates.py` | The plate rule, shared by sign-up and the command-line tool |
| `backend/app/modules/dispatch/cli.py` | `set-driver --delivery-type --plate`; `list-drivers` shows approval |
| `backend/app/modules/deliveries/holds.py` | The `reassigned` message when an admin cancels a held job |
| `backend/alembic/versions/20261026_0016_add_partner_accounts.py` | The migration |

## 4. Database models and relationships

- `driver_profiles` (one per `driver` account) gains:
  - `approval_status`: `pending`, `approved` or `suspended`. Existing rows
    were backfilled `approved`.
  - The declared vehicle: `delivery_type` (`keke`, `tanker`), `plate` (4 to
    15 characters) and `declared_capacity_gallons` (500 to 20,000). All
    nullable, because drivers created earlier have none.
  - `transfer_methods`: a list of `ground` and `overhead`, empty until an
    admin sets it.
  - `new_order_alerts` and `sms_updates`, both true by default.
  - `vehicle_profile_id` is now nullable: a pending partner has no verified
    vehicle.
- `driver_service_zones`: `driver_profile_id` and `zone_id`, unique
  together. The sign-up zone is the partner's first row. Rows go with the
  profile; a zone with drivers cannot be deleted (zones are switched off,
  never deleted).
- `notifications`: `user_id`, optional `order_id`, `channel` (`in_app`
  only), `kind`, `title`, `body`, `read_at`. Rows go with their user and
  order. The customer app (#48) will use the same table.

CHECK constraints guard every enum, the plate length, the capacity range and
the transfer method values.

## 5. API endpoints and request/response behavior

Paths are under `/api/v1`. Bodies and examples are in
[partners.md](../api/partners.md) and `docs/api/examples/partner-*.json`.

| Method | Path | Auth | Success |
| --- | --- | --- | --- |
| POST | `/auth/partner-register` | none | 201 `Session` + cookie, role `driver` |
| GET | `/driver/profile` | driver | 200 `PartnerProfileRead` |
| PATCH | `/driver/profile` | driver + CSRF | 200 `PartnerProfileRead` (preferences only) |
| PUT | `/driver/availability` | driver + CSRF | 200 `PartnerProfileRead` |
| GET | `/driver/notifications` | driver | 200 page with `unread_count`, newest first |
| POST | `/driver/notifications/read` | driver + CSRF | 204 |
| POST | `/auth/phone-verification`, `/verify` | customer or driver + CSRF | as before ([phone-verification.md](phone-verification.md)) |

`PartnerProfileRead.vehicle.description` and `safe_payload_litres` come from
the verified vehicle profile and are `null` until an admin links one.
`declared_capacity_litres` is `declared_capacity_gallons × 4`.
`partner_since` is the Lagos date the account was created.

## 6. Important business rules

- **Approval** (partners.md, decision 1; FR-002 has only activation): a
  pending or suspended partner can sign in but cannot go online (403
  `partner_not_approved`) and is never offered a job. Dispatch reports
  `not_approved`. A deactivated account (`is_active = false`) cannot sign in
  at all.
- **Declared, not verified** (FR-013, BR-03): the gallons a tanker driver
  types are stored as a declaration. Dispatch only reads the vehicle
  profile's verified `safe_payload_litres`. A profile without a vehicle
  profile gets `no_driver_profile` in dispatch.
- **Plate** (decision 3): trimmed, upper-cased, then 4 to 15 letters,
  digits, spaces or hyphens. No check of the Nigerian format.
- **Preferences** (decision 5) are stored only: no partner SMS, push or email
  is sent yet. There is no partner email in the pilot.
- **Messages** (FR-050): `assigned` when an admin offers a job, `reassigned`
  when an admin withdraws or cancels a job the partner held. They are written
  in the same transaction as the change and never change an order's status.
  The text never contains a delivery code or the customer's details. The
  contract's `account` kind is written by the admin approval endpoint when a
  partner's status changes ([admin-drivers.md](admin-drivers.md)); the others
  are not created yet (see the contract).
- **Audit** (NFR-004): `partner_registered` at sign-up;
  `driver_went_online` and `driver_went_offline` when availability changes.

## 7. Authentication and authorization requirements

- Sign-up needs no session and no CSRF token, like `POST /auth/register`,
  and shares its limit of 20 attempts per IP per hour (NFR-002).
- Every `/driver/...` endpoint is for the `driver` role only; customers and
  admins get 403 `forbidden` (FR-001). Unsafe methods need the CSRF header.
- A partner only reads and changes their own profile and messages. Marking
  read ignores ids that belong to someone else, so nothing can be probed.
- Drivers may now use the two phone-verification endpoints; phone change
  stays customer only, and admins get 403.

## 8. Error handling and edge cases

| Status | `code` | When |
| --- | --- | --- |
| 409 | `phone_already_registered` | Sign-up with a phone that has an account; nothing is created |
| 422 | `validation_error` | Any sign-up field rule (`loc` names it), an unknown or inactive `service_zone_id`, an unknown field (including `email`), a non-boolean preference or `is_available`, more than 100 `ids` |
| 429 | `too_many_attempts` | The registration limit |
| 403 | `partner_not_approved` | Going online while pending or suspended |
| 404 | `no_driver_profile` | A driver account with no driver profile (command-line drivers not set up yet) |

Edge cases:

- Setting the availability it already has changes nothing and writes no
  audit row.
- Going offline never touches a job the partner holds.
- Drivers created before this feature show `delivery_type` and `plate` as
  `null` until the technical lead runs `set-driver` with `--delivery-type`
  and `--plate`.

## 9. Testing instructions

```bash
cd backend && source .venv/bin/activate
ruff check . && ruff format --check .
pytest tests/test_partners_api.py tests/test_dispatch.py
# With a migrated test database:
TEST_DATABASE_URL=... pytest tests/test_partners_integration.py tests/test_dispatch_integration.py
```

- `test_partners_api.py` (no database): 401, 403 for customers and admins,
  CSRF; the profile, pending profile, notifications and error bodies equal
  the contract examples; every sign-up field rule; the registration limit;
  drivers on phone verification, admins still refused.
- `test_partners_integration.py`: sign-up records the pending profile, the
  declared vehicle, the zone and the audit row; inactive or unknown zone and
  a taken phone create nothing; going online needs approval; preferences;
  `no_driver_profile`; a pending partner is refused by dispatch with
  `not_approved`; offer and withdraw leave messages; mark read ignores other
  people's ids.
- `test_dispatch.py`: the eligibility reasons and the `set-driver` options.
- Migration: `alembic upgrade head`, `alembic check`, `alembic downgrade -1`
  and `alembic upgrade head` on a local PostGIS database (2026-10-26).

## 10. Known limitations

The backend now also supports revocable current-location sharing (#410), documented
in [driver-location.md](driver-location.md). The new collection screens still need
visual approval and implementation; existing online/offline screens do not collect
a location.

- Approval, suspension and the verified vehicle are set by an administrator
  in the admin driver directory ([admin-drivers.md](admin-drivers.md), #45),
  not by the partner.
- No admin notice that a partner is waiting: there is no admin notification
  store. Only the `partner_registered` audit row records it.
- The `new_orders`, `station_closed`, `papers_due` and `payout` message kinds
  are not created (no job pool, stations on the command-line tool, documents
  and payouts out of the MVP). `account` is created by the admin approval
  endpoint.
- The demo seed gives the demo driver an approved tanker profile in "Demo
  zone" (#63, [demo-data.md](demo-data.md)). A demo database seeded before
  #63 gets it on the next seed run.
- The partner app still uses mocks for these screens: linking them is a
  follow-up issue.
