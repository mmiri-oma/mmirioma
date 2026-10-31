# Admin dispatch

Requirements: FR-030, FR-031, FR-032, FR-033, FR-036, BR-03, BR-09, NFR-004,
NFR-020, NFR-021, NFR-022 · Acceptance tests: T-07 · Contract:
[deliveries.md](../api/deliveries.md#admin-dispatch-endpoints), "Admin
dispatch endpoints" (agreed, G3, PR #59) · Design:
admin-dispatch.md (approved, G2, canvas
`1792429309-2405`) · Issues: #61 (backend), #62 (screens)

## 1. Overview and purpose

The dispatcher's endpoints and screens for offering a confirmed order to a
driver, seeing where the offer stands, taking the job back, and reading the
order's history. They sit on the assignment services built in S1-07
([driver-assignment.md](driver-assignment.md)) and cover the approved design's
build-now screens:

| Screen | What the dispatcher sees |
| --- | --- |
| D1 Assign driver | Dialog (full-screen sheet below 768 px): drivers in two groups, "Can take this order (n)" with an "Available" badge and "Cannot take this order (n)" with their reasons; the button reads "Choose a driver" until one is chosen, then "Offer to <driver>" |
| D2 Offer waiting | Dispatch card "Offered to <driver>", "Tanker truck, safe payload 3,000 L", "Offered 25 minutes ago", "Fri 16 Oct 2026, 10:05 am (Lagos time)", "<driver> has not accepted yet.", Withdraw offer, "The offer stays open until the driver replies or you withdraw it." |
| D3 Driver declined | Warning banner "<driver> declined", time, decline reason, "Driver’s note: “…”", Assign another driver; card "No driver holds this order. It is back to Confirmed." |
| D4 Driver accepted | "Accepted by <driver>" with an "Accepted" chip, accepted time, "The driver has not left yet.", Withdraw job; from Driver departed on, a "Departed" chip, "Left <time>", no withdraw and a one-line reason |
| D5 Withdraw | Dialog "Withdraw this offer?" / "Withdraw this job?" with an optional note and a "0 / 500" counter |
| H1 History | Timeline, newest first, "N entries" or "Showing latest 10 of N", "Show all N entries" |

The copy, groups and states follow the team canvas (Dispatch01-07 and the
Dispatch13 summary), checked one artboard at a time.

The screens are part of the existing admin order detail page and do not
restyle it (design Decision 6). The status badges, the 15-option status
filter and the "Phone verified" wording are a separate issue.

## 2. Feature workflow

```
D1  GET  /admin/orders/{ref}/drivers   every driver + reasons[] for this order
    POST /admin/orders/{ref}/assign    {driver_id}
         offer_order ─> assign_driver (lock order, lock driver profile,
         eligibility, INSERT assignment "offered", transition confirmed → assigned
         with the event linked to the assignment) ─> COMMIT ─> fresh detail
D2-4 GET /admin/orders/{ref}           AdminOrderDetail: order + most recent assignment
D5  POST /admin/orders/{ref}/withdraw  {expected_status, note}
         holds.withdraw_job ─> withdraw_assignment (lock order, live assignment?
         status == expected_status? transition → confirmed, reason reassigned,
         event linked) ─> close the job's open holds (#93) ─> COMMIT ─> fresh detail
H1  GET  /admin/orders/{ref}/history   every event, newest first, with names
```

The driver answers through the driver app: decline is
`POST /driver/jobs/{reference}/decline` ([driver-jobs.md](driver-jobs.md));
accept is planned in #51 (the service, `accept_assignment`, exists).

**On the order detail page (frontend):**

```
AdminOrderDetailPage
  DispatchSection            view from order.status + assignment (view.ts)
    confirmed, no live driver  "No driver yet" ─ Assign driver ─> AssignDriverDialog (D1)
    confirmed, last declined   DeclinedBanner (D3) ─ Assign another driver ─> D1
    assigned + offered         OfferWaiting (D2) ─ Withdraw offer ─> WithdrawDialog (D5)
    accepted + accepted        DriverAccepted (D4) ─ Withdraw job ─> D5
    departed…unloading         DriverAccepted, no withdraw
  OrderHistory (H1)           its own request; Retry on failure
```

Assign and withdraw put the returned order straight into the detail cache
(the page redraws without a second request) and mark the history and the
directory as stale. A success closes the dialog and shows a toast: "Offered
to <driver>. Waiting for the driver to accept." or "Offer withdrawn. <ref>
is back to Confirmed." ("Job withdrawn." for an accepted job).

Focus: Cancel, X and Escape return focus to the button that opened the
dialog. After a withdrawal, focus moves to Assign driver (the Withdraw button
is gone). After "This order has changed." and Refresh, the dialog closes, the
order reloads and focus moves to the order heading. "Show all N entries" moves
focus to the first entry that appeared.

## 3. Important files

| File | Responsibility |
| --- | --- |
| `backend/app/modules/dispatch/router.py` | The driver list; `CurrentAdmin`; thin handlers |
| `backend/app/modules/deliveries/admin_router.py` | The detail, assign, withdraw and history routes (moved here with the hold review, #93, because they show or close the job's hold; assign followed in #280, because its response carries the contact attempts); see [admin-hold-review.md](admin-hold-review.md) |
| `backend/app/modules/dispatch/schemas.py` | `AssignRequest`, `WithdrawRequest`, `AdminOrderDetail`, `AdminAssignment`, `DispatchDriver`, `AdminOrderEvent` and their wrappers |
| `backend/app/modules/dispatch/service.py` | Admin views: `get_dispatch_order`, `list_drivers_for_order`, `offer_order`, `order_history`; `withdraw_assignment` with `expected_status` (and `commit=False`, so the hold review can close holds in the same transaction); events linked to assignments |
| `backend/app/modules/deliveries/holds.py` | `withdraw_job` (withdraw plus closing the job's holds), `get_order_detail`, `contact_attempt_times` (the detail's `contact_attempts`, #280), `order_history` with optional hold entries |
| `backend/app/modules/orders/service.py` | `transition_order(..., assignment_id=...)`, `list_order_events` |
| `backend/app/modules/orders/models.py` | `OrderEvent.assignment_id` |
| `backend/app/modules/auth/service.py` | `list_users_by_role` (driver accounts for D1) |
| `backend/app/modules/orders/router.py` | Customer order endpoints only; the admin list and detail are in the deliveries admin router (#93) |
| `backend/alembic/versions/20261019_0008_add_order_event_assignment.py` | Migration `0008` |
| `docs/api/examples/admin-order-detail.json`, `admin-order-detail-failed.json` (a failed order with two contact attempts), `dispatch-drivers.json`, `admin-order-history.json`, `error-driver-not-eligible.json`, `error-assignment-not-found.json` | Contract samples; the API tests compare responses with them |

Modules depend one way: orders, then dispatch, then deliveries. The admin
detail, assign, withdraw and history first lived in the dispatch router
because they add the assignment. Since the hold review (#93) the detail,
withdraw and history also show or close the job's hold, which the deliveries
module owns, so they are served by the deliveries admin router; their services
stay in dispatch (technical lead, 2026-10-21). `assign` moved there too in
#280, because every `AdminOrderDetail` carries the order's contact attempts,
which deliveries owns, and dispatch must not import deliveries (technical
lead, 2026-10-30). Paths and shapes are unchanged, apart from the additive
`hold` and `contact_attempts` fields and the history's `include=holds`.

Frontend:

| File | Responsibility |
| --- | --- |
| `frontend/src/lib/api/adminDispatch.ts` | Types, Zod schemas and typed calls for the five endpoints, through `client.ts` |
| `frontend/src/features/admin-orders/source.ts` | `AdminOrdersSource`: `getOrder` returns `AdminOrderDetail`; `listDrivers`, `assignDriver`, `withdraw`, `getHistory` |
| `frontend/src/features/admin-orders/apiAdminOrdersSource.ts` | The source backed by the API |
| `frontend/src/features/admin-orders/mockAdminOrders.ts`, `mockDispatch.ts` | The mock source: fictional drivers, live and declined assignments, a 15-entry history; offers and withdrawals follow the contract's rules |
| `frontend/src/features/admin-dispatch/DispatchSection.tsx` | Dispatch card (D2, D4, "No driver yet"), decline banner (D3), dialogs and toasts |
| `frontend/src/features/admin-dispatch/view.ts` | Which dispatch view an order shows |
| `frontend/src/features/admin-dispatch/AssignDriverDialog.tsx` | D1 with the driver choice rows and reason lists |
| `frontend/src/features/admin-dispatch/WithdrawDialog.tsx` | D5 |
| `frontend/src/features/admin-dispatch/OrderHistory.tsx` | H1 with the history timeline |
| `frontend/src/features/admin-dispatch/DispatchErrorAlert.tsx`, `errors.ts` | Error states chosen by error code (Decision 5) |
| `frontend/src/features/admin-dispatch/labels.ts` | Eligibility (Decision 3), reason (Decision 4), decline reason (J2-b) and history wording |
| `frontend/src/features/admin-dispatch/time.ts` | "Offered 25 minutes ago" counting up, Lagos clock time |
| `frontend/src/features/admin-dispatch/useDispatch.ts` | TanStack Query hooks |
| `frontend/src/components/ui/Dialog.tsx` | Modal dialog; full-screen sheet below the tablet breakpoint |
| `frontend/src/components/ui/buttonVariants.ts` | `danger-outline`: the secondary destructive button |

## 4. Database models and relationships

Migration `0008` (revises `0007`) adds one column:

| Table | Column | Rule |
| --- | --- | --- |
| `order_events` | `assignment_id` | Nullable UUID, foreign key to `assignments.id` (RESTRICT), indexed |

```
orders 1 ──< order_events >── 0..1 assignments >── 1 users (driver)
```

The dispatch services set it on the events of rows 8-11 (offered, accepted,
declined, withdrawn). Events written before `0008` keep it null; there is no
backfill, because inferring the link from timestamps would be a guess. An
assignment with events cannot be deleted, so test clean-up deletes
`order_events` before `assignments`.

## 5. API endpoints and request/response behavior

All under `/api/v1`; shapes as in the [contract](../api/deliveries.md#admin-dispatch-endpoints).

| Method | Path | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| GET | `/admin/orders/{reference}` | none | 200 `AdminOrderDetail`; its `contact_attempts` list holds the time of each attempt to reach the customer, oldest first, empty if none (FR-038, #280) | 404 `order_not_found` |
| GET | `/admin/orders/{reference}/drivers` | none | 200 `{items: DispatchDriver[]}` | 404 `order_not_found` |
| POST | `/admin/orders/{reference}/assign` | `{driver_id}` | 201 `AdminOrderDetail`; 200 for a repeated offer | 404 `order_not_found`, `driver_not_found`; 409 `driver_not_eligible`, `invalid_order_transition`; 422 |
| POST | `/admin/orders/{reference}/withdraw` | `{expected_status, note?}` | 200 `AdminOrderDetail` | 404 `order_not_found`, `assignment_not_found`; 409 `invalid_order_transition`; 422 |
| GET | `/admin/orders/{reference}/history` | none | 200 `{items: AdminOrderEvent[]}` | 404 `order_not_found` |

- `AdminOrderDetail` is `AdminOrderRead` plus `assignment`: the most recent
  assignment, live or ended, or null if never offered. `vehicle` is the
  driver's current vehicle. `offered_at` is the assignment's `created_at`.
- The driver list holds every `driver` account, active or not, eligible ones
  first, each group by name. An empty list means no driver accounts.
- The history is complete and newest first; `actor` is null for the system;
  `assignment` is set only on rows 8-11 events; `decline_reason` only on a
  decline.
- Request bodies reject unknown fields. `expected_status` is `offered` or
  `accepted`; `note` is trimmed, up to 500 characters, blank becomes null.
- Since #93 the detail has `hold`, withdraw also closes an open hold on the
  job, and the history adds hold entries with `include=holds`
  ([admin-hold-review.md](admin-hold-review.md)).

The frontend checks the parts that drive the screens with Zod: the
assignment, each driver's `reasons`, and every history event. A value it does
not know (a new status or reason) is reported as `ApiError` `invalid_response`
rather than shown as the wrong state. So a new reason code must reach the
client before the server sends it: `manual_quote` (row 26, "Manual quote
agreed with the customer") was added ahead of the confirmation endpoint
(#114, before #113). History entry kinds are the exception (#125, ahead of
#123): the five cash events (`cash_recorded`, `cash_handed_over`,
`cash_corrected`, `cash_received`, `cash_reconciled`) show as a labelled line
with who, when and the note, and a kind the client does not know reads as
`other` ("Order update") instead of failing the whole history. Fields only
status changes use (`from_status`, `to_status`, `reason_code`, `note`,
`assignment`) read as `null` when an entry leaves them out. A detail without `assignment` reads as
never offered. The withdraw dialog sends the assignment status it showed as
`expected_status`, and the trimmed note or `null`.

## 6. Important business rules

- **Never accepted before acceptance (FR-032).** Assign makes the order
  `assigned` and the assignment `offered`; only the driver's accept changes
  that.
- **Eligibility (FR-031, BR-03)** is the S1-07 rule set, reported in full per
  driver; assign checks again, so the list is only a snapshot.
- **Withdraw names what it expects** (admin dispatch decision 1). Rows 10 and
  11 both allow a withdraw, so a "Withdraw this offer?" sent just after the
  driver accepted would otherwise take back the accepted job. A mismatch is
  409 `invalid_order_transition` (`details.from` is the order's status) and
  changes nothing. After departure, withdraw is refused (409); the failure or
  cancellation steps apply.
- **The decline reason is read from the assignment** (decision 3). The
  decline's event note is the driver's own note (null when none). Events
  written before this change have the note `<reason>` or `<reason>: <note>`.
- **History carries names** (decision 2): the account names when read, so a
  renamed account shows its new name on old entries.
- **Audit (NFR-004):** every change writes one `order_events` row in the same
  transaction as the assignment change.
- **Nothing notifies the driver** of a withdraw: the job leaves their list
  the next time the driver app loads (FR-050 SMS go to customers only). The
  withdraw dialog says the order "leaves <driver>'s job list", never that the
  driver is told (design review change 2).

Screen rules (design and #62):

- "Accepted" appears only for an `accepted` assignment; an offer reads
  "Offered to <driver>" and "<driver> has not accepted yet." (FR-032).
- "Offered 25 minutes ago" counts **up** from `offered_at` and never counts
  down (no automatic expiry); it refreshes every 30 seconds, and a time a
  little in the future reads "just now". The Lagos date and time follow on
  their own line (`Fri 16 Oct 2026, 10:05 am (Lagos time)`).
- Times are Africa/Lagos, 12-hour (`Fri 16 Oct 2026, 10:18 am`).
- D1 lists drivers who can take the order first, then the rest disabled with
  every reason; `over_payload` reads "Vehicle too small. Order 2,000 L,
  vehicle 1,200 L" from the order and vehicle numbers.
- Withdraw is offered from D2 and D4, not after the driver has departed.
- The history collapses to the newest 10 with "Showing latest 10 of 15",
  "Show all 15 entries" and "Show fewer". Assignment events are worded from
  the event ("Offered to", "Accepted by", "Declined by", "Offer to … withdrawn",
  "Job withdrawn from", "Recorded for"); a decline shows the reason "Driver
  declined" and the driver's note. Short histories show "N entries".
  The order panel's timeline also shows the driver's steps after "Accepted by":
  "Departed", "Collected", "En route", "Arrived", "Unloading" and "Delivered",
  each with its time (#242).
- The Simulated tag stays on demo orders (BR-09), also in the D1 order strip.
- Every dialog has a title, Cancel and a Close button, moves focus inside,
  keeps Tab inside, closes on Escape, and returns focus to the button that
  opened it. While a request is being sent it cannot be closed and the
  buttons are locked (no double submit). Every target is at least 48 px.

## 7. Authentication and authorization requirements

Every endpoint needs a signed-in, active `admin` (`CurrentAdmin`); customers
and drivers get 403 `forbidden` and signed-out requests 401
`not_authenticated` (FR-001, T-07). `POST` requests need the `X-CSRF-Token`
header (403 `csrf_failed`). Staff may read every order, so an unknown
reference is the only 404 for reads.

The screens are on the staff app's order detail page, which only signed-in
admins reach; the client sends the CSRF token on both POSTs (`client.ts`).

## 8. Error handling and edge cases

| Case | Result |
| --- | --- |
| Assign to an order that is not `confirmed`, or held by another driver | 409 `invalid_order_transition` (`details.from`, `to: assigned`) |
| The same driver offered the same order again | 200, order unchanged, no second event |
| Two offers race for one driver | One wins; the other is 409 `driver_not_eligible` with `reasons: ["busy"]` |
| `driver_id` is not an account / not a driver | 404 `driver_not_found` / 409 `driver_not_eligible` `["not_a_driver"]` |
| Withdraw with nothing live (declined, or another dispatcher withdrew) | 404 `assignment_not_found`, "This order has no driver assigned" |
| Withdraw `offered` after the driver accepted (or `accepted` while still offered) | 409 `invalid_order_transition`; no event, no change |
| Response after a commit | The order is read again with a fresh query, so status and `updated_at` are current (no async lazy load; tested) |
| Events in one transaction | Share `created_at`; ties are broken by id, so their order is arbitrary (only bulk writers such as the demo seed produce them) |

The screens choose error states by **code**, never by message text
(Decision 5):

| Code | D1 Assign | D5 Withdraw |
| --- | --- | --- |
| `driver_not_eligible` | Refused: the server's message and the reasons returned with it; list reloaded, choice cleared, button back to "Choose a driver" | - |
| `invalid_order_transition` | "This order has changed. Refresh to see its current status." (replaces the technical message); list locked, Offer disabled; Refresh closes the dialog, reloads the order and history, and focuses the order heading | Same; Withdraw disabled |
| `assignment_not_found` | - | The server's message ("This order has no driver assigned"); Withdraw disabled; closing reloads the order |
| `csrf_failed` | The server's message with "Reload page"; Offer disabled | Same; Withdraw disabled |
| `order_not_found` | Dialog closes; the page shows the approved "Order not found" | Same |
| No response (`network`) | The client's message ("Unable to reach the server. Check your connection and try again."); the choice is kept and Offer stays enabled | Same; the note is kept |
| Anything else | The server's message | Same |

D1 also shows: "Loading drivers" with a spinner and placeholders; "No drivers
set up yet." with "Ask the technical lead to add vehicles and drivers." and
only Cancel; "No driver can take this order right now." with "Every driver
below is busy, unavailable or cannot carry <quantity>. Wait a little and check
again." and "Check again"; and the server's message with Retry if the driver
list cannot be loaded. H1 shows "Loading history" with a spinner, and on
failure the server's message with Retry, while the rest of the order stays
usable.

## 9. Testing instructions

```bash
cd backend && source .venv/bin/activate
pytest tests/test_dispatch_api.py
TEST_DATABASE_URL="$(grep '^DATABASE_URL=' ../.env | cut -d= -f2- | sed 's#/mmirioma$#/mmirioma_test#')" \
  pytest tests/test_dispatch_integration.py
```

Use the separate `mmirioma_test` database, never the dev database
(`LOG.md`, 2026-10-16), after `alembic upgrade head` on it.

- `test_dispatch_api.py` (no database): 401 for every endpoint signed out;
  403 for customers and drivers (T-07); 403 `csrf_failed` on both POSTs;
  detail, driver list, error bodies and history compared with the contract's
  example files; 201 and 200 on assign; validation of both bodies; withdraw
  passes `expected_status` and a trimmed or null note.
- `test_dispatch_integration.py` (database), new tests: the driver list
  order and every reason (over payload, unavailable, no profile, inactive,
  busy); offer by reference returns the current detail and a repeat is not
  new; withdraw refused when the job changed while the dialog was open, then
  allowed; history names, assignment drivers and the decline reason; unknown
  references. The existing S1-07 tests now pass `expected_status`.
- `test_deliveries_integration.py`: the driver decline keeps the reason on
  the assignment, the event note is the driver's note, and the event links
  to the assignment.

Frontend (Vitest; the API is mocked, never called):

```bash
cd frontend
npm test -- src/features/admin-dispatch src/lib/api/adminDispatch.test.ts src/features/admin-orders
```

- `lib/api/adminDispatch.test.ts`: paths, methods, bodies and the CSRF
  header for the five endpoints, using the contract's example files; Zod
  rejects unknown statuses and reasons; refusal reasons.
- `features/admin-dispatch/logic.test.ts`: the labels of Decisions 3 and 4 and
  J2-b, history wording, elapsed time counting up, error codes to states, and
  which dispatch view each status shows.
- `features/admin-dispatch/dispatch.test.tsx` (jsdom): D2, D3, D4 and its
  departed variant; D1 ordering, reasons, offer and toast, loading, no
  drivers, none eligible, locked while offering, and each error code; D5 for
  offers and jobs with `expected_status`, locking and each error code; focus
  returning to the opening button; H1 collapsed and expanded, loading, error
  with Retry, and refresh after an offer.
- `features/admin-orders/mockAdminOrders.test.ts`, `apiAdminOrdersSource.test.ts`:
  the mock's dispatch rules and the API source's wiring.

Manual check with the mock data: run the frontend with
`VITE_ORDERS_SOURCE=mock` and open `/admin/orders/MO-2BX6NQ8R5J` (declined,
long history), `MO-6FJ1KD3W8S` (offer waiting), `MO-8MC5VT2P9E` (accepted)
and `MO-4RG7YH1B3N` (departed), at 1280 px and 360 px.

**Integration run (2026-10-20, technical lead).** The screens on the API
source against the real backend on the dev database (simulated demo
accounts and orders only), in two layers:

- *API layer:* the frontend's own functions and Zod schemas
  (`src/lib/api/adminDispatch.ts`) called over HTTP with real staff and
  driver sessions. Every response parsed. Checked: the driver list with every
  reason (`over_payload`, `unavailable`, `busy`, `no_driver_profile`, and two
  at once), eligible first; refusal (`driver_not_eligible` with reasons);
  offer and repeated offer; withdraw with the wrong `expected_status`
  (`invalid_order_transition`); a decline through the real driver endpoint,
  shown with reason and note; nothing to withdraw (`assignment_not_found`);
  withdraw; history with names, assignment drivers and the decline reason; an
  accepted job; a POST without the CSRF token (`csrf_failed`).
- *Browser:* headless Chrome at 1280 px and a 360 px phone viewport, signed
  in as staff: no driver yet with history and "Show all"; the D1 list and
  sheet; offer and the D2 card with toast; the D5 dialog with a note and the
  withdrawn toast; the D1 refusal when the driver became unavailable between
  choosing and offering; the D3 banner after a real driver decline; the D4
  accepted card. No console errors.

Not reachable through the API yet, so set up with service calls: confirming
the order (the confirm endpoint, design A1, is not built) and accepting a job
(the accept endpoint is #51). The D5 "order changed" case was checked at the
API layer, not clicked.

## 10. Known limitations

- **The attempts are not on screen yet (#280).** The backend sends `contact_attempts` on every `AdminOrderDetail`. The panel's timeline does not show them until the frontend change, which needs G2 for its wording ("Contact attempt 1 · 9:44 AM").
- **Accept is not end to end yet:** the D4 state was reached by accepting
  through the service, because the accept endpoint is #51.
- **The staff top bar overflows a 360 px phone by 10 px** (the Account button
  ends at x = 370 on every admin page), so the page and the D1 sheet are
  370 px wide. It is the shared admin shell, not these screens
  (`components/layout/AdminShell.tsx`); see `LOG.md` (2026-10-20).
- **Checked against the canvas text, not by screenshot.** The copy, groups,
  states, buttons and focus moves were compared with the canvas data
  (Dispatch01-07, 13). Spacing and colours follow the design system's
  components and were not measured against the canvas pixels.
- **History shows the decline reason only on the D3 banner.** H1 shows the
  reason "Driver declined" and the driver's note, as the canvas does, not the
  driver's chosen decline reason.
- **`assignment_expired`** has no label in Decision 4 (nothing expires yet);
  the history shows "Offer expired" for it until the design words it.
- **Accept** has no endpoint until #51, so an offer can only be declined or
  withdrawn from the apps today.
- **Service area and handling** are not checked for eligibility (zones and
  transfer methods are not modelled), so D1 may list a far-away driver.
- **No pagination** on the driver list or history; fine for the MVP's few
  drivers and tens of events per order.
- **Older events** have no `assignment` and may carry the old decline note
  format.
- **Design-ahead actions** (confirm, record a step, fail, reschedule, cancel,
  proof override, disputes, Drivers page) are not built; they use the planned
  `POST /admin/orders/{reference}/transition`.
