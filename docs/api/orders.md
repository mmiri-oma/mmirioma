# Orders contract

Requirements: FR-001, FR-020, FR-021, FR-022, FR-024, FR-026, FR-027, FR-030, FR-033 ·
Acceptance tests: T-06, T-07

Status: agreed (G3, S1-16) on 2026-10-15 by @nnamdi-security (contract owner),
with @chidimmamogbo (backend, S1-03), @Cloudcrackamara (customer UI, S1-05)
and @Daveoski (admin UI, S1-09). Checked against the approved designs
[customer-ordering.md](../design/customer-ordering.md) and
[admin-orders.md](../design/admin-orders.md); see
[Design check](#design-check-s1-16). The delivery-phase transitions remain
proposed until S1-06.

## Why Sprint 1 orders have no price

Pricing rules, service zones, water categories and supported quantities are
still open decisions (SRS §12.2–12.3, PRD §13.1–13.4). The SRS forbids invented
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

Stored as an explicit enumeration. Names follow FR-033.

| Status | Meaning | Customer sees it as | Staff see it as |
| --- | --- | --- | --- |
| `quote_requested` | Request received; no accepted price yet | "Request received" (with "We're preparing your price.") | "Request received" |
| `awaiting_confirmation` | Customer accepted a price; dispatcher has not yet confirmed source, slot and verified contact | "Awaiting confirmation" (never "confirmed", FR-027) | "Awaiting confirmation" |
| `confirmed` | Dispatcher confirmed source, price, slot and contact | "Confirmed" | "Confirmed" |
| `assigned` | A driver has been assigned but has **not** accepted | "Confirmed" (do not reveal assignment before acceptance, FR-032) | "Assigned - awaiting driver" |
| `accepted` | Assigned driver accepted the job | "Driver assigned" | "Driver accepted" |
| `collected` | Water picked up from the source (FR-034) | "Water collected" | "Water collected" |
| `en_route` | Driver is travelling to the customer | "On the way" (no live tracking claim, PRD §9) | "On the way" |
| `delivered` | Delivered **with proof** of quantity and acknowledgement (FR-035, BR-06) | "Delivered" | "Delivered" |
| `cancelled` | Cancelled with a recorded reason (FR-036) | "Cancelled" | "Cancelled" |
| `failed` | Delivery attempt failed (FR-036) | "Delivery failed" | "Delivery failed" |
| `disputed` | Customer or dispatcher disputes the delivery (T-12) | "Under review" | "Disputed" |

Labels come from the approved designs: customer wording from
[customer-ordering.md](../design/customer-ordering.md) (status wording table),
staff wording from [admin-orders.md](../design/admin-orders.md) (Decision on
status labels). The API sends only the `status` value; labels are client-side.

FR-033 lists `draft` alongside `quote_requested`. The server does not store
drafts: an unsubmitted form exists only in the browser. Terminal statuses are
`delivered`, `cancelled` and `failed`. `disputed` is resolved by a later action.

## Transitions

Only the Sprint 1 row (`POST /orders`) is agreed. The other rows are proposed
and are confirmed by the issue that builds them (S1-06/S1-07 for the delivery
phase).

The server validates every transition by role and prior status. An invalid
transition returns 409 `invalid_order_transition`, and a forbidden role returns
403 `forbidden` (FR-033). Every transition writes an `order_events` row with
actor, time, from/to status and reason (NFR-004).

| From | To | Who | Guard | Sprint |
| --- | --- | --- | --- | --- |
| (none) | `quote_requested` | customer | Valid request (`POST /orders`) | **1** |
| `quote_requested` | `awaiting_confirmation` | customer | Accepts a server quote (FR-023) | later |
| `awaiting_confirmation` | `confirmed` | admin | Phone verified (FR-003); eligible source (FR-012); slot reserved (FR-025) | later |
| `confirmed` | `assigned` | admin | Driver active, capacity and area fit (FR-031) | S1-07 |
| `assigned` | `accepted` | assigned driver | none | S1-07 |
| `assigned` | `confirmed` | assigned driver (reject) or admin (timeout) | Returns to dispatcher queue (SRS §8) | S1-07 |
| `accepted` | `collected` | assigned driver or admin | Pickup record (FR-034) | later |
| `collected` | `en_route` | assigned driver | none | later |
| `en_route` | `delivered` | assigned driver | Delivery proof present (FR-035, T-08) | later |
| any non-terminal | `cancelled` | admin | Reason required (FR-036) | later |
| `assigned`, `accepted`, `collected`, `en_route` | `failed` | admin | Reason required (FR-036) | later |
| `delivered` | `disputed` | customer or admin | Reason required (T-12) | later |

S1-06 owns the final delivery-phase rows (`assigned` through `delivered`,
`failed`) and the separate assignment statuses. If S1-06 changes them, update
this table in the same PR.

## Order object

Customer view (`OrderRead`):

```json
{
  "reference": "MO-7KQ2M9XH4T",
  "status": "quote_requested",
  "quantity_litres": 200,
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
| `quantity_litres` | Integer, 1–100000. Supported bands are not agreed yet (FR-021 pilot defaults are pending approval), so every quantity becomes a manual quote request in Sprint 1. The upper bound only rejects nonsense input |
| `contact_name` | Trimmed, 1–100 characters. The person receiving the delivery |
| `contact_phone` | Nigerian mobile, normalized as in [auth.md](auth.md#identifier-and-password-rules) |
| `delivery_address` | Trimmed, 5–500 characters, free text |
| `landmark` | Optional, up to 200 characters |
| `delivery_instructions` | Optional, up to 500 characters |
| `preferred_delivery_date` | Optional; today or later in Africa/Lagos. A preference, **not** a booked slot (FR-025 slots come later) |

## Endpoints (Sprint 1)

| Method | Path | Roles | Request | Success | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/orders` | customer | `OrderCreate` | 201 `OrderRead`; 200 `OrderRead` on idempotent retry | 409 `idempotency_key_reused`, 422 `validation_error` |
| GET | `/orders` | customer | `limit`, `offset` | 200 page of own `OrderRead`, newest first | 422 `validation_error` |
| GET | `/orders/{reference}` | customer | none | 200 `OrderRead` | 404 `order_not_found` |
| GET | `/admin/orders` | admin | `status`, `created_from`, `created_to`, `is_simulated`, `limit`, `offset` | 200 page of `AdminOrderRead`, newest first | 422 `validation_error` |
| GET | `/admin/orders/{reference}` | admin | none | 200 `AdminOrderRead` | 404 `order_not_found` |

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
  "quantity_litres": 200,
  "contact_name": "Sample Customer",
  "contact_phone": "08000000001",
  "delivery_address": "12 Sample Close, Independence Layout, Enugu",
  "landmark": "Opposite the blue gate",
  "delivery_instructions": "Tank is behind the house",
  "preferred_delivery_date": "2026-10-16"
}
```

It has no price, status, customer or simulated fields. The server sets them.

### Behavior notes

- **Idempotency (FR-026, NFR-011, T-06):** the client generates one UUID per
  checkout attempt and reuses it on every retry. A retry with the same key and
  the same body returns the existing order with 200. The same key with a
  different body returns 409 `idempotency_key_reused`. Keys are unique per
  customer, enforced by a database constraint.
  - Client rule (customer design, Decision 9): one key per request form,
    kept even after the customer edits fields following a failed send. A 409
    therefore means an earlier send from that form **was** stored: the client
    shows My orders with "We already received this request. It is at the top
    of your list." and never sends a second order with a new key. A 422 stores
    nothing, so the same key stays usable after fixing the fields.
- **Ownership (FR-001, T-07):** another customer's reference returns 404
  `order_not_found`, the same as a reference that does not exist, so references
  cannot be probed.
- **Reference (FR-027):** `MO-` followed by 10 random characters from Crockford
  base32 (about 50 bits). Not derived from the ID or creation time.
- **Simulated records (BR-09):** `is_simulated` appears only in admin
  responses. Customers never see it; a customer who places an order always
  gets a real one (the flag is set only by seed scripts).

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
| Customer | O2 | Field limits | Field rules table above (quantity 1–100000, name 1–100, address 5–500, landmark ≤200, instructions ≤500, date today or later in Lagos) |
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

## Planned (not in Sprint 1)

- Quotes (`POST /quotes`, SRS §6) and an optional `quote_id` on `POST /orders`;
  `quote` snapshot on the order (FR-022–FR-024).
- Service zones on the order (`service_zone_id`), and an out-of-zone request
  assistance state (FR-010).
- Water category on the order (FR-023), once categories are approved (PRD §13.2).
- Delivery slots (FR-025).
- Admin confirm, cancel and the transitions marked "later" above.
- Customer view of order history (`order_events`), delivered quantity and
  cancel/fail reasons (customer design Q3, admin design screen 7).
- A delivery-date filter on the dispatcher queue once slots exist. Sprint 1
  filters on creation date, as the approved admin design does (resolves the
  former open question on FR-030's "date").

## Open questions

1. Can a customer cancel their own order, and up to which status? Neither the
   PRD nor the SRS says. Until decided, only admins cancel, and the customer
   design offers contact guidance instead of a cancel button.
2. Confirm with S1-06 that `assigned → confirmed` is the right way to model a
   driver rejection.
