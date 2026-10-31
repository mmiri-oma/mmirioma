# API mapping: backend data to the new design

How every linking adapter converts between the fork's backend
(`frontend/src/lib/api/`, contracts in `docs/api/`) and the new design's types
(`frontend/src/domain/`). Every lane converts with these rules, so one value
never shows two ways on two screens. Change this file only in its own small
PR (CLAUDE.md, "Team workflow").

**Status:** draft for #5, 2026-10-26. Decided rules are marked with their
source. Open questions name the issue that settles them; until then the
affected function stays on mocks.

## Where adapters live

```
frontend/src/features/<feature>/
├── <feature>Api.ts      # what screens call; picks mock or real (USE_MOCKS)
└── real/
    └── <area>.ts        # adapter: calls lib/api/*, converts with this file
```

- Screens and components never import `lib/api/*` directly; they keep
  calling `<feature>Api.ts`, which keeps its signatures.
- Conversion functions are pure (backend type in, design type out) and have
  their own unit tests; the adapter only fetches and converts.
- `VITE_USE_MOCKS=true` keeps serving the full mock demo.

## Writing an adapter

Three pieces per linked function. The working example of the conversion
piece is `frontend/src/features/customer/real/orderStage.ts` with its test;
the order shown below is the shape #9 builds once #21 adds the order fields.

**1. The conversion:** pure, in `real/`, one per backend type. It never
invents a value: a field the backend does not send becomes the screen's
empty state (`null`), and the PR lists it.

```ts
// features/customer/real/order.ts
import type { CustomerOrder } from '../../../domain/orders'
import type { OrderRead } from '../../../lib/api/orders'
import { customerStageFromStatus } from './orderStage'

/** Backend order to the design's order (docs/architecture/api-mapping.md). */
export function customerOrderFromRead(read: OrderRead): CustomerOrder {
  // ...map each field with the rules in this file
}
```

**2. The adapter:** fetches with the client from `lib/api/` and converts.
It takes the client as its last parameter, defaulting to the shared
`apiClient`, so tests can pass one with a fake `fetch`. Errors pass through
unchanged: the client already turns every failure into an `ApiError`, and
screens show it with `ErrorBlock` / `errorMessage()`.

```ts
// features/customer/real/order.ts
import { apiClient, type ApiClient } from '../../../lib/api/client'
import { getOrder as fetchOrder } from '../../../lib/api/orders'

export async function getOrder(reference: string, client: ApiClient = apiClient): Promise<CustomerOrder> {
  return customerOrderFromRead(await fetchOrder(reference, undefined, client))
}
```

**3. The switch:** one line in `<feature>Api.ts`, replacing
`notConnected(...)`. The signature screens call does not change.

```ts
// features/customer/customerApi.ts
import * as real from './real/order'

export const getOrder = (reference: string): Promise<CustomerOrder> =>
  USE_MOCKS ? mock.getOrder(reference) : real.getOrder(reference)
```

**Tests** (`real/<area>.test.ts`), following `lib/api/orders.test.ts`: a
`createApiClient` with a fake `fetch`, then one test per outcome.

```ts
import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from '../../../lib/api/client'
import { getOrder } from './order'

function clientReturning(body: unknown, status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  return createApiClient({ baseUrl: 'http://api.test', fetch })
}

describe('getOrder (real)', () => {
  it('converts the backend order', async () => {
    const order = await getOrder('MO-7KQ2M9XH4T', clientReturning(SAMPLE_ORDER_READ))
    expect(order.stage).toBe('on_the_way')
  })

  it('passes a backend error through as an ApiError', async () => {
    const client = clientReturning({ error: { code: 'order_not_found', message: 'Order not found', details: null } }, 404)
    await expect(getOrder('MO-X', client)).rejects.toMatchObject({ code: 'order_not_found' } satisfies Partial<ApiError>)
  })
})
```

Take sample bodies from `docs/api/examples/`, so tests and contract agree.

## Decisions (2026-10-26, @chidimmamogbo)

1. **The fork's backend follows the new design.** Orders gain a delivery
   type, the jerrycan or tank details, a water source and a price. Contract:
   #10. Build: #21. Customer order adapters (#9) wait for #21.
2. **Quantities are litres on the server, converted exactly.** See
   [Quantities](#quantities).
3. **Two new customer stages:** `failed` shows "Delivery failed" and
   `disputed` shows "Under review". See [Customer order stage](#customer-order-stage).
4. **No order below 600 litres.** Keke 12 × 25 L (300 L) is no longer
   offered; 12 cans stays for 50 L cans (`canCountsFor` in
   `frontend/src/domain/orders.ts`).

## Names

| Backend | New design | Rule |
| --- | --- | --- |
| role `driver` | "rider" (Keke) or "driver" (Tanker), together "partner" | One server role; the partner's vehicle type picks the word and the app (design decision 9) |
| role `admin` | "admin", "staff" | Same role |
| role `customer` | "customer" | Same role |
| `reference` (`MO-…`) | `reference` | Same value; `shortReference()` only shortens it for display |
| `contact_name`, `contact_phone` | `receiver_name`, `receiver_phone` | Same meaning: the person receiving the delivery |
| `delivery_address`, `landmark`, `delivery_instructions` | `address`, `landmark`, `instructions` | Same meaning |

## Quantities

Source: SRS v0.3 FR-021 and `backend/app/modules/orders/quantities.py`.

- The server stores whole **litres**. **1 local gallon = 4 litres, exactly**,
  so conversion never estimates.
- **Keke:** litres = can size × can count (`kekeTotalLitres`), sent as
  `quantity_litres`.
- **Tanker:** sent as `quantity_local_gallons`; the server stores gallons × 4
  (500 gal = 2,000 L, 750 gal = 3,000 L, 1,000 gal = 4,000 L).
- **Tanker capacity:** the gallons a driver types at sign-up × 4 is a
  *declared* capacity in litres, never `safe_payload_litres`. An
  administrator verifies it and records the vehicle's safe payload in litres
  (FR-013); assignment compares that verified value, litres with litres.
- **Minimum order: 600 litres.** The server rejects less (`validation_error`).
- **Display:** both units together, exactly, with the gallon value to at most
  two decimal places (601 L = 150.25 gal). Client-side conversion is display
  only; the server's value wins (FR-021). Screens change in #25.

## Money

- Integer **kobo** on both sides (SRS §5, BR-01). The design names amounts
  `*_minor_units`; keep the backend's field names in the adapter and rename
  only at the edge.
- Never compute a price in the client (FR-022). A missing price is shown as
  missing, never filled in.

## Phones, dates and times

- **Phones:** the server returns E.164 (`+2348012345678`); send whatever the
  user typed and let the server normalize it. Format for display with
  `frontend/src/lib/format/phone.ts`.
- **Timestamps:** UTC ISO strings on both sides; format for display in
  Africa/Lagos with `frontend/src/lib/format/datetime.ts`.
- **`preferred_delivery_date`:** a Lagos calendar date (`YYYY-MM-DD`), a
  preference, never a booked slot.

## Customer order stage

Backend `status` (docs/api/orders.md, "Order statuses") to the design's
`DeliveryStage`. The customer must not learn of an assignment before the
driver accepts it (FR-032). Before confirmation the order never reads as
waiting for a rider (FR-027): a quote request is "Request received" and a
priced order "Awaiting confirmation", the agreed label in
[orders.md](../api/orders.md) (decided by @chidimmamogbo on #79,
[customer-live-prices.md](../design/customer-live-prices.md), decision 3;
built in #121).

| Backend `status` | Design stage | Label |
| --- | --- | --- |
| `quote_requested` | `request_received` (new) | Request received ("We're preparing your price.") |
| `awaiting_confirmation` | `awaiting_confirmation` (new) | Awaiting confirmation |
| `confirmed`, `awaiting_payment` | `waiting_rider` | Waiting for rider |
| `assigned` | `waiting_rider` | Waiting for rider (FR-032: not accepted yet) |
| `accepted`, `departed` | `rider_assigned` | Rider assigned |
| `collected` | `picked_up` | Picked up |
| `en_route`, `arrived`, `unloading` | `on_the_way` | On the way |
| `delivered` | `delivered` | Delivered |
| `cancelled` | `cancelled` | Cancelled |
| `failed` | `failed` (new) | Delivery failed |
| `disputed` | `under_review` (new) | Under review |
| any value not listed | `order_update` | Order update (the agreed neutral wording, docs/api/orders.md, #82) |

Adapters must never fail on an unknown `status` (docs/api/orders.md).

The order timeline (`GET /orders/{reference}/history`, #155) uses this table:
"Order placed", then one step each time the stage changes, so `assigned`
adds nothing before the driver accepts.

## Customer order price and category

Source: `priceFromRead` in `frontend/src/features/customer/real/order.ts`
(#165), and "Customer pilot changes (#99)" in [orders.md](../api/orders.md).
The customer sees a total only, never a breakdown, so `water` and `delivery`
stay `null`.

| `OrderRead` has | `CustomerOrder.quote` | Category label |
| --- | --- | --- |
| `price` (the order is confirmed) | `total_minor_units` and `currency` from `price` | `water_category.label`, the label frozen with the confirmed price (FR-014, FR-024); if it is missing, the quote's label, else `null` |
| no `price`, but `quote` | `total_minor_units` and `currency` from `quote` | `quote.water_category.label` |
| neither | `null` ("We're preparing your price.") | none |

The confirmed `price` replaces the quote once it is set, so a manual price
that differs from the quote is the one the customer sees. `is_sample` is
always `false` on the real path.

### Delivery window

Source: `windowFromRead` in `frontend/src/features/customer/real/order.ts`
(#188).

| `OrderRead.delivery_window` | `CustomerOrder.delivery_window` |
| --- | --- |
| `{ start_at, end_at }`, the end after the start | the same two UTC timestamps |
| `null` (not confirmed yet), absent (an older server), or an end that is not after the start | `null` |

The screens show the window in Africa/Lagos time, only while the order is open,
and never as an arrival time (FR-037).

## Partner job stage

Backend driver job (`lib/api/driverJobs.ts`: `status` plus the order
`status`) to the design's `JobStage`.

| Backend | Design stage |
| --- | --- |
| job `offered` | `assigned` (offered to this partner, may accept or decline) |
| order `accepted`, `departed` | `accepted` |
| order `collected`, `en_route`, `arrived`, `unloading` | `collected` |
| order `delivered` | `delivered` |
| order `cancelled` | `cancelled` |
| order `failed` | `failed` ("Delivery failed") |
| order `disputed` | `under_review` ("Under review") |

Decided by @chidimmamogbo on #12 (2026-10-26), following decision 3 for
customers: history shows failed and disputed jobs; it never hides them.

### Partner job fields the backend does not send

Decided by @chidimmamogbo on #12 (2026-10-26). The design's `PartnerJob`
(`domain/partner.ts`) allows `null` for these, and the screens leave them
out rather than fill them in:

| Design field | Rule |
| --- | --- |
| `choice` | `null` until #21 adds the cans or tank. The screens show `quantity_litres` (always sent) in litres and gallons, and take Keke or tanker from the partner's own app |
| `station.distance_km`, `station.minutes`, `customer.distance_km`, `customer.minutes` | `null`: no road distance without OSRM (SRS §12.1). Hidden |
| `earning_minor_units` | `null`: partner pay is out of the MVP (docs/api/partners.md, decision 7). The earning line is hidden, not shown as "not known yet" |
| `assigned_by` | `null`: the job does not name the dispatcher |
| payment status | Not in `PartnerJob`: partners never see an order's payment status (FR-040, BR-13; docs/design/driver-cash.md, decision 3). The K1 Cash card (#20) takes its place |
| `cash` | The job's `cash` as sent (payments.md, amendment 2; the contract's `JobCash`, unconverted): `null` until unloading is complete and on a job that ended without unloading, so the Done screen shows no Cash card. Delivered jobs come from the `done` group, which carries it too (#20) |

Also decided by @chidimmamogbo on #12 (2026-10-27), for fields missing on
whole groups of jobs:

| Design field | Rule |
| --- | --- |
| `customer.contact_name`, `customer.phone` | `null` on an offer (FR-032: no receiver before the driver accepts) and after the job ends (`DriverJobDetail.receiver`). Screens name the area only, leave out the "Customer" / "Delivered to" row, and show no call or message button |
| `station.address`, `customer.address` | `null` when the job carries only summary fields (history, ended jobs) or no delivery address yet (offers). Screens show the area instead |
| `code_tries_left` | `null` before the delivery code is issued (`delivery_code: null`). The code screen shows "Waiting for the delivery code", never "locked" |
| ended jobs | `GET /driver/jobs/{reference}` answers 404 once a job is completed, so the adapter takes it from the `done` list of `GET /driver/jobs`, with the summary fields only |

Mock mode keeps every value (`StoredJob` in `mocks/seed.ts`).

How the #12 adapter (`features/partner/real/jobs.ts`) fills the rest,
decided by @Bonvee120 for #12 (2026-10-27):

| Design field | From the backend job |
| --- | --- |
| `station.name`, `station.area` | `source.name` or `source_name`; "Station not set yet" while the dispatcher has not picked a source |
| `station.address` | `source.approximate_location` (detail only), else `null` |
| `customer.name`, `customer.area` | `delivery_area` (the address's first line). No neighbourhood is invented; "Address not known yet" if the job has none |
| `customer.address`, `customer.landmark`, `instructions` | `delivery_address`, `landmark`, `delivery_instructions` (detail only), else `null` |
| `collected_at` | `pickup.picked_up_at` |
| `delivered_at` | `ended_at` when the order is `delivered` |
| `code_tries_left` | `delivery_code.attempts_left` |
| `code_sms_status` | `delivery_code.sms_status`: `accepted`, `failed`, or `null` before a code exists. When it is `failed` the code was recorded but not sent, so the code screen never says "Code sent" (FR-050; #138). The mock sets it with `simulateCodeProblem(reference, 'sms_failed')` |
| `tank_note`, `accepted_at`, `code_resend_at`, `pickup`, `remaining` | `null`: the job does not carry them |

### Available orders and declining

Decided by @chidimmamogbo on #12 (2026-10-26):

- **No job pool in the MVP.** In real mode `listAvailableJobs` returns `[]`
  and the screen shows its normal empty state. Offers reach the partner
  through `GET /driver/jobs` (`offers`) as stage `assigned` (FR-031,
  FR-032).
- **Decline reasons.** The design's reasons map to the backend's agreed
  ones (docs/api/deliveries.md):

  | Design `DeclineReason` | Backend `reason` | `note` sent |
  | --- | --- | --- |
  | `not_available` | `not_available` | the driver's note |
  | `too_large` | `vehicle_cannot_carry` | the driver's note |
  | `outside_area` | `too_far` | the driver's note |
  | `vehicle_problem` | `other` | the design's label, then the driver's note |
  | `station_unavailable` | `other` | the design's label, then the driver's note |

  For `other`, the label comes first and the driver's note is cut so the
  whole text fits in 300 characters (`DECLINE_NOTE_MAX_LENGTH`). The adapter
  never sends `unsafe_access`, which has no design reason.

### Trip steps and problem reports

Decided by @Bonvee120 for #13 (2026-10-27). The fork's trip has fewer steps
than the backend (docs/api/deliveries.md, part 2 "Job flow"), so one partner
step sends several backend steps. Each is sent only if the job has not made
it yet, so a retry carries on where the last attempt stopped.

| Partner function (screen) | Backend steps |
| --- | --- |
| `confirmPickup` (pickup, loading) | `transition` `departed` (Start job; the customer's "dispatched" SMS goes out now), `pickup`, `transition` `en_route` |
| `completeUnloading` ("Unloading done, send the code") | `arrive` with no location (`location_consent: false`), `transition` `unloading`, `unloading-complete` (sends the code) |
| `verifyCode` (code) | `proof` with the code |
| `resendCode` (code) | `delivery-code` |
| `reportIssue` (report a problem) | `incidents`; with no order, `not_connected` (no driver endpoint) |

| Field sent | Value |
| --- | --- |
| pickup `source` | `{ "assigned": true }`: the fork has no "another source" choice |
| pickup `volume_collected_litres` | Tanker: the gallon count × 4 (FR-021). Keke: the ordered litres; the screen only lets the rider leave with every can loaded |
| pickup `source_reference`, `safety_concern`, `safety_note` | `null`, `false`, `null`: the receipt is a tick, not a number, and the screen has no safety question. The tick and the photo are not sent |
| proof `delivered_litres` | `pickup.volume_collected_litres`, the litres recorded at pickup. Never the ordered amount |
| proof `unloading_confirmed`, `location`, `location_consent` | `true`, `null`, `false`: the code screen tells the partner to unload first, and asks for no location |

Wrong codes are renamed to what the code screen reads:
`delivery_code_invalid` becomes `invalid_code` with
`details.tries_left` (from `attempts_remaining`), or `code_locked` when
`attempts_remaining` is 0. `delivery_code_expired`, `rate_limited`,
`delivery_code_still_valid` and the rest pass through.

| Design `PartnerIssueType` | Backend incident `type` | `note` sent |
| --- | --- | --- |
| `unsafe_pour` | `unsafe_transfer` (the server stops the job, hold `unsafe_stop`) | the partner's note |
| `station_problem` | `source_concern` | the partner's note |
| `vehicle_breakdown` | `vehicle_problem` | the partner's note |
| `bad_address`, `code_not_working`, `customer_unreachable` | `other` | the design's label, then the partner's note |

For `other`, the note is cut to 500 characters (`INCIDENT_NOTE_MAX_LENGTH`).
`running_late` and `volume_issue` have no design type and are never sent.

### Arrival and the unreachable customer (#250)

Decided by the technical lead on #250 (G2, 2026-10-29), design
[driver-arrival-unreachable.md](../design/driver-arrival-unreachable.md). The
trip gains an arrival step and the unreachable-customer steps of FR-038. The
design's `stage` does not change: `collected`, `en_route`, `arrived` and
`unloading` are all stage `collected`, so the new fields below tell the steps
apart. They are optional on `PartnerJob` (`domain/partner.ts`); the mock leaves
them out.

| Design field | From the backend job |
| --- | --- |
| `arrived_at` | `arrived_at` (the server's time; `null` before arrival) |
| `contact_attempts` | `contact_attempts[].attempted_at`, oldest first; `[]` before the first |
| `unreachable_allowed_at` | `unreachable_allowed_at` (`arrived_at` plus 10 minutes; `null` before arrival) |
| `can_start_unloading` | `allowed_actions` contains `start_unloading` |
| `can_fail_unreachable` | `allowed_actions` contains `record_failed_attempt` (two attempts and the wait over). Not computed from the phone's clock (design decision 6) |
| `ended_at` | `ended_at` (the server's time the job ended; `null` while open). Also on list rows. Added for U4 and the history row of a failed job |
| `end_reason` | `end_reason` (e.g. `customer_unreachable`; `null` while open or when delivered). Also on list rows |

The two flags go beyond the three fields the technical lead listed. The
contract already lists both actions; without them the screens would have to
guess from the device clock or from the stage, which cannot tell arrived from
unloading.

| Partner function (screen) | Backend steps |
| --- | --- |
| `arriveAtCustomer` (U1, "I have arrived") | `arrive` with `{ "location_consent": false }` and no `location`; repeating returns 200 unchanged |
| `startUnloading` (U2, "Start unloading") | `transition` `unloading` |
| `recordContactAttempt` (U3, "I tried to reach the customer") | `contact-attempts` (no body, 201); the screen shows the new row only after the answer |
| `failUnreachable` (U3-S, "Fail the delivery") | `transition` `failed`; the server sets `customer_unreachable`; the answer is the finished job in `done` |
| `completeUnloading` ("Unloading done, send the code") | now `unloading-complete` only; it no longer sends `arrive` or `transition` `unloading` |

Errors: 409 `transition_requirements_unmet` with `details.missing` of
`contact_attempts_recorded` and/or `unreachable_wait_elapsed` gives "Record
two attempts first." or "You can end this job from <time>."; 409
`invalid_order_transition` gives "This job has changed. Refresh."; 409
`job_on_hold` gives the paused notice; 404 `order_not_found` gives "This job was
reassigned." The words are in the design record.

## Admin order status

Backend `status` to the design's `AdminOrderStatus` (`domain/admin.ts`).

| Backend `status` | Design status |
| --- | --- |
| `quote_requested`, `awaiting_confirmation` | `awaiting_confirmation` ("Awaiting confirmation"; [admin-confirm-order.md](../design/admin-confirm-order.md), decision 3, built in #136) |
| `confirmed`, `awaiting_payment` | `awaiting_rider` |
| `assigned`, `accepted` | `assigned` |
| `departed` | `loading` |
| `collected`, `en_route`, `arrived`, `unloading` | `on_the_way` |
| `delivered` | `delivered` |
| `cancelled` | `cancelled` |
| `failed` | `failed` ("Delivery failed") |
| `disputed` | `disputed` ("Disputed") |

`AdminOrder.backend_status` (optional) carries the backend `status` as sent,
for the places that must tell apart statuses the design groups. Today that is
the order panel: `awaiting_rider` covers `confirmed` and `awaiting_payment`,
but only a `confirmed` order can be assigned, so an `awaiting_payment` order
shows "Waiting for the customer's payment to be verified" instead of the
assign panel (#144). Mock orders send none and stay assignable.

`failed` and `disputed` are admin statuses of their own (open question 5,
decided in #15), with the agreed staff labels from docs/api/orders.md. The
order's payment status maps only where the design has an exact equivalent
(`unpaid`, `awaiting_verification`, `paid`, `refunded`), plus
`pending_collection` shown as "Cash to collect" (@chidimmamogbo on PR #92)
and `partially_paid` shown as "Part paid" (the approved cash design,
docs/design/cash-remittance.md); for the others the order shows no payment chip, and the cash pages show them
in full (#19).

### Admin order driver (the "Rider" column and panel)

Source: `adminOrderFromRead` in `frontend/src/features/admin/real/orders.ts`
(#204, #243).

| Order | `AdminOrder.partner` |
| --- | --- |
| Live assignment on the detail (`offered`, `accepted`) | The assignment's driver |
| List row with a `driver` (live, or the one who held a delivered, failed or cancelled order) | That driver |
| Detail of a `delivered`, `failed` or `cancelled` order whose assignment is `completed`, or `withdrawn` after the driver accepted (`responded_at` set, no `decline_reason`) | The assignment's driver; the panel says "Delivered by <name>" for a delivered order, "Rider" for the others |
| Any other | `null` ("None yet") |

An offer that was never accepted, or was declined, names nobody. The list
(`GET /admin/orders`) sends the same driver in `driver` for an ended order
(deliveries.md, "Amendment (#243)"), so its Rider column and the panel agree.

### Admin order timeline

Source: `timelineFromHistory` in `frontend/src/features/admin/real/orders.ts`
(#242). The admin order panel's timeline is "Order placed" plus one line per
event of `GET /admin/orders/{reference}/history`, oldest first (the history
comes newest first), each with the event's `created_at`. The driver's
steps are the status changes into these statuses:

| `to_status` | Timeline line |
| --- | --- |
| `departed` | Departed |
| `collected` | Collected |
| `en_route` | En route |
| `arrived` | Arrived |
| `unloading` | Unloading |
| `delivered` | Delivered |

They follow "Accepted by <driver>" (assignment events, deliveries.md
"AdminOrderEvent"). Other status changes (`confirmed`, `assigned`) add
nothing of their own; a failed or cancelled order ends with "Delivery failed"
or "Cancelled".

#### Contact attempts on the timeline (#280)

Source: `withContactAttempts` in `frontend/src/features/admin/timeline.ts`,
called by `timelineFromHistory` (design:
[admin-order-contact-attempts.md](../design/admin-order-contact-attempts.md);
contract: deliveries.md, "Amendment (#280)").

| API | Timeline |
| --- | --- |
| `AdminOrderDetail.contact_attempts[].attempted_at` (UTC, oldest first, `[]` when none) | One line per attempt: "Contact attempt N", at that time. No detail line: the contract sends times only |
| `contact_attempts` missing from the response (a server older than the field) | No attempt lines. `parseDetail` reads it as `[]` |
| `StoredJob.contact_attempts` (mock mode: the times the mock partner recorded) | The same lines, built by the same function |

- **Number.** N counts the attempts by time across the whole order, whatever
  order the server listed them in.
- **Position.** Each line goes after the last entry that is not later than it,
  so a status event wins a tie (an attempt cannot precede the arrival it
  follows). "Order placed" stays first, and the events already in the list are
  not re-sorted.
- **Only with the history.** `getOrder` adds the lines when the history loaded.
  If the history read fails the timeline stays at "Order placed" (see above)
  and the attempts are left out too: a "Contact attempt 1" with no arrival or
  ending around it would mislead.
- **Any order with attempts**, not only a failed one: a job whose driver has
  arrived shows the attempts recorded so far, on the panel's next read.

## Price list (admin Pricing)

The Pricing screen (#173, design `docs/design/admin-pricing.md`) works in
the contract's own shape (`PriceList`, `PriceRule`, `PriceListDraft` in
`domain/admin.ts`, mirroring docs/api/admin-directory.md "Price lists"), so
the adapter (`features/admin/real/pricing.ts`) converts nothing except:

| Backend | Screen |
| --- | --- |
| `GET /admin/price-lists/current` 404 `price_list_not_found` | `null`: "No price list yet" |
| `zone_id` / `water_category_id` `null` | "Every area" / "Every water" |
| `zone_id` | the zone's name from `GET /admin/service-zones` |
| `water_category_id` | the label from `GET /admin/water-categories` (#161), active or not |
| `margin` `{type: "percentage", basis_points}` | percent, two decimals (1 % = 100) |
| `changes[]` (`path`, `from`, `to`) | worded by the screen: "Handling, every area: ₦400 → ₦500"; `from` `null` = "Rule added: …" |

The mock-era flat price table (can and tank prices, partner pay, delivery
switches, points) is now `SamplePriceTable`: it stays mock-only, pricing the
mock's sample quotes and the hidden Loyalty points page, and never reaches
the real Pricing screen.

## Admin operations (shell, dashboard, live map, activity, settings)

Backend `GET /admin/shell`, `/admin/dashboard`, `/admin/live-map`,
`/admin/activity` and `/admin/settings`
([admin-operations.md](../api/admin-operations.md), agreed, built in #102) to
the admin design types. The link issue is #217; it follows the contract's own
"Mapping to the design types" table, and adds the three screen decisions
marked **#217** below. Those three are proposed in this PR and are agreed when
a reviewer who is not the author approves it.

| Backend | Design type | Rule |
| --- | --- | --- |
| `GET /auth/me` + `GET /admin/shell` | `AdminShellData` | `user.name` from `/auth/me`; `user.role` is "Admin" (one staff role); `counts.orders` = `orders_needing_action`; `counts.support` = `support_requests_open`; `unread` = `notifications_unread` |
| `AdminDashboardRead` | `AdminDashboard` | `orders.awaiting_rider`, `in_progress`, `delivered`, `cancelled` are grouped from `by_status` with the [admin order status](#admin-order-status) table; `failed` and `disputed` are their own statuses and are not in those four. `disputes_open` = `support_requests_open`; `riders_online` = `drivers_available`; `stations.open` / `closed` = `sources.usable` / `not_usable`; `revenue_today_minor_units` = `cash.collected_minor_units` (integer kobo); `by_type` = `by_delivery_type` without `not_recorded`; `is_sample` = `is_simulated` |
| the same, fields with no source | `payouts_due`, `payments_to_verify` | The backend does not send them (payouts are out of the MVP; transfers are not verified in the pilot). The two types become optional and the two cards are hidden when absent, never shown as zero. **#217** (screen change, G2) |
| `LiveMapRead` | `LiveMapData` | `code` = driver `plate`, `null` shows no code; `vehicle` = `delivery_type`, `null` draws a neutral marker; `partner` = driver `name`; `station_area` = source `approximate_location`; `customer_area` = zone name, `null` shows no area. `stations` come from `sources`: `area` = `approximate_location`, `open` = `usable` (the same rule as the dashboard's open and closed counts) |
| `LiveMapRead.sources` | the Dashboard's "Refill stations" panel | The panel reads the live map's `sources` instead of `listStations`, which has no endpoint (stations stay on the command-line tool). No new request. **#217** |
| `ActivityItem` | `ActivityEntry` | `kind`: `order_status` with `to_status` `quote_requested` → `new_order`, `accepted` → `accepted`, `delivered` → `delivered`, any other status → `admin`; `support_request` → `complaint`; an unknown kind shows as a plain `admin` line, never an error. `reference` = `order_reference`. `text` is built by the adapter from `actor.name` (staff or driver only; customers are never named) and the status, for example "Sample Driver One accepted MO-7KQ2M9" |
| `AdminSettingsRead` | `AdminSettings`, `StaffMember` | Read only. `support_phone` = `support.phone`; `code_time_limit` = "<n> minutes" from `delivery_code_validity_minutes`; `support_hours` and `safe_load` have no source and are not shown (no `[SUPPORT HOURS]` or `[SAFE LOAD]` placeholders); staff `role` is "Admin", `last_active` = `last_sign_in_at` (`null` reads "Never signed in"). The form loses its save button and editable fields. **#217** (screen change, G2) |

Dashboard and reports count **real** orders by default (`simulated=exclude`,
BR-09), so a database that holds only demo accounts shows zeros. The screens
send no `simulated` parameter and have no toggle (a toggle is new UI). With
`VITE_USE_MOCKS=true` they keep their SAMPLE tags (**#217**).

## Admin reports

Backend `GET /admin/reports` ([admin-operations.md](../api/admin-operations.md#get-adminreports),
agreed, built in #102 part 2) to `AdminReport`. The link issue is #218. The
adapter is `features/admin/real/reports.ts`.

| Backend | Design type | Rule |
| --- | --- | --- |
| `range` (query) | `ReportRange` | Always sent (`today`, `7d` or `30d`). A missing `range` is 422 `validation_error`, not a default (decision 7) |
| `AdminReportRead` | `AdminReport` | `range` as it is; `orders` = `orders.total`; `delivered` = `deliveries.delivered` (counted by the `delivered` event); `cancelled` = `orders.by_status.cancelled`, 0 when absent; `by_type` = `by_delivery_type` without `not_recorded`; `is_sample` = `is_simulated` |
| `cash.collected_minor_units` | `revenue_minor_units` | Integer kobo, shown in naira only for display. The screen's note reads "Cash collected" for real numbers |
| `by_zone[]` | `by_area[]` | `area` = `name`; the row with `name` `null` (orders with no zone) reads "Area not listed" |
| `by_driver[]` | `by_rider[]` | `name`; `code` = `plate` (`null` shows the name alone); `trips` = `delivered` |
| (no source) | `by_rider[].earned_minor_units` | The backend does not send it (partner pay is out of the MVP). The field becomes optional and the "Earned" column, and its CSV column, are hidden when absent, never shown as zero. **#218** (screen change, G2) |
| `by_source[]` | `by_station[]` | `name`; `loads` = `pickups`. A pickup at another source has no row (decision 9) |

The screen shows its SAMPLE tag when `is_sample` is true (always in mock mode),
and drops the "SAMPLE prices" revenue note otherwise. Like the dashboard, it
sends no `simulated` parameter, so it counts real orders (BR-09).

## Admin support, audit log and notifications

Backend support requests, audit log and admin notifications
([admin-operations.md](../api/admin-operations.md), agreed, built in #102) to
the admin design types. The link issue is #219; the rows follow the
contract's "Mapping to the design types" table. The two screen decisions and
the audit wording marked **#219** are proposed in this PR and are agreed when a
reviewer who is not the author approves it (the Support screen changes are
also a G2 request on #219).

| Backend | Design type | Rule |
| --- | --- | --- |
| `GET /admin/support-requests` (`q`, `limit`) | `listIssues(query)` | `q` = the search text; no `status` filter (open first, newest first, as the server sends). The adapter reads the first 100. `id` and `number` = `reference`; `type`: `late` and `wrong_quantity` as they are, any other type `other`; `title` from the type (**#219**): `late` "Delivery was late", `wrong_quantity` "Wrong quantity", the rest "Problem reported"; `message`; `reference` = `order_reference`; `reported_by` "customer" and `reporter_name` = `customer.name`; `at` = `created_at`; `urgent` is always `false` (no source); `status` as it is |
| `resolution` | `AdminIssue.resolution` | `reason` = `note`, `by` = `resolved_by.name`, `at` = `resolved_at`. There is no `action` and no `points` in the backend: `action` is absent and the screen shows the note only |
| `GET /admin/support-requests/{reference}` `contacts` | `getIssuePeople(id)` | `id` is the `reference`. `role`: `customer` "Customer"; `driver` "Driver" (the contract says "Rider" or "Driver" by delivery type, which the contacts do not carry). `phone` as it is |
| `POST /admin/support-requests/{reference}/resolve` | `resolveIssue` | Body `{ note }` from the screen's note; the screen sends no action or points. 200 returns the resolved request, mapped as above. 409 `support_request_already_resolved` and 422 `validation_error` (note 5 to 500 characters) show through the error text |
| `GET /admin/audit-logs` (`limit`) | `listAudit(limit)` | `actor` = `actor.name`; `action` = the words below, an unknown code shown as it is; `reason` = `details.reason` for the four driver actions (`driver_approved`, `driver_suspended`, `driver_activated`, `driver_deactivated`), `null` for every other row (admin-operations.md, "The reason", #293); `target` = the record kind in words and the first 6 characters of `target_id`, `Driver · 4f3a2c` (table below). Newest first, as the server sends |
| `GET /admin/notifications` | `listAdminNotifications` | `at` = `created_at`; `title` and `body` as sent; `read` = `read_at !== null`; `link`: a notification with an order `reference` opens `/admin/orders?ref=<reference>`; `partner_pending` opens `/admin/riders`; `support_request` without a reference opens `/admin/support`; any other opens `/admin/notifications` |
| `POST /admin/notifications/read` | `markAdminNotificationsRead` | No body: every unread message of this admin; 204 |

The Support screen shows what the contract has (**#219**, G2 on the issue):
one required note, no resolution picker, no points, and no "urgent" count in
the subtitle in real mode. Confirming without the code, withdrawing and
cancelling are done from the order's page and the hold review, which are
already linked.

**Audit log wording (#219).** The action codes the backend writes, in words
for the Settings page (the actor and the time are in their own columns):

| Code | Words |
| --- | --- |
| `account_name_corrected` | Corrected an account name |
| `cash_corrected` | Corrected a cash amount |
| `cash_handed_over` | Handed over cash |
| `cash_received` | Received cash |
| `cash_reconciled` | Reconciled cash |
| `cash_recorded` | Recorded a cash collection |
| `cash_remittance_recorded` | Recorded a cash handover |
| `customer_address_added` | Added a customer address |
| `customer_anonymized` | Anonymized a customer account |
| `deletion_requested` | Deletion requested |
| `driver_approved`, `driver_suspended` | Approved a driver, Suspended a driver |
| `driver_activated`, `driver_deactivated` | Activated a driver, Deactivated a driver |
| `driver_went_online`, `driver_went_offline` | A driver went online, A driver went offline |
| `order_confirmed` | Confirmed an order |
| `partner_registered`, `partner_anonymized` | A partner signed up, Anonymized a partner account |
| `password_changed` | Changed a password |
| `price_list_saved` | Saved a price list |
| `proof_override_approved`, `proof_override_rejected` | Approved alternative proof, Rejected alternative proof |
| `retention_review_applied` | Applied a retention review |
| `service_zone_created`, `service_zone_updated` | Added a service area, Changed a service area |
| `source_review_continued` | Let a pickup continue after a source review |
| `support_request_resolved` | Resolved a support request |
| `unsafe_stop_resumed` | Resumed a job after an unsafe stop |
| `water_source_added`, `water_source_kind_set`, `water_source_activated` | Added a water source, Set a water source's kind, Activated a water source |

Codes built from a status (`deletion_request_<status>`,
`water_source_<status>`) and any code added later show as the code itself,
until a row is added here. The five cash codes are G2 approved
(@nnamdi-security, 2026-10-31, #293).

**Audit log record (#293).** Each row shows what it is about, as the kind of
record in words and the first 6 characters of `target_id`: "Driver · 4f3a2c".
It is a stopgap so two rows about different drivers can be told apart; the
backend's `target_label` (#296) will replace the id with a name or reference.
A kind with no words shows as the code itself.

| `target_type` | Words |
| --- | --- |
| `driver` | Driver |
| `order` | Order |
| `service_zone` | Service area |
| `price_list` | Price list |
| `cash_collection` | Cash collection |
| `cash_remittance` | Cash handover |
| `water_source` | Water source |
| `support_request` | Support request |
| `customer_address` | Customer address |
| `user` | Account |
| `deletion_request` | Deletion request |
| `retention_review` | Retention review |

## Admin customers and drivers

Backend customers and drivers ([admin-directory.md](../api/admin-directory.md),
agreed 2026-10-28, built in #45) to the admin design types. The link issue is
#220; the rows follow the contract's "Mapping to the design types" table. The
screen decisions marked **#220** are proposed in this PR and agreed when a
reviewer who is not the author approves it (they are also a G2 request on #220).

**Customers**

| Backend | Design type | Rule |
| --- | --- | --- |
| `GET /admin/customers` (`q`, `limit`) | `listCustomers(query)` | `q` = the search text. The adapter reads the first 100. `customers` = `items`; `total` = `total` (the customers matching `q`); `ordered_this_week` = `ordered_last_7_days`, which counts the last 7 days and not the calendar week, so the real-mode subtitle says "ordered in the last 7 days" (**#220**) |
| `AdminCustomerSummary` | `AdminCustomerSummary` | `orders` = `orders_count`. `is_active` is not used |
| `GET /admin/customers/{id}` | `getCustomer(id)` | `customer_since` = `created_at`; `total_paid_minor_units` = `paid_total_minor_units` (integer kobo). `email`, `points` and `complaints` have no source: `email` is `null`, the other two are absent, and the real-mode screen hides them and the "no email" text (**#220**) |
| `Address` | `addresses[]` | `id`, `label`, `address`, `landmark`, `is_default`; `zone` is dropped until a screen shows it |
| `recent_orders[]` | `recent_orders[]` | `quantity` = `quantity_litres` worded with the [quantity rules](#quantities); `delivery_type` is `null` for an order created before #21 and the screen then shows no Keke or Tanker word (**#220**); `status` through the [admin order status](#admin-order-status) table |
| `POST /admin/customers/{id}/addresses` | `addCustomerAddress(id, input)` | The backend needs `zone_id`, which the design's address form has no field for. The adapter sends the input's `zone_id` and refuses a call without one with a `validation_error` on `zone_id`, never a guessed zone. The only screen that adds an address is "Create order for a customer", which is not linked (`createOrderForCustomer` has no endpoint), so no real-mode screen reaches it yet. 404 `customer_not_found` and 404 `service_zone_not_found` show as they are |

**Drivers (riders)**

| Backend | Design type | Rule |
| --- | --- | --- |
| `GET /admin/drivers` (`delivery_type`, `approval_status`, `is_active`, `q`, `limit`) | `listRiders(filter, query)` | Always `is_active=true` (**#220**): a deactivated account has no design state and is never shown as "suspended". The pills map to the filters: `keke` and `tanker` to `delivery_type`, `pending` and `suspended` to `approval_status`, `all` to none. `limit` is 100 |
| `counts` | `counts`, `online`, `pending` | `counts.all`, `keke`, `tanker`, `pending` as they are; `online` = `counts.available`; `pending` = `counts.pending`. There is no `suspended` count, so it is `null`, never `0` |
| `AdminDriver` | `AdminRider` | `approval` = `approval_status`; `online` = `is_available`; `trips` = `completed_jobs`; `active_orders` = `live_jobs`; `partner_since` = `created_at`; `service_areas` = the `zones` names |
| `vehicle` | `vehicle` | `type` = `delivery_type` (`null` for a driver created with the command-line tool before sign-up); `plate` = `plate`, empty when `null`; `tank_gallons` = verified `safe_payload_litres` ÷ 4 for a tanker, `null` until approval and for a Keke |
| not sent | `code`, `rating`, `today_minor_units`, `payout_due_minor_units`, `documents_note`, `reported_issues` | Fleet code, rating, partner pay, documents and partner issues have no source in the MVP ([admin-directory.md](../api/admin-directory.md), "Not in `AdminDriver`"). They are `null` or absent, and the real-mode screen hides the code, the "Today" column, "Rating", "Payout due", "Documents" and "Reported issues" (**#220**) |
| `GET /admin/drivers/{id}` | `getRider(id)` | A deactivated account (`is_active: false`) is shown as the error state "This account is deactivated.", with the code `driver_inactive` (a client-side error, never "suspended") (**#220**) |
| `POST /admin/drivers/{id}/approval` | `setRiderApproval(id, action, reason, vehicle?)` | `approve` and `reactivate` send `approved`, with the reason when given; `suspend` sends `suspended` with a reason of 5 to 500 characters. Approving a partner with no verified vehicle also sends `vehicle` (`description`, `safe_payload_litres`, `transfer_methods`), which the approve form collects (**#220**, G2); approving a suspended partner who already has one sends none. 409 `driver_inactive`, `partner_phone_not_verified` and `driver_has_accepted_job`, and 422 `validation_error` (under the field it names), show in the server's words |

## Admin account and refill stations

The admin "My account" page and the admin menu's "Refill stations" entry
(#235). Decided by the technical lead (@nnamdi-security) on #235, 2026-10-29.

| Backend | Design type | Rule |
| --- | --- | --- |
| `GET /auth/me` | `getAdminAccount` result | `name` and `phone` as they are; `role` is "Admin" (the backend has one staff role); `last_active` is `null`. The page shows only the name, role and phone, so the settings staff list (`last_sign_in_at`) is not read for it. No wording changes on the page |

Refill stations has **no admin endpoint**: stations stay on the command-line
tool ([linking-plan.md](../process/linking-plan.md), "Not in the backend yet").
`listStations`, `setStationOpen`, `saveStation` and `uploadStationPapers` are not
mapped. In real mode the page is switched off with a flag
(`STATIONS_PAGE_ENABLED` in `lib/features.ts`): no menu entry, and
`/admin/stations` goes to the dashboard. The Dashboard's "Refill stations" panel
stays, reading the live map's water sources (see "Admin operations" above), and
its "Manage" link is hidden. Hiding adds no wording. Mock mode keeps the full
page.

## Open questions

| # | Question | Settled in |
| --- | --- | --- |
| 1 | The design's water sources (Ninth Mile, borehole) against the SRS water categories (Potable, Utility) and supplier activation (FR-012, FR-014) | #10 |
| 2 | ~~Keke 25 L × 12 cans is 300 L, below the 600 L minimum~~ Decided: removed (decision 4) | done |
| 3 | ~~A customer stage for a status the app does not know~~ Decided in #9: a new stage `order_update`, labelled "Order update" as the contract asks ([Customer order stage](#customer-order-stage)) | done |
| 4 | ~~Partner stages for `failed` and `disputed`~~ Decided: `failed` and `under_review` ([Partner job stage](#partner-job-stage)) | done |
| 5 | ~~Admin statuses for `failed` and `disputed`~~ Decided in #15: their own admin statuses, "Delivery failed" and "Disputed" ([Admin order status](#admin-order-status)). Staff confirm orders before dispatch under "Awaiting confirmation" (#72, built in #136) | done |
| 6 | ~~The design's "available" job pool has no backend endpoint~~ Decided: no pool in the MVP; `listAvailableJobs` returns `[]` ([Available orders and declining](#available-orders-and-declining)) | done |
