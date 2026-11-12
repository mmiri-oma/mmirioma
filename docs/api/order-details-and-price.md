# Order details and price contract

Requirements: FR-010, FR-011, FR-012, FR-013, FR-014, FR-020, FR-021, FR-022,
FR-023, FR-024, FR-026, BR-01, BR-02, BR-05, NFR-002 · Acceptance tests: T-01,
T-02, T-03, T-09, T-17, T-18 · Issue: #10 · Built in: #21

**Status: agreed** (G3) on 2026-10-26 by @nnamdi-security, technical lead,
sole approver under #36, with @chidimmamogbo's decisions on #42. Proposed by
@Daveoski (+ Claude Code) in #10, brought to agreement in #42. Not built yet
(#21).

**Revised 2026-10-26** after @chidimmamogbo's review of PR #28: open questions
1, 2 and 6 decided (FR-022 only, one fixed pilot category, customers see the
total only), and five requested changes applied. See [Changes](#changes).

**Amended 2026-10-26 for #30:** the customer sends the service zone they
picked (`service_zone_id`, FR-020) with the address; zone fees give the
delivery cost ([admin-directory.md](admin-directory.md#delivery-cost-from-the-zone)).

**Brought to agreement (#42, 2026-10-26):** no price without the address,
the FR-023 disclosure, the pilot category (Utility Water), and the technical
lead's answers to open questions 3, 4, 5, 7, 8, 9 and 11 recorded. Open
questions 12 and 13 are resolved by the agreed pilot fallbacks F3 and F5
(order confirmation, [deliveries.md](deliveries.md#order-confirmation-endpoints)),
confirmed by the technical lead; question 14 decided (#21 extends the
confirm endpoint). See [Changes](#changes).

Decision behind it (2026-10-26, @chidimmamogbo,
[api-mapping.md](../architecture/api-mapping.md#decisions-2026-10-26-chidimmamogbo)):
the fork's backend is extended to match the new design. Orders gain a delivery
type, the jerrycan or tank details, a water source and a price.

## What this changes

Everything here is **additive** to the agreed [orders contract](orders.md):

1. A new endpoint, `POST /quotes`, that prices a choice on the server (FR-022,
   SRS §6).
2. `POST /orders` accepts the delivery details and an optional `quote_id`.
3. `OrderRead` (and `AdminOrderRead`) return the delivery details and the
   quote the order was placed with.

A client that sends today's `OrderCreate` (quantity only) gets the same
behavior as before.

## Where this comes from

| Source | What it gives |
| --- | --- |
| `frontend/src/domain/orders.ts` | `WaterChoice` (delivery type, can size and count, tank type and size, water source), `Quote` |
| `frontend/src/mocks/pricing.ts` | The quote screen's behavior: a water line, a delivery line once the address is known, a total, a validity time, "manual quote" for custom sizes |
| `frontend/src/mocks/customerMock.ts` | `getQuote(choice, address)`, `createOrder` input, the refusals `manual_quote_required` and `no_station_open` |
| [handoff-v1.md](../design/handoff-v1.md) | Decisions 10, 10a, 10b: price per can or per tank size, a delivery fee once the address is known, a water source for Tanker only, Ninth Mile costs more |
| SRS v0.3 | Every business rule below; it is normative where it differs from the mocks |

### Where the mock and the SRS differ

The mock prices water as a flat amount **per jerrycan** (Keke) or **per tank
size and source** (Tanker), and the delivery fee as a flat, per-area or
per-km amount. FR-022 prices water as **the supplier's cost per litre × litres**
and the total as **water + delivery (base fee + OSRM road distance charge +
additional-trip charges) + handling + margin**, rounded **up** to whole naira.

This contract follows **FR-022** (the SRS is normative). The mock's amounts
remain samples (`is_sample: true`); the server never returns them.
**Decided** (open question 1, @chidimmamogbo, 2026-10-26): FR-022 only, no
flat per-can or per-tank prices. Knock-on: the fork's admin Pricing screen
(flat prices) is replaced by FR-022 price lists (handling and margin rates),
built in #37.

## Delivery details

Two delivery types (design decision 9; `DeliveryType` in
`frontend/src/domain/orders.ts`).

| Field | Type | Rule |
| --- | --- | --- |
| `delivery_type` | `"keke"` \| `"tanker"` | Required in the new shape. Keke carries jerrycans; Tanker fills a tank |
| `keke` | object \| null | Required when `delivery_type` is `keke`, otherwise `null` or absent |
| `keke.can_size_litres` | `25` \| `50` | The jerrycan size (design `c-keke`) |
| `keke.can_count` | integer | At least 1. `can_size_litres × can_count` must be at least 600 (FR-021). Any count that reaches 600 L is accepted; the client keeps the design's presets 12, 24, 30 and 60 ([open question 4](#open-questions), decided) |
| `tanker` | object \| null | Required when `delivery_type` is `tanker`, otherwise `null` or absent |
| `tanker.tank_type` | `"ground"` \| `"overhead"` | The customer's tank (design `c-tanker`). Recorded for the driver only; it does not affect the price or the vehicle ([open question 5](#open-questions), decided) |
| `tanker.quantity_local_gallons` | integer | 150–25000, as in [orders.md](orders.md#order-object). The design's standard sizes 500, 750 and 1,000 gallons are FR-021 presets (2,000, 3,000 and 4,000 L); a custom size is any other value |
| `water_source` | `"ninth_mile"` \| `"borehole"` \| null | Tanker only (decision 10, changed 2026-10-16: Keke has no source choice). Required for Tanker, `null` for Keke. A **preference**, not a source assignment; see [Water source and category](#water-source-and-category) |

### Quantity (FR-021)

The server stores whole litres and converts exactly; the client never sends
litres for the new shape:

- **Keke:** `quantity_litres = can_size_litres × can_count`.
- **Tanker:** `quantity_litres = quantity_local_gallons × 4`.
- The result must be at least **600 litres** (FR-021, T-17), else 422
  `validation_error` on the field that set it (`keke.can_count` or
  `tanker.quantity_local_gallons`).
- Sending `quantity_litres` or a top-level `quantity_local_gallons`
  together with `delivery_type` is 422 `validation_error`: the details are the
  single source of the quantity.

`quantity_litres` stays in every response, always in litres
([orders.md](orders.md#order-object)).

A custom tank size is **not** automatically a manual quote. The mock returns
`manual_quote_required` for every custom size; under FR-021 a quantity becomes
a manual quote only when no configured vehicle and trip plan can carry it
(FR-013, T-03). The server decides.

## Water source and category

The design asks Tanker customers for a **source** ("Ninth Mile water" or "Any
Bore hole water"). The SRS has **categories**, Potable Water and Utility Water
(FR-014), and **sources** that are activated per category after laboratory
verification (FR-011, FR-012). These are different things:

- `ninth_mile` and `borehole` describe **where** the water is collected. They
  are a kind of `water_sources` row, not a category.
- A category is what FR-022 prices by (cost per litre per supplier and
  category, FR-011) and what FR-023 requires the customer to see before
  confirming.

Proposed:

1. `water_source` is the customer's **source preference**, stored on the order.
   It narrows which sources may serve the order; the dispatcher still picks the
   actual source at confirmation, through the existing FR-012 eligibility check
   ([water-sources.md](../features/water-sources.md)). It is never a quality
   claim (FR-014): the labels stay "Ninth Mile water" and "Any Bore hole water".
2. `water_sources` gains a `kind` (`ninth_mile` or `borehole`) so the server can
   match a preference to sources (schema change, migration in #21).
3. Every quote and order carries a **water category**, as FR-022 (price by
   category) and FR-023 (the customer sees it before confirming) require.
   **Decided** (open question 2, @chidimmamogbo, 2026-10-26): **one fixed
   category for every pilot order**, with no customer choice and no screen
   change:
   - The client sends **no** category. The server prices and stores every
     quote and order with the configured pilot category, read through
     `get_settings()` (CLAUDE.md) by its code, `potable` or `utility`.
   - **Decided** (@chidimmamogbo, 2026-10-26; confirmed by the technical
     lead): the pilot category is **`utility` (Utility Water)**. Potable
     Water needs a source activated after laboratory verification first
     (FR-012, FR-014); the setting can change to `potable` later, without a
     contract change.
   - If the configured category is inactive or has no activated source, the
     quote answers `manual_quote_required` / `category_unavailable`.
   - The response names the category (`water_category`), so the customer
     sees it before ordering (FR-023).
4. When several eligible sources match the preference, the **highest** cost
   per litre among eligible sources of the preferred kind prices the quote,
   so the source confirmed later never costs more than the quote (FR-011,
   FR-022; [open question 3](#open-questions), decided by the technical lead).

Decision 10b ("Ninth Mile costs more") then follows from FR-022 without a
separate rule: Ninth Mile sources have a higher cost per litre.

## `POST /quotes`

Prices a choice on the server (FR-022, SRS §6). Customer only. Rate-limited
(NFR-002: "rate-limit ... quote ... endpoints"): **30 quotes per customer
per 10 minutes and 120 per client IP per hour** (decided in #21 by the
technical lead), with the `too_many_attempts` error below. Every request
counts, whatever its answer.

### Request (`QuoteCreate`)

```json
{
  "delivery_type": "tanker",
  "keke": null,
  "tanker": { "tank_type": "ground", "quantity_local_gallons": 750 },
  "water_source": "borehole",
  "delivery_address": "12 Sample Close, Independence Layout, Enugu",
  "service_zone_id": "9e8d7c6b-5a4f-4e3d-8c1b-0a9f8e7d6c5b"
}
```

| Field | Rule |
| --- | --- |
| `delivery_type`, `keke`, `tanker`, `water_source` | As in [Delivery details](#delivery-details) |
| `delivery_address` | **Required**, as `OrderCreate.delivery_address` (5–500 characters). There is no price without the address: see below |
| `service_zone_id` | The zone the customer picked from [`GET /service-zones`](admin-directory.md#get-service-zones) (FR-020), or `null` / absent when their address is in no listed zone. An unknown id is 404 `service_zone_not_found`. No zone, or an inactive zone, makes the quote `manual_quote_required` / `outside_service_zone` |

**No price without the address** (decided by @chidimmamogbo, #42). A
water-only price (cost per litre × litres) would let a customer divide by
the litres shown and get the supplier's cost per litre, which is never sent
to a customer (FR-011, [water-sources.md](../features/water-sources.md)); it
is also not the "final total price" FR-023 requires. So every
`quote_available` answer is the full payable total. Knock-on for #9: the
customer screen asks for the price after the address step, not on the
quantity screen (design decision 10 showed a water price first).

No category field: the server uses the pilot category
([Water source and category](#water-source-and-category), point 3). Unknown
fields, including a `water_category_id`, are 422 `validation_error`, as in
`OrderCreate` today (`extra="forbid"`), so a client cannot believe it chose a
category.

Example: [quote-create-request.json](examples/quote-create-request.json).

### Response (200 `QuoteRead`)

Two shapes, told apart by `status` (SRS §6). A manual quote is a successful
answer, not an error ("If no price is reliable, use a structured
`manual_quote_required` response instead of fake numbers", SRS §6).

**`quote_available`**
([quote-available.json](examples/quote-available.json)):

```json
{
  "status": "quote_available",
  "quote_id": "c7e1b9a2-4d3f-4a6b-8e05-9f2d1c0b3a74",
  "currency": "NGN",
  "quantity_litres": 3000,
  "water_category": { "label": "Utility Water", "supported_uses": null },
  "total_minor_units": 2000000,
  "price_valid_until": "2026-10-26T13:30:00Z"
}
```

| Field | Rule |
| --- | --- |
| `quote_id` | UUID, always set on `quote_available`. It is `null` only on `manual_quote_required` |
| `quantity_litres` | The server's conversion (FR-021). The client shows this value, not its own |
| `water_category` | The pilot category's label and supported uses, as on `OrderRead` (FR-023) |
| `total_minor_units` | The payable amount in kobo (water + delivery + handling + margin, FR-022), a whole number of naira (rounded up; see [How the total is computed](#how-the-total-is-computed)) |
| `price_valid_until` | UTC. After it, the quote cannot be ordered (SRS §8). **1 hour** after the quote by default, a server setting in the pilot ([open question 7](#open-questions), decided; an admin screen for it belongs to #22) |

**Customers see the total only** (open question 6, decided by
@chidimmamogbo, 2026-10-26, as the agreed `orders.md` already says: "never a
breakdown"). The components (water, delivery, handling, margin, rounding),
the cost per litre, rates, road distance, vehicle, trips and margin type are
**never** sent to a customer: they go into the server's snapshot (FR-024) and
the admin views. Integer kobo throughout (BR-01, SRS §5). The points estimate and `is_sample` in the mock's
`Quote` type are not part of this contract (points are not in the SRS; they
belong to #11).

**`manual_quote_required`**
([quote-manual.json](examples/quote-manual.json)):

```json
{
  "status": "manual_quote_required",
  "quote_id": null,
  "quantity_litres": 6000,
  "reason": "no_vehicle_plan"
}
```

| `reason` | When | Source |
| --- | --- | --- |
| `outside_service_zone` | No `service_zone_id`, or an inactive zone | FR-010, T-02 |
| `no_eligible_source` | No source of the preferred kind is eligible for the category today | FR-012, BR-02, T-04 |
| `category_unavailable` | No source is activated for the category | FR-014 |
| `no_vehicle_plan` | No configured vehicle can carry the quantity in at most two trips | FR-013, FR-021, T-03 |
| `delivery_cost_unavailable` | No road distance, and the zone has no fee for the category | FR-022, T-18 |
| `no_price_rule` | No rule in the current price list covers the zone, category and litres, so handling and margin are unknown (decided in #21, additive) | FR-022, FR-021 |

When several apply, the first in this table's order is sent
(`outside_service_zone`, `category_unavailable`, `no_eligible_source`,
`no_vehicle_plan`, `delivery_cost_unavailable`, `no_price_rule`; decided in
#21). Nothing is stored for a manual answer.

The client shows its own wording per `reason` (clients branch on codes, not
messages, [README](README.md#errors)). An unknown `reason` gets the generic
manual-quote wording. The order can still be sent without a `quote_id` as a
quote request (`quote_requested`), as today.

**Pilot note:** the backend has no OSRM yet (SRS §12.1: OSRM hosting is
open). The delivery cost is the picked zone's fee for the category, once per
order (built in **#30**; rules in
[admin-directory.md](admin-directory.md#delivery-cost-from-the-zone)). The
zone fee replaces the **whole** FR-022 delivery cost (base fee, distance and
extra trips); the price rule contributes only handling and margin (decided
in #21). No fee
for the category answers `delivery_cost_unavailable`; no zone or an inactive
one answers `outside_service_zone` (FR-010, T-02). Never an estimated
delivery fee ("No fabricated route estimates", FR-022).

### How the total is computed

Decided in #21 by the technical lead (FR-022, BR-01):

- **Water:** the highest cost per litre among the sources eligible today for
  the category and of the preferred kind ([question 3](#open-questions);
  Keke: any kind), times the litres. Exact kobo.
- **Delivery:** the zone's fee ([Pilot note](#response-200-quoteread)).
- **Handling and margin:** from the price rule matching the zone, category
  and litres (#37). A fixed margin is exact kobo; a percentage margin applies
  to water + delivery + handling, computed with decimals and rounded
  **half-up** to whole kobo.
- **Total:** the sum, rounded **up** to whole naira. The rounding
  adjustment (0-99 kobo) is stored with the components.
- **Vehicle plan:** any active vehicle whose safe payload carries the order
  in at most two trips (FR-013); the plan records the fewest trips, then the
  smallest such vehicle. None gives `no_vehicle_plan`.

### Errors

| Status | `code` | When |
| --- | --- | --- |
| 404 | `service_zone_not_found` | Unknown `service_zone_id` ([admin-directory.md](admin-directory.md#error-codes-added-by-this-contract)) |
| 422 | `validation_error` | Invalid body; no `delivery_address`; below 600 litres; both or neither of `keke` and `tanker`; a `water_source` on a Keke choice or missing on a Tanker choice |
| 429 | `too_many_attempts` | Rate limit (NFR-002); `Retry-After` header, as in [auth.md](auth.md) |

Plus the shared 401, 403 (`forbidden` for staff and drivers, `csrf_failed`)
and 503 from the [README](README.md#errors). Phone verification is **not**
required to ask for a price; it is required to order (FR-003, unchanged).

### What the customer sees before confirming (FR-023)

FR-023: "Customer SHALL see final total price, quantity, applicable water
category/use description, delivery time window, price validity, the payment
method and the potential cancellation and redelivery charges (FR-044,
FR-038) before confirming." How each item is covered:

| FR-023 item | Covered by |
| --- | --- |
| Final total price | `total_minor_units` (always the full total: no price without the address) |
| Quantity | `quantity_litres`, the server's conversion (FR-021) |
| Water category and use description | `water_category.label` and `supported_uses` |
| Price validity | `price_valid_until` |
| Payment method | **No field.** Every pilot order is pay on delivery (F4), so the screen shows the fixed line "Pay on delivery", as the agreed `orders.md` already does for confirmed orders ("Pay cash after unloading") |
| Delivery time window | **Agreed with the customer on the confirmation call** (pilot fallback F3, [question 12](#open-questions)). Placing the order does not book a window: the order is `awaiting_confirmation` until the dispatcher agrees the window and confirms (row 7), and the agreed confirmation already requires the window to be told to the customer (`customer_agreement.disclosures_confirmed`). The checkout screen says the office calls to agree the delivery window; it never shows a window as booked (`preferred_delivery_date` stays a preference). After confirmation the customer sees it in `OrderRead.delivery_window` ([orders.md](orders.md#customer-pilot-changes-99)) |
| Potential cancellation and redelivery charges | **None in the pilot** (pilot fallback F5, [question 13](#open-questions)): the dispatcher tells the customer there is no cancellation or redelivery charge, and the agreed confirmation records that they did (`disclosures_confirmed`). The checkout screen states the same, with no amounts. FR-044's cap and FR-038's redelivery fee apply only once charges are introduced, with a contract change |

## `POST /orders` changes

> **Amended by [delivery-location.md](delivery-location.md) (#340):** `OrderCreate` gains an
> optional `delivery_location`, stored as the order's own copy and compared on an
> idempotent retry. It is not compared with the quote.

`OrderCreate` gains the [delivery details](#delivery-details) and an optional
`quote_id`. Like `POST /quotes`, it has no category field
([order-create-with-quote-request.json](examples/order-create-with-quote-request.json)):

```json
{
  "idempotency_key": "5b0e2c3a-7d1f-4e8a-b6c9-0a1b2c3d4e5f",
  "quote_id": "c7e1b9a2-4d3f-4a6b-8e05-9f2d1c0b3a74",
  "delivery_type": "tanker",
  "keke": null,
  "tanker": { "tank_type": "ground", "quantity_local_gallons": 750 },
  "water_source": "borehole",
  "contact_name": "Sample Customer",
  "contact_phone": "08000000001",
  "delivery_address": "12 Sample Close, Independence Layout, Enugu",
  "service_zone_id": "9e8d7c6b-5a4f-4e3d-8c1b-0a9f8e7d6c5b",
  "landmark": "Opposite the blue gate",
  "delivery_instructions": "Tank is behind the house",
  "preferred_delivery_date": "2026-10-27"
}
```

### Rules

- **The client never sends a price** (FR-022, SRS §6). The order's price is the
  quote's, looked up by `quote_id`.
- **Idempotency first** (FR-026, NFR-011, T-06). The server looks up the
  `idempotency_key` before any quote check:
  - same key, same body: 200 with the **original** order, even if its quote
    has expired since or a source stopped being eligible. A retry never
    turns into `quote_expired`;
  - same key, different body: 409 `idempotency_key_reused`, as today. The
    body comparison includes the new fields and `quote_id`.
- **With a `quote_id`**, on a new key, the server checks the quote in this
  order: it exists and belongs to this customer (else 404 `quote_not_found`);
  it is unexpired (else 409 `quote_expired`); it matches the order (else 422
  `quote_mismatch`); a source of the preferred kind is still eligible (else
  409 `no_eligible_source`). Then it freezes the quote on the order (FR-024,
  BR-01).
- **Without a `quote_id`:** the order is a quote request in `quote_requested`,
  as today (FR-021, FR-022 manual fallback).
- **`service_zone_id`** (FR-020): optional, as in `POST /quotes`, and stored
  on the order. An unknown id is 404 `service_zone_not_found`. With a
  `quote_id` it must equal the quote's zone ([When a quote matches the
  order](#when-a-quote-matches-the-order)). Without one, no zone or an
  inactive zone is accepted: the order is a quote request, which is FR-010's
  request-assistance path for an out-of-zone address.

### When a quote matches the order

Every field below must be equal, after normalizing as shown. Anything else
on the order (contact, landmark, instructions, date) may differ from the
quote request.

| Field | Comparison |
| --- | --- |
| `delivery_type`, `keke.can_size_litres`, `keke.can_count`, `tanker.tank_type`, `tanker.quantity_local_gallons`, `water_source`, `service_zone_id` | Exact |
| `delivery_address` | Normalized on both sides: trimmed, every run of whitespace (spaces, tabs, line breaks) collapsed to one space, compared case-insensitively (Unicode case folding). `"12 Sample Close,  Enugu "` matches `"12 sample close, enugu"`. Nothing else is rewritten: a changed comma or word is a mismatch, because the delivery cost was priced for that address |

The category is not compared: the quote carries the pilot category, and the
order keeps the quote's category even if the configured pilot category
changes between quote and order (FR-024).

### Status at creation

The state machine already has the transition: row 3 in
[deliveries.md](deliveries.md#transitions), `quote_requested` →
`awaiting_confirmation` by the customer, "accepts a valid quote, pay on
delivery, a check needs a dispatcher". Every pilot order is pay on delivery
(F4) and needs a dispatcher to confirm the source and window (row 7), so:

- an order **with** a valid `quote_id` is created by row 1 and moved by row 3
  in **one transaction**: two `order_events` rows, and the order is returned
  in `awaiting_confirmation`. No new state is added. Rows 2 (prepaid) and 4
  (straight to `confirmed`, needs slots, FR-025) stay unused in the pilot;
- an order **without** one is created by row 1 alone, in `quote_requested`.

The dispatcher then confirms a quoted order from `awaiting_confirmation`;
#21 extends the agreed confirm endpoint to accept it
([open question 14](#open-questions), decided).

Row 3's "Built in" column in `deliveries.md` points here, so both documents
are agreed together. The technical lead confirmed this approach
([open question 8](#open-questions)).

### Errors

New errors (in addition to those in [orders.md](orders.md#endpoints-sprint-1)):

| Status | `code` | When |
| --- | --- | --- |
| 404 | `quote_not_found` | Unknown `quote_id`, or another customer's (not probeable, as `order_not_found`) |
| 404 | `service_zone_not_found` | Unknown `service_zone_id` |
| 409 | `quote_expired` | `price_valid_until` has passed (SRS §8: "customer must requote"). Never on an idempotent replay |
| 422 | `quote_mismatch` | A field in [When a quote matches the order](#when-a-quote-matches-the-order) differs; `details` names the fields (`[{"loc": ["body", "delivery_address"], ...}]`) |
| 409 | `no_eligible_source` | Between quote and order, no source of the preferred kind is eligible any more (FR-012, BR-02) |

Examples: [error-quote-expired.json](examples/error-quote-expired.json).
The mock's 409 `no_station_open` is replaced by `no_eligible_source` (the
FR-012 gate is per source and category, not per station).

## `OrderRead` changes

> **Amended by [delivery-location.md](delivery-location.md) (#340):** the customer's `OrderRead`
> gains `delivery_location` (the stored copy, or `null`). Staff views do not return it.

Every endpoint that returns `OrderRead` gains
([order-with-details.json](examples/order-with-details.json)):

```json
{
  "delivery_type": "tanker",
  "keke": null,
  "tanker": { "tank_type": "ground", "quantity_local_gallons": 750 },
  "water_source": "borehole",
  "service_zone": { "id": "9e8d7c6b-5a4f-4e3d-8c1b-0a9f8e7d6c5b", "name": "Independence Layout" },
  "quote": {
    "currency": "NGN",
    "total_minor_units": 2000000,
    "water_category": { "label": "Utility Water", "supported_uses": null }
  }
}
```

| Field | Rule |
| --- | --- |
| `delivery_type`, `keke`, `tanker`, `water_source` | As sent. `null` on orders created in the old shape (before #21) |
| `tanker.quantity_local_gallons` | As sent; `quantity_litres` remains the stored value |
| `service_zone` | The zone sent with the order (`id`, current `name`), or `null` when none was sent |
| `quote` | The quote frozen at creation (FR-024), or `null` for a quote request. A later change to the pricing rules never changes it (T-09). **Total only** for customers (open question 6) |
| `quote.water_category` | What the customer accepted (FR-023): `label` frozen with the quote, so a later label change does not alter the order (FR-014, FR-024); `supported_uses` read live, as decided for `water_category` in [orders.md](orders.md#decided-questions) (question 2) |

`price` (agreed in [orders.md](orders.md#customer-pilot-changes-99)) stays
the **confirmed** price. With a quote it equals `quote.total_minor_units`,
unless the dispatcher repriced with documented customer agreement (BR-05,
FR-023). The top-level `water_category` keeps its agreed meaning (the
category frozen at confirmation, `null` until then); `quote.water_category`
is the one accepted at checkout.

`AdminOrderRead` gains the same fields. The admin views of the full FR-024
snapshot (water, delivery, handling, margin, rates, distance, vehicle, trips,
margin type, rounding) are for #21, with the price lists from #37.

The creation-time quote is stored by #21 in its own `quotes` table (SRS §5)
with the FR-024 components and the frozen category label;
`order_price_snapshots` keeps meaning the **confirmed** price
([open question 11](#open-questions), decided by the technical lead).

## Driver cash label

The driver's Cash card shows how the amount due was priced
(`cash.amount_due_label`, [payments.md](payments.md)). The agreed value is
`manual_quote` ("Manual quote"); **`quote`** for a server quote is agreed in
[payments.md, amendment 3](payments.md#amendments-proposed-in-the-123-build). For an order created with a `quote_id`
and confirmed without repricing, `amount_due_label` is `quote`. If the
dispatcher repriced it as a manual quote, it stays `manual_quote`.

For `quote` the card shows "Pay on delivery: cash after unloading", never
"Manual quote", which would misstate how the price was set
([driver-cash.md](../design/driver-cash.md), decision 8, @chidimmamogbo).

## Mapping to the design types

For #9 (adapters) and `docs/architecture/api-mapping.md`:

| Backend | Design (`domain/orders.ts`) |
| --- | --- |
| `delivery_type` + `keke` | `WaterChoice` `{ delivery_type: 'keke', can_size_litres, can_count }` |
| `delivery_type` + `tanker` + `water_source` | `{ delivery_type: 'tanker', tank_type, tank_size_gallons, source }`: `tank_size_gallons` is `quantity_local_gallons` when it is 500, 750 or 1000, else `null` (custom) |
| `QuoteRead` `quote_available` | `Quote` `quote_available`: `total_minor_units` and `price_valid_until` only. The design's `water` and `delivery` lines have no source (total only, open question 6), so the Keke and Tanker summaries lose those lines in #9. `points_estimate` and `is_sample` have no source either ([open question 9](#open-questions)) |
| `QuoteRead` `manual_quote_required` | `Quote` `manual_quote_required`: `reason` text chosen by the client from the code |
| `service_zone_id` (request), `service_zone` (`OrderRead`) | No design field yet. The customer's address step needs a zone picker with a "my area is not listed" choice (sent as no zone), a screen change that needs G2 in #9 |

> **Follow-up proposal #408 (not agreed):** [source-selected pricing and ETA](road-pricing-and-eta.md) proposes replacing the longest/dearest road path and OSRM-only adapter. The existing #385 contract and runtime remain unchanged until that proposal passes G3.

## Amendment #385: road-distance pricing

**Status: agreed** (G3) on 2026-11-03 by @nnamdi-security (technical lead and
privacy contact), who is not the author, with the decisions and the privacy
condition under "Reviewer's decisions" at the end of this amendment. **Built in
#385** ([pricing.md](../features/pricing.md); see [Built in #385](#built-in-385)).
Requirements: FR-020, FR-022, FR-024,
T-18, SRS §8 "Road distance unavailable". Builds on
[delivery-location.md](delivery-location.md) (agreed, #340) and the OSRM
decision ([maps.md](../architecture/maps.md), option R1, #334). OSRM is not
deployed yet (#384), so **nothing changes for customers until it is**: with no
OSRM address configured, every quote is priced exactly as today.

Everything here is **additive**. A client that sends today's `QuoteCreate`
gets today's answer.

### What changes

FR-022: the delivery cost is **base delivery fee + distance charge +
additional-trip charges**, the distance charge using the **actual road
distance** between the water source and the delivery location, from OSRM.
Straight-line distance is never used. Today the zone's fee replaces the whole
delivery cost because there is no road distance ([Pilot note](#response-200-quoteread)).
This amendment adds the road-distance path and keeps the zone fee as the
fallback.

### `POST /quotes` takes `delivery_location`

`QuoteCreate` gains an optional `delivery_location`: the
[location object](delivery-location.md#location-object) of #340
(`latitude`, `longitude`, `source`), with the same rules and the same
[bounds](delivery-location.md#delivery-bounds), or `null` / absent for "no
pin". Errors are the same 422 `validation_error`, with `loc` naming
`delivery_location`.

The response is unchanged: customers still see the total only, never the
distance, the rates or whether road distance was used.

### When a quote uses road distance

All of these must hold; otherwise the quote uses the fallback below.

1. The request carries a `delivery_location`.
2. The picked zone is active (as today).
3. OSRM is configured and answers within its timeout with a route.
4. **Every source the quote could use has a `location`** (see
   [Which source](#which-source-decides-the-distance) and
   [Source location](#source-location)).
5. A price rule matches the zone, category and litres (as today).

The road-distance delivery cost is, in integer kobo (BR-01):

```
delivery = base_delivery_fee
         + distance charge                       (rate per km x road km)
         + (trips - 1) x additional_trip_charge
```

The three rates come from the **price rule that already supplies handling and
margin** ([admin-directory.md](admin-directory.md#price-lists)): its
`base_delivery_fee_minor_units`, `distance_rate_minor_units_per_km` and
`additional_trip_minor_units`. The vehicle plan supplies `trips` (1 or 2,
FR-013). The distance charge is the rate times the road distance in
kilometres, computed with `Decimal` from OSRM's metres and rounded
**half-up to whole kobo**; nothing else is rounded, and the total is then
rounded **up** to whole naira as before. The zone's fallback fee is **not**
added: in this path the price rule's delivery rates replace it.

### Which source decides the distance

A quote does not know which source staff will pick at confirmation, and the
water price already assumes the **dearest** eligible source (decision 3 under
[How the total is computed](#how-the-total-is-computed)). So the distance uses
the **longest** road distance from the delivery location to any eligible source
of the preferred kind (Keke: any kind). Whichever eligible source staff pick, the
price covers the trip, the same way the water price does. OSRM answers all the
sources in one request (its `table` service), so the number of sources does not
change the number of calls.

### Source location

A water source has only a text `approximate_location` (no coordinates), and
road distance needs a point. **Decided in this proposal** (the issue's
recommendation): add an optional `location` to a water source, set by an
administrator.

- `location` is `{ "latitude", "longitude" }` (WGS 84, inside the same
  bounds) or `null`. It is a new nullable `geography(POINT, 4326)` column on
  `water_sources`, one reversible migration.
- It is returned by `GET /admin/water-sources` and written by
  `POST` / `PATCH /admin/water-sources` and the `add-source` command
  ([admin-water-sources.md](admin-water-sources.md)). It is **never** sent to a
  customer or a driver.
- A source with `location: null` is allowed and is the default: it keeps
  working, and any quote that could use it uses the fallback. Nothing is
  guessed from the text or from the zone centre ("No fabricated route
  estimates", FR-022).

The admin Water sources screen gets no latitude and longitude fields in this
issue (a screen change needs its own design, G2); the endpoint and the command
come first.

### Fallback: when road distance is not used

The quote is priced exactly as today (T-18, SRS §8):

| Delivery cost | When |
| --- | --- |
| The zone's fee for the category, once per order | Any condition above fails, and the zone has a fee for the category |
| `manual_quote_required` / `delivery_cost_unavailable` | Any condition above fails, and the zone has no fee for the category |

`outside_service_zone` and the other reasons keep their order and meaning.
OSRM being down, slow or unable to find a route never refuses an order and
never produces a made-up distance; it only moves the quote to the fallback.
The reason road distance was not used is kept in the snapshot
([below](#what-the-quote-records)), not sent to the customer.

### The OSRM call

- **One request per quote** at most, to `GET {OSRM_BASE_URL}/table/v1/driving/…`
  with the sources and the delivery point and `annotations=distance`
  (metres). No request is made when conditions 1 to 2, 4 or 5 already fail.
- **A short timeout counts as down.** `OSRM_TIMEOUT_SECONDS`, a server setting;
  recommended default 2 seconds. A slow server never holds a customer's quote.
- **Configured through `get_settings()`**: `OSRM_BASE_URL` (empty means off).
  No new library: the existing HTTP client is used. Nothing is cached in
  this version.
- **No route for any needed source** (OSRM returns no distance for it) is the
  same as down.
- OSRM receives only coordinates. No name, phone, address or order data is sent.

### What the quote records

FR-024: a quote freezes how its delivery cost was found. The `quotes` row
gains (one reversible migration; existing rows are zone-fee quotes):

| Column | Rule |
| --- | --- |
| `delivery_basis` | `road_distance` or `zone_fee`. Existing rows: `zone_fee` |
| `road_distance_metres` | The longest distance used, whole metres; set exactly when `delivery_basis` is `road_distance` |
| `distance_source_id` | The source that distance belongs to; same rule |
| `distance_fallback_reason` | Set exactly when `delivery_basis` is `zone_fee` and a location was sent: `no_source_location`, `osrm_unavailable`, `no_route` or `timeout`. Null when no location was sent or OSRM is off (`no_delivery_location` is not stored: the absent location says it) |
| `base_delivery_fee_minor_units`, `distance_rate_minor_units_per_km`, `additional_trip_minor_units` | The rates applied, set with `road_distance` (FR-024: "the rates applied") |
| `delivery_location`, `delivery_location_source` | The point the quote was priced for, as the order stores it ([Storage](delivery-location.md#storage)); null when none was sent |

`delivery_minor_units` keeps meaning the whole delivery cost, whichever path.
An order keeps the quote it was placed with; a later change to OSRM, a source
location or the price list never changes an existing quote or order (T-09).

### The quote must match the order's location

[When a quote matches the order](#when-a-quote-matches-the-order) gains one
row:

| Field | Comparison |
| --- | --- |
| `delivery_location` | If the **quote** was priced with a location, the order's `delivery_location` must be present and have the same latitude and longitude at 6 decimal places (`source` is not compared); otherwise `quote_mismatch`. If the quote carries none, the order's location is not compared (the price did not depend on it) |

The idempotency comparison of #340 is unchanged.

### Tests the build must have (with a fake OSRM)

Road distance used and the exact kobo (including the half-up rounding and the
whole-naira total); the **longest** of several sources used; OSRM down, timeout
and no route each falling back; a source with no location; no delivery
location; OSRM off; no zone fee (manual quote); a changed location is
`quote_mismatch` and an unchanged one matches; the snapshot recording
`delivery_basis`, the distance, the source, the reason and the rates; **no
straight-line distance anywhere in pricing** (a test that the code never
computes distance from coordinates itself); a quote never changing an existing
order; and that no name, phone or address reaches OSRM.

### Decisions proposed in #385

1. **Longest distance across the eligible sources**, mirroring the water price.
   Alternatives: the nearest source (could under-price), or asking staff to
   pick the source before quoting (not how the flow works).
2. **A source location on the source**, not the zone centre, and any eligible
   source without one sends the quote to the fallback.
3. **The rates come from the matching price rule**, replacing the zone fee in
   the road-distance path.
4. **The distance is one way** (source to delivery location), charged **once**
   per order; extra trips are charged by `additional_trip_minor_units`, not by
   multiplying the distance. FR-022 says "the actual road distance between
   source and delivery location" and does not mention a return leg.
5. **Exact distance**: no rounding of kilometres; only the charge is rounded
   (half-up to kobo).
6. **A quote with a location must match the order's location**; a quote
   without one does not constrain it.
7. **Timeout default 2 seconds**, no cache, one `table` request per quote.

### Open questions for #385

1. Decision 4 (one way, once per order) and decision 1 (longest) are business
   rules the SRS does not spell out. The technical lead should confirm them.
2. OSRM snaps a point to the nearest road. A pin far from any road still gets a
   distance, from where it snapped. Should the quote fall back when the snap
   distance is large (for example over 500 m)? Recommendation: not in the first
   version; record OSRM's snap distances when measuring the deployment (#384).
3. Should the admin order detail show the road distance and the basis? Not
   proposed: the contract keeps the breakdown out of customer views, and
   `AdminOrderRead` is not changed here.
4. The Water sources screen needs latitude and longitude fields. Follow-up
   issue with its own design.

### Built in #385

- **Built:** `delivery_location` on `POST /quotes` (the #340 object, with the
  bounds in `DELIVERY_LOCATION_BOUNDS`, #340's box around Enugu State
  `5.9,6.9,7.2,8.0`); the OSRM adapter (`OSRM_BASE_URL`, empty means off;
  `OSRM_TIMEOUT_SECONDS`, default 2); the road-distance delivery cost and every
  fallback; a water source's optional `location` (admin API and `add-source`
  command); the quote's snapshot columns; the privacy rules below.
- **The quote match** (built after #340 merged): the order's `delivery_location`
  is compared with the quote's when the quote was priced for a pin: the same
  latitude and longitude at 6 decimal places, the `source` not compared, otherwise
  422 `quote_mismatch` with `loc` `["body", "delivery_location"]`. A quote with no
  pin (none was sent, or the privacy rules cleared it) does not constrain the
  order. `OSRM_BASE_URL` stays empty in production until #384's measurement of
  snapped distances is written down.
- **OSRM's snap distances** (the finding of #384): OSRM answers "Ok" for any point on
  Earth, moving it to the nearest road in whatever data it holds. The adapter reads
  the snap `distance` of every source and of the delivery point and carries the largest
  to the caller (`LongestRoad.max_snap_metres`, `RoadDelivery.max_snap_metres`). **No
  threshold is applied and nothing is stored yet**: a threshold, its fallback reason
  and a column need a contract change (proposed by the technical lead in a separate
  PR). Road-distance pricing must not be switched on before it is agreed.
- **A pin cleared by the privacy rules** does not make the quote invalid: the
  shape check covers the price, the distance and the rates, not the pin
  (migration `0027`).

### Reviewer's decisions

By @nnamdi-security, 2026-11-03 (recommendations, approved with the amendment):

1. **Longest road distance across the eligible sources:** agreed. It mirrors the
   water price, which takes the dearest eligible source, so whichever source
   staff pick the price covers the trip, and the rule is written down (PRD §7:
   adjacent orders must not vary without a documented rule). The nearest source
   could under-price.
2. **One-way distance, charged once per order, extra trips through
   `additional_trip_minor_units`:** agreed. It is the plain reading of FR-022 and
   FR-013. Consequence for whoever sets the price list: the per-km rate has to
   cover the return leg, because none is charged separately. The admin price-list
   guide says so in the build.
3. **A location on the source, set by an administrator; any eligible source
   without one sends the quote to the fallback:** agreed. Nothing is guessed from
   text or from the zone centre.
4. **The rates come from the matching price rule and replace the zone fee on the
   road-distance path:** agreed.
5. **A quote priced with a location must match the order's location (6 decimal
   places); a quote without one does not constrain it:** agreed.
6. **Timeout default 2 seconds, one `table` request, no cache, no snap-distance
   check in version 1:** agreed. Condition: the #384 measurement records OSRM's
   snapped distance for a set of real Enugu pins, and the result is written down
   **before road-distance pricing is switched on**. If real pins snap far from
   their road, a threshold is added by a contract change.
7. **Open question 3 (admin order detail):** agreed, not shown in this issue.
   **Open question 4:** a follow-up issue with its own design (G2).
8. **Privacy condition (added in the agreement).** The quote stores the
   customer's pin (`delivery_location`), which is personal data like the order's
   copy, and the privacy tool does not touch quotes today. So the build must also:
   (a) make `anonymize-customer` clear `delivery_location` and its source on that
   customer's quotes; (b) make the retention review clear it on a quote that
   became an order when the order's own copy is cleared (3 years after the order
   finishes), and on a quote that never became an order **90 days after its price
   stopped being valid** (the same period as GPS points; an expired offer has no
   further use); (c) add the quote row to `PRIVACY_NOTICE.md` sections 2 and 8
   (version bump per the procedure) and to `docs/process/privacy-retention.md`;
   (d) test all three, and that the snapshot's `distance_source_id` and rates
   carry no personal data.
9. **Configuration:** `OSRM_BASE_URL` is empty by default and stays empty in
   production until #384 passes its measurement, so merging the build changes
   nothing for customers.

## Open questions

Numbering is kept so review comments still match. Questions 1-11 are
decided; the technical lead's answers are from his comment on #42
(@nnamdi-security, 2026-10-26). Questions 12 and 13 are **resolved by pilot
fallbacks he already agreed** (F3 and F5, order confirmation contract,
2026-10-22), and he confirmed that reading. Question 14 is decided. All
questions are settled; the contract is agreed.

1. ~~Flat prices per can or per tank, or FR-022 only?~~ **Decided**
   (@chidimmamogbo, 2026-10-26): FR-022 only. The admin Pricing screen is
   replaced by FR-022 price lists (handling and margin), built in #37.
2. ~~How is the water category chosen?~~ **Decided** (@chidimmamogbo,
   2026-10-26, confirmed by the technical lead): one fixed category for every
   pilot order, set on the server, with no customer choice and no screen
   change: **Utility Water** (`utility`). Potable Water only with a source
   activated after laboratory verification (FR-012, FR-014)
   ([Water source and category](#water-source-and-category), point 3).
3. ~~Which source's cost per litre prices the quote?~~ **Decided** (technical
   lead): the **highest** cost per litre among eligible sources of the
   preferred kind, so the source confirmed later never costs more than the
   quote ([Water source and category](#water-source-and-category), point 4).
4. ~~Which can counts are allowed?~~ **Decided** (technical lead): any count
   that reaches 600 L (FR-021); the client keeps the presets 12, 24, 30, 60.
5. ~~Does `tank_type` affect the price or the vehicle?~~ **Decided**
   (technical lead): recorded only, no effect on price or vehicle.
6. ~~Does the customer see a breakdown?~~ **Decided** (@chidimmamogbo,
   2026-10-26): **total only**, as `orders.md` already says. The components
   stay in the server snapshot and the admin views. Knock-on for #9: the
   Keke and Tanker summaries lose their water and delivery lines.
7. ~~How long is a quote valid?~~ **Decided** (technical lead): **1 hour** by
   default, a server setting in the pilot; an admin screen for it belongs to
   #22.
8. ~~Status of an order placed with a quote~~ **Decided** (technical lead):
   confirmed, through the existing row 3 of
   [deliveries.md](deliveries.md#transitions); no new transition
   ([Status at creation](#status-at-creation)).
9. ~~Points~~ **Decided** (technical lead): no points estimate (no SRS basis).
10. ~~Service zones and OSRM~~ **Decided** (@nnamdi-security, 2026-10-26):
    the customer picks the zone (`service_zone_id`, FR-020); the delivery
    cost is the zone's fee per category, per order, built in **#30**
    ([admin-directory.md](admin-directory.md#delivery-cost-from-the-zone)).
    OSRM stays open (SRS §12.1); see the [Pilot note](#response-200-quoteread).
11. ~~Snapshot storage~~ **Decided** (technical lead): #21 stores the
    creation-time quote in a separate `quotes` table with the FR-024
    components and the frozen category label; `order_price_snapshots` keeps
    meaning the confirmed price.
12. ~~Delivery time window before confirming (FR-023)~~ **Resolved by pilot
    fallback F3** (agreed 2026-10-22 by the technical lead, order
    confirmation contract in [deliveries.md](deliveries.md#order-confirmation-endpoints)):
    the dispatcher agrees the delivery window with the customer on the
    confirmation call, and `customer_agreement.disclosures_confirmed` must
    say the window was told to them. Slots (FR-025) are not built, and the
    order is only `awaiting_confirmation` until then, so the customer has
    not been promised a window (FR-027). No new field: the checkout screen
    says the office calls to agree the window. Slots replace F3 later
    (C4). Confirmed by @nnamdi-security (technical lead), 2026-10-26.
13. ~~Cancellation and redelivery charges before confirming (FR-023,
    FR-044, FR-038)~~ **Resolved by pilot fallback F5** (agreed with F3):
    there is **no cancellation or redelivery charge in the pilot**. The
    dispatcher tells the customer so on the confirmation call
    (`disclosures_confirmed`), and the checkout screen states it with no
    amounts. So no delivery charge needs disclosing, and no
    `delivery_charge_minor_units` field is added (this replaces the earlier
    recommendation). FR-044's cap ("the delivery charge disclosed in the
    quote") and FR-038's redelivery fee come back when charges are
    introduced; that change must then disclose the delivery charge, which
    the total-only rule (question 6) does not, so it needs a contract
    change. Confirmed by @nnamdi-security (technical lead), 2026-10-26.
14. ~~Confirming an order placed with a quote (gap for #21).~~ Row 3 puts a
    quoted order in `awaiting_confirmation` ([Status at
    creation](#status-at-creation)). But the agreed confirm endpoint,
    `POST /admin/orders/{reference}/transition` with `to: confirmed`,
    requires `expected_status: quote_requested` and returns 409
    `invalid_order_transition` for an `awaiting_confirmation` order ("design
    ahead (C4)", [deliveries.md](deliveries.md#confirmation-rules)). Once #21
    is built, a dispatcher could not confirm any quoted order.
    **Decided** (@nnamdi-security, technical lead, 2026-10-26): #21 extends
    that endpoint (additive) to accept
    `expected_status: awaiting_confirmation`. Then row 7 runs alone (no row
    26), there is no `manual_quote_total_minor_units`, and the price
    snapshot copies the quote's total, with `is_manual` false. Its other
    inputs (category, source, window, `customer_agreement`) stay as agreed,
    and the source must be one of the preferred kind. A changed price is a
    repricing and needs the customer's documented agreement (BR-05, FR-036),
    so it stays out of this step. #21 writes the change into
    `deliveries.md` ("Confirmation rules") with the build.

## Changes

| Date | Change | Agreed by |
| --- | --- | --- |
| 2026-11-03 | Built (#385), including the quote's location match against the order's (#340) ([Built in #385](#built-in-385)) | @nnamdi-security (technical lead) |
| 2026-11-03 | Proposed (#385): `delivery_location` on `POST /quotes` and in the quote match, road-distance delivery cost from OSRM with the zone fee as fallback, the longest eligible-source distance, an optional source `location`, and what the quote records ([amendment](#amendment-385-road-distance-pricing)) | @nnamdi-security (technical lead and privacy contact, G3, 2026-11-03), with the decisions and the privacy condition in the amendment |
| 2026-10-26 | Built in #21: reason `no_price_rule` added (additive); the reason order; the zone fee replaces the whole delivery cost; the rounding rule ([How the total is computed](#how-the-total-is-computed)); quote rate limits 30 per customer per 10 minutes and 120 per IP per hour; question 14's confirm change written into [deliveries.md](deliveries.md#confirmation-rules) | @nnamdi-security (technical lead, decisions A-F on #21) |
| 2026-10-26 | Agreed (G3): questions 12 and 13 confirmed (pilot fallbacks F3 and F5); question 14 decided (#21 extends the confirm endpoint to accept `awaiting_confirmation`, additive) | @nnamdi-security (technical lead, #36), with @chidimmamogbo's decisions on #42 |
| 2026-10-26 | Open questions 12 and 13 resolved by the agreed pilot fallbacks F3 (window agreed on the confirmation call) and F5 (no cancellation or redelivery charge); FR-023 table updated; the proposed `delivery_charge_minor_units` dropped; new question 14 (quoted orders cannot be confirmed with the agreed confirm endpoint; #21 extends it) | Applies agreed fallbacks; @nnamdi-security to confirm on PR #59 |
| 2026-10-26 | Brought to agreement (#42): `delivery_address` required on `POST /quotes`, water-only answer and `includes_delivery` removed; FR-023 disclosure table (payment method fixed "Pay on delivery"); pilot category Utility Water; technical lead's answers to questions 3, 4, 5, 7, 8, 9, 11 recorded; driver cash label reference fixed (payments.md amendment 3 is agreed); #18 → #37 for price lists; quote rate limit numbers set in #21; new open questions 12 (window) and 13 (cancellation and redelivery charges) | Decisions by @chidimmamogbo and @nnamdi-security; contract not yet agreed (questions 12, 13) |
| 2026-10-26 | Amended for #30: `service_zone_id` on `POST /quotes` and `POST /orders` (compared for `quote_mismatch`), `service_zone` on `OrderRead`, `service_zone_not_found`; `outside_service_zone` and `delivery_cost_unavailable` defined by the zone; open question 10 decided | Decisions by @nnamdi-security; contract not yet agreed |
| 2026-10-26 | Revised after review (PR #28): FR-022 only; one fixed pilot category set by the server (no category field in requests); customers see the total only (breakdown fields removed, `includes_delivery` added); `quote.water_category` on `OrderRead`; idempotent replay before quote checks; address normalization for `quote_mismatch`; driver cash label `quote`; creation status through existing row 3 | Not yet |
| 2026-10-26 | Proposed: delivery details, `POST /quotes`, `quote_id` on `POST /orders`, details and quote on `OrderRead` | Superseded by the revision above |
