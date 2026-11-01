# Deliveries contract: order state machine and assignments

Requirements: FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-038, FR-044,
BR-06, BR-12, BR-13, NFR-004 · Acceptance tests: T-07, T-08, T-12, T-25 ·
Issue: S1-06 (#7)

Status: **agreed** (G3) on 2026-10-19 by @nnamdi-security (technical lead,
contract owner) and @chidimmamogbo (orders backend; PR #48 review). The
endpoints under "Planned endpoints" are **not** part of this agreement: they
are agreed with the designs and features that use them. Assignment records
and services were built in S1-07 (#8). The
[Driver job endpoints](#driver-job-endpoints) section was agreed separately
(PR #50); its [part 2](#driver-job-endpoints-part-2-51) was agreed separately (#51, PR #74). The [Admin dispatch endpoints](#admin-dispatch-endpoints) section
was agreed separately (G3, PR #59). The
[Admin hold review endpoints](#admin-hold-review-endpoints) were agreed
separately (G3, PR #91). The
[Order confirmation endpoints](#order-confirmation-endpoints) were agreed
separately (G3, PR #111); they add row 26.

This document is the single source for order statuses after creation and
for every allowed transition. It replaces the draft "Transitions" table in
[orders.md](orders.md), which now points here. It follows SRS v0.2 FR-033.

## Principles

- **The order status tracks fulfilment only.** Payment has its own status
  (FR-040: `unpaid`, `awaiting_verification`, `pending_collection`,
  `partially_paid`, `paid`, `partially_refunded`, `refunded`, `disputed`),
  built with the payments feature. Neither is inferred from the other
  (BR-12): an order can be `delivered` with payment outstanding.
- **The server validates every transition** by the actor's role, the
  order's current status, the conditions in the table and, for drivers,
  that they are the assigned driver. Clients never send a "from" status.
- **Every transition is recorded** in `order_events`: actor (null for the
  system), time, from and to status, a reason code where one is required,
  and an optional note (NFR-004).
- **Transitions are serialized per order.** The order row is locked while a
  transition is checked and applied, so two concurrent requests cannot both
  move it (for example a driver accepting while the dispatcher withdraws).
- **Repeating a transition is harmless.** If the order is already in the
  requested status because the same actor just made the same change (a
  driver tapping "Arrived" twice on a slow connection), the server returns
  the order unchanged and writes no second event.

## Statuses

`quote_requested` → [`awaiting_payment`] → [`awaiting_confirmation`] →
`confirmed` → `assigned` → `accepted` → `departed` → `collected` →
`en_route` → `arrived` → `unloading` → `delivered`; alternatives
`cancelled`, `failed`, `disputed`. Brackets: only when they apply.

| Status | Meaning | New in v0.2 |
| --- | --- | --- |
| `quote_requested` | Request received, no accepted price | |
| `awaiting_payment` | **Prepaid only:** price accepted, payment not yet verified. Pay-on-delivery orders never enter it | yes |
| `awaiting_confirmation` | Price accepted (and prepaid payment verified), but a check needs a dispatcher: manual quote, source eligibility or slot | |
| `confirmed` | Eligible for dispatch. Pay on delivery: payment `pending_collection` | |
| `assigned` | Offered to a driver, who has **not** accepted (FR-032) | |
| `accepted` | The assigned driver accepted | |
| `departed` | The driver has left to fulfil the order (dispatched; FR-050 notifies the customer) | yes |
| `collected` | Water collected at the source (FR-034) | |
| `en_route` | Travelling to the customer | |
| `arrived` | Driver recorded arrival | yes |
| `unloading` | Driver started unloading | yes |
| `delivered` | Delivered with quantity, unloading confirmation and a verified delivery code or approved alternative proof (BR-06) | |
| `cancelled` | Cancelled with a reason. Terminal | |
| `failed` | A delivery attempt failed with a reason; may be rescheduled (FR-038) | |
| `disputed` | A delivered order is under review (T-12, FR-043) | |

`cancelled` is the only terminal status. `failed` can return to dispatch
(reschedule) and `disputed` is resolved back to `delivered`.

**Labels.** Customer and staff wording for the four new statuses comes from
the designs that first show them (customer progress timeline Q3, the driver
design S1-15, the admin dispatch screens). No endpoint can produce them until
those features ship; clients must add their labels before then.

## Actors

| Actor | Who | Note |
| --- | --- | --- |
| customer | The ordering customer | Only their own orders (FR-001) |
| admin | Dispatcher/administrator | Any order |
| driver | **The assigned driver only** | Another driver gets 404 `order_not_found`, as for a missing order (T-07) |
| system | The server itself | Payment verification, assignment timeout; event `actor_id` is null |

## Transitions

"Conditions" are checked by the server before the change. The feature named
in the last column records the evidence (pickup record, delivery proof, …);
until it exists, that transition cannot happen.

| # | From | To | Actor | Conditions | Reason code | Built in |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | (none) | `quote_requested` | customer | Valid request, phone verified (FR-003) | | **done** (`POST /orders`) |
| 2 | `quote_requested` | `awaiting_payment` | customer | Accepts a valid server quote, prepaid method | | quotes |
| 3 | `quote_requested` | `awaiting_confirmation` | customer | Accepts a valid quote, pay on delivery, a check needs a dispatcher. Proposed (#10): `POST /orders` with a valid `quote_id` writes row 1 and this row in one transaction ([order-details-and-price.md](order-details-and-price.md#status-at-creation)) | | quotes (#21, proposed) |
| 4 | `quote_requested` | `confirmed` | customer | Accepts a valid quote, pay on delivery, phone verified, source eligible, slot reserved | | quotes |
| 5 | `awaiting_payment` | `confirmed` | system, admin | Payment verified (FR-041), source eligible, slot reserved | | payments |
| 6 | `awaiting_payment` | `awaiting_confirmation` | system, admin | Payment verified, a check needs a dispatcher | | payments |
| 7 | `awaiting_confirmation` | `confirmed` | admin | Phone verified, source eligible (FR-012), slot reserved (FR-025), payment verified if prepaid. Pilot: a delivery window set by the dispatcher instead of a slot, pay on delivery ([order confirmation](#order-confirmation-endpoints)) | | **done** for the pilot (#113); quotes / slots later |
| 8 | `confirmed` | `assigned` | admin | Driver active, capacity, area, availability and handling fit; driver not overcommitted (FR-031) | | S1-07 |
| 9 | `assigned` | `accepted` | driver | none | | S1-07 |
| 10 | `assigned` | `confirmed` | driver, admin, system | Driver declines, dispatcher withdraws, or the offer expires (FR-032) | `driver_declined`, `reassigned`, `assignment_expired` | S1-07 |
| 11 | `accepted` | `confirmed` | admin | Dispatcher takes the job back (the driver cannot un-accept; they call the dispatcher) | `reassigned` | S1-07 |
| 12 | `accepted` | `departed` | driver, admin | | admin: `recorded_for_driver` | driver workflow |
| 13 | `departed` | `collected` | driver, admin | Pickup record: source, time, reference, volume (FR-034) | admin: `recorded_for_driver` | driver workflow |
| 14 | `collected` | `en_route` | driver, admin | | admin: `recorded_for_driver` | driver workflow |
| 15 | `en_route` | `arrived` | driver, admin | | admin: `recorded_for_driver` | driver workflow |
| 16 | `arrived` | `unloading` | driver, admin | | admin: `recorded_for_driver` | driver workflow |
| 17 | `unloading` | `delivered` | driver | Delivered quantity, unloading confirmed, **and** delivery code verified **or** approved alternative proof (FR-035, T-08) | | proof of delivery |
| 18 | `unloading` | `delivered` | admin | Delivered quantity, unloading confirmed, approved alternative proof; the approver is not the delivering driver (BR-13) | | proof of delivery |
| 19 | `arrived` | `failed` | driver | Two contact attempts recorded and the **full** 10 minutes since arrival; never earlier (FR-038) | `customer_unreachable` | driver workflow |
| 20 | `assigned` … `unloading` | `failed` | admin | | `customer_unreachable`, `unsafe_access`, `vehicle_failure`, `source_quality_concern`, `other` | dispatch |
| 21 | `failed` | `confirmed` | admin | Rescheduled; new window acknowledged by the customer, and any redelivery fee for the additional trip disclosed and approved by them first (FR-036, FR-038) | `rescheduled` | dispatch |
| 22 | `quote_requested` … `arrived` | `cancelled` | customer | Cancellation outcome worked out by FR-044 (free, refund, or capped delivery costs) | `customer_request` | cancellation |
| 23 | any except `cancelled`, `delivered`, `disputed` | `cancelled` | admin | | `customer_request`, `mmirioma_unable`, `other` | cancellation |
| 24 | `delivered` | `disputed` | customer, admin | Customer: within 48 hours after delivery. Only safety and suspected-contamination complaints (`water_quality`) are accepted after that, at any time (BR-16) | `missing_quantity`, `water_quality`, `handling`, `other` | disputes |
| 25 | `disputed` | `delivered` | admin | Review resolved; refund or replacement recorded separately (FR-043) | `dispute_resolved` | disputes |
| 26 | `quote_requested` | `awaiting_confirmation` | admin | Manual quote recorded with the customer's agreement (pilot fallback F2); only inside a [confirmation](#order-confirmation-endpoints), in the same transaction as row 7 | `manual_quote` | **done** (#113) |

Notes:

- **Range rows.** Row 20: from `assigned`, `accepted`, `departed`,
  `collected`, `en_route`, `arrived` or `unloading`. Row 22: from
  `quote_requested`, `awaiting_payment`, `awaiting_confirmation`, `confirmed`,
  `assigned`, `accepted`, `departed`, `collected`, `en_route` or `arrived`.
- **Unloading started (FR-044).** A customer cannot cancel from `unloading`;
  their request goes to administrator review, and only an admin cancels
  (row 23) or the delivery completes.
- **Recorded for the driver (rows 12-16).** SRS §8 allows offline notes
  entered later under supervision, so a dispatcher may record a driver's
  step with reason `recorded_for_driver`. An admin can never complete a
  delivery without approved alternative proof (row 18).
- **Partial delivery.** Row 17 or 18 with a delivered quantity below the
  ordered quantity: the order is `delivered`, the delivered quantity is
  stored, and an exception is opened (FR-035, FR-036). The customer can then
  dispute it (row 24).
- **Notes.** Any transition may carry an optional `note` (up to 500
  characters). Reason codes listed for a row are required; `other` also
  requires a note.

## Assignment statuses (built in S1-07)

An assignment links one order to one driver (SRS §5 `assignments`). At most
one assignment per order is live (`offered` or `accepted`); a driver is
never given more live work than their capacity (FR-031).

| Status | Meaning | Order status alongside |
| --- | --- | --- |
| `offered` | Sent to the driver, awaiting their answer | `assigned` |
| `accepted` | The driver accepted | `accepted` … `unloading` |
| `declined` | The driver declined | back to `confirmed` (row 10) |
| `expired` | No answer in time | back to `confirmed` (row 10) |
| `withdrawn` | The dispatcher took the job back, or the order was cancelled | back to `confirmed` (rows 10, 11) or `cancelled` |
| `completed` | The driver's job ended: delivered, or a failed attempt recorded | `delivered` or `failed` |

**No automatic expiry yet** (technical lead, 2026-10-19, open question 1): an
unanswered offer stays `offered` until the driver answers or the dispatcher
withdraws it (row 10, `reassigned`). `expired` and the system part of row 10
are kept for when a timeout is decided.

**Driver eligibility (row 8, FR-031).** A driver can be offered an order when
all of these hold; otherwise 409 `driver_not_eligible` lists every reason in
`details.reasons`:

| Reason | Meaning |
| --- | --- |
| `not_a_driver` | The account is not a driver |
| `inactive` | The account is deactivated (FR-002) |
| `no_driver_profile` | No vehicle has been recorded for the driver |
| `unavailable` | The driver is marked unavailable for new work |
| `vehicle_inactive` | The driver's vehicle profile is inactive |
| `over_payload` | The order's quantity exceeds the vehicle's verified safe payload for one trip (FR-013, BR-03). SRS v0.3 allows up to two trips per vehicle per order; until trip plans exist (quotes), assignment keeps this stricter one-trip check |
| `busy` | The driver already holds an offered or accepted job |

Service area and handling capability (FR-031) are not checked yet: service
zones and transfer methods are not modelled.

## Errors

| Status | Code | When |
| --- | --- | --- |
| 403 | `forbidden` | The actor's role may not make this transition |
| 404 | `order_not_found` | No such order, another customer's order, or a driver who is not assigned to it |
| 409 | `invalid_order_transition` | The order's current status does not allow the requested one. `details: {"from": "...", "to": "..."}` |
| 409 | `transition_requirements_unmet` | A condition is missing. `details: {"missing": ["delivery_code_verified", ...]}` (T-08) |
| 422 | `validation_error` | Missing or wrong reason code for the row, or `other` without a note |
| 404 | `driver_not_found` | Assigning to an account that does not exist |
| 404 | `assignment_not_found` | Withdrawing from an order that has no live assignment |
| 409 | `driver_not_eligible` | Assigning to a driver who cannot take the order; `details.reasons` |

Condition names in `details.missing`: `quote_accepted`, `prepaid`,
`pay_on_delivery`, `dispatcher_check_needed`, `phone_verified`,
`source_eligible`, `slot_reserved`, `payment_verified`, `driver_eligible`,
`pickup_recorded`, `delivered_quantity_recorded`, `unloading_confirmed`,
`delivery_code_verified`, `proof_override_approved`,
`contact_attempts_recorded`, `unreachable_wait_elapsed`,
`reschedule_acknowledged`, `cancellation_outcome_recorded`,
`delivery_day_reached` (driver job part 2), `delivery_window_set` (order
confirmation).

## Event object

Recorded for every transition. Staff read it through
[`GET /admin/orders/{reference}/history`](#get-adminordersreferencehistory),
which adds the actor's name and the assignment (`AdminOrderEvent`); the
customer history (design Q3) comes later.

```json
{
  "from_status": "en_route",
  "to_status": "arrived",
  "actor": { "id": "7d1f4e8a-...", "role": "driver" },
  "reason_code": null,
  "note": null,
  "created_at": "2026-10-19T09:41:00Z"
}
```

Examples: [delivery-event.json](examples/delivery-event.json),
[error-invalid-order-transition.json](examples/error-invalid-order-transition.json),
[error-transition-requirements-unmet.json](examples/error-transition-requirements-unmet.json).

## Driver job endpoints

Status: agreed (G3, S1-06 part 2) on 2026-10-19 by @nnamdi-security
(technical lead), proposed by @Cloudcrackamara from the approved driver design
(driver-deliveries.md, S1-15 #19). Updated
with the technical lead's decisions of 2026-10-19 (PR #50): paths use the
order reference, jobs are `dispatch` assignments, the delivery code keeps
SRS v0.2's 10 minutes. Implemented in `backend/app/modules/deliveries/` (see
[driver-jobs.md](../features/driver-jobs.md)).

The driver app's job list, job detail, decline, pickup record, new delivery
code and incident report, plus the driver job object and the list grouping,
including **jobs for a later day**. Accept, the driver steps (`departed`,
`en_route`, `arrived`, `unloading`), contact attempts and proof are in
[part 2](#driver-job-endpoints-part-2-51) (#51, built in #75).
Status changes go through the state machine above (rows 10 and 13).
Conventions (base path `/api/v1`, formats, error envelope, CSRF) are in the
[README](README.md#conventions-apply-to-every-endpoint).

### Concepts

- **Job.** One [assignment](#assignment-statuses-built-in-s1-07) of an order
  to a driver, named in every path by the **order reference**. A driver holds
  at most one live job (FR-031).
- **Offer.** A job whose assignment is `offered` (order `assigned`). Before
  acceptance the driver does not see the receiver's name or phone (FR-032).
- **Hold.** A reason the driver must not continue that is not an order status:
  dispatcher review of a pickup (FR-034), a stop-work incident (SRS §8), or
  alternative proof waiting for an administrator (FR-035). While a hold is
  open, the server refuses the job's next step with 409 `job_on_hold`. An
  administrator clears holds (the
  [admin hold review endpoints](#admin-hold-review-endpoints), built in #93).
- **Delivery day.** The calendar date in Africa/Lagos of the job's delivery
  window start. "Today" means today's date in Africa/Lagos.

### Access rules

- Every endpoint here requires a signed-in, active `driver` ([auth.md](auth.md)).
  Other roles get 403 `forbidden`.
- `/driver/jobs/{reference}` and its actions are open only to the driver on
  the order's **live** (`offered` or `accepted`) assignment. Anyone else gets
  404 `order_not_found`, the same as a missing order (T-07). That includes
  the driver after the job was declined, withdrawn (reassigned), expired or
  completed: a reassigned job simply stops being theirs.
- `POST` requests need the `X-CSRF-Token` header (403 `csrf_failed`).
- Every status change writes an `order_events` row (NFR-004).

### Driver job object

`DriverJobSummary` (list items):

```json
{
  "order_reference": "MO-7KQ2M9XH4T",
  "section": "upcoming",
  "job_status": "accepted",
  "order_status": "accepted",
  "delivery_window_start_at": "2026-10-22T08:00:00Z",
  "delivery_window_end_at": "2026-10-22T11:00:00Z",
  "delivery_area": "12 Sample Close, Independence Layout, Enugu",
  "quantity_litres": 1200,
  "source_name": "Sample Borehole A",
  "offered_at": "2026-10-19T08:55:00Z",
  "hold": null,
  "delivered_litres": null,
  "ended_at": null,
  "end_reason": null,
  "is_simulated": true
}
```

`DriverJobDetail` (detail) adds:

```json
{
  "receiver": { "display_name": "Ngozi A.", "phone": "+2348000000001" },
  "delivery_address": "12 Sample Close, Independence Layout, Enugu",
  "landmark": "Opposite the blue gate",
  "delivery_instructions": "Narrow gate. Tank is behind the house.",
  "source": { "id": "1d2c...", "name": "Sample Borehole A", "approximate_location": "Near the market gate, Trans-Ekulu" },
  "pickup": null,
  "arrived_at": null,
  "contact_attempts": [],
  "delivery_code": null,
  "allowed_actions": ["start_job", "report_incident"]
}
```

| Field | Rule |
| --- | --- |
| `order_reference` | Identifies the job in every driver job path |
| `section` | `offer`, `today`, `upcoming` or `done`; computed by the server (see [Job list](#get-driverjobs)) |
| `job_status` | `offered`, `accepted` or `completed`. `completed` also covers an `accepted` assignment whose order is `delivered`, `disputed`, `failed` or `cancelled`: `failed` can be rescheduled (row 21) but that is a new assignment |
| `order_status` | The order status (see [Statuses](#statuses)). The client maps it to the driver badge from the design's driver status wording table |
| `delivery_window_start_at`, `delivery_window_end_at` | UTC. The confirmed window, stored on the order until delivery slots exist (FR-025, SRS §12.2). Never the customer's preferred date |
| `delivery_area` | First line of the delivery address, up to 120 characters |
| `quantity_litres` | Ordered litres (integer) |
| `offered_at` | When the dispatcher assigned the job to this driver |
| `hold` | `null` or `{ "kind": "source_review" \| "unsafe_stop" \| "proof_review", "since": "<UTC>", "message": "<server text>" }` |
| `delivered_litres`, `ended_at`, `end_reason` | Set once the job ends. `end_reason` is the reason code of a failure or cancellation, e.g. `customer_unreachable`. `delivered_litres` is set from the code-verified delivery proof ([part 2](#post-driverjobsreferenceproof)) |
| `receiver` | Only while the job is `accepted`: first name and last initial, and the phone in E.164 for the call button. `null` for an offer (FR-032). Never the customer's account details, order history or payment |
| `delivery_instructions` | Shown on the offer too: the design's "access notes" come from it |
| `pickup` | `null`, or the recorded pickup: `source_id` (null for another source), `other_source_name`, `source_reference`, `volume_collected_litres`, `picked_up_at`, `safety_concern` |
| `contact_attempts` | List of `{ "attempted_at": "<UTC>" }`, oldest first (FR-038). Recorded by [`POST .../contact-attempts`](#post-driverjobsreferencecontact-attempts) |
| `delivery_code` | Only while `accepted`, and `null` before a code exists. Then `{ "issued_at", "expires_at", "attempts_left", "sms_status": "accepted" \| "failed" }`. **Never contains the code** |
| `allowed_actions` | What the driver may do now, so the client shows one primary action: any of `accept`, `decline`, `start_job`, `record_pickup`, `leave_for_customer`, `arrive`, `record_contact_attempt`, `start_unloading`, `submit_proof`, `request_new_code`, `report_incident`. Part 2 adds `complete_unloading` and `record_failed_attempt`. The server still validates every request |
| `is_simulated` | `true` for demo data (BR-09) |

### Endpoints

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/driver/jobs` | none | 200 `DriverJobList` | shared only |
| GET | `/driver/jobs/{reference}` | none | 200 `DriverJobDetail` | 404 `order_not_found` |
| POST | `/driver/jobs/{reference}/decline` | `DeclineRequest` | 204 | 404 `order_not_found`, 403 `forbidden` (already accepted), 422 `validation_error` |
| POST | `/driver/jobs/{reference}/pickup` | `PickupRequest` | 201 `DriverJobDetail` | 404 `order_not_found`, 409 `pickup_already_recorded`, 409 `job_on_hold`, 409 `invalid_order_transition`, 422 `validation_error` |
| POST | `/driver/jobs/{reference}/delivery-code` | none | 201 `DriverJobDetail` | 404 `order_not_found`, 409 `invalid_order_transition`, 409 `delivery_code_still_valid`, 429 `rate_limited` |
| POST | `/driver/jobs/{reference}/incidents` | `IncidentRequest` | 201 `IncidentRead` | 404 `order_not_found`, 409 `job_not_active`, 422 `validation_error` |

All endpoints also return the shared 401, 403 and 422 errors from the
[README](README.md#errors).

#### GET /driver/jobs

The signed-in driver's jobs, grouped for the "My jobs" screen (J1). No
pagination: a driver has one live job and a few finished ones a day.

```json
{
  "offers": [],
  "today": [],
  "upcoming": [],
  "done": [],
  "generated_at": "2026-10-19T09:05:00Z"
}
```

Each list holds `DriverJobSummary` objects. Grouping (computed by the server
in Africa/Lagos, so every client agrees):

| Group | Jobs | Order |
| --- | --- | --- |
| `offers` | `offered`, any delivery day | Window start, earliest first |
| `today` | `accepted`, not ended, delivery day today **or earlier** (an overdue job stays visible) or no window yet | Window start, earliest first |
| `upcoming` | `accepted`, not ended, delivery day **after today**: the provision for jobs accepted for a later day | Window start, earliest first |
| `done` | `completed` jobs that ended today | Ended time, newest first |

A job moves from `upcoming` to `today` at midnight Africa/Lagos on its
delivery day; the client sees this on its next fetch. `start_job` is offered
only from the delivery day ([Decision 3](#driver-job-decisions)). Declined,
withdrawn and expired jobs are not listed. A `done` job is summary only:
opening it returns 404 ([Access rules](#access-rules)). Example:
[driver-jobs.json](examples/driver-jobs.json).

#### GET /driver/jobs/{reference}

The live job as `DriverJobDetail` (J2 offer detail, A1 active job). Example:
[driver-job-detail.json](examples/driver-job-detail.json).

#### POST /driver/jobs/{reference}/decline

The driver declines an offer (FR-032, row 10). `DeclineRequest`:

```json
{ "reason": "other", "note": "Vehicle is at the mechanic" }
```

| Field | Rule |
| --- | --- |
| `reason` | One of `not_available`, `vehicle_cannot_carry`, `too_far`, `unsafe_access`, `other` (design J2-b) |
| `note` | Optional, trimmed, up to 300 characters; **required** when `reason` is `other` |

Effect: the assignment becomes `declined` with the reason and note stored on
it; the order returns `assigned` → `confirmed` (reason code
`driver_declined`, event note the driver's note or `null`) and goes back
to the dispatcher. The reason is read from the assignment
([admin dispatch decision 3](#admin-dispatch-decisions); events written
before that change have the note `<reason>` or `<reason>: <note>`). The customer is not told anything. Returns 204.

An offer that is gone (declined, withdrawn, or never this driver's) is 404
`order_not_found`, which the app shows as "This offer is no longer
available" (J2-f). An accepted job is 403 `forbidden`: only the dispatcher
can take it back (row 11).

#### POST /driver/jobs/{reference}/pickup

Records the water collected at the source (FR-034, row 13). Allowed only when
the job is accepted and the order is `departed`. `PickupRequest`:

```json
{
  "source": { "assigned": true },
  "source_reference": "RCPT-0042",
  "volume_collected_litres": 1000,
  "picked_up_at": "2026-10-19T08:20:00Z",
  "safety_concern": false,
  "safety_note": null
}
```

| Field | Rule |
| --- | --- |
| `source` | Either `{ "assigned": true }` or `{ "assigned": false, "name": "<other source>" }` (name trimmed, 1–120 characters) |
| `source_reference` | Optional, trimmed, up to 100 characters (receipt or batch number) |
| `volume_collected_litres` | Integer, 1 or more. Checked against the vehicle's verified payload later ([Decision 5](#driver-job-decisions)) |
| `picked_up_at` | Aware timestamp, not in the future and not before the job started (`departed`); 2 minutes' clock tolerance |
| `safety_concern` | Boolean |
| `safety_note` | Optional, up to 500 characters; required when `safety_concern` is true |

Effect, in one transaction: a `pickup_records` row and `departed` →
`collected`, because the water was collected. Then:

- If the source is not the assigned one, or `safety_concern` is true, the job
  gets hold `source_review` and an exception is opened for the dispatcher
  (FR-034, FR-036). The next step is refused with 409 `job_on_hold` until an
  administrator clears the hold.
- If `volume_collected_litres` is below the ordered quantity, an exception is
  opened (partial delivery, SRS §8). No hold.

Returns 201 with the updated `DriverJobDetail`. A second pickup for the same
job is 409 `pickup_already_recorded`; corrections are made by the dispatcher.
"Assigned source" on an order with no source is 422 `validation_error`.

#### POST /driver/jobs/{reference}/delivery-code

Issues a new delivery code and sends it to the customer by SMS (FR-035).
Allowed only when the job is accepted and the order is `arrived` or
`unloading`. No body.

**Decided 2026-10-19 (#67, SRS FR-035):** a delivery code is issued only
**after unloading**, once the driver records that unloading is complete.
Part 2 (#51, built in #75) narrowed this endpoint to "after unloading
complete"; see [Changes to part 1](#changes-to-part-1).

- The new code invalidates any previous code for the order.
- Valid **10 minutes** from issue (SRS FR-035; final, team decision
  2026-10-19). At most 5 verification attempts, single use, stored
  hashed. The response never contains the code.
- Allowed when the current code has expired, its 5 attempts are used up, or
  its SMS failed (`sms_status` `failed`). Otherwise 409
  `delivery_code_still_valid`.
- At most one new code per job per 60 seconds: 429 `rate_limited` with
  `details.retry_after_seconds` and a `Retry-After` header (NFR-002). The
  cooldown counts from the newest code, whoever issued it.
- If the SMS provider refuses the message, the code is still recorded with
  `delivery_code.sms_status` `failed`; the app says the code was not sent
  (FR-050: no false "sent" claim), and the driver may request another after
  the cooldown.

Returns 201 with the updated `DriverJobDetail`.

#### POST /driver/jobs/{reference}/incidents

The driver reports a problem (FR-036). It creates an exception record for the
dispatcher; it does **not** change the order status. Allowed while the job is
accepted and the order is between `accepted` and `unloading`; otherwise 409
`job_not_active`. `IncidentRequest`:

```json
{
  "type": "running_late",
  "note": "Traffic on the expressway",
  "new_estimated_arrival_at": "2026-10-19T11:30:00Z"
}
```

| Field | Rule |
| --- | --- |
| `type` | One of `running_late`, `unsafe_access`, `unsafe_transfer`, `volume_issue`, `source_concern`, `vehicle_problem`, `other` (design A6). Customer unreachable is **not** an incident type: it uses contact attempts and row 19 (#51) |
| `note` | Optional, trimmed, up to 500 characters; **required** for `other` |
| `new_estimated_arrival_at` | Optional aware timestamp, only for `running_late`, not in the past. It never changes the customer's window: the dispatcher agrees a new window with the customer (FR-036) |

Effect:

- Writes an `order_exceptions` row with category, note, actor (the driver)
  and time.
- `unsafe_access` and `unsafe_transfer` also set hold `unsafe_stop` (SRS §8
  "Driver reports unsafe transfer: stop work").
- `source_concern` is flagged for administrator review (FR-036).

`IncidentRead`:

```json
{
  "id": "5e7a...",
  "order_reference": "MO-7KQ2M9XH4T",
  "type": "running_late",
  "note": "Traffic on the expressway",
  "new_estimated_arrival_at": "2026-10-19T11:30:00Z",
  "created_at": "2026-10-19T10:30:00Z",
  "hold": null
}
```

`hold` is the job's hold after the report (`unsafe_stop` for unsafe types).

### Error codes added by this section

| Status | `code` | When |
| --- | --- | --- |
| 409 | `job_on_hold` | A step while a hold is open |
| 409 | `job_not_active` | Incident on a job that is not accepted or has ended |
| 409 | `pickup_already_recorded` | Second pickup for a job |
| 409 | `delivery_code_still_valid` | New code requested while the current one is usable and was sent |
| 429 | `rate_limited` | New code requested too soon (`details.retry_after_seconds`) |

`order_not_found`, `forbidden`, `invalid_order_transition` and
`validation_error` are as in [Errors](#errors).

### Data added with this section

Migration `0007`: `water_sources` (name and approximate location only, FR-011
in part); `orders.source_id` and `orders.delivery_window_start_at`/`end_at`;
`assignments.decline_reason` and `decline_note`; `pickup_records`,
`delivery_codes` and `order_exceptions`.

### Driver job decisions

Confirmed by the technical lead (2026-10-19):

1. **New code rate limit:** one new code per job per 60 seconds.
2. **New code after 5 wrong tries:** allowed; the attempt limit is per code.
3. **Upcoming jobs:** `start_job` only from the delivery day (Africa/Lagos).
4. **Who clears holds:** an administrator, through the
   [admin hold review endpoints](#admin-hold-review-endpoints) (agreed, #88; built in #93).
5. **Payload check:** `volume_collected_litres` is checked against the vehicle
   payload later (FR-013); not yet.
6. **Delivery window on the order** until delivery slots exist (SRS §12.2).
7. **Paths use the order reference**; only the live assignment's driver may
   open a job.
8. **Delivery code timing** (decided 2026-10-19, #67): the code is issued
   after unloading, once the driver records unloading complete; it lasts
   10 minutes (final, team decision 2026-10-19). Built in #75 with the
   unloading-complete step.
9. **Clock tolerance** (implementation detail, not a business rule):
   `picked_up_at` and `new_estimated_arrival_at` may be up to 2 minutes off
   the server's clock, because phone clocks drift.

## Driver job endpoints, part 2 (#51)

Status: **agreed** (G3) on 2026-10-20 by @nnamdi-security (technical lead)
and @chidimmamogbo (PR #74). Drafted 2026-10-19; checked against every element
of the approved driver design by @Bonvee120 (owner, #51) on 2026-10-20 (see
[Design check](#design-check-51)). Built in #75 (see
[driver-jobs.md](../features/driver-jobs.md)). Derived from the approved
driver design (G2) and SRS v0.3 (FR-035
amended by #67). The services for accept exist
(`dispatch.service.accept_assignment`); everything else here is new.

The driver's remaining steps: accept an offer (row 9), the job steps
(rows 12, 14, 16), arrival (row 15), customer unreachable (row 19),
unloading complete (which issues the delivery code, #67) and proof of
delivery (row 17). Conventions, [access rules](#access-rules), the
[driver job object](#driver-job-object) and holds are as in part 1: only the
driver on the order's live assignment may act, anyone else gets 404
`order_not_found` (T-07); `POST` needs `X-CSRF-Token`.

### Job flow

```
offered ──accept──> accepted ──transition departed──> departed (customer SMS "dispatched", FR-050)
  ──pickup (part 1)──> collected ──transition en_route──> en_route ──arrive──> arrived
  ├─ customer present ──transition unloading──> unloading
  │     ──unloading-complete──> delivery code sent (#67) ──proof──> delivered
  │                          └─ customer cannot give the code ──proof (alternative)──> hold proof_review
  └─ customer unreachable ──contact-attempts ×2, full 10 minutes──> transition failed
```

### Changes to part 1

| Item | Change |
| --- | --- |
| `allowed_actions` | Adds `complete_unloading` (after `start_unloading`, before `submit_proof`) and `record_failed_attempt` (offered only while `arrived` with two contact attempts recorded **and** `unreachable_allowed_at` passed, so A4's button stays off until then, FR-038). `submit_proof` is offered only once a code was issued, or for alternative proof. `request_new_code` is offered only when a new code would be accepted (code expired, attempts used up, or SMS failed) |
| `allowed_actions` timing | Computed when the response is built. Two actions become available by time alone, so the client fetches the job again when `unreachable_allowed_at` or `delivery_code.expires_at` passes |
| `DriverJobDetail` | Adds `unloading_completed_at` (UTC or `null`) and `unreachable_allowed_at` (UTC or `null`: `arrived_at` + 10 minutes once arrived; the A4 "wait until" time) |
| Condition names | Adds `delivery_day_reached` for `start_job` before the job's delivery day (part 1 Decision 3) |
| `POST /driver/jobs/{reference}/delivery-code` | Narrowed to orders in `unloading` **with** `unloading_completed_at` set (#67). Before that: 409 `transition_requirements_unmet`, `details.missing: ["unloading_confirmed"]` |
| `driver-job-detail.json` | The arrived example has no delivery code (it is issued after unloading) |

### Endpoints

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| POST | `/driver/jobs/{reference}/accept` | none | 200 `DriverJobDetail` | 404 `order_not_found` |
| POST | `/driver/jobs/{reference}/transition` | `TransitionRequest` | 200 `DriverJobDetail`; 200 `DriverJobSummary` (done) for `failed` | 404 `order_not_found`, 409 `invalid_order_transition`, 409 `job_on_hold`, 409 `transition_requirements_unmet`, 422 `validation_error` |
| POST | `/driver/jobs/{reference}/arrive` | `ArriveRequest` | 200 `DriverJobDetail` | 404 `order_not_found`, 409 `invalid_order_transition`, 409 `job_on_hold`, 422 `validation_error` |
| POST | `/driver/jobs/{reference}/contact-attempts` | none | 201 `DriverJobDetail` | 404 `order_not_found`, 409 `invalid_order_transition` |
| POST | `/driver/jobs/{reference}/unloading-complete` | none | 201 `DriverJobDetail` | 404 `order_not_found`, 409 `invalid_order_transition`, 409 `job_on_hold` |
| POST | `/driver/jobs/{reference}/proof` | `ProofRequest` | 200 `DriverJobSummary` (done) or 202 `DriverJobDetail` (alternative proof, on hold) | 404 `order_not_found`, 400 `delivery_code_invalid`, 400 `delivery_code_expired`, 409 `transition_requirements_unmet`, 409 `job_on_hold`, 422 `validation_error` |

All endpoints also return the shared 401, 403 and 422 errors from the
[README](README.md#errors).

#### POST /driver/jobs/{reference}/accept

The offered driver accepts (row 9, FR-032). No body. The order becomes
`accepted`; only now does `receiver` appear in the detail. Accepting twice
returns 200 with the job unchanged and no second event. An offer that is gone
(declined, withdrawn, or never this driver's) is 404 `order_not_found`, shown
as "This offer is no longer available" (J2-f).

#### POST /driver/jobs/{reference}/transition

The driver's plain steps (A1, A4). `TransitionRequest`:

```json
{ "to": "departed", "note": null }
```

| `to` | From | Row | Conditions |
| --- | --- | --- | --- |
| `departed` | `accepted` | 12 | Only from the delivery day (part 1 Decision 3); earlier: 409 `transition_requirements_unmet`, `details.missing: ["delivery_day_reached"]`. Effect: the customer's "dispatched" SMS (FR-050); an SMS failure never blocks or undoes the step |
| `en_route` | `collected` | 14 | |
| `unloading` | `arrived` | 16 | |
| `failed` | `arrived` | 19 | Two contact attempts recorded **and** the full 10 minutes since arrival (FR-038, #55). Reason `customer_unreachable` is set by the server. Otherwise 409 `transition_requirements_unmet`, `details.missing`: `contact_attempts_recorded` and/or `unreachable_wait_elapsed`. Effect: the assignment becomes `completed` and the job ends, so the response is the job as a `done` `DriverJobSummary` (A7 "Delivery failed") |

- `note`: optional, trimmed, up to 500 characters; saved as the event's note.
- `collected` (use [pickup](#post-driverjobsreferencepickup)), `arrived` (use
  arrive) and `delivered` (use proof) are refused with 422
  `validation_error`.
- Any step while a hold is open: 409 `job_on_hold`. From the wrong status:
  409 `invalid_order_transition`.
- Repeating the step just made returns 200 unchanged (harmless repeats).
  This includes `failed`: see [Repeats after the job ends](#repeats-after-the-job-ends).
- Already-loaded vehicles cannot skip `collected`: nothing supports that yet
  (open question 3, decided 2026-10-19).

#### POST /driver/jobs/{reference}/arrive

The driver records arrival (row 15, A3). `ArriveRequest`:

```json
{ "location": { "latitude": 6.4527, "longitude": 7.5103, "accuracy_metres": 15 }, "location_consent": true }
```

| Field | Rule |
| --- | --- |
| `location` | Optional (FR-035): latitude −90 to 90, longitude −180 to 180 (WGS 84, SRID 4326), `accuracy_metres` optional, 0 or more |
| `location_consent` | Required `true` when `location` is sent: the driver agreed to the consent text first (FR-035). Without `location`, omit it or send `false` |

Effect: `en_route` → `arrived`; `arrived_at` (server time) and
`unreachable_allowed_at` are set. **No delivery code is issued** (#67).
Repeating returns 200 unchanged.

#### POST /driver/jobs/{reference}/contact-attempts

Records one attempt to reach the customer (A4, FR-038). No body; the server
records the time. Allowed only while `arrived`. Returns 201 with
`contact_attempts` (oldest first). The failed step needs at least two.

#### POST /driver/jobs/{reference}/unloading-complete

The driver records that unloading is complete (A5, #67). No body. Allowed
only while `unloading`. Effect, in one transaction: `unloading_completed_at`
is set and a delivery code is issued and sent to the customer by SMS
(FR-035: 6 digits, valid 10 minutes; 5 attempts; stored
hashed). Returns 201 with `delivery_code` (never the code itself). Repeating
returns 200 unchanged; a fresh code uses
[`POST .../delivery-code`](#post-driverjobsreferencedelivery-code). The
order status stays `unloading`: unloading complete is a recorded step, not a
status (FR-033 is unchanged).

#### POST /driver/jobs/{reference}/proof

Completes the delivery (row 17, A5) or asks for alternative proof (A5-j).
`ProofRequest`:

```json
{
  "delivered_litres": 1000,
  "unloading_confirmed": true,
  "delivery_code": "482913",
  "alternative_proof": null,
  "location": null,
  "location_consent": false
}
```

| Field | Rule |
| --- | --- |
| `delivered_litres` | Integer, 1 or more (FR-035) |
| `unloading_confirmed` | Must be `true` |
| `delivery_code` | 6 digits. Exactly one of `delivery_code` and `alternative_proof` |
| `alternative_proof` | `{ "reason": "customer_cannot_receive_code" \| "other", "note": "<up to 500>" }` (note required for `other`) |
| `location`, `location_consent` | As in arrive (optional, consent first) |

With a code, in one transaction: the code is checked, a delivery proof is
recorded (delivered litres, server time, unloading confirmation, location if
consented), the order becomes `delivered`, and the assignment `completed`.
Returns 200 with the job as a `done` `DriverJobSummary`; the job no longer
opens. Fewer litres than ordered still delivers and opens an exception
(partial delivery, FR-036).

| Case | Response |
| --- | --- |
| No code issued yet (unloading not recorded complete) | 409 `transition_requirements_unmet`, `details.missing: ["unloading_confirmed"]` |
| Wrong code | 400 `delivery_code_invalid`, `details: {"attempts_remaining": n}`; at 0 the code is void |
| Expired, replaced, used up or already used | 400 `delivery_code_expired`; the driver sends a new code |
| Hold open | 409 `job_on_hold` |

A5's code states come from these responses and `delivery_code`: "wrong code"
is `delivery_code_invalid` with `attempts_remaining` above 0; "no tries left"
is `attempts_remaining` 0 (and afterwards `delivery_code.attempts_left` 0);
"code expired" is `delivery_code_expired` or `delivery_code.expires_at` in
the past. Both of the last two offer "Send new code".

#### Repeats after the job ends

Proof (with a code) and the `failed` step end the job, and an ended job
normally returns 404 `order_not_found`. A driver whose phone lost the
response would then retry, get 404 and see "Reassigned" (A7-d) for a job
they actually finished. So: when the **same driver** repeats the request
that ended their job, and the job is still in their `done` list (it ended
today, Africa/Lagos), the server returns 200 with the `done`
`DriverJobSummary`, records nothing new and does not check the code again.
Any other request on the ended job is 404 as in part 1. If the same order
has a new live assignment for the same driver (for example a failed delivery
rescheduled and offered to them again the same day), the live job takes
precedence: requests are handled as on that job, never as repeats of the
ended one.

With `alternative_proof`: the proof entries are recorded, the job gets hold
`proof_review` and an exception is opened for an administrator, and the
order stays `unloading`. Returns 202 with the job. An authorized
administrator approves with evidence (row 18, BR-13; admin endpoint planned);
the driver can never approve their own.

### Driver badge labels

Client-side wording only; the API sends `order_status`, `job_status` and
`hold`. Taken from the approved design's driver status wording table
(answers the design's open question 1):

| Shown when | Driver badge |
| --- | --- |
| `job_status` `offered` (order `assigned`) | New offer |
| order `accepted` | Accepted |
| order `departed` | Started |
| order `collected` | Water collected |
| order `en_route` | On the way |
| order `arrived` | Arrived |
| order `unloading` | Unloading |
| order `delivered` | Delivered |
| order `failed` | Delivery failed |
| order `cancelled` | Cancelled |
| order `disputed` | Under review |
| `hold` `source_review` or `unsafe_stop` | Paused (shown instead of the status badge) |
| `hold` `proof_review` | Waiting for proof approval |
| A job the app had open now returns 404 | Reassigned |

Holds and "Reassigned" are not order statuses (FR-033 is unchanged); this
answers the design's open question 2.

### Design check (#51)

Every element of the approved driver design
that uses the server, mapped to this contract (2026-10-20). Build next: J1,
J2 and the status wording. A1-A8 are design ahead; A3, A4 and A5 must change
before they are built (design decisions 9 and open question 7), and the
mapping below already follows those changes.

| Screen | Element / state | Contract |
| --- | --- | --- |
| J1 | Groups New offers, Today, Upcoming, Done; card fields; badges | Part 1 `GET /driver/jobs`, `DriverJobSummary`; [badge labels](#driver-badge-labels) |
| J1 | Loading, empty, could not load, offline | Client states; `GET /driver/jobs` and shared errors |
| J2 | Offer detail (no receiver) | Part 1 `GET /driver/jobs/{reference}`, `receiver: null`; [driver-job-offer.json](examples/driver-job-offer.json) |
| J2 | Accept; "Job accepted", job moves to Today or Upcoming | `POST .../accept` → 200 `DriverJobDetail` with `section` and `receiver`; [driver-job-accepted.json](examples/driver-job-accepted.json) |
| J2 | Decline with reason; Other note error | Part 1 `POST .../decline`, 422 `validation_error` |
| J2 | Accepting/declining locked; not sent (Retry) | Client states; accept and decline are safe to repeat |
| J2-f | No longer available | 404 `order_not_found` on accept or decline |
| A1 | Start job (only from the delivery day), Leave for customer, Start unloading | `POST .../transition` `departed`, `en_route`, `unloading`; 409 `transition_requirements_unmet` `delivery_day_reached`; [driver-transition-request.json](examples/driver-transition-request.json) |
| A1 | Receiver, Call receiver | Part 1 `receiver` |
| A2 | Save pickup; less than ordered; paused for review | Part 1 `POST .../pickup`; `hold` `source_review` |
| A3 | I've arrived; location consent | `POST .../arrive` with optional `location` and `location_consent`; no code at arrival (#67); [driver-arrive-request.json](examples/driver-arrive-request.json) |
| A4 | Record contact attempt; wait-until time | `POST .../contact-attempts`; `contact_attempts`, `unreachable_allowed_at` |
| A4 | Record failed attempt (off until two attempts and 10 minutes) | `allowed_actions` `record_failed_attempt`; `POST .../transition` `failed`; 409 `transition_requirements_unmet`; [driver-job-unreachable.json](examples/driver-job-unreachable.json), [error-unreachable-wait.json](examples/error-unreachable-wait.json) |
| A5 | Unloading complete (sends the code) | `POST .../unloading-complete`; `delivery_code`, `unloading_completed_at`; [driver-job-unloading-complete.json](examples/driver-job-unloading-complete.json) |
| A5 | Mark as delivered; missing entries; less than ordered | `POST .../proof`; 422 `validation_error`; partial delivery opens an exception; [driver-proof-request.json](examples/driver-proof-request.json) |
| A5 | Wrong code (tries left), no tries left, code expired | 400 `delivery_code_invalid` with `attempts_remaining`, 400 `delivery_code_expired`, `delivery_code.attempts_left`/`expires_at`; [error-delivery-code-invalid.json](examples/error-delivery-code-invalid.json), [error-delivery-code-expired.json](examples/error-delivery-code-expired.json) |
| A5 | Send new code | Part 1 `POST .../delivery-code`, narrowed as above |
| A5 | Sending; not sent (entries kept) | Client states; [repeats after the job ends](#repeats-after-the-job-ends) |
| A5 | Delivery recorded | 200 `done` `DriverJobSummary` |
| A5-j | Customer can't get the code | `POST .../proof` with `alternative_proof` → 202, `hold` `proof_review`; [driver-proof-alternative-request.json](examples/driver-proof-alternative-request.json) |
| A6 | Report a problem; stop work | Part 1 `POST .../incidents`; `hold` `unsafe_stop` |
| A7 | Delivered, waiting for proof approval, paused, cancelled, delivery failed | `order_status`, `hold`, `end_reason`, `delivered_litres`, `ended_at` |
| A7-d | Reassigned | 404 `order_not_found` on a job the app had open |
| A8 | Offline, Waiting to send | Client only; nothing is shown as done until the server answers |

Not mapped, on purpose: cash collection (design decision 2: needs its own
design) and what happens to collected water after a failed attempt (design
open question 8: the SRS does not say).

### Error codes added by this section

| Status | `code` | When |
| --- | --- | --- |
| 400 | `delivery_code_invalid` | Wrong delivery code; `details.attempts_remaining` |
| 400 | `delivery_code_expired` | No usable code: expired, replaced, attempts used up or already used |

`transition_requirements_unmet` uses the existing condition names
(`contact_attempts_recorded`, `unreachable_wait_elapsed`,
`unloading_confirmed`) and the new `delivery_day_reached`.

### Data needed

- `delivery_attempts` (SRS §5): `arrived_at`, arrival location and consent,
  `unloading_completed_at`, outcome, `within_window`.
- `contact_attempts`: attempt times per delivery attempt.
- `delivery_proofs` (SRS §5): delivered litres, unloading confirmation,
  acknowledgement (code or alternative proof request), completion location
  and consent, time.
- The existing `delivery_codes`, `order_exceptions` and holds are reused.

### Open questions for the reviewers

1. **Upper bound for `delivered_litres`:** the ordered quantity, the volume
   collected, or none? The SRS does not say.
2. ~~**Limit on contact attempts:** record every tap, or stop at two?~~
   **Decided** (2026-10-29, @nnamdi-security, on #250): record every attempt,
   with no maximum. The failed step needs at least two; the app does not stop
   at two (design [driver-arrival-unreachable.md](../design/driver-arrival-unreachable.md),
   decision 5).
3. **Alternative proof reasons:** are `customer_cannot_receive_code` and
   `other` enough for A5-j?
4. **Rejected alternative proof:** what the driver may do next (send a new
   code, or the dispatcher decides). Comes with the admin proof-override
   endpoint.

## Admin dispatch endpoints

Status: **agreed** (G3) on 2026-10-19 by @nnamdi-security (technical lead)
and @chidimmamogbo (orders backend; PR #59 review). Derived from the
approved admin dispatch design (#53, G2).
Implemented in `backend/app/modules/dispatch/` (#61; see
[admin-dispatch.md](../features/admin-dispatch.md)); since #93 the detail,
withdraw and history routes are served by `deliveries/admin_router.py`, with
the same paths and shapes.

The dispatcher's side of rows 8, 10 and 11: the driver list for an order
(D1), offering an order (D1), the order's assignment on the detail page
(D2-D4), withdrawing (D5) and the order history (H1). The design-ahead
dispatcher actions (A1-A8) are not here; they use the planned
`POST /admin/orders/{reference}/transition` and are agreed when built.
Conventions (base path `/api/v1`, formats, error envelope, CSRF) are in the
[README](README.md#conventions-apply-to-every-endpoint).

### Access rules

- Every endpoint here requires a signed-in, active `admin`
  ([auth.md](auth.md)). Customers and drivers get 403 `forbidden`.
- Paths use the order reference. An unknown reference is 404
  `order_not_found`.
- `POST` requests need the `X-CSRF-Token` header (403 `csrf_failed`).
- Every status change writes an `order_events` row (NFR-004).

### Objects

`AdminAssignment`, one offer of the order to one driver:

```json
{
  "id": "6a0c2f4e-1b3d-4e5f-8a9b-0c1d2e3f4a5b",
  "status": "offered",
  "driver": { "id": "7d1f4e8a-b6c9-4a1b-9c3d-4e5f0b8f1c5e", "name": "Sample Driver One" },
  "vehicle": { "type": "Tanker truck", "safe_payload_litres": 3000 },
  "offered_by": { "id": "0b8f1c5e-2a3b-4c5d-9e6f-7a8b9c0d1e2f", "name": "Sample Dispatcher" },
  "offered_at": "2026-10-19T09:05:00Z",
  "responded_at": null,
  "ended_at": null,
  "decline_reason": null,
  "decline_note": null
}
```

| Field | Rule |
| --- | --- |
| `status` | An [assignment status](#assignment-statuses-built-in-s1-07): `offered`, `accepted`, `declined`, `expired`, `withdrawn` or `completed` |
| `driver` | The driver's account id and name |
| `vehicle` | The driver's **current** vehicle (`type`, `safe_payload_litres`), or `null` if none is recorded. Not a snapshot taken at the offer |
| `offered_by` | The dispatcher who made the offer |
| `offered_at` | When the offer was made (UTC). The client shows "Offered 25 minutes ago" from it, never a countdown (no automatic expiry) |
| `responded_at` | When the driver accepted or declined; `null` before. With `status` `accepted` it is the accepted time (D4); with `declined`, the declined time (D3) |
| `ended_at` | When it stopped being live (declined, withdrawn, completed) |
| `decline_reason` | Only for `declined`: `not_available`, `vehicle_cannot_carry`, `too_far`, `unsafe_access` or `other` (see [decline](#post-driverjobsreferencedecline)). Otherwise `null` |
| `decline_note` | The driver's own words with a decline, up to 300 characters, or `null` |

`AdminOrderDetail`, returned by `GET /admin/orders/{reference}` and by
assign and withdraw: the [orders contract's](orders.md#order-object)
`AdminOrderRead` plus one field:

```json
{ "assignment": { "...": "AdminAssignment" } }
```

`assignment` is the order's **most recent** assignment, live or ended, or
`null` if it was never offered. The admin list (`GET /admin/orders`) keeps
returning `AdminOrderRead` without it. How the detail page uses it:

| Order status | `assignment.status` | Design |
| --- | --- | --- |
| `confirmed` | `null` assignment, `withdrawn` or `expired` | "No driver yet", Assign driver |
| `confirmed` | `declined` | D3 banner: driver, `responded_at`, `decline_reason`, `decline_note`; Assign another driver |
| `assigned` | `offered` | D2: "Offered to <driver>", Withdraw offer |
| `accepted` | `accepted` | D4: "Accepted by <driver>", Withdraw job |
| `departed` … `unloading` | `accepted` | D4 without withdraw, with the one-line reason |

`DispatchDriver`, one row of the D1 list:

```json
{
  "id": "7d1f4e8a-b6c9-4a1b-9c3d-4e5f0b8f1c5e",
  "name": "Sample Driver One",
  "vehicle": { "type": "Tanker truck", "safe_payload_litres": 3000 },
  "reasons": []
}
```

`reasons` lists every [eligibility](#assignment-statuses-built-in-s1-07)
problem for **this order**, in the fixed order `eligibility_problems`
returns; empty means the driver can be offered it. `vehicle` is `null` when
the driver has no profile (`no_driver_profile`). The client builds the
`over_payload` label from the order's `quantity_litres` and
`vehicle.safe_payload_litres`.

`AdminOrderEvent`, one history entry (H1). The [event object](#event-object)
plus the actor's name and, for assignment events, the driver:

```json
{
  "id": "2f3e4d5c-6b7a-4980-a1b2-c3d4e5f6a7b8",
  "from_status": "assigned",
  "to_status": "confirmed",
  "actor": { "id": "0b8f1c5e-2a3b-4c5d-9e6f-7a8b9c0d1e2f", "role": "admin", "name": "Sample Dispatcher" },
  "reason_code": "reassigned",
  "note": "No answer after 25 minutes.",
  "created_at": "2026-10-19T09:31:00Z",
  "assignment": {
    "id": "6a0c2f4e-1b3d-4e5f-8a9b-0c1d2e3f4a5b",
    "driver": { "id": "7d1f4e8a-b6c9-4a1b-9c3d-4e5f0b8f1c5e", "name": "Sample Driver One" },
    "decline_reason": null
  }
}
```

| Field | Rule |
| --- | --- |
| `actor` | `null` for the system. Otherwise `id`, `role` (`customer`, `admin`, `driver`) and `name`, the account's name when read |
| `reason_code`, `note` | As stored. `note` is up to 500 characters |
| `assignment` | Set on the events of rows 8 to 11 (offered, accepted, declined, withdrawn), `null` on every other event. `decline_reason` is set only on a decline |

The client words assignment events from the event itself: `to_status`
`assigned` is "Offered to <driver>"; `assigned` → `accepted` is "Accepted by
<driver>"; reason `driver_declined` is "Declined by <driver>"; reason
`reassigned` is "Offer to <driver> withdrawn" from `assigned` and "Job
withdrawn from <driver>" from `accepted`.

### Endpoints

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/admin/orders/{reference}` | none | 200 `AdminOrderDetail` | 404 `order_not_found` |
| GET | `/admin/orders/{reference}/drivers` | none | 200 `{ "items": [DispatchDriver] }` | 404 `order_not_found` |
| POST | `/admin/orders/{reference}/assign` | `AssignRequest` | 201 `AdminOrderDetail`; 200 for a repeated offer | 404 `order_not_found`, 404 `driver_not_found`, 409 `driver_not_eligible`, 409 `invalid_order_transition`, 422 `validation_error` |
| POST | `/admin/orders/{reference}/withdraw` | `WithdrawRequest` | 200 `AdminOrderDetail` | 404 `order_not_found`, 404 `assignment_not_found`, 409 `invalid_order_transition`, 422 `validation_error` |
| GET | `/admin/orders/{reference}/history` | none | 200 `{ "items": [AdminOrderEvent] }` | 404 `order_not_found` |

All endpoints also return the shared 401, 403 and 422 errors from the
[README](README.md#errors).

#### GET /admin/orders/{reference}/drivers

Every account with role `driver`, active or not, with its eligibility for
this order now. Drivers who can take it come first, then the rest; each group
by name. No pagination: the MVP has a handful of drivers.

- An empty `items` means no driver accounts exist: the design's "No drivers
  set up yet." `not_a_driver` never appears here.
- The list is a snapshot. Assign checks again, so a driver who became busy
  meanwhile is refused with `driver_not_eligible`.
- It works for any order status; the client opens D1 only on a `confirmed`
  order.

#### POST /admin/orders/{reference}/assign

Offers a `confirmed` order to one driver (row 8, FR-031, FR-032).
`AssignRequest`:

```json
{ "driver_id": "7d1f4e8a-b6c9-4a1b-9c3d-4e5f0b8f1c5e" }
```

Effect: a new `offered` assignment; the order becomes `assigned` ("Assigned
- awaiting driver"). The driver has **not** accepted. Returns 201 with the
order.

| Case | Response |
| --- | --- |
| The same driver is already offered this order | 200 with the order unchanged; no second event |
| The order is not `confirmed`, or another driver holds it | 409 `invalid_order_transition`, `details: {"from": "<status>", "to": "assigned"}`. The client shows "This order has changed." with Refresh |
| The driver cannot take it | 409 `driver_not_eligible`, message "This driver cannot take this order.", `details.reasons` |
| Another offer took the driver at the same moment | 409 `driver_not_eligible` with `reasons: ["busy"]` |
| `driver_id` is not an account | 404 `driver_not_found` |
| `driver_id` is an account that is not a driver | 409 `driver_not_eligible` with `reasons: ["not_a_driver"]` |

#### POST /admin/orders/{reference}/withdraw

Takes back an offered or accepted job (rows 10 and 11). `WithdrawRequest`:

```json
{ "expected_status": "offered", "note": "No answer after 25 minutes." }
```

| Field | Rule |
| --- | --- |
| `expected_status` | **Required.** `offered` (Withdraw offer, from D2) or `accepted` (Withdraw job, from D4): the assignment status the dispatcher saw |
| `note` | Optional, trimmed, up to 500 characters; empty is stored as `null`. Saved as the event's note |

Effect: the live assignment becomes `withdrawn` with `ended_at`; the order
returns to `confirmed` with reason `reassigned` and the note. The job leaves
the driver's job list; nothing notifies the driver. Returns 200 with the
order.

| Case | Response |
| --- | --- |
| No live assignment (the driver declined, or another dispatcher withdrew first) | 404 `assignment_not_found`, message "This order has no driver assigned" |
| The live assignment's status is not `expected_status` (the driver accepted while the dialog was open) | 409 `invalid_order_transition`, `details: {"from": "<order status>", "to": "confirmed"}`. Nothing changes |
| The driver has departed (`departed` or later) | 409 `invalid_order_transition`. After departure, use the failure or cancellation steps |

The client shows "This order has changed." with Refresh for both 409s.

#### GET /admin/orders/{reference}/history

Every event of the order, **newest first**, with no pagination: an order has
tens of events at most. The client shows the 10 newest and reveals the rest
with "Show all" (design Decision 9). Every order has at least its
`quote_requested` event, so `items` is never empty. A separate request from
the detail, so the history can fail and retry on its own (H1).

### Data needed

- `order_events.assignment_id`: nullable foreign key to `assignments`, set by
  the dispatch services on the events of rows 8 to 11 (migration). Events
  written before it exists return `assignment: null`.
- No other new tables: names come from `users`, vehicles from the driver's
  profile.

### Admin dispatch decisions

Agreed with the section (G3, 2026-10-19), from the design's open
questions:

1. **Withdraw names what it expects.** `expected_status` stops a withdraw of
   an offer from taking back a job the driver accepted a moment earlier
   (rows 10 and 11 both allow a withdraw).
2. **History carries names.** `actor.name` and the assignment's driver name
   are returned, so the client never looks accounts up.
3. **The decline reason has its own field.** It is read from
   `assignment.decline_reason`, not parsed from the event note. The decline's
   event note becomes the driver's own note only (see the
   [decline](#post-driverjobsreferencedecline) endpoint); events written
   before the change keep `<reason>: <note>`.
4. **The assignment is on the detail only**, as the most recent assignment,
   so the list stays light and D3 can show the last decline.
5. **History is its own read**, newest first and complete.
6. **Assign and withdraw return the order**, so the page redraws without a
   second request.

### Amendment (#204): the driver on the admin order list

**Status: agreed** (G3) on 2026-10-28 by @nnamdi-security (technical lead), on
PR #205. Proposed by @Daveoski (+ Claude Code) for
[#204](https://github.com/mmiri-oma/mmirioma/issues/204), option B.

**Gap.** `GET /admin/orders` returns `AdminOrderRead`, which names no driver;
only the detail does, through `assignment.driver`
([decision 4](#admin-dispatch-decisions) kept the assignment off the list so it
stays light). The Rider column on the Orders page therefore cannot say who has
an order. In real-API mode it reads "None yet" on every row, including held and
in-progress orders that have a driver, which is untrue.

**Proposal.** One additive read field on each item of the list, and nothing
else of the assignment:

```json
{ "driver": { "id": "7d1f4e8a-b6c9-4a1b-9c3d-4e5f0b8f1c5e", "name": "Sample Driver One" } }
```

| Field | Rule |
| --- | --- |
| `driver` | `null`, or the driver of the order's **live** assignment: status `offered` or `accepted` ([Assignment statuses](#assignment-statuses-built-in-s1-07)). A declined, expired, withdrawn or completed assignment gives `null` |
| `driver.id` | The driver's account id, as in `AdminAssignment.driver` |
| `driver.name` | The driver's name, as in `AdminAssignment.driver` |

- **List only.** The detail keeps `assignment` as it is (decision 4 still holds
  for the full assignment: vehicle, offer times, decline reason). The page's
  items gain `driver`; `GET /admin/orders/{reference}` does not.
- **Same rule as the detail.** The detail's banner and "Assigned to" line name
  the driver of the live assignment, so the list and the panel agree.
  An order with no live assignment (not confirmed, in the pool, declined,
  withdrawn, delivered, cancelled, failed) has `driver: null`.
- **Additive.** A client that ignores the field keeps working. No new rule,
  setting, status or table: the value is already stored
  (`assignments.driver_user_id`, `users.name`).
- **Staff only.** The route already requires an administrator; the driver's
  name is already on the detail, so no new privacy question arises.
- **No fleet code.** The Rider column shows the driver's name. A fleet code
  stays out of the contract (admin-directory.md, open question 9).
- **Cost.** The server reads the live assignments of the whole page in one
  query, not one per row.

**Decisions** (2026-10-28, @nnamdi-security, on PR #205):

1. **Option B.** The list carries the driver, rather than the frontend-only
   wording change (option A).
2. **An offered assignment shows the driver's name** (`offered` or
   `accepted`), not only after the driver accepts. The panel says "Assigned to
   <name> · Waiting for them to start" in that case, so the two agree, and a
   dispatcher needs to see who an order has been offered to, so as not to
   offer it twice.

**Built in:** [#204](https://github.com/mmiri-oma/mmirioma/issues/204)
(`AdminOrderListItem` in `deliveries/admin_schemas.py`,
`dispatch.service.live_drivers_by_order`, since #243
`listed_drivers_by_order`). The contract example
`examples/admin-orders-page.json` carries `driver` (a person on the third item,
`null` on the others) and `backend/tests/test_admin_order_list_example.py`
checks it against the built schema.

### Amendment (#243): the driver on the admin order list after the order ends

**Status: agreed** (G3) on 2026-10-29 by @nnamdi-security (technical lead),
proposed by @Cloudcrackamara (+ Claude Code) for
[#243](https://github.com/mmiri-oma/mmirioma/issues/243).

**Gap.** The [#204 amendment](#amendment-204-the-driver-on-the-admin-order-list)
gives `driver` only for a **live** assignment, so a `delivered`, `failed` or
`cancelled` order has `driver: null` and the Rider column reads "None yet".
The detail panel is fixed on the client (it already receives the ended
assignment). The list cannot say who delivered an order, or who held a
cancelled job.

**Proposal.** Change only the rule for `driver` on each item of
`GET /admin/orders`. The shape is unchanged (`null`, or `{ id, name }`):

| Order status | `driver` |
| --- | --- |
| `assigned`, `accepted`, `departed`, `collected`, `en_route`, `arrived`, `unloading` | The driver of the live assignment (`offered` or `accepted`), as today |
| `delivered`, `failed` | The driver of the order's `completed` assignment |
| `cancelled` | The driver of the order's `completed` assignment, when the job had finished before the cancellation (a failed delivery the dispatcher then cancelled; clarification below); otherwise the driver of its `withdrawn` assignment **if the driver had accepted it** (`responded_at` set, no `decline_reason`); otherwise `null` |
| Any other (`confirmed` and earlier, `disputed`) | `null` unless a live assignment exists, as today |

- **Same rule as the detail.** The panel names the same driver for the same
  order (frontend, PR #246).
- **A never-accepted offer names nobody.** The SRS has no rule for who "held"
  a cancelled job (FR-036 says orders "may be reassigned or cancelled with
  reason"); the author chose "accepted only", so an unanswered offer that was
  withdrawn when the order was cancelled shows "None yet".
- **An order back in the pool** (`confirmed` after a withdraw) keeps no driver.
- **Additive.** Same field, same shape; a client that ignores it keeps working.
  No new table, status or setting; `assignments` already stores it.
- **Cost.** Still one query for the page's assignments (the live rule becomes
  "live, or the order's final assignment"), plus the drivers' accounts.
- **Example.** `examples/admin-orders-page.json` gains an item with a
  `delivered` order and a driver.

**Decided** (2026-10-29, @nnamdi-security, on #243): "accepted only" is right
for a cancelled order. A driver who never accepted never held the job, and the
SRS has no rule for who "held" it (FR-036), so the list does not name one. It
is the same rule the order panel uses (PR #246).

**Clarification** (#275), proposed by @Bonvee120 (+ Claude Code); **agreed**
(G3) on 2026-10-30 by @nnamdi-security (technical lead). The table above does not say what a `cancelled` order
with a `completed` assignment names. That order exists: a driver fails a
delivery (`failed`, row 20, which completes the assignment), and the dispatcher
then cancels the failed order, the only action the panel offers on it. Cancelling
withdraws a *live* assignment only (row 23), so the completed one stays. The
list returned `null` for it ("None yet") while the order panel named the driver,
which breaks "same rule as the detail" above. The rule is unchanged in spirit:
the list names who held the job, here the driver of the completed assignment.
`disputed` stays `null`, as the table says. Implemented in
[PR #283](https://github.com/mmiri-oma/mmirioma/pull/283).

### Amendment (#280): contact attempts on the admin order detail

**Status: agreed** (G3) on 2026-10-30 by @nnamdi-security (technical lead),
proposed by @Bonvee120 (+ Claude Code) for
[#280](https://github.com/mmiri-oma/mmirioma/issues/280). The timeline wording
still needs G2 before the frontend change.

**Gap.** FR-038 has the driver record two contact attempts, each with its time,
before a delivery can fail as `customer_unreachable`. The driver's job read
carries them (`contact_attempts`, [Driver job object](#driver-job-object)), and
the approved design for #250 says the dispatcher can see the times. The admin
reads do not carry them:

- `AdminOrderDetail` has no attempts.
- `GET /admin/orders/{reference}/history` returns order events. Each one is a
  status change (`from_status`, `to_status`), and an attempt is not one, so no
  entry exists for it, with or without `include=holds`.
- The only admin read with attempts is `HoldReview.proof.contact_attempts`
  ([Admin hold review endpoints](#admin-hold-review-endpoints)), and it exists
  only while a proof-review hold is open. A failed delivery opens no hold.

So the order panel's timeline reads "Arrived", then "Delivery failed ·
<driver> · Customer unreachable", with nothing between them.

**Proposal.** One additive field on `AdminOrderDetail`, and no other change:

```json
{
  "contact_attempts": [
    { "attempted_at": "2026-10-19T09:44:00Z" },
    { "attempted_at": "2026-10-19T09:49:00Z" }
  ]
}
```

| Field | Rule |
| --- | --- |
| `contact_attempts` | Always present on `AdminOrderDetail`: a list, empty when no attempt was recorded (an order no driver has reached has `[]`). Each item is `{ "attempted_at": "<UTC>" }`, the server's time of the attempt. Oldest first. The same item as the driver job read and `proof.contact_attempts` |
| Which attempts | Every contact attempt recorded on the order, across all its delivery attempts. Today an order has one arrival, so one set of attempts. A rescheduled order (row 21, designed ahead) will have more; the items do not say which arrival they belong to, and an additive `arrived_at` can come with rescheduling if the panel needs grouping |
| Who sees it | Staff with the admin role, as the rest of the detail. Times only: no phone numbers, no location, no driver notes |
| Every route | `AdminOrderDetail` is also the response of assign, withdraw, transition, hold and proof-override calls, and the admin client replaces its cached detail with each response. All of them carry the field, or the panel would lose the attempts after the next action |

- **Why not history entries.** A history entry is an order event with a
  `to_status`. An attempt changes no status, so the shape would need a
  nullable `to_status` or an invented one, and every consumer of the history
  (the timeline, the hold review) would have to cope. The history is also a
  separate call that can fail on its own (H1), and the attempts would vanish
  with it.
- **How the panel uses it** (the frontend change, not this contract). It
  merges the attempts into the timeline by time, between "Arrived" and
  "Delivery failed": "Contact attempt 1 · 9:44 AM". The wording is a screen
  change and needs G2.
- **Cost.** One more read on the detail path: the order's contact attempts
  through `delivery_attempts`. Not on the list. No migration, because the
  `contact_attempts` table exists.
- **Errors.** None new. `404 order_not_found` as before.
- **Examples.** None change in this amendment. `examples/admin-order-detail.json`
  gains `contact_attempts` (empty) in the backend change, and a failed order
  with two attempts is added then: a backend test compares the response's keys
  with that file, so it must change together with the code.
- **Tests expected.** Backend: a failed order with two attempts returns two
  items, oldest first; an order with none returns `[]`; an unknown reference
  gives 404; the field is present in an assign and a transition response.
  Frontend: the timeline lines, in real mode and in mock mode.

**Decided** (2026-10-30, @nnamdi-security, on #286):

1. **The field on `AdminOrderDetail`**, not history entries.
2. **Every attempt on the order**, not only the current delivery attempt's.
3. **The timeline wording "Contact attempt N · time"** is the wording to use.
   It is a screen change, so it still needs G2 (`docs/design/`) before the
   frontend work.


## Admin hold review endpoints

Status: **agreed** (G3) on 2026-10-21 by @nnamdi-security (technical lead,
contract owner) and @chidimmamogbo (orders backend; PR #91 review). Derived
from the approved [admin hold review design](../design/admin-hold-review.md)
(#88, G2). Implemented in `backend/app/modules/deliveries/holds.py` and
`admin_router.py` (#93; see [admin-hold-review.md](../features/admin-hold-review.md)).
**Amended after that review** (technical
lead, 2026-10-21): the review's three open questions are now
[decisions 6-8](#hold-review-decisions), and hold entries in the history are
returned only on request (`include=holds`), because the shipped admin
dispatch screens read the history. @chidimmamogbo re-confirms the amendment
before merge.

How an administrator reviews a driver's job on hold and decides it (FR-034,
FR-035, FR-036, SRS §8): R0 finds held orders, R1 reviews alternative proof
(row 18), R2 reviews a source, R3 reviews an unsafe stop, and FAIL and CANCEL
end the delivery (rows 20 and 23). It uses the technical lead's decisions on
#88 (2026-10-20 and 2026-10-21). Conventions (base path `/api/v1`, formats,
error envelope, CSRF) are in the
[README](README.md#conventions-apply-to-every-endpoint).

### Hold review rules

- **An administrator decides every hold.** Every endpoint here requires a
  signed-in, active `admin`; customers and drivers get 403 `forbidden`
  (T-23: a driver can never approve proof). Paths use the order reference;
  an unknown one is 404 `order_not_found`. `POST` requests need
  `X-CSRF-Token`.
- **The approver is never the delivering driver** (BR-13). Approving proof
  is refused with 403 `own_delivery_override` when the administrator is the
  assignment's driver or the user who recorded the proof. Rejecting is not
  blocked by this rule.
- **A hold is not a status.** The order keeps its status while a hold is
  open. A hold is an open `order_exceptions` row with a `hold_kind`
  ([driver job concepts](#concepts)); deciding it sets `resolved_at`, which
  lets the driver continue.
- **One hold at a time per job.** The hold shown is the job's **oldest**
  open hold. A pickup that both used another source and flagged a concern
  opens two `source_review` exceptions; they are one hold, and a decision
  closes every open exception of that kind on the job. If a hold of another
  kind is still open afterwards, it becomes the hold shown.
- **Decisions name the hold they decide.** Each decision sends the
  `hold_id` it was made on. If that hold is no longer open (already
  decided, the order changed, another administrator acted), the request is
  refused with 409 `hold_not_open` and nothing changes. The client shows
  "This order has changed." with Refresh.
- **Every decision is recorded** with its outcome, note, administrator and
  time (NFR-004): on the exception (`resolution`, `resolution_note`,
  `resolved_by`, `resolved_at`), on the proof for an override (FR-035), and
  in the history. Status changes write `order_events` as usual.
- **Fail and Cancel never charge the customer here.** A failure for
  `source_quality_concern` or `unsafe_access` is attributable to MmiriOma, so
  no redelivery fee applies (FR-038, BR-14). Cancelling with
  `mmirioma_unable` is free (FR-044); the amount comes from the server.

### Hold object on admin orders (R0)

`AdminOrderRead` (the list and the detail) gains one field:

```json
{ "hold": { "id": "9b2c4d6e-8f1a-4b3c-9d5e-6f7a8b9c0d1e", "kind": "proof_review", "since": "2026-10-20T08:48:00Z" } }
```

| Field | Rule |
| --- | --- |
| `hold` | `null`, or the order's current job's oldest open hold |
| `hold.id` | The hold's id (the oldest open exception of that kind). Sent back with decisions |
| `hold.kind` | `proof_review`, `source_review` or `unsafe_stop`. Labels from the design: Proof review, Source review, Unsafe stop |
| `hold.since` | When the hold opened (UTC). The client shows Africa/Lagos time and "12 minutes ago" |

`GET /admin/orders` gains the filter `on_hold`: `true` lists only orders
with an open hold (any kind), `false` only those without; it combines with
`status` and the other filters. The page's `total` is the On hold count.
The driver's name on the banner comes from `assignment.driver.name`
([admin dispatch](#objects)).

### HoldReview object (R1, R2, R3)

Returned by `GET /admin/orders/{reference}/hold`: the evidence for the hold
shown. Only the part for its kind is set; the others are `null`.

```json
{
  "id": "9b2c4d6e-8f1a-4b3c-9d5e-6f7a8b9c0d1e",
  "kind": "proof_review",
  "since": "2026-10-20T08:48:00Z",
  "order_status": "unloading",
  "driver": { "id": "7d1f4e8a-b6c9-4a1b-9c3d-4e5f0b8f1c5e", "name": "Sample Driver One" },
  "proof": {
    "delivered_litres": 1000,
    "reason": "customer_cannot_receive_code",
    "driver_note": "Customer's phone is off. The gateman signed.",
    "arrived_at": "2026-10-20T08:20:00Z",
    "unloading_completed_at": "2026-10-20T08:44:00Z",
    "sent_at": "2026-10-20T08:48:00Z",
    "delivery_code": { "issued_at": "2026-10-20T08:44:00Z", "sms_status": "accepted", "attempts_used": 3, "attempts_limit": 5, "expired": true },
    "contact_attempts": [{ "attempted_at": "2026-10-20T08:46:00Z" }],
    "location": null
  },
  "pickup": null,
  "source_eligibility": null,
  "report": null,
  "incidents": [],
  "withdraw_allowed": false
}
```

| Field | Rule |
| --- | --- |
| `order_status` | The order's status now |
| `driver` | The assignment's driver |
| `proof` | `proof_review` only. From the pending alternative proof and its delivery attempt |
| `proof.reason` | `customer_cannot_receive_code` or `other` (labels "Customer cannot receive the code", "Other") |
| `proof.delivery_code` | The newest code for the order, or `null` if none was issued. `sms_status` is `accepted` or `failed` (whether the SMS provider accepted it); `expired` is true once it can no longer be used. **The code is never returned** |
| `proof.contact_attempts` | Times only, oldest first; empty if none |
| `proof.location` | `{ "latitude", "longitude", "accuracy_metres" }` only if the driver shared it with consent; otherwise `null` ("No location shared"). Never a route |
| `pickup` | `source_review` only: `assigned_source` (`id`, `name`, `approximate_location`, or `null`), `used_source` (`{ "assigned": true }` or `{ "assigned": false, "name": "<other source>" }`), `source_reference`, `volume_collected_litres`, `picked_up_at`, `safety_concern`, `safety_note` |
| `source_eligibility` | `source_review` only: `{ "answer": "eligible" \| "not_eligible" \| "cannot_check", "message": "<server text>" }`, for the source used and the order's water category (FR-012). See [source eligibility](#source-eligibility-r2) |
| `report` | `unsafe_stop` only: `kind` (`unsafe_access` or `unsafe_transfer`), `note`, `reported_at` and `order_status_then` (the order's status when it was reported, from its events) |
| `incidents` | The job's other driver-reported incidents, oldest first: `{ "kind", "reported_at", "note" }`, `kind` an incident type from [incidents](#post-driverjobsreferenceincidents). Empty if none |
| `withdraw_allowed` | True only while the order is `accepted` (row 11): R3 then also offers Withdraw job |

#### Source eligibility (R2)

The server's answer for the source the driver used and the order's water
category:

| `answer` | When | `message` |
| --- | --- | --- |
| `not_eligible` | The driver named another source (free text), which is not in the source records | "This source is not in the source records." |
| `cannot_check` | The order has no water category (set at confirmation, #113) | "This order has no water category." |
| `eligible` | The source is activated for the order's category and its approval is current | "This source is activated for the order's water category." |
| `not_eligible` | It is not activated for that category | "This source is not activated for this water category." |
| `not_eligible` | Its activation is suspended | "This source is suspended for this water category." |
| `not_eligible` | Its activation is revoked | "This source's activation for this water category is revoked." |
| `not_eligible` | Its laboratory approval has expired | "This source's laboratory approval for this water category has expired." |

Checked in that order; for several reasons, the first in the
[shared check's order](#source-eligibility-shared-with-r2) gives the
message. **Amended 2026-10-22 (#112)** from the order confirmation
contract (PR #111): the earlier `cannot_check` "Source approval records are
not set up yet." is gone now that source records exist. Until orders get a
water category at confirmation (#113), every recorded-source answer is
`cannot_check`, so a source review still ends in Fail or Cancel.

### Endpoints

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/admin/orders/{reference}/hold` | none | 200 `HoldReview` | 404 `order_not_found`, 404 `hold_not_found` |
| POST | `/admin/orders/{reference}/proof-overrides` | `ProofOverrideRequest` | 200 `AdminOrderDetail` | 404 `order_not_found`, 403 `own_delivery_override`, 409 `hold_not_open`, 409 `invalid_order_transition`, 422 `validation_error` |
| POST | `/admin/orders/{reference}/hold/continue` | `HoldDecisionRequest` | 200 `AdminOrderDetail` | 404 `order_not_found`, 409 `hold_not_open`, 409 `source_not_eligible`, 422 `validation_error` |
| POST | `/admin/orders/{reference}/hold/resume` | `HoldDecisionRequest` | 200 `AdminOrderDetail` | 404 `order_not_found`, 409 `hold_not_open`, 422 `validation_error` |
| GET | `/admin/orders/{reference}/cancellation-outcome` | `reason_code` query | 200 `CancellationOutcome` | 404 `order_not_found`, 409 `invalid_order_transition`, 422 `validation_error` |
| POST | `/admin/orders/{reference}/transition` | `AdminTransitionRequest` | 200 `AdminOrderDetail` | 404 `order_not_found`, 409 `hold_not_open`, 409 `invalid_order_transition`, 422 `validation_error` |

The existing [withdraw](#post-adminordersreferencewithdraw) and
[history](#get-adminordersreferencehistory) endpoints change as described
below. All endpoints also return the shared 401, 403 and 422 errors from the
[README](README.md#errors).

#### GET /admin/orders/{reference}/hold

The evidence for the hold shown on the order (`hold` on the detail). 404
`hold_not_found`, message "This order has no open hold", when there is none
(it was decided meanwhile; the client refreshes the order).

#### POST /admin/orders/{reference}/proof-overrides

Approves or rejects alternative proof (R1, FR-035). `ProofOverrideRequest`:

```json
{
  "hold_id": "9b2c4d6e-8f1a-4b3c-9d5e-6f7a8b9c0d1e",
  "decision": "approve",
  "customer_acknowledgment": { "method": "phone_call", "confirmed_at": "2026-10-20T09:15:00Z", "note": null },
  "note": "Customer confirmed by phone that 1,000 litres were delivered."
}
```

| Field | Rule |
| --- | --- |
| `hold_id` | **Required.** The open `proof_review` hold's id |
| `decision` | **Required.** `approve` or `reject` |
| `customer_acknowledgment` | **Required for `approve`**, must be absent for `reject`. `method`: `phone_call` ("Phone call with the customer"), `in_person_to_staff` ("Customer confirmed in person to staff") or `other` (note required); `confirmed_at`: aware timestamp, not in the future and not before unloading was completed (2 minutes' clock tolerance); `note`: optional, up to 500 characters |
| `note` | **Required**, trimmed, 1-500 characters. For a rejection it is the reason |

**Approve** (row 18), in one transaction: the proof is marked approved with
the administrator, time, acknowledgment and note; the order goes
`unloading` → `delivered` with the proof's delivered litres
(`proof_override_approved`); the delivery attempt's outcome is `delivered`,
the assignment `completed`, any unused delivery code invalidated, and the
hold closed with `resolution` `proof_approved`. A partial delivery keeps the
exception opened with the proof (FR-035, FR-036). Payment is not touched
(BR-12).

**Reject**: the proof is marked rejected with the administrator, time and
note, and no longer counts as proof. The hold is closed with `resolution`
`proof_rejected`, and the partial delivery exception opened with that proof
(if any) is closed too, because a new proof opens it again. The order stays
`unloading`. The driver's job has no hold and is back at "unloading
complete": the driver can send the customer a new code
([`POST .../delivery-code`](#post-driverjobsreferencedelivery-code)) and
submit proof again. If the customer still cannot confirm, the dispatcher
fails the delivery (`other` with a note) or arranges another visit.

| Case | Response |
| --- | --- |
| The administrator is the delivering driver or recorded the proof (approve only) | 403 `own_delivery_override`, message "You can't approve proof for a delivery you made." (BR-13, T-23) |
| `hold_id` is not this order's open `proof_review` hold (already decided, or another kind) | 409 `hold_not_open`, message "This hold has already been decided or has changed". Nothing changes |
| The order is no longer `unloading` | 409 `invalid_order_transition` |
| A driver or customer calls it | 403 `forbidden` |

Returns 200 with the order. A repeated request after the decision is 409
`hold_not_open`; the client shows the order changed.

#### POST /admin/orders/{reference}/hold/continue

Continues after a source review (R2). `HoldDecisionRequest`:

```json
{ "hold_id": "9b2c4d6e-8f1a-4b3c-9d5e-6f7a8b9c0d1e", "note": "Source records match the order category. Continue." }
```

`hold_id` is required and must be the open `source_review` hold; `note` is
required, trimmed, 1-500 characters. Allowed only when the
[source eligibility](#source-eligibility-r2) answer is `eligible`, checked
again at the request; otherwise 409 `source_not_eligible` with the answer's
`message` as the message and `details: {"answer": "not_eligible"}` (or
`cannot_check`). Effect: every open `source_review` exception on the job is
closed with `resolution` `source_continued`; the order stays `collected`
and the driver continues (`en_route`). Returns 200 with the order.

#### POST /admin/orders/{reference}/hold/resume

Resumes after an unsafe stop (R3) once there is a safe alternative.
`HoldDecisionRequest` as above, with the open `unsafe_stop` hold; `note` is
the safe alternative (required, 1-500 characters). Effect: the hold is
closed with `resolution` `unsafe_resumed`; the job continues from the status
it stopped at. Returns 200 with the order.

#### POST /admin/orders/{reference}/withdraw (change)

Unchanged, plus: a withdraw of an accepted job (row 11) that has an open
`unsafe_stop` hold also closes it with `resolution` `withdrawn`, so R3's
Withdraw job (before departure, `withdraw_allowed`) uses this endpoint with
`expected_status: "accepted"`. After departure withdraw stays refused.

#### GET /admin/orders/{reference}/cancellation-outcome

What cancelling would cost the customer, for the CANCEL dialog (FR-044).
Query `reason_code`; this section supports only `mmirioma_unable`. Any other
reason is 422 `validation_error` until the cancellation feature is built.
[Cancel because the customer asked (#174)](#cancel-because-the-customer-asked-174)
(agreed) adds `customer_request`.
`CancellationOutcome`:

```json
{ "reason_code": "mmirioma_unable", "customer_charge_minor_units": 0, "message": "The customer is not charged for this cancellation." }
```

The client shows `message` as written. 409 `invalid_order_transition` when
the order cannot be cancelled (row 23).

#### POST /admin/orders/{reference}/transition (fail and cancel)

The planned admin transition endpoint, agreed here **only** for failing a
delivery (row 20) and cancelling with `mmirioma_unable` (row 23). The other
rows it is planned for stay under [Planned endpoints](#planned-endpoints-not-agreed).
`AdminTransitionRequest`:

```json
{ "to": "failed", "expected_status": "collected", "reason_code": "source_quality_concern", "note": "Source flooded. Driver cannot use it.", "hold_id": "9b2c4d6e-8f1a-4b3c-9d5e-6f7a8b9c0d1e" }
```

| Field | Rule |
| --- | --- |
| `to` | `failed` or `cancelled` |
| `expected_status` | **Required.** The order status the administrator saw. A mismatch is 409 `invalid_order_transition` and nothing changes |
| `reason_code` | `failed`: `source_quality_concern`, `unsafe_access` or `other` in this section (row 20 also lists `customer_unreachable` and `vehicle_failure`, agreed with the dispatch screens that use them). `cancelled`: `mmirioma_unable` only (`customer_request` is agreed in [#174](#cancel-because-the-customer-asked-174)) |
| `note` | Optional, up to 500 characters; **required** with `other` |
| `hold_id` | Optional. When sent (FAIL or CANCEL opened from R2 or R3) it must be an open hold of the order, or 409 `hold_not_open` |

Effect, in one transaction, with the transition and its event:

- `failed` (row 20, from `assigned` to `unloading`): the assignment is
  `completed` and the delivery attempt's outcome, if there is one, `failed`.
  No redelivery fee is recorded (BR-14). Rescheduling (row 21) is designed
  ahead (R4).
- `cancelled` (row 23): the live assignment is `withdrawn` and the job
  leaves the driver's list; nothing notifies the driver. The customer charge
  is 0 (`mmirioma_unable`, FR-044); the customer's cancellation SMS (FR-050)
  comes with the cancellation feature. For the pilot an administrator tells
  the customer instead (fallback F10; #99's contract dropped the app SMS on
  2026-10-24).
- Every open hold on the job is closed with `resolution` `failed` or
  `cancelled`.

Returns 200 with the order.

#### GET /admin/orders/{reference}/history (change)

Hold entries are returned **only on request**:
`GET /admin/orders/{reference}/history?include=holds`. Without the parameter
the response is exactly as before: status changes only, and no `kind` or
`hold` field. The shipped admin dispatch history (#62) draws a status badge
from every entry's `to_status`, so it must never receive an entry with a
`null` status. Any other `include` value is 422 `validation_error`.

With `include=holds`, every entry has `kind` and `hold`, and the list also
holds the hold entries, still newest first:

```json
{
  "id": "4c5d6e7f-8a9b-4c0d-9e1f-2a3b4c5d6e7f",
  "kind": "hold_decided",
  "from_status": null,
  "to_status": null,
  "actor": { "id": "0b8f1c5e-2a3b-4c5d-9e6f-7a8b9c0d1e2f", "role": "admin", "name": "Sample Dispatcher" },
  "reason_code": null,
  "note": "The person who answered is not the customer.",
  "created_at": "2026-10-20T09:31:00Z",
  "assignment": null,
  "hold": { "id": "9b2c4d6e-8f1a-4b3c-9d5e-6f7a8b9c0d1e", "kind": "proof_review", "category": "alternative_proof", "decision": "proof_rejected" }
}
```

| `kind` | Entry | Fields |
| --- | --- | --- |
| `status_change` | Every `order_events` row, as before | `hold` is `null` |
| `hold_opened` | One per exception that opened a hold | `actor` the driver; `note` the driver's note; `hold.category` the exception category (for example `source_mismatch`, `pickup_safety_concern`, `unsafe_access`); `hold.decision` `null` |
| `hold_decided` | One per hold decision `proof_approved`, `proof_rejected`, `source_continued` or `unsafe_resumed` | `actor` the administrator; `note` the decision note; `hold.decision` |

`from_status` and `to_status` are `null` on hold entries, so a client that
sends `include=holds` treats them as nullable. Holds closed by a
failure, cancellation or withdraw have no `hold_decided` entry: the status
change already shows it, with its reason. An approval shows both its
`hold_decided` entry and the `delivered` status change. Decision labels from
the design: Proof approved, Proof rejected, Source continued, Delivery
resumed after unsafe stop.

### Error codes added by this section

| Status | `code` | When |
| --- | --- | --- |
| 403 | `own_delivery_override` | Approving proof for a delivery the administrator made or recorded (BR-13) |
| 404 | `hold_not_found` | Reading the hold of an order that has none open |
| 409 | `hold_not_open` | Deciding a hold that is no longer open, or is not the kind the endpoint decides |
| 409 | `source_not_eligible` | Continuing when the source eligibility answer is not `eligible` |

### Data needed

One migration:

- `order_exceptions`: `resolved_by` (nullable foreign key to `users`),
  `resolution` (nullable: `proof_approved`, `proof_rejected`,
  `source_continued`, `unsafe_resumed`, `failed`, `cancelled`, `withdrawn`)
  and `resolution_note` (up to 500 characters). `resolved_at` exists.
- `delivery_proofs` (SRS §5 "override approver, reason and evidence"):
  `override_status` (`pending`, `approved`, `rejected`; `null` for code
  proofs), `override_decided_by`, `override_decided_at`, `override_note`,
  `customer_ack_method` (`phone_call`, `in_person_to_staff`, `other`),
  `customer_ack_at` and `customer_ack_note`. Existing alternative proofs
  become `pending`.
- `audit_logs` (SRS §5; [decision 6](#hold-review-decisions)): `id`,
  `actor_id` (foreign key to `users`), `action`, `target_type`, `target_id`,
  `created_at` and `metadata` (JSONB, small). Created here, used by later
  NFR-004 features too.
- Source eligibility needs the water categories and per-category source
  activation from #87; built in #112 (revision `0011`).

### Hold review decisions

From the design's review and the technical lead's decisions on #88:

1. **Decisions name the hold** (`hold_id`), as withdraw names
   `expected_status`, so a stale screen can never decide a newer hold.
2. **One decision endpoint per kind.** Proof keeps the SRS path
   `proof-overrides`; continue and resume are separate, because each has its
   own rule (eligibility; a safe alternative).
3. **Fail and Cancel use the planned transition endpoint**, agreed now only
   for the reasons these screens use.
4. **Withdraw before departure** (2026-10-21) reuses the withdraw endpoint
   and closes the unsafe stop.
5. **The cancellation outcome is read before cancelling**, so the dialog
   shows the server's sentence, never one the client worked out.

Decided by the technical lead on 2026-10-21, after the G3 review left the
three open questions unanswered:

6. **A minimal audit log now** (FR-035, NFR-004). The `audit_logs` table is
   added with this build. Every hold decision writes one row in the same
   transaction as the decision: `action` `proof_override_approved`,
   `proof_override_rejected`, `source_review_continued` (a source override,
   NFR-004) or `unsafe_stop_resumed`; `target_type` `order` with the order
   id; `metadata` the hold id and kind. No phone numbers, addresses or
   notes go in `metadata` (CLAUDE.md, Security). The proof and exception
   columns stay, because the workflow reads them; the audit row is the
   separate record. No screen reads the audit log yet.
7. **A recorded source at pickup, with #87, not in this build.** Once source
   records and categories exist, the pickup request's `source` gains a
   choice of a recorded, active source by id, next to the free-text name.
   Free text stays for a source that is not in the records, so the driver
   can report what happened; it is always `not_eligible`. Administrators do
   not match a free-text name to a record during review. This changes the
   agreed pickup endpoint and the driver design, so it is agreed with #87.
   Until then every answer is `cannot_check`.
8. **Hold entries in the history only on request** (`include=holds`). The
   review question assumed no client read the history; the admin dispatch
   screens (#62) do, and would break on a `null` status. Opting in keeps the
   agreed response unchanged for them, and keeps one sorted list for the
   hold review screens instead of two endpoints to merge.

## Order confirmation endpoints

Status: **agreed** (G3) on 2026-10-22 by @nnamdi-security (technical lead,
contract owner) and @chidimmamogbo (backend reviewer; PR #111 review).
Derived from the approved
admin order confirmation design
(#87, G2 2026-10-22), the technical lead's decisions on #87 (2026-10-20 and
2026-10-21) and the pilot fallbacks F1-F5
(pilot plan). The
proposal's four open questions were answered in that review and are
[decisions 7-10](#confirmation-decisions). Built in #112 (source records)
and #113 (`backend/app/modules/confirmation/`, migration `0012`; see
[order-confirmation.md](../features/order-confirmation.md)). Extended
(additive) in #21 to confirm orders placed with a server quote from
`awaiting_confirmation`, as decided by @nnamdi-security (technical lead) in
[order details question 14](order-details-and-price.md#open-questions),
2026-10-26.

How a dispatcher confirms an order for the pilot (FR-030, row 7): they agree
a manual quote (F2) and a delivery window (F3) with the customer, choose a
water category and an eligible water source (F1, FR-012), and the order
becomes `confirmed`, with a confirmation SMS (FR-050). Conventions (base
path `/api/v1`, formats, error envelope, CSRF) are in the
[README](README.md#conventions-apply-to-every-endpoint).

### Confirmation rules

- **Administrators only.** Every endpoint here requires a signed-in, active
  `admin`; customers and drivers get 403 `forbidden`. Paths use the order
  reference; an unknown one is 404 `order_not_found`. `POST` needs
  `X-CSRF-Token`.
- **One request, two status changes** (technical lead, question 1,
  2026-10-21). From `quote_requested`, one transaction writes a new admin row
  `quote_requested` → `awaiting_confirmation` (reason `manual_quote`, see
  [state machine change](#state-machine-change-row-26)), then row 7. If any
  row 7 check fails, neither is written.
- **Quote requests start at `quote_requested`.** `expected_status`
  `quote_requested` confirms one with a manual total (rows 26 and 7).
- **Quoted orders start at `awaiting_confirmation`** (#21, [order details
  question 14](order-details-and-price.md#open-questions), additive). An
  order placed with a server quote got there by row 3. `expected_status`
  `awaiting_confirmation` confirms it by **row 7 alone** (no row 26), with
  **no** `manual_quote_total_minor_units` (422 if sent): the snapshot copies
  the quote's total and is not manual. The category must be the quote's,
  and for a Tanker order the source must be of the kind the customer chose
  (`water_source`; a source with no kind set does not match); otherwise 422
  on that field. A changed price is a repricing, which needs the customer's
  documented agreement (BR-05, FR-036), so it is not offered here.
- **`expected_status` must be the order's status**, and an
  `awaiting_confirmation` order must have a quote; otherwise 409
  `invalid_order_transition` and nothing changes.
- **The checks run again under the order lock:** phone verified, source
  eligible for the chosen category today, delivery window set. Payment does
  not apply: every pilot order is pay on delivery (F4).
- **The price is frozen** (FR-024): one price snapshot per confirmation,
  marked `manual` for a manual total (not for a quoted order), with the
  category label as it was. Later changes to a
  category or source never change it (FR-014, T-09).
- **The SMS never changes the order** (FR-050). It is sent after the commit;
  its outcome is stored and returned, and a failure does not undo the
  confirmation.
- **Every confirmation is audited** (NFR-004, as hold decision 6): one
  `audit_logs` row in the same transaction, `action` `order_confirmed`,
  `target_type` `order`, `metadata` `{ "source_id", "water_category_id",
  "manual_quote" }` (`true` for a manual total, `false` for a quoted order). No phone numbers, addresses, amounts or notes in
  `metadata`.

### Source eligibility (shared with R2)

One check answers "may this source serve this water category today?" for
both C1 and the hold review's R2 (built once, #87 step 4). For a source and
a category it returns a list of reasons; an empty list means eligible.

| Reason | When | C1 label (design) |
| --- | --- | --- |
| `not_activated` | The source has no activation for the category | Not activated for this category |
| `suspended` | The activation is suspended (BR-10) | Suspended after a safety concern |
| `revoked` | The activation is revoked | Activation revoked |
| `approval_expired` | `approved_until` is before today in Africa/Lagos (T-04) | Laboratory approval expired |

A source can have several reasons (for example `approval_expired` and
`suspended`). R2 keeps its agreed shape (`answer`, `message`): no reasons is
`eligible`; otherwise `not_eligible`, with these messages added (additive):
"This source is suspended for this water category.", "This source's
activation for this water category is revoked.", "This source's laboratory
approval for this water category has expired." The first reason in the
table's order gives the message. `cannot_check` stays for an order with no
water category ("This order has no water category."). A free-text source
stays `not_eligible` ([decision 7](#hold-review-decisions); recorded sources
at pickup are [#109](https://github.com/mmiri-oma/mmirioma-original/issues/109)).

### State machine change (row 26)

Row 26 (`quote_requested` → `awaiting_confirmation`, admin, reason
`manual_quote`) is in the [transitions](#transitions) table, built in #113
with its rule, the `manual_quote` reason and migration `0012`
(`tests/test_order_transitions.py` keeps the table and the rules in step).
Row 3 stays the customer accepting a server quote. Row 7 gains the pilot
alternative: a delivery window set by the dispatcher
(`delivery_window_set`, F3) and pay on delivery (F4), in place of a reserved
slot. Condition name `delivery_window_set` is in the [errors](#errors) list.

### Objects

`ConfirmationOptions`, from
`GET /admin/orders/{reference}/confirmation-options`:

```json
{
  "categories": [
    {
      "id": "3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b",
      "label": "Potable Water",
      "sources": [
        {
          "id": "8e2d4c6b-1a3f-4b5c-9d7e-0f1a2b3c4d5e",
          "name": "Sample Borehole A",
          "approximate_location": "Ugwuaji, Enugu",
          "report_reference": "LR-0001",
          "approved_until": "2027-01-30",
          "is_simulated": false,
          "reasons": []
        }
      ]
    }
  ]
}
```

| Field | Rule |
| --- | --- |
| `categories` | Every active water category (FR-014), in label order. Empty when none is set up |
| `label` | The category label, admin-configured (FR-014). Never a description of the water |
| `sources` | Every source, eligible first, then by name. Empty for every category = "No water sources set up yet." (C1) |
| `report_reference` | The laboratory report reference for this category, or `null` when not activated. Never a document or link (F1) |
| `is_simulated` | Demo source (BR-09). It may be chosen for any order for now ([decision 9](#confirmation-decisions)); the client shows its Simulated tag |
| `approved_until` | Lagos date the approval is valid through (inclusive), or `null` when not activated |
| `reasons` | [Eligibility reasons](#source-eligibility-shared-with-r2); `[]` means it may be chosen |

The source's cost per litre is **never** returned to a client (C1: it is
the supplier's cost, not the customer's price), except by the admin
water-source endpoints in [admin-water-sources.md](admin-water-sources.md#cost-per-litre-the-boundary-amends-c1)
(#309), which are admin-only. This response never carries it.

`AdminOrderDetail` gains (additive; `null` on unconfirmed and older orders):

```json
{
  "water_category": { "id": "3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b", "label": "Potable Water" },
  "source": {
    "id": "8e2d4c6b-1a3f-4b5c-9d7e-0f1a2b3c4d5e",
    "name": "Sample Borehole A",
    "approximate_location": "Ugwuaji, Enugu",
    "report_reference": "LR-0001",
    "reasons": []
  },
  "delivery_window": { "start_at": "2026-10-27T09:00:00Z", "end_at": "2026-10-27T11:00:00Z" },
  "price": {
    "total_minor_units": 4500000,
    "currency": "NGN",
    "manual": true,
    "water_category_label": "Potable Water",
    "entered_by": { "id": "0b8f1c5e-2a3b-4c5d-9e6f-7a8b9c0d1e2f", "name": "Sample Dispatcher" },
    "entered_at": "2026-10-26T13:21:00Z",
    "customer_agreement": { "method": "phone_call", "agreed_at": "2026-10-26T13:15:00Z" }
  },
  "confirmation_sms": { "status": "not_accepted", "attempted_at": "2026-10-26T13:21:02Z" }
}
```

| Field | Rule |
| --- | --- |
| `water_category` | The order's category, set at confirmation (question 2) |
| `source` | The order's source with its **current** eligibility for the order's category; non-empty `reasons` drives the C2 warning. It blocks nothing ([decision 10](#confirmation-decisions)) |
| `delivery_window` | The confirmed window (UTC); the order columns `delivery_window_start_at` / `end_at` exist |
| `price` | The frozen snapshot (FR-024): total in kobo, `manual: true` in the pilot, the category label at confirmation, who entered it and when, how and when the customer agreed |
| `confirmation_sms` | `null` before confirmation. `status` `accepted` (the provider took it) or `not_accepted` (C2 warning) |

### Endpoints

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/admin/orders/{reference}/confirmation-options` | none | 200 `ConfirmationOptions` | 404 `order_not_found` |
| POST | `/admin/orders/{reference}/transition` (`to: confirmed`) | `ConfirmRequest` | 200 `AdminOrderDetail` | 404 `order_not_found`, 409 `invalid_order_transition`, 409 `transition_requirements_unmet`, 422 `validation_error` |

#### POST /admin/orders/{reference}/transition (confirm)

The planned admin transition endpoint, agreed here **only** for `to:
confirmed` from `quote_requested` (rows 26 and 7) or, for an order placed
with a quote, from `awaiting_confirmation` (row 7, #21). `ConfirmRequest`:

```json
{
  "to": "confirmed",
  "expected_status": "quote_requested",
  "water_category_id": "3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b",
  "source_id": "8e2d4c6b-1a3f-4b5c-9d7e-0f1a2b3c4d5e",
  "delivery_window": { "start_at": "2026-10-27T09:00:00Z", "end_at": "2026-10-27T11:00:00Z" },
  "manual_quote_total_minor_units": 4500000,
  "customer_agreement": { "method": "phone_call", "agreed_at": "2026-10-26T13:15:00Z", "disclosures_confirmed": true },
  "note": "Customer asked the driver to call on arrival."
}
```

| Field | Rule |
| --- | --- |
| `to` | `confirmed` |
| `expected_status` | **Required**, `quote_requested` or (#21) `awaiting_confirmation` for an order placed with a quote. A mismatch is 409 `invalid_order_transition` and nothing changes |
| `water_category_id` | An active category; unknown is 422 (`loc` this field). For a quoted order, the quote's category, else 422 |
| `source_id` | An existing source; unknown is 422. For a quoted Tanker order, of the customer's `water_source` kind, else 422. Not eligible for the category is 409 `transition_requirements_unmet` with `source_eligible` |
| `delivery_window` | Aware timestamps; `end_at` after `start_at`; `start_at` not in the past (2 minutes' clock tolerance). Otherwise 422 per field |
| `manual_quote_total_minor_units` | With `quote_requested`: **required**, integer kobo, a **whole naira** (a multiple of 100; FR-022 rounds the payable amount to whole naira), at least 100 (₦1.00). **No upper limit** ([decision 7](#confirmation-decisions)); stored as `BigInteger`. Otherwise 422. With `awaiting_confirmation`: must be absent or `null` (422 otherwise); the quote's total is confirmed |
| `customer_agreement.method` | `phone_call`, `in_person_to_staff` or `other` (the hold review's codes). `other` requires `note` |
| `customer_agreement.agreed_at` | Aware timestamp, not in the future (2 minutes' tolerance) and not before the order was created |
| `customer_agreement.disclosures_confirmed` | Must be `true`: the dispatcher told the customer the total, category, window, cash after unloading, and no cancellation or redelivery charge (F5) |
| `note` | Optional, up to 500 characters; required when `method` is `other` |

Effect, in one transaction under the order lock: the checks run (row 7);
the order gets `water_category_id`, `source_id` and the window; a price
snapshot is stored; the row 26 and row 7 events are written with the
dispatcher as actor (the note on the row 7 event); the audit row is
written. After the commit the confirmation SMS is sent and its outcome
stored. Returns 200 with the order, including `confirmation_sms`.

Errors:

- 409 `transition_requirements_unmet`, `details.missing` any of
  `phone_verified`, `source_eligible`, `delivery_window_set`. Nothing is
  written. The client reloads the options for `source_eligible` (C1
  refused).
- 409 `invalid_order_transition` (`details.from`, `to`): the order is no
  longer in `expected_status` (another dispatcher confirmed it, or the
  customer cancelled).
- A repeat of a confirmation that already succeeded is 409
  `invalid_order_transition`, never a second snapshot or SMS.

#### Confirmation SMS (FR-050)

Sent through the existing SMS adapter (Termii; the mock provider in
development) to the customer's verified phone, after the commit. Wording
accepted for now ([decision 8](#confirmation-decisions)), with no quality or
delivery promise:

```text
MmiriOma: order MO-7KQ2M9XH4T is confirmed for Tue 27 Oct 2026, 10:00 am to 12:00 pm. Total N45,000.00, pay cash after unloading. Help: +234 813 377 4902
```

The SMS writes "N" for naira: "₦" is not in the GSM-7 SMS alphabet and
would make the message a longer, costlier Unicode SMS.
`status` `accepted` means the provider accepted it, not that it arrived.
No retry in this build: C2 tells the dispatcher to call the customer.

#### GET /admin/orders/{reference}/history (change)

Additive, so the shipped dispatch history keeps working:

- the row 26 entry has `reason_code` `manual_quote`. **The admin client
  must accept this reason code before the backend ships it**: the shipped
  client validates reason codes against a fixed list (#62).
- the row 7 entry written by a confirmation gains `confirmation`:
  `{ "water_category_label", "source_name", "delivery_window": { "start_at", "end_at" }, "total_minor_units", "manual": true }`.
  Every other entry has `confirmation: null`.

#### Amendment (#72): the quote's category id and the source kind

**Status: agreed** (G3) on 2026-10-27 by @chidimmamogbo and @nnamdi-security
(technical lead, contract owner), on PR #132. Proposed by @Daveoski (+ Claude
Code) for the confirm sheet of
[#72](https://github.com/mmiri-oma/mmirioma/issues/72) (prompt 14).
**Built** in [#136](https://github.com/mmiri-oma/mmirioma/issues/136),
part 1 (`AdminOrderQuoteRead` in `orders/schemas.py`, `SourceOptionRead.kind`
in `confirmation/schemas.py`). The rest of this section stays agreed as it
is.

**Gap.** Confirming an order placed with a server quote must send the
quote's `water_category_id`, and for a Tanker order a `source_id` of the
customer's `water_source` kind ([Confirmation rules](#confirmation-rules)).
Neither can be chosen without guessing:

1. `AdminOrderRead.quote.water_category` has `label` and `supported_uses`
   only ([order-details-and-price.md](order-details-and-price.md#orderread-changes)).
   The client could only match the label against the options' categories,
   which breaks if two categories share a label.
2. `ConfirmationOptions` sources carry no `kind`, so the sheet cannot show a
   Tanker order only the sources it may use. The dispatcher would learn only
   from a 422 on `source_id` after confirming.

**Proposal.** Two additive read fields, no change to the confirm request or
its rules:

```json
{ "quote": { "currency": "NGN", "total_minor_units": 2000000,
             "water_category": { "id": "3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b", "label": "Utility Water", "supported_uses": null } } }
```

```json
{ "id": "8e2d4c6b-1a3f-4b5c-9d7e-0f1a2b3c4d5e", "name": "Sample Borehole A", "kind": "borehole", "...": "as today" }
```

| Field | Rule |
| --- | --- |
| `AdminOrderRead.quote.water_category.id` | The id of the category frozen with the quote (FR-024), the one `water_category_id` must equal. **Admin responses only**: the customer's `OrderRead` keeps `label` and `supported_uses` |
| `ConfirmationOptions.categories[].sources[].kind` | The source's kind: `ninth_mile`, `borehole`, or `null` until the technical lead sets it. Where the water is collected, never its quality (FR-014). A `null` kind does not match a Tanker order (as today) |

Additive: a client that ignores the fields keeps working. No new rule,
setting or table: both values are already stored (`quotes.water_category_id`,
`water_sources.kind`).

### Error codes and condition names added by this section

No new error codes. Condition name `delivery_window_set` (the window
typed by the dispatcher, F3); `slot_reserved` stays for slots (FR-025).
Reason code `manual_quote`.

### Data needed

Migrations, reviewed and tested as usual. **Built in #112** (revision
`0011`, [water-sources.md](../features/water-sources.md)): the two tables,
`orders.water_category_id` and the command-line tool. **Built in #113**
(revision `0012`): the SMS columns, `order_price_snapshots` and the
`manual_quote` reason.

- `water_categories`: `id`, `code` (`potable`, `utility`), `label`,
  `supported_uses`, `is_active`, timestamps. Seeded with Potable Water and
  Utility Water (FR-014), labels editable later.
- `water_source_categories` (one activation per source and category):
  `source_id`, `water_category_id`, `status` (`activated`, `suspended`,
  `revoked`), `approved_until` (date), `report_reference` (up to 100),
  `cost_per_litre_minor_units` (BigInteger kobo; never sent to clients, except by
  the admin water-source endpoints, #309),
  `status_reason` (up to 500, for suspended and revoked), timestamps. Unique
  on (`source_id`, `water_category_id`).
- `orders.water_category_id` (nullable foreign key) and
  `orders.confirmation_sms_status`, `confirmation_sms_attempted_at`
  (nullable). `source_id` and the window columns exist.
- `order_price_snapshots`: `order_id`, `event_id` (the row 7 event),
  `total_minor_units` (BigInteger), `currency` `NGN`, `is_manual`,
  `water_category_id`, `water_category_label`, `entered_by`, `entered_at`,
  `customer_agreement_method`, `customer_agreed_at`, timestamps. The
  component columns (water, delivery, handling, margin, rates) come with
  quotes (FR-024). As built it also keeps the `source_id` and window
  confirmed, so the history's confirmation line shows what was agreed even
  if the order's window changes later (a storage detail; the API is as
  above).
- The command-line tool (F1), in `app.modules.sources.cli`, like the
  vehicle tool: add a source; activate it for a category with report
  reference, approved-until date and cost per litre; suspend or revoke an
  activation with a reason. Changes print a summary and write an
  `audit_logs` row.

### Confirmation decisions

Agreed with this section:

1. **One options read** returns every category with every source and its
   reasons, so C1 needs one request and shows "No source available" per
   category without more calls. The pilot has few sources.
2. **Reasons list, R2 unchanged** (Daveoski's question 1 on #87): one check
   gives `reasons`; R2 maps them to its agreed `answer` and `message`.
3. **Audit row** for every confirmation (Daveoski's question 3), like hold
   decisions.
4. **Agreement codes reused** from the hold review (question 4).
5. **`delivery_window_set`, not `slot_reserved`** (question 5): the
   pilot's window is typed, not reserved; slots keep their own name.
6. **The SMS outcome is stored on the order**, so the C2 warning shows
   after a reload, not only in the confirming response.

Decided by the technical lead on 2026-10-22 (review of PR #111), answering
the proposal's four open questions:

7. **No maximum manual quote** (prompt 08 question 4). The server refuses
   only a total that is not a whole naira or is below ₦1.00.
8. **The proposed confirmation SMS wording is accepted for now** (FR-050,
   prompt 08 question 7). A later customer template review may change it;
   that is a template change, not a contract change.
9. **A real order may use a simulated source, for now** (BR-09). There is
   no `simulated_source` reason; `is_simulated` is returned so C1 and C2
   keep the source's Simulated tag. Revisit before real deliveries depend
   on it.
10. **A source that stops being eligible after confirmation does not block
    assigning a driver** (prompt 08 question 5, BR-10). Row 8 and D1 are
    unchanged; the order detail reports the source's current `reasons`, and
    C2 shows its warning with no action.

## Pickup from a recorded source (#109)

Status: **agreed** (G3) on 2026-10-23 by @nnamdi-security (technical lead,
contract owner), with the answers to prompt 10's open questions 1-3 as
marked below. Drafted 2026-10-23 by @Cloudcrackamara from the A2 change on
the driver canvas ("Driver pickup source (#109)", version
`1792747672-774e`, recorded in
driver-deliveries.md,
approved G2 on 2026-10-23). The backend review by @chidimmamogbo and the
driver endpoint owner @Bonvee120 is recorded on the build PR. Not built: the
build is deferred until after the pilot (technical lead, 2026-10-23); until
then the agreed [pickup endpoint](#post-driverjobsreferencepickup) is
unchanged, and a driver at another source types its name.

Carries out [hold review decision 7](#hold-review-decisions): the driver can
send a **recorded source by id**, next to the free-text name; free text stays
for a source that is not in the records and is always `not_eligible`;
administrators do not match a typed name to a record. The source records
exist (#112, PR #115), and R2's eligibility check already answers from
`pickup_records.source_id` (`deliveries.holds.source_eligibility`). Follows
the answers to
prompt 10's
open questions 1-3 (the recommended ones, decided by the technical lead on
2026-10-23); each is marked below.

### Changes

| Item | Change |
| --- | --- |
| `DriverJobDetail.pickup_sources` | **New.** The recorded sources the driver may choose for "Another source on the list" (P1): a list of `{ "id", "name", "approximate_location", "is_simulated" }`, sorted by name, **every** recorded source except the order's assigned source (open question 1, answer a). Sent while the job is accepted and no pickup is recorded, so it is cached with the job for offline use (P-p); otherwise `[]`. Never activations, eligibility, laboratory data, costs or report references (open question 2) |
| `PickupRequest.source` | Gains a third shape, `{ "assigned": false, "source_id": "<uuid>" }`, next to `{ "assigned": true }` and `{ "assigned": false, "name": "..." }`. Exactly one of `source_id` and `name` with `assigned: false` |
| `source_id` rules | An id that is not a recorded source: 422 `validation_error` at `body.source.source_id`. The order's own assigned source sent by id is treated as `{ "assigned": true }`: no hold (open question 3) |
| Effect | `pickup_records.source_id` is the chosen source and `other_source_name` is null (the existing `one_source` CHECK holds). As for a typed name, the job gets hold `source_review` and a `source_mismatch` exception opens (note "Collected at another source: <name>"). The driver sees the same paused screen and server message for a listed and a typed source (open question 2) |
| `DriverJobDetail.pickup.source_id` | Now the source actually used: the assigned source's id, a recorded other source's id, or `null` for a typed name |
| `HoldReview.pickup.used_source` (R2) | Gains `{ "assigned": false, "source_id": "<uuid>", "name": "...", "approximate_location": "..." }`. **Fix needed in the build:** today `used_source` reads `{ "assigned": true }` whenever no typed name exists; it must compare `pickup_records.source_id` with the order's `source_id`. The shape keeps `name`, so the shipped admin client (`frontend/src/lib/api/adminHolds.ts`, which keeps `{ assigned: false, name }` and ignores extra keys) shows it on R2's "Another source: <name>" line unchanged; a client test confirms this before the backend ships |
| `HoldReview.source_eligibility` | No change: it already answers from the recorded source for the order's water category (`eligible` lets the administrator Continue) |

Request example: [driver-pickup-recorded-source-request.json](examples/driver-pickup-recorded-source-request.json).

### Data needed

None new: `pickup_records.source_id` (nullable, foreign key to
`water_sources`) and `water_sources` exist. No migration.

### Build issues (deferred until after the pilot)

1. Backend: `pickup_sources` on the job detail, the third `source` shape,
   the assigned-id rule, and R2's `used_source` fix with tests (T-04).
2. Frontend: A2 and P1 in the driver app, built with the rest of the active
   job (#97), plus a test that the admin client accepts the new
   `used_source`.

## Cancel because the customer asked (#174)

Status: **agreed** (G3) on 2026-10-28 by @nnamdi-security (technical lead), on
PR #203. Proposed by @Cloudcrackamara (+ Claude Code) the same day. The reason
comes from open
question 1 of the [admin order cancellation design](../design/admin-order-cancellation.md#open-questions)
(#129, PR #171), which @chidimmamogbo decided on 2026-10-28 should be opened
now. **Built in #206** (backend, PR #208) and in #207 (the CANCEL dialog's
reason choice, PR #213; design: [admin-order-cancellation.md](../design/admin-order-cancellation.md#change-the-reason-choice-174)).

A customer phoning to cancel is the most common real case. The agreed cancel
accepts only `mmirioma_unable`, so a dispatcher who cancels because the
customer asked would have to record "MmiriOma is unable to deliver", which is
untrue (NFR-004). Row 23 already lists `customer_request`; the endpoints do
not yet accept it. This section makes them accept it, and nothing else about
them changes.

### Changes

| Item | Change |
| --- | --- |
| `GET /admin/orders/{reference}/cancellation-outcome` | `reason_code` may be `customer_request` as well as `mmirioma_unable`. Any other value stays 422 `validation_error` at `query.reason_code` |
| `CancellationOutcome` for `customer_request` | `{ "reason_code": "customer_request", "customer_charge_minor_units": 0, "message": "The customer is not charged for this cancellation." }`: the same sentence and amount as `mmirioma_unable` (decision 1) |
| `POST /admin/orders/{reference}/transition` | `to: cancelled` accepts `reason_code` `customer_request` as well as `mmirioma_unable`. `other` stays 422 (decision 2). `expected_status`, `hold_id` and the 409s are as already agreed |
| `note` | Optional, up to 500 characters, as for `mmirioma_unable`; **required** when `expected_status` is `unloading` (decision 3), for both reasons: a `mmirioma_unable` cancel at `unloading` without a note is now 422 at `body.note` |
| Audit | The `order_events` row for the cancel records `reason_code` `customer_request` and the note, the administrator and the time (NFR-004). The history line is the status change, as for `mmirioma_unable` |
| Effect | The same as an `mmirioma_unable` cancel: the live assignment is `withdrawn`, the job leaves the driver's list (nothing notifies the driver), every open hold closes with `resolution` `cancelled`, and no customer SMS is sent (F10: the administrator tells the customer) |
| Allowed from | Row 23, unchanged: any status except `cancelled`, `delivered` and `disputed`. From those: 409 `invalid_order_transition`, nothing changes |

No new endpoint, path, field or error code. Rows 22 (the customer cancelling
in the app) stays planned.

### Decisions

Decided on PR #203 by @nnamdi-security (technical lead), 2026-10-28; all four
as recommended.

1. **The customer is never charged, for either reason.** FR-044 has a table
   (free before the driver departs; after that only delivery costs actually
   incurred, capped at the disclosed delivery charge), but the pilot has **no
   cancellation or redelivery charge** (fallback F5; the confirmation records
   that the customer was told so, see
   [order-details-and-price.md](order-details-and-price.md), "Potential
   cancellation and redelivery charges"). Every pilot order is pay on delivery
   and no payment is taken before delivery, so there is nothing to refund.
   FR-044's cap applies only once charges are introduced, with a contract
   change. Until then the amount is always `0` and the sentence is the same,
   so the dialog never states a cost the client worked out. The field stays an
   integer in kobo so a later charge needs no shape change. *Agreed.*
2. **`other` is not accepted for a cancel yet.** Row 23 lists it, but no
   case needs it today, and an `other` cancel has no agreed charge rule and no
   meaning to record. Add it with the case that needs it (for example a
   duplicate or abusive order), with its own wording. A dispatcher who cancels
   for a reason that is neither of the two has no honest choice until then,
   which is the safer failure. *Agreed (the alternative, accepting
   `other` with a required note and charge 0, was not chosen).*
3. **`unloading` needs a recorded reason.** FR-044 requires administrator
   review for a cancel once unloading has started. The administrator's cancel
   is that review, so the note is required there and says why; it is optional
   at every other stage. The rule applies to **both** reasons, so a
   `mmirioma_unable` cancel at `unloading` without a note is now refused too
   (422 at `body.note`); this is the one change to that reason. *Agreed; scope
   (both reasons) confirmed by the technical lead on PR #208.*
4. **The sentence is the server's.** As today, the client shows `message` as
   written and never works out an amount. A client that does not know the
   reason code still shows the server's sentence. *Agreed.*

### Acceptance test (T-26, pilot form)

T-26 ("customer cancels at each stage, prepaid and pay on delivery; charge or
refund matches the FR-044 table") is met for the pilot as: an administrator
cancels at the customer's request from each cancellable status, `quote_requested`
through `unloading` and `failed`, on a pay-on-delivery order; the outcome is
`0` with the server's sentence; the order is `cancelled` with
`reason_code` `customer_request` in its event; the assignment is withdrawn and
every open hold is closed. Also tested: 409 from `cancelled`, `delivered` and
`disputed`; 422 for `other`; 422 when the note is missing at `unloading`;
and that `mmirioma_unable` behaves as before except for the `unloading` note
rule (decision 3), which applies to it too. The prepaid half of T-26
needs payments before delivery, which the pilot does not have; it waits for
charges.

### Build issues

1. Backend: accept `customer_request` on the outcome and the transition, the
   `unloading` note rule, and the tests above.
2. Frontend: the CANCEL dialog offers the reason (a G2 change to the
   [#128 / #129 dialog](../design/admin-order-cancellation.md)): "The
   customer asked" and "MmiriOma is unable to deliver", neither chosen by
   default, Cancel order off until one is chosen. Wording is approved with the
   design, not here. The adapter, the dialog and the history label ("Customer
   asked to cancel") follow.

## Planned endpoints (not agreed)

Shapes follow SRS §6. They are agreed with the feature that builds them.

| Method | Path | Rows | With |
| --- | --- | --- | --- |
| POST | `/admin/orders/{reference}/transition` `{to, reason_code, note}` | 7, 12-16, 20 (`customer_unreachable`, `vehicle_failure`), 21, 23 (`other`; `customer_request` is agreed in [#174](#cancel-because-the-customer-asked-174)), 25 | admin dispatch design-ahead screens (A1-A7). Fail and `mmirioma_unable` cancel are agreed in the [hold review endpoints](#post-adminordersreferencetransition-fail-and-cancel); confirming (rows 26 and 7) is agreed and built in the [order confirmation endpoints](#order-confirmation-endpoints) (#113) |
| POST | `/orders/{reference}/cancel` | 22 | cancellation |

## Open questions

1. ~~How long a driver has to answer an offer before it expires (row 10).~~
   Decided 2026-10-19: no automatic expiry for now; the dispatcher withdraws.
2. ~~Whether a driver may mark "customer unreachable" before the full
   10 minutes.~~ Decided 2026-10-19 (#55, SRS v0.3 FR-038): no. Two
   contact attempts and the full 10 minutes from arrival (row 19).
3. ~~Whether a vehicle that is already loaded skips `collected`.~~ Decided
   2026-10-19 (#55): only when the system explicitly supports that
   scenario, and the water source, quantity and collection confirmation are
   still recorded, keeping the delivery history auditable. Nothing supports
   it yet, so every order still passes through `collected` (row 13).
4. ~~How long after delivery a customer may open a dispute.~~ Decided
   2026-10-19 (#55, BR-16): ordinary disputes within 48 hours after
   delivery; only safety and suspected-contamination complaints
   (`water_quality`) at any time. `missing_quantity`, `handling` and
   `other` follow the 48 hours (row 24).
5. ~~When the delivery code is activated.~~ Decided 2026-10-19 (#67):
   after unloading, once the driver records unloading complete. The
   10-minute validity is final (team decision, same day).
