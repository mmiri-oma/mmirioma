# Partner apps: Keke rider (and tanker driver)

Status: Keke rider app (Phase 4) and tanker driver app (Phase 5) built on
mocks. Design source: `design/MmiriOma-design-handoff` (`r-*` and `t-*`
screens); decisions in
[docs/design/handoff-v1.md](../design/handoff-v1.md).

## 1. Overview and purpose

The mobile web app delivery partners use to go online, take orders from the
pool or from admin, collect water at a refill station, deliver it, finish
with the customer's delivery code, and follow their sample earnings.

## 2. Feature workflow

1. **Sign in** at `/partner/login` (one login for riders and tanker drivers).
   New partners create an account at `/partner/signup` and choose Keke or
   Tanker (decision 9). Tanker drivers type how many gallons their tanker
   carries (most carry about 4,000, enough for four 1,000 gal tanks); 500 to
   20,000 is accepted (`src/domain/tankCapacity.ts`). They stay "waiting for approval" until admin approves.
2. All partner pages live under `/partner/`, the installed partner app's
   scope (see [pwa.md](pwa.md)). `/partner` sends each partner to their app: `/partner/rider` (Keke) or `/partner/driver`
   (tanker). Opening the other app's link redirects to their own.
3. **Home** (`/partner/rider`): online switch, today's stats, active delivery, first
   open order. An order admin assigned appears as a bottom sheet (`r-assigned`):
   start it, or decline with a reason (decision 13).
4. **Available orders** (`/partner/rider/orders`): the pool for the partner's vehicle
   type, no countdown; list or map view. Accepting gives the order to the
   first partner; others see "already taken".
5. **Trip**: go to the station (`refill`) → confirm pickup (`pickup`: full load
   required, receipt and photo optional) → go to the customer (`customer`) →
   tap "I have arrived", which records the arrival on its own (`arrived`, U2,
   "You have arrived") → "Start unloading" → unload, then tap "Unloading done,
   send the code" (`code`: the customer's
   code is sent only now, FR-035, #13; until then that button is the only
   action, with no keypad and no "Verify code" footer) → enter the
   customer's 6-digit code (3 tries, resend after 2 minutes, then ask admin)
   → done (`done`).

   **If nobody answers (FR-038, T-25, #250):** on the arrived screen the
   driver taps "Customer not reachable" (`unreachable`, U3; the problem
   report's "Customer not reachable" opens it too once the job has arrived).
   The screen lists the contact attempts with the server's times and shows
   "wait until 9:52 AM". "I tried to reach the customer" records an attempt
   (there is no maximum). "Customer not reachable, fail the job" stays off
   until the server allows it (two attempts and the full 10 minutes from
   arrival, `allowed_actions` has `record_failed_attempt`), asks "End this
   delivery?", and then the job ends as `failed` with reason
   `customer_unreachable` (`failed`, U4, "Delivery failed"). Attempts and the
   end are off while the phone is offline: nothing is queued.
6. **Account**: earnings and withdraw request, history, notifications,
   vehicle and papers (upload), report a problem, profile, settings (new
   order alerts and SMS updates), change password. Partners have no email and
   no "News and offers" switch in the pilot (#85).
7. **Tanker drivers** (`/partner/driver`, green theme, `t-*`): the dashboard lists
   tanker orders near you; the orders list filters by Ground or Overhead tank
   and only shows orders the driver's tank can carry. The trip is a
   full-screen map to the station (`refill`) → count the gallons in with the
   tank gauge (`loading`: the order's full gallons required, valves and
   receipt ticks and a meter photo optional) → the customer (`customer`, with
   the tank note) → the same code step → done. Earnings list trips and
   payouts together; "Request payout" opens the withdraw form. History,
   papers, notifications and support are the rider screens with tanker words
   (decision 18).

## 3. Important files

| Path | Responsibility |
| --- | --- |
| `frontend/src/domain/partner.ts` | Job, profile, earnings, notification, issue and decline types and labels |
| `frontend/src/features/partner/partnerApi.ts` | Typed API functions: the mock, or the real API for the six account functions (#67); the rest still fail with `not_connected` |
| `frontend/src/features/partner/real/account.ts` | Account adapters (#67): sign-up, profile and preferences, going online, notifications; converts with [partners.md](../api/partners.md#mapping-to-the-design-types) |
| `frontend/src/lib/api/partners.ts` | Zod-checked client for the partner account endpoints and `GET /service-zones` |
| `frontend/src/features/partner/queries.ts` | Query hooks; pool and active jobs refresh every 30 s |
| `frontend/src/features/partner/partnerContext.ts` | Which app (`/partner/rider` or `/partner/driver`), words per vehicle, `jobStepPath` |
| `frontend/src/features/partner/PartnerArea.tsx` | Signed-in partner guard and vehicle redirect; keeps the screen when a later refresh of the profile fails |
| `frontend/src/features/partner/pages/` | Screens; `Rider*` for Keke, `Driver*` for tanker, `PartnerShared.tsx`, `PartnerAccount.tsx`, `JobDetail.tsx` and `CodeStep.tsx` serve both |
| `frontend/src/features/partner/components/JobStep.tsx` | Loads a job and redirects when it is not at the screen's stage (and trip step); keeps the screen when a later refresh of the job fails |
| `frontend/src/features/partner/pages/ArrivalPages.tsx` | Arrived (U2), Customer not reachable with its confirm sheet (U3) and Delivery failed (U4); the customer step's "I have arrived" button (U1) is `components/ArriveButton.tsx` |
| `frontend/src/features/partner/components/` | `AttemptList` (U3's timed rows and count), `StepError` (the design's error wording per step), `useOnline` |
| `frontend/src/components/art/Art.tsx` | Tanker maps and the `TankGauge` used on the loading screen |
| `frontend/src/mocks/partnerMock.ts` | Mock server rules for partners |
| `frontend/src/mocks/orderSync.ts` | Keeps the customer's order in step with the partner's job |
| `frontend/src/mocks/partnerSeed.ts` | Sample partners, jobs, earnings and notifications |

## 4. Database models and relationships

None yet. The mock follows the SRS entities: drivers and vehicle profiles,
assignments (with accept/decline history), pickup records (FR-034) and
delivery proofs (code acknowledgement, FR-035). One job per order; the
customer order and the partner job share the order reference.

## 5. API endpoints and request/response behavior

Six account functions call the agreed [partner account contract](../api/partners.md)
when `VITE_USE_MOCKS=false` (#67):

| Function | Endpoint |
| --- | --- |
| `partnerSignup` | `GET /service-zones`, then `POST /auth/partner-register` |
| `getPartnerProfile` | `GET /driver/profile` |
| `updatePartnerProfile` | `PATCH /driver/profile` (preferences only) |
| `setOnline` | `PUT /driver/availability` |
| `listPartnerNotifications` | `GET /driver/notifications` (newest 50, plus `unread_count` across all pages) |
| `markPartnerNotificationsRead` | `POST /driver/notifications/read` with no ids (marks all) |

Sign-up matches the typed area to an active zone by name, ignoring case and
extra spaces, and sends its id as `service_zone_id`. The profile has no
documents or payout account, so the adapter returns `[]` and `null` for
them. When admin has not set a
vehicle description yet, the adapter writes one from the sign-up details:
"Tricycle" for a Keke, "4,000 gal (16,000 L) tank" for a tanker, and just
"Tanker" for a tanker with no declared capacity (only drivers made with the
command-line tool; decided by @chidimmamogbo on #86). The
transfer methods become "Ground tanks", "Overhead tanks", "Ground and
overhead tanks", or "Not set yet" when the list is empty.

Six job functions call the driver job endpoints in
[deliveries.md](../api/deliveries.md) through `real/jobs.ts` (#12):

| Function | Endpoint |
| --- | --- |
| `listAvailableJobs` | none: always `[]`, the MVP has no job pool; offers come as `assigned` jobs |
| `listMyActiveJobs` | `GET /driver/jobs`: `offers`, then `today` and `upcoming` |
| `listHistory` | `GET /driver/jobs`: `done` |
| `getJob` | `GET /driver/jobs/{reference}`; after a 404, the job from the `done` list (summary fields only) |
| `acceptJob` | `POST /driver/jobs/{reference}/accept` |
| `declineJob` | `POST /driver/jobs/{reference}/decline`, reasons mapped as in [api-mapping.md](../architecture/api-mapping.md#available-orders-and-declining); for reasons sent as `other`, `GET /driver/profile` first for the vehicle word in the label |

Conversion follows [api-mapping.md](../architecture/api-mapping.md#partner-job-fields-the-backend-does-not-send).

Five trip functions call the rest of those endpoints (#13). One partner step
can send several backend steps, each only if the job has not made it yet
([api-mapping.md](../architecture/api-mapping.md#trip-steps-and-problem-reports)):

| Function | Endpoints |
| --- | --- |
| `confirmPickup` | `POST .../transition` (`departed`), `POST .../pickup`, `POST .../transition` (`en_route`) |
| `completeUnloading` | `POST .../unloading-complete` only; arrival and the start of unloading are their own steps (below) |
| `verifyCode` | `POST .../proof` with the code and the litres recorded at pickup |
| `resendCode` | `POST .../delivery-code` |
| `reportIssue` | `POST .../incidents`; a report with no order fails with `not_connected` |

Four more functions are the arrival and the unreachable customer (#250,
FR-038, [design](../design/driver-arrival-unreachable.md)), one request each.
The screens call them (U1 to U4):

| Function | Endpoint |
| --- | --- |
| `arriveAtCustomer` | `POST .../arrive` with `{ "location_consent": false }` and no location |
| `startUnloading` | `POST .../transition` (`unloading`) |
| `recordContactAttempt` | `POST .../contact-attempts`; the job then lists every attempt, oldest first |
| `failUnreachable` | `POST .../transition` (`failed`); the server refuses until two attempts are recorded and the full 10 minutes have passed since arrival |

The job also carries `arrived_at`, `contact_attempts`, `unreachable_allowed_at`,
`can_start_unloading` and `can_fail_unreachable` (the last two from the server's
`allowed_actions`; [api-mapping.md](../architecture/api-mapping.md#arrival-and-the-unreachable-customer-250)).
The job also carries `ended_at` and `end_reason` (the failed screen's time and
reason, and the history row of a failed job). The mock waits one minute, not
ten (`MOCK_UNREACHABLE_WAIT_MS`), so a demo can finish.

Earnings, payouts and document upload still run on mocks. In real-API mode
they fail with `not_connected`. Earnings and payouts are **hidden in the
pilot** (`PARTNER_PAY_ENABLED` in `lib/features.ts`, #157; partner pay is out
of the MVP, `partners.md` decision 7): no Earnings tab, menu item or "View
earnings" button, and `.../earnings` goes home. The home tiles show real
counts only: rider "Completed" and driver "Trips today" count today's
delivered jobs (Lagos time) from the history, beside the active order. The
history screen's "Earned" tile appears only when the period has jobs and they
carry an amount (the mock does; the real API sends none), never as "₦0" for an
empty period or while the history loads. The
trip maps are illustrations with no place names; the screen names the real
station and address.
Error codes used by the mock: `job_not_found` (404), `order_taken` (409),
`partner_not_approved` (403), `not_assigned_to_you` (409),
`invalid_job_transition` (409), `transition_requirements_unmet` (409, a code
step before unloading is done, `details.missing: ["unloading_confirmed"]`),
`load_not_confirmed` (422), `invalid_code`
(422, `details.tries_left`), `code_locked` (423), `too_many_attempts` (429,
`retry_after_seconds`), `insufficient_balance` (422), `no_payout_account` (409),
`delivery_code_expired` (400, as the backend names it; set up with
`simulateCodeProblem(reference, 'expired')`). `simulateCodeProblem(reference,
'sms_failed')` makes the job report `code_sms_status` `failed`, as a refused
SMS does. A new code clears both.

## 6. Important business rules

- One `driver` role; vehicle type decides the app and the pool (decision 9).
  Tanker drivers see only orders their tank can carry.
- No countdown on the pool. Admin can assign; the partner may accept or
  decline with a reason; a declined order goes back to the pool and is not
  offered to that partner again (decision 13, FR-032).
- Only approved partners can go online and accept (FR-002, FR-012 analogue).
- Pickup must confirm the full load (FR-034). Delivery completes only with
  the customer's code (FR-035); after 3 wrong codes admin must confirm.
- Earnings and payouts are SAMPLES (decision 16). Partners never see an
  order's payment status (FR-040, BR-13; driver-cash decision 3): the done
  screens have no payment row, and the K1 Cash card (#20) goes there.
- A job may come without the cans or tank (until #21), road distances and
  times (no OSRM) or pay (out of the MVP). Screens show the ordered litres in
  litres and gallons, and leave the rest out
  ([api-mapping.md](../architecture/api-mapping.md#partner-job-fields-the-backend-does-not-send)).
- A job may also come without the receiver (offers, FR-032, and ended
  jobs), the full addresses (offers and history) or the code tries (before
  the code is issued). Screens then name the area, leave out the customer
  row and the call buttons, and the code screen says it is waiting for the
  code. Mock mode keeps every value.
- Failed and disputed jobs show in history as "Delivery failed" and "Under
  review"; they are never hidden.
- No invented turn-by-turn directions: the map badge says where to head;
  "Start navigation" hands the address to the phone's maps app.

## 7. Authentication and authorization

`/partner/rider/*` and `/partner/driver/*` need a signed-in `driver`. A partner sees only
pool orders they are eligible for and their own jobs; others return 404
(FR-001, T-07). Customer phone numbers are shown only on the partner's own
active job, for calling.

## 8. Error handling and edge cases

- Every screen has loading, error and empty states; offline and
  waiting-for-approval explain why the pool is empty.
- Errors that block a footer button show next to that button.
- Reloading a trip screen at the wrong stage redirects to the right step.
- A trip step whose request fails stays on its screen and shows its own notice:
  "Not sent. Check your connection and try again. Nothing changed." when the
  connection is lost, "This job was reassigned. It is no longer on your list."
  with "Back to dashboard" when the job was taken away. Every step action ends
  by refreshing the job and the profile, so a failed refresh must not replace
  the screen: only a job or profile that never loaded shows the full-screen
  error.
- Taken orders, a locked code and a resend that is too soon each show a
  clear message.
- Code screen (#138, FR-050): when `code_sms_status` is `failed` the screen
  says the code could not be sent and offers "Send a new code"; it never says
  "Code sent". A `delivery_code_expired` answer shows "This code has expired"
  with "Send a new code", not "That code is not right". The wording is a
  draft until a reviewer approves it (G2).
- Real API: server errors reach the screens unchanged as `ApiError`. Going
  online while pending or suspended shows the server's `partner_not_approved`
  message. A driver with no driver profile gets the error screen
  (`no_driver_profile`).
- Real API sign-up: an area that matches no active zone fails as a
  `validation_error` on `service_area` before anything is sent ("We do not
  serve "X" yet. Areas we serve: …"), shown under the area field. A zone
  the server refuses gets the same message and keeps the other field errors
  (#80). In a `validation_error`, `declared_capacity_gallons` is renamed
  `tank_gallons` and `service_zone_id` `service_area`, so each message
  appears under its field.
- Sign-up: a field error the form has no slot for (`vehicle_type`, or the
  whole body, `loc: ["body"]`) shows in the top notice, next to the field
  errors (#80). A refused sign-up never ends without a message.
- Badges and "Mark all read" use the notification list's `unread_count`, so
  unread messages older than the newest 50 still count (#80).
- Partners have no email and no "News and offers" switch, in mock and real
  mode (#85). `PartnerProfile` has neither field, and settings change only
  New order alerts and SMS updates.
- Real API: a notification `kind` this build does not know is shown with
  the `account` style (shield icon; tapping it opens the profile) and the
  server's title and body. An `approval_status` it does not know is read as
  `pending`.

## 9. Testing instructions

```bash
cd frontend
npm test
```

`src/features/partner/partnerHelpers.test.ts` covers tanker card lines,
`/partner/driver` step paths and the Lagos greeting.
`src/mocks/partner.test.ts` covers vehicle and tank filtering, offline and
unapproved partners, first-to-accept, decline rules, load checks, code tries
and lock, payment of the partner, and the customer's order following the
partner's job. Manual: sign in at `/partner/login` with the demo rider in
`src/mocks/partnerSeed.ts` (mock mode only); finish MO-7KQ2 with the code the
customer demo account sees on its tracking screen. For tankers, sign in with
the demo tanker driver, accept MO-5KL3ZT8QWE (750 gal), load 750 gallons, tap
"Unloading done, send the code" and finish with the code shown under the
keypad (mock mode). In mock mode a customer sees their code from the moment
they order (the customer mock); the partner app gets it only after unloading.

## 10. Known limitations

- Mock data lives in this browser only (localStorage), shared by its tabs.
- Map pins on the "Map" tab and the tanker maps are illustrative, not real positions.
- The gallon count is entered by the driver; nothing reads a real meter.
- Photos and papers are not uploaded anywhere; the mock only records them.
- Admin, phone and WhatsApp numbers are placeholders.
- The decline flow needs a contract change before the real API.
- **Self-reported arrival and attempts (FR-038, #250).** The app sends no
  location with "I have arrived", so the arrival and each attempt are times the
  driver reports by tapping, and a driver could tap "I have arrived" early to
  start the 10-minute clock. The server enforces the full wait from that time
  and the two attempts, and the dispatcher sees the times as "Contact attempt N"
  lines in the order panel's timeline (#280), and in a proof review's evidence.
- **"The dispatcher will contact you."** on the failed screen promises staff
  action. The dispatcher finds a failed delivery under the Orders page's
  "Delivery failed" tab (#273), but nothing alerts them: no notification, no
  dashboard count. The pilot still needs someone to look at that tab.
- **No paused-job banner.** The job carries no hold in the app's types, so a
  paused job shows its notice only when an arrival, attempt or end request is
  refused with 409 `job_on_hold` ("This job is paused. The dispatcher will
  contact you." and the server's message), not when the screen opens.
- The history now also lists cancelled and failed jobs from the time they
  ended; it listed only delivered ones before.
- Real API sign-up takes a typed area, not a zone list, so a partner must
  spell the zone's name. The demo seed creates no zones; create one before
  trying sign-up locally.
- Real API notifications list only the newest 50; the unread count covers
  them all.
- Drivers made with the command-line tool before it asked for a delivery
  type are shown the tanker app when they have a declared capacity, else the
  Keke app.
- Problem reports, declines and sign-ups also reach the admin support queue,
  activity and notifications; admin assignments, reassignments, suspensions,
  station closures and payouts arrive as partner notifications
  ([admin.md](admin.md)).
