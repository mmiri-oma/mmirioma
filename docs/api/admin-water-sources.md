# Admin water sources contract

**Status: proposed** on 2026-11-01 for #309, by @Bonvee120 (+ Claude Code), from
the technical lead's decisions on the issue
([comment](https://github.com/mmiri-oma/mmirioma/issues/309#issuecomment-6560696255)).
It becomes `Status: agreed` when one reviewer who is not the author agrees it
(CLAUDE.md, "Team workflow"). The backend and the screen are built only after
that. The sections that carry a decision from the issue say so.

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
`forbidden`, and no session gets 401 `unauthenticated`. The admin role is the
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
| `approximate_location` | 1 to 200 characters, the pickup place in words (FR-011). No coordinates |
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

| # | Question | Source |
| --- | --- | --- |
| 1 | Should `approved_until` in the past be refused on activation? The command line accepts it, which creates an activation that is expired at once. This contract proposes refusing it. | FR-012 |
| 2 | Is an unpaginated list acceptable? A few sources are expected in the pilot. Say if a page limit is wanted now. | README conventions |
| 3 | Can a revoked activation be moved to suspended? The command line allows it. This contract allows it and writes an audit row. | BR-10 |

## Changes

| Date | Change | Agreed by |
| --- | --- | --- |
| 2026-11-01 | Proposed (#309), from the technical lead's decisions on the issue | not yet agreed |
