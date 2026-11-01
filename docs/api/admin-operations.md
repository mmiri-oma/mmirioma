# Admin operations contract: dashboard, live map, activity, reports, support, audit log, notifications, settings

Requirements: FR-001, FR-030, FR-032, FR-035, FR-036, FR-037, FR-041,
FR-052, FR-053, FR-055, BR-09, BR-12, NFR-003, NFR-004 · Issue: #22 ·
Built in: #102 (part 1: shell, support requests, audit log, admin
notifications without `assignment_expired`, settings; part 2: dashboard,
live map, activity, reports;
[feature doc](../features/admin-operations.md))

**Status: agreed** (G3) on 2026-10-27 by @nnamdi-security (technical lead,
backend, contract owner) and @chidimmamogbo (frontend, approved PR #71).
Proposed the same day by @nnamdi-security (+ Claude Code). Built in #102
(see "Built in" above). The
[open questions](#open-questions) stay open; until each is decided, the build
does exactly what the body says (for example, no reopen and no order-level
CSV).

The remaining admin screens run on mocks with no backend. This contract
proposes the endpoints that let them leave the mocks, and says which mock
functions get **no** endpoint because the SRS or an earlier decision leaves
them out. Conventions (base path `/api/v1`, errors, formats, pagination,
`is_simulated`) are in [README.md](README.md).

## What this covers

Fork functions in `frontend/src/features/admin/adminApi.ts`:

| Function | This contract |
| --- | --- |
| `getShellData` | [`GET /admin/shell`](#get-adminshell), with the user from `GET /auth/me` |
| `getDashboard` | [`GET /admin/dashboard`](#get-admindashboard) |
| `getLiveMap` | [`GET /admin/live-map`](#get-adminlive-map) |
| `listActivity` | [`GET /admin/activity`](#get-adminactivity) |
| `getReport` | [`GET /admin/reports`](#get-adminreports) |
| `listIssues` | [`GET /admin/support-requests`](#get-adminsupport-requests) |
| `getIssuePeople` | [`GET /admin/support-requests/{reference}`](#get-adminsupport-requestsreference) (`contacts`) |
| `resolveIssue` | [`POST /admin/support-requests/{reference}/resolve`](#post-adminsupport-requestsreferenceresolve): resolve with a note only ([decision 2](#decisions-taken-in-22)) |
| `listAudit` | [`GET /admin/audit-logs`](#get-adminaudit-logs) |
| `listAdminNotifications` | [`GET /admin/notifications`](#get-adminnotifications) |
| `markAdminNotificationsRead` | [`POST /admin/notifications/read`](#post-adminnotificationsread) |
| `getSettings` | [`GET /admin/settings`](#get-adminsettings), read only |
| `saveSettings` | **Not proposed** ([decision 4](#decisions-taken-in-22)) |
| `getAdminAccount` | No new endpoint: `GET /auth/me` ([auth.md](auth.md#endpoints)) |
| `listPayouts`, `markPayoutPaid` | **Not proposed**: partner pay and payouts are out of the MVP ([decision 5](#decisions-taken-in-22)) |
| `adjustPoints`, `refundAsPoints` | **Not proposed**: points are out of the MVP and refunds are recorded outside the app in the pilot ([decision 6](#decisions-taken-in-22)) |

A function that is not proposed stays on its mock. In real-API mode its
screen shows the "not connected yet" state, as the
[linking plan](../process/linking-plan.md#not-in-the-backend-yet) says.

## Where this comes from

| Source | What it gives |
| --- | --- |
| `frontend/src/domain/admin.ts` | `AdminDashboard`, `AdminReport`, `AdminIssue`, `AuditEntry`, `ActivityEntry`, `AdminNotification`, `AdminSettings`, `StaffMember`, `AdminPayout` |
| `frontend/src/mocks/adminMock.ts` | Each function's behavior and refusals (`issue_not_found`, `already_resolved`, reason of at least 5 characters, staff only) |
| `frontend/src/features/admin/pages/` | What each screen shows: `Dashboard.tsx`, `Reports.tsx`, `Support.tsx`, `AccountPages.tsx` (settings, audit log, notifications, account, live map), `Earnings.tsx`, `Loyalty.tsx` |
| [handoff-v1.md](../design/handoff-v1.md) | Decision 14 (map and ETA only where real data backs them), decision 16 (points, wallet, payouts, rider pay are SAMPLE) |
| [customer-account.md](customer-account.md#support-requests) | The customer side of support requests (agreed, #11 and #48) and the `support_requests` table |
| [partners.md](partners.md#notifications), [customer-account.md](customer-account.md#notifications) | The shared notification shape |
| [public-site.md](public-site.md) | Support contact from backend settings only (FR-055) |
| [payments.md](payments.md) | Cash collections (the pilot's only payments, F4) and their statuses |
| [deliveries.md](deliveries.md), [orders.md](orders.md) | Order statuses, order events, holds, existing admin endpoints |
| `backend/app/modules/*/models.py` | `orders.is_simulated`, `order_events`, `order_exceptions`, `cash_collections`, `pickup_records`, `driver_profiles.is_available`, `water_sources`, `audit_logs`, `notifications`, `user_sessions` |
| SRS v0.3 | Every business rule below; it is normative where it differs from the mocks |

### Where the design goes beyond the SRS

| Design element | Conflict | This contract |
| --- | --- | --- |
| Dashboard "Rider payouts due", Earnings page, report "Earned" column | No SRS requirement covers partner pay; PRD §3.2 lists wallets as a non-goal | Left out ([decision 5](#decisions-taken-in-22)) |
| "Payments to verify" | The pilot is pay on delivery only (F4); there are no transfers to verify | Left out |
| Goodwill points, refund as points, points adjustments | The SRS has no points; FR-043 refunds go back through the payment method or a verified bank account | Left out ([decision 6](#decisions-taken-in-22)) |
| Support resolutions that act on the order (confirm without code, reassign, cancel) | Each already has an agreed endpoint with its own rules (FR-035 alternative proof, withdraw, cancel) | Resolve with a note only; the action goes through its own endpoint ([decision 2](#decisions-taken-in-22)) |
| Editable support phone and WhatsApp | FR-055: one central configuration value | Read only, from backend settings ([public-site.md](public-site.md)) |
| Editable "code time limit" | FR-035: 10 minutes, final | Read only, the server constant |
| "Safe load" per vehicle type as free text | FR-013: a verified payload in litres per vehicle profile | Not in settings; it belongs to vehicle profiles |
| Staff roles "Super admin", "Dispatcher", "Support" | SRS §2 and auth.md: one `admin` role | Every staff member is `admin` |
| Revenue from SAMPLE prices, refunds, costs and contribution (FR-052) | Refunds are outside the app (F7) and costs on a measurement sheet (F6) in the pilot | Collected cash only; refunds, costs and contribution are not returned ([Reports](#get-adminreports)) |
| "Stations open/closed" | Water sources have no opening hours; FR-012 decides whether a source may be used | Sources counted as usable or not usable (FR-012) |
| Rider "online" | The SRS calls it availability (FR-031) | `DriverProfile.is_available`, as in [partners.md](partners.md) |

## Decisions taken in #22

Agreed with the lane owner (@nnamdi-security, 2026-10-27) before writing:

1. **Only `docs/api/` changes** in this pull request: this file, its
   examples and one README row.
2. **Support covers customer support requests only.** Staff resolve a
   request with a required note (audited). Confirming without the code
   (FR-035 alternative proof), reassigning (withdraw) and cancelling go
   through their existing agreed endpoints in
   [deliveries.md](deliveries.md). Goodwill points are dropped. Driver
   incidents stay on the order and its hold review.
3. **Reports and the dashboard count real orders by default** (BR-09).
   `simulated=only` returns the same numbers for simulated records only,
   flagged `is_simulated: true`, so the demo still shows numbers and the
   screen keeps its SAMPLE tag ([Simulated data](#simulated-data)).
4. **Settings are read only:** the support contact and code validity from
   backend settings, and the staff list. No save endpoint. Support hours have
   no SRS rule ([open question 4](#open-questions)).
5. **Payouts are not proposed**, as decided in
   [partners.md](partners.md#open-questions) decision 7 (@chidimmamogbo,
   2026-10-26): "the admin rider payouts in #22 do the same".
6. **Points are not proposed**, as decided in
   [customer-account.md](customer-account.md#decisions) decision 12, and
   `refundAsPoints` also conflicts with FR-043. Refunds are recorded outside
   the app in the pilot (F7, [payments.md](payments.md#decisions)).

## Decisions taken in #102

Points the body left open, decided by the technical lead
(@nnamdi-security, 2026-10-27) during the build:

7. **`range` is required** on `GET /admin/reports`. The screen always sends
   a pill; a missing `range` is a client error (422 `validation_error`),
   not a silent default.
8. **`by_zone[].delivered`** counts the zone's deliveries in the range, by
   the time of their `delivered` event (the rule of `deliveries.delivered`),
   so the zone rows add up to the total.
9. **Per driver and per source.** A delivery's driver is the one on the
   order's `completed` assignment (the `delivered` event records no
   assignment). Pickups at another source (FR-034) have no source row and
   are left out of `by_source`.
10. **Indexes added now** for the date filters (revision `0022`): cash
    `collected_at`, delivered events, and pickup times.

## Access rules

- Every endpoint requires a signed-in, active `admin` ([auth.md](auth.md)).
  Customers and drivers get 403 `forbidden` (FR-001).
- Unsafe requests (`POST`) need the `X-CSRF-Token` header (403
  `csrf_failed`).
- Writes record an audit row (NFR-004) with ids and kinds only; never phones,
  addresses or notes in `metadata` (`backend/app/modules/audit/models.py`).
  One exception, decided on #293: the reason of a staff decision about a driver
  (`driver_approved`, `driver_suspended`, `driver_activated`,
  `driver_deactivated`) is stored in `details.reason`, because the audit row is
  the only place it is kept (see `GET /admin/audit-logs`). When the driver is
  anonymized, `reason` is removed and `details.reason_removed: true` is set in
  its place (#298).
- Phones and names of customers and drivers go to staff only (NFR-003).
  Reports carry no customer data (FR-053: "minimal customer data").
- Shared errors (401 `not_authenticated`, 403 `forbidden`, 403
  `csrf_failed`, 422 `validation_error`, 503 `service_unavailable`) apply to
  every endpoint and are not repeated below.

## Simulated data

BR-09: unverified, test and simulated orders are excluded from actual
financial, operational and customer performance reports. FR-052 repeats it
for the dashboard.

- `GET /admin/dashboard` and `GET /admin/reports` take
  `simulated=exclude` (default) or `simulated=only`. Any other value is 422
  `validation_error`. Both numbers are never mixed: there is no "include".
- Each response says `"is_simulated": false` or `true`, so the screen shows
  its SAMPLE tag only when the numbers come from simulated records.
- An order counts as simulated when `orders.is_simulated` is true. Cash
  collections, pickups and deliveries follow their order.
- Operational lists (live map, activity, support requests) are not reports:
  they show every record, each with its `is_simulated` flag where the record
  has one, so staff can still act on a demo order.

## Time ranges

- Days are **Africa/Lagos** calendar days (SRS §2.1), sent as `YYYY-MM-DD`.
- An order belongs to a day by its `created_at`. A delivery belongs to a day
  by the time of its `delivered` event; a cash collection by its
  `collected_at`.
- Durations are whole minutes, rounded down.

## `GET /admin/shell`

The sidebar badges and the header bell, on every admin page. The name and
role come from `GET /auth/me` ([auth.md](auth.md#user-object)); the adapter
calls both.

**200** ([examples/admin-shell.json](examples/admin-shell.json))

```json
{ "orders_needing_action": 3, "support_requests_open": 1, "notifications_unread": 2 }
```

| Field | Rule |
| --- | --- |
| `orders_needing_action` | Orders in `quote_requested`, `awaiting_confirmation` or `confirmed` with no live assignment: what the dispatcher must confirm or assign next (FR-030, FR-031). Simulated orders are counted, since staff act on them too |
| `support_requests_open` | Support requests with `status = open` |
| `notifications_unread` | This admin's unread notifications ([Notifications](#get-adminnotifications)) |

## `GET /admin/dashboard`

FR-052 (P1, SHOULD): "orders by status, completed deliveries, on-time
count/rate, collected revenue, refunds, variable costs, contribution per order
and service-zone results". Query: `date` (Lagos date, default today; not in
the future, else 422 `validation_error`) and `simulated`.

**200** ([examples/admin-dashboard.json](examples/admin-dashboard.json))

```json
{
  "date": "2026-10-27",
  "is_simulated": false,
  "orders": {
    "total": 14,
    "by_status": { "confirmed": 2, "assigned": 1, "en_route": 3, "delivered": 7, "cancelled": 1 },
    "oldest_waiting_minutes": 42
  },
  "deliveries": { "delivered": 7, "with_window": 6, "on_time": 5 },
  "by_delivery_type": { "keke": 9, "tanker": 5, "not_recorded": 0 },
  "holds_open": 1,
  "support_requests_open": 1,
  "drivers_available": { "total": 4, "keke": 3, "tanker": 1 },
  "sources": { "usable": 2, "not_usable": 1 },
  "cash": { "collected_minor_units": 4130000, "reconciled_minor_units": 2950000 }
}
```

| Field | Rule |
| --- | --- |
| `orders.total` | Orders created on `date`, plus older orders that are still open (not `delivered`, `cancelled` or `failed`). The screen says "Orders today, including open orders" |
| `orders.by_status` | The same orders counted by backend `status` (FR-033). Statuses with no orders are left out. The adapter groups them into the design's statuses with [api-mapping.md](../architecture/api-mapping.md#admin-order-status) |
| `orders.oldest_waiting_minutes` | Minutes since the oldest order in `quote_requested`, `awaiting_confirmation` or `confirmed` with no live assignment was created; `null` when none waits |
| `deliveries.delivered` | Orders delivered on `date` |
| `deliveries.with_window` | Of those, the ones with a confirmed delivery window |
| `deliveries.on_time` | Of those, the ones delivered at or before the window's end (FR-052 on-time count; the rate is `on_time / with_window`, computed by the screen). An order without a window is never counted as on time |
| `by_delivery_type` | `orders.total` split by the order's `delivery_type` ([order-details-and-price.md](order-details-and-price.md), built in #21). `not_recorded` counts orders without one (created before #21); they are never guessed into a type |
| `holds_open` | Jobs with an open hold waiting for an administrator ([deliveries.md](deliveries.md#admin-hold-review-endpoints)): FR-032 asks for driver rejection and timeouts "through dashboard state", and holds are the reviews staff must act on |
| `support_requests_open` | Open support requests (the design's "issues open") |
| `drivers_available` | Active, approved drivers with `is_available = true` (FR-031), split by delivery type. Drivers with no delivery type count in `total` only |
| `sources.usable`, `sources.not_usable` | Water sources with at least one category usable for dispatch under FR-012 (the existing eligibility check in `backend/app/modules/sources/eligibility.py`), and the rest |
| `cash.collected_minor_units` | Sum of cash collections recorded on `date` (FR-041), integer kobo. FR-052's "collected revenue" for the pilot, which is pay on delivery only (F4) |
| `cash.reconciled_minor_units` | Of that, the amount already `reconciled` |

Not returned, because the pilot does not record them in the app: refunds
(F7), variable costs and contribution (F6). The screen must not show them as
zero. Not returned either: payouts due and payments to verify (see
[Where the design goes beyond the SRS](#where-the-design-goes-beyond-the-srs)).

`drivers_available`, `sources`, `holds_open` and `support_requests_open` are
"now" values, not counts for `date`, and are the same for both `simulated`
values.

## `GET /admin/live-map`

The drawn map on the dashboard and the live map page. **No GPS** (FR-037: no
false real-time tracking; design decision 14): the screen places each
delivery by its source and zone, and says so.

**200** ([examples/admin-live-map.json](examples/admin-live-map.json))

```json
{
  "deliveries": [
    {
      "reference": "MO-7KQ2M9XH4T",
      "status": "en_route",
      "delivery_type": "keke",
      "driver": { "id": "5a0e...", "name": "Sample Driver One", "plate": "ENU-123-KK" },
      "source": { "id": "9c1d...", "name": "Sample Borehole A" },
      "zone": { "id": "2f4b...", "name": "Independence Layout" },
      "is_simulated": true
    }
  ],
  "sources": [
    { "id": "9c1d...", "name": "Sample Borehole A", "approximate_location": "Off Ogui Road", "usable": true, "is_simulated": true }
  ]
}
```

| Field | Rule |
| --- | --- |
| `deliveries` | Orders with an accepted assignment in `accepted`, `departed`, `collected`, `en_route`, `arrived` or `unloading`, oldest first |
| `status` | Backend order status; the adapter maps it ([api-mapping.md](../architecture/api-mapping.md#admin-order-status)) |
| `delivery_type`, `zone` | The order's `delivery_type` and `service_zone_id` (#21). `null` when the order has none: created before #21, or (zone) the customer's area is not listed |
| `source` | The order's confirmed source; `null` if none is set yet |
| `sources` | Every water source, with `usable` as in the dashboard |

No customer name, phone or address is returned: the map does not need them.

## `GET /admin/activity`

The dashboard's "Recent activity". Query: `limit` (1-20, default 5). Newest
first.

**200** ([examples/admin-activity.json](examples/admin-activity.json))

```json
{
  "items": [
    {
      "id": "b71e...",
      "at": "2026-10-27T09:40:00Z",
      "kind": "order_status",
      "order_reference": "MO-7KQ2M9XH4T",
      "to_status": "accepted",
      "actor": { "name": "Sample Driver One", "role": "driver" },
      "is_simulated": true
    },
    {
      "id": "4c2a...",
      "at": "2026-10-27T09:31:00Z",
      "kind": "support_request",
      "order_reference": "MO-3HT8WQ2KZP",
      "to_status": null,
      "actor": null,
      "is_simulated": false
    }
  ]
}
```

| Field | Rule |
| --- | --- |
| `kind` | `order_status` (a row of `order_events`, FR-033) or `support_request` (a new support request). Clients show an unknown kind as a plain line, never fail |
| `to_status` | For `order_status`, the status the order moved to; else `null` |
| `actor` | Who did it: staff or driver name and role. `null` for the system and for customers, so no customer name appears on the dashboard |
| `is_simulated` | The order's flag; `false` for a support request with no order |

The screen writes the line ("Sample Driver One accepted MO-7KQ2M9"). The
mock's `online` kind is not created: availability changes are not recorded
as events. Staff actions appear in the [audit log](#get-adminaudit-logs).

## `GET /admin/reports`

The Reports page and its CSV download (FR-052, FR-053). Query: `range`
(`today`, `7d` or `30d`, the screen's pills; `7d` is the 7 Lagos days ending
today; **required**, 422 `validation_error` when missing: decision 7) and
`simulated`.

**200** ([examples/admin-report.json](examples/admin-report.json))

```json
{
  "range": "7d",
  "from": "2026-10-21",
  "to": "2026-10-27",
  "is_simulated": false,
  "orders": { "total": 61, "by_status": { "delivered": 48, "cancelled": 4, "failed": 2, "en_route": 3, "confirmed": 4 } },
  "deliveries": { "delivered": 48, "with_window": 45, "on_time": 39 },
  "by_delivery_type": { "keke": 40, "tanker": 21, "not_recorded": 0 },
  "cash": { "collected_minor_units": 28650000, "reconciled_minor_units": 26100000 },
  "by_zone": [
    { "zone_id": "2f4b...", "name": "Independence Layout", "orders": 22, "delivered": 18 },
    { "zone_id": null, "name": null, "orders": 3, "delivered": 2 }
  ],
  "by_driver": [{ "driver_id": "5a0e...", "name": "Sample Driver One", "plate": "ENU-123-KK", "delivered": 17 }],
  "by_source": [{ "source_id": "9c1d...", "name": "Sample Borehole A", "pickups": 30 }]
}
```

| Field | Rule |
| --- | --- |
| `orders` | Orders created in the range, by backend status |
| `deliveries`, `cash` | As on the dashboard, over the range |
| `by_delivery_type` | As on the dashboard, over the range |
| `by_zone` | Orders in the range per `service_zone_id` (FR-052 "service-zone results"), most first. One row with `zone_id` and `name` `null` collects orders with no zone (created before #21, or the area was not listed); it is left out when empty. `delivered` is the zone's deliveries in the range, by the time of their `delivered` event, so the rows add up to `deliveries.delivered` (decision 8) |
| `by_driver` | Deliveries in the range per driver, most first. The driver is the one on the order's `completed` assignment (decision 9). No pay: partner pay is out of the MVP, so the design's "Earned" column is dropped |
| `by_source` | Pickup records (FR-034) in the range per source, most first. The design's "loads by station". A pickup at another source has no source row and is not counted (decision 9) |

Not returned, as on the dashboard: refunds, variable costs, contribution
(F6, F7). FR-042 asks that contribution is never labelled net profit; it is
not shown at all in the pilot.

**CSV (FR-053).** The screen builds the CSV from this response, as it does
now. The response holds aggregates, driver names and source names only, no
customer data. An order-level CSV export is not proposed
([open question 3](#open-questions)).

## Support requests (admin)

The admin side of the customer's "Report a problem"
([customer-account.md](customer-account.md#support-requests), agreed in
#11 and #48, not built yet). That contract defines the `support_requests` table, the customer
endpoints and the rule that **a support request never changes the order**
(its decision 9). This side lists the requests and resolves them.

### Admin support request object

([examples/admin-support-request.json](examples/admin-support-request.json))

```json
{
  "reference": "SR-4K7M2Q9X",
  "type": "late",
  "message": "The water has not arrived yet.",
  "order_reference": "MO-7KQ2M9XH4T",
  "status": "resolved",
  "created_at": "2026-10-26T13:10:00Z",
  "customer": { "id": "0b8f...", "name": "Sample Customer", "phone": "+2348000000001" },
  "resolution": {
    "note": "Called the customer: the driver arrived at 13:40 and delivered in full.",
    "resolved_by": { "id": "7d3c...", "name": "Sample Admin" },
    "resolved_at": "2026-10-26T13:55:00Z"
  },
  "is_simulated": false
}
```

| Field | Rule |
| --- | --- |
| `reference`, `type`, `message`, `order_reference`, `status`, `created_at` | As in [customer-account.md](customer-account.md#support-request-object) |
| `customer` | The customer who wrote it (NFR-003: staff only) |
| `resolution` | `null` while open |
| `is_simulated` | The order's flag; `false` without an order |

The design's `urgent` flag has no source: no SRS rule says which requests are
urgent ([open question 2](#open-questions)). The adapter sets it `false`. The
design's `#CP-012` number is the `reference`.

### `GET /admin/support-requests`

Query: `status` (`open` or `resolved`; both when left out), `q` (matches the
reference, the order reference or the customer name; 1-100 characters),
`limit`, `offset`. Open requests first, then newest first.

**200**: page of admin support requests
([examples/admin-support-requests-page.json](examples/admin-support-requests-page.json)).

### `GET /admin/support-requests/{reference}`

**200**: the admin support request plus `contacts`, the people the "Call"
buttons dial:

```json
{
  "...": "admin support request",
  "contacts": [
    { "name": "Sample Customer", "role": "customer", "phone": "+2348000000001" },
    { "name": "Sample Driver One", "role": "driver", "phone": "+2348000000011" }
  ]
}
```

`contacts` holds the order's receiver (`contact_name`, `contact_phone`) and
the driver of the order's current or last accepted assignment, if any.
Without an order, only the customer who wrote the request.

| Status | `code` | When |
| --- | --- | --- |
| 404 | `support_request_not_found` | No request with that reference |

### `POST /admin/support-requests/{reference}/resolve`

**Request** ([examples/admin-support-resolve-request.json](examples/admin-support-resolve-request.json))

```json
{ "note": "Called the customer: the driver arrived at 13:40 and delivered in full." }
```

| Field | Rule |
| --- | --- |
| `note` | Trimmed, 5-500 characters (the mock asks for at least 5; 500 as for other staff reasons in [admin-directory.md](admin-directory.md)) |

**200**: the resolved admin support request (without `contacts`).

- Sets `status = resolved`, `resolved_at`, `resolved_by` and the note. The
  customer then sees the request as resolved in `GET /me/support-requests`.
- Changes nothing on the order. If the request needs an action, staff take
  it first through its own endpoint (alternative proof, withdraw, cancel, a
  dispute: [deliveries.md](deliveries.md)), then resolve the request.
- Audit row `support_request_resolved` with the request id; the note stays
  on the request, not in the audit metadata.
- Resolving is final: there is no reopen ([open question 5](#open-questions)).

| Status | `code` | When |
| --- | --- | --- |
| 404 | `support_request_not_found` | No request with that reference |
| 409 | `support_request_already_resolved` | It is already resolved ([example](examples/error-support-request-already-resolved.json)) |
| 422 | `validation_error` | Note missing, too short or too long |

## `GET /admin/audit-logs`

The audit log on the Settings page (NFR-004). Query: `target_type` and
`target_id` (both or neither, to see one record's log), `limit`, `offset`.
Newest first.

**200** ([examples/admin-audit-logs-page.json](examples/admin-audit-logs-page.json))

```json
{
  "items": [
    {
      "id": "e5a1...",
      "at": "2026-10-27T10:05:00Z",
      "actor": { "id": "7d3c...", "name": "Sample Admin", "role": "admin" },
      "action": "cash_received",
      "target_type": "cash_collection",
      "target_id": "3b9f...",
      "target_label": "MO-7KQ2M9XH4T",
      "details": { "order_id": "1c7e..." }
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

| Field | Rule |
| --- | --- |
| `action` | The snake_case action code written by the feature (`cash_received`, `proof_override_approved`, `support_request_resolved`, ...). The adapter turns known codes into words; an unknown code shows as it is |
| `details` | The row's metadata: ids and kinds only, never personal data (`backend/app/modules/audit/models.py`). The exception is `reason`, on the four driver actions named below, or `reason_removed: true` in its place once the driver is anonymized (#298) |
| `target_type`, `target_id` | The kind of record and its id. The screen shows the kind in words, then the label below, or the short id when the label is `null` |
| `target_label` | **Status: agreed** (G3, #296; @nnamdi-security, technical lead, 2026-11-01). `string \| null`, always present. The record's name or reference, looked up when the page is read and **never stored** in `audit_logs`, so anonymizing a record still works. See the table and rules below |

**`target_label` by `target_type`** (agreed by @nnamdi-security, 2026-11-01):

| `target_type` | `target_label` |
| --- | --- |
| `order` | The order reference |
| `cash_collection` | The reference of its order |
| `support_request` | The request reference |
| `service_zone` | The area name |
| `water_source` | The source name |
| `price_list` | `null`: a saved price list version has no name of its own |
| `driver`, `user` | The account's name |
| `cash_remittance` | The name of the driver who handed over |
| `customer_address`, `deletion_request`, `retention_review` | `null`: an address is personal data, and the other two have no short name |

- `null` when the record no longer exists or its account was anonymized. Never
  the old name, and never an error: the row stays readable.
- Never an address, phone number or note. Names appear only for accounts staff
  already see, and the endpoint is admin-only.
- Resolved for the whole page in one query per target type, not one per row
  (a page is at most 100 rows).
- `target_type`, `target_id`, `details` and the action codes are unchanged.
  No migration: nothing is added to `audit_logs`.

**The reason (#293, decided 2026-10-31 by @nnamdi-security).** The design's
`reason` column shows `details.reason` on the four driver actions
(`driver_approved`, `driver_suspended`, `driver_activated`,
`driver_deactivated`) and "None" on every other row. For a driver the audit row
is the only place the reason is stored (`docs/features/admin-drivers.md`), so
keeping it off the screen would leave it unreadable. The rules:

- Reasons are allowed in `details` only for staff-entered decisions, today
  those four actions. They are staff notes and must not contain customer data;
  the Riders reason box carries a hint to that effect ("Do not include
  customer details.", added with the screen change for #293).
- The audit endpoint is admin-only (above), and reading the log is not itself
  audited.
- The adapter reads `details.reason` only for those four codes, so a reason
  added to another action later does not appear until it is added here.
- **Anonymizing a driver (#298, decided 2026-10-31 by @nnamdi-security).**
  The privacy tool keeps the audit rows but, on these four actions where the
  driver is the target, removes `details.reason` and sets
  `details.reason_removed: true` (`privacy/service.py`, `audit.service`).
  A free-text note can name the driver, and a marker lets an auditor tell "a
  reason was removed" from "none was given". The row, its actor, time and
  other keys stay. The adapter shows "Removed on anonymization" in the Reason
  column for a row with `reason_removed: true`, only for the same four codes.
  The anonymization's own row (`partner_anonymized`) carries `reasons_cleared`,
  a count.

## Notifications (admin)

The header bell. The shape, the table (`notifications`, channel `in_app`)
and the mark-read rules are the ones customers and partners use
([partners.md](partners.md#notifications)); only the path and the kinds
differ. Each active admin gets their own row, so each has their own read
state.

The SRS has no staff notification rule beyond FR-032 ("Admin SHALL be
informed of rejection or timeout through dashboard state") and FR-050
(P1, configurable event messages). The kinds below are a **proposal**
([open question 1](#open-questions)):

| `kind` | Created when | Source |
| --- | --- | --- |
| `driver_declined` | A driver declines an offered job | FR-032 |
| `assignment_expired` | An offer times out | FR-032 |
| `hold_opened` | A job goes on hold for review (source, unsafe stop, alternative proof) | FR-034, FR-035, [deliveries.md](deliveries.md#admin-hold-review-endpoints) |
| `partner_pending` | A partner signs up and waits for approval | [partners.md](partners.md#post-authpartner-register) ("a notice for admin that a partner is waiting") |
| `support_request` | A customer files a support request | [customer-account.md](customer-account.md#support-requests) |

Messages never contain a customer phone, an address or a delivery code (SRS
§5 `notifications`). Creating one never changes an order (FR-050).

### `GET /admin/notifications`

Query: `limit`, `offset`. Newest first.

**200** ([examples/admin-notifications-page.json](examples/admin-notifications-page.json)):
the page shape of `GET /driver/notifications`, with `unread_count`.
`reference` is an order reference or `null`. The screen builds the link from
`kind` and `reference` (an order opens the order page, `partner_pending` the
drivers page, `support_request` the support page); the server sends no path.

### `POST /admin/notifications/read`

Body `{ "ids": [...] }` (up to 100) or none. **204**. As
`POST /driver/notifications/read`: listed ids, or every unread message when
the body is empty; unknown ids and other people's ids are ignored.

## `GET /admin/settings`

Read only ([decision 4](#decisions-taken-in-22)).

**200** ([examples/admin-settings.json](examples/admin-settings.json))

```json
{
  "support": { "phone": "+2348133774902", "whatsapp_enabled": true },
  "delivery_code_validity_minutes": 10,
  "staff": [
    { "id": "7d3c...", "name": "Sample Admin", "phone": "+2348000000099", "role": "admin", "last_sign_in_at": "2026-10-27T07:58:00Z" }
  ]
}
```

| Field | Rule |
| --- | --- |
| `support.phone` | The `SUPPORT_PHONE` setting (FR-055), the value `GET /public/contact` returns |
| `support.whatsapp_enabled` | The `SUPPORT_WHATSAPP_ENABLED` setting ([public-site.md](public-site.md)) |
| `delivery_code_validity_minutes` | The server constant (FR-035: 10 minutes, final) |
| `staff` | Active users with role `admin`, by name. Staff are created with the command-line tool ([auth.md](auth.md#roles)) |
| `staff[].role` | Always `admin` (one staff role) |
| `staff[].last_sign_in_at` | The newest session's creation time; `null` if never signed in. Sessions do not record later use, so this is not "last active" |

Changing any of these is a configuration or command-line change by the
technical lead. The Settings screen's form becomes read only in the link
issue, and its "Safe load" fields move to vehicle profiles (FR-013).

## Error codes added by this contract

| Status | `code` | Endpoint |
| --- | --- | --- |
| 404 | `support_request_not_found` | Support request detail and resolve |
| 409 | `support_request_already_resolved` | Resolve |

## Mapping to the design types

For the link issue; [api-mapping.md](../architecture/api-mapping.md) gets
these rows in its own small PR when the link issue starts.

| Backend | Design type | Rule |
| --- | --- | --- |
| `GET /auth/me` + `GET /admin/shell` | `AdminShellData` | `user.name` from `/auth/me`, `user.role` "Admin"; `counts.orders` = `orders_needing_action`; `counts.support` = `support_requests_open`; `unread` = `notifications_unread` |
| `AdminDashboardRead` | `AdminDashboard` | `orders.awaiting_rider`, `in_progress`, `delivered`, `cancelled` grouped from `by_status` with the admin status table; `failed` and `disputed` follow api-mapping open question 5. `disputes_open` = `support_requests_open`. `riders_online` = `drivers_available`. `stations.open` / `closed` = `sources.usable` / `not_usable`. `revenue_today_minor_units` = `cash.collected_minor_units`. `payouts_due` and `payments_to_verify` have no source: the type needs them made optional and the cards hidden (screen change in the link issue). `is_sample` = `is_simulated` |
| `LiveMapRead` | `LiveMapData` | `code` = driver `plate`; `vehicle` = `delivery_type` (`null` for an order without one: the screen draws a neutral marker); `station_area` = source `approximate_location`; `customer_area` = zone name |
| `ActivityItem` | `ActivityEntry` | `to_status` `quote_requested` → `new_order`, `accepted` → `accepted`, `delivered` → `delivered`, other statuses → `admin`; `support_request` → `complaint`. `text` built by the adapter |
| `AdminReportRead` | `AdminReport` | `by_rider[].earned_minor_units` has no source (the column is hidden); `by_station` = `by_source` with `loads` = `pickups`; `revenue_minor_units` = `cash.collected_minor_units` |
| `AdminSupportRequest` | `AdminIssue` | `id` and `number` = `reference`; `type`: `late` → `late`, `wrong_quantity` → `wrong_quantity`, others → `other`; `title` from the type; `reported_by` `customer`; `urgent` `false`; `resolution.action` has no source (the screen shows the note only) |
| `contacts` | `getIssuePeople` result | `role` `customer` → "Customer", `driver` → "Rider" or "Driver" by delivery type when known |
| `AuditLogRead` | `AuditEntry` | `actor` = actor name; `action` = words for the code; `reason` `null`; `target_label` is not mapped yet: the screen keeps the short id until the frontend change that follows #296 |
| Admin notification | `AdminNotification` | `read` = `read_at !== null`; `link` from `kind` and `reference` |
| `AdminSettingsRead` | `AdminSettings`, `StaffMember` | Read only; `support_hours` and `safe_load` have no source; `code_time_limit` "10 minutes"; staff `role` "Admin", `last_active` = `last_sign_in_at` |

## Data needed

- **No new table** for the dashboard, live map, activity, reports, audit log
  or settings: they read existing tables (`orders`, `order_events`,
  `assignments`, `order_exceptions`, `cash_collections`, `pickup_records`,
  `driver_profiles`, `water_sources`, `audit_logs`, `user_sessions`).
  Indexes for the date ranges were checked in the build: `orders` has
  `(status, created_at)`, and revision `0022` adds
  `cash_collections (collected_at)`, `order_events (to_status, created_at)`
  and `pickup_records (picked_up_at)` (decision 10).
- `support_requests` ([customer-account.md](customer-account.md#data-needed-for-the-build-issue))
  gains `resolution_note` (up to 500 characters). Its `resolved_by` must be
  an admin. The privacy tool removes the note with the message at
  anonymization, replacing both with "Removed at the customer's request."
  so `resolution.note` stays a string (#117).
- `notifications`: the existing table; admin rows use the kinds above.
- Admin notifications need the events that create them: dispatch (decline,
  timeout), holds, partner sign-up and support requests each add a row per
  active admin in the same transaction.
- All reviewed Alembic migrations; no new library.

**Build order.** Support requests need the `support_requests` table from
the customer account build issue (#11, #48). Everything else can be built
on the current backend, including the delivery type and zone breakdowns
(#21 is built).

## Open questions

| # | Question | Source |
| --- | --- | --- |
| 1 | Which events notify admins, and should every admin get a row, or only some? The proposal above: declines, timeouts, holds, partners waiting, support requests, one row per active admin | FR-032, FR-050 (P1); no SRS rule for staff messages |
| 2 | Which support requests are urgent, if any? BR-16 keeps safety and contamination complaints open at any time, but the customer's support types have no safety type | Design `urgent`; customer-account.md types |
| 3 | Is an order-level CSV export (FR-053: "authorized order-level CSV ... minimal customer data") needed for the pilot, and which columns? Not proposed until the columns are agreed | FR-053 (P1) |
| 4 | Support hours: what are they, and where do they appear? No SRS rule; [public-site.md](public-site.md) question 3 asks the same | Design `[SUPPORT HOURS]` |
| 5 | Can staff reopen a resolved support request? Not proposed | No SRS rule |
| 6 | Should `simulated=only` stay once the pilot starts, or only in development and demo deployments? | BR-09, NFR-031 |

## Changes

| Date | Change | Agreed by |
| --- | --- | --- |
| 2026-11-01 | Added `AuditLogRead.target_label` (additive, resolved when read, #296) | @nnamdi-security (technical lead, G3) |
| 2026-10-27 | "Data needed": the note is removed by replacing it with the message's text, so the response keeps its shape (#117) | @nnamdi-security (privacy contact) |
| 2026-10-27 | Clarified in the build (#102): decisions 7-10 (`range` required, `by_zone[].delivered`, per-driver and per-source rules, indexes); `assignment_expired` not created while offers never expire | @nnamdi-security (technical lead) |
| 2026-10-27 | Agreed (G3) | @nnamdi-security (technical lead) and @chidimmamogbo (PR #71) |
| 2026-10-27 | Brought up to date with main: orders now carry `delivery_type` and `service_zone_id` (#21 built), so the breakdowns and the live map use them, with a `not_recorded` bucket and a no-zone row for orders without them; customer-account.md is agreed (#48) | Not yet |
| 2026-10-27 | Proposed (#22): admin shell counts, dashboard, live map, activity, reports, support requests (list, detail, resolve), audit log, admin notifications, read-only settings. Payouts, points, refund as points and saving settings not proposed | Not yet |
