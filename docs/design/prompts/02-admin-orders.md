# Prompt 02: admin sign-in, order directory and order detail

Issues: S1-08 (design), S1-09 (build) · Requirements: FR-001, FR-002, FR-030,
FR-033, BR-09, NFR-020, NFR-021 · Contracts: [auth.md](../../api/auth.md),
[orders.md](../../api/orders.md)

> **Authentication screens:** [04-authentication.md](04-authentication.md) is
> the canonical auth design. The sign-in and session screens below are kept so
> this slice reads complete; once the auth design is approved, reuse it here.

**Before using:** open the same Claude Design project as prompts 00 and 01, so
admin screens share the customer app's design system.

Paste everything inside the block into Claude Design.

```text
Using the MmiriOma design system already defined in this project (reuse its
tokens and components; if a screen truly needs a new component, add it to the
system and say so), design the ADMIN / DISPATCHER web screens below. Design
desktop first at 1280px and also show each screen at 360px mobile width:
dispatchers sometimes work from a phone.

CONTEXT
Dispatchers review incoming water delivery requests, and later confirm them,
assign drivers and handle problems. This release only lists requests and shows
their details. Staff accounts are created by the team; there is no sign-up.

PRODUCT HONESTY RULES
- No prices in this release: requests have no price yet. Any naira amount on a
  "design ahead" screen carries the "SAMPLE DATA" tag.
- Demo and test orders are marked with a "Simulated" tag wherever they appear,
  and the list can filter them, so they are never mistaken for real customers.
- Show only the customer data a dispatcher needs: name, phone, address, and
  whether the phone has been confirmed.
- No live map tracking.
- All example names, phones and addresses are fictional and tagged
  "SAMPLE DATA". Use phone numbers like 0800 000 0001.

=== BUILD NOW (this release) ===

SCREEN 1: Staff sign in
Fields: phone number, password (show/hide). Subtitle "For MmiriOma staff".
States: default, submitting, "Phone number or password is incorrect",
"Too many attempts. Please wait and try again." with the wait time, network
error. A signed-in customer who opens an admin page sees "You do not have
access to this page".

SCREEN 1A: Session and access states
- "Forgot your password? Ask the technical lead to reset it." under the
  sign-in form (there is no self-service reset).
- Opening the app: brief loading state while the session is checked, never a
  flash of the sign-in screen.
- Session ended (signed out after 7 days, or the account was deactivated):
  sign-in screen with "Your session has ended. Please sign in again." After
  signing in, return to the page the dispatcher was on, with its filters.
- Security check failed: "Security token missing or invalid. Reload the page
  and try again." with a "Reload" button.
- Wrong kind of account: a customer or driver account sees "You do not have
  access to this page" with "Sign out".
- Signing out: spinner on "Sign out", then the sign-in screen with "You've
  signed out."

SCREEN 2: Layout
- Desktop: left sidebar with "Orders" (active) and greyed items for later
  sections: "Drivers", "Sources", "Payments", "Reports" (each marked "Coming
  later", not clickable). Top bar with signed-in staff name and "Sign out".
- Mobile: top bar with menu button opening the same navigation.

SCREEN 3: Order directory
- Page title "Orders" with the total count.
- Filter bar: status multi-select (Request received, Awaiting confirmation,
  Confirmed, Assigned - awaiting driver, Driver accepted, Water collected, On
  the way, Delivered, Cancelled, Delivery failed, Disputed), created-date range
  (from / to, Africa/Lagos dates), "Clear filters". Active filters are shown as
  removable chips.
- Desktop table columns: Reference, Status, Customer (name + "Phone confirmed"
  or "Phone not confirmed" text), Quantity (litres), Delivery address
  (truncated), Preferred date, Created (date and time), and a "Simulated" tag
  in the row when applicable. Newest first.
- Mobile: each order as a card with the same information stacked.
- Pagination: "Showing 1-50 of 128" with previous/next (50 per page).
- Clicking a row opens the order detail.
States: loading skeleton rows, empty with no orders ("No orders yet"), empty
because of filters ("No orders match these filters" + "Clear filters"), error
with Retry, and a populated table mixing real-looking and Simulated rows.

SCREEN 4: Order detail
- Header: reference, status badge, "Simulated" tag if applicable, created
  date/time.
- Sections:
  - Request: quantity in litres, preferred delivery date (or "No preference").
  - Delivery: receiver's name and phone, address, landmark, instructions.
  - Customer account: name, phone, phone confirmation state ("Not confirmed"
    with an explanation that it must be confirmed before the order can be).
  - Price: "No price yet - this is a quote request."
- No status history section in this release (see Screen 7).
- Back link to the directory that keeps the active filters.
States: loading, "Order not found", error with Retry.

=== DESIGN AHEAD (later releases; tag each screen "Design ahead - not in
current build") ===

SCREEN 5: Actions on order detail
- Action area with: "Send price" (enter or review a quote; amounts tagged
  SAMPLE DATA), "Confirm order" (disabled with the reason shown when the phone
  is not confirmed, no eligible water source, or no delivery window),
  "Assign driver", "Cancel order" (requires a reason; confirmation dialog).
- Assign driver dialog: list of eligible drivers with vehicle capacity in
  litres and availability; ineligible drivers shown disabled with the reason
  (over capacity, outside area, unavailable).
- Driver rejected or didn't respond: warning banner "Driver declined - assign
  another driver".

SCREEN 6: Confirm customer phone
- Small dialog recording that staff confirmed the phone by the agreed manual
  procedure: who confirmed, when, and a note. Wording must not suggest
  automated SMS verification.

SCREEN 7: Order history on order detail
- A "History" section added to the order detail: a list of status changes,
  newest first, each with the status, date and time (Africa/Lagos), who made
  the change (customer, staff member, driver, or system), and the reason when
  one was given (cancelled, failed, disputed, reassigned).
- Include assignment events: driver assigned, driver accepted, driver
  declined (with reason), reassigned.
- Empty state is not needed: every order has at least "Request received".

DELIVERABLE
All screens and states, desktop and mobile, annotated with which API data each
element shows. End with a list of components used and any new component or
token added to the design system.
```

## After generating

1. Check every screen and state exists and the honesty rules hold.
2. Record the result in `docs/design/admin-orders.md` using the
   [template](../_template.md), with the screen-to-endpoint table (`GET
   /admin/orders`, `GET /admin/orders/{reference}`, auth endpoints).
3. Order history (Screen 7) is deferred to the dispatch and delivery-tracking
   work, when the contract will return `order_events`. S1-09 does not build it,
   and the frontend must not invent the field.
