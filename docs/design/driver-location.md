# Rider and driver location design

<!-- Workflow: docs/process/ui-driven-development.md. Gates: CLAUDE.md. -->

Issue: [#410](https://github.com/mmiri-oma/mmirioma/issues/410) ·
Requirements: FR-031, FR-035, SRS §1 · Prompt:
[prompts/21-driver-location.md](prompts/21-driver-location.md) · Contract:
[partners.md, amendment #410](../api/partners.md#amendment-410-driver-location-for-automatic-dispatch)
(agreed) · Designer: @DevBonavee + Claude Code (written design; no visual
mockup yet) · Reviewed by: @nnamdi-security (+ Codex), 2026-11-12, PR #423 · Status: approved (G2, the written flow,
states and wording only; the visual mockup is still to be attached and
approved before the screens are built)

**Two approvals.** Approving this record approves the written design: the
flow, the states and the wording. The visual mockup is a separate approval:
it is generated from the prompt, attached under "Design link" and approved by
a reviewer before the screen is built.

This is a written design: the flow, every state and the exact wording. It
becomes `Status: approved` when one reviewer who is not the author checks it
against the SRS, the issue and decision D6. The visual mockup is made from the
prompt and attached before the screen is built; if it differs, the layout
changes and the wording here stays.

A rider or driver who goes online is asked, after a short explanation, to
share their current location so automatic dispatch (#411) can offer them jobs
near the water source. Saying no keeps them online; only automatic offers stop.
While the app is open and on screen it confirms the location again before it
goes stale. Nothing is sent in the background, and going offline deletes it.

## Design link

None yet. The frames are generated from the prompt and attached here.

## Screens and states

| Screen | States designed | Build now / design ahead |
| --- | --- | --- |
| D1 Going online (bottom sheet on `r-home`, `t-home`) | Explain, finding, done, refused, unavailable | Build now |
| D2 Online card | Confirmed (with accuracy), out of date, not shared, unavailable, offline, not approved, advice line | Build now |
| D3 "Confirm your location" message | In the notifications list; opens the home and starts finding | Build now |
| D4 Server errors | `driver_offline`, `partner_not_approved`, location refused, no connection | Build now |

### D1. Going online

Turning the online switch on opens a bottom sheet before anything is asked of
the phone, the first time and every time the phone has not shared its location
yet in this session.

> **Share your location while you're online**
> MmiriOma offers jobs to riders near the water source. We'll ask your phone
> where you are now, and again every few minutes while the app is open. We
> delete it when you go offline. Customers never see it.

Buttons: **Share location and go online** (primary) and **Go online without
it** (line). The second sets the partner online, calls
`DELETE /driver/location` so no earlier point stays usable, and shows D2c's
wording without asking the phone.

After **Share location and go online**: the app goes online
(`PUT /driver/availability`), turns sharing on
(`POST /driver/location/sharing`, which returns the grant every location
update carries), then shows "Finding your location…" with
**Cancel** while the phone's own prompt is up (15 seconds at most). Cancel
leaves them online and calls `DELETE /driver/location` (D2c).

If going online fails, the sheet stays open with "We couldn't put you online.
Check your connection." and **Try again**; the phone is not asked. If going
online works but sending the location fails, the partner is online and the
card shows the location error (D4), not an "online" failure.

**Consent for this session.** Choosing **Share location and go online** is the
driver's consent for this session. It is withdrawn by **Go online without
it**, **Cancel**, a refused phone prompt, **Turn off location sharing** (D2) or
going offline. While it is withdrawn the app asks the phone for nothing,
automatic refresh is off, and any answer from a position request already in
flight is thrown away, not sent. The server enforces it too: a location update
sent before the withdrawal is refused (409 `location_sharing_withdrawn`), so
it can never bring sharing back. Consenting again means the explanation and
**Share my location** again, which issues a new grant.

### D2. The online card

Under "You are online" on `r-home` and `t-home`:

| State | Line and action |
| --- | --- |
| Confirmed | "Location confirmed 2 min ago" ("just now" under a minute), then "about 20 m". Over 100 m: "Not very accurate. Try again in the open." Links **Confirm again** and **Turn off location sharing** (withdraws consent: `DELETE /driver/location`, then Not shared) |
| Out of date (`stale`) | Amber notice: "Your location is out of date. You won't be offered jobs automatically until you confirm it." Button **Confirm my location** |
| Not shared (refused or withdrawn) | Shown only once `DELETE /driver/location` has succeeded, so the words are true. Notice: "Location is off for MmiriOma. You won't be offered jobs automatically, but staff can still give you one. To turn it on, allow location for this site in your browser settings." Button **Try again** (opens D1's explanation again). If the delete fails: "We couldn't turn off location sharing. Check your connection." with **Try again** |
| Unavailable | Notice: "We couldn't find your location. Try again outside or near a window." Button **Try again**. When the phone or browser cannot share location at all: "This phone or browser can't share its location. Staff can still give you jobs." with no button |
| Offline | The card as today, no location line. "Location deleted." is shown once, only after the server confirms the partner is offline (the same transaction deletes the point). If going offline fails, the partner is still online: "We couldn't take you offline. Check your connection." with **Try again** |
| Not approved | As today: the partner cannot go online, so there is no location step |
| Advice (with Confirmed and Out of date) | "Waiting near an approved water source helps you get offers sooner." |

While the app is open and visible, the partner is online **and consent for
this session is given**, the app confirms the location again by itself about a
minute before `fresh_until`, without a new prompt (the browser keeps the
permission). It stops when the app is hidden, when consent is withdrawn and
when the partner goes offline, and starts again only when all three hold. A
position that arrives after it stopped is discarded. A failed automatic refresh
changes nothing until the point goes stale; then the card shows Out of date.

### D3. The message

Notification kind `confirm_location`, title **Confirm your location**, body
"An order is waiting. Open MmiriOma and confirm where you are so you can be
considered for it." It never names a customer, an address or an order. Only partners who are online and otherwise eligible for
the waiting order receive it.

Tapping it opens the home screen. If consent for this session is already given,
it starts "Finding your location…". Otherwise it opens D1's explanation first,
with **Share my location** and **Not now**; the phone is asked only after
**Share my location**. It never asks the phone directly.

### D4. Server errors

| Answer | What the screen does |
| --- | --- |
| 409 `driver_offline` | Shows the card as Offline: they went offline elsewhere |
| 403 `partner_not_approved` | Shows the Not approved card |
| 422 on `location` | "This location is outside the area we deliver in." with **Try again** |
| 409 `location_sharing_withdrawn` | Sharing was turned off (here or in another tab) since this update started: stop refreshing and show Not shared. **Try again** opens the explanation |
| No connection | "Check your connection." with **Try again**; the partner stays online. The card says which step failed: going online, sending the location, or turning sharing off |

## Screen-to-endpoint table

| Screen | Element / action | Endpoint | Fields used |
| --- | --- | --- | --- |
| D1 | Go online | `PUT /driver/availability` | `is_available` |
| D1, D3 | Share my location (consent) | `POST /driver/location/sharing` (amendment #410, agreed) | `grant` |
| D1, D2 | Share or confirm location | `PUT /driver/location` (amendment #410, agreed) | `location`, `accuracy_metres`, `grant` |
| D1, D2 | Go online without it, Cancel, refused, Turn off location sharing | `DELETE /driver/location` (amendment #410, agreed) | none |
| D2 | Card state | `GET /driver/profile` | `location.state`, `confirmed_at`, `fresh_until`, `accuracy_metres` |
| D3 | The message | `GET /driver/notifications` | `kind: confirm_location` (created by #411) |

## Decisions

- **D6** (contract): refresh only while the app is open and visible; a
  message asks online partners to confirm when an order waits and nobody is
  fresh; a partner who closes the app may miss automatic offers.
- **Online first, then location.** Refusing location never blocks working:
  staff can still assign by hand (#411).
- **No map and no coordinates on screen.** The partner sees when the location
  was confirmed and how accurate it was, never a dot on a map, so nothing reads
  as tracking (SRS §1, FR-037).
- **The explanation comes before the phone's prompt**, every session until the
  driver consents, from every entry point, the message included (FR-035's
  "consent obtained beforehand").
- **Refusing or withdrawing deletes the point on the server** before the card
  says automatic offers have stopped, so the words never get ahead of what the
  server does.

## Honesty rules

- No "live", "tracking" or "we can see you". The location offers nearby jobs
  and is deleted when the partner goes offline.
- Customers never see it, and the explanation says so.
- "Waiting near an approved water source" is advice only; nothing checks it.
- No distances, counts of nearby jobs or arrival times.
- Sample names carry a Sample tag.

## Open questions

- Keke declared capacity (contract question 410-3) is deferred to its own
  amendment; the reviewer has asked the owner for the unit and bounds.

## Changes to the design system

None: the bottom sheet, notices, chips and the online card already exist.
