# Admin orders design

<!-- Recorded from the built screens (PR #26), not a Claude Design canvas.
Workflow: docs/process/ui-driven-development.md -->

Issue: S1-08 (#9) · Requirements: FR-001, FR-002, FR-003, FR-030, FR-032,
FR-033, BR-09, NFR-020, NFR-021, NFR-022 · Prompt:
[prompts/02-admin-orders.md](prompts/02-admin-orders.md)
Designer: @Daveoski · Reviewed by: @nnamdi-security (pending) · Status: draft

This records the staff (dispatcher) order screens **as built** as the S1-08
design. It lists every prompt 02 screen with the states that exist, and marks
what is missing as a gap. Business rules stay in the SRS and the
[orders contract](../api/orders.md).

## Design link

- **Source:** the screens built in PR #26 (`frontend/src/features/admin-orders/`,
  `frontend/src/components/layout/AdminShell.tsx`), as on `main` at `46d1a8d`.
- **Why not a Claude Design canvas:** S1-08 blocks S1-16 (confirming the
  orders contract) before the 18 Oct demo, and the screens already exist.
  Designing first and then rebuilding would cost time we do not have
  (technical lead, issue #9 comment, 2026-10-15).
- **Screenshots:** `docs/design/assets/admin-orders/`, taken from a production
  build on mock data. Desktop at 1280 px wide, phone at 360 px. Every name,
  phone and address is fictional sample data, and every order is flagged
  Simulated.

  | File | Shows |
  | --- | --- |
  | [01-directory-desktop.png](assets/admin-orders/01-directory-desktop.png) | Directory, populated |
  | [02-directory-filtered-desktop.png](assets/admin-orders/02-directory-filtered-desktop.png) | Two statuses selected, "Clear filters" |
  | [03-directory-loading-desktop.png](assets/admin-orders/03-directory-loading-desktop.png) | Loading skeleton |
  | [04-directory-no-orders-desktop.png](assets/admin-orders/04-directory-no-orders-desktop.png) | "No orders yet" |
  | [05-directory-no-matches-desktop.png](assets/admin-orders/05-directory-no-matches-desktop.png) | "No orders match these filters" + "Clear filters" |
  | [06-directory-error-desktop.png](assets/admin-orders/06-directory-error-desktop.png) | Could not load, "Try again" |
  | [07-directory-invalid-dates-desktop.png](assets/admin-orders/07-directory-invalid-dates-desktop.png) | "Created from" after "Created to" |
  | [08-detail-desktop.png](assets/admin-orders/08-detail-desktop.png) | Order detail, phone not verified |
  | [09-detail-not-found-desktop.png](assets/admin-orders/09-detail-not-found-desktop.png) | "Order not found" |
  | [10-directory-mobile.png](assets/admin-orders/10-directory-mobile.png) | Directory on a phone |
  | [11-detail-mobile.png](assets/admin-orders/11-detail-mobile.png) | Order detail on a phone |

  The sidebar's API line in the screenshots reads "screenshot stand-in, not
  the real API": a local stand-in answered `GET /auth/me` with a sample staff
  session so the signed-in screens could render without a database.

- **Open any state in the running app:** sign in as staff at `/admin/sign-in`,
  then use these addresses (the order screens still read mock data):

  | State | Address |
  | --- | --- |
  | Populated | `/admin/orders` |
  | Filtered | `/admin/orders?status=quote_requested&status=awaiting_confirmation` |
  | Loading (slow) | `/admin/orders?mock=slow` |
  | No orders yet | `/admin/orders?mock=empty` |
  | No matches | `/admin/orders?status=failed&created_from=2026-10-14` |
  | Could not load | `/admin/orders?mock=error` |
  | Date range wrong way round | `/admin/orders?created_from=2026-10-14&created_to=2026-10-01` |
  | Page beyond the last | `/admin/orders?page=9` |
  | Order detail | `/admin/orders/MO-7KQ2M9XH4T` |
  | Order not found | `/admin/orders/MO-0000000000` |

  For the phone layout, use the browser's device toolbar at 360 px.

## Screens and states

One row per prompt 02 screen. **Gap** = in prompt 02 but not built (or built
differently); fixing a gap is S1-09 work after approval.

| Prompt 02 screen | States built | Gaps |
| --- | --- | --- |
| 1 Staff sign in | Covered by the approved [authentication design](authentication.md) (S1), built in S1-17 (#29) at `/admin/sign-in` | None |
| 1A Session and access states | Covered by the authentication design (X1 to X5), built in S1-17 | None |
| 2 Layout | Desktop (≥1280 px): sidebar with "Orders" (current), staff name and full-width "Sign out" at the foot. Below 1280 px: top bar with brand, an "Orders" link and an account button opening the name and "Sign out" | **Gap:** no greyed "Drivers", "Sources", "Payments", "Reports" items marked "Coming later". **Gap:** on desktop the name and "Sign out" are at the foot of the sidebar, not in a top bar. **Gap:** below desktop there is no menu button for navigation (see Open question 1) |
| 3 Order directory | Populated (01); filtered (02); loading skeleton (03); "No orders yet" (04); "No orders match these filters" + "Clear filters" (05); error with "Try again" (06); extra: date range error (07), page beyond the last ("Go to first page"), "Updating…" while a new page loads; mobile list (10) | See [Directory gaps](#directory-gaps) |
| 4 Order detail | Loaded (08, 11); loading skeleton; "Order not found" (09); error with "Try again"; "Back to orders" keeps the filters | See [Detail gaps](#detail-gaps) |
| 5 Actions (design ahead) | Not built, as intended | Design ahead |
| 6 Confirm customer phone (design ahead) | Not built, as intended | Design ahead |
| 7 Order history (design ahead) | Not built, as intended; deferred to the dispatch work | Design ahead |

### Directory gaps

| Prompt 02 asks for | Built | Gap |
| --- | --- | --- |
| Status multi-select | A row of 11 toggle buttons (`aria-pressed`, tick when selected) | **Gap:** not the design system's "Status" multi-select panel |
| Status labels (Request received, On the way, Delivery failed, Assigned - awaiting driver …) | Quote requested, En route, Failed, Assigned, not accepted … | **Gap:** labels differ from prompt 02 (see Open question 2) |
| Created-date range, Africa/Lagos dates | "Created from" / "Created to", inclusive Lagos dates | None |
| Removable filter chips | Selected toggles show a tick; no separate chips | **Gap** |
| "Clear filters" | Shown when any filter is set | None |
| "Simulated" tag on every demo order | Tag beside the reference on every row and card | None (design system puts it beside the customer name; minor) |
| Filter for Simulated orders | Not built | **Gap:** also needs a contract change (no `is_simulated` query parameter) |
| Title with the total count | "Orders" without a count | **Gap** |
| 50 per page, "Showing 1-50 of 128", previous/next | 10 per page, "Showing 1–10 of 22", Previous/Next | **Gap:** page size 10 |
| Columns: Reference, Status, Customer (name + phone confirmation), Quantity, Delivery address, Preferred date, Created, Simulated tag | Order (reference, Simulated tag, created time), Status, Quantity, Contact (`contact_name` + "Verified"/"Unverified"), Delivery address (only from 1280 px), Preferred date | **Gap:** shows the receiver's name, not the customer account name; "Verified" instead of "Phone confirmed"; created time sits under the reference, not in its own column. At 1280 px with the sidebar the table scrolls sideways and "Preferred date" is cut off (01) |
| Mobile cards with the same information | Cards with reference, receiver, quantity, status, Simulated tag, address, phone state, preferred date | **Gap:** no created date on the card |
| Error with Retry | Error with "Try again" | Minor wording gap |
| Newest first | Newest first | None |
| (Not in prompt) | "Find by reference" search box | Extra; see Open question 3 |
| (Not in prompt) | "Sample data" banner while mock data is used | Extra; disappears when the real API is connected |

### Detail gaps

| Prompt 02 asks for | Built | Gap |
| --- | --- | --- |
| Header: reference, status badge, Simulated tag, created date/time | All of these, plus a copy button and "Updated …" when different | None |
| Request section: quantity, preferred date or "No preference" | Inside a "Delivery" card: quantity tile and preferred date ("Not given", with "Customer preference, not a booked slot.") | **Gap:** no separate "Request" section; "Not given" instead of "No preference" |
| Delivery section: receiver's name and phone, address, landmark, instructions | Address, landmark, instructions in "Delivery"; receiver's name and phone appear in the Customer card **only when** they differ from the account | **Gap:** receiver not always shown in Delivery |
| Customer account: name, phone, confirmation state with explanation | "Customer" card: account name, phone (as `+2348000000001`), badge "Phone verified/unverified", note "The phone must be verified before this order can be confirmed." | **Gap:** wording "verified" instead of "confirmed"; phone not shown as `0800 000 0001` |
| Price: "No price yet - this is a quote request." | "No price yet. This is a quote request. A price is set once pricing rules are agreed." | Minor wording gap |
| No status history section | No history, but a "Lifecycle" card showing where the current status sits in the FR-033 progression (no times, no actors) | **Gap:** prompt says no status section in this release (see Open question 4) |
| "Order not found"; error with Retry | Both; error button says "Try again" | Minor wording gap |
| Back link that keeps the filters | "Back to orders" restores the directory filters | None |

### Honesty and data rules

- No prices anywhere; the Price card says there is no price yet (FR-021, FR-022).
- `assigned` is labelled "Assigned, not accepted", never as accepted (FR-032).
- Every demo order carries the Simulated tag; mock screens add a sample-data
  banner (BR-09).
- No live tracking: "En route" has no map or ETA.
- Phone state is a badge with icon and words, not colour alone (NFR-021);
  no "verified by SMS" wording (FR-003).
- Customer data: the list shows names, address and phone state only; phone
  numbers appear only on the detail page.

## Screen-to-endpoint table

All endpoints are in [orders.md](../api/orders.md) and
[auth.md](../api/auth.md). The order screens currently read a mock source with
the same shapes (`frontend/src/features/admin-orders/source.ts`).

| Screen | Element / action | Endpoint | Fields used |
| --- | --- | --- | --- |
| 1, 1A, 2 | Sign in, session check, staff name, sign out | `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` | As in the authentication design; `user.name`, `user.role` (`admin`) |
| 3 | Order list and pagination | `GET /admin/orders` with `limit`, `offset` | Page `items`, `total`, `limit`, `offset` |
| 3 | Status filter | `GET /admin/orders?status=…` (repeated) | `status` |
| 3 | Date range | `GET /admin/orders?created_from=…&created_to=…` | `created_from`, `created_to` (inclusive Lagos dates) |
| 3 | Each row or card | `GET /admin/orders` items | `id`, `reference`, `status`, `is_simulated`, `created_at`, `quantity_litres`, `contact_name`, `customer.phone_verified`, `delivery_address`, `landmark`, `preferred_delivery_date` |
| 3 | Could not load | Any failure of `GET /admin/orders` | Network error, 500 `internal_server_error`, 503 `service_unavailable` |
| 3 | Simulated filter (gap) | **Needs contract change:** no `is_simulated` query parameter yet | `is_simulated` |
| 4 | Order detail | `GET /admin/orders/{reference}` | `reference`, `status`, `is_simulated`, `created_at`, `updated_at`, `quantity_litres`, `preferred_delivery_date`, `contact_name`, `contact_phone`, `delivery_address`, `landmark`, `delivery_instructions`, `customer.name`, `customer.phone`, `customer.phone_verified` |
| 4 | Order not found | `GET /admin/orders/{reference}` | 404 `order_not_found` |
| 4 | Could not load | Any other failure | As above |

Every built element uses an endpoint and field that exist in the contracts.
Only the Simulated filter (a gap) would need a change.

## Decisions

1. **The built screens are the design** (technical lead, issue #9 comment,
   2026-10-15). Prompt 02 items that are not built are listed as gaps above;
   the technical lead decides at review which must be fixed in S1-09.
2. **Sign-in and session screens are not redrawn.** They come from the
   approved authentication design and were built in S1-17 (#29).
3. **Staff navigation below desktop: a top bar.** Built as a top bar with the
   brand, an "Orders" link and an account button (name, "Sign out"). It
   follows prompt 02 and the authentication design (top bar, not bottom
   navigation). It has no separate menu button because "Orders" is the only
   section. See Open question 1.
4. **Status toggles instead of a dropdown.** All 11 statuses are visible at
   once and each is one tap; the selected ones show a tick.
5. **Filters live in the page address**, so Back, reload and a shared link
   keep them, and "Back to orders" returns to the same view.
6. **The previous page stays visible, dimmed, while the next one loads**, so
   the table does not jump.
7. **Extra states not in prompt 02:** the date range check (no request is sent
   until it is fixed) and "This page has no orders" with "Go to first page".

## Open questions

1. **Staff navigation below desktop width.** The design system says bottom
   navigation; prompt 02 and the authentication design say a top bar with a
   menu. The build uses a top bar with an inline "Orders" link and an account
   button, no menu button. Technical lead to decide at review.
2. **Staff status labels.** Prompt 02 uses the customer wording plus three
   staff labels ("Assigned - awaiting driver", "Driver accepted", "Disputed").
   The build uses "Quote requested", "Awaiting confirmation", "Confirmed",
   "Assigned, not accepted", "Driver accepted", "Water collected", "En route",
   "Delivered", "Cancelled", "Failed", "Disputed". Which set is approved? This
   also answers design-system open question 1.
3. **"Find by reference".** Built but not in prompt 02. Keep it?
4. **"Lifecycle" card.** Prompt 02 says no status history section in this
   release. The card shows only where the current status sits, without times
   or actors. Keep it, or remove it until order history exists?
5. **Simulated filter.** Needs `is_simulated` on `GET /admin/orders` (S1-16,
   #20). Add it, or accept the Simulated tag alone for the demo?
6. **Page size.** Prompt 02 says 50 per page; the build uses 10. Change to
   50?

## Changes to the design system

No new tokens. The built screens use existing tokens and components (sidebar,
status badge, Simulated tag, table, list rows, pagination, empty state,
skeletons, alerts, card). Two patterns are new and would be added to
[design-system.md](design-system.md) if approved:

- **Status toggle button**: pill button, 48 px tall, icon and label, tick and
  `primary-50` fill when selected (`aria-pressed`).
- **Phone state line**: icon plus "Verified" or "Unverified" (wording subject
  to Open question 2's decision on "confirmed").
