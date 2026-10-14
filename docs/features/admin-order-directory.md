# Admin order directory

Requirements: FR-030 (list/filter/inspect), FR-033 (status meanings), FR-027, FR-003, BR-09, NFR-020, NFR-021, NFR-022 ·
Issues: S1-08 (#9), S1-09 (#10) · Acceptance tests: none automated yet (T-xx cover backend behaviour)

## 1. Overview and purpose

The dispatcher's order queue. Staff see every order newest first, filter by
status and creation date, open an order by its reference, and read its details.
It is read-only and runs on **mock data** until `GET /admin/orders` exists
(S1-03). The S1-10 integration replaces the data source.

## 2. Feature workflow

1. `/admin/orders` loads page 1 (10 orders) from the `AdminOrdersSource`.
2. Status chips (multi-select) and the "Created from/to" dates update the URL
   (`?status=…&created_from=…&created_to=…&page=…`). Changing a filter resets to
   page 1. Back, reload and shared links restore the same view.
3. The previous page stays visible, dimmed, while the next one loads.
4. A row or card opens `/admin/orders/:reference`. "Back to orders" returns to
   the same filters.
5. "Find by reference" accepts `mo-7kq2…`, `7KQ2 M9XH 4T` or the full
   reference, normalises it, and opens the detail page.

## 3. Important files

| File | Responsibility |
| --- | --- |
| `frontend/src/lib/api/adminOrders.ts` | Types mirroring `docs/api/orders.md` (`AdminOrderRead`, `Page`, list params) |
| `frontend/src/features/admin-orders/source.ts` | `AdminOrdersSource` interface and React context (the integration seam) |
| `frontend/src/features/admin-orders/mockAdminOrders.ts` | Simulated fixtures and the mock source that filters and pages like the API |
| `frontend/src/features/admin-orders/useOrderFilters.ts` | URL-backed filter state and date-range validation |
| `frontend/src/features/admin-orders/useAdminOrders.ts` | TanStack Query hooks for the list and detail |
| `frontend/src/features/admin-orders/AdminOrdersPage.tsx` | Directory page and its loading, empty and error states |
| `frontend/src/features/admin-orders/AdminOrderDetailPage.tsx` | Detail page: delivery, price notice, customer, lifecycle |
| `frontend/src/features/admin-orders/OrderList.tsx` | Table (≥ `md`) and cards (phones), plus the skeleton |
| `frontend/src/features/admin-orders/OrderFilters.tsx`, `ReferenceSearch.tsx`, `Pagination.tsx` | Filter controls, reference lookup, paging |
| `frontend/src/features/admin-orders/orderStatus.ts` | Staff labels, icons and tones per status; FR-033 progression |
| `frontend/src/lib/queryClient.ts` | Query client: one retry for network/5xx errors, none for 4xx |

Shared components are listed in [docs/design/ui-system.md](../design/ui-system.md).

## 4. Database models and relationships

None. The frontend has no storage. Data shapes follow `AdminOrderRead` in
`docs/api/orders.md`.

## 5. API endpoints

Not called yet. The source interface matches these proposed endpoints:

| Method | Path | Roles | Request | Success | Errors (status + code) |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/orders` | admin | `status` (repeatable), `created_from`, `created_to`, `limit`, `offset` | 200 `Page<AdminOrderRead>` | 401 `not_authenticated`, 403 `forbidden`, 422 `validation_error` |
| GET | `/api/v1/admin/orders/{reference}` | admin | none | 200 `AdminOrderRead` | 404 `order_not_found`, 401, 403 |

To connect the real API (S1-10), add endpoint functions in `src/lib/api/` that
call `apiClient`. Then provide an `AdminOrdersSource` with `isMock: false` through
`<AdminOrdersSourceContext value={...}>` above the admin routes. No page or
component changes are needed.

## 6. Business rules

- No price is shown. Sprint 1 orders are manual quote requests, so the detail page shows a "No price yet" notice instead of an amount (FR-021, FR-022).
- `assigned` is labelled "Assigned, not accepted" so it cannot be read as acceptance (FR-032).
- Simulated records carry a "Simulated" badge. While the mock source is active, a sample-data notice is shown on every screen (BR-09).
- An unverified phone is flagged, with a note that it must be verified before confirmation (FR-003).
- The preferred date is labelled as a customer preference, not a booked slot (FR-025 slots do not exist yet).
- Times are shown in Africa/Lagos. Date filters are inclusive Lagos calendar dates, as in the contract.
- The lifecycle view is derived from the current status only. It shows no times, because there is no event history endpoint yet.
- Zone filtering is not offered: orders have no service zone until FR-010.

## 7. Authentication and authorization

Not enforced in the UI yet. The routes are open in the frontend, and the mock
data contains no real customer data. Access control is the server's job (FR-001).
When S1-02 auth lands, the admin routes must be guarded for the admin role.

## 8. Error handling and edge cases

| Case | Behaviour |
| --- | --- |
| Loading | Skeleton rows and a screen-reader "Loading orders…" status |
| Network or 5xx error | Retried once, then an alert with the `ApiError` message and "Try again" |
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

- `mockAdminOrders.test.ts`: status, Lagos date and paging behaviour of the mock source; `order_not_found`; abort; reference normalisation.
- `AdminOrdersPage.test.tsx` (jsdom + Testing Library): loading, list, filters through the URL, filter restore, empty states, invalid range (no request), error and retry, paging, reference search.
- `AdminOrderDetailPage.test.tsx`: details in Lagos time with no price, unverified phone, lifecycle step, cancelled order, not found, back link keeps filters.
- `lib/format.test.ts`: Lagos time and calendar-date formatting.

## 10. Known limitations

- Mock data only. Real integration is S1-10.
- Read-only: confirm, assign and cancel come with their APIs.
- No admin route guard until auth is integrated.
- No zone filter (FR-010) and no event history (NFR-004 events are not exposed yet).
- Mobile date inputs use the browser's native picker and locale format.
