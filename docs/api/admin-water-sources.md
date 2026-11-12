# Admin water sources contract

**Status: agreed** by @nnamdi-security on 2026-11-01 (G3). Proposed the same day
for #309 by @Bonvee120 (+ Claude Code), from the technical lead's decisions on the
issue
([comment](https://github.com/mmiri-oma/mmirioma/issues/309#issuecomment-6560696255)).
The backend and the screen are built to this contract. The sections that carry a
decision from the issue say so.

Requirements: FR-011, FR-012, FR-014, BR-09, BR-10, NFR-004 · Design:
[admin-water-sources.md](../design/admin-water-sources.md) · Feature document:
[water-sources.md](../features/water-sources.md)

Conventions (base path `/api/v1`, formats, error envelope, CSRF, pagination)
are in the [README](README.md#conventions-apply-to-every-endpoint).

## What this covers

Until now a source could be added, activated, suspended or revoked only with
the command-line tool on the server (`backend/app/modules/sources/cli.py`,
pilot fallback F1). These endpoints do the same work for an admin, with the
same service functions and the same audit rows, and add two things the command
line lacks: editing a source's name and location, and an expiry state on each
activation.

The command line stays as the fallback. Nothing here changes how the
eligibility check works ([deliveries.md](deliveries.md#source-eligibility-shared-with-r2)).

## Access

All endpoints are admin-only (`CurrentAdmin`). A customer or driver gets 403
`forbidden`, and no session gets 401 `not_authenticated`. The admin role is the
only one that exists for staff today (decision 5 on the issue). Unsafe methods
need the CSRF header like every other write.

## Cost per litre: the boundary (amends C1)

The order confirmation contract says the supplier's cost per litre is never
returned to a client (C1). Decision 1 on the issue changes that for the admin
screen:

- `cost_per_litre_minor_units` is returned and accepted **only** by the
  endpoints in this document, which are admin-only.
- It stays out of every other response: customer orders, quotes, the driver's
  jobs, and the order confirmation options. The sentence in
  [deliveries.md](deliveries.md) that says "never returned to the client" now
  reads "never returned to a client except by the admin water-source
  endpoints".
- It is an integer in kobo, `>= 0`. Never a float, never naira.
- It is not written to the audit row's `details`.

The backend tests for these endpoints must also check that a customer's and a
driver's responses never contain the field.

## Objects

### `WaterSourceRead`

```json
{
  "id": "5c7e9a1b-3d5f-4a7c-8e1b-3d5f7a9c1e30",
  "name": "Sample Borehole A",
  "approximate_location": "Off Ogui Road, Enugu",
  "location": { "latitude": 6.4361, "longitude": 7.5134 },
  "kind": "borehole",
  "is_simulated": true,
  "created_at": "2026-10-27T08:00:00Z",
  "activations": [
    {
      "category": { "id": "8840405c-b861-4733-b822-4751f624b6d3", "code": "utility", "label": "Utility Water" },
      "status": "activated",
      "approved_until": "2026-11-20",
      "report_reference": "SAMPLE-LR-0001",
      "cost_per_litre_minor_units": 150,
      "status_reason": null,
      "expiry": { "state": "expires_soon", "days_left": 19 },
      "reasons": []
    }
  ]
}
```

| Field | Rule |
| --- | --- |
| `name` | 1 to 120 characters, as stored (`water_sources.name`) |
| `approximate_location` | 1 to 200 characters, the pickup place in words (FR-011) |
| `location` | The pickup point, `{ "latitude", "longitude" }` (WGS 84, 6 places, inside the delivery bounds), or `null` (the default). Set by an administrator; used only to price the delivery by road distance ([#385](order-details-and-price.md#amendment-385-road-distance-pricing)). Never sent to a customer or a driver |
| `kind` | `borehole`, `ninth_mile` or `null` while not set. A source with no kind serves no Tanker preference ([water-sources.md](../features/water-sources.md)) |
| `is_simulated` | Demo source (BR-09). Clients show a Simulated tag |
| `activations` | One entry per category the source has ever been activated for, by category label. A category with no entry is "not activated" and the client says so |
| `activations[].category` | `id`, `code` (`potable` or `utility`) and `label`. The label is a name, never a claim about the water |
| `activations[].status` | `activated`, `suspended` or `revoked` (BR-10) |
| `activations[].approved_until` | The last Lagos date the laboratory approval is valid, inclusive (T-04) |
| `activations[].report_reference` | The laboratory report reference, 1 to 100 characters. The report stays outside the app and the app does not check it (FR-012, F1). Never a document or a link |
| `activations[].cost_per_litre_minor_units` | See the boundary above |
| `activations[].status_reason` | Why it was suspended or revoked, up to 500 characters, or `null` while `activated` |
| `activations[].expiry` | `{ "state", "days_left" }`, worked out by the server from the Lagos date. `state` is `ok`, `expires_soon` or `expired`. `days_left` is the whole days from today to `approved_until`: 0 on the last valid day, negative once expired. Only an `activated` activation carries a meaningful state; for `suspended` and `revoked` it is still sent, and the screen shows the status first |
| `activations[].reasons` | The eligibility reasons for today (`not_activated`, `suspended`, `revoked`, `approval_expired`, in the contract's order), `[]` when the source may serve the category now. Same values and order as the order confirmation options |

**The warning window.** `expires_soon` means `0 <= days_left <= 30`
(decision 4 on the issue; the window is fixed in the design record at 30
days). It is a badge on the screen only: no notification and no new
notification kind. `expired` means `days_left < 0`, the day after
`approved_until`.

### `WaterCategoryRead`

`{ "id", "code", "label" }`, as in `activations[].category`. Both categories
are always listed, so the activation form can offer a category the source has
never been activated for.

## Endpoints

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/admin/water-sources` | none | 200 `WaterSourceListRead` | 401, 403 |
| POST | `/admin/water-sources` | `WaterSourceCreate` | 201 `WaterSourceRead` | 401, 403, 422 |
| PATCH | `/admin/water-sources/{source_id}` | `WaterSourceUpdate` | 200 `WaterSourceRead` | 401, 403, 404 `water_source_not_found`, 422 |
| PUT | `/admin/water-sources/{source_id}/activations/{category_id}` | `ActivationWrite` | 200 `WaterSourceRead` | 401, 403, 404 `water_source_not_found`, 404 `water_category_not_found`, 422 |
| POST | `/admin/water-sources/{source_id}/activations/{category_id}/status` | `ActivationStatusWrite` | 200 `WaterSourceRead` | 401, 403, 404 `water_source_not_found`, 404 `water_category_not_found`, 404 `activation_not_found`, 422 |

Writes return the whole source, so the screen replaces one row and needs no
second request.

### `GET /admin/water-sources`

Every source, by name, with its activations. Not paginated: the pilot has a
handful of sources, and the command line lists them all the same way (see the
open questions).

```json
{
  "items": [ { "...": "WaterSourceRead" } ],
  "categories": [
    { "id": "9093d6e6-1d7e-407a-b60a-5eea07a45bde", "code": "potable", "label": "Potable Water" },
    { "id": "8840405c-b861-4733-b822-4751f624b6d3", "code": "utility", "label": "Utility Water" }
  ]
}
```

An empty `items` is a valid answer: a new deployment has no sources.

### `POST /admin/water-sources`

```json
{ "name": "Sample Borehole A", "approximate_location": "Off Ogui Road, Enugu", "kind": "borehole" }
```

| Field | Rule |
| --- | --- |
| `name` | Required, trimmed, 1 to 120 characters |
| `approximate_location` | Required, trimmed, 1 to 200 characters |
| `kind` | `borehole`, `ninth_mile` or `null` (the default). `null` is allowed because the command line allows adding a source before its kind is known |
| `is_simulated` | Optional boolean, default `false`. The screen never sends it; it exists so demo data can still be flagged through the API (BR-09) |

The new source has no activations: it serves no category until one is added.
Audit: `water_source_added`, no `details`.

### `PATCH /admin/water-sources/{source_id}`

Edits a source's name, location and kind (decision 3 on the issue). Send only
the fields that change; at least one is required. `kind` can be changed but
not cleared. The category label and supported uses are out of scope.

```json
{ "name": "Sample Borehole B", "approximate_location": "Near the Abakpa market gate" }
```

If every sent value already equals the stored one, the answer is 200 with
nothing written and no audit row. Otherwise one audit row is written:
`water_source_updated`, with `details` `{ "fields": ["name", "approximate_location"] }`
naming the changed fields and never their values (the audit module keeps
`details` to ids and kinds). The command line keeps its own
`water_source_kind_set`.

### `PUT /admin/water-sources/{source_id}/activations/{category_id}`

Activates a source for a category, or renews an existing activation in any
status (FR-012). This is the command line's `activate`: an existing row is
updated, a missing one is created, and a suspended or revoked row becomes
`activated` with its reason cleared.

```json
{ "approved_until": "2027-03-31", "report_reference": "SAMPLE-LR-0002", "cost_per_litre_minor_units": 150 }
```

| Field | Rule |
| --- | --- |
| `approved_until` | Required date. Not before today in Lagos, else 422 `validation_error` on this field (see the open questions) |
| `report_reference` | Required, trimmed, 1 to 100 characters. The screen asks for it, as the command line does. There is no "report checked" flag (decision 2 on the issue) |
| `cost_per_litre_minor_units` | Required integer `>= 0`, in kobo |

The server does not verify the laboratory report and the response never says
it did. Audit: `water_source_activated`, `details` `{ "water_category_id", "status" }`,
the same as the command line, with no reference and no cost.

### `POST /admin/water-sources/{source_id}/activations/{category_id}/status`

Suspends or revokes an activation (BR-10). This is the command line's
`suspend` and `revoke`.

```json
{ "status": "suspended", "reason": "Supplier reported a pump repair." }
```

| Field | Rule |
| --- | --- |
| `status` | `suspended` or `revoked`. `activated` is 422: use the PUT above |
| `reason` | Required, trimmed, 1 to 500 characters. Kept on the activation, never in the audit `details` |

From then on the source is not eligible for the category: new confirmations
cannot choose it and a source review cannot continue with it. Orders already
confirmed with it keep it ([deliveries.md](deliveries.md), decision 10).
Audit: `water_source_suspended` or `water_source_revoked`, `details`
`{ "water_category_id", "status" }`.

## Amendment #385: a source `location` (built in #385)

**Status: agreed** (G3) on 2026-11-03 by @nnamdi-security, who is not the author,
with the road-distance amendment in
[order-details-and-price.md](order-details-and-price.md#source-location).
`WaterSourceRead` gains `location`: `{ "latitude", "longitude" }` (WGS 84,
inside the [delivery bounds](delivery-location.md#delivery-bounds)) or `null`
(the default). `POST` and `PATCH /admin/water-sources` accept the same optional
field; the `add-source` command gains `--latitude` and `--longitude`, both or
neither. It is never sent to a customer or a driver. It changes no existing
field, and a source without one keeps working: any quote that could use it uses
the zone fee. A PATCH that sets or clears it is audited as
`water_source_updated` with `details.fields` naming `location`, never the
coordinates. In `PATCH`, `location: null` clears it and leaving the field out keeps it. The Water sources screen gets no new field in #385.

## Amendment #407: supplier details, order fit and cost edits

**Status: agreed** (G3), @nnamdi-security (+ Codex), 2026-11-12, PR #417.
Originally proposed on 2026-11-12 for
[#407](https://github.com/mmiri-oma/mmirioma/issues/407) by @DevBonavee
(+ Claude Code). The reviewer is not the author. Documentation only; the
implementation is the next #407 PR.

Requirements: FR-011, FR-012, FR-013, FR-014, FR-024, BR-10 · Tests: T-04, T-09
· Design: [amendment #407](../design/admin-water-sources.md#amendment-407-supplier-details-order-fit-and-cost-edits)
· SRS: FR-011 and §5 `water_sources`, amended in the same PR.

Automatic source selection (#408 road pricing, #411 dispatch) has to know more
than "is this source activated today". It needs who to call at the source, the
pickup point, the order sizes the supplier agreed to, whether the source is
open for work, and which vehicles can load there. This amendment adds those
fields, one shared check that says why each source fits an order or not, and a
way to change the cost per litre without re-entering the laboratory record.
Fields and the cost endpoint are additive, but eligibility changes behavior:
legacy kind-less sources stop qualifying, activation gains a 409 and C1
gains closed-enum values. Coordinate the backend and clients in one build PR.

### Decisions

| # | Question | Agreed answer |
| --- | --- | --- |
| D14 | What do "approved quantities" and "vehicle suitability" mean as data? | Minimum and maximum litres per order on the source, each optional, and a list of allowed vehicle kinds (`keke`, `tanker`) on the source, at least one. No stock levels: nothing in the MVP would keep a daily stock figure accurate. Agreed by the reviewer with this contract; bounds apply to the complete order |
| 407-1 | What is the supplier contact? | An optional contact name and an optional Nigerian phone number. No email |
| 407-2 | What happens to an activated source that has no kind? | It is excluded everywhere with the new reason `kind_not_set`, and the screen flags it. Activating a source with no kind is refused. Before this change such a source could serve a Keke order |
| 407-3 | Which litres do the limits apply to? | The order's whole quantity, not one trip |

### New fields on `WaterSourceRead`

```json
{
  "contact_name": "Sample Contact",
  "contact_phone": "+2348030000000",
  "min_litres_per_order": 600,
  "max_litres_per_order": 10000,
  "is_available": true,
  "vehicle_kinds": ["keke", "tanker"],
  "source_reasons": []
}
```

| Field | Rule |
| --- | --- |
| `contact_name` | Who to call at the source, 1 to 120 characters, or `null` (the default) |
| `contact_phone` | Their number in E.164 (`+234...`), or `null` (the default). A request may send a local form such as `0803 000 0000`; the server normalizes it with the same rule as account phones (`app/shared/phone.py`) and refuses anything that is not a Nigerian mobile number with 422 `validation_error` |
| `min_litres_per_order` | The smallest order, a strict integer of at least 1 whole litre, the supplier agreed to serve from this source, or `null` for no minimum |
| `max_litres_per_order` | The largest order, a strict integer of at least 1 whole litre, or `null` for no maximum. When both are set, the minimum is not above the maximum, else 422 `validation_error` on `max_litres_per_order` |
| `is_available` | Whether the source takes new work now. `true` by default. An admin sets it to `false` when the supplier is closed or out of water; this is not a safety status (that stays suspend and revoke, BR-10) |
| `vehicle_kinds` | The vehicles that can load here: one or both of `keke` and `tanker`, no repeats, in that order. Both by default. An empty list is 422 `validation_error`: a source no vehicle can use is unavailable instead |
| `source_reasons` | Reasons that exclude the source from every order today, whatever its category: `kind_not_set` and `unavailable`, in that order. `[]` when none applies. The screen shows them on the card |

The contact name and phone are supplier contact details. They are returned
only by these admin endpoints, never to a customer or a driver, and never
written to an audit row or a log. A driver who needs the source's phone is a
later decision, not part of this amendment.

### Request changes

`POST /admin/water-sources` accepts every field above except
`source_reasons`, each optional with the default shown.

`PATCH /admin/water-sources/{source_id}` accepts the same fields; send only
the ones that change. `null` clears `contact_name`, `contact_phone`,
`min_litres_per_order` and `max_litres_per_order`. `is_available` and
`vehicle_kinds` cannot be `null`. The minimum-not-above-maximum rule is checked
against the stored value of the field not sent. The audit row stays
`water_source_updated` with `details.fields` naming the changed fields, never
their values.

### Activation needs a kind

`PUT /admin/water-sources/{source_id}/activations/{category_id}` on a source
whose `kind` is `null` is refused with **409 `water_source_kind_required`**,
"Set where this source collects water before activating it." Nothing is
written. The command line's `activate` refuses it the same way. Sources
activated before this change keep their activations, and `kind_not_set`
excludes them until an admin sets a kind.

### Change the cost per litre

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| PATCH | `/admin/water-sources/{source_id}/activations/{category_id}` | `ActivationCostWrite` | 200 `WaterSourceRead` | 401, 403, 404 `water_source_not_found`, 404 `water_category_not_found`, 404 `activation_not_found`, 422 |

```json
{ "cost_per_litre_minor_units": 180 }
```

`cost_per_litre_minor_units` is required, an integer `>= 0`, in kobo. It
changes only the cost: the status, report reference, approval date and reason
stay as they are, so a suspended activation can have its cost corrected and
stays suspended. A cost equal to the stored one is 200 with nothing written.
Otherwise one audit row is written, `water_source_cost_changed`, with
`details` `{ "water_category_id" }`: never the old or new cost.

**New quotes only (FR-024, T-09).** A quote stores its amounts when it is
made, and an order keeps the snapshot of the quote it accepted. A cost change
is read by the next quote and changes no existing quote or order.

### The order-fit check

One server function, `eligible_sources_for`, in
`backend/app/modules/sources/eligibility.py`, answers "which sources can serve
this order, and why not the others?" for #408 (road pricing) and #411
(dispatch), and replaces `eligible_sources` in the quote. It is not an
endpoint. Its inputs are the water category, the order's quantity in litres,
its delivery type (`keke` or `tanker`), the Tanker customer's source preference
(`borehole`, `ninth_mile`, or none) and today's date in Lagos. For every
source it returns the source, its cost per litre and pickup point for the
server's own use, and a list of reasons; `[]` means the source can serve the
order.

The reasons, always in this order:

| Reason | When |
| --- | --- |
| `not_activated` | No activation for the category (unchanged) |
| `suspended` | The activation is suspended (unchanged) |
| `revoked` | The activation is revoked (unchanged) |
| `approval_expired` | The approval ended before today in Lagos (unchanged, T-04) |
| `kind_not_set` | The source has no kind (decision 407-2) |
| `unavailable` | `is_available` is `false` |
| `kind_mismatch` | A Tanker customer chose a source kind and this source is the other kind |
| `below_minimum_litres` | The order's litres are below `min_litres_per_order` |
| `above_maximum_litres` | The order's litres are above `max_litres_per_order` |
| `vehicle_not_suitable` | The order's delivery type is not in `vehicle_kinds` |

The first four are the FR-012 safety gate and keep their meaning. The R2
source review (pickup already happened) still uses only those four, so its
answers and messages do not change. `activations[].reasons` on this screen
also keeps the four; the two source-wide reasons are in `source_reasons`.

The order confirmation options (C1) gain the six new values in each source's
`reasons`, worked out for the order being confirmed. That extends the closed enum in [deliveries.md](deliveries.md#source-eligibility-shared-with-r2),
recorded there. The C1 screen shows a label for each:

| Reason | C1 label |
| --- | --- |
| `kind_not_set` | Kind not set |
| `unavailable` | Marked unavailable |
| `kind_mismatch` | Not the customer's chosen source type |
| `below_minimum_litres` | Order is below this source's minimum |
| `above_maximum_litres` | Order is above this source's maximum |
| `vehicle_not_suitable` | This vehicle cannot load here |

### Enforcement and client compatibility

The build must apply the shared order-fit check when creating a new quote,
when accepting a quote into a new order, when returning C1 options, and again
when committing confirmation against the selected source. Previously saved
options are not authorization: an admin edit between loading and confirming
must cause a clear refusal, not confirmation against an ineligible source.
Preserve existing quote/order amounts and existing API error envelopes; #408
and #411 reuse this check at source selection and new offers. An accepted
quote is never silently repriced when costs or source availability change.

The existing `SOURCE_REASONS` in
`frontend/src/lib/api/confirmationTypes.ts` is shared with hold review and
order details. Do not widen it globally: create a C1-specific reason list and
parser in `adminConfirmation.ts`, with labels for all six new values. R2 and
`AdminOrderDetail.source.reasons` retain the original four-value contract.
Ship these client changes, mocks, schemas and parsing tests with the backend.
Unknown reasons must continue to fail safely rather than imply eligibility.

Activation with a missing kind is refused atomically for both create and
renew. The cost-only PATCH is admin-only with CSRF, a non-null strict integer
cost in kobo, and no changes to approval or status. Preserve not-found order:
unknown source, unknown category, then missing activation. Concurrent cost
and activation updates must not overwrite unrelated fields or restore a
suspended/revoked status. Test these interleavings on the database.

All added reads and writes inherit the admin role and CSRF rules above.
Contact names, phones, coordinates and costs never appear as values in audit
details or logs. Field names may be audited. Keep source eligibility and cost
logic in the backend and keep R2's post-pickup safety review unchanged.

### Pickup point bounds

The screen now sends `location` (#385 already accepts it). A latitude or
longitude outside `DELIVERY_LOCATION_BOUNDS` is refused with 422
`validation_error` on `location`, as today.

### Database

One additive, reversible migration on `water_sources`: `contact_name`
(varchar 120, null), `contact_phone` (varchar 16, null),
`min_litres_per_order` and `max_litres_per_order` (integer, null, each
`>= 1`, and a CHECK that the minimum is not above the maximum when both are
set), `is_available` (boolean, default true), the allowed vehicle kinds
(stored as two booleans, `serves_keke` and `serves_tanker`, default true, with
a CHECK that at least one is true), and a GiST index on `location`. Existing
rows stay valid: every new column is nullable or has a default. The GiST
index uses the existing geography point. Downgrade drops the new fields and
therefore loses supplier details; document and back up that loss before any
rollback. No migration or database operation runs in this documentation PR.

### Error codes added by #407

| Status | Code | When |
| --- | --- | --- |
| 409 | `water_source_kind_required` | Activating a source whose kind is not set |

### Out of scope

Stock levels, a supplier login, storing laboratory documents, and showing
the supplier's phone to a driver.

### Tests the build must include

Every reason above, alone and together, with the litre limits at their
boundaries (equal to the minimum and the maximum is allowed); a cost edit that
leaves an earlier quote's amounts unchanged (T-09); an expired, suspended,
revoked, unavailable, wrong-kind, wrong-size or unsuitable source never
returned as eligible (T-04); the cost and the contact phone absent from audit
rows and from every customer and driver response; roles and CSRF on the new
PATCH; atomic confirmation and concurrent updates; C1 accepts each new
reason while R2 keeps its four; upgrade/downgrade/upgrade and `alembic check`.

## Error codes added

| Status | Code | When |
| --- | --- | --- |
| 404 | `water_source_not_found` | The source id is unknown |
| 404 | `water_category_not_found` | The category id is unknown |
| 404 | `activation_not_found` | Suspend or revoke on a category the source was never activated for |

Validation failures use the usual 422 `validation_error` with `details` as a
list of `{loc, msg, type}`. Nothing in an error body carries the cost, the
report reference or a reason.

## Audit and privacy

Every successful write that changes something writes one `audit_logs` row
(NFR-004) in the same transaction, with the signed-in admin as actor,
`target_type` `water_source` and `target_id` the source. `details` holds ids,
kinds and field names only. The new action code `water_source_updated` needs
its words in the audit log screen ("Edited a water source"); that is a
frontend change that goes with the screen.

## Open questions

All three were decided by the technical lead on 2026-11-01 (G3).

| # | Question | Decision |
| --- | --- | --- |
| 1 | Should `approved_until` in the past be refused on activation? | **Yes**, refused with 422 `validation_error` on that field (a date before today in Lagos). Renewing an expired approval needs a new date. The command line keeps accepting a past date (it is the fallback); the screen and the API do not |
| 2 | Is an unpaginated list acceptable? | **Yes** for the pilot. Add a page limit if the list grows |
| 3 | Can a revoked activation be moved to suspended? | **Yes**, with an audit row, as the command line allows (BR-10) |

## Changes

| Date | Change | Agreed by |
| --- | --- | --- |
| 2026-11-01 | Proposed (#309), from the technical lead's decisions on the issue | not yet agreed |
| 2026-11-01 | Agreed, with the three open questions decided; the 401 code is `not_authenticated`, as in the README | @nnamdi-security |
| 2026-11-03 | Additive (#385): an optional `location` on a water source, set by an administrator and never sent to a customer or a driver ([amendment](#amendment-385-a-source-location-built-in-385), with the road-distance rules in order-details-and-price.md) | @nnamdi-security (G3, 2026-11-03) |
| 2026-11-12 | Agreed, not implemented (#407): supplier contact, litre limits, availability and vehicle kinds on a source; a kind required to activate; a cost-only PATCH; the order-fit check and its six new reasons ([amendment](#amendment-407-supplier-details-order-fit-and-cost-edits)) | @nnamdi-security (+ Codex), G3, PR #417 |
