# Water sources and source eligibility

Requirements: FR-011, FR-012, FR-014, BR-09, BR-10, NFR-004 · Acceptance
tests: T-04 (an expired approval blocks the source) · Contract:
[deliveries.md](../api/deliveries.md#order-confirmation-endpoints), "Source
eligibility (shared with R2)" and "Data needed" (agreed G3, PR #111) ·
Issue: #112 (from #87) · Pilot fallback: F1
(pilot plan)

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
  point 2).

An admin manages sources through the admin water-source endpoints (#309,
[admin-water-sources.md](../api/admin-water-sources.md)); the Water sources
screen for them is still to be built. The command-line tool (F1) does the same
work and stays as the fallback. A record here says an admin entered an approval
after laboratory verification; the app cannot verify that, and a database flag
is not legal compliance (FR-012).

## 2. Feature workflow

```
technical lead (command line, --by <admin phone>)
  add-source [--kind] ─────> water_sources            + audit "water_source_added"
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
```

## 3. Important files

| File | Responsibility |
| --- | --- |
| `backend/app/modules/sources/models.py` | `WaterSource`, `WaterCategory`, `WaterSourceCategory`, `ActivationStatus` |
| `backend/app/modules/sources/eligibility.py` | `EligibilityReason`, `REASON_ORDER`, `eligibility_reasons` (pure), `source_reasons` (loads the activation) |
| `backend/app/modules/sources/service.py` | Add sources, set the kind, activate, suspend, revoke, list; one audit row per change; `get_acting_admin`; for quotes, `eligible_costs_per_litre` and `has_activation` |
| `backend/app/modules/sources/cli.py` | The command-line tool (the fallback) |
| `backend/app/modules/sources/admin.py` | What the admin endpoints do: look the source and category up by id (404 if missing), call the service function the command line uses, return the whole source |
| `backend/app/modules/sources/admin_schemas.py` | Request and response bodies of the admin endpoints, the expiry state (30-day window) and the rule that `approved_until` is not in the past |
| `backend/app/modules/sources/admin_router.py` | `GET`/`POST /admin/water-sources`, `PATCH /admin/water-sources/{id}`, `PUT .../activations/{category_id}`, `POST .../activations/{category_id}/status` |
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

Audit rows: `audit_logs` with `target_type` `water_source`, `target_id` the
source, `metadata` `{water_category_id, status}` (none for `water_source_added`;
`{kind}` for `water_source_kind_set`; `{fields}`, the names of the changed fields and
never their values, for `water_source_updated`, which the admin endpoints write when
a name, location or kind is edited).

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

**Eligibility in orders.** The hold review's `GET /admin/orders/{reference}/hold`
returns `source_eligibility` from the shared check, and
`POST .../hold/continue` checks it again (409 `source_not_eligible`,
`details.answer`). The R2 messages are in the
[contract](../api/deliveries.md#source-eligibility-r2). The confirmation
options read and the order fields come with #113.

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
- **Kind** (#21): a source with no kind matches no Tanker preference, so it
  never prices a Tanker quote and cannot be chosen when confirming a quoted
  Tanker order. Keke orders take any kind. Quotes price the water with the
  **highest** cost per litre among eligible sources of the preferred kind.
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
- `test_admin_water_sources_integration.py`: through HTTP, add, edit (a repeat
  edit writes no audit row), activate, suspend, renew, revoke and move to
  suspended, with each audit row and no typed value or cost in its details; the
  three 404 codes with nothing written; a past date stored nowhere; and
  customers and drivers getting 403 and never seeing the cost.
- `test_hold_review_integration.py`: a free-text source is `not_eligible`.
- Migration: `alembic upgrade head`, `alembic check`, `alembic downgrade -1`
  run on a throwaway PostGIS container (2026-10-22).

Manual check: `python -m app.modules.sources.cli list-categories`, then the
commands in the module docstring with your admin phone; `list-sources`
shows each activation.

## 10. Known limitations

- **Only confirmed orders have a water category:** it is set at
  confirmation ([order-confirmation.md](order-confirmation.md), #113). Orders
  confirmed before that (by script) have none, so their source review
  answers `cannot_check`.
- **The Water sources screen is not built yet** (#309, design approved as
  text; the visual mockup is pending). Until it ships, an admin uses the
  endpoints or the command line. A category's label and supported uses can
  still be changed only in the database.
- **Approvals do not expire on their own** beyond the date check, and no
  notification is sent before `approved_until` (decision 4 on #309). The
  endpoints report an `expiry` state for a badge on the screen.
- **The audit log screen has no words yet for `water_source_updated`**; it shows
  the code until the frontend adds them.
- **Existing sources have no kind** after migration `0018`: the technical
  lead sets each with `set-kind` before Tanker orders can be quoted.
- **A suspended source does not block orders already confirmed with it**
  (contract decision 10); the order detail will report it (#113).
