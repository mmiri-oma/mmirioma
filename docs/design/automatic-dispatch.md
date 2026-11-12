# Automatic dispatch design

<!-- Workflow: docs/process/ui-driven-development.md. Gates: CLAUDE.md. -->

Issue: [#411](https://github.com/mmiri-oma/mmirioma/issues/411) (DSP-02) ·
Requirements: FR-031, FR-032, FR-033, FR-050, BR-03, NFR-004, NFR-020,
NFR-021 · Prompt:
[prompts/21-automatic-dispatch.md](prompts/21-automatic-dispatch.md) ·
Contract:
[deliveries.md](../api/deliveries.md#automatic-dispatch-and-reassignment-411)
(agreed, G3, 2026-11-12)
Designer: @Cloudcrackamara + Claude Code (written design; no visual mockup
yet) · Reviewed by: nobody yet · Status: draft, ready for review (G2)

This is a written design: every state and the exact wording. The visual
mockup is made from the prompt and attached before the screens are built.
Nothing here is built. Building also waits for the dependencies the contract
names (#407, #408, #410) and the #408 window contract.

The system offers a confirmed order to one rider at a time, gives the rider a
limited time to answer, tries the next rider, and hands the order to a
dispatcher after repeated offers that were not taken. This design adds the
states that show it on two existing screens: the admin order panel and the
rider's "New order for you" sheet. It adds no new page.

**Words.** The built app calls a driver a "rider" on screen; this design
keeps that. The contract's fixed labels "Awaiting assignment" and "Awaiting
dispatcher assignment" are used as written.

## Design link

None yet. The frames are generated from the prompt and attached here.

## Screens and states

All are build now, once the gates above pass; nothing is design ahead.

| Screen | States designed |
| --- | --- |
| A1 Order panel, awaiting assignment | No offers yet; 1 or 2 offers not taken; loading; error |
| A2 Order panel, system offer | Countdown running; countdown at 0:00 ("Checking the offer"); withdraw; refused action ("This order has changed.") |
| A3 Order panel, dispatcher's offer | As today, no countdown |
| A4 Order panel, escalated | Notice with the count and time; rider list |
| A5 Order panel, awaiting dispatcher assignment | Notice; rider list |
| A6 Orders table row | Three dispatch chips in the Rider column |
| A7 Timeline | Two new lines; "System" attribution |
| A8 Assign refused | Four reason lines |
| A9 Admin notifications | Two new rows |
| A10 Audit log | "System" as the actor |
| P1 Rider sheet, system offer | Countdown running; last minute; no connection |
| P2 Rider sheet, time ran out | Actions removed, Close |
| P3 Rider sheet, dispatcher's offer | As today |
| P4 Answer refused | After Start; after a decline |
| P5 Rider notification | One new row |

### Which admin state shows

Worked out by the client from fields the contract already returns, in this
order. The first row that matches wins.

| Order status | Fields | State | Dispatch chip |
| --- | --- | --- | --- |
| `assigned` | `assignment.offered_by` is `null` | A2 system offer | none; the offer line carries it |
| `assigned` | `assignment.offered_by` is set | A3 dispatcher's offer | none |
| `confirmed` | `dispatch.escalated_at` is set | A4 escalated | "Escalated" |
| `confirmed` | `dispatch.manual_only` is `true` | A5 | "Awaiting dispatcher assignment" |
| `confirmed` | otherwise | A1 | "Awaiting assignment" |

Escalation comes before manual-only because the contract says so
("escalation taking precedence when present"). Any other order status shows
no dispatch chip.

### A1 Order panel, awaiting assignment

Under the status chip, the dispatch chip **Awaiting assignment** (amber, with
a clock icon) and the line:

> No rider has been offered this order yet. The system keeps looking.

When `dispatch.failed_attempts` is 1 or more, a second line: "1 offer not
taken" or "N offers not taken".

The "Assign a rider" list stays as it is. Above its button, a plain note:

> If you assign a rider yourself, automatic offers stop for this order.

### A2 Order panel, system offer

In place of today's "Assigned to" row:

- **Offered to <rider> automatically**, with a small tag "Offer N" from
  `assignment.attempt_number`.
- A countdown **Expires in M:SS**, counted from `assignment.offer_expires_at`.
  At zero it reads **Checking the offer** and the panel refetches the order;
  the countdown never restarts by itself.
- Under it, as today: "Waiting for them to start."
- Action **Withdraw offer** (the existing withdraw), with the note:
  "Withdrawing stops automatic offers for this order."

The panel never says the rider "has" the order or is on the way (FR-032).

### A3 Order panel, dispatcher's offer

Unchanged: "Assigned to <rider>", "Waiting for them to start". No countdown
and no attempt tag, because a dispatcher's offer does not expire.

### A4 Order panel, escalated

A warning notice at the top of the panel:

> **No rider took this order.** N offers were not taken. Assign a rider
> yourself.
> Escalated <date and time>

N is `dispatch.failed_attempts`; the time is `dispatch.escalated_at`.
Dispatch chip **Escalated** (red, with an alert icon). The rider list follows.

### A5 Order panel, awaiting dispatcher assignment

Dispatch chip **Awaiting dispatcher assignment** (amber, with a person icon)
and a plain notice:

> Automatic offers are off for this order because a dispatcher assigned or
> withdrew it. Assign a rider yourself.

The rider list follows. There is no control to turn automatic offers back on
(outside #411).

### A6 Orders table row

The Rider column shows the rider's name when the order has a live offer, as
today. For a `confirmed` order with no live offer it shows the dispatch chip
from the table above in place of "None yet". Other statuses keep "None yet".

### A7 Timeline

| Event | Line |
| --- | --- |
| `to_status` `assigned`, actor `null` | Offered to <rider> automatically |
| reason `assignment_expired` | Offer to <rider> expired |
| any event with actor `null` | attributed to "System" where a staff name would be |

"Offered to <rider>", "Declined by <rider>", "Offer to <rider> withdrawn" and
"Job withdrawn from <rider>" are unchanged.

### A8 Assign refused

When `POST /admin/orders/{reference}/assign` answers 409
`driver_not_eligible`, the existing error notice lists one line per reason:

| Reason | Line |
| --- | --- |
| `outside_service_zone` | This rider does not serve the order's area. |
| `transfer_method_unsupported` | This rider's vehicle cannot fill this tank type. |
| `delivery_type_mismatch` | This rider's vehicle type does not match the order. |
| `over_payload` | This order needs more trips than the customer was quoted for this rider's vehicle. |

The rider list keeps showing only riders with no reasons, as today, so these
lines appear only when a rider stopped being eligible after the list loaded.

### A9 Admin notifications

| `kind` | Title | Body |
| --- | --- | --- |
| `assignment_expired` | Offer expired | <reference>: <rider> did not answer in time. |
| `dispatch_escalated` | Needs a rider | <reference>: no rider took this order. |

Each row opens the order, as an order notification does today. No customer
phone, address or delivery code (SRS §5 `notifications`).

### A10 Audit log

A row whose actor is `null` shows **System** in the staff column.

### P1 Rider sheet, system offer

The built "New order for you" sheet, for an offer with `offer_expires_at`
set. The line under the title reads **Offered to you**, and a countdown sits
on the same line: **Answer in M:SS**.

- From 1:00 down the countdown turns amber and adds the word "Hurry".
- "Start: go to refill station" and "I cannot take this order" are unchanged.
- No connection: the countdown keeps running from the last known deadline;
  a tap shows "No connection. Try again." and keeps the sheet open.

### P2 Rider sheet, time ran out

At 0:00 both actions are removed. The sheet reads:

> **This offer has ended.** You did not answer in time.

with one button, **Close**. Closing returns to the rider's home.

### P3 Rider sheet, dispatcher's offer

Unchanged: "Assigned by admin", no countdown (`offer_expires_at` is `null`).

### P4 Answer refused

`POST /driver/jobs/{reference}/accept` or `.../decline` answers 409
`offer_expired`. In the sheet, or on the decline screen:

> **This offer has ended.** You did not answer in time.

with **Close**. Nothing says the order went to another rider.

### P5 Rider notification

| `kind` | Title | Body |
| --- | --- | --- |
| `offer_expired` | Offer ended | <reference>: you did not answer in time. |

## Screen-to-endpoint table

Every endpoint and field is in the agreed
[contract section](../api/deliveries.md#automatic-dispatch-and-reassignment-411)
unless a row says otherwise.

| Screen | Element / action | Endpoint | Fields used |
| --- | --- | --- | --- |
| A1, A4, A5 | Dispatch chip and notices | `GET /admin/orders/{reference}` | `status`, `dispatch.manual_only`, `dispatch.failed_attempts`, `dispatch.escalated_at` |
| A1, A4, A5 | Rider list, Assign | `GET /admin/orders/{reference}/drivers`, `POST /admin/orders/{reference}/assign` | `reasons`; `driver_id` |
| A2 | Offer line, tag, countdown | `GET /admin/orders/{reference}` | `assignment.offered_by`, `assignment.attempt_number`, `assignment.offer_expires_at`, `assignment.driver.name` |
| A2 | Withdraw offer | `POST /admin/orders/{reference}/withdraw` | `expected_status`, `note` |
| A6 | Rider column chip | `GET /admin/orders` | `status`, `driver`, `dispatch.*` |
| A7 | Timeline lines | `GET /admin/orders/{reference}/history` | `actor`, `to_status`, `reason_code`, `assignment.driver.name` |
| A8 | Reason lines | `POST /admin/orders/{reference}/assign` | 409 `driver_not_eligible`, `details.reasons` |
| A9 | Notification rows | `GET /admin/notifications` | `kind`, `reference` |
| A10 | "System" actor | `GET /admin/audit-logs` | `actor` (`null`) |
| P1, P2, P3 | Sheet and countdown | `GET /driver/jobs` (the driver job object) | `offer_expires_at` |
| P1, P4 | Start, decline | `POST /driver/jobs/{reference}/accept`, `POST /driver/jobs/{reference}/decline` | 409 `offer_expired` |
| P5 | Notification row | `GET /driver/notifications` | `kind`, `reference` |

No row needs a contract change.

## Decisions

1. **No new page.** Every state lives on a screen that exists, so a dispatcher
   finds the order where they already look for it.
2. **The countdown is the server's deadline, shown, not enforced.** The
   screens count down from `offer_expires_at` on the device's clock. The
   server decides: a rider whose clock is slow can still tap Start after the
   deadline and gets P4. At zero the screens stop offering the action instead
   of guessing the result.
3. **"N offers not taken", not "N of 3".** The attempt limit is a setting
   (`DISPATCH_MAX_FAILED_ATTEMPTS`), and the order panel does not read
   settings. Showing "of 3" would need a second request and could disagree
   with the limit in force when the offers were made. The escalation notice
   states the count that was reached.
4. **"Not taken" covers declined and expired** in counts. The timeline says
   which one it was for each offer, so no reason is invented (FR-032).
5. **Manual actions warn before, not after.** The note sits beside Assign and
   Withdraw, because the contract makes manual-only permanent for the order
   and offers no way back.
6. **The rider list is not redesigned.** It keeps showing only riders who can
   take the order; the four reason lines are for the refused assign only.
7. **Screen readers hear the countdown each whole minute and at 0:00,** not
   every second. Colour is never the only signal: amber adds "Hurry", the
   chips carry words and icons (NFR-020, NFR-021).
8. **The customer's screens do not change.** A customer is told nothing about
   a rider before the rider accepts (FR-032), as today.

## Open questions

1. **Escalation in the timeline.** The contract records escalation as
   `dispatch.escalated_at`, not as an order event, so the timeline has no
   "Escalated" line; the panel notice carries it. #411's acceptance criteria
   say every automatic action appears in the order history. Is the notice
   enough, or does the history need an escalation entry (a contract change)?
2. **Waiting for opening hours.** A confirmed order placed at night is not
   offered until opening (decision D5), but no field says so. A1 would read
   "The system keeps looking", which is not true while dispatch is closed.
   This needs a field or the operating hours from #408. Not designed here.
3. **Selected source no longer eligible.** The system stops offering such an
   order (decision D8), and no field tells the panel why. Not designed here;
   it depends on #407 and #408.
4. **"Hurry" in the last minute.** Is the word acceptable to the team, or
   should the last minute change colour and icon only with a different word?
5. **"Rider" beside the contract's "dispatcher".** The app says "admin" in
   places ("Assigned by admin") and the contract's label says "dispatcher".
   This design uses the contract's label as written. Confirm, or choose one
   word for staff across the admin screens (#413 owns the wording sweep).
6. **Dashboard counts and filters** for awaiting assignment and escalated are
   in #413 and need their own contract fields. Not designed here.

## Changes to the design system

One new component, added to `design-system.md` when the mockup is made:

- **Countdown:** text "M:SS" with a clock icon, a normal and an amber
  (last-minute) style, used in A2 and P1. It takes a deadline, stops at 0:00
  and announces at whole minutes.

The three dispatch chips reuse the existing chip with its amber and red
tones. No new token.
