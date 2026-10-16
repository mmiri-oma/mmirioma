# Admin order directory

Requirements: FR-030 (list/filter/inspect), FR-033 (status meanings), FR-027, FR-003, BR-09, NFR-020, NFR-021, NFR-022 ·
Issues: S1-08 (#9), S1-09 (#10) · Design: [admin-orders.md](../design/admin-orders.md) (approved) ·
Contract: [orders.md](../api/orders.md) (agreed) · Acceptance tests: none automated yet (T-xx cover backend behaviour)

## 1. Overview and purpose

The dispatcher's order queue. Staff see every order newest first, filter by
status and creation date, open an order by its reference, and read its details.
It is read-only. It reads the **real API** by default, or **mock data** when
`VITE_ORDERS_SOURCE=mock` (see section 5). It sits behind
the staff route guard (`AppGate app="staff"`, see
[authentication.md](authentication.md)).

## 2. Feature workflow

1. `/admin/orders` loads page 1 (50 orders) from the `AdminOrdersSource`. The
   title shows the total ("Orders · 22").
2. Status toggles, the "Created from/to" dates and the "Records" select (all,
   real only, simulated only) update the URL
   (`?status=…&created_from=…&created_to=…&is_simulated=…&page=…`). Changing a
   filter resets to page 1. Back, reload and shared links restore the same
   view.
3. The previous page stays visible, dimmed, while the next one loads.
4. A row or card opens `/admin/orders/:reference`. "Back to orders" returns to
   the same filters.
5. "Find by reference" accepts `mo-7kq2…`, `7KQ2 M9XH 4T` or the full
   reference, normalises it, and opens the detail page.

## 3. Important files

| File | Responsibility |
| --- | --- |
| `frontend/src/lib/api/adminOrders.ts` | Types mirroring `docs/api/orders.md` (`AdminOrderRead`, `Page`, list params), `listAdminOrders`, `getAdminOrder` and the list query builder |
| `frontend/src/features/admin-orders/source.ts` | `AdminOrdersSource` interface and React context (the integration seam) |
| `frontend/src/features/admin-orders/apiAdminOrdersSource.ts` | Source backed by the real API and the app's chosen admin source |
| `frontend/src/lib/ordersData.ts` | `VITE_ORDERS_SOURCE` resolution, shared with the customer screens |
| `frontend/src/features/admin-orders/mockAdminOrders.ts` | Simulated fixtures and the mock source that filters and pages like the API |
| `frontend/src/features/admin-orders/useOrderFilters.ts` | URL-backed filter state and date-range validation |
| `frontend/src/features/admin-orders/useAdminOrders.ts` | TanStack Query hooks for the list and detail |
| `frontend/src/features/admin-orders/AdminOrdersPage.tsx` | Directory page and its loading, empty and error states |
| `frontend/src/features/admin-orders/AdminOrderDetailPage.tsx` | Detail page: request, delivery (receiver), price notice, customer account |
| `frontend/src/features/admin-orders/PhoneState.tsx` | "Phone confirmed" / "Phone not confirmed" line and badge |
| `frontend/src/features/admin-orders/OrderList.tsx` | Fixed-layout table (≥ `tablet`, 768 px; fits 1280 px beside the sidebar) and list rows (phones), plus the skeleton |
| `frontend/src/features/admin-orders/OrderFilters.tsx`, `ReferenceSearch.tsx`, `Pagination.tsx` | Filter controls, reference lookup, paging |
| `frontend/src/features/admin-orders/orderStatus.ts` | Staff labels (admin design Decision 9), icons and tones per status |
| `frontend/src/lib/queryClient.ts` | Query client: one retry for network/5xx errors, none for 4xx |

The screens use the approved design system
([docs/design/design-system.md](../design/design-system.md)); shared components
are listed in [docs/design/ui-system.md](../design/ui-system.md).

## 4. Database models and relationships

None. The frontend has no storage. Data shapes follow `AdminOrderRead` in
`docs/api/orders.md`.

## 5. API endpoints

Called by the API source (`createApiAdminOrdersSource`) when it is selected:

| Method | Path | Roles | Request | Success | Errors (status + code) |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/orders` | admin | `status` (repeatable), `created_from`, `created_to`, `is_simulated`, `limit`, `offset` | 200 `Page<AdminOrderRead>` | 401 `not_authenticated`, 403 `forbidden`, 422 `validation_error` |
| GET | `/api/v1/admin/orders/{reference}` | admin | none | 200 `AdminOrderRead` | 404 `order_not_found`, 401, 403 |

`status` is repeated per value; unset filters are left out so the server
applies its defaults. The reference is URL-encoded in the detail path.

**Choosing the data** (`frontend/.env.local`):

| `VITE_ORDERS_SOURCE` | Data |
| --- | --- |
| `api` | The real backend |
| `mock` | Simulated orders (sample-data notice shown), for design review without a backend |
| unset | `api` (in the test suite: `mock`, so tests never call a server) |

The setting is resolved once in `frontend/src/lib/ordersData.ts` and applies to
both the customer and the staff order screens.

`App.tsx` provides the chosen source to the admin routes through
`<AdminOrdersSourceContext>`. Checked end to end against the real endpoints in
S1-10 (#11).

## 6. Business rules

- No price is shown. Sprint 1 orders are manual quote requests, so the detail page shows a "No price yet" notice instead of an amount (FR-021, FR-022).
- Staff status labels follow the admin design (Decision 9): "Request received", "Awaiting confirmation", "Confirmed", "Assigned - awaiting driver", "Driver accepted", "Water collected", "On the way", "Delivered", "Cancelled", "Delivery failed", "Disputed". `assigned` never reads as acceptance (FR-032).
- Simulated records carry a "Simulated" badge, and the "Records" filter can hide or isolate them (`is_simulated`, BR-09). While the mock source is active, a sample-data notice is shown on every screen.
- The list shows the **customer account** (`customer.name`); the detail page shows the account and the receiver separately, because someone else may receive the water.
- A phone staff have not confirmed is shown as "Phone not confirmed", with a note that it must be confirmed before the order can be (FR-003). "Confirmed", not "verified", so nothing suggests automated SMS checks.
- Phone numbers are shown as `0800 000 0001` (design-system formatting rules).
- The preferred date is labelled as a customer preference, not a booked slot (FR-025 slots do not exist yet).
- Times are shown in Africa/Lagos on a 12-hour clock (`Wed 14 Oct 2026, 10:30 am`); quantities as `200 litres` (design-system.md formatting rules). Date filters are inclusive Lagos calendar dates, as in the contract.
- No status history or lifecycle view (admin design Decision 11): it waits for the order history work.
- Zone filtering is not offered: orders have no service zone until FR-010.

## 7. Authentication and authorization

The admin routes are behind the staff route guard: signed-out visitors go to
`/admin/sign-in`, and other roles see "You do not have access to this page."
The server enforces the admin role on every endpoint (FR-001).

## 8. Error handling and edge cases

| Case | Behaviour |
| --- | --- |
| Loading | Skeleton rows and a screen-reader "Loading orders…" status |
| Network or 5xx error | Retried once, then an alert with the `ApiError` message and "Retry" |
| No orders at all | "No orders yet" |
| Filters match nothing | "No orders match these filters" and "Clear filters" |
| "Created from" after "Created to" | Inline alert. No request is made |
| `page` beyond the last page | "This page has no orders" and "Go to first page" |
| Malformed URL params | Ignored (unknown statuses, bad dates, non-numeric pages) |
| Unknown reference | 404 `order_not_found` shows "Order not found" (not retried) |
| Invalid typed reference | Inline hint. No navigation |
| Superseded requests | Aborted through the query signal |

## 9. Testing

```bash
cd frontend
npm test
```

- `mockAdminOrders.test.ts`: status, Lagos date, `is_simulated` and paging behaviour of the mock source; `order_not_found`; abort; reference normalisation.
- `apiAdminOrdersSource.test.ts`: list query building (repeated `status`, optional filters), URLs, credentials and abort signal, detail path encoding, `order_not_found` passed through, and the source setting (production defaults to the API).
- `AdminOrdersPage.test.tsx` (jsdom + Testing Library): loading, list and title count, column set with customer account, phone state and created time, staff labels, filters through the URL, Simulated filter, filter restore, empty states, invalid range (no request), error and retry, paging by 50, reference search.
- `AdminOrderDetailPage.test.tsx`: details in Lagos time with no price, phone not confirmed, separate request/delivery/customer cards with formatted phones, "No preference" and no lifecycle, not found, back link keeps filters.
- `lib/format.test.ts`: Lagos 12-hour time (including midnight and noon), calendar dates and litres.

## 10. Known limitations

- Not yet run against the real endpoints: they arrive with S1-03 part 2 (#4).
  The API source is tested with mocked responses; the end-to-end check is
  S1-10.
- The status filter is a row of toggles, not the design system's multi-select
  panel with chips (admin design fix 6, optional for Sprint 1).
- At the narrowest tablet widths (about 768-850 px) the table is tight:
  customer names and addresses are truncated (full text in the tooltip and
  on the detail page).
- Read-only: confirm, assign and cancel come with their APIs.
- No zone filter (FR-010) and no event history (NFR-004 events are not exposed yet).
- Mobile date inputs use the browser's native picker and locale format.
