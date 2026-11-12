# Orders contract

Requirements: FR-001, FR-020, FR-021, FR-022, FR-024, FR-026, FR-027, FR-030, FR-033 ·
Acceptance tests: T-06, T-07

Status: agreed (G3, S1-16) on 2026-10-15 by @nnamdi-security (contract owner),
with @chidimmamogbo (backend, S1-03), @Cloudcrackamara (customer UI, S1-05)
and @Daveoski (admin UI, S1-09). Checked against the approved designs
customer-ordering.md and
admin-orders.md; see
[Design check](#design-check-s1-16). The delivery-phase transitions remain
proposed until S1-06.

> **Documents from the main repo.** This contract was agreed in the main
> repository. The designs it checks against (`customer-ordering`,
> `admin-orders`, `admin-dispatch`, `customer-pilot-status` and its prompt 11)
> and the pilot plan (`process/pilot-plan`) are named in the text below but are
> not in this fork, so they are not linked. Read them in `mmiri-oma/mmirioma-original`
> (read only). The designs this fork has are in `docs/design/`.

**Changed 2026-10-17 (SRS v0.2, FR-003, FR-021), re-agreed by
@Cloudcrackamara (PR #45 review, 2026-10-18) and @chidimmamogbo (to the
technical lead, 2026-10-19):** `POST /orders` accepts the quantity in litres
**or** local gallons, the minimum order is 600 litres, and an unverified
customer gets 403 `phone_not_verified`. See [Changes](#changes).

**Proposed 2026-10-26 (#10, not agreed):** delivery type, jerrycan and tank
details, water source preference, `POST /quotes` and `quote_id` on
`POST /orders`, all additive. See
[order-details-and-price.md](order-details-and-price.md).

## Why Sprint 1 orders have no price

Pricing rules, service zones and water categories were open decisions in
Sprint 1. They are decided now (SRS v0.3, 19 Oct 2026, #55: FR-010, FR-013,
FR-014, FR-022) but not built, so orders still carry no price. The SRS forbids invented
prices and says to fall back to a manual quote when no reliable price exists
(FR-021, FR-022, §6). So in Sprint 1:

- A customer submits an **order request**. It is created in status
  `quote_requested` with **no price**.
- The API sends no price field until quotes exist. The UI must not show an
  estimated or sample price as if it came from the server. Design mockups may
  use sample naira amounts **visibly marked as sample** (S1-04).
- When the quotes module lands, `POST /orders` gains an optional `quote_id`, and
  the order response gains a `quote` object. Both changes are additive.

## Order statuses (FR-033)

Stored as an explicit enumeration. Names follow FR-033. The full list,
meanings and transitions are in [deliveries.md](deliveries.md) (proposed,
S1-06); the four statuses added by SRS v0.2 are not reachable through any
endpoint yet. Their staff labels come from the
admin dispatch design (Decision 1); customer
labels wait for the customer progress design.

| Status | Meaning | Customer sees it as | Staff see it as |
| --- | --- | --- | --- |
| `quote_requested` | Request received; no accepted price yet | "Request received" (with "We're preparing your price.") | "Request received" |
| `awaiting_confirmation` | Customer accepted a price; dispatcher has not yet confirmed source, slot and verified contact | "Awaiting confirmation" (never "confirmed", FR-027) | "Awaiting confirmation" |
| `confirmed` | Dispatcher confirmed source, price, slot and contact | "Confirmed" | "Confirmed" |
| `assigned` | A driver has been assigned but has **not** accepted | "Confirmed" (do not reveal assignment before acceptance, FR-032) | "Assigned - awaiting driver" |
| `accepted` | Assigned driver accepted the job | "Driver assigned" | "Driver accepted" |
| `awaiting_payment` | Prepaid only: price accepted, payment not verified (v0.2) | Pending design | "Awaiting payment" |
| `departed` | Driver has left to fulfil the order (v0.2) | Pending design | "Driver departed" |
| `collected` | Water picked up from the source (FR-034) | "Water collected" | "Water collected" |
| `en_route` | Driver is travelling to the customer | "On the way" (no live tracking claim, PRD §9) | "On the way" |
| `arrived` | Driver at the delivery location (v0.2). No delivery code yet: it is issued after unloading is recorded complete (FR-035, #67) | Pending design | "Driver arrived" |
| `unloading` | Driver started unloading (v0.2) | Pending design | "Unloading" |
| `delivered` | Delivered **with proof** of quantity and acknowledgement (FR-035, BR-06) | "Delivered" | "Delivered" |
| `cancelled` | Cancelled with a recorded reason (FR-036) | "Cancelled" | "Cancelled" |
| `failed` | Delivery attempt failed (FR-036) | "Delivery failed" | "Delivery failed" |
| `disputed` | Customer or dispatcher disputes the delivery (T-12) | "Under review" | "Disputed" |

Labels come from the approved designs: customer wording from
customer-ordering.md (status wording table),
staff wording from admin-orders.md (Decision on
status labels) and, for the four v0.2 statuses,
admin-dispatch.md (Decision 1). The API sends only the `status` value; labels are client-side.
Until a "Pending design" status has approved wording, and for any value the
customer app does not know, the customer screens show a neutral fallback:
"Order update" with "We're working on your order. Contact us if you have
questions." (#82). Clients must never fail on an unknown `status`.

FR-033 lists `draft` alongside `quote_requested`. The server does not store
drafts: an unsubmitted form exists only in the browser. Terminal statuses are
`delivered`, `cancelled` and `failed`. `disputed` is resolved by a later action.

## Transitions

Moved to [deliveries.md](deliveries.md#transitions) (S1-06), which covers
every status after creation, who may make each change, the conditions,
reason codes and errors. The only transition built in this contract is
creation: (none) → `quote_requested` by the customer, `POST /orders`.

## Order object

Customer view (`OrderRead`):

```json
{
  "reference": "MO-7KQ2M9XH4T",
  "status": "quote_requested",
  "quantity_litres": 1200,
  "contact_name": "Sample Customer",
  "contact_phone": "+2348000000001",
  "delivery_address": "12 Sample Close, Independence Layout, Enugu",
  "landmark": "Opposite the blue gate",
  "delivery_instructions": "Tank is behind the house",
  "preferred_delivery_date": "2026-10-16",
  "created_at": "2026-10-14T09:30:00Z",
  "updated_at": "2026-10-14T09:30:00Z"
}
```

Admin view (`AdminOrderRead`) adds:

```json
{
  "id": "3c1d6f0a-8b2e-4f7a-9c35-1e2d4b6a8f90",
  "customer": { "id": "0b8f1c5e-...", "name": "Sample Customer", "phone": "+2348000000001", "phone_verified": false },
  "is_simulated": false
}
```

Field rules (FR-020, FR-021):

| Field | Rule |
| --- | --- |
| `quantity_litres` | Integer, 600–100000 whole litres (FR-021). Always litres in responses. In `OrderCreate`, give **exactly one** of `quantity_litres` or `quantity_local_gallons`. Every quantity is still a manual quote request; the upper bound only rejects nonsense input. Orders created before 2026-10-17 may be below 600 litres |
| `quantity_local_gallons` | `OrderCreate` only. Integer, 150–25000; 1 local gallon = 4 litres. The server converts it and stores `quantity_litres`. Not returned |
| `contact_name` | Trimmed, 1–100 characters. The person receiving the delivery |
| `contact_phone` | Nigerian mobile, normalized as in [auth.md](auth.md#identifier-and-password-rules) |
| `delivery_address` | Trimmed, 5–500 characters, free text |
| `landmark` | Optional, up to 200 characters |
| `delivery_instructions` | Optional, up to 500 characters |
| `preferred_delivery_date` | Optional; today or later in Africa/Lagos. A preference, **not** a booked slot (FR-025 slots come later) |

## Endpoints (Sprint 1)

| Method | Path | Roles | Request | Success | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/orders` | customer | `OrderCreate` | 201 `OrderRead`; 200 `OrderRead` on idempotent retry | 403 `phone_not_verified`, 409 `idempotency_key_reused`, 422 `validation_error` |
| GET | `/orders` | customer | `limit`, `offset` | 200 page of own `OrderRead`, newest first | 422 `validation_error` |
| GET | `/orders/{reference}` | customer | none | 200 `OrderRead` | 404 `order_not_found` |
| GET | `/admin/orders` | admin | `status`, `created_from`, `created_to`, `is_simulated`, `limit`, `offset` | 200 page of `AdminOrderRead`, newest first | 422 `validation_error` |
| GET | `/admin/orders/{reference}` | admin | none | 200 `AdminOrderRead`; becomes `AdminOrderDetail` (adds `assignment`, [deliveries.md](deliveries.md#admin-dispatch-endpoints), agreed; built in #61) | 404 `order_not_found` |

All endpoints also return the shared 401, 403 and 422 errors from the
[README](README.md#errors). Drivers get 403 `forbidden` on all of them.

List responses use the shared page shape
`{ "items": [...], "total": n, "limit": n, "offset": n }`
([README](README.md#pagination)); `limit` is 1–100 (default 50), `offset` 0 or
more. Examples: [orders-page.json](examples/orders-page.json) (customer),
[admin-orders-page.json](examples/admin-orders-page.json) (admin).

Admin list query parameters:

| Parameter | Rule |
| --- | --- |
| `status` | One of the statuses above; may be repeated (`?status=quote_requested&status=confirmed`). Omitted: all statuses |
| `created_from`, `created_to` | Optional `YYYY-MM-DD`, inclusive calendar dates in Africa/Lagos. `created_from` after `created_to` is 422 `validation_error` |
| `is_simulated` | Optional boolean. `true`: only demo records; `false`: only real orders; omitted: both (BR-09). **Added in S1-16** for the admin design's Simulated filter |
| `limit`, `offset` | As above |

An unknown status, a malformed date or an out-of-range `limit` is 422
`validation_error` with `details` naming the parameter.

`OrderCreate` is the order object's input fields plus `idempotency_key`:

```json
{
  "idempotency_key": "5b0e2c3a-7d1f-4e8a-b6c9-0a1b2c3d4e5f",
  "quantity_litres": 1200,
  "contact_name": "Sample Customer",
  "contact_phone": "08000000001",
  "delivery_address": "12 Sample Close, Independence Layout, Enugu",
  "landmark": "Opposite the blue gate",
  "delivery_instructions": "Tank is behind the house",
  "preferred_delivery_date": "2026-10-16"
}
```

It has no price, status, customer or simulated fields. The server sets them.
The same request in local gallons replaces `"quantity_litres": 1200` with
`"quantity_local_gallons": 300`. Both units, or neither, is 422
`validation_error`. Approved presets (FR-021): 600, 1,200, 2,000, 3,000, 4,000
and 5,000 litres (150 to 1,250 local gallons); the client shows them, the
server accepts any valid quantity.

### Behavior notes

- **Idempotency (FR-026, NFR-011, T-06):** the client generates one UUID per
  checkout attempt and reuses it on every retry. A retry with the same key and
  the same body returns the existing order with 200. The comparison uses
  litres, so a retry giving the same quantity in local gallons is the same
  request. The same key with a different body returns 409
  `idempotency_key_reused`. Keys are unique per
  customer, enforced by a database constraint.
  - Client rule (customer design, Decision 9): one key per request form,
    kept even after the customer edits fields following a failed send. A 409
    therefore means an earlier send from that form **was** stored: the client
    shows My orders with "We already received this request. It is at the top
    of your list." and never sends a second order with a new key. A 422 stores
    nothing, so the same key stays usable after fixing the fields.
- **Verified phone (FR-003, T-16):** an unverified customer gets
  403 `phone_not_verified` and nothing is stored. Demo customers are seeded
  as verified.
- **Ownership (FR-001, T-07):** another customer's reference returns 404
  `order_not_found`, the same as a reference that does not exist, so references
  cannot be probed.
- **Reference (FR-027):** `MO-` followed by 10 random characters from Crockford
  base32 (about 50 bits). Not derived from the ID or creation time.
- **Simulated records (BR-09):** `is_simulated` appears only in admin
  responses; customers never see it. The server sets it, never the client:
  the demo seed's orders are simulated, and so is any order placed through
  `POST /orders` by a demo account (reserved phone block `+23480000900NN` **and** a name starting with "Demo ", `app/shared/demo_accounts.py`). Every other customer's order is real.

Examples: [examples/order.json](examples/order.json),
[examples/order-create-request.json](examples/order-create-request.json),
[examples/orders-page.json](examples/orders-page.json),
[examples/admin-orders-page.json](examples/admin-orders-page.json),
[examples/error-order-not-found.json](examples/error-order-not-found.json),
[examples/error-idempotency-key-reused.json](examples/error-idempotency-key-reused.json).

## Design check (S1-16)

Every build-now element in the screen-to-endpoint tables of the approved
designs maps to this contract (2026-10-15):

| Design | Screen | Element | Contract |
| --- | --- | --- | --- |
| Customer | O1 My orders | List, "Load more" (20 per page) | `GET /orders?limit=20&offset=N`; `items`, `total` |
| Customer | O1 | Card | `reference`, `status`, `quantity_litres`, `delivery_address`, `preferred_delivery_date`, `created_at` |
| Customer | O2 Request water | Send request | `POST /orders` with every `OrderCreate` field; 201/200; 409 `idempotency_key_reused`; 422 `validation_error` (`details[].loc` per field); shared 401/403 (`csrf_failed`) |
| Customer | O2 | Field limits | Field rules table above (quantity 600–100000 litres since 2026-10-17, name 1–100, address 5–500, landmark ≤200, instructions ≤500, date today or later in Lagos) |
| Customer | O3 Request received | Summary | The `POST /orders` response (`reference`, `status`, `quantity_litres`, `delivery_address`, `landmark`, `preferred_delivery_date`) |
| Customer | O4 Order detail | Every field, "Last updated" | `GET /orders/{reference}`: every `OrderRead` field incl. `updated_at`; 404 `order_not_found` (also for another customer's order) |
| Admin | 3 Order directory | List, pagination (50 per page) | `GET /admin/orders?limit=50&offset=N`; page shape |
| Admin | 3 | Status filter, date range | `status` (repeated), `created_from`, `created_to` |
| Admin | 3 | Simulated tag and filter | `is_simulated` (field and, from S1-16, query parameter) |
| Admin | 3 | Row or card | `reference`, `status`, `created_at`, `quantity_litres`, `customer.name`, `customer.phone_verified`, `contact_name`, `delivery_address`, `landmark`, `preferred_delivery_date` |
| Admin | 3 | "Find by reference" | `GET /admin/orders/{reference}` |
| Admin | 4 Order detail | Request, delivery, customer account, simulated | Every `AdminOrderRead` field; 404 `order_not_found` |

Contract changes made for the designs: the `is_simulated` filter on
`GET /admin/orders`, the explicit query validation rules, and the staff
status labels (client-side wording only). Nothing else changed; no screen
needed a field the SRS does not support.

Design-ahead screens (customer Q1–Q3, admin screens 5–7) need contract work
listed under Planned; they are not part of this agreement.

## Customer pilot changes (#99)

Status: **agreed** (G3) on 2026-10-24 by @nnamdi-security (technical lead,
contract owner), without the cancellation SMS (see below). Proposed by
@Daveoski (+ Claude Code) on 2026-10-22 from
prompt 11; the design
is approved (G2, 2026-10-24,
customer-pilot-status.md). The backend
review by @chidimmamogbo and the customer UI review by @Cloudcrackamara are
recorded on the build PR. **Built** in #165 (PR #187): the backend sends
all three fields and the customer app maps `price` and `water_category`
(`delivery_window` is not shown yet, #188).

What a pilot customer must see once a dispatcher confirms their order
(FR-023, FR-037): the confirmed window, the agreed total and the water
category on their order. All changes are additive.

### `OrderRead` gains three fields

`null` until the order is confirmed (#113), and on older orders. Example:
[order-confirmed.json](examples/order-confirmed.json).

```json
{
  "delivery_window": { "start_at": "2026-10-27T09:00:00Z", "end_at": "2026-10-27T11:00:00Z" },
  "price": { "total_minor_units": 4500000, "currency": "NGN", "manual": true },
  "water_category": { "label": "Utility Water", "supported_uses": null }
}
```

| Field | Rule |
| --- | --- |
| `delivery_window` | The confirmed window (UTC), from `orders.delivery_window_start_at` / `end_at`. The client shows it in Africa/Lagos. Never the preferred date |
| `price` | From the order's price snapshot (FR-024): `total_minor_units` integer kobo, `currency` `NGN`, `manual` `true` for a pilot manual quote (F2). Never a breakdown, who entered it, or how the customer agreed (admin only) |
| `water_category.label` | The label frozen in the price snapshot at confirmation, so a later label change does not alter a confirmed order (FR-014, FR-024). Never a description of the water's quality |
| `water_category.supported_uses` | The category's current supported-uses text (FR-023), or `null` when none is set |

Same fields on every endpoint returning `OrderRead`: `GET /orders` items,
`GET /orders/{reference}`, and `POST /orders` (always `null` there). Ownership
and errors are unchanged. The customer app shows "Pay cash after unloading"
as a fixed line: every pilot order is pay on delivery (F4), as on the admin
summary (C2); a `payment_method` field comes with prepaid payments (FR-040).

### Cancellation SMS: not in this change

The proposal included an SMS sent by the app when an administrator cancels
an order. **Dropped** (technical lead, 2026-10-24): for the pilot the
cancellation outcome is told by an administrator under fallback F10
(pilot plan, agreed 2026-10-23, #102). The
agreed admin cancel
([deliveries.md](deliveries.md#post-adminordersreferencetransition-fail-and-cancel))
is unchanged.

### Decided questions

Decided by the technical lead on 2026-10-24.

1. **Where does staff see a failed cancellation SMS?** Not applicable: the
   cancellation SMS is dropped (above). The original question: The confirmation SMS
   stores its outcome on the order for the C2 warning. **Recommended:**
   store the cancellation SMS outcome the same way
   (`orders.cancellation_sms_status`, `cancellation_sms_attempted_at`) and
   return it on `AdminOrderDetail` as `cancellation_sms`, with a small
   admin warning in a later design change. Until a screen shows it, the
   staff learn of a failure only from the logs.
2. **`supported_uses` frozen or current?** **Live**, as recommended: the
   label is frozen with the price (FR-024); the uses text is read live,
   since FR-024 freezes the price inputs and the uses text is not one.
3. **`payment_method` on `OrderRead`?** **Not now**: the customer app shows
   the fixed line "Pay cash after unloading" for the pilot (F4, prompt 11
   question 2). `payment_method` (and `payment_status`) come to customers
   with prepaid payments and their own designed states.

## `GET /orders/{reference}/history` (#155)

**Status: agreed** (G3) on 2026-10-28 by @nnamdi-security (technical lead), on PR #164. Proposed by @Daveoski (+ Claude Code).

The customer's order timeline (FR-037). Every status change of one of the
customer's own orders, oldest first, from `order_events`
([order-history.json](examples/order-history.json)):

```json
{ "items": [ { "status": "quote_requested", "at": "2026-10-28T08:00:00Z" }, { "status": "awaiting_confirmation", "at": "2026-10-28T08:00:00.000001Z" } ] }
```

- `status` is any order status, as `OrderRead.status` (clients never fail on
  an unknown one); `at` is UTC. No actor, note or reason: those are staff
  detail.
- Customer only; 404 `order_not_found` for another customer's order (T-07).
  No pagination: an order has few events.
- The client shows each new customer stage once, with the agreed labels
  ([api-mapping.md](../architecture/api-mapping.md), "Customer order stage"),
  so `assigned` shows nothing new before the driver accepts (FR-032).

Rejected: building the timeline from notifications. They are messages, sent
for some steps only, so a missing one would read as a step that never
happened.

## Changes

| Date | Change | Agreed by |
| --- | --- | --- |
| 2026-11-12 | Agreed, not implemented (#411): `AdminOrderRead` and `AdminOrderDetail` gain `dispatch: { failed_attempts, escalated_at, manual_only }` (additive), and a pay-on-delivery order placed with a valid quote is `confirmed` at creation (row 4). Defined in [deliveries.md](deliveries.md#automatic-dispatch-and-reassignment-411) | @nnamdi-security (+ Codex), G3 review of PR #416, 2026-11-12 |
| 2026-10-28 | **Agreed:** each item of `GET /admin/orders` gains `driver: { id, name } \| null`, the driver of the order's live assignment (`offered` or `accepted`; additive, list only). The detail is unchanged. Defined in [deliveries.md](deliveries.md#amendment-204-the-driver-on-the-admin-order-list) | @nnamdi-security, technical lead (G3, PR #205) |
| 2026-10-28 | **Agreed:** an administrator can cancel because the customer asked: `customer_request` on `GET /admin/orders/{reference}/cancellation-outcome` and `POST /admin/orders/{reference}/transition` (additive; the amount is always 0 in the pilot, F5). Defined in [deliveries.md](deliveries.md#cancel-because-the-customer-asked-174) | @nnamdi-security, technical lead (G3, PR #203) |
| 2026-10-28 | **Built:** `delivery_window`, `price` and `water_category` on `OrderRead` (#165, PR #187). The contract is unchanged | @nnamdi-security (approved PR #187) |
| 2026-10-28 | **Agreed:** [`GET /orders/{reference}/history`](#get-ordersreferencehistory-155), the customer's order timeline (additive) | @nnamdi-security, technical lead (G3, PR #164) |
| 2026-10-24 | **Agreed:** `OrderRead` gains `delivery_window`, `price` and `water_category` (additive; `null` until confirmed). The proposed customer cancellation SMS is dropped (F10). See [Customer pilot changes](#customer-pilot-changes-99) | Technical lead (G3); backend and customer UI reviews on the build PR |
| 2026-10-22 | Proposed: the fields above and a customer cancellation SMS | Superseded by 2026-10-24 |
| 2026-10-22 | `AdminOrderDetail` gains `water_category`, `source`, `delivery_window`, `price` (manual quote snapshot) and `confirmation_sms`; `POST /admin/orders/{reference}/transition` confirms an order (rows 26 and 7). All additive. Defined in [deliveries.md](deliveries.md#order-confirmation-endpoints) | Technical lead, @chidimmamogbo (G3, PR #111) |
| 2026-10-21 | `AdminOrderRead` gains `hold` (the job's open hold: `id`, `kind`, `since`) and `GET /admin/orders` gains the `on_hold` filter (additive). Defined in [deliveries.md](deliveries.md#admin-hold-review-endpoints) | Technical lead, @chidimmamogbo (G3, PR #91) |
| 2026-10-19 | `GET /admin/orders/{reference}` returns `AdminOrderDetail`, `AdminOrderRead` plus `assignment` (additive; the list is unchanged). Defined in [deliveries.md](deliveries.md#admin-dispatch-endpoints) | Technical lead, @chidimmamogbo (G3, PR #59) |
| 2026-10-19 | Staff labels for `awaiting_payment`, `departed`, `arrived` and `unloading` from the approved admin dispatch design. Labels are client-side; no API change | Technical lead (G2, #53) |
| 2026-10-19 | Four statuses added (`awaiting_payment`, `departed`, `arrived`, `unloading`; SRS v0.2) and the transition table moved to [deliveries.md](deliveries.md). No endpoint returns the new statuses yet | Proposed with deliveries.md |
| 2026-10-17 | `POST /orders` returns 403 `phone_not_verified` until the customer has verified their phone by SMS code (SRS v0.2 FR-003). Breaking: the customer UI has no verification screens yet ([auth.md](auth.md#phone-verification-fr-003-fr-004)) | @Cloudcrackamara (2026-10-18), @chidimmamogbo (2026-10-19), technical lead |
| 2026-10-17 | `quantity_local_gallons` added to `OrderCreate` (additive); minimum `quantity_litres` raised from 1 to 600 (SRS v0.2 FR-021). Breaking for clients sending under 600 litres; the customer UI's presets and "Other amount" check changed in the same PR | @Cloudcrackamara (2026-10-18), @chidimmamogbo (2026-10-19), technical lead |

## Planned (not in Sprint 1)

- Quotes (`POST /quotes`, SRS §6) and an optional `quote_id` on `POST /orders`;
  `quote` snapshot on the order (FR-022–FR-024).
- Service zones on the order (`service_zone_id`), and an out-of-zone request
  assistance state (FR-010).
- Water category on the order (FR-023), once categories are approved (PRD §13.2).
- Delivery slots (FR-025).
- Admin confirm, cancel and the transitions marked "later" above.
- Delivered quantity and cancel/fail reasons for customers (customer design
  Q3, admin design screen 7). The order history itself is proposed above
  (#155).
- A delivery-date filter on the dispatcher queue once slots exist. Sprint 1
  filters on creation date, as the approved admin design does (resolves the
  former open question on FR-030's "date").

## Open questions

1. Can a customer cancel their own order, and up to which status? Neither the
   PRD nor the SRS says. Until decided, only admins cancel, and the customer
   design offers contact guidance instead of a cancel button.
2. Confirm with S1-06 that `assigned → confirmed` is the right way to model a
   driver rejection.
