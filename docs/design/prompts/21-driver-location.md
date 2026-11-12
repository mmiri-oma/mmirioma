# Prompt 21: rider and driver confirm their location when going online

Issue: [#410](https://github.com/mmiri-oma/mmirioma/issues/410) ·
Requirements: FR-031 (fresh driver location for automatic offers), FR-035
(consent before location), SRS §1 (no GPS telemetry) · Contract:
[partners.md, amendment #410](../../api/partners.md#amendment-410-driver-location-for-automatic-dispatch)
(**proposed, not agreed**) · Record: [driver-location.md](../driver-location.md)

**Why this prompt:** automatic dispatch (#411) offers work only to riders and
drivers whose location is fresh. Today going online is one switch on `r-home`
(Keke rider) and `t-home` (tanker driver), and the app never asks where the
partner is. #410 adds a location step when going online, a way to confirm it
again, and the states for when it is old, refused or unavailable. It changes
what partners see, so it needs design approval (G2) before it is built.

**Before using:** the visual system is the **design handoff v1**
([handoff-v1.md](../handoff-v1.md)). Extend `r-home` and `t-home` with their
existing components (the online card, notices, chips, the bottom sheet). Add
no colours, fonts or components.

```text
Using the MmiriOma partner app design already in this project (design handoff
v1: its colours, Plus Jakarta Sans, the online card, notices, chips and bottom
sheet), design how a Keke RIDER (r-home) and a tanker DRIVER (t-home) share
their current location when they go online. Mobile only, 360px wide. Add no
colours, fonts or components. Show the rider version; the driver version uses
the same states with "driver" and "tanker" words.

CONTEXT
Riders and drivers in Enugu, Nigeria, use entry-level Android phones with
slow, expensive data and patchy GPS. Being online means they can be offered
jobs. MmiriOma offers a job automatically only to someone whose location was
confirmed in the last five minutes, to pick the nearest person to the water
source. A dispatcher can still give anyone a job by hand.

PRODUCT HONESTY RULES (every screen)
- Ask for the phone's location ONLY after the partner turns "online" on or
  taps "Confirm my location", after a short explanation. Never on page load,
  never at sign-up.
- Saying no keeps them online. Say plainly what it costs: they will not be
  offered jobs automatically, but staff can still give them one. Show that
  only after the server confirms the location was deleted.
- Let them turn location sharing off at any time while online.
- No tracking language. Never "live", "tracking", "we can see you", or a map
  of their position. The location is used to offer nearby jobs and is deleted
  when they go offline.
- Customers never see it; say so once in the explanation.
- Waiting near an approved water source helps them get offers. Say that as
  advice only: nothing checks or enforces where they wait.
- No invented numbers: no distances, no "jobs near you" counts, no ETA.
- Sample names carry a "Sample" tag.

SCREENS AND STATES

D1. GOING ONLINE (from the online card)
  a. Explain, as a bottom sheet the first time and each time the phone has not
     shared its location yet: why (to offer you jobs near the water source),
     that it is only while online and is deleted when they go offline, that
     customers never see it. Buttons "Share location and go online" and
     "Go online without it".
  b. Finding your location: spinner, "Cancel". The phone's own permission
     prompt appears here.
  c. Done: they are online with a fresh location (D2a).
  d. Permission refused: online, not shared (D2c).
  e. Phone could not find itself or timed out: online, unavailable (D2d).

D2. ONLINE CARD STATES (on r-home and t-home, under "You are online")
  a. Location confirmed: "Location confirmed 2 min ago", with the accuracy the
     phone reported ("about 20 m"; over 100 m: "Not very accurate. Try again
     in the open"). A small "Confirm again" link.
  b. Location old (more than five minutes): amber notice "Your location is
     out of date. You won't be offered jobs automatically until you confirm
     it." Button "Confirm my location".
  c. Location not shared (permission refused): notice saying so, how to turn
     it on in the browser settings, and that staff can still give them jobs.
     Button "Try again".
  d. Location unavailable (no fix, or the phone or browser cannot share
     location): notice with "Try again" when it can be tried again.
  e. Offline: the card as today; no location line. Going offline deletes the
     location, and the card may say so once: "Location deleted."
  f. Not approved yet: as today (cannot go online); no location step.
  g. Advice line, in D2a and D2b: "Waiting near an approved water source helps
     you get offers sooner."

D3. "CONFIRM YOUR LOCATION" MESSAGE
  The in-app notification "Confirm your location": "An order is waiting.
  Open MmiriOma and confirm where you are to be offered it." Tapping it opens
  r-home or t-home. If they already agreed to share this session, it starts
  D1b; otherwise it shows D1a's explanation first. It never asks the phone
  directly, names no customer, address or order, and never promises an offer.

D4. ERRORS FROM THE SERVER (keep them online, keep the card)
  409 driver_offline        they went offline elsewhere: show offline (D2e)
  403 partner_not_approved  show D2f
  422 location refused      "This location is outside the area we deliver
                            in." with "Try again"
  network failure           "Check your connection" with "Try again"

While the app is open and on screen, it confirms the location again by
itself before five minutes pass, with no prompt (D2a just updates "1 min
ago"). When the app is in the background or closed, nothing is sent.

BUILD NOW: D1 to D4. DESIGN AHEAD: none.

OUTPUT
For each screen: the 360px frame, every state above, and the exact copy.
Name components as in the handoff.
```

## Field rules

| Item | Rule | Source |
| --- | --- | --- |
| Going online | `PUT /driver/availability` first; the location is sent only after it succeeds | [partners.md](../../api/partners.md#put-driveravailability) |
| Location | `PUT /driver/location` with the point and the accuracy the phone reports | [amendment #410](../../api/partners.md#amendment-410-driver-location-for-automatic-dispatch), proposed |
| "Confirmed N min ago", out of date | `location.state`, `confirmed_at`, `fresh_until` on the profile; never the coordinates | same |
| Device position | The existing `requestDevicePosition` (15 s wait, `denied`, `unavailable`, `unsupported`) | `frontend/src/lib/devicePosition.ts` |
| The message | Notification kind `confirm_location` | same |
