# Prompt 03: driver jobs, pickup, delivery proof and incidents

Issues: S1-06 (delivery state machine contract), S1-07 (assignment backend) ·
Requirements: FR-001, FR-002, FR-032, FR-033, FR-034, FR-035, FR-036, BR-03,
BR-04, BR-06, NFR-020, SRS §8 · Contract: **none yet**. S1-06 defines the
delivery states and endpoints; [orders.md](../../api/orders.md) has the
order-level statuses they map onto.

> **Authentication screens:** [04-authentication.md](04-authentication.md) is
> the canonical auth design. The sign-in and session screens below are kept so
> this slice reads complete; once the auth design is approved, reuse it here.

**Before using:** open the same Claude Design project as prompts 00-02, so the
driver screens share the design system.

**Open decisions this prompt does not settle** (SRS §12, PRD §13): the approved
proof-of-delivery method (§12.7, so the prompt asks for two variants to
compare), the payment method and cash handling (§12.5, so no payment screens),
and operational safety requirements (§12.8). Do not build any of these until
decided.

Paste everything inside the block into Claude Design.

```text
Using the MmiriOma design system already defined in this project (reuse its
tokens and components; if a screen truly needs a new component, add it to the
system and say so), design the DRIVER mobile web screens below. Design for a
360px phone only; drivers do not use desktops.

CONTEXT
Drivers are contracted delivery partners. They collect water from an approved
source and deliver it to customers, doing the unloading themselves: the
customer never lifts or pours water. They use entry-level Android phones
outdoors, often in bright sun, sometimes with gloves or wet hands, often on
weak mobile data. Design for one-handed use: large touch targets (at least
48px, primary actions 56px), high contrast, short labels, few typed fields.

PRODUCT HONESTY RULES (must be followed in every screen)
- No GPS tracking, live maps or "customer can see you" messages. The app never
  tracks the driver's location.
- A job is only the driver's after they press Accept. Before that it is an
  offer. Never show the customer as told until the driver accepts.
- "Delivered" requires proof: the delivered quantity and the receiver's
  acknowledgement. There is no way to mark delivered without them.
- If less water was delivered than ordered, the driver records the real
  quantity. Never prefill the ordered quantity as delivered.
- Never claim the water is safe to drink, purified or potable.
- Show the driver only what they need for the job: receiver's first name and
  last initial, delivery address, landmark, instructions, quantity, delivery
  window, and a call button. No customer account details, order history or
  payment information.
- All example names, phone numbers, addresses and sources are fictional and
  tagged "SAMPLE DATA". Use phone numbers like 0800 000 0001.

=== BUILD NEXT (Sprint 1, S1-07) ===

SCREEN 1: Driver sign in
Phone number and password. Subtitle "For MmiriOma delivery partners".
States: default, submitting, "Phone number or password is incorrect",
"Too many attempts. Please wait and try again." with the wait time, network
error. A deactivated account cannot sign in (same incorrect-details message).

SCREEN 1A: Session and access states
- "Forgot your password? Call the dispatcher." under the sign-in form (there
  is no self-service reset).
- Opening the app: brief loading state while the session is checked, never a
  flash of the sign-in screen.
- Session ended (signed out after 7 days, or the account was deactivated):
  sign-in screen with "Your session has ended. Please sign in again." Do not
  explain why; a deactivated driver sees the same message.
- Security check failed: "Security token missing or invalid. Reload the page
  and try again." with a "Reload" button.
- Wrong kind of account: a customer or admin account sees "This app is for
  MmiriOma delivery partners." with "Sign out".
- Signing out: spinner, then the sign-in screen with "You've signed out."

SCREEN 2: My jobs
- Top bar: "My jobs", driver name, menu with "Sign out".
- Section "New offers" (assigned, not yet accepted): each card shows delivery
  window, area/address (one line), quantity in litres, pickup source name, and
  two large buttons "Accept" and "Decline". Cards show how long ago the offer
  was made.
- Section "Today": accepted jobs in delivery order with a status badge
  (Accepted, Water collected, On the way).
- Section "Done": delivered, failed or cancelled jobs from today.
States: loading skeleton, empty ("No jobs yet. New offers appear here."),
error with Retry, offline banner (see Screen 9), list with mixed states.
Only this driver's jobs ever appear.

SCREEN 3: Job offer detail
- Everything needed to decide: delivery window, quantity, pickup source and
  its approximate location, delivery area, any access notes from the
  customer's instructions.
- "Accept" (primary) and "Decline" (secondary).
- Decline asks for a reason: Not available at that time, Vehicle cannot carry
  this quantity, Too far, Unsafe access, Other (with a short note).
- After Accept: confirmation "Job accepted" and the job moves to Today.
- After Decline: "Job declined. The dispatcher will reassign it."
States: accepting/declining (buttons disabled, no double submit), "This offer
is no longer available" (reassigned or cancelled by the dispatcher), network
error with Retry.

=== DESIGN AHEAD (later sprints; tag each screen "Design ahead - not in
current build") ===

SCREEN 4: Active job
- Header: delivery window, status badge, receiver's first name and last
  initial, "Call receiver" button.
- Delivery address, landmark and instructions in large text, with a "Copy
  address" button and an "Open in maps" link (opens the phone's own maps app;
  nothing is tracked).
- Quantity ordered.
- One primary action for the current step, in order:
  "Record pickup" -> "Start delivery" -> "Complete delivery".
- Secondary "Report a problem" always visible.

SCREEN 5: Record pickup (water collected)
Fields:
- Source: the assigned source preselected, with "This is not the assigned
  source" option.
- Source reference (for example a receipt or batch number; optional text).
- Volume collected in litres (number, required).
- Pickup time (defaults to now, editable).
Rules to show:
- If the source differs from the assigned one, or the driver flags a safety
  concern at the source, the job pauses: "Waiting for dispatcher review. Do not
  continue until the dispatcher approves." with the job locked until then.
- If the collected volume is lower than ordered, a warning explains a partial
  delivery will be recorded and the dispatcher informed.

SCREEN 6: Complete delivery (proof)
Fields:
- Volume delivered in litres (required, empty by default, never prefilled
  with the ordered amount).
- Receiver's name (required).
- Receiver acknowledgement. Design TWO variants side by side, labelled
  "Option A" and "Option B", because the method is not decided yet:
  - Option A: a confirmation code the receiver reads out to the driver.
  - Option B: the driver records the receiver's name, and the dispatcher
    confirms with the receiver by phone afterwards; the job shows "Delivered -
    awaiting dispatcher confirmation".
- Checkbox (required): "I unloaded the water into the customer's container or
  tank. The customer did not have to lift or pour water."
- Delivery time (defaults to now).
- Submit "Mark as delivered".
States: validation errors, submitting, success "Delivery recorded", partial
quantity warning ("You delivered less than ordered. The dispatcher will follow
up with the customer."), network error with Retry that keeps all entries.
No photo capture in this version.

SCREEN 7: Report a problem
Choose one: Running late, Customer unreachable, Unsafe access, Unsafe
transfer, Wrong or missing water volume, Water source concern, Vehicle
problem, Other. Each with a short optional note and "Send to dispatcher".
- Running late: optional new estimated arrival time; message that the
  dispatcher will agree any new window with the customer.
- Unsafe access or unsafe transfer: a clear "Stop work" message: "Do not
  continue. The dispatcher will arrange a safe alternative." The job is paused.
- Customer unreachable: show the agreed retry steps (placeholder text tagged
  SAMPLE DATA, the policy is not written yet).
States: sending, sent ("Dispatcher notified"), network error.

SCREEN 8: Job outcome states
- Delivered (with delivered quantity and time).
- Delivered, awaiting dispatcher confirmation (Option B).
- Paused, waiting for dispatcher review.
- Reassigned: "This job was reassigned by the dispatcher." It leaves the list.
- Cancelled by dispatcher, with reason.
- Failed, with reason.

SCREEN 9: Offline
- Banner: "You're offline. Changes are not sent yet." Never imply the
  dispatcher can see updates made while offline.
- Unsent actions are listed as "Waiting to send" with a "Send now" button that
  works when back online. Nothing is marked as done until the server confirms.

DELIVERABLE
All screens and states at 360px, annotated with which data each element shows
and which action it sends. End with a list of components used and any new
component or token added to the design system.
```

## After generating

1. Check every screen and state exists and the honesty rules hold, especially
   that "delivered" cannot be reached without quantity and acknowledgement
   (BR-06, T-08) and that no tracking appears.
2. Record the result in `docs/design/driver-deliveries.md` using the
   [template](../_template.md).
3. Give the design to the S1-06 owner. The screen-to-endpoint table becomes
   the driver section of the delivery contract (`docs/api/deliveries.md` or
   similar), together with the state machine. The "Build next" screens need
   only list, accept and decline endpoints.
4. Bring Options A and B to the team for the proof-of-delivery decision
   (SRS §12.7) before Screen 6 is built.
