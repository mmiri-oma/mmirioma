# Prompt 21: automatic dispatch states for admins and riders

Issue: [#411](https://github.com/mmiri-oma/mmirioma/issues/411) (DSP-02) ·
Requirements: FR-031, FR-032, FR-033, FR-050, BR-03, NFR-004, NFR-020,
NFR-021 · Contract (agreed, G3, 2026-11-12):
[deliveries.md](../../api/deliveries.md#automatic-dispatch-and-reassignment-411) ·
Design record: [automatic-dispatch.md](../automatic-dispatch.md) · Build:
after G2, and after the dependencies the contract names (#407, #408, #410).

**Why this prompt:** the system will offer a confirmed order to a rider
without staff action, give the rider a limited time to answer, try the next
rider, and hand the order to a dispatcher after repeated failures. The admin
order panel and the rider's offer sheet must show what the system did and what
it is waiting for, and must never say a rider took an order before they did
(FR-032).

**Before using:** the visual system is the **design handoff v1**
([handoff-v1.md](../handoff-v1.md)) and the built screens: the admin Orders
page with its order panel, the rider's "New order for you" sheet, the
notification lists. Reuse their cards, chips, notices and buttons. The app
calls a driver a **rider**; keep that word on screen. Add a component only
when a screen truly needs one, and say so. Paste everything inside the block
into Claude Design, or use it as the spec for a clickable preview.

```text
Using the MmiriOma design already in this project (design handoff v1: admin
frame, order panel, chips, notices, dialogs; the rider app's bottom sheet;
Plus Jakarta Sans), design the AUTOMATIC DISPATCH states. Admin: desktop
first at 1280px, also 360px. Rider: 360px phone first, entry-level Android,
slow network, bright sunlight.

CONTEXT
A confirmed order is offered to one rider at a time by the system. A system
offer has a deadline. If the rider declines or does not answer, the order
goes back to waiting and the next rider is offered it. After several offers
that were not taken, the system stops and the order waits for a dispatcher.
A dispatcher can assign or withdraw within the existing permitted states; after that, the system makes
no more offers for that order. A dispatcher's own offer has no deadline.

PRODUCT HONESTY RULES (every screen)
- Never say a rider accepted, is coming, or "has" the order before they
  accept. An offer is an offer: "Offered to <rider>", "Waiting for them to
  start".
- Never say a rider was found when none was. "Awaiting assignment" means no
  live assignment currently exists, even if earlier offers were not taken.
- No live tracking, no map, no arrival time, no distance to the rider.
- No reason is invented for why an offer was not taken: say "declined" only
  when the rider declined, and "expired" only when the time ran out.
- The countdown is the server's deadline. The screen never extends it and
  never says an answer was accepted until the server says so.
- Sample names, references and times carry a SAMPLE tag. A demo order carries
  a SIMULATED tag.
- Admin and rider messages never show a customer phone, an address or a
  delivery code.

ADMIN SCREENS AND STATES

A1. ORDER PANEL, "AWAITING ASSIGNMENT"
  A confirmed order without a current live assignment. Under the status chip, a
  dispatch chip "Awaiting assignment" and one line: "No rider is currently
  assigned. Automatic offers depend on operating hours, source eligibility
  and rider availability." When earlier offers were
  not taken, a second line: "1 offer not taken" or "2 offers not taken". The
  rider list ("Assign a rider") stays, with a note above its button: "If you
  assign a rider yourself, automatic offers stop for this order."

A2. ORDER PANEL, SYSTEM OFFER
  The order is offered to a rider by the system. "Offered to <rider>
  automatically", an "Offer 2" tag (the attempt number), and a countdown
  "Expires in 3:12" that reaches "Expires in 0:00" and then becomes "Checking
  the offer" until the panel refreshes. Under it: "Waiting for them to
  start." Action "Withdraw offer", with the note: "Withdrawing stops
  automatic offers for this order."

A3. ORDER PANEL, DISPATCHER'S OFFER
  As today: "Assigned to <rider>", "Waiting for them to start". No countdown,
  no attempt tag.

A4. ORDER PANEL, ESCALATED
  A warning notice at the top of the panel: "No rider took this order. 3
  offers were not taken. Assign a rider yourself." with the time it was
  escalated. Dispatch chip "Escalated". The rider list below it.

A5. ORDER PANEL, "AWAITING DISPATCHER ASSIGNMENT"
  A confirmed order with automatic offers stopped by a dispatcher's assign or
  withdraw, and not escalated. Dispatch chip "Awaiting dispatcher
  assignment" and the line: "Automatic offers are off for this order.
  Assign a rider yourself." The rider
  list below it.

A6. ORDERS TABLE ROW
  The Rider column for a confirmed order with no live offer shows the
  dispatch chip in place of "None yet": "Awaiting assignment", "Escalated"
  or "Awaiting dispatcher assignment". An offered order keeps the rider's
  name. Preserve existing returned rider names for ended jobs; do not replace
  historical values with "None yet". Words always, never colour alone.

A7. TIMELINE LINES
  New lines beside the existing ones: "Offered to <rider> automatically",
  "Offer to <rider> expired". The existing "Declined by <rider>", "Offered to
  <rider>" and "Offer to <rider> withdrawn" stay. A line with no person is
  attributed to "System". Also merge the persisted detail
  dispatch.escalated_at into the timeline as one "Escalated for dispatcher
  assignment" line. Do not invent a status event or duplicate it on refresh.

A8. RIDER CANNOT TAKE THE ORDER (after an assign is refused)
  Four reasons in the existing error notice, one line each: "This rider does
  not serve the order's area.", "This rider's vehicle cannot fill this tank
  type.", "This rider's vehicle type does not match the order.", "This rider's
  vehicle cannot carry this order within its permitted trip plan."

A9. ADMIN NOTIFICATIONS
  Two rows in the bell list: "Offer expired" with "<reference>: <rider> did
  not answer in time." and "Needs a rider" with "<reference>: no rider took
  this order." Each opens the order.

A10. AUDIT LOG
  A row with no person shows "System" where the staff name goes.

RIDER SCREENS AND STATES

P1. "NEW ORDER FOR YOU" SHEET, SYSTEM OFFER
  The existing sheet. The line under the title reads "Offered to you" and a
  countdown sits beside it: "Answer in 4:32". From 1:00 down the countdown
  turns amber with "One minute left" at 1:00 and "Less than one minute left"
  below it; never colour alone, no pressure wording or prompt to act while driving. The two actions
  stay: "Start: go to refill station" and "I cannot take this order".

P2. SHEET, TIME RAN OUT
  Device 0:00 shows "Checking offer status" while refetching; it is not
  proof of server expiry. Preserve an in-flight response and honor server
  success even if it arrives after device zero. On refresh/network failure
  show "We could not check this offer. Connect and try again." with Try again
  and Close. Only confirmed expiry shows "This offer has expired." with
  Close. A missing/404 job says "This offer is no longer available." without
  inventing a cause. If still offered, allow server-checked retry with a
  device-clock warning; never extend or restart the deadline.

P3. SHEET, DISPATCHER'S OFFER
  As today: "Assigned by admin", no countdown.

P4. ANSWER REFUSED
  The rider tapped Start or sent a decline after the deadline. In the sheet,
  or on the decline screen: "This offer has expired." with "Close". Nothing says the order went to someone else.

P5. RIDER NOTIFICATION
  One row: "Offer expired" with "<reference>: this offer expired before a
  response was recorded."

STATES (every screen)
  Loading; error loading with "Try again"; no connection (the countdown keeps
  running from the last known deadline, and the answer buttons show "No
  connection. Try again."); "This order has changed." with Refresh when an
  admin action is refused because the order moved; 403.

ACCESSIBILITY
  Touch targets at least 44px. The countdown is text, readable by a screen
  reader, and announces at each whole minute and at 0:00, not every second.
  Never move focus on a timer tick; keep a reachable state/Close target when
  actions end. Recompute approximate time on visibility/resume. Cover both
  Keke and tanker variants, slow/fast device clocks and offline-at-zero.
  Amber and red are never the only signal. Respect reduced motion: no pulsing
  ring when it is set.

PHONE (360px, admin)
  The panel's notices and chips stack; the countdown stays on the line with
  the rider's name.

OUT OF SCOPE
  Dashboard counts and order filters for these states, and the settings page
  showing the timeout and attempt limit (#413). Push, sound and
  acknowledgement (#412). The customer's screens: a customer is told nothing
  about a rider before the rider accepts, as today. A way to turn automatic
  offers back on for an order. Specific waiting-for-opening-hours and lost-source
  reasons need fields from #408 and #407; use neutral A1 copy in the meantime.
  Show existing server holds/reviews ahead of dispatch decoration. The owner
  confirmed daily 08:00–18:00 Africa/Lagos, with 18:00 last dispatch and
  24/7 ordering; do not promise an ETA from those hours alone.
```
