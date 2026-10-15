# Prompt 01: customer sign-in, order request and order history

Issue: S1-04 · Requirements: FR-003, FR-020, FR-021, FR-023, FR-026, FR-027,
FR-037 (design ahead), NFR-012, NFR-020, NFR-022 · Contracts:
[auth.md](../../api/auth.md), [orders.md](../../api/orders.md)

> **Authentication screens:** [04-authentication.md](04-authentication.md) is
> the canonical auth design. The sign-in and session screens below are kept so
> this slice reads complete; once the auth design is approved, reuse it here.

**Before using:** open the same Claude Design project as prompt 00, so these
screens reuse that design system.

Paste everything inside the block into Claude Design.

```text
Using the MmiriOma design system already defined in this project (do not create
new colors, fonts or components unless a screen truly needs one; if so, add it
to the system and say so), design the CUSTOMER mobile web app screens below.
Design mobile first at 360px wide, and also show a 1280px desktop version of
each screen (a centered, max-width single column is fine).

CONTEXT
Customers order water deliveries in Enugu, Nigeria. They are on entry-level
Android phones with slow data. They want a simple order, a clear status, and a
driver who does the unloading.

PRODUCT HONESTY RULES (must be followed in every screen)
- Never invent a price. In this release, orders have NO price: the customer
  sends a request and MmiriOma replies with a price later. Any naira amount on
  a "design ahead" screen must carry the "SAMPLE DATA" tag.
- A request is never shown as a confirmed delivery. Use the words "Request
  received" or "Awaiting confirmation" until it is confirmed.
- No live map tracking, no moving vehicle icons, no real-time ETA.
- Never claim the water is safe to drink, purified or potable.
- Phone verification is done manually by staff. Never say "verified by SMS".
- All example names, phone numbers and addresses are fictional and tagged
  "SAMPLE DATA". Use phone numbers like 0800 000 0001.

=== BUILD NOW (this release) ===

SCREEN 1: Welcome
- Short explanation: order water, choose a quantity, a driver delivers and
  unloads it for you.
- Buttons: "Create account", "Sign in".
- A line "Need help? Call or WhatsApp us" with a placeholder contact (tagged
  SAMPLE DATA).

SCREEN 2: Create account
Fields (all with visible labels and helper text):
- Full name: required, 1-100 characters.
- Phone number: required, Nigerian mobile. Accepts 0800 000 0001,
  234..., +234... Helper: "We'll use this to contact you about deliveries."
- Password: required, 8-128 characters, with show/hide toggle. No complexity
  rules; helper text: "At least 8 characters."
States to show:
- Default, filled, inline field errors.
- Submitting (button spinner, form disabled, cannot double-submit).
- Error banner "An account with this phone number already exists" with a
  "Sign in instead" action.
- Error banner "Too many attempts. Please wait and try again." showing the
  wait ("Try again in 12 minutes").
- Network error: "Unable to reach the server. Check your connection and try
  again." with Retry. Entered name and phone are kept; password is cleared.
After success: go to Screen 4 with a one-time note that a team member will
confirm the phone number before the first delivery is confirmed.

SCREEN 3: Sign in
Fields: phone number, password (show/hide).
States: default, submitting, error "Phone number or password is incorrect",
too-many-attempts with wait time, network error. Link to "Create account".
No "forgot password" link in this release (password reset is handled by
contacting support: show "Forgot your password? Contact us").

SCREEN 3A: Session and access states
- Opening the app: while the app checks whether the customer is still signed
  in, show a brief loading state (logo plus spinner), never a flash of the
  sign-in screen.
- Session ended (signed out after 7 days, or the account was deactivated):
  the sign-in screen with the banner "Your session has ended. Please sign in
  again." If this happens while filling in the request form, the banner also
  says "Your request has not been sent. What you typed is kept." and the form
  reopens filled in after signing in (password never kept).
- Security check failed: error banner "Security token missing or invalid.
  Reload the page and try again." with a "Reload" button.
- Wrong kind of account: a staff or driver account signing in here sees "This
  account is for MmiriOma staff. Use the staff or driver app." with "Sign out".
- Signing out: the menu item shows a spinner, then the Welcome screen with a
  toast "You've signed out." If signing out fails because the network is down,
  show "Couldn't sign out. Check your connection and try again."

SCREEN 4: Home / My orders (order history)
- Top bar with app name and an account menu (name, phone, "Sign out").
- If the phone is not yet confirmed by staff: an info banner "We'll confirm
  your phone number before your first delivery."
- Primary action: "Request water".
- List of the customer's orders, newest first. Each row/card: order reference
  (e.g. MO-7KQ2M9XH4T), status badge, quantity in litres, delivery address
  (one line, truncated), preferred date if given, created date.
- Pagination: "Load more" at the end.
States: loading skeleton, empty ("You have no orders yet" + "Request water"),
error with Retry, list with several orders in different statuses.

SCREEN 5: Request water (order request form)
One page, grouped into sections. Mobile: single column, sticky submit button.
Section "How much water?"
- Quantity chooser with presets 25, 50, 100, 200, 300, 500 litres plus "Other
  amount" (whole litres, 1 to 100,000). Note in the design: presets are sample
  values pending business approval.
Section "Where should we deliver?"
- Receiver's name (prefilled with account name, editable), 1-100 characters.
- Receiver's phone (prefilled, editable).
- Delivery address: multi-line, 5-500 characters.
- Landmark (optional, up to 200 characters), e.g. "Opposite the blue gate".
- Delivery instructions (optional, up to 500 characters), e.g. "Tank is
  behind the house".
Section "When?"
- Preferred delivery date (optional, today or later). Helper: "This is a
  preference, not a booked time. We'll confirm the delivery window with you."
Section "Price"
- Info box: "We'll send you the total price before anything is confirmed. You
  don't pay anything now."
Submit button: "Send request".
States: default, field errors, submitting (no double submit), network error
with Retry that keeps every field, success -> Screen 6.

SCREEN 6: Request received (confirmation)
- Heading "Request received". Not "Order confirmed".
- Order reference, large and copyable.
- Summary of quantity, address, landmark, preferred date.
- "What happens next": 1. We review your request and send you a price.
  2. You accept the price. 3. We confirm a delivery window. 4. A driver
  delivers and unloads the water for you.
- Buttons: "View my orders", "Request more water".

SCREEN 7: Order detail
- Reference, status badge, created date and time (Africa/Lagos).
- All details from the request.
- A plain status explanation per status, e.g. Request received: "We're
  preparing your price."
States: loading, "Order not found" (also used when the order belongs to
someone else), error with Retry.

=== DESIGN AHEAD (later releases; tag each screen "Design ahead - not in
current build") ===

SCREEN 8: Price quote
- Total price in naira (tagged SAMPLE DATA), quantity, water category name and
  supported-use description (placeholder text, no quality claims), delivery
  window, "Price valid until" time.
- Buttons "Accept price" and "Not now".
- Expired state: "This price has expired. Request a new price."

SCREEN 9: Choose delivery window
- Available windows grouped by date; full windows shown as unavailable (text
  plus icon, not color only). Error: "That window was just taken. Please choose
  another."

SCREEN 10: Order progress timeline
- Vertical timeline of major status changes with times: Confirmed, Driver
  assigned, Water collected, On the way, Delivered. Latest announced delivery
  window shown. No map, no live location.
- Delivered state shows quantity delivered.
- Status variants: Cancelled (with reason), Delivery failed (with reason and
  "Contact us"), Under review.

DELIVERABLE
All screens above with their states, mobile and desktop, annotated with which
API data each element shows. End with a list of every component used and any
new component or token you added to the design system.
```

## After generating

1. Check every screen and state above exists, and the honesty rules hold.
2. Record the result in `docs/design/customer-ordering.md` using the
   [template](../_template.md), including the screen-to-endpoint table. Sprint 1
   endpoints are in [orders.md](../../api/orders.md) and
   [auth.md](../../api/auth.md); "design ahead" screens have no endpoint yet.
3. Anything the design needs that the contracts lack becomes an open question,
   not a new field.
