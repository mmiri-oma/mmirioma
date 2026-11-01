# Admin directory contract: customers, drivers, service zones, price lists

**Status: agreed** on 2026-10-28 (G3, #43): proposed on 2026-10-26 by
@Cloudcrackamara (+ Claude Code) in #18, and every section is now agreed. It
became `Status: agreed` when one reviewer other than its author agreed it
(CLAUDE.md, "Team workflow", since 2026-10-27).

**Amended 2026-10-26 for #30** (service zones): open questions 5, 6, 13, 14
and 15 decided by @nnamdi-security; the zone's fallback rate is now one fee
per water category; customers list active zones with `GET /service-zones`.
See [Changes](#changes).

**[Service zones](#service-zones): `Status: agreed`** on 2026-10-26 by
@nnamdi-security (technical lead, sole approver under PR #36), so #30 can
build it. **[Price lists](#price-lists): `Status: agreed`** on 2026-10-26 by
@nnamdi-security (technical lead, #36), so #37 can build it.
**[Customers](#customers) and [Drivers](#drivers): `Status: agreed`** on
2026-10-28 by @nnamdi-security (technical lead, PR #146), so #45 can build
them.

**Revised 2026-10-28 for #43** (customers and drivers, after @chidimmamogbo's
review of 2026-10-26): partner approval with vehicle verification added; the
staff "create" endpoints removed; open questions 1, 2, 4, 7, 8, 10, 11 and 12
decided, 3 and 9 partly. See [Changes](#changes).

The fork's admin Customers, Riders, Service areas and Pricing screens run on
mocks (`frontend/src/mocks/adminMock.ts`) and show "not connected yet" against
the real API. This contract proposes the endpoints that would let them leave
mocks. Conventions (base path `/api/v1`, formats, error envelope, CSRF,
pagination) are in the [README](README.md#conventions-apply-to-every-endpoint).

## What this covers

The fork functions `listCustomers` through `savePriceList` in
`frontend/src/features/admin/adminApi.ts`:

| Fork function | In this contract |
| --- | --- |
| `listCustomers`, `getCustomer`, `addCustomerAddress` | [Customers](#customers) |
| `createCustomer` | **Not proposed** (decided, @chidimmamogbo, 2026-10-26): a staff-created account has no way to sign in ([open question 2](#open-questions)). "+ New customer" stays "not connected" |
| `verifyCustomerPhone` | **Not proposed**: FR-003 verification is by SMS code ([decision 4](#decisions-taken-in-18)) |
| `adjustPoints` | **Not proposed**: points belong to #11 ([decision 3](#decisions-taken-in-18)) |
| `listRiders`, `getRider`, `setRiderApproval` | [Drivers](#drivers) |
| `addRider` | **Not proposed** (decided, @chidimmamogbo, 2026-10-26): partners sign themselves up ([partners.md](partners.md#post-authpartner-register), #14), a staff-created account has no way to sign in ([open question 2](#open-questions)), and [auth.md](auth.md) keeps staff accounts on the command-line tool. "+ Add rider" stays "not connected" |
| `listStations`, `setStationOpen`, `saveStation`, `uploadStationPapers` | **Not proposed**: sources stay on the command-line tool ([decision 5](#decisions-taken-in-18)) |
| `listAreas`, `saveArea` | [Service zones](#service-zones) (built in #30) |
| `listPriceLists`, `savePriceList` | [Price lists](#price-lists) |

Functions that are not proposed keep their mocks and keep showing "not
connected yet" in real-API mode.

## Where this comes from

| Source | Used for |
| --- | --- |
| `frontend/src/mocks/adminMock.ts` | What each screen reads and writes, validation, error codes |
| `frontend/src/domain/admin.ts` | `AdminCustomer`, `AdminRider`, `ServiceArea`, `PriceList` and the input types |
| [handoff-v1.md](../design/handoff-v1.md) | Decisions 9, 10, 10a, 10b, 11c, 16 |
| SRS v0.3 | FR-001 to FR-004, FR-010 to FR-013, FR-020 to FR-024, FR-031, FR-042, BR-01, BR-09, §5 data model, §12, NFR-004 |
| [order-details-and-price.md](order-details-and-price.md) (#10) | Decided there: FR-022 pricing only, "the admin Pricing screen is redesigned around FR-022 rates in #18"; one fixed pilot category |
| [auth.md](auth.md), [deliveries.md](deliveries.md#admin-dispatch-endpoints), [water-sources.md](../features/water-sources.md) | Existing accounts, driver profiles, vehicle profiles, eligibility, audit |
| [partners.md](partners.md) (#14, agreed) | Approval status, the declared vehicle, the verified safe payload and transfer methods set at approval |

## Decisions taken in #18

Agreed with the lane owner (@Cloudcrackamara, 2026-10-26) before writing:

1. **Pricing follows FR-022.** The price list is a versioned set of FR-022
   rates, not the mock's flat per-can and per-tank prices. The Pricing screen
   needs a redesign (G2) in its own issue; this contract does not change it.
2. **Service zones are written here**, not in a separate #30 contract. #30
   builds them (comment on #30, 2026-10-26).
3. **Rider pay and points are not proposed.** The SRS has no rule for either;
   design decision 16 calls them "SAMPLE mocks; may be kept or removed later".
   Both are out of the MVP ([open questions 10 and 11](#open-questions),
   decided).
4. **No staff phone verification.** FR-003 phone verification by SMS code is
   built (Termii, [auth.md](auth.md#phone-verification-fr-003-fr-004)). A
   customer verifies by SMS code before their first order. If SMS fails,
   FR-003 allows a documented manual verification by a dispatcher; whether
   the app gets a screen for it is [open question 3](#open-questions).
5. **No admin endpoints for water sources.** Sources (the design's "refill
   stations") stay on the command-line tool (pilot fallback F1,
   [water-sources.md](../features/water-sources.md)).
6. **Driver approval follows [partners.md](partners.md#approval-status)**
   (revised for #43): the design's approval maps to `approval_status`
   (`pending`, `approved`, `suspended`), set with
   [`POST /admin/drivers/{id}/approval`](#post-admindriversidapproval).
   Activation (`users.is_active`, FR-002) stays a separate endpoint
   ([open question 7](#open-questions), decided).
7. **Saved addresses are proposed here** for the admin side, following the SRS
   §5 `addresses` entity (with a zone, from this contract). #11 should reuse
   the same address shape for the customer side.

## Access rules

- Every endpoint requires a signed-in, active `admin` ([auth.md](auth.md)).
  Customers and drivers get 403 `forbidden` (FR-001). The one exception is
  [`GET /service-zones`](#get-service-zones), which needs no session.
- Unsafe requests (`POST`, `PATCH`) need the `X-CSRF-Token` header (403
  `csrf_failed`).
- Every write records an audit row (NFR-004) with the actor, the action, the
  target and ids only; never phones, addresses or notes in `details`
  (`backend/app/modules/audit/service.py`). Actions are listed in
  [Data needed](#data-needed).
- Responses here return phones and addresses to staff only (NFR-003: access
  to contact and address information is restricted to admins).

## Customers

**Status: agreed** (2026-10-28, @nnamdi-security, technical lead; PR #146,
#43).

Built in #45 ([admin-customers.md](../features/admin-customers.md)).

### Objects

`AdminCustomerSummary`, one row of the customer list:

```json
{
  "id": "0b8f1c5e-2a7d-4d3e-9a51-6f0c2b7e9d14",
  "name": "Sample Customer",
  "phone": "+2348000000001",
  "phone_verified": true,
  "is_active": true,
  "orders_count": 3,
  "created_at": "2026-10-17T08:00:00Z"
}
```

| Field | Rule |
| --- | --- |
| `phone_verified` | `users.phone_verified_at` is set (FR-003) |
| `is_active` | `users.is_active` (FR-002) |
| `orders_count` | Every order of the customer, any status |
| `created_at` | The account's creation time; the design's "Customer since" |

`AdminCustomer`, the detail: `AdminCustomerSummary` plus:

```json
{
  "paid_total_minor_units": 4500000,
  "addresses": [ { "...": "Address" } ],
  "recent_orders": [
    {
      "reference": "MO-7KQ2M9XH4T",
      "created_at": "2026-10-24T09:30:00Z",
      "status": "delivered",
      "quantity_litres": 3000,
      "delivery_type": "tanker"
    }
  ]
}
```

| Field | Rule |
| --- | --- |
| `paid_total_minor_units` | Sum of the price snapshot totals (FR-024) of the customer's orders whose `payment_status` is `paid` ([payments.md](payments.md)). Integer kobo (BR-01). Paid only by staff or provider confirmation (BR-07), never by the customer's word |
| `addresses` | The customer's saved addresses, default first, then newest first |
| `recent_orders` | The 5 newest orders. `status` is the backend order status ([orders.md](orders.md#order-statuses-fr-033)); the adapter maps it with [api-mapping.md](../architecture/api-mapping.md#admin-order-status). `delivery_type` is `"keke"`, `"tanker"` or `null` for orders created before #21 |

The mock's `points` and `complaints` have no source: points are #11
([open question 10](#open-questions)) and the backend has no support tickets
yet (#22). The mock's `email` has no column; it stays out until #11 adds one.

`Address`, one saved address (SRS §5 `addresses`):

```json
{
  "id": "5c2d9e1a-7b3f-4a6e-8d0c-1f2e3a4b5c6d",
  "label": "Home",
  "address": "12 Sample Street, Independence Layout",
  "landmark": "Opposite the sample church",
  "zone": { "id": "9e8d7c6b-5a4f-4e3d-2c1b-0a9f8e7d6c5b", "name": "Independence Layout", "is_active": true },
  "is_default": true,
  "created_at": "2026-10-20T10:00:00Z"
}
```

| Field | Rule |
| --- | --- |
| `label` | Trimmed, 1-50 characters, the same as [customer-account.md](customer-account.md) since both write `customer_addresses` (#48 review). Design field ("Home", "Shop") |
| `address` | Trimmed, 5-500 characters, free text, as `delivery_address` in [orders.md](orders.md#order-object) |
| `landmark` | Optional, up to 200 characters, as in orders.md |
| `zone` | The service zone the address is in (SRS §5 `addresses.zone_id`, FR-020). `is_active` is read live; an address in an inactive zone stays saved, but orders to it are refused (FR-010) |
| `is_default` | `true` on exactly one address when the customer has any. The first address saved becomes the default (as the mock) |

### Endpoints

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/admin/customers` | `q`, `limit`, `offset` | 200 `AdminCustomerPage` | 422 `validation_error` |
| GET | `/admin/customers/{id}` | none | 200 `AdminCustomer` | 404 `customer_not_found` |
| POST | `/admin/customers/{id}/addresses` | `AddressCreate` | 201 `AdminCustomer` | 404 `customer_not_found`, 404 `service_zone_not_found`, 422 `validation_error` |

All endpoints also return the shared 401, 403 and 422 errors from the
[README](README.md#errors).

#### GET /admin/customers

Accounts with role `customer`, newest first.

| Query | Rule |
| --- | --- |
| `q` | Optional, trimmed, 1-100 characters. Matches a part of the name (case-insensitive), or, with 4 or more digits, a part of the phone in E.164 or local `0…` form (as the mock) |
| `limit`, `offset` | [Pagination](README.md#pagination) |

`AdminCustomerPage` is the standard page plus one count for the list header:

```json
{ "items": [], "total": 0, "limit": 50, "offset": 0, "ordered_last_7_days": 0 }
```

`total` counts the customers matching `q`. `ordered_last_7_days` counts every
customer (not only the matches) with at least one real order created in the
last 7 × 24 hours; simulated orders are left out (BR-09). The mock calls it
`ordered_this_week`; it means the last 7 days, not the calendar week
([open question 4](#open-questions), decided).

#### GET /admin/customers/{id}

An id that is not a customer account is 404 `customer_not_found`, so staff
pages cannot read drivers or admins through it.

#### POST /admin/customers/{id}/addresses

Saves an address on an existing customer (design `a-create` "+ Add
address"). Staff do not create customer accounts (see
[What this covers](#what-this-covers)).
`AddressCreate`:

```json
{
  "label": "Home",
  "address": "12 Sample Street, Independence Layout",
  "landmark": "Opposite the sample church",
  "zone_id": "9e8d7c6b-5a4f-4e3d-2c1b-0a9f8e7d6c5b"
}
```

`zone_id` is required: an address must have a zone (SRS §5, FR-020). An
unknown zone is 404 `service_zone_not_found`. An inactive zone is allowed
(staff may record the address); ordering checks the zone. Staff pick the zone
([Which zone an address is in](#which-zone-an-address-is-in), open question 6
decided). Returns the
whole customer, so the page redraws without a second request.

Editing, deleting and changing the default address are not proposed (no
admin design for them).

## Drivers

The design says "rider" (Keke) and "driver" (Tanker), together "partner"; the
server role is `driver` for both ([api-mapping.md](../architecture/api-mapping.md#names)).
Paths use `drivers`.

**Status: agreed** (2026-10-28, @nnamdi-security, technical lead; PR #146,
#43).

Built in #45 ([admin-drivers.md](../features/admin-drivers.md)).

**Decided in #45** (@nnamdi-security, technical lead, 2026-10-28), where the
text above leaves an edge open. None changes a path, field or error code:

1. **A repeat comes first.** Asking for the state the partner is already in,
   with no `vehicle`, is 200 and unchanged before the `driver_inactive` and
   `partner_phone_not_verified` checks. A real change to a deactivated account
   is still 409 `driver_inactive`.
2. **`counts.available`** counts active, approved drivers whose availability is
   on, the same as the dashboard's drivers available. `counts.pending` counts
   active accounts only.
3. **`q` matches the vehicle type** as both the verified `description` and the
   declared `delivery_type` (`keke`, `tanker`), so a pending partner with no
   verified vehicle is found.
4. **A driver account with no dispatch profile** is not listed and is 404
   `driver_not_found`: it cannot work (dispatch answers `no_driver_profile`)
   and has no approval status to show.
5. **The partner's `account` message** says the status changed in one plain
   sentence ("Your account was approved" or "Your account was suspended"). It
   does not copy the staff reason, which is an internal note, and it names no
   support number: FR-055's number is the customer support number.

### Objects

`AdminDriver`:

```json
{
  "id": "7d1f4e8a-b6c9-4a1b-9c3d-4e5f0b8f1c5e",
  "name": "Sample Driver One",
  "phone": "+2348000000011",
  "phone_verified": true,
  "is_active": true,
  "approval_status": "approved",
  "is_available": true,
  "vehicle": {
    "delivery_type": "tanker",
    "plate": "ENU-456-CD",
    "description": "Tanker truck",
    "declared_capacity_gallons": 3000,
    "declared_capacity_litres": 12000,
    "safe_payload_litres": 12000,
    "transfer_methods": ["ground", "overhead"]
  },
  "zones": [ { "id": "9e8d7c6b-5a4f-4e3d-2c1b-0a9f8e7d6c5b", "name": "Independence Layout" } ],
  "live_jobs": 1,
  "completed_jobs": 42,
  "delivered_jobs": 39,
  "created_at": "2026-10-10T08:00:00Z"
}
```

| Field | Rule |
| --- | --- |
| `phone_verified` | `users.phone_verified_at` is set (FR-003). Must be `true` before approval ([partners.md](partners.md#approval-status), decision 9) |
| `is_active` | `users.is_active`: the account may sign in (FR-002). A deactivated account cannot sign in at all |
| `approval_status` | `pending`, `approved` or `suspended` ([partners.md](partners.md#approval-status)): only an `approved` partner can go online or be offered jobs (FR-031 eligibility, `not_approved`). Clients must not fail on a value they do not know |
| `is_available` | `driver_profiles.is_available`: can take new work now (FR-031 availability). The design's "Online". Set by the driver ([partners.md](partners.md#put-driveravailability)) or the command-line tool, and set to `false` when the partner is suspended; never set to `true` here |
| `vehicle` | The same object as `vehicle` in the [partner profile](partners.md#partner-object-partnerprofileread), so both sides read one record. The **declared** fields (`delivery_type`, `plate`, `declared_capacity_gallons`, `declared_capacity_litres`) are what the partner typed at sign-up; `delivery_type` and `plate` are `null` for drivers created with the command-line tool before sign-up asked for them. The **verified** fields (`description`, `safe_payload_litres`, `transfer_methods`) are set by an admin at [approval](#post-admindriversidapproval) (FR-013); `description` and `safe_payload_litres` are `null`, and `transfer_methods` empty, until then. The design shows a tanker's payload as gallons (÷ 4, [api-mapping.md](../architecture/api-mapping.md#quantities)) |
| `zones` | The service zones the driver serves (FR-031 "service area"), by name |
| `live_jobs` | The driver's assignments with status `offered` or `accepted` ([deliveries.md](deliveries.md#assignment-statuses-built-in-s1-07)). The design's "active orders" |
| `completed_jobs` | Assignments with status `completed`. A job also ends `completed` when its order fails or is cancelled ([deliveries.md](deliveries.md), `job_status`), so this is not a delivery count. Kept unchanged for existing clients |
| `delivered_jobs` | Assignments with status `completed` whose order is `delivered`. The design's "trips": a failed or cancelled job is not a trip, so the Riders page, the driver's "Trips today" and Trip history agree ([amendment](#amendment-275-delivered-jobs-on-the-admin-driver)). Added 2026-11-01; a client must treat it as optional, because an older server does not send it |
| `created_at` | The design's "Partner since" |

Not in `AdminDriver`, because the SRS has no rule or the backend no record
for them: `code` (fleet code, [open question 9](#open-questions)), `rating`,
`today_minor_units` and `payout_due_minor_units` (partner pay is out of the
MVP, [open question 11](#open-questions)), `documents_note` (documents are
checked in person, [partners.md](partners.md#open-questions) decision 6) and
`reported_issues` (no support tickets for partners yet).

### Endpoints

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/admin/drivers` | `delivery_type`, `approval_status`, `is_active`, `q`, `limit`, `offset` | 200 `AdminDriverPage` | 422 `validation_error` |
| GET | `/admin/drivers/{id}` | none | 200 `AdminDriver` | 404 `driver_not_found` |
| POST | `/admin/drivers/{id}/approval` | `ApprovalChange` | 200 `AdminDriver` | 404 `driver_not_found`, 409 `driver_inactive`, 409 `partner_phone_not_verified`, 409 `driver_has_accepted_job`, 422 `validation_error` |
| POST | `/admin/drivers/{id}/activation` | `ActivationChange` | 200 `AdminDriver` | 404 `driver_not_found`, 409 `driver_has_accepted_job`, 422 `validation_error` |

All endpoints also return the shared 401, 403 and 422 errors from the
[README](README.md#errors).

#### GET /admin/drivers

Accounts with role `driver`, by name.

| Query | Rule |
| --- | --- |
| `delivery_type` | Optional, `keke` or `tanker` (design pills "Keke", "Tanker") |
| `approval_status` | Optional, `pending`, `approved` or `suspended` (design pills "Pending", "Suspended") |
| `is_active` | Optional boolean. `false` lists deactivated accounts (FR-002) |
| `q` | As for customers, also matching the vehicle type |
| `limit`, `offset` | [Pagination](README.md#pagination) |

`AdminDriverPage` is the standard page plus counts over every driver, ignoring
the filters, for the pills and the header:

```json
{
  "items": [], "total": 0, "limit": 50, "offset": 0,
  "counts": { "all": 0, "keke": 0, "tanker": 0, "pending": 0, "inactive": 0, "available": 0 }
}
```

`pending` counts active accounts with `approval_status` `pending`: the
design's "Pending" pill and the partners waiting for approval.

#### POST /admin/drivers/{id}/approval

Approves or suspends a partner ([partners.md](partners.md#approval-status);
design "Approve" and "Suspend"). Approving is also when the admin records the
vehicle they checked in person (FR-013). `ApprovalChange`:

```json
{
  "approval_status": "approved",
  "reason": null,
  "vehicle": {
    "description": "Tanker truck",
    "safe_payload_litres": 12000,
    "transfer_methods": ["ground", "overhead"]
  }
}
```

| Field | Rule |
| --- | --- |
| `approval_status` | `approved` or `suspended`. A partner never goes back to `pending`: it is only the state after sign-up |
| `reason` | Trimmed. Required, 5-500 characters, to suspend (NFR-004 audit, as deactivation). Optional, up to 500, to approve |
| `vehicle` | The vehicle the admin verified (FR-013). **Required** to approve a partner who has no verified vehicle yet; optional otherwise, and then it replaces the verified fields. Not allowed with `suspended` (422) |
| `vehicle.description` | Trimmed, 1-50 characters: the vehicle profile's `vehicle_type` text, for example "Tanker truck" or "Tricycle with 1,000 L tank" |
| `vehicle.safe_payload_litres` | Integer, 1 to 100,000: the **verified** safe payload per trip (FR-013, BR-03). The admin measures or checks it; the declared capacity is shown next to it as a claim only ([partners.md](partners.md#capacity-declared-and-verified)). The same field for Keke and tanker, so a Keke's payload is entered the same way ([open question 8](#open-questions), decided) |
| `vehicle.transfer_methods` | List of `ground` and `overhead`, each at most once (FR-013 transfer method; [partners.md](partners.md#open-questions) decision 4). May be empty |

**Approve** (`approved`):

- The account must be active (`is_active: true`), else 409
  `driver_inactive`: approval status only applies to active accounts
  ([partners.md](partners.md#approval-status)).
- The partner's phone must be verified (`phone_verified: true`, FR-003), else
  409 `partner_phone_not_verified` ([partners.md](partners.md#open-questions)
  decision 9; requested in the #47 review).
- The admin has checked the vehicle, its plate and papers in person
  ([partners.md](partners.md#open-questions) decisions 3 and 6). With
  `vehicle`, the server creates a vehicle profile (or updates the linked one)
  with the description and verified payload, links it to the driver profile,
  and stores the transfer methods on the driver profile. The declared
  capacity and plate are not changed.
- Availability is not changed: the partner goes online themselves.
- Approving a `suspended` partner who already has a verified vehicle needs no
  `vehicle`.

**Suspend** (`suspended`):

- Sets `is_available = false` ([partners.md](partners.md#approval-status)),
  so the partner drops out of dispatch at once.
- A live `offered` assignment is withdrawn as in
  [withdraw](deliveries.md#post-adminordersreferencewithdraw) (the order
  returns to `confirmed`, reason `reassigned`). While the partner holds an
  `accepted` job, suspension is refused with 409 `driver_has_accepted_job`,
  the same rule as deactivation ([open question 12](#open-questions)).
- The account can still sign in; to block sign-in, deactivate it
  ([activation](#post-admindriversidactivation)).

Examples: [approve](examples/admin-driver-approval-request.json),
[suspend](examples/admin-driver-suspension-request.json),
[unverified phone](examples/error-partner-phone-not-verified.json).

**Both:**

- Asking for the state the partner is already in, with no `vehicle`,
  returns 200 with the partner unchanged and writes no audit row.
- Every change writes one audit row (NFR-004): `driver_approved` or
  `driver_suspended`, with the reason, and with `vehicle_profile_id`,
  `safe_payload_litres` and `transfer_methods` when a vehicle was recorded.
  No phone or plate in `details`.
- The partner sees the change in their notifications (`account`,
  [partners.md](partners.md#notifications)).

#### POST /admin/drivers/{id}/activation

Activates or deactivates a partner account (FR-002). `ActivationChange`:

```json
{ "is_active": false, "reason": "Vehicle papers expired" }
```

| Field | Rule |
| --- | --- |
| `is_active` | The new state |
| `reason` | Trimmed. Required, 5-500 characters, to deactivate (NFR-004 audit; the mock asks for at least 5). Optional, up to 500, to activate |

- **Deactivate:** the account's sessions stop working and it cannot sign in
  ([auth.md](auth.md#roles)). It cannot see future job data (FR-002), so a live
  `offered` assignment is withdrawn as in
  [withdraw](deliveries.md#post-adminordersreferencewithdraw) (the order
  returns to `confirmed`, reason `reassigned`). Deactivation is refused with
  409 `driver_has_accepted_job` while the driver holds an `accepted` job
  ([open question 12](#open-questions), decided): the job ends first.
- **Activate:** the driver can sign in again. Their availability and
  approval status are unchanged, so only an `approved` partner can be offered
  work.
- Activation is separate from [approval](#post-admindriversidapproval):
  activation is account access (FR-002), approval is whether the partner may
  work ([partners.md](partners.md#approval-status)).
- Asking for the state the driver is already in returns 200 with the driver
  unchanged and writes no audit row.

## Service zones

FR-010: administrators configure service zones, each with a name,
coordinates, an optional polygon, an active flag and eligibility; customers
order only inside an active zone; each zone carries delivery-zone rates used
as the FR-022 fallback when road distance is unavailable. The design calls
them "service areas".

**Status: agreed** (2026-10-26, @nnamdi-security, technical lead; PR #36).
Built in #30.

### Object

`ServiceZone`:

```json
{
  "id": "9e8d7c6b-5a4f-4e3d-2c1b-0a9f8e7d6c5b",
  "name": "Independence Layout",
  "is_active": true,
  "centre": { "latitude": 6.4447, "longitude": 7.5108 },
  "boundary": null,
  "fallback_delivery_fees": [
    {
      "water_category": { "id": "3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b", "label": "Potable Water" },
      "fee_minor_units": 300000
    }
  ],
  "created_at": "2026-10-20T10:00:00Z",
  "updated_at": "2026-10-20T10:00:00Z"
}
```

| Field | Rule |
| --- | --- |
| `name` | Trimmed, 2-100 characters, unique ignoring case |
| `is_active` | FR-010. The design's "enabled". New orders need an active zone; switching a zone off never changes existing orders (FR-024) |
| `centre` | The zone's coordinates (FR-010, required). WGS 84 decimal degrees (SRID 4326, CLAUDE.md): `latitude` -90 to 90, `longitude` -180 to 180; no other bound. Typed in by the admin, since no map provider is approved ([open question 5](#open-questions), decided). Stored for road distance later (OSRM, SRS §12.1); the pilot does not use it to match addresses ([Which zone an address is in](#which-zone-an-address-is-in)) |
| `boundary` | Optional GeoJSON `Polygon`, SRID 4326 (FR-010 "optional geographic polygon"), or `null`. A closed ring of at least 4 positions |
| `fallback_delivery_fees` | The zone's delivery rates (FR-010), used as the delivery cost when no road distance is available (FR-022): **one fee per water category, per order** ([open question 13](#open-questions), decided), whatever the number of trips. Integer kobo, at least 0. Each category at most once. An empty list means no fallback ([Delivery cost from the zone](#delivery-cost-from-the-zone)). The design's "fixed fee per area" |
| `fallback_delivery_fees[].water_category` | `id` and current `label` of a water category (FR-014). Written as `water_category_id` |

Not in `ServiceZone`, by decision (@nnamdi-security, 2026-10-26):

- The design's `distance_km` (decision 10a, a road distance typed by an
  admin): FR-022 takes the distance from OSRM and forbids fabricated route
  estimates, and the per-zone fee makes it unnecessary
  ([open question 14](#open-questions)).
- The design's `station_id`: sources stay on the command-line tool
  ([decision 5](#decisions-taken-in-18)), and the source is chosen at
  confirmation, not per zone.
- FR-010's "eligibility": no separate field. In the pilot, a zone delivers a
  category when it has a fee for it
  ([open question 15](#open-questions)). Revisit when OSRM is added, since a
  road-distance price would not need a fee.
- SRS §5's "default pricing zone": no column. A price rule with
  `zone_id: null` already applies to every zone without a rule of its own
  ([Price lists](#price-lists)), so a default zone would be a second way to
  say the same thing.

### Which zone an address is in

FR-020: the customer submits the service zone with the address; a map pin is
optional. **Decided** ([open question 6](#open-questions)): the customer
picks the zone from the active zones ([`GET /service-zones`](#get-service-zones));
staff pick it for an address they record. The server never guesses a zone
from address text and never geocodes. An address in no listed zone is sent
with no zone, and its quote is `manual_quote_required` /
`outside_service_zone` (FR-010, T-02; see
[order-details-and-price.md](order-details-and-price.md#post-quotes)).

### Delivery cost from the zone

Until OSRM exists (SRS §12.1), the delivery cost of a quote with an address
is the zone's fee for the quote's category (FR-022 fallback). The quote side
is built in #21:

| Zone and fee | Quote |
| --- | --- |
| Active zone with a fee for the category | Delivery cost = that fee, once per order. Handling and margin still come from the price list (FR-022) |
| Active zone, no fee for the category | `manual_quote_required` / `delivery_cost_unavailable` (FR-022, T-18) |
| No zone, or an inactive zone | `manual_quote_required` / `outside_service_zone` (FR-010, T-02) |

Never a distance guess or another zone's fee ("No fabricated route
estimates", FR-022).

### Endpoints

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/admin/service-zones` | none | 200 `{ "items": [ServiceZone] }` | none beyond shared |
| POST | `/admin/service-zones` | `ServiceZoneWrite` | 201 `ServiceZone` | 404 `water_category_not_found`, 409 `service_zone_name_taken`, 422 `validation_error` |
| PATCH | `/admin/service-zones/{id}` | `ServiceZoneWrite`, fields optional | 200 `ServiceZone` | 404 `service_zone_not_found`, 404 `water_category_not_found`, 409 `service_zone_name_taken`, 422 `validation_error` |
| GET | `/service-zones` | none | 200 `{ "items": [ServiceZoneOption] }` | 503 `service_unavailable` only (no session) |

`GET /admin/service-zones` returns every zone, active or not, by name, with
no pagination: a pilot has a handful of zones. `ServiceZoneWrite` is the
object without `id`, `created_at` and `updated_at`, with each fee written as
`{ "water_category_id": "…", "fee_minor_units": 300000 }`
([admin-service-zone-write-request.json](examples/admin-service-zone-write-request.json)).
In `POST`, `fallback_delivery_fees` may be omitted (empty list). In `PATCH`,
an absent field is unchanged, `null` clears `boundary`, and a sent
`fallback_delivery_fees` replaces the whole list (`[]` removes every fee).
A category listed twice is 422 `validation_error`. Zones are never deleted
(orders and addresses refer to them); switch one off instead.

The mock's 409 `area_exists` becomes `service_zone_name_taken`.

#### Amendment (#74): the pilot category in the admin zone list

**Status: agreed** (G3) on 2026-10-27 by @chidimmamogbo and @nnamdi-security
(technical lead), on PR #108. Proposed by @Cloudcrackamara (+ Claude Code).
Built in #109. The rest of [Service zones](#service-zones)
stays agreed as it is.

**Gap.** The Service areas screen edits one fee per area: the pilot water
category's ([Mapping to the design types](#mapping-to-the-design-types)).
The pilot category is the server setting `PILOT_WATER_CATEGORY`, a category
code (`utility` by default; [order-details-and-price.md](order-details-and-price.md),
open question 2). No admin endpoint returns that code, or the category's id:
`fallback_delivery_fees[].water_category` has `id` and `label` only. So a
client cannot tell which fee is the pilot one, and cannot write one for a
zone that has none, without guessing from the label.

**Proposal.** `GET /admin/service-zones` also returns the pilot category, as
the same `{ id, label }` the fees use:

```json
{
  "items": [ServiceZone],
  "pilot_water_category": { "id": "3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b", "label": "Utility Water" }
}
```

| Field | Rule |
| --- | --- |
| `pilot_water_category` | The water category whose `code` is the `PILOT_WATER_CATEGORY` setting, read when the list is requested; the same lookup quotes use. `null` when no category has that code (quotes then have no category either) |

Additive: `items` is unchanged, and a client that ignores the new field keeps
working. No new rule, setting or table: the server already resolves this
category for every quote.

Built in #109 and read by the Service areas link (#110). When the field is
`null`, the link shows the fee as empty and refuses to write one ("not
connected"), rather than guess.

#### Amendment (#160): the list of water categories

**Status: agreed** (G3) on 2026-10-28 by @nnamdi-security (technical lead),
on PR #163. Proposed by @DevBoanvee (+ Claude Code) for #160, whose owner is
@Cloudcrackamara; the technical lead decided in the G3 call of 2026-10-28
(PR #158, [admin-pricing.md](../design/admin-pricing.md), decision 8) that
the endpoint is wanted. Building it is #161. The rest of
[Service zones](#service-zones) and [Price lists](#price-lists) stays agreed
as it is.

**Gap.** The Pricing screen's Water picker on each price rule offers "Every
water" or one category. The admin API has no list of categories to fill it:
`GET /admin/service-zones` names only the categories that already have a
zone fee, plus `pilot_water_category` ([above](#amendment-74-the-pilot-category-in-the-admin-zone-list)),
and the confirm sheet reads categories from one order's
`confirmation-options`.

**Proposal.** One additive, read-only endpoint:

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/admin/water-categories` | none | 200 `{ "items": [AdminWaterCategory] }` | none beyond the shared 401 and 403 ([README](README.md#errors)) |

Admin only, like the other `/admin` endpoints ([Access rules](#access-rules)).
No query parameters and no pagination: the pilot has a handful of categories.
Every category, by label, so the order is the same on every call
([admin-water-categories.json](examples/admin-water-categories.json)):

```json
{
  "items": [
    { "id": "7a2b9c4d-1e3f-4a5b-8c6d-9e0f1a2b3c4d", "label": "Potable Water", "is_active": false },
    { "id": "5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a", "label": "Utility Water", "is_active": true }
  ]
}
```

| Field | Rule |
| --- | --- |
| `id` | The id a price rule sends as `water_category_id` |
| `label` | The admin-configured label (FR-014), shown as the picker's name. Never a description of the water itself |
| `is_active` | Whether the category is offered at all (FR-014) |

- **`code` is left out.** The Pricing screen needs `id` and `label`. `code`
  (`potable`, `utility`) is for the command-line tool and for the server's
  pilot setting (`PILOT_WATER_CATEGORY`); leaving it out means no client keys
  off it. A client that needs to know which category is the pilot one reads
  `pilot_water_category` from [`GET /admin/service-zones`](#amendment-74-the-pilot-category-in-the-admin-zone-list).
- **Inactive categories are listed**, with `is_active: false`, so a rule that
  already names one still shows its label. The server does not refuse a price
  rule (or a zone fee) that names an inactive category: only an unknown id is
  404 `water_category_not_found` ([POST /admin/price-lists](#post-adminprice-lists)).
  Whether a category is offered is checked when a quote is made (FR-014), not
  when a rule is saved. Whether the picker offers inactive categories for
  new rules is the design's call, not this contract's.
- **Not carried:** no `supported_uses` text and no price. Prices are in
  [Price lists](#price-lists).
- "Error codes" and "Data needed" do not change: no new error code, table or
  column. The endpoint reads the existing `water_categories` table.

Built in #161 (`GET /admin/water-categories`). Until the Pricing link reads
it, the Water picker offers "Every water" and the categories the zone list
names (admin-pricing.md, decision 8).

#### GET /service-zones

The zones a customer can pick for an address (FR-020,
[Which zone an address is in](#which-zone-an-address-is-in)), and a partner
at sign-up ([partners.md](partners.md#post-authpartner-register), open
question 2). **No session needed** (amended 2026-10-26): partner sign-up runs
before there is one. Any role may call it, and it needs no CSRF token (a
`GET`). Active zones only, by name, no pagination
([service-zones.json](examples/service-zones.json)):

```json
{ "items": [ { "id": "9e8d7c6b-5a4f-4e3d-8c1b-0a9f8e7d6c5b", "name": "Independence Layout" } ] }
```

`ServiceZoneOption` is `id` and `name` only: no fees (customers see the
total only, [order-details-and-price.md](order-details-and-price.md#response-200-quoteread)),
no coordinates or boundary, so nothing in it needs a session to protect.
Inactive zones are never listed.

## Price lists

FR-022: the server computes every quote as **water cost + delivery cost +
handling cost + MmiriOma margin**. Water cost is the supplier's cost per litre
for the category (FR-011) and is recorded on the source's activation by the
command-line tool ([water-sources.md](../features/water-sources.md)), not
here. Every other rate is admin-configured and lives in a **price list**.
SRS §5 `pricing_rules`: version, zone, quantity band, source/category, base
delivery fee, distance rate, additional-trip charge, handling rates, margin
type and value, zone fallback rates, effective dates.

**Status: agreed** (2026-10-26, @nnamdi-security, technical lead; #36).
Built in #37. Open questions 16 and 18 decided; 17 stays open until OSRM
exists (no road distance is priced before then).

Saving creates a new **version**; versions are never edited. A quote records
the version it used and orders keep their quote (FR-024, T-09).

### Object

`PriceList`:

```json
{
  "version": 3,
  "effective_from": "2026-10-26T09:00:00Z",
  "created_by": { "id": "0b8f1c5e-2a3b-4c5d-9e6f-7a8b9c0d1e2f", "name": "Sample Dispatcher" },
  "reason": "Diesel price rise",
  "rules": [
    {
      "id": "1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b",
      "zone_id": null,
      "water_category_id": null,
      "min_litres": 600,
      "max_litres": null,
      "base_delivery_fee_minor_units": 200000,
      "distance_rate_minor_units_per_km": 15000,
      "additional_trip_minor_units": 150000,
      "handling_minor_units": 50000,
      "margin": { "type": "percentage", "basis_points": 1000 }
    }
  ],
  "changes": [
    { "path": "rules[0].distance_rate_minor_units_per_km", "from": 12000, "to": 15000 }
  ]
}
```

| Field | Rule |
| --- | --- |
| `version` | 1, 2, 3 …, set by the server |
| `effective_from` | When the version took effect (UTC): the time it was saved. No future dating ([open question 16](#open-questions), decided) |
| `created_by`, `reason` | Who saved it and why. `reason` is optional, trimmed, up to 500 characters |
| `rules` | At least one. A quote uses the **one** rule that matches its zone, category and litres ([Matching](#matching-a-quote-to-a-rule)) |
| `rules[].zone_id` | A service zone, or `null` for every zone without a rule of its own (SRS §5 "zone") |
| `rules[].water_category_id` | A water category, or `null` for every category. FR-022 rates "MAY differ between Potable Water and Utility Water"; the pilot prices one category (#10) |
| `rules[].min_litres`, `rules[].max_litres` | The quantity band (SRS §5), whole litres, inclusive. `min_litres` at least 600 (FR-021); `max_litres` `null` for no upper end, else at least `min_litres` |
| `rules[].base_delivery_fee_minor_units` | FR-022 base delivery fee, per order |
| `rules[].distance_rate_minor_units_per_km` | FR-022 distance charge per km of OSRM road distance. How the distance is rounded is [open question 17](#open-questions) |
| `rules[].additional_trip_minor_units` | FR-022 charge for each trip beyond the first (FR-013, at most two trips) |
| `rules[].handling_minor_units` | FR-022 handling cost, **per order** ([open question 18](#open-questions), decided) |
| `rules[].margin` | FR-022 margin: `{"type": "fixed", "amount_minor_units": n}` or `{"type": "percentage", "basis_points": n}` (1 % = 100 basis points, so no fractions are sent). A percentage applies to water + delivery + handling cost |
| `changes` | What changed from the previous version, by field: `path`, `from`, `to`, with `from` `null` for an added rule. Empty on version 1. The client words them; the mock's `note` sentence is not sent |

Every amount is integer kobo, at least 0 (BR-01). `basis_points` is an
integer 0-10,000. Rounding is the quote's job, not the price list's: FR-022
computes a percentage with decimal arithmetic, converts to whole kobo and
rounds the payable total **up** to the next whole naira; #21 documents the
kobo rounding rule.

#### Matching a quote to a rule

A rule matches when its zone is the quote's zone or `null`, its category is
the quote's category or `null`, and the quote's litres are inside its band.
When several match, a rule with a zone beats one without, then a rule with a
category beats one without. Two rules with the same zone, category and
overlapping bands are refused on save (422 `price_rules_overlap`), so the
choice is never ambiguous. No matching rule: the quote is
`manual_quote_required` (FR-021, FR-022), never a guessed price. #21 builds
the quote side.

### Endpoints

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/admin/price-lists` | `limit`, `offset` | 200 page of `PriceList`, newest first | 422 `validation_error` |
| GET | `/admin/price-lists/current` | none | 200 `PriceList` | 404 `price_list_not_found` (none saved yet) |
| POST | `/admin/price-lists` | `PriceListCreate` | 201 `PriceList` | 404 `service_zone_not_found`, 404 `water_category_not_found`, 409 `price_list_changed`, 409 `price_list_unchanged`, 422 `price_rules_overlap`, 422 `validation_error` |

All endpoints also return the shared 401, 403 and 422 errors from the
[README](README.md#errors).

#### POST /admin/price-lists

`PriceListCreate`:

```json
{
  "base_version": 2,
  "reason": "Diesel price rise",
  "rules": [ { "...": "rule without id" } ]
}
```

| Field | Rule |
| --- | --- |
| `base_version` | The version the admin edited, or `null` for the first list. If it is not the current version (another admin saved meanwhile), 409 `price_list_changed` with `details: {"current_version": n}`; the client shows "Prices changed since you opened this page" and reloads. Nothing is saved |
| `reason` | Optional, as above |
| `rules` | The **whole** new set of rules, not a change to one rule |

- Rules identical to the current version: 409 `price_list_unchanged` (the
  mock's `no_changes`).
- The new version takes effect at once for new quotes. Quotes already given
  keep their version until they expire; orders keep their snapshot (FR-024).

Not in the price list, with the reason:

| Design field (a-pricing, loyalty) | Why not here |
| --- | --- |
| Keke price per 25 L and 50 L can, tanker price per 500/750/1,000 gal | FR-022 prices water per litre from the supplier (decided in #10) |
| Tanker "Ninth Mile water" column (decision 10b) | Water cost per litre is per source and category on the source's activation (FR-011), set by the command-line tool (decision 5). Ninth Mile sources simply have a higher cost per litre (#10) |
| "Rate per km" and "Fixed fee per area" switches (decision 10a) | FR-022 fixes the order: road distance when available, else the zone's fallback rate, else a manual quote. Nothing to switch |
| Rider pay, driver pay | [Open question 11](#open-questions) |
| Points rule (naira per point, welcome bonus, redemption, rounding) | [Open question 10](#open-questions) |

### Amendment (#275): delivered jobs on the admin driver

**Status: agreed** on 2026-11-01 by @nnamdi-security (technical lead, G3, on
[#275](https://github.com/mmiri-oma/mmirioma/issues/275)).

The Riders page showed "Trips" from `completed_jobs`. A job also ends
`completed` when its order fails or is cancelled, so a driver whose only job
failed read "1 Trips" while their own Trip history read "0 Trips". This
amendment adds one field and changes nothing else:

- `AdminDriver.delivered_jobs` (integer, 0 or more): the driver's assignments
  with status `completed` whose order is `delivered`.
- `completed_jobs` keeps its meaning, so existing clients keep working.
- Every response that carries `AdminDriver` sends it (`GET /admin/drivers`,
  `GET /admin/drivers/{id}`, and the `POST .../approval` and `POST .../activation` responses), because all four build it in one place (`driver_read`).
- No new table, no migration, no new error code.

## Error codes added by this contract

| Status | `code` | When |
| --- | --- | --- |
| 404 | `customer_not_found` | No customer account with this id |
| 404 | `driver_not_found` | No driver account with this id (already used by dispatch) |
| 404 | `service_zone_not_found` | Unknown zone id, in a path or a body |
| 404 | `water_category_not_found` | Unknown category id in a price rule or a zone fee |
| 404 | `price_list_not_found` | No price list saved yet |
| 409 | `driver_has_accepted_job` | Deactivating or suspending a driver who holds an accepted job ([open question 12](#open-questions)) |
| 409 | `driver_inactive` | Approving or suspending a deactivated account |
| 409 | `partner_phone_not_verified` | Approving a partner whose phone is not verified (FR-003, [partners.md](partners.md#approval-status)) |
| 409 | `service_zone_name_taken` | Another zone has this name, ignoring case |
| 409 | `price_list_changed` | `base_version` is not the current version |
| 409 | `price_list_unchanged` | The rules equal the current version's |
| 422 | `price_rules_overlap` | Two rules with the same zone and category have overlapping bands; `details` names them (`[{"loc": ["body", "rules", 1], ...}]`) |

Examples: see [examples/README.md](examples/README.md#admin-directory-proposed-18).

## Mapping to the design types

For the link issues that follow; the adapters convert with these rules.

| Backend | Design (`domain/admin.ts`) | Rule |
| --- | --- | --- |
| `AdminCustomerSummary.orders_count` | `AdminCustomerSummary.orders` | Same value |
| `AdminCustomer.created_at` | `customer_since` | Format as a Lagos date |
| `paid_total_minor_units` | `total_paid_minor_units` | Same value |
| `Address` | `addresses[]` | `zone` dropped until the screen shows it |
| `recent_orders[].quantity_litres` + `delivery_type` | `recent_orders[].quantity` | Formatted with the quantity rules in [api-mapping.md](../architecture/api-mapping.md#quantities) |
| `recent_orders[].status` | `AdminOrderStatus` | [api-mapping.md](../architecture/api-mapping.md#admin-order-status) |
| `AdminDriver.approval_status` | `approval` | Same value (`pending`, `approved`, `suspended`) |
| `AdminDriver.is_active` | none yet | Deactivated accounts have no design state; the link issue shows them as the error or empty state, never as "suspended" |
| `is_available` | `online` | Same value |
| `vehicle.delivery_type`, `vehicle.safe_payload_litres` | `vehicle.type`, `vehicle.tank_gallons` | Tanker gallons = verified litres ÷ 4; `null` until approval; Keke `null` |
| `vehicle.plate` | `vehicle.plate` | Same value; empty text when `null` (drivers created with the command-line tool before sign-up) |
| `ApprovalChange` | `setRiderApproval` input | `approved` and `suspended` only; the approve form adds the verified vehicle (a screen change, G2, in the link issue) |
| `zones[].name` | `service_areas` | Names |
| `live_jobs`, `delivered_jobs`, `created_at` | `active_orders`, `trips`, `partner_since` | Same values. `trips` reads `delivered_jobs`, not `completed_jobs` (#275); with no `delivered_jobs` (an older server) the screen shows its empty state, never `completed_jobs` |
| `ServiceZone.is_active` | `ServiceArea.enabled` | Same value |
| `ServiceZone.fallback_delivery_fees` | `ServiceArea.fixed_fee_minor_units` | The pilot category's fee (one category is priced in the pilot, #10), or `null` when the zone has none. Saving writes that one entry and keeps the others; adding a zone with a fee sends it as that entry. `ServiceZone.centre` maps to the screen's Latitude and Longitude (`ServiceArea.centre`), typed in by admin (Z4, #111). The design's `station_id` and `distance_km` are dropped from `ServiceArea`; only the mock keeps them, as mock-only data for its dispatch and per-km pricing |
| `PriceList` | `PriceList` | Different shape: the screen is redesigned (decision 1) |

## Data needed

Schema changes for the backend build (each through a reviewed Alembic
migration):

- `service_zones`: `name` (unique, case-insensitive), `is_active`, `centre`
  (PostGIS `geography(Point, 4326)`), `boundary` (`geography(Polygon, 4326)`,
  nullable).
- `service_zone_delivery_fees`: `zone_id`, `water_category_id`,
  `fee_minor_units` (`BigInteger`, at least 0), unique together.
- `customer_addresses`: `customer_id` (`users`), `zone_id`, `label`,
  `address`, `landmark`, `is_default` (one default per customer, enforced by
  a partial unique index). The SRS lists latitude and longitude as optional;
  they are left out until a screen collects them.
- `driver_service_zones`: `driver_profile_id`, `zone_id`, unique together.
- `delivery_type`, `approval_status`, `plate`, `declared_capacity_gallons`,
  `transfer_methods` and a nullable `vehicle_profile_id`: on
  `driver_profiles`, already built with partner sign-up (#14), since every
  driver has a profile and a pending partner has no vehicle profile. No new
  column for approval. **Decided** (@nnamdi-security, 2026-10-28, #45):
  `delivery_type` stays on `driver_profiles` and does not move to
  `vehicle_profiles`.
- `price_list_versions` (`version` unique, `effective_from`, `created_by`,
  `reason`) and `price_rules` (one row per rule, foreign key to its version;
  zone and category foreign keys nullable; amounts `BigInteger` kobo; margin
  type and value).
- Audit actions (NFR-004): `customer_address_added`, `driver_approved`,
  `driver_suspended`, `driver_activated`, `driver_deactivated`,
  `service_zone_created`, `service_zone_updated`, `price_list_saved`.

## Open questions

| # | Question | Source of the gap |
| --- | --- | --- |
| 1 | ~~Which issue builds these endpoints?~~ **Decided**: zones #30, price lists #37 (lane E), the Pricing screen design #44, and the customers and drivers build #45 (blocked on #43) | Process |
| 2 | ~~How does a customer or driver created by staff sign in?~~ **Decided** (@chidimmamogbo, 2026-10-26): staff do not create accounts in the MVP. `POST /admin/customers` and `POST /admin/drivers` are removed; customers register themselves ([auth.md](auth.md)), partners sign up ([partners.md](partners.md#post-authpartner-register)), and "+ New customer" and "+ Add rider" stay "not connected" ([What this covers](#what-this-covers)) | Mock says "Forgot password" later; no SRS rule |
| 3 | **Partly answered by FR-003:** if SMS fails, a dispatcher-controlled, documented manual verification MAY be used. It must be recorded in the audit log with the verifying staff member, and never presented as automated. **Still open:** whether the app gets a screen and endpoint for it, or it stays a written procedure with the command-line tool | FR-003; `auth.md` "Planned" lists a dispatcher fallback needing a written procedure |
| 4 | ~~Does "ordered this week" mean the last 7 days or the calendar week?~~ **Decided** (@chidimmamogbo, 2026-10-26): the last 7 days, as proposed (`ordered_last_7_days`) | Design wording |
| 5 | ~~The Service areas screen has no coordinates field, but FR-010 requires coordinates. Is entering latitude and longitude acceptable, or does the screen need a map?~~ **Decided** (@nnamdi-security, 2026-10-26): `centre` stays required and the admin types latitude and longitude; only the normal ranges are checked | FR-010, decision 10a |
| 6 | ~~How is a typed address matched to a zone without a map pin (FR-020)?~~ **Decided** (@nnamdi-security, 2026-10-26): the customer picks it from `GET /service-zones` (FR-020: the customer submits the zone); staff pick it for addresses they record; no geocoding | FR-020, #30 scope |
| 7 | ~~Do new partners need a `pending` state, beyond FR-002's active and inactive?~~ **Decided** in [partners.md](partners.md#approval-status) (#47): `approval_status` `pending`, `approved` or `suspended`, separate from `is_active`. Applied here as [`POST /admin/drivers/{id}/approval`](#post-admindriversidapproval) | Design `approval`, FR-002 |
| 8 | ~~How is a Keke's verified safe payload entered?~~ **Decided** (#43): the same way as a tanker's, by the admin at approval (`vehicle.safe_payload_litres`, FR-013). The partner never sets it | FR-013, design Settings |
| 9 | Are a plate number and a fleet code (`KK-014`) part of the driver record? **Plate: decided**: the partner declares it at sign-up and the admin checks it at approval ([partners.md](partners.md#open-questions) decision 3); `AdminDriver.vehicle.plate`. **Fleet code: still open**; the SRS has no fleet code | Design fields |
| 10 | ~~Do customer points exist at all?~~ **Decided** (@chidimmamogbo, 2026-10-26): out of the MVP, as in the #14 answers. `adjustPoints` stays not proposed | Design decision 16; no SRS rule |
| 11 | ~~Is rider and driver pay part of the MVP?~~ **Decided** (@chidimmamogbo, 2026-10-26): out of the MVP ([partners.md](partners.md#open-questions) decision 7). Today's earnings and payout due stay "Sample" | Design decision 16; FR-042 |
| 12 | ~~What happens to a job the driver already accepted when the driver is deactivated?~~ **Decided** (@chidimmamogbo, 2026-10-26): deactivation is refused with 409 `driver_has_accepted_job` until the job ends, as proposed. #43 applies the same rule to suspension, so a suspended partner is never left holding a job | FR-002, deliveries.md rows 10-11 |
| 13 | ~~Is a zone's fallback rate per order or per trip, and does it differ by water category or vehicle type?~~ **Decided** (@nnamdi-security, 2026-10-26): one fee per zone and water category, **per order**; not by vehicle type | FR-010, FR-022 |
| 14 | ~~May an admin-entered road distance per zone (decision 10a) stand in for OSRM?~~ **Decided** (@nnamdi-security, 2026-10-26): no. The zone fee is the fallback; `distance_km` and `station_id` are dropped | FR-022, SRS §12.1 |
| 15 | ~~What does FR-010's zone "eligibility" hold?~~ **Decided** (@nnamdi-security, 2026-10-26): no separate field; in the pilot a zone delivers a category when it has a fee for it. Revisit with OSRM. SRS §5's "default pricing zone" is not stored either: a `zone_id: null` price rule does that job | FR-010 wording |
| 16 | ~~Should a price list be scheduled for a future date?~~ **Decided** (@nnamdi-security, 2026-10-26): no; it takes effect when saved. Future dating can be added later | SRS §5 |
| 17 | How is the OSRM distance rounded before the per-km rate (to 0.1 km, to whole km, up or nearest)? **Open until OSRM exists** (@nnamdi-security, 2026-10-26): the pilot prices delivery from zone fees, so no distance is rounded yet | FR-022 |
| 18 | ~~Are FR-022 "handling rates" per order, per litre or per trip?~~ **Decided** (@nnamdi-security, 2026-10-26): per order | FR-022 |
| 19 | Should delivery rates differ for Keke and tanker beyond what quantity bands give? SRS §5 keys rules by zone, band and category, not vehicle type | SRS §5, design a-pricing |

## Changes

| Date | Change | Agreed by |
| --- | --- | --- |
| 2026-11-01 | Amended for #275: `AdminDriver.delivered_jobs`, the count of `completed` assignments whose order is `delivered`; the design's "trips" now reads it ([amendment](#amendment-275-delivered-jobs-on-the-admin-driver)) | @nnamdi-security (technical lead, G3), #275 |
| 2026-10-28 | Amended for #160: `GET /admin/water-categories` (`id`, `label`, `is_active`; `code` left out; inactive categories listed) for the Pricing screen's Water picker ([amendment](#amendment-160-the-list-of-water-categories)); building is #161 | @nnamdi-security (technical lead, G3), PR #163 |
| 2026-10-28 | Built the Drivers section (#45) and settled five edges it left open: a repeat request first, what `counts.available` and `q` count, drivers with no profile, and the partner's `account` message ([decisions](#drivers)); `delivery_type` stays on `driver_profiles` | @nnamdi-security (technical lead), #45 |
| 2026-10-28 | Revised for #43 (customers and drivers): partner approval `POST /admin/drivers/{id}/approval` with vehicle verification (FR-013) and the `phone_verified` rule; `approval_status`, `phone_verified` and the partners.md vehicle object on `AdminDriver`; `approval_status` filter and `pending` count; `POST /admin/customers` and `POST /admin/drivers` removed; address `label` 1-50; suspension refused while a job is accepted; open questions 1, 2, 4, 7, 8, 10, 11 and 12 decided, 3 and 9 partly; order-details-and-price.md linked as a file | @nnamdi-security (technical lead, G3), PR #146 |
| 2026-10-27 | Amended for #74: `GET /admin/service-zones` also returns `pilot_water_category` ([amendment](#amendment-74-the-pilot-category-in-the-admin-zone-list)); built in #109 | @chidimmamogbo and @nnamdi-security (technical lead), PR #108 |
| 2026-10-26 | Price lists section agreed: open questions 16 (takes effect when saved) and 18 (handling per order) decided; 17 open until OSRM | @nnamdi-security (technical lead, #36) |
| 2026-10-26 | `GET /service-zones` needs no session (any caller), for partner sign-up ([partners.md](partners.md) open question 2) | @nnamdi-security (technical lead) |
| 2026-10-26 | Amended for #30: `fallback_delivery_fee_minor_units` replaced by `fallback_delivery_fees` (one fee per water category, per order); `GET /service-zones` for customers; [Which zone an address is in](#which-zone-an-address-is-in) and [Delivery cost from the zone](#delivery-cost-from-the-zone) added; open questions 5, 6, 13, 14 and 15 decided | Service zones section: @nnamdi-security (technical lead, PR #36). Rest: not yet |
| 2026-10-26 | Proposed (#18, PR #34) | Not yet |
