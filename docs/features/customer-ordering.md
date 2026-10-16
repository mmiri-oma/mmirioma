# Customer ordering

Requirements: FR-001, FR-003 (banner), FR-020, FR-021, FR-026, FR-027, FR-032 (wording),
FR-033 (status meanings), BR-09, NFR-012, NFR-020, NFR-021, NFR-022 ·
Issue: S1-05 (#6) · Design: [customer-ordering.md](../design/customer-ordering.md) (approved, G2) ·
Contract: [orders.md](../api/orders.md) (agreed, G3) · Acceptance tests: T-06 and T-07 behaviour in the UI (frontend tests); the server side is S1-03

## 1. Overview and purpose

The signed-in customer's screens for asking for water and following their
orders:

- **O1 My orders** (`/`): the customer's own orders, newest first, 20 at a
  time. It is the customer home.
- **O2 Request water** (`/request`): one form for quantity, receiver, address,
  optional landmark, instructions and preferred date. Sending creates a
  **request**, not a confirmed delivery: Sprint 1 orders have no price
  (FR-021, FR-022).
- **O3 Request received** (`/request/received`): the reference and a summary
  of what was sent. It never says "confirmed" (FR-027).
- **O4 Order detail** (`/orders/:reference`): every field, the status in the
  customer's words, and contact guidance instead of cancel or edit.

The screens read the **real API** (`POST /orders`, `GET /orders`,
`GET /orders/{reference}`, built in S1-03 part 2) by default. With
`VITE_ORDERS_SOURCE=mock` they read simulated orders instead, with a
"Sample data" notice on every screen (BR-09). `main.tsx` provides the chosen
source through `CustomerOrdersSourceContext` (S1-10). Sign-in and session
screens come from the [authentication feature](authentication.md).

## 2. Feature workflow

```
/ (My orders) --Request water--> /request
  form opens: unsent draft for this account, or a new form
    (receiver prefilled from the account, new idempotency key)
  every change is saved to the in-memory draft
  Send request
    client checks fail  -> error summary (focused), field errors, nothing sent
    sending             -> fields locked, "Sending request", extra taps ignored
    201/200             -> clear draft; replace /request with /request/received
    409 key reused      -> clear draft; / with "We already received this request…"
    422                 -> errors under the matching fields, summary (focused)
    403 csrf_failed     -> "Your request was not sent" + server text + Reload
    401                 -> session re-check -> /sign-in with X2 + "What you typed is kept"
                           -> after sign-in back to /request, form filled, same key
    network/5xx         -> "Your request was not sent" + Retry (same key); values kept
/request/received --View my orders--> /     --Request more water--> new empty form
/ --card--> /orders/:reference
```

Browser Back from Request received goes to the page before the form (normally
My orders), because the form's history entry is replaced.

## 3. Important files

| File | Responsibility |
| --- | --- |
| `frontend/src/lib/api/orders.ts` | `OrderRead`, `OrderCreate`, `createOrder`, `listOrders`, `getOrder` mirroring `docs/api/orders.md` |
| `frontend/src/features/customer-orders/source.ts` | `CustomerOrdersSource` interface and context, `apiCustomerOrdersSource`, and the app's chosen `customerOrdersSource` |
| `frontend/src/lib/ordersData.ts` | `VITE_ORDERS_SOURCE` resolution (`api` by default, `mock` in tests) |
| `frontend/src/features/customer-orders/mockCustomerOrders.ts` | In-memory mock source: paging, 404, idempotent create, `?mock=` review scenarios |
| `frontend/src/features/customer-orders/useCustomerOrders.ts` | TanStack Query hooks: infinite list (20 per page) and detail; keys include the account id |
| `frontend/src/features/customer-orders/requestForm.ts` | Form values, Zod checks with the approved messages, preset quantities, `toOrderCreate`, 422 `loc` mapping, idempotency key |
| `frontend/src/features/customer-orders/requestDraft.ts` | In-memory draft store (Decision 10) and its sign-out clearing |
| `frontend/src/features/customer-orders/customerStatus.ts` | Customer badge label, explanation, tone and icon per status |
| `frontend/src/features/customer-orders/messages.ts` | Approved texts and "What happens next" steps |
| `frontend/src/features/customer-orders/pages/` | `MyOrdersPage` (O1), `RequestWaterPage` (O2), `RequestReceivedPage` (O3), `OrderDetailPage` (O4), `CustomerSignInPage` (C3 with the X2 draft line) |
| `frontend/src/features/customer-orders/components/` | Layout with desktop links and sample-data notice, order card, quantity tiles, error summary, summary list, status badge, back link |
| `frontend/src/components/ui/TextAreaField.tsx` | Design-system multi-line field (address, instructions) |
| `frontend/src/components/ui/Field.tsx` | Gains `optional` for the "(optional)" label suffix |
| `frontend/src/features/auth/components/CustomerHeader.tsx` | Gains an optional `nav` slot (desktop "My orders" / "Request water" links) |
| `frontend/src/features/auth/pages/HomePages.tsx` | `CustomerAccountNotices`: C2 one-time notice and X6 banner, shown on My orders |
| `frontend/src/features/auth/pages/SignInPage.tsx` | Gains `sessionEndedDetail`, the second line of the X2 banner |
| `frontend/src/App.tsx` | Customer routes behind `AppGate app="customer"`; renders `RequestDraftSignOutSync` |

## 4. Database models and relationships

None. The frontend stores nothing on the device. The unsent request is held
in app memory only (never `localStorage`, `sessionStorage` or cookies), because
it contains a phone number and an address. Data shapes follow `OrderRead` and
`OrderCreate` in `docs/api/orders.md`.

## 5. API endpoints and request/response behavior

Not called yet; the mock source answers instead. The source matches these
agreed endpoints, and `lib/api/orders.ts` already calls them:

| Screen | Endpoint | Used |
| --- | --- | --- |
| O1 | `GET /api/v1/orders?limit=20&offset=N` | `items`, `total`; per item `reference`, `status`, `quantity_litres`, `delivery_address`, `preferred_delivery_date`, `created_at` |
| O2 | `POST /api/v1/orders` | Body `idempotency_key`, `quantity_litres`, `contact_name`, `contact_phone`, `delivery_address` and, only when given, `landmark`, `delivery_instructions`, `preferred_delivery_date`. 201 or 200 `OrderRead` |
| O3 | none | The `POST /orders` response, passed in router state |
| O4 | `GET /api/v1/orders/{reference}` | Every `OrderRead` field, including `updated_at` |
| O1, O2 | `GET /api/v1/auth/me` | `user.name`, `user.phone` (prefill), `user.phone_verified` (X6) |

The request body never contains a price, status, customer or simulated field.

## 6. Important business rules

- **No price anywhere (FR-021, FR-022).** The form says "We'll send you the
  total price before anything is confirmed. You don't pay anything now."
  Quantity tiles show litres only.
- **Preset quantities** 25, 50, 100, 200, 300 and 500 litres are sample values
  pending business approval (design open question 1). "Other amount" accepts
  whole litres from 1 to 100,000 (the contract's bounds). Every quantity is a
  manual quote request in Sprint 1.
- **Field rules** repeat the contract: receiver name 1-100 characters, a
  Nigerian mobile number, address 5-500, landmark up to 200, instructions up
  to 500, preferred date today or later in Africa/Lagos. The preferred date is
  "a preference, not a booked time" (FR-025 slots come later).
- **One idempotency key per form (Decision 9; FR-026, T-06).** Made when a new
  form opens and kept, even after edits following a failed send, until the
  server answers definitely. A 409 `idempotency_key_reused` means an earlier
  send from this form was stored: the app opens My orders with "We already
  received this request. It is at the top of your list." and never sends again
  with a new key. Only a new, empty form gets a new key.
- **Request received, never confirmed (FR-027).** O3 says "It is not a
  confirmed delivery yet: we'll send you a price first."
- **Status wording** follows the contract's "Customer sees it as" column.
  `assigned` shows as "Confirmed" so the customer is not told of an assignment
  the driver has not accepted (FR-032). "On the way" makes no tracking or ETA
  claim.
- **No cancel or edit** (orders contract open question 1): O4 says "To change
  or cancel this request, contact us and quote the reference."
- **Simulated data (BR-09):** while the mock source is in use, every screen
  says the orders are simulated and no water will be delivered.

## 7. Authentication and authorization requirements

Every ordering route is behind `AppGate app="customer"`: signed-out visitors
go to `/sign-in` (and come back after signing in), staff and drivers see the
wrong-app screen (X4). The server enforces ownership (FR-001): another
customer's reference returns 404 `order_not_found`, which O4 shows exactly
like an unknown reference (T-07). Query cache keys include the account id, so
a different account on the same phone never sees cached orders. Choosing to
sign out clears the unsent draft; a session that merely ended keeps it, and
only the same account can reopen it.

## 8. Error handling and edge cases

| Situation | Behaviour |
| --- | --- |
| Client checks fail | "Check N things before sending" summary with links, focused; red fields with messages; values kept; nothing sent |
| No quantity chosen | Tiles get red borders and "Choose how much water you need." |
| Double tap or Enter twice on Send | One request only (in-flight guard plus the button's loading state, NFR-022) |
| Network failure or 5xx on send | "Your request was not sent", connection text, "Everything you typed is kept.", Retry (same key) |
| 422 `validation_error` | Approved message under each field named in `details[].loc`; unknown fields fall back to the banner with the server message |
| 409 `idempotency_key_reused` | My orders with the info banner; draft cleared |
| 403 `csrf_failed` | X3 banner "Security token missing or invalid. Reload the page and try again." with Reload. Reload loses the draft (accepted, Decision 10) |
| 401 `not_authenticated` | Sign-in with "Your session has ended…" and "Your request has not been sent. What you typed is kept."; after sign-in the form reopens filled |
| My orders cannot load | "We couldn't load your orders" with Retry; "Request water" still works |
| Load more fails | Orders already shown stay; "We couldn't load more orders" with Retry for the same page |
| Order not found / another customer's | "Order not found", "Check the reference, or find the order in your list.", "Go to my orders" (not retried) |
| Order cannot load | "We couldn't load this order" with Retry |
| `/request/received` opened without an order (reload) | Redirects to My orders, where the request is listed |
| Copy blocked by the phone | Nothing changes; the reference stays selectable |
| `crypto.randomUUID` missing (plain HTTP on a phone) | Key built from `crypto.getRandomValues` in the same UUID v4 format |

## 9. Testing instructions

```bash
cd frontend
npm run lint && npm run typecheck && npm test && npm run build
```

- `customer-orders/customerOrders.test.tsx` (jsdom, real routes, guards and
  session provider; auth API mocked): paging by 20 and Load more; assigned
  shown as Confirmed; card fields with no price; empty state and X6; list
  error and Retry; load-more failure; sample-data notice only for mock data;
  receiver prefill; client errors with focused summary; quantity required;
  double submit sends once and opens O3 with focus on the heading; locked
  form while sending; network failure and Retry with the same key; same key
  after an edit; 409; 422 per field; 403 with Reload; session ended while
  typing (X2 line, form restored, same key); sign-out clears the draft; new
  form after a sent request gets a new key; O3 without state; O4 fields and
  "None given"; not found (T-07); O4 error and Retry; card opens O4; signed-out
  visitor sent to sign-in.
- `customer-orders/requestForm.test.ts`: every field rule and message, Lagos
  "today", prefill, request body (trimmed, optional fields left out, no price),
  422 `loc` mapping, idempotency key with and without `randomUUID`.
- `customer-orders/mockCustomerOrders.test.ts`: idempotent create (200 and
  409), paging, 404, fictional data.
- `lib/api/orders.test.ts`: paths, methods, query, CSRF header, encoding,
  abort signal, error envelope.

Manual review against the design: `npm run dev`, sign in as a customer, and
add `?mock=empty`, `?mock=error`, `?mock=slow` or `?mock=offline` to the URL
for the empty list, a list that cannot load, slow responses, or a request that
cannot be sent.

### Choosing the data

| `VITE_ORDERS_SOURCE` | Data |
| --- | --- |
| `api` | The real backend |
| `mock` | Simulated orders (sample-data notice shown), for design review without a backend |
| unset | `api` (in the test suite: `mock`, so tests never call a server) |

The setting is resolved once in `frontend/src/lib/ordersData.ts` and applies to
both the customer and the staff order screens.

Checked end to end against the real endpoints in S1-10 (#11): a customer signs
in, sends a request, sees Request received and the new order at the top of My
orders on its first render; staff then see it in the directory and detail.

## 10. Known limitations

- **Mock mode** (`VITE_ORDERS_SOURCE=mock`) keeps requests in memory; they
  vanish on reload. The default reads the real API.
- **The draft is lost on page reload**, including "Reload" after a security
  check failure (accepted in Decision 10).
- **The draft outlives leaving the form.** It is cleared only when the request
  is sent, found to exist already (409), or the person signs out. Coming back
  to Request water reopens it with the same key.
- **Preset quantities are sample values** until the business approves pilot
  defaults.
- **"Contact us"** on O4 is text only: the real support number is an open
  question (auth open question 1).
- **Design-ahead screens** (Q1 price quote, Q2 delivery window, Q3 progress
  timeline) are not built; they need contract work first.
- **Not checked in a real browser.** The screens were verified with jsdom
  tests only; a visual pass at 360, 768 and 1280 px is still needed.
- **Bundle size.** The production build's main chunk is now about 522 kB
  (160 kB gzipped), over Vite's 500 kB warning. Route-level code splitting is
  a separate change (see `LOG.md`).
