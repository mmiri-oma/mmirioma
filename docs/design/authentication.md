# Authentication design

<!-- Recorded from the Claude Design canvas, artboard Auth.dc.html, version
1792015088-aba8. Workflow: docs/process/ui-driven-development.md -->

Issue: S1-14 (#18) · Requirements: FR-001, FR-002, FR-003, NFR-001, NFR-002,
NFR-012, NFR-020, NFR-021, NFR-022 · Prompt:
[prompts/04-authentication.md](prompts/04-authentication.md)
Designer: @nnamdi-security · Reviewed by: @nnamdi-security on 2026-10-15 ·
Status: approved

This is the canonical design for sign-in, account creation and session screens
in all three apps. Prompts 01-03 reuse it. It is built from the
[design system](design-system.md); the components it added are listed in
[Changes to the design system](#changes-to-the-design-system).

## Design link

- Claude Design canvas: <https://claude.ai/artifact/9fKnBVzgvqwm8vx1eU8Y5C>,
  artboard **"Authentication screens"** (`Auth.dc.html`, 1440 px page), next
  to the design system artboard.
- Version recorded here: `1792015088-aba8`.
- Every frame has numbered notes saying which field rule or server response
  each element uses. The canvas is the visual reference; no screenshots are
  committed.

## Screens and states

All screens are **build now** (S1-17). Customer and driver frames are 360 px;
staff frames are 1280 px, with key states also at 360 px.

| Screen | States designed | Build now / design ahead |
| --- | --- | --- |
| C1 Welcome (customer) | Default: one sentence, "Create account" (primary), "Sign in" (secondary), "Need help? Call or WhatsApp us" with Call and WhatsApp buttons and a sample number | Build now |
| C2 Create account (customer) | Default, inline errors, submitting, account already exists, rate limited, no connection, success (customer home with one-time notice) | Build now |
| C3 Sign in (customer) | Default, submitting, incorrect details, rate limited, no connection | Build now |
| S1 Staff sign in | Default, submitting, incorrect details, rate limited, no connection (1280 px); default, incorrect, rate limited (360 px) | Build now |
| D1 Driver sign in | Default, submitting, incorrect details, rate limited, no connection | Build now |
| X1 Checking session | Customer, staff, driver | Build now |
| X2 Session ended | Customer with an open water request, staff, driver | Build now |
| X3 Security check failed | Customer, staff, driver (drawn on the sign-in screens; build per Decision 7) | Build now |
| X4 Wrong app for this account | Customer app, staff app, driver app | Build now |
| X5 Signed-in header and sign out | Customer account menu (open, signing out, sign-out failed offline, signed out to welcome); staff top bar (signed in, signing out, failed offline, signed out); staff at 360 px (menu open); driver top bar menu (open, signing out, failed offline, signed out) | Build now |
| X6 Unconfirmed phone notice | Customer home with the banner | Build now |

### Behaviour shown on every form

- The phone number is **kept** after every error; the password is **cleared**
  after every failed attempt.
- Submitting: spinner added, label kept ("Creating account", "Signing in"),
  `aria-busy`, fields locked with values still visible, extra taps ignored
  (no double submit).
- Rate limited: warning banner with the server message and "Try again in
  N minutes" from the server's wait time; the submit button is off until the
  wait ends.
- No connection: error banner with "Retry". With the password cleared, Retry
  moves focus to the password field first.
- Account already exists (C2): "Sign in instead" goes to C3 with the phone
  number carried over.
- Session ended (X2): fields are empty; nothing from the old session is shown.
  Staff return to the same page and filters after signing in.
- Sign out: spinner and "Signing out"; on success, customers go to C1 and staff
  and drivers to their sign-in screen, with the toast "You've signed out.". On
  failure an error toast with "Try again"; the menu stays open and the person
  stays signed in.
- X6 banner has no close button and disappears only when staff confirm the
  phone. The C2 success notice is shown once, with "Got it".

### Exact text

Server messages, checked against the implemented backend
(`backend/app/modules/auth/`):

| Situation | Text | Source |
| --- | --- | --- |
| Wrong phone or password, unknown phone, disabled account | "Phone number or password is incorrect" | 401 `invalid_credentials` |
| Phone already registered | "An account with this phone number already exists" | 409 `phone_already_registered` |
| Rate limited | "Too many attempts. Please wait and try again." plus "Try again in 12 minutes" (sample) | 429 `too_many_attempts`, `Retry-After` / `details.retry_after_seconds` |
| Security check failed | "Security token missing or invalid. Reload the page and try again." | 403 `csrf_failed` |

Client messages (from the prompt):

| Situation | Text |
| --- | --- |
| Phone format | "Enter a Nigerian mobile number, for example 08000000001" |
| No connection | "Unable to reach the server. Check your connection and try again." |
| Session ended | "Your session has ended. Please sign in again." |
| Session ended with an open request (customer) | "Your request has not been sent. What you typed is kept." |
| Wrong app: customer app | "This account is for MmiriOma staff. Use the staff or driver app." |
| Wrong app: staff app | "You do not have access to this page." |
| Wrong app: driver app | "This app is for MmiriOma delivery partners." |
| Signed out | "You've signed out." |
| Sign out failed | "Couldn't sign out. Check your connection and try again." |
| C2 success notice | "A team member will confirm your phone number before your first delivery is confirmed." |
| X6 banner | "We'll confirm your phone number before your first delivery." |
| Phone helper (C2) | "We'll use this to contact you about deliveries." |
| Password helper (C2) | "At least 8 characters." |
| Forgot password | Customer: "Forgot your password? Contact us" (link). Staff: "Forgot your password? Ask the technical lead to reset it." (plain text). Driver: "Forgot your password? Call the dispatcher." (opens the dialler) |

Copy written by the design (not in the prompt; approved with this design):

- "Enter your full name." (name error on C2)
- "Use 8 to 128 characters." (password error on C2)
- C1 sentence: "We bring water to your door in Enugu, and the driver unloads it
  for you."
- "Got it" on the C2 success notice
- Loading labels "Creating account", "Signing in", "Signing out"
- Links "New to MmiriOma? Create account" and "Already have an account? Sign in"

## Screen-to-endpoint table

All endpoints are in [auth.md](../api/auth.md) (as merged on `main`).

| Screen | Element / action | Endpoint | Fields used |
| --- | --- | --- | --- |
| C2 | Create account | `POST /auth/register` | Request `name`, `phone`, `password`; response `user`, `csrf_token`, `expires_at`; errors `phone_already_registered`, `validation_error`, `too_many_attempts` (`retry_after_seconds`) |
| C3, S1, D1 | Sign in | `POST /auth/login` | Request `phone`, `password`; response as above; errors `invalid_credentials`, `validation_error`, `too_many_attempts` |
| X1 | Checking session on app start | `GET /auth/me` | 200: `user.role`, `user.name`, `user.phone`, `user.phone_verified`, `csrf_token`; 401 `not_authenticated` goes to sign-in (or C1 for customers) |
| X2 | Session ended | Any request returning 401 `not_authenticated` | None |
| X3 | Security check failed | Any unsafe request returning 403 `csrf_failed` (in Sprint 1 only `POST /auth/logout`) | None |
| X4 | Wrong app | `GET /auth/me` | `user.role`: customer app allows `customer`; staff app `admin`; driver app `driver` |
| X5 | Name in header and menu | `GET /auth/me` | `user.name`; customer menu also `user.phone`, shown as `0800 000 0001` |
| X5 | Sign out | `POST /auth/logout` with `X-CSRF-Token` | 204; errors `not_authenticated`, `csrf_failed`; network failure shows the failed toast |
| C2 success, X6 | Phone confirmation notices | `GET /auth/me` or the register response | `user.phone_verified` (`false` shows the notice) |

No row needs a contract change.

## Decisions

1. Auth layout: a centred card (max width 440 px, `radius-xl`, padding 32,
   `shadow-md`) on desktop; full screen on mobile. The staff card loses its
   border at 360 px.
2. The driver app uses the large (56 px) sunlight variant for fields and the
   primary button, with 18 px text.
3. Rate-limit state disables the submit button until the wait ends, instead of
   letting people retry and get another 429.
4. Session-ended uses the info style, not error, because it is not the
   person's mistake.
5. Staff below 768 px use the same Menu button as the driver app instead of
   the desktop top bar.
6. The full logo image replaces the drawn brand mark on sign-in, welcome and
   splash screens.
7. **X3 is built where the failing action is, not on the sign-in forms**
   (technical lead, 2026-10-15; accepted as a build instruction, the canvas is
   not redrawn). `POST /auth/login` and `POST /auth/register` are exempt from
   CSRF, so sign-in never returns `csrf_failed`. In Sprint 1 only sign out can
   (later, every unsafe request such as order actions). Show the X3 banner in
   the place the action was taken (the account menu or staff top bar for sign
   out), with the exact server text and a "Reload" button. Use the canvas X3
   frames for the banner's look only; ignore their "phone kept, password
   cleared" notes.
8. **Wait-time wording** (technical lead, 2026-10-15). From
   `details.retry_after_seconds` (or the `Retry-After` header), show the wait
   in whole minutes, **rounded up**, never less than one:
   - 1 to 60 seconds: "Try again in 1 minute"
   - 61 to 120 seconds: "Try again in 2 minutes"
   - in general: "Try again in N minutes", N = ceil(seconds / 60)

   The line updates as time passes, and the submit button turns back on when
   the wait reaches zero. Rounding up means the app never invites a retry
   before the server allows it; seconds are never shown, so there is no
   ticking countdown. The longest server wait is one hour (registration), shown
   as "Try again in 60 minutes".

## Review findings

From the check against prompt 04 and [auth.md](../api/auth.md) on 2026-10-15.
Prompt checks that passed: every screen and state exists; server messages
match the backend word for word; no OTP, "verified by SMS" or password-reset
flow; touch targets at least 48 px and the driver button 56 px; visible labels
and errors with icon, words and border; sample data tagged; no sign-up link in
the staff or driver apps.

Resolved:

1. **X3 is drawn on the sign-in forms, but sign-in cannot cause it.** Resolved
   by Decision 7.
2. **The wait-time wording had no rounding rule.** Resolved by Decision 8.

Smaller points (accepted as they are):

3. Staff at 360 px shows default, incorrect and rate-limited states, not
   submitting or no connection. The layout is the same as the 1280 px card.
4. The staff wrong-app text "You do not have access to this page." is client
   copy. The server's 403 `forbidden` message is "You do not have access to
   this resource"; the staff app should show the design's text for both.
5. The design system describes the sunlight button as "the darkest brand
   shade"; it is `primary-800`, not `primary-900`. It has no pressed state
   distinct from its default.

## Open questions

1. **Contact details.** The customer "Contact us", C1 "Call or WhatsApp us"
   and the driver "Call the dispatcher" need the real pilot phone and WhatsApp
   numbers. Until then they are sample data and must not ship as real links.
2. **Keeping a typed request (X2).** "What you typed is kept" means storing a
   draft order (address, receiver phone) on the device. Decide where (memory
   only, or browser storage) and for how long, since it is personal data. This
   is for S1-05; Sprint 1 auth screens only show the message.
3. **Logo files.** The logo (9 KB) and icon (5 KB) exist only as uploads on the
   canvas. They need exporting into the repository for the frontend.

## Changes to the design system

Added by this design and recorded in
[design-system.md](design-system.md#additions-from-the-authentication-design):
logo (full and icon only), password field with Show/Hide, locked field state,
large button (56 px) and sunlight variant, account menu, staff top bar,
splash, and the token `--spacing-touch-lg` (56 px).
