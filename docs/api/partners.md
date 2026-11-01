# Partner account contract

Requirements: FR-001, FR-002, FR-003, FR-013, FR-031, FR-032, FR-050, NFR-002, NFR-004 ·
Issues: #14, #47 · Built in: not yet

**Status: agreed** (G3) on 2026-10-26 by @nnamdi-security, technical lead,
sole approver under #36. Proposed by @Bonvee120 (+ Claude Code) in #14,
revised for #47 with the decisions of @chidimmamogbo (2026-10-26). Not built.

The partner sign-up endpoint also amends the agreed [auth contract](auth.md):
partners become the one exception to "no self-registration for staff". The
amendment is written into `auth.md` in the same pull request and is agreed
with this contract.

Conventions (errors, formats, phone numbers, pagination) are in
[README.md](README.md). Paths below omit `/api/v1`.

## What this covers

The partner apps (Keke rider and tanker driver, one `driver` role,
[api-mapping.md](../architecture/api-mapping.md#names)) call nine functions in
`frontend/src/features/partner/partnerApi.ts` that have no endpoint. This
contract covers six of them:

| Function | Endpoint | In this contract |
| --- | --- | --- |
| `partnerSignup` | `POST /auth/partner-register` | Yes, as an auth amendment |
| `getPartnerProfile` | `GET /driver/profile` | Yes |
| `updatePartnerProfile` | `PATCH /driver/profile` | Yes |
| `setOnline` | `PUT /driver/availability` | Yes |
| `listPartnerNotifications` | `GET /driver/notifications` | Yes |
| `markPartnerNotificationsRead` | `POST /driver/notifications/read` | Yes |
| `uploadDocument` | none | No: out of the MVP ([decision 6](#open-questions)) |
| `getEarnings` | none | No: out of the MVP ([decision 7](#open-questions)) |
| `requestPayout` | none | No: out of the MVP ([decision 7](#open-questions)) |

The last three stay on mocks. With the real API they keep showing "not
connected yet", and the earnings screens keep their "Sample" labels.

## Where this comes from

| Source | What it gives |
| --- | --- |
| `frontend/src/domain/partner.ts` | `PartnerProfile`, `PartnerNotification`, `PartnerSignupInput`, `ApprovalStatus` |
| `frontend/src/mocks/partnerMock.ts` | Behavior: only approved partners go online; sign-up starts `pending`; phone checks; the refusals `partner_not_approved` and `phone_already_registered` |
| `frontend/src/domain/tankCapacity.ts` | Tanker capacity typed at sign-up: 500 to 20,000 gallons |
| [handoff-v1.md](../design/handoff-v1.md) | Decisions 9 and 9a (self sign-up with a vehicle type), 11c (capacity in gallons), 16 (wallet, payouts and rider pay are SAMPLE) |
| [admin-directory.md](admin-directory.md) | `delivery_type` (`keke` or `tanker`), `driver_service_zones`, `GET /service-zones`, the admin side of drivers (#43) |
| [customer-account.md](customer-account.md#notifications) | The in-app notification shape shared with customers (#48) |
| `backend/app/modules/dispatch/models.py` | `DriverProfile.is_available` (FR-031 availability), `VehicleProfile.safe_payload_litres` (FR-013) |
| SRS v0.3 | Every business rule below. Where the SRS is silent, the rule is a recorded decision or an open question |

## Approval status

A partner account has an **approval status**, separate from the account's
`is_active` flag ([decision 1](#open-questions)):

| Status | Meaning | Sign in | Go online | Offered jobs |
| --- | --- | --- | --- | --- |
| `pending` | Signed up; admin has not checked the partner and vehicle yet | Yes | No | No |
| `approved` | Admin checked them and the partner may work | Yes | Yes | Yes, when eligible (FR-031) |
| `suspended` | Admin stopped the partner taking work | Yes | No | No |

*Suspended* stops work only. *Deactivated* (`is_active = false`) blocks
sign-in completely: the account cannot sign in and its sessions stop working
(FR-002, [auth.md](auth.md#roles)). Approval status only applies to active
accounts.

Rules:

- A new partner from `POST /auth/partner-register` starts `pending`, with
  `is_available = false`.
- Moving a partner to `pending` or `suspended` also sets `is_available =
  false`, so they drop out of dispatch at once.
- Only an admin changes approval status. The admin endpoint is in the admin
  drivers contract, [admin-directory.md](admin-directory.md#drivers) (#43);
  this contract only defines the states.
- An admin can approve a partner only when the partner's phone is verified
  (`phone_verified: true`, FR-003; [decision 9](#open-questions)). The admin
  checks the vehicle and its papers in person before approving
  ([decision 6](#open-questions)). The approval endpoint's refusal for an
  unverified phone, and its error code, are set in #43.
- Existing drivers, created with the command-line tool, are backfilled as
  `approved` by the migration, so nothing changes for them.
- **Dispatch (amendment to [deliveries.md](deliveries.md#assignment-statuses-built-in-s1-07)):**
  row 8 eligibility gains the reason `not_approved` ("The partner's approval
  status is not `approved`"). This is additive. A pending or suspended
  partner is never offered a job, so their `GET /driver/jobs` lists are empty.

## Partner object (`PartnerProfileRead`)

Returned by `GET /driver/profile`, `PATCH /driver/profile` and
`PUT /driver/availability`. Examples:
[examples/partner-profile.json](examples/partner-profile.json) (approved Keke
rider), [examples/partner-profile-pending.json](examples/partner-profile-pending.json)
(tanker driver just after sign-up).

```json
{
  "id": "4a2e8c1d-6b3f-4e7a-9c15-2d8f0b6a7e31",
  "name": "Sample Rider",
  "phone": "+2348000000301",
  "phone_verified": true,
  "approval_status": "approved",
  "is_available": true,
  "partner_since": "2026-08-14",
  "vehicle": {
    "delivery_type": "keke",
    "plate": "ENU-123-AB",
    "description": "Tricycle with 1,000 L tank",
    "declared_capacity_gallons": null,
    "declared_capacity_litres": null,
    "safe_payload_litres": 1000,
    "transfer_methods": ["ground"]
  },
  "service_zones": [{ "id": "8d0b2f4e-1c7a-4b9e-a3f6-5e2d9c8b7a10", "name": "GRA" }],
  "preferences": { "new_order_alerts": true, "sms_updates": true }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id`, `name`, `phone`, `phone_verified` | as the [User object](auth.md#user-object) | The signed-in partner's own account. `phone_verified` must be `true` before approval ([decision 9](#open-questions)) |
| `approval_status` | `pending`, `approved`, `suspended` | See [Approval status](#approval-status). Clients must not fail on a value they do not know |
| `is_available` | boolean | `DriverProfile.is_available` (FR-031 "availability"). The design calls it "online" |
| `partner_since` | `YYYY-MM-DD` (Africa/Lagos) | The day the account was created |
| `vehicle.delivery_type` | `keke`, `tanker` | Chosen at sign-up (decision 9). Picks the app and the word "rider" or "driver". Same field and values as `delivery_type` in [admin-directory.md](admin-directory.md#objects-1) |
| `vehicle.plate` | string | As entered at sign-up, after the [plate rule](#post-authpartner-register) |
| `vehicle.description` | string or `null` | The vehicle profile's `vehicle_type` text, set by admin. `null` until admin links a vehicle profile |
| `vehicle.declared_capacity_gallons` | integer or `null` | Tanker only: what the driver typed at sign-up. `null` for Keke |
| `vehicle.declared_capacity_litres` | integer or `null` | `declared_capacity_gallons × 4` (1 local gallon = 4 L, [api-mapping.md](../architecture/api-mapping.md#quantities)). A claim, not a verified payload |
| `vehicle.safe_payload_litres` | integer or `null` | The **verified** safe payload from the vehicle profile (FR-013). `null` until admin verifies it. The design shows `[SAFE LOAD]` while it is `null` |
| `vehicle.transfer_methods` | list of strings | FR-013 "whether the operator can handle a given transfer method". Set by admin; empty until then. Values follow `tank_type` in [order-details-and-price.md](order-details-and-price.md#delivery-details): `ground`, `overhead`. See [open question 4](#open-questions) |
| `service_zones` | list of `{id, name}` | Zones the partner works in (FR-031 "service area"), from `driver_service_zones` ([admin-directory.md](admin-directory.md#data-needed)), so it means the same as `zones` on `AdminDriver`. The zone chosen at sign-up is the first row |
| `preferences` | object of two booleans | See [Preferences](#preferences) |

Not in this object: email ([decision 5](#open-questions)), documents
([decision 6](#open-questions)) and the payout account
([decision 7](#open-questions)).

### Capacity: declared and verified

A tanker driver types their capacity in gallons at sign-up (design answer
11c). That figure is a **declaration**. An admin checks the vehicle and
records the verified safe payload in litres on the vehicle profile
(FR-013: "each vehicle's verified safe usable water payload in litres").
Dispatch uses only `safe_payload_litres` (BR-03, deliveries.md row 8
`over_payload`). A partner can never set or change the verified payload.

### Preferences

| Field | Default at sign-up | Meaning |
| --- | --- | --- |
| `new_order_alerts` | `true` | Tell me when a job is offered to me |
| `sms_updates` | `true` | Send job updates by SMS as well as in the app |

Both are **stored only** ([decision 5](#open-questions)). No partner SMS, push
or email is sent yet, so they change nothing today. When partner messages are
added, a preference never turns off a message the SRS requires. The defaults
are the mock's.

## `POST /auth/partner-register`

Amends [auth.md](auth.md#endpoints). Partner self sign-up (decision 9). Like
`POST /auth/register`, it needs no session and no CSRF token, and starts a
session.

**Request** ([examples/partner-register-request.json](examples/partner-register-request.json))

```json
{
  "name": "Sample Driver",
  "phone": "08000000302",
  "password": "sample-password",
  "delivery_type": "tanker",
  "plate": "enu 456 cd",
  "declared_capacity_gallons": 4000,
  "service_zone_id": "8d0b2f4e-1c7a-4b9e-a3f6-5e2d9c8b7a10"
}
```

| Field | Rule |
| --- | --- |
| `name`, `phone`, `password` | As `POST /auth/register` ([auth.md](auth.md#identifier-and-password-rules)) |
| `delivery_type` | `keke` or `tanker` |
| `plate` | Trimmed and upper-cased, then 4 to 15 characters of letters, digits, spaces and hyphens. No check of the Nigerian plate format: the admin checks the real plate at approval ([decision 3](#open-questions)) |
| `declared_capacity_gallons` | Tanker: required, a whole number from 500 to 20,000 (`tankCapacity.ts`: 500 is the smallest tanker order; 20,000 only catches typos). Keke: must be `null` or absent |
| `service_zone_id` | An active zone from `GET /service-zones` ([admin-directory.md](admin-directory.md#get-service-zones), no session needed). Stored as the partner's first `driver_service_zones` row |

**201** `Session` with the session cookie, as `POST /auth/register`. The user
has `role: "driver"` and `phone_verified: false`. The partner starts
`pending` and unavailable. To be approved, the partner verifies the phone with
the FR-003 SMS code endpoints
([auth.md](auth.md#phone-verification-fr-003-fr-004), decision 9).

**What the server records**

- The `users` row (`role = driver`, `is_active = true`) and a driver profile
  with `approval_status = pending`, `is_available = false`, the delivery type,
  plate and declared capacity, and one `driver_service_zones` row for the zone.
- No vehicle profile link yet: admin links or creates one when approving.
  `DriverProfile.vehicle_profile_id` is `NOT NULL` today, so the build needs a
  migration that makes it nullable (see [open question 8](#open-questions)).
- An audit log entry (NFR-004) and a notice for admin that a partner is waiting.

**Errors**

| Status | `code` | When |
| --- | --- | --- |
| 409 | `phone_already_registered` | The phone already has an account (any role) |
| 422 | `validation_error` | Any field rule above, including an unknown or inactive `service_zone_id`; `loc` names the field, for example `["body", "plate"]` |
| 429 | `too_many_attempts` | Shares the registration limit: 20 per IP per hour, whatever the outcome ([auth.md](auth.md#behavior-notes)) |

## `GET /driver/profile`

Driver session. **200** `PartnerProfileRead`.

| Status | `code` | When |
| --- | --- | --- |
| 401 | `not_authenticated` | No valid session |
| 403 | `forbidden` | The account is not a driver |

## `PATCH /driver/profile`

Driver session and CSRF. Changes the preferences. Every other field is
admin-managed or fixed at sign-up.

**Request** ([examples/partner-profile-update-request.json](examples/partner-profile-update-request.json))

```json
{ "preferences": { "sms_updates": false } }
```

- `preferences`: any subset of the two booleans; the rest keep their value.
- Any other field, including `email`, is 422 `validation_error`.

**200** `PartnerProfileRead`.

| Status | `code` | When |
| --- | --- | --- |
| 401 | `not_authenticated` | No valid session |
| 403 | `forbidden` | Not a driver |
| 403 | `csrf_failed` | Missing or wrong CSRF token |
| 422 | `validation_error` | An unknown field, or a non-boolean preference; `loc` names it, for example `["body", "preferences", "sms_updates"]` |

## `PUT /driver/availability`

Driver session and CSRF. Going online or offline (FR-031 "availability").
Today the command-line tool sets `is_available`; this lets the partner set it.

**Request** ([examples/partner-availability-request.json](examples/partner-availability-request.json))

```json
{ "is_available": true }
```

**200** `PartnerProfileRead`. Setting the value it already has is not an
error.

Rules:

- Going **online** needs an active account (FR-002) and `approval_status =
  approved` ([Approval status](#approval-status)). Otherwise 403
  `partner_not_approved`.
- Going **offline** is always allowed, also for pending and suspended
  partners.
- Going offline does not touch a job the partner already holds: an offered
  job stays offered and an accepted job stays accepted (deliveries.md). It
  only stops new offers (row 8 `unavailable`).

| Status | `code` | When |
| --- | --- | --- |
| 401 | `not_authenticated` | No valid session |
| 403 | `forbidden` | Not a driver |
| 403 | `csrf_failed` | Missing or wrong CSRF token |
| 403 | `partner_not_approved` | Going online while `pending` or `suspended`. Example: [examples/error-partner-not-approved.json](examples/error-partner-not-approved.json) |
| 422 | `validation_error` | `is_available` missing or not a boolean |

## Notifications

The partner's in-app messages. FR-050 (P1, SHOULD): "configurable event
messages", stored in the SRS §5 `notifications` table (`order_id or
user_id`) as channel `in_app`. The shape is the one customers use
([customer-account.md](customer-account.md#notifications), #48), so both apps
read one table the same way. The backend has **no notifications table yet**;
building this adds one.

### `GET /driver/notifications`

Driver session. Newest first. Query: `limit` and `offset`
([pagination](README.md#pagination)).

**200** ([examples/partner-notifications.json](examples/partner-notifications.json))

```json
{
  "items": [
    {
      "id": "c3e1a9b0-5d7f-4a2c-8e6b-1f0d9a3c5b72",
      "kind": "assigned",
      "title": "Admin assigned you an order",
      "body": "MO-3HT8WQ2KZP · 600 L · Independence Layout",
      "reference": "MO-3HT8WQ2KZP",
      "created_at": "2026-10-26T09:12:00Z",
      "read_at": null
    }
  ],
  "unread_count": 1,
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

| Field | Notes |
| --- | --- |
| `kind` | One of the values below. Clients must not fail on one they do not know; they show its `title` and `body` |
| `title`, `body` | Written by the server from a template. Templates must not promise unverified delivery or water quality (FR-050) |
| `reference` | The order's public reference when the message is about one order, else `null`. Never the delivery code (SRS §5 `notifications`) |
| `read_at` | UTC timestamp, or `null` while unread |
| `unread_count` | Unread messages across all pages, for the menu badge |

`kind` values, from the mock:

| `kind` | Created when | Source |
| --- | --- | --- |
| `assigned` | Admin offers the partner a job | FR-031, FR-032 |
| `reassigned` | Admin withdraws or cancels a job the partner held | deliveries.md rows 10 and 11 |
| `account` | Approval status changes (approved, suspended, back to approved) | [Approval status](#approval-status) |
| `new_orders` | New jobs near the partner | The design's job pool. No endpoint offers a pool yet ([api-mapping.md](../architecture/api-mapping.md#open-questions), question 6, #12), so this is not created for now |
| `station_closed` | A refill station closes | Not created: stations stay on the command-line tool ([admin-directory.md](admin-directory.md#decisions-taken-in-18), decision 5) |
| `papers_due` | A partner document is about to expire | Not created: documents are out of the MVP ([decision 6](#open-questions)) |
| `payout` | A payout is sent | Not created: payouts are out of the MVP ([decision 7](#open-questions)) |

Only the in-app message is created. Sending a copy by SMS or push waits for
partner messaging: push depends on [push.md](push.md), which is not agreed
yet (#8), and the preferences are stored only ([decision 5](#open-questions)).
Creating a message never changes an order's status (FR-050).

| Status | `code` | When |
| --- | --- | --- |
| 401 | `not_authenticated` | No valid session |
| 403 | `forbidden` | Not a driver |
| 422 | `validation_error` | Bad `limit` or `offset` |

### `POST /driver/notifications/read`

Driver session and CSRF. **204**.

**Request** ([examples/partner-notifications-read-request.json](examples/partner-notifications-read-request.json))

```json
{ "ids": ["c3e1a9b0-5d7f-4a2c-8e6b-1f0d9a3c5b72"] }
```

- With `ids` (up to 100), marks those as read. Unknown ids, and ids of other
  people's messages, are ignored, so nothing can be probed.
- With no body or `{}`, marks every unread message of the partner as read, as
  the screen does when it opens.

| Status | `code` | When |
| --- | --- | --- |
| 401 | `not_authenticated` | No valid session |
| 403 | `forbidden` | Not a driver |
| 403 | `csrf_failed` | Missing or wrong CSRF token |
| 422 | `validation_error` | `ids` is not a list of UUIDs, or has more than 100 |

## Mapping to the design types

For the #12 and #13 adapters. Rules follow
[api-mapping.md](../architecture/api-mapping.md); any change to that file
goes in its own PR.

| Design (`domain/partner.ts`) | Contract |
| --- | --- |
| `PartnerProfile.approval` | `approval_status` |
| `PartnerProfile.online` | `is_available` |
| `PartnerProfile.vehicle.type` | `vehicle.delivery_type` |
| `PartnerProfile.vehicle.tank_gallons` | `vehicle.declared_capacity_gallons` |
| `PartnerProfile.vehicle.safe_load_litres` | `vehicle.safe_payload_litres` (`null` shows `[SAFE LOAD]`) |
| `PartnerProfile.vehicle.can_pour_into` | Built from `vehicle.transfer_methods` |
| `PartnerProfile.vehicle.description` | `vehicle.description`; when `null`, the adapter builds it from `delivery_type` and the declared capacity |
| `PartnerProfile.service_areas` | `service_zones[].name` |
| `PartnerProfile.documents` | Not returned. The adapter returns `[]`, and the papers screen keeps "not connected yet" for uploads |
| `PartnerProfile.payout_account_ending` | Not returned. The adapter returns `null` |
| `PartnerNotification.at` | `created_at` |
| `PartnerNotification.read` | `read_at !== null` |
| `PartnerSignupInput.vehicle_type` | `delivery_type` |
| `PartnerSignupInput.tank_gallons` | `declared_capacity_gallons` |
| `PartnerSignupInput.service_zone_id` | `service_zone_id`: the ID of the active zone the partner picked in the sign-up dropdown, listed by `GET /service-zones` (until 2026-10-31 the screen sent free text and the adapter matched it to a zone by name) |

## Open questions

Numbering is kept so review comments still match. Decided questions say who
decided and when. Recommendations are proposals, not decisions.

1. ~~**Approval status (FR-002).**~~ **Decided** (@chidimmamogbo,
   2026-10-26): confirmed as proposed. Pending and suspended partners can
   sign in, but cannot go online or be offered jobs. *Suspended* stops work
   only; *deactivated* (`is_active = false`) blocks sign-in completely
   (FR-002). Applied in [Approval status](#approval-status).
2. ~~**Zone at sign-up.**~~ **Decided** (@nnamdi-security, technical lead,
   2026-10-26): `GET /service-zones`
   ([admin-directory.md](admin-directory.md#get-service-zones), built in #30)
   needs no session, so sign-up can list the active zones (`id` and `name`
   only).
3. ~~**Plate format.**~~ **Decided** (@chidimmamogbo, 2026-10-26): no
   Nigerian-format check. 4 to 15 characters, letters, digits, spaces and
   hyphens, trimmed and upper-cased; otherwise 422 `validation_error`. The
   admin checks the real plate at approval.
4. ~~**Transfer methods (FR-013).**~~ Who sets them, and which values? The design
   says Keke riders pour into "Drums, ground tanks" and tankers into "Ground
   and overhead tanks (pump)", but orders only know `ground` and `overhead`
   (#10). **Decided** (@nnamdi-security, 2026-10-26): the admin sets them at
   approval, with the two `tank_type` values only (`ground`, `overhead`),
   until the business adds drums. A partner never sets them.
5. ~~**Preferences.**~~ **Decided** (@chidimmamogbo, 2026-10-26; amended the
   same day in the #48 review): keep `new_order_alerts` and `sms_updates`,
   stored only. No partner SMS, push or email is sent yet, so they change
   nothing today; they never turn off a message the SRS requires. **No partner
   email in the pilot:** the privacy notice (§3) covers everyone with an
   account, drivers included, and says the app does not collect email, and
   there is no email provider (SRS §12). `email` and `offers_and_news`
   (marketing, which would need a notice update) are removed.
6. ~~**Documents.**~~ **Decided** (@chidimmamogbo, 2026-10-26): driver
   documents are out of the MVP. The admin checks papers in person before
   approving. Uploads stay "not connected yet"; no private storage (NFR-006)
   is added.
7. ~~**Earnings, wallet and payouts.**~~ **Decided** (@chidimmamogbo,
   2026-10-26): out of the MVP. No SRS requirement covers partner pay, and
   PRD §3.2 lists wallets as a non-goal. The screens stay "not connected yet"
   with their "Sample" labels; the admin rider payouts in #22 do the same.
8. ~~**Pending partners and vehicle profiles.**~~ A pending partner has no
   verified vehicle, but `DriverProfile.vehicle_profile_id` is `NOT NULL`.
   **Decided** (@nnamdi-security, 2026-10-26): make it nullable in the build
   migration and keep the declared vehicle on the driver profile; the admin
   links or creates the vehicle profile at approval. Dispatch already rejects
   a driver without a usable vehicle (`no_driver_profile`,
   `vehicle_inactive`).
9. ~~**Partner phone verification.**~~ **Decided** (@chidimmamogbo,
   2026-10-26): drivers may use the FR-003 SMS code endpoints
   (`POST /auth/phone-verification` and `/verify`), and an admin can approve
   a partner only when `phone_verified` is `true`. The check and its error
   belong to the approval endpoint in #43. Applied in `auth.md` in the same
   pull request.

## Changes

| Date | Change | Agreed by |
| --- | --- | --- |
| 2026-10-27 | Mapping only, the contract is unchanged: `PartnerProfile.email` and `preferences.offers_and_news` left the design type, so their two rows are gone (#85) | @chidimmamogbo (decision on #85) |
| 2026-10-26 | Agreed (G3): open questions 4 (admin sets transfer methods at approval, `ground` and `overhead`) and 8 (`vehicle_profile_id` nullable) decided; the `auth.md` amendment agreed with it | @nnamdi-security (technical lead, #36) |
| 2026-10-26 | Revised for #47: open questions 1, 3, 5, 6, 7 and 9 decided and applied; the approval endpoint is in #43; the sign-up zone is the first `driver_service_zones` row; `station_closed` not created and push depends on `push.md`; `email` and `offers_and_news` removed; notifications use the customer shape (`read_at`, `unread_count`, `ids` on mark-read); `vehicle.kind` and `vehicle_kind` renamed `delivery_type` to match `admin-directory.md`; `phone_verified` added to the profile; `auth.md` amended | Not yet |
| 2026-10-26 | Proposed (#14, PR #35): partner sign-up (auth amendment), approval status, profile read and update, availability, notifications. Documents, earnings and payouts left out | Not yet |
