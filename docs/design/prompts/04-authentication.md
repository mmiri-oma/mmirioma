# Prompt 04: authentication screens (customer, staff, driver)

Issue: see [Sprint 1 plan](../../process/sprint-1-plan.md), S1-14 ·
Requirements: FR-001, FR-002, FR-003, NFR-001, NFR-002, NFR-012, NFR-020,
NFR-021, NFR-022 · Contract: [auth.md](../../api/auth.md) (**already
implemented**: the design must fit it; anything else is a contract change
request)

**Why a separate prompt:** authentication is the first thing every user sees
and the backend already exists, so it is designed and approved first, before
the larger slices. Prompts 01-03 also contain these screens so each slice reads
complete; once this design is approved, **it is the source** for all sign-in,
registration and session screens, and 01-03 reuse it.

**Before using:** open the same Claude Design project as prompt 00, so these
screens use the shared design system.

Paste everything inside the block into Claude Design.

```text
Using the MmiriOma design system already defined in this project (reuse its
tokens and components; if a screen truly needs a new component, add it to the
system and say so), design the AUTHENTICATION screens for MmiriOma's three
apps. The customer and driver apps are mobile only (360px); the staff app is
desktop first (1280px) and must also work at 360px.

CONTEXT
MmiriOma is a water delivery service in Enugu, Nigeria. Everyone signs in with
a Nigerian mobile number and a password. Customers create their own accounts;
staff (dispatchers) and delivery partners (drivers) are given accounts by the
team and cannot sign up. Users are on entry-level Android phones with slow,
unstable data.

RULES (must be followed in every screen)
- Phone verification is done manually by staff. Never say "verified by SMS",
  never show a code-entry (OTP) screen.
- There is no self-service password reset in this release. Never show a
  "reset password" flow; show the contact guidance given below instead.
- Error messages appear exactly as written below (they come from the server).
- Every input has a visible label; no placeholder-only labels. Status and
  errors are never shown by color alone. Touch targets at least 48px.
- Never clear the phone number the user typed after an error. Always clear the
  password after a failed attempt.
- All example names and numbers are fictional and tagged "SAMPLE DATA". Use
  phone numbers like 0800 000 0001.

FIELD RULES (shared)
- Phone number: Nigerian mobile. Accepted as 0800 000 0001, 2348000000001 or
  +2348000000001; spaces and dashes allowed. The app checks the format before
  sending; inline error: "Enter a Nigerian mobile number, for example
  08000000001".
- Password: 8-128 characters, show/hide toggle, no complexity rules. Helper on
  create account only: "At least 8 characters."
- Full name (create account only): 1-100 characters.

SERVER MESSAGES (use exactly)
- Wrong phone or password, or a disabled account: "Phone number or password is
  incorrect"
- Phone already has an account: "An account with this phone number already
  exists"
- Rate limited: "Too many attempts. Please wait and try again." plus the wait,
  e.g. "Try again in 12 minutes" (the server sends the seconds to wait).
- Security check failed: "Security token missing or invalid. Reload the page
  and try again."
- No connection: "Unable to reach the server. Check your connection and try
  again."

=== CUSTOMER APP (mobile) ===

SCREEN C1: Welcome - one sentence on the service, "Create account" (primary),
"Sign in" (secondary), "Need help? Call or WhatsApp us" (contact tagged SAMPLE
DATA).

SCREEN C2: Create account - name, phone, password. Helper under phone: "We'll
use this to contact you about deliveries." States: default, inline errors,
submitting (button spinner, form locked, no double submit), "already exists"
banner with "Sign in instead", rate-limited banner with wait time, network
error with Retry. Success: go to the customer's home with a one-time notice:
"A team member will confirm your phone number before your first delivery is
confirmed."

SCREEN C3: Sign in - phone, password, "Forgot your password? Contact us",
link to Create account. States: default, submitting, incorrect details,
rate-limited with wait time, network error.

=== STAFF APP (desktop first) ===

SCREEN S1: Staff sign in - title "MmiriOma staff", phone, password, "Forgot
your password? Ask the technical lead to reset it." No sign-up link. Same
states as C3.

=== DRIVER APP (mobile, one-handed, outdoors) ===

SCREEN D1: Driver sign in - title "MmiriOma delivery partners", phone,
password, "Forgot your password? Call the dispatcher." Primary button at least
56px tall, high contrast for bright sunlight. No sign-up link. Same states as
C3.

=== SESSION AND ACCESS STATES (all three apps) ===

SCREEN X1: Checking session - shown briefly when the app opens while it checks
whether the user is signed in (logo plus spinner). Never flash the sign-in
screen first.

SCREEN X2: Session ended - the app's sign-in screen with the banner "Your
session has ended. Please sign in again." (sessions last 7 days; an account
can also be disabled by the team, which shows the same message with no
explanation). Customer variant: if the customer was filling in a water
request, add "Your request has not been sent. What you typed is kept." Staff
variant: after signing in, return to the same page with the same filters.

SCREEN X3: Security check failed - error banner with the exact message above
and a "Reload" button.

SCREEN X4: Wrong app for this account - signed in, but the role does not
belong here:
- customer app: "This account is for MmiriOma staff. Use the staff or driver
  app."
- staff app: "You do not have access to this page."
- driver app: "This app is for MmiriOma delivery partners."
Each with a "Sign out" button.

SCREEN X5: Signed in header and sign out - show where the signed-in name
appears in each app (customer: account menu with name and phone; staff: top
bar; driver: top bar menu) and the "Sign out" action. States: signing out
(spinner), signed out (back to sign-in or welcome with toast "You've signed
out."), sign-out failed offline ("Couldn't sign out. Check your connection
and try again.").

SCREEN X6: Unconfirmed phone notice (customer only) - an info banner on the
customer's home: "We'll confirm your phone number before your first
delivery." Not dismissible until the phone is confirmed.

DELIVERABLE
All screens and states above, at the sizes stated, annotated with which field
or server response each element uses. End with a list of components used and
any new component or token added to the design system.
```

## After generating

1. Check every screen and state exists, messages match exactly, and there is
   no OTP or password-reset flow.
2. Record the result in `docs/design/authentication.md` using the
   [template](../_template.md). Screen-to-endpoint table: `POST /auth/register`,
   `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` (all in
   [auth.md](../../api/auth.md)).
3. If the design needs anything the auth contract does not provide, open a
   contract change request; do not change the backend to match a mockup
   without agreement.
