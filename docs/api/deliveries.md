# Deliveries contract: state machine and assignments

Requirements: FR-001, FR-002, FR-012, FR-013, FR-031, FR-032, FR-033, FR-034,
FR-035, FR-036, BR-03, BR-06, BR-10, NFR-002, NFR-004, SRS §5, SRS §8 ·
Acceptance tests: T-07, T-08, T-12 · Issue: S1-06 (#7)

Status: **part 1 proposed** (state machine), for review by @nnamdi-security
(technical lead) and @chidimmamogbo (orders, S1-03). **Part 2 (driver
endpoints) not started:** it is derived from the approved driver design
(S1-15, `docs/design/driver-deliveries.md`), which does not exist yet. The
contract becomes `agreed` (G3) only when both parts are reviewed.

This document is the source of truth for the delivery phase of an order: from
`confirmed` (ready for dispatch) to `delivered`, `failed` or a return to the
dispatcher queue. The order statuses themselves, and the rows before
`confirmed`, are in [orders.md](orders.md); this document does not rename or add
order statuses.

## Contents

1. [Concepts](#concepts)
2. [Assignment statuses](#assignment-statuses)
3. [Order transitions in the delivery phase](#order-transitions-in-the-delivery-phase)
4. [Guards in detail](#guards-in-detail)
5. [Exceptional paths](#exceptional-paths)
6. [Who sees what](#who-sees-what)
7. [Recording and audit](#recording-and-audit)
8. [Errors](#errors)
9. [Concurrency and idempotency](#concurrency-and-idempotency)
10. [Proposed objects and mock JSON](#proposed-objects-and-mock-json)
11. [Part 2: driver endpoints (pending S1-15)](#part-2-driver-endpoints-pending-s1-15)
12. [What is built when](#what-is-built-when)
13. [Decisions](#decisions)
14. [Open questions](#open-questions)

## Concepts

| Term | Meaning | Source |
| --- | --- | --- |
| Order status | The single status of the order, as in [orders.md](orders.md#order-statuses-fr-033) | FR-033 |
| Assignment | One offer of one order to one driver. Every offer is a new row; rows are never deleted, so the assignment rows **are** the assignment history | SRS §5 `assignments` |
| Active assignment | An assignment in `offered` or `accepted`. An order has **at most one** at a time | FR-031 |
| Pickup record | Actual source, pickup time, source reference and volume collected | FR-034, SRS §5 `pickup_records` |
| Delivery proof | Delivery time, volume delivered, receiver acknowledgement, unloading confirmation | FR-035, BR-06, SRS §5 `delivery_proofs` |
| Exception | An incident recorded against an order (late, unsafe access, ...) | FR-036, SRS §5 `exceptions` |
| Dispatcher | A user with role `admin` ([auth.md](auth.md)). The SRS "Dispatcher/Admin" role | FR-001 |

Two state machines run side by side: the **order** status (what the customer
and dispatcher track) and the **assignment** status (what happened to each
offer to a driver). Every order transition in the delivery phase changes the
active assignment in the same database transaction, as the tables below say.

## Assignment statuses

Stored as an explicit enumeration (SRS §5 "explicit status enumerations").

| Status | Meaning | Terminal | Order status while in it |
| --- | --- | --- | --- |
| `offered` | Dispatcher assigned the order to this driver; the driver has not answered. Not an acceptance (FR-032) | no | `assigned` |
| `accepted` | The driver accepted. This driver now owns the job | no | `accepted`, `collected`, `en_route` |
| `declined` | The driver declined the offer | yes | (order back to `confirmed`) |
| `timed_out` | The dispatcher recorded that the driver did not answer in time (FR-032 "timeout") | yes | (order back to `confirmed`) |
| `withdrawn` | This driver's involvement ended before delivery: reassignment, cancellation or failure of the order, or the driver's account was deactivated | yes | `confirmed`, `cancelled` or `failed` |
| `completed` | This assignment delivered the order with proof, in full or short | yes | `delivered` or `disputed` |

`timed_out` is set by a dispatcher, not by a timer (decision 1): the SRS gives
no response deadline, and the MVP has no automatic expiry. The dispatcher
dashboard shows how long each offer has been waiting.

### Assignment transitions

| From | To | Who | Caused by order transition |
| --- | --- | --- | --- |
| (none) | `offered` | admin | `confirmed → assigned` |
| `offered` | `accepted` | the offered driver | `assigned → accepted` |
| `offered` | `declined` | the offered driver | `assigned → confirmed` (decline) |
| `offered` | `timed_out` | admin | `assigned → confirmed` (timeout) |
| `offered` | `withdrawn` | admin | `assigned → confirmed` (reassign), `assigned → cancelled`, `assigned → failed` |
| `accepted` | `withdrawn` | admin | `accepted`/`collected`/`en_route → confirmed` (reassign), `→ cancelled`, `→ failed` |
| `accepted` | `withdrawn` | the assigned driver or admin | `en_route → failed` (D14, customer cannot be reached) |
| `offered`, `accepted` | `withdrawn` | system, when an admin deactivates the driver | `→ confirmed` (D13) |
| `accepted` | `completed` | the assigned driver or admin | `en_route → delivered` (D8) or `en_route → disputed` (D12) |

No other assignment transition exists. A terminal assignment is never reopened;
offering the order to the same driver again creates a new `offered` row, except
that a driver who **declined** an order is never offered that order again
(decision 5, G-driver).

## Order transitions in the delivery phase

This table **replaces** the delivery-phase rows of the
[orders.md transition table](orders.md#transitions-proposed) (`confirmed →
assigned` onwards, and `failed`). Rows before `confirmed`, `cancelled` and
`delivered → disputed` stay owned by orders.md and are repeated here only for
the effect on the assignment. D12 (`en_route → disputed`) and D13 (driver
deactivation) are new delivery-phase rows.

"Assigned driver" means the driver of the order's active assignment. Any other
driver is treated as having no access to the order at all (FR-001, T-07; see
[Errors](#errors)).

| # | From | To | Who | Guards (all must hold) | Assignment effect | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | `confirmed` | `assigned` | admin | G-driver, G-capacity, G-source, no active assignment | new row `offered` | no |
| D2 | `assigned` | `accepted` | assigned driver | assignment is `offered`; driver still active (FR-002) | `offered → accepted`, sets `accepted_at` | no |
| D3 | `assigned` | `confirmed` | assigned driver (decline) | assignment is `offered` | `offered → declined`, sets `declined_at` | **required** |
| D4 | `assigned` | `confirmed` | admin (timeout) | assignment is `offered` | `offered → timed_out` | no |
| D5 | `assigned`, `accepted`, `collected`, `en_route` | `confirmed` | admin (reassign) | active assignment exists | active `→ withdrawn` | **required** |
| D6 | `accepted` | `collected` | assigned driver or admin | G-pickup, G-source | none | no |
| D7 | `collected` | `en_route` | assigned driver or admin | G-no-blocking-exception | none | no |
| D8 | `en_route` | `delivered` | assigned driver or admin | G-proof, G-no-blocking-exception, delivered volume **not below** the ordered volume | `accepted → completed` | no |
| D9 | `assigned`, `accepted`, `collected`, `en_route` | `failed` | admin | none | active `→ withdrawn` | **required** |
| D14 | `en_route` | `failed` | assigned driver or admin ("Mark as delivery attempt failed") | customer cannot be reached at delivery after the retry steps: **two calls** to the contact phone and a **10-minute wait** at the address (decision 8). The driver confirms both in the request; the server records the confirmation but cannot verify phone calls, so it never shows them as verified | active `→ withdrawn`; a `customer_unavailable` exception is recorded | **required** note |
| D10 | any non-terminal | `cancelled` | admin | none (orders.md) | active (if any) `→ withdrawn` | **required** |
| D11 | `delivered` | `disputed` | customer or admin | none (orders.md, T-12) | none (stays `completed`) | **required** |
| D12 | `en_route` | `disputed` | as D8 (short delivery) | G-proof, G-no-blocking-exception, delivered volume **below** the ordered volume | `accepted → completed` | set by the server (see notes) |
| D13 | `assigned`, `accepted`, `collected`, `en_route` | `confirmed` | system, in the same transaction as an admin deactivating the driver | the order's active assignment belongs to that driver | active `→ withdrawn` | set by the server: "Driver account deactivated" |

Notes:

- **Decline returns the order to the dispatcher queue** (`assigned →
  confirmed`), as SRS §8 says: "Assignment returns to dispatcher; customer is not
  told driver accepted". This answers [orders.md](orders.md#open-questions) open
  question 3. The order keeps no driver; the declined assignment row keeps the
  history.
- **Reassignment (D5) is "back to the queue, then assign again"**: the
  dispatcher withdraws the active assignment (D5) and assigns a driver (D1).
  The two steps are separate transitions so each is validated and logged, and
  so a failed second step never leaves the order without a recorded state.
  FR-036 allows reassignment without limiting the status, so D5 is allowed up
  to `en_route`. When an order that was `collected` or `en_route` is
  reassigned, the new driver must record a new pickup (D6): the earlier pickup
  record stays as history but does not satisfy G-pickup for the new
  assignment.
- **Drivers set `failed` only when the customer cannot be reached (D14,
  decision 7)**, and never `cancelled`. For any other problem the driver
  reports an exception (FR-036) and the dispatcher decides between reassigning
  (D5), failing (D9) or cancelling (D10), matching SRS §8 ("Driver reports
  unsafe transfer: stop work; dispatcher handles safe alternative").
- **"Mark as delivery attempt failed" (D14)** uses the existing terminal
  `failed` status (orders.md: "Delivery attempt failed"); there is no new
  status. It is allowed only from `en_route`, when the driver is at the
  delivery address. In one transaction it records a `customer_unavailable`
  exception with the driver's note, ends the assignment and fails the order.
  The customer sees "Delivery failed". A redelivery is a **new order**
  (decision 9): `failed` stays terminal and is never reopened. Money already
  paid is never forfeited automatically (decision 11).
- **The admin may record pickup (D6), departure (D7) and delivery (D8)**
  because FR-034 says
  "Driver or dispatcher" records the pickup, and SRS §8 lets a driver without
  connectivity hand notes over "for later supervised entry". The guards are the
  same as for the driver; the event records the admin as actor.
- **`delivered` is terminal for fulfilment.** D11 `disputed` is the only way
  out of it, and how a dispute is resolved is not decided (orders.md).
- There is no `delivered` without G-proof for **any** role (BR-06, T-08).
- **A short delivery goes straight to `disputed` (D12, decision 2).** The
  driver submits the same proof as for D8; the server compares the delivered
  volume with the ordered volume and picks D8 or D12. The client does not
  choose. The event reason is set by the server and states both volumes (for
  example "Delivered 150 L of 200 L ordered"). The ordered quantity is never
  recorded as delivered (SRS §8). The driver's job is finished either way
  (assignment `completed`); the dispute is the dispatcher's to resolve.
- **Deactivating a driver withdraws their jobs at once (D13, decision 4).**
  The deactivation and every D13 transition commit in one database
  transaction, so no moment exists where an inactive driver still holds a job.
  The event actor is the admin who deactivated the driver (null when done from
  the staff CLI, as a system action). Orders return to the dispatcher queue;
  `collected` and `en_route` orders need a new pickup by the next driver, as
  with D5.

## Guards in detail

Guards marked *(later)* depend on data that does not exist yet (drivers'
vehicle profiles, sources, slots). Until that data exists the guard cannot be
checked, so the transitions that need it are not built (see
[What is built when](#what-is-built-when)). The system must never pretend a
guard passed.

| Guard | Rule | Source |
| --- | --- | --- |
| G-driver | Target user exists, has role `driver` and is active, and has never declined this order (decision 5). Deactivated drivers cannot be assigned and cannot accept | FR-002, FR-031 |
| G-capacity *(later)* | The order's quantity fits the driver's verified safe payload, the driver serves the order's zone, is available for the order's window and can handle its transfer method. The driver's other active assignments are counted, so concurrent assignments cannot overcommit the driver. Orders above any single driver's capacity go to assisted quotation, never auto-assignment | FR-013, FR-031, BR-03, T-03 |
| G-source *(later)* | The order's source and water category are currently eligible (approved, in date, not revoked). Checked at assignment (D1) **and** again at pickup (D6), so a source revoked before the water is collected blocks the job. **Not** checked after pickup: a revocation does not block D7, D8 or D12 for water already collected (decision 3) | FR-012, BR-10, T-04, SRS §8 |
| G-pickup | A pickup record for the **current** assignment exists with source, pickup time and volume collected (source reference optional). If the source differs from the order's assigned source, or a safety concern is flagged, a blocking exception (`source_mismatch` or `source_quality_concern`) is opened automatically | FR-034 |
| G-no-blocking-exception | The order has no unresolved blocking exception (see [Exceptional paths](#exceptional-paths)) | FR-034, SRS §8 |
| G-proof | A delivery proof for the current assignment exists with: delivery time, volume delivered (whole litres, entered by the driver, never prefilled with the ordered quantity), receiver's name, receiver acknowledgement and `unloaded_by_driver = true`. How the receiver acknowledges is not settled for this contract (open question 2) | FR-035, BR-04, BR-06, T-08 |

## Exceptional paths

Exceptions (FR-036) are records, not order statuses: recording one never changes
the order status by itself. The dispatcher then takes a transition from the
table above. This avoids adding statuses the SRS does not list (FR-033).

| Category | Reported by | Blocking | Usual dispatcher outcome | Source |
| --- | --- | --- | --- | --- |
| `late` | driver or admin | no | Record reason; agree a revised window with the customer (needs customer acknowledgement, BR-05) | FR-036, SRS §8 |
| `missing` | admin or customer (via dispute) | no | Investigate; D11 if already delivered | FR-036 |
| `incorrect_volume` | driver or admin | no | Wrong volume noticed outside the proof step (for example at pickup). A short delivery itself moves the order to `disputed` (D12) | FR-036, SRS §8 |
| `unsafe_access` | driver or admin | **yes** | Stop work; D5 reassign, D9 fail or D10 cancel | FR-036, SRS §8 |
| `unsafe_transfer` | driver or admin | **yes** | Stop work; dispatcher arranges a safe alternative | SRS §8, PRD §8 |
| `source_quality_concern` | driver or admin | **yes** | Dispatcher review before continuing | FR-034, FR-036 |
| `source_mismatch` | system (at pickup) | **yes** | Dispatcher review before continuing | FR-034 |
| `vehicle_failure` | driver or admin | no | Usually D5 reassign | FR-036 |
| `customer_unavailable` | driver or admin | no | Recorded by D14 when the attempt is marked failed (decision 7). May also be recorded alone (for example "running late, customer not answering") without failing the order | FR-036, SRS §8 |

A blocking exception stays blocking until an admin resolves it with a
resolution note; resolution is logged (NFR-004). Exception endpoints and the
exact fields are defined later with the dispatcher incident screens.

Edge cases from SRS §8:

| Case | Behavior |
| --- | --- |
| Driver declines | D3. Order back to `confirmed`, customer still sees "Confirmed" (FR-032) |
| Driver does not answer | Dispatcher records D4. No automatic timeout (decision 1) |
| Approved source revoked | New assignments (D1) and pickups (D6) blocked by G-source. Water already collected is still delivered: D7, D8 and D12 are not blocked (decision 3) |
| Driver deactivated with active jobs | Their active assignments are withdrawn and the orders return to `confirmed` in the same transaction (D13, decision 4). They lose access to job data at once (FR-002) |
| Partial delivery | D12: order goes straight to `disputed` with the real delivered volume. The ordered quantity is never recorded as delivered (decision 2) |
| Driver declined, order needs a new driver | Any active driver except those who declined this order (decision 5) |
| Customer cannot be reached | Driver or admin marks the delivery attempt failed (D14): order `failed` with a `customer_unavailable` exception (decision 7) |
| Unsafe transfer reported | Blocking exception; D7 and D8 refused until resolved |
| Customer disputes missing volume | D11 with reason, event history kept (T-12) |
| App offline | Nothing changes on the server until a request arrives; no client-side status is treated as real. An admin may enter the driver's notes later (D6-D8, D14 by admin) |

## Who sees what

Data minimization: no role sees more customer detail than its task needs
(PRD §4, FR-001).

| Role | Sees |
| --- | --- |
| Customer | Order status mapped as in [orders.md](orders.md#order-statuses-fr-033). `assigned` is shown as "Confirmed" until the driver accepts (FR-032). No driver identity before `accepted`; no live location ever (FR-037) |
| Driver | Only orders where they hold an **active** assignment: receiver's first name and last initial, delivery address, landmark, instructions, quantity, window, source, and a phone number to call the receiver while the job is active. Once their assignment is `declined`, `timed_out` or `withdrawn` they lose access to the order's details (FR-001). Whether a driver keeps a minimal summary of their own `completed` jobs is decided with the driver design (part 2) |
| Admin | Everything above plus all assignment rows (history), exceptions, pickup records and proofs |

## Recording and audit

Every delivery-phase transition, in **one** database transaction:

1. locks the order row (see [Concurrency](#concurrency-and-idempotency));
2. checks role, prior status and guards;
3. updates the order status and the assignment status (if any);
4. writes one `order_events` row: `actor_id`, `from_status`, `to_status`,
   `reason` (NFR-004; table from S1-03).

Assignment rows keep their own timestamps: `created_at` (offered), `accepted_at`,
`declined_at` and `ended_at` (when `timed_out`, `withdrawn` or `completed`), and
the `assigned_by` admin. SRS §5 lists `accepted_at`, `rejected_at`; this contract
calls the second `declined_at` to match the status name. The physical schema is
decided in S1-07 against this contract.

Reasons are trimmed free text, 1-500 characters, required where the table says
so. Decline reason categories (for example "Vehicle cannot carry this
quantity") come from the driver design in part 2; the server will store a
category plus an optional note once agreed.

## Errors

Error envelope and shared codes: [README](README.md#errors). Domain codes
proposed for the delivery phase:

| Status | `code` | When |
| --- | --- | --- |
| 403 | `forbidden` | The role may never take this transition (for example a customer assigning, a driver failing an order) |
| 404 | `order_not_found` | A driver addresses an order they hold no active assignment for. Same response as an order that does not exist, so drivers cannot probe other jobs (FR-001, NFR-002, T-07) |
| 409 | `invalid_order_transition` | The order's current status does not allow this transition (FR-033). Shared with [orders.md](orders.md) |
| 409 | `offer_no_longer_available` | The driver answers an offer that was already withdrawn, timed out or declined. Lets the driver screen say "This offer is no longer available" instead of a generic error |
| 409 | `order_already_assigned` | D1 while the order already has an active assignment (two dispatchers assigning at once) |
| 409 | `driver_not_eligible` | G-driver or G-capacity failed. `details` is a list of reason codes: `not_found`, `not_a_driver`, `inactive`, `declined_this_order`, and later `capacity_exceeded`, `outside_service_area`, `unavailable`, `handling_not_supported` |
| 409 | `source_not_eligible` | G-source failed *(later)* |
| 409 | `pickup_record_required` | D6 without a pickup record for the current assignment |
| 409 | `dispatcher_review_required` | D7 or D8 while a blocking exception is unresolved |
| 409 | `delivery_proof_required` | D8 or D12 without a complete delivery proof (T-08) |
| 409 | `delivery_attempt_failed_not_allowed` | D14 when the order is not `en_route` |
| 422 | `validation_error` | Missing or invalid reason or body fields |

Messages never include another user's personal data. Examples:
[error-invalid-order-transition.json](examples/error-invalid-order-transition.json),
[error-delivery-proof-required.json](examples/error-delivery-proof-required.json).

## Concurrency and idempotency

- **One writer per order.** Each transition reads the order with `SELECT ...
  FOR UPDATE` and checks the prior status after taking the lock, so two
  conflicting requests (a decline and a withdrawal, two dispatchers assigning)
  cannot both apply. The loser gets the matching 409.
- **At most one active assignment per order**, enforced by the database (a
  partial unique index on `order_id` where status is `offered` or `accepted`),
  not only by application code (FR-031).
- **No overcommitted driver** *(later, with G-capacity)*: the driver's active
  assignments are counted under a lock on the driver's row, with no `await`
  between the check and the insert (see the rate-limit entry in `LOG.md` for
  why).
- **Repeated requests are safe (NFR-011, NFR-022).** If the order is already in
  the requested target status **through the same actor's same assignment**
  (for example a driver's double-tapped Accept), the server returns success
  with the current state and writes no new event. Any other mismatch is a 409.

## Proposed objects and mock JSON

Shapes are proposed and frozen only at G3, after the driver and dispatcher
screens are mapped (part 2).

Assignment, admin view ([examples/assignment.json](examples/assignment.json)):

```json
{
  "id": "7d2c9e41-3b6a-4f0e-9c18-5a4b3c2d1e0f",
  "order_reference": "MO-7KQ2M9XH4T",
  "driver": { "id": "a41f0c9b-6e2d-4b7a-8f35-0d9c8b7a6e51", "name": "Sample Driver" },
  "status": "declined",
  "assigned_by": { "id": "c9e8d7f6-5a4b-4c3d-9e2f-1a0b9c8d7e6f", "name": "Sample Dispatcher" },
  "reason": "Vehicle cannot carry this quantity",
  "created_at": "2026-10-16T08:00:00Z",
  "accepted_at": null,
  "declined_at": "2026-10-16T08:12:00Z",
  "ended_at": null
}
```

`reason` holds the decline reason, or the dispatcher's reason when the
assignment was withdrawn. It is null otherwise.

## Part 2: driver endpoints (pending S1-15)

Not written. Per the [process](../process/ui-driven-development.md), driver
endpoints are derived from the approved driver design's screen-to-endpoint
table. Until `docs/design/driver-deliveries.md` says `Status: approved`, no
driver endpoint is specified or built. SRS §6 suggests `POST
/admin/orders/{id}/assign`, `POST /driver/jobs/{id}/accept`, `POST
/driver/jobs/{id}/transition` and `POST /driver/jobs/{id}/proof`; those names
are illustrative only (SRS §6 heading).

## What is built when

| Rows / guards | Built in | Blocked by |
| --- | --- | --- |
| D1 (G-driver only), D2, D3, D4, D13 | S1-07 (#8) | This contract agreed (G3), driver design for the driver side. D13 hooks into driver deactivation in the auth module through a deliveries service function |
| G-capacity, G-source | later | Vehicle profiles (FR-013), sources (FR-011, FR-012); PRD §13.2-13.3 open |
| D5, D9, D10 | later | Dispatcher screens for reassign, fail, cancel |
| D6, D7, D8, D12, D14, exceptions | later | Driver design ahead screens; receiver acknowledgement method (open question 2) |
| D11 | later | Dispute resolution (orders.md) |

Until G-capacity exists, S1-07 may only assign with the checks it can really
make (G-driver), and the dispatcher screen must not claim that capacity was
checked. That limitation is recorded in S1-07's feature document.

## Decisions

Answered by @Bonvee120 (S1-06 owner) on 15 Oct 2026 (decisions 6-11 the same day). They are still part of
the contract review by the technical lead and Chidinma.

1. **Offer timeout:** no automatic expiry in the MVP. The dispatcher records the
   timeout (D4).
2. **Short delivery:** the order goes straight to `disputed` (D12), not to
   `delivered`.
3. **Source revoked after pickup:** delivery is not blocked. G-source still
   applies at assignment (D1) and pickup (D6).
4. **Driver deactivated with active jobs:** their jobs are withdrawn
   immediately, in the same transaction as the deactivation (D13).
5. **Driver who declined:** is never offered the same order again (G-driver,
   `declined_this_order`).

6. **Proof of delivery: customer delivery code, deferred.** A one-time
   customer code was chosen as the primary method, then taken out of this
   contract because no approved design includes it. It returns, with its own
   contract change, once the customer and driver designs show it. Settings
   already agreed for that time: see decision 10.
7. **Customer cannot be reached:** the driver or an admin marks the delivery
   attempt failed (D14). The order goes to the existing `failed` status.
8. **Retry steps before D14:** two calls to the contact phone and a 10-minute
   wait at the address.
9. **Redelivery:** a new order. A `failed` order is never reopened.
10. **Delivery code settings (deferred with decision 6):** 4 digits; 5 wrong
    attempts lock the code. Attempts must be counted in the same step as the
    check (see the rate-limit entry in `LOG.md`).
11. **Money paid for a failed or cancelled order:** never forfeited
    automatically. Refunds or credits follow the cancellation policy disclosed
    to the customer. No funds move automatically; staff act on a flag (FR-043).

## Open questions

1. **Cancellation policy.** Decision 11 depends on it; it will be written
   later, before payments are recorded (SRS §12.5, PRD §13.6).
2. **Receiver acknowledgement for D8 and D12** (FR-035, SRS §12.7). With the
   delivery code deferred, which method does the driver design use: the
   dispatcher confirming by phone, or another FR-035 method? Decide with the
   driver design (S1-15) before D8 and D12 are built.
