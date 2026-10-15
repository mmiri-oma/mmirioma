# Admin orders design

<!-- Recorded from the Claude Design canvas "MmiriOma Admin Orders",
version 1792077161-4805. Workflow: docs/process/ui-driven-development.md -->

Issue: S1-08 (#9) · Requirements: FR-001, FR-002, FR-003, FR-030, FR-032,
FR-033, BR-09, NFR-020, NFR-021, NFR-022 · Prompt:
[prompts/02-admin-orders.md](prompts/02-admin-orders.md)
Designer: @Daveoski · Reviewed by: (pending, technical lead) · Status: draft

This design covers the staff (dispatcher) screens for listing water requests
and reading one request. It is built from the approved
[design system](design-system.md) and reuses the approved
[authentication design](authentication.md) for every sign-in and session
screen. It sets what each screen shows and which actions it offers; business
rules stay in the SRS and the [orders contract](../api/orders.md).

## Design link

- Claude Design canvas: <https://claude.ai/artifact/Mc4aot56epgEJTcSywWz4A>,
  title "MmiriOma Admin Orders". Four artboards, each 1440 px wide:
  - **"Admin orders: layout, status labels, components (build now)"**
    (`Main.dc.html`): A1 layout at 1280, 768 and 360 px, the staff status
    labels and the component list.
  - **"A2 Order directory (build now)"** (`Directory.dc.html`).
  - **"A3 Order detail (build now)"** (`Detail.dc.html`).
  - **"A4-A6 Design ahead (not in current build)"** (`DesignAhead.dc.html`).
- Version recorded here: `1792077161-4805`.
- The canvas copies the design system's tokens and component styles exactly
  (colours, type, spacing, radii, shadows); it adds no tokens.
- The canvas is private until the designer shares it from its Share menu. The
  reviewer needs access before G2.
- Every frame has numbered notes saying which field or server response each
  element uses, and every frame with example people or numbers carries the
  Sample data tag. No screenshots are committed.

## Screens and states

Desktop frames are 1280 px (states are drawn as the content area, with the
shell as A2-a); phone frames are 360 px.

| Screen | States designed | Build now / design ahead |
| --- | --- | --- |
| Prompt screens 1 and 1A (staff sign in, session and access states) | Not redrawn: the approved [authentication design](authentication.md) (S1, X1 to X5) is canonical | Build now (S1-17) |
| A1 Layout | Desktop sidebar with "Orders" current and Drivers, Sources, Payments, Reports greyed "Coming later"; staff top bar with name and Sign out; tablet top bar with Menu; mobile Menu closed and open | Build now |
| Staff status labels | One badge per API status (11) | Build now |
| A2 Order directory | Populated with real and Simulated rows (A2-a); status panel open with filters applied and removable chips (A2-b); loading (A2-c); no orders yet (A2-d); no orders match these filters (A2-e); could not load, Retry (A2-f); date range the wrong way round (A2-g); mobile populated (A2-h); mobile status panel and chips (A2-i); mobile loading, no matches, could not load (A2-j) | Build now |
| A3 Order detail | Request received with phone not confirmed (A3-a); Simulated, receiver differs, optional fields empty (A3-b); loading (A3-c); order not found (A3-d); could not load, Retry (A3-e); mobile loaded (A3-f); mobile loading, not found, could not load (A3-g) | Build now |
| A4 Actions on order detail | Action area with "Confirm order" disabled and its reasons; Send price dialog (sample amounts); Assign driver dialog with eligible and ineligible drivers; Cancel order dialog with the reason error; driver declined or no response banner | Design ahead |
| A5 Confirm customer phone | Dialog recording a manual check: who, when, note | Design ahead |
| A6 Order history | History section, newest first, with status changes and assignment events | Design ahead (deferred to the dispatch work) |

### Behaviour shown on the screens

- **A1** From 1280 px: a 240 px sidebar and the staff top bar (name, Sign out).
  From 768 to 1279 px: the staff top bar plus a Menu button that opens the
  navigation. Below 768 px: one Menu button opens the navigation and then the
  account (name, full-width Sign out). Later sections are plain text, not
  links, with a "Coming later" label, so nothing clickable leads nowhere.
- **A2** Newest first, 50 per page, "Showing 1-50 of 128" with Previous and
  Next. The title shows the total for the current filters. Every filter
  change applies at once and returns to page 1. Filters live in the page
  address, so Back, reload and a shared link keep them.
  - Filter bar: "Status" multi-select (11 choices, count pill, panel up to
    264 px tall), "From" and "To" dates (Africa/Lagos, inclusive), "Show"
    (All orders / Real orders only / Simulated only). Active filters show as
    removable chips; "Clear filters" appears only when a filter is set.
  - Table columns: Reference (the row's link), Status, Customer (name,
    Simulated tag beside it, and "Phone confirmed" or "Phone not confirmed"
    with an icon), Quantity, Delivery address (truncated), Preferred date (or
    "No preference"), Created.
  - Phone numbers are not shown in the list, only on the detail page.
  - While a new page or filter loads, the old rows stay visible and dimmed.
  - A "From" date after "To" shows a field error and sends no request.
- **A3** Read only. "Back to orders" returns with the same filters and page.
  Cards: Request, Delivery, Customer account, Price (two columns on desktop,
  stacked on mobile). A Simulated order also shows the design system's
  demo-records warning. The reference has a "Copy" button.

### Exact text

Server messages (from [orders.md](../api/orders.md) and the
[API README](../api/README.md#errors)):

| Situation | Text | Source |
| --- | --- | --- |
| Order not found | "Order not found" (heading) | 404 `order_not_found` |
| Staff app opened by a customer or driver | "You do not have access to this page." (authentication design X4) | 403 `forbidden` |

Client copy from the prompt:

| Situation | Text |
| --- | --- |
| Directory empty | "No orders yet" |
| Directory filtered empty | "No orders match these filters" + "Clear filters" |
| Price card | "No price yet - this is a quote request." |
| Phone states | "Phone confirmed" / "Phone not confirmed" (list); "Confirmed" / "Not confirmed" (detail) |
| Later sections | "Coming later" |
| No preferred date | "No preference" |
| No connection | "Unable to reach the server. Check your connection and try again." |
| Driver declined (design ahead) | "Driver declined - assign another driver" |

Copy written by this design (needs approval with it):

- Status labels: see [Staff status labels](#staff-status-labels).
- "Show" options: "All orders", "Real orders only", "Simulated only".
- Chips: "Active filters:"; chip names use the status label or the formatted
  date ("From Fri 9 Oct 2026"); screen-reader label "Remove filter: …".
- "New requests appear here as soon as customers send them." (no orders yet)
- "Choose a date on or after the From date." (date range error)
- Failures: "We couldn't load orders"; "We couldn't load this order".
- A3: "A preference, not a booked delivery window."; "The phone must be
  confirmed before this order can be confirmed. Staff confirm it by the
  agreed manual check."; "No order has the reference MO-… Check it and try
  again."; "None given" for empty optional fields; "Created Wed 14 Oct 2026,
  10:30 am".
- A3-b: "Simulated order. This is a demo record for training. No water will
  be delivered and no money is taken." (from the design system's demo-records
  banner).
- Toast after Copy: "Reference copied".
- Card and field labels: "Request", "Delivery", "Customer account", "Price",
  "Quantity", "Preferred delivery date", "Receiver", "Receiver's phone",
  "Address", "Landmark", "Instructions", "Name", "Phone", "Phone
  confirmation".
- Screen-reader loading text: "Loading orders", "Loading order".

### Staff status labels

Settles design-system open question 1. Staff see the real status, including
`assigned` before acceptance, which customers see as "Confirmed" (FR-032).
Styles and icons reuse the design-system badge set.

| `status` | Staff badge | Style, icon | Customer sees |
| --- | --- | --- | --- |
| `quote_requested` | Request received | info, inbox | Request received |
| `awaiting_confirmation` | Awaiting confirmation | warning, clock | Awaiting confirmation |
| `confirmed` | Confirmed | brand, check | Confirmed |
| `assigned` | Assigned, awaiting driver | warning, user | Confirmed |
| `accepted` | Driver accepted | brand, user-check | Driver assigned |
| `collected` | Water collected | brand, droplet | Water collected |
| `en_route` | On the way | info, truck | On the way |
| `delivered` | Delivered | success, circle-check | Delivered |
| `cancelled` | Cancelled | off, ban | Cancelled |
| `failed` | Delivery failed | danger, circle-x | Delivery failed |
| `disputed` | Disputed | under review (dashed), search | Under review |

## Screen-to-endpoint table

Build-now endpoints are in [orders.md](../api/orders.md) and
[auth.md](../api/auth.md). Design-ahead screens have no endpoint yet.

| Screen | Element / action | Endpoint | Fields used |
| --- | --- | --- | --- |
| A1 | Staff name, Sign out; wrong-app and session states | `GET /auth/me`, `POST /auth/logout` | As in the authentication design (S1, X1 to X5); `user.name`, `user.role` |
| A2 | Order list, count, pagination | `GET /admin/orders?limit=50&offset=N` | Page `items`, `total`, `limit`, `offset`; per item `reference`, `status`, `customer.name`, `customer.phone_verified`, `quantity_litres`, `delivery_address`, `preferred_delivery_date`, `created_at`, `is_simulated` |
| A2 | Status filter | `GET /admin/orders?status=…` (repeated) | `status` |
| A2 | Date range | `GET /admin/orders?created_from=…&created_to=…` | `created_from`, `created_to` (Lagos dates, inclusive) |
| A2 | "Show": real or simulated only | **Needs contract change** (S1-16, #20): proposed query `is_simulated=true|false` on `GET /admin/orders` | `is_simulated` |
| A2 | Could not load | Any failure of `GET /admin/orders` | Network error, 500 `internal_server_error`, 503 `service_unavailable` |
| A3 | Order detail | `GET /admin/orders/{reference}` | Every `AdminOrderRead` field: `reference`, `status`, `is_simulated`, `created_at`, `quantity_litres`, `preferred_delivery_date`, `contact_name`, `contact_phone`, `delivery_address`, `landmark`, `delivery_instructions`, `customer.name`, `customer.phone`, `customer.phone_verified` |
| A3 | Order not found | `GET /admin/orders/{reference}` | 404 `order_not_found` |
| A4 | Send price | None yet: needs contract change (quotes, SRS §6 `POST /quotes`; staff send) | Proposed: quote lines and total in kobo, water category, `valid_until` |
| A4 | Confirm order and its disabled reasons | None yet: needs contract change (`POST /admin/orders/{id}/confirm`, SRS §6) | Proposed: confirm action and a list of blocking reasons (phone, source, window) from the server |
| A4 | Assign driver, eligible drivers | None yet: needs contract change (S1-06 assignment contract; `POST /admin/orders/{id}/assign`) | Proposed: drivers with vehicle, capacity in litres, availability, eligibility reason |
| A4 | Cancel order | None yet: needs contract change (cancel transition with reason) | Proposed: `reason` |
| A4 | Driver declined or no response | None yet: needs contract change (assignment status, decline reason, time) | Proposed: assignment `status`, `rejected_at`, reason |
| A5 | Confirm customer phone | None yet: needs contract change (manual verification record, FR-003) | Proposed: `confirmed_by`, `confirmed_at` (server), `note` |
| A6 | History | None yet: needs contract change (`order_events`, SRS §5) | Proposed: event type, from/to status, actor kind and name, time, reason |

Every build-now row uses an endpoint and field that exist in the contracts,
except the "Show" filter, which needs one optional query parameter (additive,
not breaking). Until it is agreed, the build hides the "Show" filter; the
Simulated tag on each row still meets BR-09.

## Decisions

1. **Sign-in and session screens are not redrawn.** The prompt says the
   approved authentication design is canonical. This slice reuses its staff
   sign in (S1), checking session (X1), session ended with return to the same
   page and filters (X2), security check (X3), wrong app (X4) and staff top bar
   with sign out (X5) unchanged.
2. **One staff navigation rule** (settles design-system open question 2):
   sidebar from 1280 px; staff top bar plus a Menu for the navigation from 768
   to 1279 px; one Menu for navigation and account below 768 px. It keeps the
   authentication design's Decision 5 (Menu below 768 px). The design system's
   "moves to the bottom navigation" note does not apply to staff.
3. **Staff status labels** (settles design-system open question 1), as in the
   table above. "Assigned, awaiting driver" uses the warning style because the
   dispatcher may need to chase or reassign. The prompt wrote "Assigned -
   awaiting driver"; a comma reads better than a spaced hyphen.
4. **No phone numbers in the list.** The list shows only whether the phone is
   confirmed; the number is on the detail page, where staff act on it (PRD §4
   minimum data).
5. **The reference is the row's link.** Keyboard users tab once per row; a
   click anywhere on the row also opens the detail.
6. **Filters apply at once** (no Apply button) and are kept in the page
   address; removable chips show what is active.
7. **The top bar does not repeat the logo on desktop**, because the sidebar
   shows the brand. Mobile and tablet bars show the brand mark until the logo
   file is exported (authentication design, open question 3).
8. **Simulated detail banner.** Besides the tag, a simulated order's detail
   page shows the design system's demo-records warning, so it is never handled
   as a real delivery.
9. **Design-ahead "Cancel order" button** is secondary with danger colours on
   the detail page; the destructive fill is used only for the confirming
   button in the dialog.

## Notes for S1-09 (build)

The directory built in PR #15 (now on `main`) must change to match:

- Status labels: use the table above ("Request received", "On the way",
  "Delivery failed", "Assigned, awaiting driver", "Driver accepted").
- Status filter: the "Status" multi-select panel with a count pill, plus
  removable chips, instead of toggle buttons.
- 50 orders per page (now 10); title shows the total.
- Customer column: account name and "Phone confirmed / Phone not confirmed";
  "No preference" for an empty preferred date.
- Detail: four cards (Request, Delivery, Customer account, Price); no
  lifecycle progress view (history is A6, deferred); "No price yet - this is a
  quote request."; simulated warning banner.
- Layout: "Coming later" nav items, staff top bar, Menu below 1280 px.
- "Find by reference" (built in PR #15) is not in the prompt or this design.
  Keep it only if the technical lead adds it here at approval.
- The "Show" filter waits for the contract change.

## Open questions

1. **Simulated filter contract.** Add `is_simulated` (optional boolean) to
   `GET /admin/orders` in S1-16 (#20)?
2. **Design ahead.** The blocking reasons for "Confirm order", driver
   eligibility reasons and decline reasons need wording from the server
   contracts; the canvas wording is a proposal. Water category names wait for
   PRD §13.2.
3. **Logo files.** As in the authentication design: the logo is not in the
   repository yet.

## Changes to the design system

No new tokens. Added, all built from existing tokens and component styles
(also listed on the canvas):

- **Staff status labels**: "Assigned, awaiting driver", "Driver accepted",
  "Disputed" (existing badge styles).
- **Coming later nav item**: greyed, not a link, small "Coming later" label.
- **Removable filter chip**: `primary-50` pill with the filter name and an x
  icon, inside a 48 px tap area.
- **"Show" filter**: native select with three options.
- **Phone confirmation line**: icon plus "Phone confirmed" or "Phone not
  confirmed".
- Design ahead only: action area with a reason list, driver choice row with a
  disabled reason, history list.

To be added to [design-system.md](design-system.md) when this design is
approved.
