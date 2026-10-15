# Customer ordering design

<!-- Recorded from the Claude Design canvas "MmiriOma Customer Ordering",
version 1792057730-d1a0. Workflow: docs/process/ui-driven-development.md -->

Issue: S1-04 (#5) · Requirements: FR-001, FR-003, FR-020, FR-021, FR-023,
FR-026, FR-027, FR-037 (design ahead), NFR-012, NFR-020, NFR-021, NFR-022 ·
Prompt: [prompts/01-customer-ordering.md](prompts/01-customer-ordering.md)
Designer: @Cloudcrackamara · Reviewed by: pending (@nnamdi-security) ·
Status: draft

This design covers the customer screens for sending a water request and
following orders. It is built from the approved [design system](design-system.md)
and reuses the approved [authentication design](authentication.md) for every
sign-in and session screen. It sets what each screen shows and which actions
it offers; business rules stay in the SRS and the
[orders contract](../api/orders.md).

## Design link

- Claude Design canvas: <https://claude.ai/artifact/NtrG5m8XDsNHH1rj7KSPus>,
  title "MmiriOma Customer Ordering".
  - Artboard **"Customer ordering (build now)"** (`Main.dc.html`, 1440 px
    page): O1 to O4, the status wording table and the component list.
  - Artboard **"Customer ordering (design ahead)"** (`DesignAhead.dc.html`,
    1440 px page): Q1 to Q3.
- Version recorded here: `1792057730-d1a0`.
- The canvas is a separate project from the design system canvas, because the
  design system canvas is not editable from the designer's account. It copies
  the design system's tokens and component styles exactly; it adds no colours,
  sizes or fonts.
- The canvas is private until the designer shares it from its Share menu. The
  reviewer needs access before G2.
- Every frame has numbered notes saying which field or server response each
  element uses. No screenshots are committed.

## Screens and states

Phone frames are 360 px; every screen also has a 1280 px desktop frame.

| Screen | States designed | Build now / design ahead |
| --- | --- | --- |
| Prompt screens 1-3A (welcome, create account, sign in, session states) | Not redrawn: the approved [authentication design](authentication.md) (C1-C3, X1-X6) is canonical | Build now (S1-17) |
| O1 Home / My orders | Loading skeleton; empty with the X6 unconfirmed-phone banner; could not load (Retry); list with several statuses and "Load more"; loading more; load-more failed; desktop list | Build now |
| O2 Request water | Default with receiver prefilled; filled with "Other amount"; field errors with error summary; sending (form locked, no double submit); not sent, no connection (Retry, values kept); security check failed (X3 banner); desktop filled | Build now |
| O3 Request received | Default; reference copied (toast), optional fields absent; desktop | Build now |
| O4 Order detail | Loaded (request received); loaded with optional fields empty ("None given"); loading skeleton; order not found; could not load (Retry); desktop | Build now |
| Status wording | Badge and one explanation sentence for each of the 11 API statuses | Build now (only `quote_requested` occurs in Sprint 1) |
| Q1 Price quote | Default; expired; desktop | Design ahead |
| Q2 Choose delivery window | Default with full windows; window just taken | Design ahead |
| Q3 Order progress timeline | On the way; delivered (quantity delivered); cancelled with reason; delivery failed with reason and "Contact us"; under review | Design ahead |

### Behaviour shown on the screens

- **O1** lists the customer's own orders, newest first, 20 per page. Each card
  is one link to O4. "Load more" disappears when every order is shown. The
  "Request water" button stays usable while the list is loading or has failed.
- **O2** is one page in four sections ("How much water?", "Where should we
  deliver?", "When?", "Price") with the "Send request" button in a bar stuck
  to the bottom of the phone screen.
  - The receiver's name and phone are prefilled from the signed-in account and
    can be changed (someone else may receive the water).
  - On a failed "Send request", an error summary at the top links to each bad
    field and takes focus. Nothing is sent.
  - While sending: spinner, label "Sending request", every field locked with
    its value visible, extra taps ignored (NFR-022).
  - No connection: "Your request was not sent" with Retry. Every value is kept
    (NFR-012). Retry resends the same body with the same idempotency key
    (FR-026, T-06).
  - Session ended while the form is open: auth screen X2 with "Your request
    has not been sent. What you typed is kept."
- **O3** never says "confirmed". It says "Request received" and "It is not a
  confirmed delivery yet: we'll send you a price first" (FR-027). Focus moves
  to the heading. Browser Back returns to My orders, not to a filled form.
- **O4** has no cancel or edit button (see open questions). It shows "To
  change or cancel this request, contact us and quote the reference."

### Exact text

Server messages (from [orders.md](../api/orders.md) and
[auth.md](../api/auth.md)):

| Situation | Text | Source |
| --- | --- | --- |
| Order not found, or another customer's order | "Order not found" (screen title) | 404 `order_not_found` |
| Security check failed on Send request | "Security token missing or invalid. Reload the page and try again." | 403 `csrf_failed` |
| Server rejects a field | Shown under the matching field, as in O2-c | 422 `validation_error`, `details[].loc` |

Client copy from the prompt:

| Situation | Text |
| --- | --- |
| Preferred date helper | "This is a preference, not a booked time. We'll confirm the delivery window with you." |
| Price box | "We'll send you the total price before anything is confirmed. You don't pay anything now." |
| Empty list | "You have no orders yet" |
| What happens next | "1. We review your request and send you a price. 2. You accept the price. 3. We confirm a delivery window. 4. A driver delivers and unloads the water for you." |
| Quote expired (Q1) | "This price has expired. Request a new price." |
| Window taken (Q2) | "That window was just taken. Please choose another." |
| Phone format | "Enter a Nigerian mobile number, for example 08000000001" (same as the auth design) |
| No connection | "Unable to reach the server. Check your connection and try again." |

Copy written by this design (needs approval with it):

- Field errors: "Choose how much water you need."; "Enter a whole number of
  litres from 1 to 100,000."; "Enter the receiver's name."; "Enter the full
  delivery address (at least 5 characters)."; "Use 200 characters or fewer."
  (landmark); "Use 500 characters or fewer." (instructions); "Choose today or a
  later date."
- Error summary title: "Check N things before sending".
- Helpers: "The person who will receive the water." (name); "The driver may
  call this number." (phone); "House number, street and area." (address).
- O2 intro: "Tell us what you need. We'll reply with a price."
- Failures: "Your request was not sent" (+ "Everything you typed is kept.");
  "We couldn't load your orders"; "We couldn't load more orders"; "We couldn't
  load this order".
- O1 empty: "Tell us how much water you need and where. We'll send you a
  price." O4 not found: "Check the reference, or find the order in your list."
- O3: "We've got your request. It is not a confirmed delivery yet: we'll send
  you a price first."; "Use this reference if you contact us."; "Copied" /
  "Reference copied".
- O1/O4 meta: "Sent Wed 14 Oct 2026, 10:30 am"; "Last updated …";
  "Preferred date: …"; "Showing 5 of 7 orders"; "None given".
- Loading labels: "Sending request", "Loading more"; screen-reader text
  "Loading your orders", "Loading order".
- Status explanations, one per status:

| `status` | Badge (contract "Customer sees it as") | Explanation (new copy) |
| --- | --- | --- |
| `quote_requested` | Request received | We're preparing your price. |
| `awaiting_confirmation` | Awaiting confirmation | You accepted the price. We're checking the details before we confirm a delivery window. |
| `confirmed` | Confirmed | Your delivery is confirmed. We're arranging a driver. |
| `assigned` | Confirmed | Same as `confirmed`: the driver has not accepted yet (FR-032). |
| `accepted` | Driver assigned | A driver has accepted your delivery. |
| `collected` | Water collected | The driver has collected your water. |
| `en_route` | On the way | The driver is on the way to your address. |
| `delivered` | Delivered | Your water was delivered. |
| `cancelled` | Cancelled | This order was cancelled. Contact us if you have questions. |
| `failed` | Delivery failed | We couldn't complete this delivery. Contact us. |
| `disputed` | Under review | We're looking into a problem with this delivery. |

## Screen-to-endpoint table

Build-now endpoints are in [orders.md](../api/orders.md) and
[auth.md](../api/auth.md). Design-ahead screens have no endpoint yet.

| Screen | Element / action | Endpoint | Fields used |
| --- | --- | --- | --- |
| O1 | Order list, "Load more" | `GET /orders?limit=20&offset=N` | Page `items`, `total`; per item `reference`, `status`, `quantity_litres`, `delivery_address`, `preferred_delivery_date`, `created_at` |
| O1 | Unconfirmed phone banner (X6) | `GET /auth/me` | `user.phone_verified` |
| O1, O2, O3, O4 | Account menu, sign out (X5) | `GET /auth/me`, `POST /auth/logout` | As in the auth design |
| O2 | Receiver prefill | `GET /auth/me` | `user.name`, `user.phone` |
| O2 | Send request | `POST /orders` | Request `idempotency_key`, `quantity_litres`, `contact_name`, `contact_phone`, `delivery_address`, `landmark`, `delivery_instructions`, `preferred_delivery_date`; 201 or 200 `OrderRead`; errors `validation_error`, `idempotency_key_reused`, `csrf_failed`, `not_authenticated` |
| O3 | Request received | Response of `POST /orders` (no extra call) | `reference`, `status`, `quantity_litres`, `delivery_address`, `landmark`, `preferred_delivery_date` |
| O4 | Order detail | `GET /orders/{reference}` | Every `OrderRead` field; error `order_not_found` |
| Q1 | Price quote, accept | None yet: needs contract change (quotes, SRS §6 `POST /quotes`; `quote` on the order) | Proposed: total in kobo, quantity, water category name and supported uses, delivery window, `valid_until`; error `quote_expired` |
| Q2 | Choose window | None yet: needs contract change (SRS §6 `GET /delivery-slots`, FR-025) | Proposed: slots by date with start, end and availability; a "slot full" error |
| Q3 | Progress timeline | None yet: needs contract change (customer view of `order_events`, quantity delivered, cancel/fail reason) | Proposed: status changes with times, latest announced window, delivered quantity, reason |

Every build-now row uses an endpoint and field that exist in the contracts.
`POST /orders` with `csrf_failed`, and the "could not load" and "not sent"
states for 500 `internal_server_error` and 503 `service_unavailable`, rely on
the shared codes in the
[API README](../api/README.md#conventions-apply-to-every-endpoint). The design-ahead rows need contract
work before they are built; no issue exists for them yet.

## Decisions

1. **Sign-in and session screens are not redrawn.** The prompt itself says the
   approved auth design is canonical. This slice reuses its top bar, account
   menu (X5), session-ended (X2), security-check (X3) and unconfirmed-phone
   (X6) parts unchanged.
2. **Badge plus sentence for `quote_requested`.** The contract's wording is
   "Request received, awaiting price"; the design system badge is "Request
   received". The screens show the badge "Request received" with the sentence
   "We're preparing your price.", which together say the same thing.
3. **20 orders per page.** Smaller pages load faster on slow data; the API
   allows 1-100 (default 50). This is a client parameter, not a contract
   change.
4. **Error summary on the request form.** The form is long on a phone, so a
   summary with links helps people find the fields to fix. It is a pattern
   built from the existing error alert.
5. **Sticky "Send request" bar on mobile only.** Keeps the one primary action
   in thumb reach on a long form; on desktop the button follows the form.
6. **Empty optional fields**: hidden on O3 (short confirmation), shown as
   "None given" on O4 (full record).
7. **Quantity tiles have no second line.** The design system tile has a sub
   line (used for prices on its canvas); this release has no prices, so build-now
   tiles show litres only.
8. **Separate canvas.** The design system canvas could not be edited from the
   designer's account, so this design lives on its own canvas with the same
   tokens copied in.

## Open questions

1. **Approval of new copy.** The field errors, helpers and status explanations
   listed under "Copy written by this design" are new. The reviewer approves
   or changes them at G2.
2. **Preset quantities** (25, 50, 100, 200, 300, 500 L) are sample values
   pending business approval (FR-021, PRD §13). The design is unchanged if the
   values change.
3. **New idempotency key after an edit.** After a failed send, Retry reuses the
   same key (FR-026). If the customer edits a field and sends again, reusing the
   key would return 409 `idempotency_key_reused`. Proposal for S1-05/S1-16: make
   a new key whenever the body changes after a failure. If a 409 still occurs,
   show "Your request was not sent" and start a new attempt.
4. **Customer cancel.** Orders contract open question 1. Until decided, O4 has
   no cancel button, only contact guidance.
5. **Contact details.** "Contact us" needs the real support number and
   WhatsApp (auth open question 1). Until then it is sample data.
6. **Keeping a typed request** across session end or reload (auth open
   question 2) applies to O2.
7. **Design ahead.** What "Not now" on a quote does to the order; whether
   customers see the staff's cancel or failure reason as written or as fixed
   wording; and the approved water category names and supported uses
   (PRD §13.2) before Q1 can be built.

## Changes to the design system

No new tokens. New components, all built from existing tokens and component
styles (also listed on the canvas):

- **Order card**: reference (mono), status badge, quantity, address (one
  truncated line), dates; the whole card is one link.
- **Reference box**: 2 px dashed `primary-200` border, `primary-50` fill,
  `radius-box`, mono 22/30 reference, ghost "Copy" button.
- **Summary list** (`dl`): label over value on mobile; 200 px label column on
  desktop.
- **Error summary**: error alert listing links to each invalid field.
- **Sticky submit bar** (mobile): white, top border, small upward shadow.
- **Numbered steps**: 28 px `primary-100` circles with `primary-900` numbers.
- **Status box**: badge, explanation sentence, "Last updated".
- **Customer desktop top bar**: brand, "My orders" and "Request water" links,
  account button.
- Design ahead only: total box, delivery window row with a "Full" state,
  vertical progress timeline, dashed placeholder chip, "Design ahead" tag.

[design-system.md](design-system.md) should list these once this design is
approved.
