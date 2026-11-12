# Water sources and source eligibility

Requirements: FR-011, FR-012, FR-013, FR-014, FR-024, BR-09, BR-10, NFR-004 ·
Acceptance tests: T-04 (an expired approval blocks the source), T-09 (a cost
change does not reprice an existing quote or order) · Contract:
[deliveries.md](../api/deliveries.md#order-confirmation-endpoints), "Source
eligibility (shared with R2)" and "Data needed" (agreed G3, PR #111);
[admin-water-sources.md](../api/admin-water-sources.md), with its
[#407 amendment](../api/admin-water-sources.md#amendment-407-supplier-details-order-fit-and-cost-edits)
(agreed G3, PR #417) · Issues: #112 (from #87), #309, #385, #407 · Pilot
fallback: F1 (pilot plan)

## 1. Overview and purpose

Water may be collected only from a source that is approved for the order's
water category (FR-012). This feature records:

- the two water categories, Potable Water and Utility Water (FR-014);
- each source's **activation** per category: activated, suspended or
  revoked, the last day its laboratory approval is valid, the laboratory
  report reference and the supplier's cost per litre (F1);
- one **eligibility check** that says whether a source may serve a category
  today, and why not. Order confirmation (#113) and the hold review's source
  review (R2) both use it;
- each source's **kind** (#21): `ninth_mile` or `borehole`, where it
  collects water. A Tanker customer's source preference (`water_source`)
  is matched against it when quoting, ordering and confirming
  ([pricing.md](pricing.md); [order-details-and-price.md](../api/order-details-and-price.md#water-source-and-category),
  point 2). Since #407 a source needs a kind before it can be activated or
  serve any order;
- each source's **supplier details** (#407): a contact name and Nigerian mobile
  number, the smallest and largest complete order it serves (in litres), whether
  it is available for new work, and the vehicles (Keke, Tanker) that can load
  there;
- one **order-fit check** (#407, `eligible_sources_for`) that adds six reasons
  after the safety ones for one order: kind not set, unavailable, the wrong kind
  for a Tanker customer's preference, below the minimum, above the maximum, and a
  vehicle that cannot load there. Quotes, quote acceptance, the order
  confirmation options (C1) and the confirmation itself use it; #408 and #411
  will too.

An admin manages sources on the Water sources page (`/admin/water-sources`, #309,
[design](../design/admin-water-sources.md)), which calls the admin water-source
endpoints ([admin-water-sources.md](../api/admin-water-sources.md)). The command-line tool (F1) does the same
work and stays as the fallback. A record here says an admin entered an approval
after laboratory verification; the app cannot verify that, and a database flag
is not legal compliance (FR-012).

## 2. Feature workflow

```
technical lead (command line, --by <admin phone>)
  add-source [--kind] [--latitude --longitude] > water_sources + audit "water_source_added"
  set-kind ───────────────> water_sources.kind       + audit "water_source_kind_set"
  activate ───────────────> water_source_categories  + audit "water_source_activated"
     (category, report reference, approved until, cost per litre)
  suspend / revoke ───────> status + reason          + audit "water_source_suspended" / "_revoked"
  activate again ─────────> renews: activated, reason cleared

eligibility_reasons(activation, today in Lagos)
  none                      → [not_activated]
  suspended / revoked       → [suspended] / [revoked]
  approved_until < today    → [..., approval_expired]
  []                        → eligible

R2 source review (holds.source_eligibility)
  free-text source          → not_eligible "This source is not in the source records."
  order has no category     → cannot_check "This order has no water category."
  reasons                   → eligible, or not_eligible with the first reason's message

admin (Water sources page, #407)
  add / edit ─────────────> contact, pickup point, litre limits, availability, vehicles
                             + audit "water_source_updated" {fields} (names only)
  activate / renew ───────> 409 water_source_kind_required while kind is null
  change cost ────────────> cost_per_litre_minor_units only + audit "water_source_cost_changed"

eligible_sources_for(category, OrderFit(litres, delivery_type, preferred_kind), today)
  safety reasons (above), then
  kind is null              → kind_not_set
  is_available false        → unavailable
  preferred kind differs    → kind_mismatch
  litres < min / > max      → below_minimum_litres / above_maximum_litres
  vehicle not allowed       → vehicle_not_suitable
  used by: create_quote, check_quote_for_order (409 no_eligible_source),
           confirmation_options (C1), confirm_order (source_order_reasons, FOR SHARE)
```

## 3. Important files

| File | Responsibility |
| --- | --- |
| `backend/app/modules/sources/models.py` | `WaterSource` (with the #407 columns and `vehicle_kinds`), `WaterCategory`, `WaterSourceCategory`, `ActivationStatus` |
| `backend/app/modules/sources/eligibility.py` | `EligibilityReason`, `REASON_ORDER`, `eligibility_reasons` (pure), `source_reasons` (loads the activation; R2); #407: `OrderFitReason`, `OrderFit`, `source_wide_reasons`, `order_fit_reasons`, `reasons_for_order` (pure), `eligible_sources_for` (every source with its reasons) and `source_order_reasons` (one chosen source, rows locked `FOR SHARE`) |
| `backend/app/modules/sources/locations.py` | `SourceLocation` and `source_locations`: reading pickup points, shared by the service and the eligibility module |
| `backend/app/modules/sources/service.py` | Add sources, set the kind, the pickup `location` (#385) and the #407 supplier details, activate (refused without a kind), change the cost, suspend, revoke, list; one audit row per change; `get_acting_admin`; `has_activation` for quotes |
| `backend/app/modules/sources/cli.py` | The command-line tool (the fallback) |
| `backend/app/modules/sources/admin.py` | What the admin endpoints do: look the source and category up by id (404 if missing), call the service function the command line uses, return the whole source |
| `backend/app/modules/sources/admin_schemas.py` | Request and response bodies of the admin endpoints, the expiry state (30-day window) and the rule that `approved_until` is not in the past |
| `frontend/src/lib/api/adminWaterSources.ts` | Typed calls and Zod checks for the admin endpoints (#309, #407) |
| `frontend/src/features/admin/pages/WaterSources.tsx`, `waterSources/` | The Water sources page, its four dialogs (add/edit, activate/renew, change cost, suspend/revoke) and the rules and words (`logic.ts`) |
| `frontend/src/mocks/waterSourceMock.ts` | The mock endpoints for the demo, all SAMPLE DATA |
| `frontend/src/lib/api/adminConfirmation.ts`, `features/admin/confirm/logic.ts` | `C1_SOURCE_REASONS` and `C1_REASON_LABEL`: the C1 options' ten reasons, kept apart from the four the order detail and R2 use |
| `backend/app/modules/sources/admin_router.py` | `GET`/`POST /admin/water-sources`, `PATCH /admin/water-sources/{id}`, `PUT` and `PATCH .../activations/{category_id}`, `POST .../activations/{category_id}/status` |
| `backend/app/modules/pricing/quotes.py`, `backend/app/modules/confirmation/service.py` | The order-fit check at quote creation and acceptance, in the C1 options and at confirmation |
| `backend/alembic/versions/20261112_0028_add_water_source_supplier_fields.py` | Migration `0028` (#407) |
| `backend/app/modules/deliveries/holds.py` | `source_eligibility`: R2's answer from the shared check |
| `backend/app/modules/orders/models.py` | `Order.water_category_id` |
| `backend/alembic/versions/20261022_0011_add_water_categories_and_source_activations.py` | Migration `0011`, seeds the categories |

## 4. Database models and relationships

Migration `0011` (revises `0010`):

- `water_categories`: `code` (unique: `potable`, `utility`), `label`,
  `supported_uses` (nullable), `is_active`. Seeded with Potable Water and
  Utility Water.
- `water_source_categories`: `source_id` → `water_sources`,
  `water_category_id` → `water_categories` (both RESTRICT; unique together),
  `status` (`activated`, `suspended`, `revoked`; VARCHAR + CHECK),
  `approved_until` (date), `report_reference` (up to 100),
  `cost_per_litre_minor_units` (BigInteger kobo, `>= 0`), `status_reason`
  (up to 500; required exactly when not activated, by CHECK).
- `orders.water_category_id` → `water_categories` (nullable, RESTRICT,
  indexed). Set at confirmation (#113); null on every order until then.

Migration `0018` (#21) adds `water_sources.kind` (`ninth_mile` or
`borehole`, VARCHAR + CHECK, nullable until the technical lead sets it).

Migration `0027` (#385) adds `water_sources.location`, a nullable geography
point (SRID 4326).

Migration `0028` (#407) adds to `water_sources`: `contact_name` (up to 120),
`contact_phone` (E.164, up to 16), `min_litres_per_order` and
`max_litres_per_order` (INTEGER, nullable, each `>= 1`, minimum not above
maximum, by CHECK), `is_available`, `serves_keke` and `serves_tanker` (booleans,
default true; at least one vehicle, by CHECK), and a GiST index on `location`.
Existing rows keep working: no contact, no limits, available, both vehicles.
Its downgrade drops the columns and loses the values entered since; back up
`water_sources` first.

Audit rows: `audit_logs` with `target_type` `water_source`, `target_id` the
source, `metadata` `{water_category_id, status}` (none for `water_source_added`;
`{kind}` for `water_source_kind_set`; `{fields}`, the names of the changed fields and
never their values, for `water_source_updated`, which the admin endpoints write when
any field is edited; `{water_category_id}` only, never an amount, for
`water_source_cost_changed`).

## 5. API endpoints and request/response behavior

**Admin water-source endpoints (#309).** Five admin-only endpoints list sources,
add one, edit its name, location or kind, activate or renew it for a category, and
suspend or revoke an activation. They are defined in
[admin-water-sources.md](../api/admin-water-sources.md) (agreed 2026-11-01). Each
write runs the same service function as the command line, so it writes the same
audit row, and returns the whole source with each activation's `expiry`
(`ok`, `expires_soon` within 30 days, `expired`) and its eligibility `reasons`.
The 404 codes are `water_source_not_found`, `water_category_not_found` and
`activation_not_found`; a past `approved_until` is 422 `validation_error`.

**#407 additions.** `WaterSourceRead` gains `contact_name`, `contact_phone`,
`min_litres_per_order`, `max_litres_per_order`, `is_available`, `vehicle_kinds`
and `source_reasons` (`kind_not_set`, `unavailable`); `POST` and `PATCH` accept
the same fields (`null` clears the contact and the limits in a `PATCH`). A
maximum below the minimum, sent or stored, is 422 on `max_litres_per_order`; a
phone that is not a Nigerian mobile is 422. Activating or renewing a source with
no kind is 409 `water_source_kind_required`. `PATCH .../activations/{category_id}`
with `{cost_per_litre_minor_units}` changes only the cost, in any status.

**Eligibility in orders.** The hold review's `GET /admin/orders/{reference}/hold`
returns `source_eligibility` from the shared check, and
`POST .../hold/continue` checks it again (409 `source_not_eligible`,
`details.answer`). The R2 messages are in the
[contract](../api/deliveries.md#source-eligibility-r2). The confirmation
options (`GET /admin/orders/{reference}/confirmation-options`) carry the ten
order-fit reasons for that order (#407); the order detail's `source.reasons`
keeps the four safety ones. Placing an order with a quote whose sources no
longer fit is 409 `no_eligible_source`, and confirming with a source that no
longer fits is 409 `transition_requirements_unmet` with `source_eligible`.

## 6. Important business rules

- **The FR-012 gate:** eligible only with an `activated` activation whose
  `approved_until` is today or later, in Africa/Lagos (inclusive: an
  approval until 31 October still counts on 31 October; T-04).
- **Several reasons** can apply (a suspended activation whose approval also
  expired). They are listed as `not_activated`, `suspended`, `revoked`,
  `approval_expired`; R2 shows the first one's message.
- **Suspend and revoke** (BR-10) keep the row and record a reason. Activating
  again (renewal or reinstatement) clears the reason and updates the report,
  date and cost. Nothing is deleted.
- **Cost per litre is never sent to a client** (contract, C1: it is the
  supplier's cost, not the customer's price). Only the command line and the
  admin water-source endpoints show it (#309, decision 1): the admin screen may
  show and set it, as integer kobo. Customer, driver and quote responses never
  carry it, and the audit details never hold it.
- **Approval dates:** the API refuses an `approved_until` before today in Lagos,
  because the activation would be expired when saved. The command line still
  accepts a past date.
- **Laboratory reports stay outside the app:** only the reference is stored
  (F1).
- **Kind** (#21, #407 decision 407-2): a source needs a kind to be activated
  or renewed, and a source with no kind (`kind_not_set`) serves no order at all,
  Keke included. Keke orders take any kind that is set. Quotes price the water
  with the **highest** cost per litre among the sources that fit the order.
- **Order fit** (#407, D14): the litre limits apply to the complete order, not
  one trip, and are inclusive. `is_available` is not a safety status: suspend
  and revoke stay the BR-10 controls. An order placed before delivery types
  existed has its vehicle not checked. No stock levels are kept.
- **Re-checked at every step** (#407 review): at quote creation, when a quote
  is accepted into an order, in the C1 options and when confirming. Options
  loaded earlier are never trusted; confirmation reads the chosen source again
  with its rows locked `FOR SHARE`, so an admin edit saving at the same moment
  waits or is seen. An accepted quote is never repriced: if its sources no
  longer fit, the order is refused instead.
- **Cost changes** (#407, T-09): changing the cost alone keeps the status,
  report reference and date, and only new quotes read it. The activation row is
  read fresh under its lock, so a stale copy never undoes a suspension.
- **Supplier contact** is admin-only, like the cost: never in a customer or
  driver response, an audit row or a log.
- **Simulated sources** may serve a real order for now (contract decision
  9); `water_sources.is_simulated` still marks them.
- **A free-text source at pickup is never eligible** (hold review decision
  7); choosing a recorded source is #109.

## 7. Authentication and authorization requirements

The admin water-source endpoints are admin-only: a customer or driver gets 403
`forbidden`, and no session gets 401 `not_authenticated`. Writes need the CSRF
header. The signed-in admin is the audit row's actor.

The command line runs with direct database access on the server, like the
other management tools. Every change names an active **admin** account with
`--by <phone>`; any other phone is refused ("no active admin account has
this phone"). That admin is the audit row's actor (NFR-004). The R2
endpoints are admin-only, as before.

## 8. Error handling and edge cases

| Case | Result |
| --- | --- |
| `--by` is not an active admin | `Error: no active admin account has this phone`, exit 1, nothing written |
| Unknown source id or category code | `Error: ...`, exit 1 |
| `set-kind` or `add-source --kind` with a kind other than `ninth_mile` or `borehole` | argparse usage error, exit 2 |
| `suspend` or `revoke` with no activation for the category | `Error: the source has no activation for <code>`, exit 1 |
| Bad argument (phone, UUID, date not `YYYY-MM-DD`, negative or fractional cost, empty or too long text, unknown category) | argparse usage error, exit 2 |
| A second activation row for the same source and category | Refused by the unique constraint; the service updates the existing row instead |
| An activated row with a reason, or a suspended row without one | Refused by CHECK |
| Order with no water category under source review | `cannot_check`; Continue refused |
| `activate` (CLI or API) on a source with no kind | CLI: `Error: set the source's kind before activating it`, exit 1; API: 409 `water_source_kind_required`; nothing written |
| A `PATCH` leaving the minimum litres above the maximum | 422 on `max_litres_per_order`, nothing written |
| A pickup point outside `DELIVERY_LOCATION_BOUNDS` | 422 on `location`; the screen shows the server's message under the field |
| Cost change on a category never activated | 404 `activation_not_found` (after the source and category checks) |
| A source marked unavailable after the C1 options were loaded | Confirmation refused, 409 `transition_requirements_unmet` (`source_eligible`) |

## 9. Testing instructions

```bash
cd backend && source .venv/bin/activate
ruff check . && ruff format --check .
pytest tests/test_water_sources.py tests/test_command_models.py
# With a separate test database (LOG.md, 2026-10-20), after alembic upgrade head:
TEST_DATABASE_URL=... pytest tests/test_water_sources_integration.py tests/test_hold_review_integration.py
```

- `test_water_sources.py` (no database): every reason, several reasons in
  order, the inclusive Lagos date (T-04), and the command-line arguments,
  including `--kind` and `set-kind`.
- `test_quotes_integration.py`: `set_kind` and its audit row, and an unknown
  source refused.
- `test_water_sources_integration.py`: the seeded categories; the command
  lifecycle (add, activate, suspend, renew, revoke) and its audit rows with
  no cost, reference or reason in the metadata; the database rules; R2
  answering from the records (no category, not activated, expired,
  suspended, eligible then Continue); a simulated source.
- `test_admin_water_sources_api.py` (no database): who may call the admin
  endpoints (401, 403, CSRF), the shape of the answer, every 422 (empty or long
  text, a past date, a float or negative cost, `activated` as a status, an empty
  or `null` patch), and the expiry state at 0, 1, 30 and 31 days and after.
- Frontend (`frontend/`): `lib/api/adminWaterSources.test.ts` (each call's path,
  method and body; the error codes; a wrong shape and a non-integer cost are
  refused), `features/admin/waterSources/logic.test.ts` (the expiry badge, the
  cost in whole kobo with no rounding, each form's messages),
  `waterSources.screens.test.tsx` (the page against the real API: every state,
  each dialog, the line that the app does not check the report, the 404 Refresh)
  and `waterSources.mock.test.tsx` and `mocks/waterSourceMock.test.ts` (the mock
  demo, tagged SAMPLE DATA).
- `test_admin_water_sources_integration.py`: through HTTP, add, edit (a repeat
  edit writes no audit row), activate, suspend, renew, revoke and move to
  suspended, with each audit row and no typed value or cost in its details; the
  three 404 codes with nothing written; a past date stored nowhere; and
  customers and drivers getting 403 and never seeing the cost.
- `test_hold_review_integration.py`: a free-text source is `not_eligible`.
- `test_source_order_fit.py` (no database, #407): each order-fit reason alone
  and together in the contract's order, the inclusive litre limits, the legacy
  order without a delivery type, and the four safety values unchanged.
- `test_source_order_fit_integration.py` (#407): supplier details audited by
  field name only; the stored-limit 422; no activation or renewal without a kind;
  the cost-only change, its audit row, its 404 order and a stale session that
  never undoes a suspension; T-09; quotes, quote acceptance, C1 and confirmation
  using the check; and a source edit waiting for a confirmation that holds it.
- Frontend (#407): the new fields and `source_reasons` parsed and refused when
  wrong, the cost `PATCH`, the 409; each form message, the facts line and the
  no-kind notice; the screen's disabled Activate, Edit source after a 409,
  Change cost, the supplier edit sending only what changed, and the server's
  bounds message under the pickup point; the C1 parser accepting the ten
  reasons while the order detail keeps four.
- Migration: `alembic upgrade head`, `alembic check`, `alembic downgrade -1`
  run on a throwaway PostGIS container (2026-10-22); for `0028`, upgrade,
  downgrade, upgrade and `alembic check`.

Manual check: `python -m app.modules.sources.cli list-categories`, then the
commands in the module docstring with your admin phone; `list-sources`
shows each activation.

On the production VPS, run the same commands through `deploy/prod.sh exec api ...`;
the walkthrough and the points to watch are in
[docs/deployment/hostinger.md](../deployment/hostinger.md), "Water sources".

## 10. Known limitations

- **Only confirmed orders have a water category:** it is set at
  confirmation ([order-confirmation.md](order-confirmation.md), #113). Orders
  confirmed before that (by script) have none, so their source review
  answers `cannot_check`.
- **The Water sources page was built from the written design** (#309). The
  design was approved as text; the visual mockup from Claude Design is still to
  be attached and checked, and the layout may change when it is. A category's
  label and supported uses can still be changed only in the database.
- **Approvals do not expire on their own** beyond the date check, and no
  notification is sent before `approved_until` (decision 4 on #309). The page
  shows an "Expires in N days" or "Expired" badge from the endpoints' `expiry`.
- **The audit log has words for `water_source_updated`** ("Edited a water
  source") and `water_source_cost_changed` ("Changed a water source's cost"),
  but `water_source_suspended` and `water_source_revoked` still show as the code
  until their words are added.
- **Existing sources with no kind serve no order** since #407: an admin sets
  each one's kind on the screen (a notice counts them) or with `set-kind`.
- **The command line has no #407 options:** the contact, litre limits,
  availability and vehicles are set on the screen; `add-source` gives the
  defaults.
- **No stock levels and no supplier login** (#407 out of scope). The
  supplier's phone is not shown to drivers.
- **A suspended source does not block orders already confirmed with it**
  (contract decision 10); the order detail will report it (#113).
