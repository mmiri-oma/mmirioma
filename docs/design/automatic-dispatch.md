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
yet) · Reviewed by: @nnamdi-security + Codex, 2026-11-12 ·
Status: approved (G2, written design; visual mockup remains a pre-build gate)

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

None yet. The frames are generated from the reviewed prompt, attached here and checked
against this written design before building the affected screens. This PR
approves the written states, not an unseen mockup or completed implementation.

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
| P2 Rider sheet, deadline check | Checking, offline/error retry, in-flight answer, confirmed expiry/unavailable, Close |
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

> No rider is currently assigned. Automatic offers depend on operating
> hours, source eligibility and rider availability.

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

> Automatic offers are off for this order. Assign a rider yourself.

Do not infer the reason from `manual_only`: it records control, not the
identity or action that caused it. The timeline/audit supplies that history.

The rider list follows. There is no control to turn automatic offers back on
(outside #411).

### A6 Orders table row

The Rider column shows the rider's name when the order has a live offer, as
today. For a `confirmed` order with no live offer it shows the dispatch chip
from the table above. For all other statuses preserve the existing rider
value when the response supplies one, including ended jobs; use "None yet"
only when no rider is returned. Do not erase historical assignment details.

### A7 Timeline

| Event | Line |
| --- | --- |
| `to_status` `assigned`, actor `null` | Offered to <rider> automatically |
| reason `assignment_expired` | Offer to <rider> expired |
| any event with actor `null` | attributed to "System" where a staff name would be |
| `dispatch.escalated_at` present on the order detail | Escalated for dispatcher assignment, attributed to System at that timestamp |

"Offered to <rider>", "Declined by <rider>", "Offer to <rider> withdrawn" and
"Job withdrawn from <rider>" are unchanged.

Merge the persisted escalation fact from the order detail into the admin
timeline, ordered by its UTC timestamp and keyed once per order/escalation.
Do not invent a status transition or pretend this row came from the history
endpoint. Preserve it after a manual assignment while the timestamp remains.
#411 must write its audit entry transactionally as agreed; the detail plus
history render every automatic action without needing a new API field.
An audit entry never substitutes for the order panel's visible history line.

### A8 Assign refused

When `POST /admin/orders/{reference}/assign` answers 409
`driver_not_eligible`, the existing error notice lists one line per reason:

| Reason | Line |
| --- | --- |
| `outside_service_zone` | This rider does not serve the order's area. |
| `transfer_method_unsupported` | This rider's vehicle cannot fill this tank type. |
| `delivery_type_mismatch` | This rider's vehicle type does not match the order. |
| `over_payload` | This rider's vehicle cannot carry this order within its permitted trip plan. |

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

- At 1:00 the countdown turns amber with "One minute left"; below 1:00
  it adds "Less than one minute left". Use no pressure wording, pulsing or instruction that encourages
  answering while driving.
- "Start: go to refill station" and "I cannot take this order" are unchanged.
- No connection: the countdown keeps running from the last known deadline;
  a tap shows "No connection. Try again." and keeps the sheet open.

### P2 Rider sheet, time ran out

At device 0:00 stop the countdown and disable duplicate responses while
refetching. Show **Checking offer status**, not a claim of expiry. A device
clock is not the server's decision. Offline or on refresh failure show
**We could not check this offer. Connect and try again.**, with Try again
and Close. Do not manufacture an expiration notification or accuse the rider.

If a response is already in flight, keep its pending state and process its
result: a server-confirmed acceptance takes precedence over the local timer.
A successful decline follows the existing flow. Refetch after ambiguous
network failure; never claim rejection or acceptance without a server answer.

Only 409 `offer_expired`, an authoritative expired record, or the actual
`offer_expired` notification permits **This offer has expired.** with Close.
An absent/404 job could have been withdrawn or cancelled; show **This offer
is no longer available.**, without an invented cause. If refreshed data still
shows the rider's offered job, permit a retry checked by the server and show
**The time on this device may be inaccurate.** Never extend the deadline or
restart the timer. Closing returns to the rider's home.

### P3 Rider sheet, dispatcher's offer

Unchanged: "Assigned by admin", no countdown (`offer_expires_at` is `null`).

### P4 Answer refused

`POST /driver/jobs/{reference}/accept` or `.../decline` answers 409
`offer_expired`. In the sheet, or on the decline screen:

> **This offer has expired.**

with **Close**. Nothing says the order went to another rider.

### P5 Rider notification

| `kind` | Title | Body |
| --- | --- | --- |
| `offer_expired` | Offer expired | <reference>: this offer expired before a response was recorded. |

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
| A7 | Timeline lines | `GET /admin/orders/{reference}/history` plus `GET /admin/orders/{reference}` | `actor`, `to_status`, `reason_code`, `assignment.driver.name`; detail `dispatch.escalated_at` |
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
   screens show an approximate countdown from `offer_expires_at` on the
   device's clock; recompute on visibility/resume rather than decrementing
   an interval counter. The
   server decides: a rider whose clock is slow can still tap Start after the
   deadline and gets P4. At zero the screens check status without
   claiming expiry; an in-flight server response remains authoritative.
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
   every second. Colour is never the only signal: amber adds "Less than one minute left", the
   chips carry words and icons (NFR-020, NFR-021).
8. **The customer's screens do not change.** A customer is told nothing about
   a rider before the rider accepts (FR-032), as today.

## Review decisions (2026-11-12)

Resolved by @nnamdi-security + Codex, who is not the original author.

1. **Escalation history:** A7 displays the persisted `dispatch.escalated_at`
   from the detail alongside history events. One deduplicated System line;
   no made-up transition and no new contract field. The agreed audit write
   remains required. Test its persistence after manual assignment and reload.
2. **Operating hours:** use A1's neutral conditional wording, not "keeps
   looking" or an unsupported specific blocking reason. Owner confirmed
   08:00–18:00 every day, Africa/Lagos, with 18:00 last dispatch and ordering
   24/7. #408 owns the reviewed calendar/window semantics. No local-clock
   guess controls offers, departures or customer delivery promises.
3. **Source lost:** A1 does not claim active searching. A hold/review returned
   by the backend takes priority over dispatch decoration. Specific reasons
   require agreed #407/#408 fields, not inference from a stale source list;
   #416 D8 and existing hold actions remain authoritative.
4. **Last minute:** "Less than one minute left" instead of "Hurry". Exact
   cutoff 1:00 is "One minute left"; below it use the less-than wording.
   Timer zero means verification, not proven expiry or blame. Do not announce
   every second, move focus on a tick or erase an in-flight acceptance.
5. **Staff terms:** "dispatcher" for these new operational states, as in the
   contract. Retain existing "Assigned by admin" on the manual-offer sheet;
   #413 owns a broader wording sweep. Use rider for Keke and driver for tanker
   when the existing UI knows the type; keep shared labels otherwise.
6. **Dashboard scope:** counts/filters remain in #413. This design approves
   only the panel, table, timeline, notification, audit and offer-sheet states.

## Loading, concurrency and build verification

Loading/errors never render an absent `dispatch` or assignment as an actual
"Awaiting assignment" result. Keep skeleton/error/retry until valid data is
available. Missing nullable actors render System; malformed/missing required
assignment data gets an error/retry, not a guessed system offer. Manual
assign/withdraw retains expected-status checks and must not imply it can
withdraw an already departed job. Refused actions refetch and preserve the
server's reason. Existing holds, finished jobs and active deliveries take
precedence over outdated offer decoration.

On a timer state change, announce once without moving keyboard focus. At a
confirmed end, keep focus on the state container/Close rather than losing it
with a removed button. Use existing dialog focus containment/restoration and
respect reduced motion. Both Keke and tanker offer flows must be covered.

Build tests: one/two failed attempts without false first-offer wording;
manual/escalated precedence; no false overnight searching; historical rider
preservation; escalation timeline deduplication/order/reload; all eligibility
labels including manual no-quote payload refusal; missing/null data; clock
skew, sleep/resume, offline-at-zero, expired 409 vs unrelated 404, server
acceptance arriving after device zero, repeated clicks and mutation failures.
Validate 360px/desktop, keyboard focus, minute-only announcements and reduced
motion. These are requirements for the build, not checks run on this docs PR.

## Changes to the design system

One new component, added to `design-system.md` when the mockup is made:

- **Countdown:** text "M:SS" with a clock icon, a normal and an amber
  (last-minute) style, used in A2 and P1. It takes a deadline, stops at 0:00
  and announces at whole minutes.

The three dispatch chips reuse the existing chip with its amber and red
tones. No new token.
