# Pricing: price lists and quotes

Requirements: FR-010, FR-012, FR-013, FR-021, FR-022, FR-023, FR-024,
BR-01, BR-02, NFR-002, NFR-004 · Acceptance tests: T-02, T-03, T-04, T-09
(a later price change never changes an order), T-18 · Contracts:
[admin-directory.md](../api/admin-directory.md#price-lists), "Price lists"
(agreed 2026-10-26); [order-details-and-price.md](../api/order-details-and-price.md),
`POST /quotes` (agreed 2026-10-26) · Issues: #37 (price lists), #21
(quotes) · Related: [service-zones.md](service-zones.md) (#30, the zone
delivery fee), [orders.md](orders.md) (ordering with a quote),
[order-confirmation.md](order-confirmation.md) (confirming a quoted order)

## 1. Overview and purpose

FR-022 prices a quote as **water cost + delivery cost + handling cost +
MmiriOma margin**. The water cost is the supplier's cost per litre, recorded
on the source's activation (FR-011, [water-sources.md](water-sources.md)).
Every other rate is admin-configured and lives in a **price list**: base
delivery fee, distance rate, additional-trip charge, handling and margin, by
zone, water category and quantity band.

This feature stores price lists as versions and lets administrators read
and save them (#37). **Quotes** (#21): `POST /quotes` prices a customer's
Keke or Tanker choice on the server and stores the quote with every FR-024
component, or answers `manual_quote_required` with a reason code when no
reliable price exists (SRS §6). Customers see the total only.

## 2. Feature workflow

1. An administrator reads the current list (`GET /admin/price-lists/current`)
   and edits it.
2. They save the **whole** set of rules with the version they edited
   (`POST /admin/price-lists`, `base_version`). The server checks the rules,
   saves version n + 1, records what changed and takes it into use at once
   (open question 16: no future dating).
3. If another administrator saved first, nothing is saved (409
   `price_list_changed`, `details.current_version`); the screen reloads.
4. A customer asks for a price after the address step (`POST /quotes`). The
   server checks, in order: an active picked zone; the pilot category
   (setting `PILOT_WATER_CATEGORY`, Utility Water) active with an activated
   source; a source that fits the order today (the #407 order-fit check:
   activated with a current approval, a kind set, available, of the preferred
   kind, accepting the litres and the vehicle); a vehicle plan; the
   zone's fee; a matching price rule
   (`price_lists.match_price_rule`). The first that fails is the manual
   reason; otherwise the quote is computed, stored and answered with its
   total and `price_valid_until` (`QUOTE_VALIDITY_MINUTES`, default 60).
5. The customer places the order with `quote_id` ([orders.md](orders.md)):
   the server checks the quote again and the order goes straight to
   `awaiting_confirmation` (row 3) with the quote frozen on it.
6. The dispatcher confirms it from `awaiting_confirmation` with the quote's
   total ([order-confirmation.md](order-confirmation.md)).

## 3. Important files

| File | Responsibility |
| --- | --- |
| `backend/app/modules/pricing/models.py` | `PriceListVersion`, `PriceRule`, `MarginType` |
| `backend/app/modules/pricing/price_lists.py` | Save (checks, changes, audit), read, `match_price_rule` |
| `backend/app/modules/pricing/osrm.py` | The OSRM adapter: one `table` request per quote, the longest road distance to the eligible sources, every way it can fail (#385) |
| `backend/app/modules/pricing/quotes.py` | `road_delivery_cost` (base + distance charge + extra trips, `Decimal`, half-up to kobo) and the choice between road distance and the zone fee (#385) |
| `backend/app/modules/pricing/retention.py` | Clears the map pin kept on a quote: customer anonymized, order anonymized, unplaced quote 90 days after its price expired (#385) |
| `backend/alembic/versions/20261103_0027_add_road_distance_pricing.py` | A source's `location`; the quote's basis, distance, source, fallback reason, rates and pin |
| `backend/tests/test_road_distance.py`, `test_road_distance_integration.py`, `test_quote_location_privacy_integration.py` | The formula, the adapter, the quote flow against a fake OSRM, the privacy rules, and the no-straight-line test |
| `backend/app/modules/pricing/schemas.py` | `PriceListCreate` (validation), `PriceListRead`, `PriceListPage` |
| `backend/app/modules/pricing/router.py` | The three endpoints; thin |
| `backend/alembic/versions/20261026_0015_add_price_lists.py` | The two tables |
| `backend/tests/test_price_lists_api.py` | Endpoint tests, no database |
| `backend/tests/test_price_lists_integration.py` | Service tests against PostGIS |
| `frontend/src/lib/api/priceLists.ts` | Typed, Zod-checked calls: current, history, save, water categories (#173) |
| `frontend/src/features/admin/real/pricing.ts` | The adapter: 404 `price_list_not_found` = "No price list yet" |
| `frontend/src/features/admin/pages/Pricing.tsx` | The admin Pricing screen (P0, design `docs/design/admin-pricing.md`) |
| `frontend/src/features/admin/pricing/RuleSheet.tsx` | P1, the rule sheet: add or edit one rule |
| `frontend/src/features/admin/pricing/logic.ts` | Staff wording, the rule form's checks, the save errors |
| `frontend/src/mocks/priceListMock.ts` | Sample price lists in `VITE_USE_MOCKS=true`, refusing what the backend refuses |

**The admin screen (#173).** `/admin/pricing` shows "How a price is made"
(water and delivery are set elsewhere; handling and margin here), the
current version's rules (area, water, quantity, handling, margin) with Edit,
Remove and "+ Add a rule", the road-distance rates collapsed as "saved, not
used yet" (the pilot prices delivery from the zone fee), a Save card
("Save as version N+1", optional reason) and the version history worded from
`changes[]`. Rules are edited one at a time in a side sheet and saved
together as one version. Refusals are shown as the design words them:
"Prices changed since you opened this page" with "Load version N",
"Nothing to save", the overlapping rules named and marked, and "This area is
no longer listed". With no price list saved, the page offers "Add the first
rule". Pricing stands alone: the Loyalty points and Payouts tabs are not
shown in the pilot.
| `backend/tests/test_admin_water_categories_api.py` | The category list: roles, shape against the example, no `code`, no database |
| `backend/tests/test_admin_water_categories_integration.py` | The category list and the inactive-category rule against PostGIS |
| `backend/app/modules/pricing/quotes.py` | `create_quote`, `compute_price`, `check_quote_for_order`, `quote_summaries`; the rules below |
| `backend/app/modules/pricing/rate_limit.py` | The quote rate limits (NFR-002) |
| `backend/app/modules/dispatch/vehicles.py` | `plan_for`: the vehicle plan (FR-013), outside the dispatch service to avoid an import cycle |
| `backend/app/modules/sources/eligibility.py`, `service.py` | `eligible_sources_for` (the #407 order-fit check, also run when a quote is accepted), `has_activation`, `set_kind` |
| `backend/alembic/versions/20261026_0018_add_quotes_and_source_kind.py` | `quotes`, `orders.quote_id`, `water_sources.kind` |
| `backend/tests/test_quotes_api.py` | Arithmetic, schemas, limits, endpoint; no database |
| `backend/tests/test_quotes_integration.py` | Quotes, ordering and confirming against PostGIS |

## 4. Database models and relationships

- `price_list_versions`: `version` (unique, 1 or more), `effective_from`
  (save time, UTC), `created_by` → `users`, `reason` (up to 500), `changes`
  (JSONB, worked out once at save).
- `price_rules`: `price_list_version_id` → `price_list_versions`, `position`
  (unique per version, the rule's index), `zone_id` → `service_zones` and
  `water_category_id` → `water_categories` (both nullable: "all"),
  `min_litres` (600 or more, FR-021), `max_litres` (nullable: no upper end,
  else at least `min_litres`), the four amounts in kobo (`BIGINT`, 0 or
  more), `margin_type` (`fixed` or `percentage`) with
  `margin_amount_minor_units` or `margin_basis_points` (0-10,000), CHECK
  `ck_price_rules_margin_shape`. All foreign keys RESTRICT.

Versions are never edited or deleted.

- `quotes` (#21): `customer_id` → `users`; the choice that was priced
  (`delivery_type`, Keke or Tanker details, `water_source`,
  `delivery_address`, `service_zone_id` → `service_zones`,
  `quantity_litres`); `water_category_id` → `water_categories` and the
  frozen `water_category_label`; the components in kobo
  (`cost_per_litre_minor_units`, `water_`, `delivery_`, `handling_`,
  `margin_minor_units`, `rounding_minor_units`, `total_minor_units`) with
  the margin type and amount or basis points; `price_list_version_id`,
  `price_rule_id`, `vehicle_profile_id`, `safe_payload_litres`, `trips`;
  `price_valid_until`. CHECKs: components not negative, rounding 0-99, the
  total equals the components plus rounding, the total is whole naira,
  trips 1-2. All foreign keys RESTRICT. Only available quotes are stored.
- `orders.quote_id` → `quotes` (nullable, indexed, RESTRICT): the quote the
  order was placed with.
- `water_sources.kind` (`ninth_mile` or `borehole`, nullable until set with
  `set-kind`, [water-sources.md](water-sources.md)).

## 5. API endpoints and request/response behavior

| Method | Path | Success | Errors |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/price-lists?limit=&offset=` | 200 page of `PriceList`, newest first | 422 `validation_error` |
| GET | `/api/v1/admin/price-lists/current` | 200 `PriceList` | 404 `price_list_not_found` |
| GET | `/api/v1/admin/water-categories` | admin; 200 `{items: [{id, label, is_active}]}`, every category by label, inactive ones included (#161) | shared 401/403 |
| POST | `/api/v1/admin/price-lists` | 201 `PriceList` | 404 `service_zone_not_found`, 404 `water_category_not_found`, 409 `price_list_changed`, 409 `price_list_unchanged`, 422 `price_rules_overlap`, 422 `validation_error` |

The category list feeds the Pricing screen's Water picker
([amendment #160](../api/admin-directory.md#amendment-160-the-list-of-water-categories),
[example](../api/examples/admin-water-categories.json)). It leaves out `code`,
the description and any price. A price rule or zone fee may name an inactive
category: only an unknown id is 404 `water_category_not_found`, and whether a
category is offered is checked when a quote is made (FR-014). The service
function is `service.list_water_categories`, which reads
`sources.list_categories`.

`PriceList`: `version`, `effective_from`, `created_by {id, name}`, `reason`,
`rules[]` (with `id` and `margin` as `{"type": "fixed",
"amount_minor_units"}` or `{"type": "percentage", "basis_points"}`), and
`changes[]` (`path`, `from`, `to`; `from` is `null` for an added rule, `to`
`null` for a removed one; empty on version 1). Examples:
[admin-price-list.json](../api/examples/admin-price-list.json),
[admin-price-list-create-request.json](../api/examples/admin-price-list-create-request.json).

**`POST /api/v1/quotes`** (customer + CSRF): body `QuoteCreate`
(`delivery_type`, `keke` or `tanker`, `water_source` for Tanker,
`delivery_address` required, optional `service_zone_id`; no category, unknown
fields 422). 200 with either:

- `quote_available`: `quote_id`, `currency`, `quantity_litres`,
  `water_category {label, supported_uses}`, `total_minor_units`,
  `price_valid_until`
  ([quote-available.json](../api/examples/quote-available.json));
- `manual_quote_required`: `quote_id: null`, `quantity_litres`, `reason`
  ([quote-manual.json](../api/examples/quote-manual.json)).

Errors: 401, 403 (`forbidden` for staff and drivers, `csrf_failed`), 404
`service_zone_not_found`, 422 `validation_error`, 429 `too_many_attempts`
(`Retry-After`). Phone verification is not needed to ask for a price.

## 6. Important business rules

- **Matching** (contract, "Matching a quote to a rule"): a rule matches when
  its zone is the quote's or `null`, its category is the quote's or `null`,
  and the litres are inside its band (inclusive). The most specific wins: a
  zone's own rule beats an every-zone rule, then a category's own rule beats
  an every-category rule. **No match: a manual quote, never a guessed
  price** (FR-021, FR-022).
- **No overlaps:** two rules with the same zone and category cannot share
  litres (422 `price_rules_overlap`, `details` names each later rule), so
  matching never ties.
- **Handling is per order** (open question 18). The distance rate is stored
  but unused until OSRM exists; how the distance is rounded stays open
  (open question 17).
- **A percentage margin** applies to water + delivery + handling cost, in
  basis points (1 % = 100). Rounding to whole kobo and up to whole naira is
  the quote's job (#21, FR-022).
- **Unchanged rules** are refused (409 `price_list_unchanged`).
- Inactive zones and categories may have rules; whether they are offered is
  checked when quoting.

Quotes (#21, technical lead's decisions A-F, recorded in the contract):

- **The price** is water + delivery + handling + margin (FR-022). Water: the
  **highest** cost per litre among sources that fit the order today in the
  category (#407: of the preferred kind, Keke any kind that is set, within the
  source's litre limits and vehicles), so the source confirmed later
  never costs more than the quote. Delivery: the zone's fee, which replaces
  the whole FR-022 delivery cost while there is no OSRM (base, distance and
  extra trips). Handling and margin: the matched rule.
- **Rounding:** every amount is exact kobo except a percentage margin,
  computed with `Decimal` and rounded half-up to whole kobo. The total is
  then rounded **up** to whole naira and the adjustment stored (BR-01).
- **Vehicle plan:** any active vehicle carrying the litres in at most two
  trips; the fewest trips, then the smallest payload (FR-013).
  `tank_type` has no effect (recorded only).
- **Manual reasons**, first that applies: `outside_service_zone`,
  `category_unavailable`, `no_eligible_source`, `no_vehicle_plan`,
  `delivery_cost_unavailable`, `no_price_rule`. Never a guessed number
  (SRS §6, FR-022).
- **Total only for customers:** the components, cost per litre, vehicle and
  trips stay on the server (open question 6). `OrderRead.quote` shows the
  total and the category accepted (label frozen, supported uses live).
- **Validity:** `price_valid_until` = quote time + `QUOTE_VALIDITY_MINUTES`.
- **Rate limits** (NFR-002): 30 quotes per customer per 10 minutes, 120 per
  client IP per hour; every request counts.

## 7. Authentication and authorization requirements

Price lists: admin only (`CurrentAdmin`): customers and drivers get 403
`forbidden` (FR-001). `POST` needs the `X-CSRF-Token` header. Each save
records an audit row `price_list_saved` (NFR-004) with the version number
and rule count only.

Quotes: customers only (`CurrentCustomer`) with CSRF. A quote belongs to the
customer who asked for it; another customer's `quote_id` on an order is the
same 404 `quote_not_found` as an unknown one.

## 8. Error handling and edge cases

- **Concurrent saves:** the unique `version` decides; one succeeds, the
  others get 409 `price_list_changed` with the current version. A stale
  `base_version` gets the same answer before anything is written.
- **First list:** `base_version` must be `null`; it is required, so a client
  cannot save over a version it never saw.
- **Validation (422):** a band below 600 L or reversed, a negative or
  fractional amount, a margin over 10,000 basis points or with the wrong
  field, no rules, more than 100 rules, a reason over 500 characters,
  unknown fields (including a rule `id`).
- **Before the first save:** `current` is 404 and `match_price_rule`
  returns no match, so quotes answer `no_price_rule`.
- **Quotes:** an unknown zone id is 404, but no zone or an inactive one is a
  manual quote (`outside_service_zone`, FR-010). A suspended, revoked or
  expired activation does not price (FR-012, T-04). A manual answer stores
  nothing. Over the rate limit: 429 with `Retry-After`; a refused request
  is not counted.

## 9. Testing instructions

```bash
cd backend && source .venv/bin/activate
ruff check . && ruff format --check .
pytest tests/test_price_lists_api.py
# With a separate test database, after alembic upgrade head:
TEST_DATABASE_URL=... pytest tests/test_price_lists_integration.py
```

- `test_price_lists_api.py`: the examples against the schemas; 401, 403 for
  customers and drivers (T-07), CSRF; paging and its limits; the margin
  shapes; the save arguments (trimmed or empty reason, both margin types);
  every validation rule; every service error code passed through.
- `test_price_lists_integration.py` (clears price lists in the test
  database): first list and a new version with its `changes` and audit rows;
  every refusal; four concurrent saves give one version; matching by zone,
  category and band; no list or no band gives no match.
- `test_admin_water_categories_api.py` (service faked): the example against
  the schema and the response shape; only `id`, `label` and `is_active` are
  shown; inactive categories pass through; 401 signed out, 403 for customers
  and drivers (T-07); the list is read-only.
- `test_admin_water_categories_integration.py`: the seeded categories by
  label; an inactive category listed first by its label; a zone fee naming an
  inactive category is stored, an unknown id is 404 `water_category_not_found`.
- Migration: `alembic upgrade head`, `alembic downgrade -1`, `alembic upgrade
  head` and `alembic check` run on a local PostGIS database (2026-10-26).
- `test_quotes_api.py`: `compute_price` (fixed and percentage margins,
  half-up then round up), address normalization, the source kinds matching
  the preferences, the settings' defaults, both rate limits, the two answers
  against the examples, never a breakdown, the reason order, the Keke
  conversion, every validation rule, roles and CSRF, the 31st quote is 429.
- `test_quotes_integration.py` (clears price lists): a stored quote and its
  components (highest cost of the preferred kind); Keke's vehicle plan;
  every manual reason in order with nothing stored; a suspended source; an
  order with a quote (rows 1 and 3, `OrderRead.quote`, replay after expiry);
  each order refusal writing nothing; confirming a quoted order; `set_kind`.
  Migration 0018 checked the same way (2026-10-27).

## 10. Known limitations

- No road distance (OSRM, SRS §12.1): the distance rate, base delivery fee
  and additional-trip charge in price rules are stored but unused; the zone
  fee is the delivery cost.
- The customer screens (#9) do not call `POST /quotes` yet.
- Rate-limit counters live in the process (cleared on restart, separate per
  worker), like the auth limits.
- The quote validity is a server setting; an admin screen for it is #22.
- A quote's total of ₦0 (all components zero) could be stored but not
  confirmed, because the confirmation snapshot requires at least ₦1.00.
- No screen: the fork's admin Pricing page still shows the old flat prices
  on mocks and needs a redesign around FR-022 rates (G2) before it can link
  to these endpoints.
- The distance rate is unused until OSRM exists (SRS §12.1).
- Versions take effect when saved; scheduling a future version is not
  supported.

## Road-distance pricing (#385)

Contract: [order-details-and-price.md](../api/order-details-and-price.md#amendment-385-road-distance-pricing)
(agreed 2026-11-03). FR-022: the delivery cost is the base fee + a distance charge
from OSRM's **road** distance + (trips - 1) times the additional-trip charge,
never a straight-line distance.

- **When it applies.** The request has a `delivery_location`, the zone is active,
  `OSRM_BASE_URL` is set and OSRM answers within `OSRM_TIMEOUT_SECONDS`, **every**
  eligible source has a `location`, and a price rule matches. Otherwise the quote
  is priced exactly as before: the zone's fee for the category, or a manual quote
  (`delivery_cost_unavailable`) when the zone has none (T-18).
- **Which source.** The quote does not know which eligible source staff will pick,
  so it uses the **longest** road distance to any of them, as the water price uses
  the dearest source. One `table` request to OSRM covers all of them.
- **The money.** The distance is one way and charged once; the rate per km
  therefore has to cover the return leg (the price-list guide says so). The charge
  is `Decimal` metres x rate / 1000, rounded half-up to kobo; the total is then
  rounded up to whole naira as before.
- **What the quote keeps (FR-024).** `delivery_basis`, `road_distance_metres`,
  `distance_source_id`, `distance_fallback_reason` (`no_source_location`,
  `osrm_unavailable`, `no_route`, `timeout`), the three rates applied, and the pin.
  Customers still see the total only. A stored quote never changes.
- **Privacy.** The pin is personal data. `anonymize-customer` clears it on the
  customer's quotes, the monthly review clears it when the order is anonymized or
  90 days after an unplaced quote's price expired. The price, the distance and the
  rates stay.
- **Switched off by default.** `OSRM_BASE_URL` is empty, so nothing changes for
  customers until OSRM is deployed and measured (#384).
- **The quote match.** An order placed with a quote priced for a pin must carry the same pin (6 decimal places; the `source` is not compared), else 422 `quote_mismatch` on `delivery_location`. A quote with no pin does not constrain the order.
- **Setting the rates (for whoever fills the price list).** The distance is one way and charged once, so the per-km rate has to cover the return leg too; the additional-trip charge pays only for extra trips. Until a source has a pickup point and OSRM is on, the zone's fee is what customers are charged.
- **Limits.** OSRM answers "Ok" for any point on Earth, snapping it to the
  nearest road in whatever data it holds. The adapter reads the snap distances and
  carries the largest to the caller, but no threshold is applied and nothing is
  stored: that needs a contract change, and road-distance pricing must not be
  switched on before it.
  Nothing is cached. The admin Water sources screen has no latitude and longitude
  fields yet (a follow-up with its own design); the API and `add-source
  --latitude --longitude` set them.
