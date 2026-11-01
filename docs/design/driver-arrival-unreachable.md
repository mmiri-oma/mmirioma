# Driver arrival and the unreachable customer design (partner app)

<!-- Workflow: docs/process/ui-driven-development.md. Fork gates: CLAUDE.md,
"Team workflow". -->

Issue: [#250](https://github.com/mmiri-oma/mmirioma/issues/250) ·
Requirements: FR-038 (P0), FR-035, FR-036, BR-14, NFR-020 · Acceptance test:
T-25 · Contract: [deliveries.md](../api/deliveries.md) (agreed, G3), driver job
part 2, design check rows A3, A4 and A7 · Prompt:
[prompts/18-driver-arrival-and-unreachable.md](prompts/18-driver-arrival-and-unreachable.md)
Designer: @Bonvee120 + Claude Code · Reviewed by: @nnamdi-security (technical lead) on 2026-10-29 · Status: approved

**Approved (G2)** by @nnamdi-security (technical lead) on 2026-10-29, for both
apps, with the wording in "Wording to approve" below
([decision on #250](https://github.com/mmiri-oma/mmirioma/issues/250#issuecomment-6503910898)).
Version approved: the clickable preview as it stood on 2026-10-29 (it shows no
version number). Contract: agreed (G3). Decisions 5 and 7 and the known
limitation were added by that decision.

The partner app's steps from arriving at the customer to a failed delivery when
nobody answers: the arrival (U1, U2), the contact attempts and the wait (U3,
with a confirm sheet), the failed outcome (U4) and the problem report entry
(U5). It is for both apps, the Keke rider app and the tanker driver app. The
rule is FR-038: two recorded contact attempts and the full 10 minutes from
arrival before the job can fail.

## Design link

- Clickable preview (every state, both apps, phone width, sample data):
  <https://claude.ai/artifact/DaMqjVxD1woJjK5kB7WUH3>. A review aid, not
  committed code. It has a "live" state for U3 where the attempt button and a
  "+1 min" preview control move the server clock; the yellow bar is not part of
  the app. The preview shows no version number, so the reviewer should record
  the version they approved here.
- Reference: the fork's partner trip screens (`r-customer`, `t-customer`,
  `r-otp`, `t-otp`, `r-done`, `r-issue`) and the confirmation sheet of
  [driver-cash.md](driver-cash.md).

## Screens and states

| Screen | States designed | Build now / design ahead |
| --- | --- | --- |
| U1 I have arrived (the customer step's button) | Default, sending, not sent, job paused, reassigned, already arrived (goes to U2) | Build after G2 |
| U2 Arrived | Default, starting unloading, not sent, job paused, job changed | Build after G2 |
| U3 Customer not reachable | Live (try it), 0, 1, 2 (waiting), 2 (wait over), 3 attempts, stale screen refused, loading, recording an attempt, attempt not sent, offline, job paused, reassigned, job changed | Build after G2 |
| U3-S Confirm sheet | Open, sending, not sent, refused (wait not over) | Build after G2 |
| U4 Delivery failed | Outcome, Done list row | Build after G2 |
| U5 Problem report | Before arrival (unchanged), after arrival (leads to U3) | Build after G2 |

## Screen-to-endpoint table

| Screen | Element / action | Endpoint | Fields used |
| --- | --- | --- | --- |
| U1 | I have arrived | `POST /driver/jobs/{reference}/arrive` with `{ "location_consent": false }` and no `location`; repeating returns 200 unchanged | `arrived_at`; errors 409 `invalid_order_transition`, 409 `job_on_hold`, 404 `order_not_found` |
| U2 | "Arrived at 9:42 AM" | `GET /driver/jobs/{reference}` | `arrived_at` |
| U2 | Start unloading | `POST /driver/jobs/{reference}/transition` with `{ "to": "unloading" }`, then the existing code screen | `order_status` |
| U2, U1, U3 | Paused notice | `hold` on the job, or 409 `job_on_hold` | `hold.message` as the server sends it |
| U3 | Attempts list and count | `GET /driver/jobs/{reference}` | `contact_attempts[].attempted_at` |
| U3 | I tried to reach the customer | `POST /driver/jobs/{reference}/contact-attempts` (no body, 201) | `contact_attempts`; 409 `invalid_order_transition` |
| U3 | Wait-until time | `GET /driver/jobs/{reference}` | `unreachable_allowed_at` |
| U3 | End button on or off | `allowed_actions` contains `record_failed_attempt` only with two attempts and the wait over; the client fetches the job again when `unreachable_allowed_at` passes | `allowed_actions` |
| U3-S | Fail the delivery | `POST /driver/jobs/{reference}/transition` with `{ "to": "failed" }`; the server sets `customer_unreachable` | 200 finished job; 409 `transition_requirements_unmet`, `details.missing` of `contact_attempts_recorded` and/or `unreachable_wait_elapsed` |
| U4 | Reason and time | `GET /driver/jobs` (`done`) | `end_reason`, `ended_at` |
| U5 | Report before arrival | `POST /driver/jobs/{reference}/incidents` as today | `type`, `note` |
| All | Reassigned | 404 `order_not_found` on a job the app had open | |

Every row points to an endpoint in `docs/api/deliveries.md`. Nothing needs a
contract change. Three client fields are new to the app's own types
(`arrived_at`, `contact_attempts`, `unreachable_allowed_at` in
`frontend/src/domain/partner.ts`); that goes in its own small PR.

## Wording to approve

| Where | Wording |
| --- | --- |
| U1 button | I have arrived |
| U1 not sent | We could not record your arrival. Check your connection and try again. / Try again |
| U1 sending | Recording arrival… |
| U2 | Arrival recorded (chip) · You have arrived · Arrived at 9:42 AM · Start unloading · Customer not reachable |
| U2 not sent | Not sent. Check your connection and try again. Nothing changed. |
| Paused (U1, U2, U3) | This job is paused. The dispatcher will contact you. (and the server's hold message) |
| Job changed | This job has changed. Refresh. It is no longer at this step. / Refresh |
| Reassigned | This job was reassigned. It is no longer on your list. / Back to dashboard |
| U3 title and rule | Customer not reachable · Try to reach the customer twice, then wait until 9:52 AM. After that you can end this delivery. · in N min / Wait over · Arrived at 9:42 AM |
| U3 attempts | Attempts · Call customer · No attempts recorded yet. · Attempt 1 · 9:44 AM · 0 of 2 attempts recorded · 2 of 2 attempts recorded · 3 attempts recorded · I tried to reach the customer · Recording… |
| U3 attempt not sent | We could not record this attempt. Try again. |
| U3 offline | You are offline. Connect to record an attempt. |
| U3 end button and helper | Customer not reachable, fail the job · Record two attempts first. 2 more needed. · Record two attempts first. 1 more needed. · You can end this job from 9:52 AM. |
| U3 stale refusal | Record two attempts first. / You can end this job from 9:52 AM. · The screen is refreshed. |
| U3-S | End this delivery? · This records that the customer could not be reached after two attempts. You cannot undo it. · Fail the delivery · Back · Failing the delivery… · Not sent. Check your connection and try again. |
| U4 | Delivery failed · The dispatcher will contact you. · Reason: Customer not reachable · Recorded at Today, 9:53 AM · Back to dashboard |
| U5 after arrival | You have arrived. Record your attempts to reach the customer on the next screen. The report cannot record them. · Record attempts |

## Decisions

1. **No arrival location.** Arrival records the time of the tap and sends
   `location_consent: false`. The fork asks for no location (FR-035 makes it
   optional). Decided by the owner on #250, 2026-10-29.
2. **"Customer not reachable" in the problem report** opens U3 once the job has
   arrived, because the report cannot record attempts. Before arrival it still
   sends an `other` incident. Decided by the owner.
3. **After the failure** the driver sees only "The dispatcher will contact
   you." Nothing about the water on board (the SRS is silent; design open
   question 8) and no money (the redelivery fee is the customer's disclosure,
   FR-038, BR-14). Decided by the owner.
4. **No offline queue.** An attempt carries the server's time, so the attempt
   and end buttons are off while offline and nothing is shown as waiting to
   send. Decided by the owner.
5. **A confirm sheet before failing, and more than two attempts allowed.** Two
   additions of the prompt, approved on #250. The sheet guards a step that
   cannot be undone. The contract says the failed step needs at least two
   attempts and sets no maximum, so every attempt is recorded and extra ones
   only add evidence.
6. **The wait is a clock time, not a ticking countdown.** "Wait until 9:52 AM"
   with a small "in N min" next to it. The server's `allowed_actions` decides
   when the end button turns on; the phone's clock never does.
7. **The customer step keeps the app's title** ("Deliver 750 gallons (3,000
   litres)", and the rider's equivalent), not the preview's "Go to customer".
   Approved on #250.

## Differences from the current app

- **The customer step's title.** The preview shows "Go to customer"; the app
  keeps its own title (decision 7).
- **The button's old wording.** The preview's note quotes "Arrived · water
  pumped in" for both apps; the rider app's was "I have arrived · pour the
  water" for a Keke. Both are replaced by "I have arrived".
- **"Start navigation"** stays on U1; U2 has no navigation button (the partner
  has arrived).

## Problem report: the job line and Back (#257)

Added for [#257](https://github.com/mmiri-oma/mmirioma/issues/257), which
waits for this slice. The "Report a problem" screen (`r-issue`, U5) shows a
card with the job: "<quantity> · <where the job is>". Today it has two phrases
only: "on the way to customer" for every job past loading, including one that has
arrived or is unloading, and "going to the station" for the rest. With the
arrival step (U1, U2) the app can tell the steps apart, so the line names the
real one, and the "Back" arrow returns to the screen of that step.

The line and the Back target follow the step of the job (the first column is
the backend `order_status`; the client tells the steps apart as described below
the table):

| `order_status` | Job line on the report card | Back goes to |
| --- | --- | --- |
| `accepted`, `departed` | <quantity> · going to the station | The refill step (as today) |
| `collected`, `en_route` | <quantity> · on the way to customer | The customer step, U1 (as today) |
| `arrived` | <quantity> · arrived at the customer | The arrived screen, U2 |
| `unloading` | <quantity> · unloading | The code screen (as today's `r-otp`/`t-otp`) |

- **Wording to approve (new):** "arrived at the customer" and "unloading". The
  other two phrases are the app's current ones and do not change.
- No new endpoint or field. The app's `PartnerJob` has no `order_status` (only
  the backend's `DriverJobSummary` does), and its stage `collected` covers
  `collected`, `en_route`, `arrived` and `unloading`. The steps are told apart
  with the fields added in #263: stage `accepted` is before loading; for stage
  `collected`, no `arrived_at` means on the way to the customer,
  `arrived_at` with `can_start_unloading` means arrived (U2), and `arrived_at`
  without it means unloading.
- The report card shows for an active job only; a finished job has no card (the
  screen then reads "Support", as today).
- "Customer not reachable" on this screen after arrival opens U3 (decision 2);
  the job line and Back above are the same on that path.

## Open questions

None.

## Known limitations

- **Self-reported times.** With no arrival location, "I have arrived" and each
  attempt are times the driver reports by tapping, so a driver could tap "I have
  arrived" early to start the clock. The server enforces the full wait from
  that time and the two attempts, and the dispatcher sees the times. To list in
  `docs/features/partner-app.md` when the screens are built.
- **"The dispatcher will contact you."** promises staff action, so the pilot
  needs a dispatcher to follow up a failed delivery. The Orders page has a
  "Delivery failed" tab for finding them (#273); there is no alert.
- **The report screen's job line** (#257) is not part of this design; its wording
  is decided with #257.

## Changes to the design system

- **Button variant outline-danger** (U2, "Customer not reachable"): an outlined
  button in the danger colour, so the second action reads as a warning without
  looking like the end action. Add it to `design-system.md` when built.
- **AttemptList** (U3): rows "Attempt n · time" with a count under them. No
  existing part lists timed rows with a count; the job timeline is admin-only.
  Add it to `design-system.md` when built.
- Everything else reuses the existing trip screens, Card, Chip, Notice, Footer,
  the confirm sheet of the cash screens, and the done screen layout.
