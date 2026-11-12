# Proposal #408: source-selected road pricing and delivery estimates

**Status: proposed, not agreed (G3).** Author: @nnamdi-security + Codex.
Prepared 12 November 2026. Refs #408. Reviewer: @chidimmamogbo or
@Cloudcrackamara, not the author. No implementation, provider approval,
account creation, migration or deployment is authorized by this document.

Requirements: FR-013, FR-020–024, FR-031–033, BR-03, BR-05, BR-14,
NFR-003–006. Acceptance: T-01, T-03, T-09, T-17, T-18.

## Dependencies and authority

- #407's contract/design is agreed in PR #417; its shared source-fit helper,
  supplier fields and migration must be built before #408's implementation.
- [Existing quote contract](order-details-and-price.md), including the built
  #385 OSRM path, remains authoritative until this proposal is agreed.
- [Dispatch agreement](deliveries.md#automatic-dispatch-and-reassignment-411),
  PR #416, supplies constraints on trips, price preservation, manual control
  and operating-hour gates. It does not supply opening hours or ETA values.
- #409 owns the revised screens and G2; #410 owns driver-location freshness;
  #411 owns automatic confirmation/offers; #392 owns privacy/legal review.
- The routing-provider decision is proposed separately in
  [routing-provider-408.md](../architecture/routing-provider-408.md).

This proposes replacing the longest-distance/highest-water-cost rule, not
silently changing it. No existing quote, payment or order is repriced.

## Decision register

Recommendations require reviewer agreement; owner decisions below are
recorded separately. Existing #416 decisions remain agreed in their scope.
On 12 November 2026 the owner confirmed deliveries operate **08:00–18:00
Africa/Lagos, Sunday through Saturday**, with **ordering available at any
time**. Loading, unloading/handling and uncertainty-buffer values are not
validated. The owner subsequently confirmed that **18:00 is the last
dispatch time, not a delivery-completion deadline**. A delivery dispatched
by the cutoff may finish after 18:00. The owner authorized proposing Geoapify with spending kept at $0;
this is not provider activation, paid-plan consent or G3 approval.

| Decision | Proposed resolution | Outstanding input |
| --- | --- | --- |
| D1 | Geoapify behind a provider-neutral async adapter; no self-hosted OSRM and no hosted geocoder. $0 spending ceiling; fail closed to zone/manual fallback | Owner approved proposing Geoapify at $0 on 2026-11-12; reviewer/provider activation approval, retention/attribution review and account-level quota terms remain |
| D2 | No usable pin/route: zone delivery fee and highest eligible water cost, no selected source, no ETA, staff confirmation required. No zone fee means manual quote | Reviewer agreement |
| D3 | Quantity-first request; backend plans vehicle type and at most two trips. Retain old request shape during migration | Quantity/handling request shape and deterministic plan preference |
| D5 | Ordering 24/7; delivery operations 08:00–18:00 daily, Africa/Lagos (owner-confirmed). Future ETAs must account for driver availability, the operating calendar and full-journey variables. Missing reliable inputs means unavailable ETA and staff-agreed window. No dispatch outside operating hours | Loading/handling times, uncertainty buffer and assignment/pickup allowance remain unvalidated; owner confirmed 18:00 is last dispatch, not required completion |
| D10 | Configuration through `get_settings()`, read-only admin display. Costs/rates stay in existing admin price/source records | Reviewer: new setting names and technical limits below |
| D12 | Continue showing category and supported uses, per FR-023. Borehole/Ninth Mile is a source kind, not a potability claim | Reviewer agreement; no removal of category disclosure |
| D13 | Retain manual quotes for exceptions and fallback; no fabricated number or ETA | Reviewer agreement |

## Proposed request evolution

Keep `/api/v1/quotes` and `/api/v1/orders`. Both accept exactly one of:

1. Existing `delivery_type` plus `keke`/`tanker` fields. Keep their existing
   validation/conversion; apply the newly agreed source-kind rule server-side.
2. New `quantity: {value, unit}` with `unit` `litres` or `local_gallons`.
   `value` is a strict positive integer; convert gallons ×4 on the server and
   enforce at least 600 litres. Reject mixed legacy/new inputs with 422
   `validation_error`; never trust a client total, vehicle plan or source ID.

Both carry existing address, zone and optional `delivery_location` fields.
`water_source` stays `borehole` or `ninth_mile`: below 2,000 L, absent means
Borehole and explicit Ninth Mile is refused; from 2,000 L the choice is
required. Proposed business refusal: 422 `water_source_not_allowed`, with
field details at `body.water_source`. Missing required choice is 422
`validation_error`. Test 599/600/1,999/2,000 L for both request families.

Proposed optional `transfer_method` (`ground`, `overhead`) supplies tanker
handling needs in the new shape. No method is guessed: if a safe automatic
plan requires missing handling information, return a manual quote with a
proposed `handling_details_required` reason. #409's G2 decides its control.

Old requests remain parseable; this is not a promise of unchanged business
eligibility. Update clients/mocks and closed enums with the build. Persist
normalized litres, source preference and handling so retries/matching compare
equivalent requests rather than UI-specific units. Define idempotency
normalization tests before accepting both shapes in the order endpoint.

## Eligibility, source and vehicle planning

1. Validate active zone, pilot category and available price rule using the
   current manual-reason precedence where applicable.
2. Use #407's helper for category, full-order quantity, source kind and
   vehicle suitability. An unavailable, expired, suspended, revoked,
   wrong-kind, wrong-size or unsuitable source never becomes selectable.
3. Evaluate verified vehicle plans of the appropriate kind, handling and
   payload. Trips are `ceil(litres / verified_payload)`, at most two. No plan
   may overload a load. A plan is capacity, not a reserved driver or slot.
4. Obtain directed source-to-delivery road distances for all candidates
   needed to establish the nearest eligible source. Do not equate a geometric
   shortlist with globally nearest by road. If the full candidate set exceeds
   the configured provider budget/batch bound, use D2, rather than quietly
   dropping candidates and claiming the nearest source was found.
5. A complete response explicitly reporting no route for a source can exclude
   that source. An unknown/failed/missing result cannot prove that it is
   farther away; unknown source coordinates, malformed/partial responses or
   unknown match quality cause D2. No valid reachable candidate also uses D2.
6. Rank usable source/plan pairs by road metres, then source UUID. Proposed
   tie-break among plans: fewest trips, then verified payload, then vehicle
   UUID. This preference needs agreement, including the cross-kind tie-break;
   do not infer a cheapest-price policy or always choose a Keke.
7. Freeze the selected source, category, vehicle type/profile/payload/trips,
   rate version and delivery point on the quote. The nearest source is not
   necessarily the cheapest; the total must be disclosed before acceptance.

Use integer/Decimal normalization for provider numbers: reject negative,
non-finite or structurally inconsistent values. Compare full Decimal metre
values before display/storage rounding; preserve a documented decimal metre
value for charge computation so rounding a stored integer metre cannot change
the agreed charge. Source eligibility must be rechecked at order creation.

## Price and fallback

Road path, using the selected source's own category cost:

```text
water    = litres × source_cost_per_litre_kobo
distance = ROUND_HALF_UP(road_metres / 1000 × rate_per_km_kobo) to integer kobo
delivery = base_fee + distance + (trips - 1) × additional_trip_charge
subtotal = water + delivery + handling + margin
total    = ceil(subtotal / 100) × 100
```

Keep current fixed/percentage margin rules and half-up integer-kobo margin
rounding. Distance is one-way, charged once, as previously agreed; the
configured rates must cover return/extra-trip operations. The zone fee is not
added to the road path. All intermediate bounds must fit database storage.

On D2, retain a valid vehicle plan and #407 eligibility filters, use the
highest eligible cost and zone fee, store `selected_source_id=null` and
`requires_admin_confirmation=true`. Staff choose a source before dispatch.
No valid plan/rule/source or no zone fee returns `manual_quote_required`, with
no instant-price claim. Existing manual reasons remain; new reasons are
coordinated with clients. A calculated zero total remains an explicit review
question because current confirmation requires at least one naira.

Provider failure reasons to freeze internally: `routing_disabled`,
`no_delivery_location`, `no_source_location`, `provider_unavailable`,
`timeout`, `quota_exhausted`, `no_route`, `poor_match`, `match_unverified`,
`invalid_provider_response`, `candidate_limit_exceeded`.
Do not rename existing historical OSRM reasons or rewrite old rows.

## Adapter and match-quality contract

One internal async adapter returns per source: identifier/index, road metres,
travel seconds, original/matched source and destination points, match
distances and a typed failure. It receives no name, phone, typed address,
customer/order/source database identifiers or delivery code. Use positional
indices to map the response back to local records. Secrets stay server-side.

Propose `ROUTING_PROVIDER=disabled|geoapify`, disabled by default;
`ROUTING_API_KEY` as SecretStr; `ROUTING_TIMEOUT_SECONDS=2`;
`ROUTING_MAX_MATRIX_CELLS=20`. No retry or persisted routing cache in the
customer quote request. A provider error, 429, malformed response or timeout
uses D2. Do not hold database row locks during the provider call; revalidate
the source/price version when persisting the quote and at acceptance.

Propose `ROUTING_MAX_SNAP_METRES=100` as an **unapproved starting threshold**,
not a measured Enugu standard. Missing quality evidence is not zero distance.
Both endpoints must satisfy the approved threshold. Original-to-matched point
distance may be geometric **only for match validation**, never price, route
ranking or ETA. Exactly the threshold passes; above it fails. Activation
requires reviewer agreement and documented known-route/pin checks in Enugu.
The validated travel mode must suit a loaded vehicle; a provider's drive/truck
mode does not certify safe access. Unknown mode suitability requires fallback.

The provider research document specifies quotas and unresolved terms. Use
the same directed routing mode/options for comparable candidates; do not
claim live traffic or shortest-road optimality from a provider's balanced
route. No new HTTP library is needed: reuse the pinned async client.

Proposed settings: `DELIVERY_OPERATING_HOURS` (Africa/Lagos weekly intervals,
owner-confirmed starting schedule 08:00–18:00 every day); unset-by-default
`ETA_LOADING_SECONDS_BY_VEHICLE`,
`ETA_HANDLING_SECONDS_BY_VEHICLE`, `ETA_BUFFER_SECONDS` and the separately
agreed assignment/pickup allowance. Validate intervals and nonnegative whole
seconds at startup; redact the routing key from `/admin/settings`. Unknown
duration values never silently default to zero; ordering 24/7 does not make
the delivery calendar always open.

## ETA, windows and hours

Travel seconds from source to destination alone are **not** a delivery ETA.
They omit assignment wait, driver-to-source travel, loading, unloading and
extra trips. A fixed buffer cannot silently stand in for an unknown queue.

Proposed additive quote/order field:

```json
{
  "estimated_delivery": {
    "status": "unavailable",
    "from": null,
    "to": null,
    "basis": null,
    "reason": "timing_not_configured"
  }
}
```

`available` requires UTC `from < to`, a frozen calculation timestamp,
operating-calendar version and validated full-journey inputs; label it
"Estimated delivery", not a reserved slot or guaranteed arrival. Proposed
unavailable reasons: `timing_not_configured`, `routing_unavailable`,
`assignment_time_unknown`, `operating_calendar_unresolved`,
`multi_trip_unverified`.
In all unavailable cases the UI says "Delivery time to be confirmed".
Do not return provider travel seconds as if that were the promised window.

Until the owner supplies timing data and its reference point, return
unavailable; keep the confirmed `delivery_window` distinct. #416 requires a
valid customer-accepted window before automatic confirmation. No ETA means
staff agreement, not a nullable snapshot or invented window. No BR-14
redelivery charge is allowed without an applicable accepted window. Capacity
slots (FR-025) remain deferred **only if the SRS amendment is approved**.

### Owner-confirmed operating policy and remaining timing questions

Customers may submit orders at any time, including evenings and before
08:00. The API must not reject an otherwise valid order simply because
operations are closed. Source, zone, phone, quote-validity and other safety
checks still apply. New offers/dispatch wait for opening as agreed in #416;
missing reliable ETA inputs keep the existing staff-confirmation path.

An out-of-hours order does not promise delivery at 08:00. Once the timing
model is validated, calculate its estimate within the next feasible operating
period using rider/driver availability, existing workload, source readiness,
pickup travel, loading, delivery travel, unloading and uncertainty. A shortage
of drivers may move it later. Being outside operating hours alone need not
make an estimate unavailable if a reliable future range can be calculated.
Until then show "Delivery time to be confirmed", with the daily operating
hours separately visible through #409's approved design.

Owner-confirmed cutoff: **18:00 is the last dispatch time**. Dispatch means
the recorded departure to fulfil the order (`departed`, FR-033), not merely
an offer or acceptance. A delivery dispatched by 18:00 may finish afterward;
do not clamp its ETA to 18:00 or mark it late solely for finishing later.
At exactly 18:00 departure is permitted; after 18:00 new departure waits
until the next opening at 08:00. The backend must enforce the departure
cutoff as well as the automatic-offer calendar, so an earlier acceptance
does not permit a new departure after closing. Any offered/accepted job
carried to the next day needs a feasible window and customer acknowledgement
if its agreed window changes; do not silently reset it or its price.

Still to agree: loading/handling by vehicle and trips; driver-to-source and
assignment allowance; earliest/latest uncertainty; any holiday exceptions;
spillover and renewed customer agreement.
Do not invent a late-day acceptance cutoff or an out-of-hours delivery promise.
The starting schedule has no day-of-week closure; holidays need a separate
explicit decision rather than an assumed exclusion.

Preserve accepted prices after overnight waiting; quote expiry gates new
acceptance, not a previously accepted order waiting for opening. Window
changes require customer acknowledgement under FR-036/BR-05.

## Quote/order responses and compatibility

Preserve current quote discriminator, quote ID, total, currency, quantity,
expiry and category/use fields. Add `fulfilment: {delivery_type, trips}`,
`estimated_delivery` and `requires_admin_confirmation`. These disclose no
supplier cost/contact/location or internal breakdown. Selected source remains
internal/admin-only; driver pickup access keeps the existing job permissions.

An order placed with a quote copies its frozen source and plan server-side;
reject a client source override. Match normalized quantity, kind, handling,
zone, address and the pin at six decimals. A road-priced quote requires the
same point, regardless of location-source label. Keep current ownership,
expiry, `quote_mismatch` and idempotency behavior; lost-response retries return
the existing order before rechecking quote expiry. Clearing a pin through
authorized privacy retention must not invalidate its stored price.

If the selected source becomes ineligible before a new order is accepted,
return existing 409 `no_eligible_source` and require a new quote; no silent
price/source swap in an unaccepted quote. After acceptance, #416 D8 controls
safe replacement, fixed price, history and holds. #408 alone does not turn
on #411 automatic confirmation or change existing order state transitions.

New response fields, manual reasons and 422 code require typed endpoint,
adapter, mock, example and screen-state updates. Do not globally widen the
four-value post-pickup source-safety enum agreed separately in #407.

## Persistence and privacy

Additive reviewed migrations: selected source, selected vehicle kind and
plan, provider/mode, exact distance used for charging, road travel seconds,
match-quality summary, fallback reason, ETA range/basis/settings snapshot and
requires-admin flag on quotes; copied source/plan and estimate on orders.
Reuse existing fields where semantics match; do not repurpose historical
`distance_source_id` (the longest-distance source). Old records keep their
legacy pricing basis. Do not add the new quantity/kind CHECK to historical
orders. Explicitly document downgrade loss and retain original price history.

Do not persist matched destination coordinates or raw provider payloads.
Transient matches are discarded after validation; any persisted original pin
inherits current quote/order anonymization and retention. No query/body/key
or provider error text in logs/audits. Store only safe error codes/field names.

Before activation, #392 must approve notice wording naming the routing
provider, coordinates sent abroad, provider logging and retention. Draft
notice delta: supplier pickup and optional delivery coordinates go from our
server to the approved routing service to obtain road distance/travel time;
no contact details or delivery code are sent. Publish the agreed notice and
matching retention changes before use. No current notice promise is changed
by this proposal and no API request containing customer data is made here.

## Proposed requirements changes (not yet normative)

At G3 agreement, amend these exact sections together; until then the current
SRS and map decision remain authoritative:

- FR-021: keep minimum/units/presets; add source-kind rule (600–1,999 L
  Borehole only; from 2,000 L explicit Borehole/Ninth Mile) and backend plan.
- FR-022: approved external routing adapter; nearest eligible source and its
  own cost replace longest/dearest only on the successful road path; D2
  preserves highest-cost zone fallback. Never straight-line delivery pricing.
- FR-023: labelled estimate/unavailable state; retain category/use disclosure,
  price validity and charges; explicit confirmed-window distinction.
- FR-024 and section 5: freeze selected source/plan, provider, distance/time,
  quality, basis/rates and estimate metadata without raw provider payloads.
- FR-025: explicitly record proposed capacity-slot deferral and staff/estimate
  alternative; no claim that ETA prevents overbooking.
- Section 8: each D2 failure, poor/unknown match, out-of-hours and lost-source
  behavior; preserve #416 holds, manual control and immutable accepted price.
- Section 12.1: replace OSRM-specific mandate only after D1 approval; mark
  maps.md R1 superseded, retaining its historical evidence. Update PRD pricing
  and journey wording, CLAUDE.md service list and deployment guide consistently.

## Tests and delivery gates

Contract fixtures must show successful road quote, each fallback, unavailable
ETA and approved estimate shape. All examples are synthetic; no invented
timing value is an operational default.

Unit tests with fake adapter/clock: every #407 exclusion; source/vehicle
tie-breaks; directional distance; unknown vs no-route cells; Decimal pricing
and overflow; one/two trips; input-family ambiguity and litre boundaries;
snap threshold/missing match; disabled/quota/timeout/rate-limit failures; no
PII to provider; no amount from the client; category disclosure; ETA honesty.

Integration tests on disposable PostGIS: quote→order snapshots/ownership;
source/rate update races; idempotency after expiry; privacy clearing; selected
source loss; settings/quote history stability; quota reservation under
concurrency; migration upgrade/downgrade/upgrade and `alembic check`.
Frontend: every new schema/adapter/mock/error state and old-shape support.
Run the prescribed backend/frontend checks for the build, not this docs draft.

Before activation: #407 implementation, G3 and G2, provider/terms/privacy
approval, validated modes and Enugu route comparisons, owner timing/calendar
decisions, quota limits measured under #411 usage, and production-like end to
end tests. Retire OSRM infrastructure through #413 after replacement works.
Neither this proposal nor a future contract-only PR completes issue #408.

## Agreement record

G3 reviewer/date: **pending**. Owner authorization to propose Geoapify at $0:
**recorded, 2026-11-12**; provider activation/terms approval: **pending**.
Owner operating schedule: **08:00–18:00 every day, Africa/Lagos**; ordering:
**24/7**. Owner cutoff decision: **18:00 is last dispatch; completion may
be later**. Loading/handling/buffer values and assignment/pickup allowance:
**pending validation/agreement**. G2 in #409: **pending**.
