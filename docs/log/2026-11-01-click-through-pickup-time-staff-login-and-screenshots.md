# 2026-11-01: Click-through: pickup time before the job start, staff login while signed in as a driver, and browser screenshots that time out

- **Area:** tooling
- **Author:** chidimmamogbo + agent
- **Symptom:** Three snags in the failed-then-cancelled click-throughs for #275
  and #274 (real backend, scratch database, demo seed; setup as in
  `2026-10-30-click-through-with-playwright-and-demo-orders-that-need-confirming.md`):
  1. `POST /driver/jobs/{ref}/pickup` with `picked_up_at` five seconds in the
     past gave 422 `validation_error`: "Pickup time cannot be before the job
     started" (`loc: body.picked_up_at`). The script had sent `departed` a
     moment earlier.
  2. With the demo driver signed in, opening `/admin/login` showed the
     driver home again instead of the staff sign-in. The first "Log out"
     click seemed to do nothing.
  3. In the Chrome browser tool, `screenshot` failed several times with
     `CDP sendCommand "Page.captureScreenshot" timed out after 30000ms`. The
     first sign-in also looked stuck on the login page for a few seconds.
- **Cause:**
  1. The service checks that the pickup is not before the job started
     (`departed`), and the gap between the two calls was under five seconds.
  2. The staff login page only shows to a signed-out visitor, and one
     browser holds one session. The driver's "Log out" opens a confirmation
     dialog ("Log out of the driver app?") that has to be confirmed.
  3. The page was busy, with the dev server and the app's first load on a
     4-core machine. The sign-in had worked; the page just had not redrawn yet.
- **Fix / workaround:**
  1. Send `picked_up_at` as the current time, taken after `departed`.
  2. Log out from the driver menu and confirm the dialog, then open
     `/admin/login`. Or move the driver steps to the API and keep the browser
     for the dispatcher.
  3. Read the page with `get_page_text`, `find` or `read_page` instead of
     screenshots, and wait a few seconds after signing in before deciding it
     failed.
- **Status:** workaround
- **Refs:** #274, #275, #321; `backend/app/modules/deliveries/service.py`
  (the pickup time check).
