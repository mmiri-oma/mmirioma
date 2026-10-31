# Admin operations (backend)

Issue: #102 (part 1: PR #115; part 2: the dashboard, live map, activity
and reports) · Contract: [admin-operations.md](../api/admin-operations.md)
(agreed 2026-10-27, #22, PR #71 and #81) · Requirements: FR-001, FR-030,
FR-031, FR-032, FR-034, FR-035, FR-037, FR-041, FR-052, FR-053, FR-055,
BR-09, NFR-003, NFR-004

The endpoints behind the admin shell badges, dashboard, live map, recent
activity, Reports page, Support page, audit log, header bell and read-only
Settings page. The shell, dashboard, live map, activity and settings reads are linked to the screens in #217 (see "Frontend" below); support requests, the audit log and admin notifications are linked in #219 (see "Frontend" below); the reports screen is linked in a later issue.

## 1. Overview and purpose

Staff need to see what waits on them and act on it: orders to confirm or
assign, customer support requests, and events from drivers and partners. The
contract gives each mock function in `frontend/src/features/admin/adminApi.ts`
an endpoint, or says why it gets none (payouts, points, refund as points and
saving settings are out of the MVP).

## 2. Feature workflow

1. **Something happens that staff must know about.** In the same
   transaction as the action, `notifications.admin_messages` adds one row
   per active admin:
   - a driver declines an offer (`dispatch.service.decline_assignment`);
   - a job goes on hold: a pickup at another source or with a safety
     concern, an unsafe incident, or alternative proof
     (`deliveries.service`);
   - a partner signs up (`partners.service.register_partner`);
   - a customer files a support request
     (`customers.requests.create_support_request`).
2. **The admin app polls the shell**, `GET /admin/shell`, for the sidebar
   badges and the bell count, and lists messages with
   `GET /admin/notifications`. Messages are marked read with
   `POST /admin/notifications/read`.
3. **Support.** Staff list requests (`GET /admin/support-requests`, open
   first), open one with the people to call, take any action the request
   needs through its own endpoint (alternative proof, withdraw, cancel),
   then resolve it with a note. The customer sees it as resolved.
4. **Audit and settings.** The Settings page reads the audit log
   (`GET /admin/audit-logs`) and the read-only settings
   (`GET /admin/settings`).
5. **Dashboard and reports.** The dashboard reads `GET /admin/dashboard`
   (one Lagos date), `GET /admin/live-map` and `GET /admin/activity`; the
   Reports page reads `GET /admin/reports` (today, 7 or 30 days) and builds
   its CSV from the response. Both count real records unless
   `simulated=only` is sent, and then simulated records only (BR-09).

## 3. Important files and their responsibilities

| File | Responsibility |
| --- | --- |
| `backend/app/modules/notifications/admin_messages.py` | The admin kinds, their texts, and one row per active admin |
| `backend/app/modules/notifications/admin_router.py` | `GET /admin/notifications`, `POST /admin/notifications/read` |
| `backend/app/modules/notifications/service.py` | `unread_count`, shared by the list and the shell |
| `backend/app/modules/customers/requests.py` | Admin list (search, open first), detail with contacts, resolve (audited, final), open count |
| `backend/app/modules/customers/admin_router.py`, `admin_schemas.py` | The three `/admin/support-requests` endpoints and their bodies |
| `backend/app/modules/audit/service.py`, `router.py`, `schemas.py` | `GET /admin/audit-logs`, one record's log with `target_type` and `target_id` |
| `backend/app/modules/reporting/` | New module, no table: shell, settings, dashboard, live map, activity and reports, reading other modules through their services |
| `backend/app/modules/orders/reporting.py` | Order counts (by status, delivery type, zone; "including open"), deliveries with on-time counts, recent events, all real or simulated (BR-09) |
| `backend/app/modules/dispatch/service.py` (part 2) | Oldest waiting order, available drivers, jobs on the road, deliveries per driver |
| `backend/app/modules/deliveries/holds.py`, `deliveries/service.py` | Open holds count; pickups per source |
| `backend/app/modules/payments/service.py` | `cash_totals`: cash collected and reconciled in a range |
| `backend/app/modules/sources/service.py` | `source_usability` (FR-012) and `source_names` |
| `backend/alembic/versions/20261027_0022_add_report_date_indexes.py` | The three date-filter indexes (contract decision 10) |
| `backend/app/modules/customers/requests.py` (part 2) | `recent_support_requests` for the activity list |
| `backend/app/modules/dispatch/service.py` | `count_orders_needing_action` (shell) and `accepted_driver` (support contacts) |
| `backend/app/modules/auth/service.py` | `list_staff`: active admins with `last_sign_in_at` |
| `backend/app/modules/dispatch/service.py`, `deliveries/service.py`, `partners/service.py`, `customers/requests.py` | Call `admin_messages` before their commit |
| `backend/tests/test_admin_operations_api.py` | Roles, CSRF, validation, error codes, bodies against the contract examples, message texts (no database) |
| `backend/tests/test_admin_operations_integration.py` | Messages from real actions, support list, search, contacts and resolve, audit filter, shell and staff |
| `frontend/src/lib/api/adminOperations.ts` | Typed client and Zod checks for `GET /admin/shell`, `/dashboard`, `/live-map`, `/activity` and `/settings` (#217) |
| `frontend/src/features/admin/real/operations.ts` | Adapters converting them to the admin design types, as docs/architecture/api-mapping.md "Admin operations" says |
| `frontend/src/lib/api/adminSupport.ts` | Typed client and Zod checks for the support request, audit log and notification endpoints (#219) |
| `frontend/src/features/admin/real/support.ts` | Adapters: request to issue, the audit action wording, the audit reason and record, notification links |
| `frontend/src/features/admin/auditWording.ts` | The audit log's words that the contract does not fix: the four actions whose reason shows, the names of the kinds of record, the short id's length and the Riders hint (#293) |
| `frontend/src/features/admin/support.screens.test.tsx` | The Support page, the audit log and the notifications in real-API mode |
| `frontend/src/features/admin/operations.screens.test.tsx` | The screens in real-API mode, on the contract's example responses |
| `backend/tests/test_admin_reports_api.py` | Dashboard, reports, live map and activity: roles, query rules, bodies against the examples (no database) |
| `backend/tests/test_admin_reports_integration.py` | Real against simulated counts, ranges, on time, cash, buckets, per driver and per source, holds, live map, activity |

## 4. Database models and relationships

Part 1 needs no migration; part 2 adds revision `0022` (three indexes,
see below). Both use existing tables:

- `notifications` (channel `in_app`): admin rows have `user_id` the admin
  and `order_id` the order, or null for `partner_pending` and a support
  request without an order. They go with their user and order (`ON DELETE
  CASCADE`).
- `support_requests` (revision `0021`, #82 part 4): `status`,
  `resolved_at`, `resolved_by` (an admin, `RESTRICT`) and `resolution_note`
  (up to 500 characters) are set by the resolve endpoint.
- `audit_logs`: one `support_request_resolved` row per resolution, with the
  request id and empty metadata.
- Read only: `orders`, `order_events`, `assignments`, `order_exceptions`,
  `cash_collections`, `pickup_records`, `driver_profiles`, `water_sources`
  with their category activations, `service_zones`, `users`,
  `user_sessions`.
- **Indexes** (revision `0022`, contract decision 10): `orders` already
  had `(status, created_at)`; the migration adds
  `ix_cash_collections_collected_at`, `ix_order_events_to_status_created_at`
  and `ix_pickup_records_picked_up_at` for the date filters. Indexes only,
  no data changed; the downgrade drops them.

## 5. API endpoints and request/response behavior

All under `/api/v1`. Bodies are the contract's; each test compares the
response with its example in `docs/api/examples/`.

| Method | Path | Success | Errors |
| --- | --- | --- | --- |
| GET | `/admin/shell` | 200 `orders_needing_action`, `support_requests_open`, `notifications_unread` | shared only |
| GET | `/admin/settings` | 200 support contact, `delivery_code_validity_minutes`, staff | shared only |
| GET | `/admin/support-requests` | 200 page; `status` (`open`, `resolved`), `q` (1-100), `limit`, `offset` | 422 `validation_error` |
| GET | `/admin/support-requests/{reference}` | 200 the request plus `contacts` | 404 `support_request_not_found` |
| POST | `/admin/support-requests/{reference}/resolve` | 200 the resolved request (no `contacts`) | 404 `support_request_not_found`, 409 `support_request_already_resolved`, 422 `validation_error` |
| GET | `/admin/audit-logs` | 200 page, newest first; `target_type` with `target_id` | 422 `validation_error` (only one of them) |
| GET | `/admin/notifications` | 200 page plus `unread_count`, newest first | 422 `validation_error` (paging) |
| POST | `/admin/notifications/read` | 204; `{"ids": [...]}` (up to 100), `{}` or no body | 422 `validation_error` |
| GET | `/admin/dashboard` | 200; `date` (Lagos, default today, not in the future), `simulated` (`exclude` default, `only`) | 422 `validation_error` |
| GET | `/admin/reports` | 200; `range` (`today`, `7d`, `30d`; required), `simulated` | 422 `validation_error` |
| GET | `/admin/live-map` | 200 jobs on the road and every source; no GPS, no customer data | shared only |
| GET | `/admin/activity` | 200 newest order status changes and support requests; `limit` 1-20, default 5 | 422 `validation_error` |

Shared errors on every endpoint: 401 `not_authenticated`, 403 `forbidden`,
403 `csrf_failed` (POST), 422 `validation_error`.

## 6. Important business rules

- **Who is told (contract open question 1, built as proposed).** Every
  active admin gets their own row, with their own read state. Kinds:
  `driver_declined` (FR-032), `hold_opened` (FR-034, FR-035),
  `partner_pending`, `support_request`. A pickup that opens two holds sends
  one message. An offer, an incident that does not stop the job, and an
  idempotent retry of a support request send none.
- **Texts.** `driver_declined`, `partner_pending` and `support_request`
  match the contract example word for word. `hold_opened` is "An order is
  on hold" / "MO-… needs your review before the driver continues." No text
  has a customer phone, an address or a delivery code (SRS §5); staff
  messages use the full order reference.
- **Orders needing action** (shell): orders in `quote_requested`,
  `awaiting_confirmation` or `confirmed` with no offered or accepted
  assignment (FR-030, FR-031). Simulated orders are counted, since staff act
  on them too.
- **Support search.** `q` matches the request reference, the order
  reference or the customer name, ignoring case; `%` and `_` are matched
  literally. Open requests come first, then newest first.
- **Contacts.** The order's receiver (`contact_name`, `contact_phone`) and
  the driver of its current or last accepted assignment: `accepted`,
  `completed`, or `withdrawn` after acceptance. Without an order, the
  customer who wrote the request. Staff only (NFR-003).
- **Resolving** sets the status, time, admin and note, and changes nothing
  on the order (customer-account.md decision 9). It is final: no reopen
  (open question 5). The audit row has no note (NFR-004, audit module
  rule).
- **Real or simulated, never both** (BR-09). The dashboard and reports
  count orders whose `is_simulated` matches `simulated` (`exclude`: real,
  the default; `only`: simulated) and say which in `is_simulated`. Cash,
  pickups and deliveries follow their order. "Now" values (open holds, open
  support requests, available drivers, usable sources) are the same for
  both. The live map and activity are operational lists: every record,
  each with its flag.
- **Lagos days.** An order belongs to a day by `created_at`, a delivery by
  its first `delivered` event, cash by `collected_at`, a pickup by
  `picked_up_at`. `7d` is the 7 Lagos days ending today.
- **Dashboard orders** are those created on the date plus older ones still
  open (not delivered, cancelled or failed). `oldest_waiting_minutes`
  counts whole minutes, rounded down, from the oldest order waiting on
  staff.
- **On time** (FR-052): delivered at or before the confirmed window's end;
  an order without a window is never on time. The screen computes the rate
  (`on_time / with_window`).
- **`range` is required** on `GET /admin/reports` (contract decision 7):
  a missing `range` is 422 `validation_error`.
- **Buckets, never guessed.** Orders without a delivery type count as
  `not_recorded`; orders without a zone go in one `by_zone` row with `null`
  id and name, left out when empty. `by_zone[].delivered` counts the
  zone's deliveries in the range by delivery time, so the rows add up to
  `deliveries.delivered` (contract decision 8).
- **Per driver and per source.** A delivery's driver is the one on the
  order's `completed` assignment. Pickups at another source (no
  `source_id`) are not counted in `by_source`. No pay, refunds, costs or
  contribution are returned (F6, F7; partner pay is out of the MVP).
  Contract decision 9.
- **Usable sources** (FR-012): at least one category activation passes the
  shared eligibility check today.
- **Live map** (FR-037): orders with an accepted assignment in `accepted`
  through `unloading`, oldest first, placed by source and zone. No customer
  name, phone or address.
- **Activity:** order status changes and new support requests, newest
  first. The actor is the staff member or driver; `null` for the system
  and customers, so no customer name reaches the dashboard.
- **Settings are read only** (decision 4): `SUPPORT_PHONE` and
  `SUPPORT_WHATSAPP_ENABLED` (FR-055), the delivery code's 10 minutes
  (FR-035), and active admins by name. `last_sign_in_at` is the newest
  session's creation time; sessions do not record later use.

## 7. Authentication and authorization requirements

Every endpoint needs a signed-in, active `admin` (`CurrentAdmin`); customers
and drivers get 403 `forbidden` (FR-001). POST requests need the
`X-CSRF-Token` header. Each admin reads and marks only their own
notifications; unknown ids and other people's ids are ignored.

## 8. Error handling and edge cases

- Two admins resolving one request at once: the row is locked, so the second
  gets 409 `support_request_already_resolved`.
- A message is added in the action's transaction: if the decline, hold,
  sign-up or request is rolled back, so is the message, and adding one
  never changes an order (FR-050).
- An admin who is deactivated gets no new messages; their old rows stay.
- A request whose order has no accepted assignment lists only the receiver.
- A request from a customer who was later anonymized still lists and opens:
  its message and the staff's resolution note both read "Removed at the
  customer's request." (#117), so `resolution` keeps its agreed shape; the
  customer shows as "Deleted customer" with the anonymized phone marker.
- Errors use the standard envelope; no message text, SQL or stack trace
  leaks.

## 9. Testing instructions

From `backend/` with the virtualenv:

```bash
ruff check . && ruff format --check .
pytest tests/test_admin_operations_api.py tests/test_admin_reports_api.py
TEST_DATABASE_URL=... pytest tests/test_admin_operations_integration.py tests/test_admin_reports_integration.py
```

The integration tests need a migrated test database (`alembic upgrade
head`). They check only rows for the admins they create, and the report
tests compare numbers before and after adding their own rows, so other data
in the database does not affect them.

## 10. Known limitations

- **A driver's reason stays readable after the driver is anonymized.** The
  privacy tool keeps audit rows, so a suspension reason still shows in the log.
  Blanking it is a backend change, tracked apart from #293.
- **A row names its record by a short id, not a name,** until the backend's
  `target_label` ships (#296).
- **`assignment_expired` is not created.** Offers never expire in the
  backend (admin dispatch decision 1; nothing sets the `expired` assignment
  status), so the contract's "an offer times out" message has no trigger.
  Whoever builds offer expiry adds it to `admin_messages` (technical lead,
  2026-10-27).
- `simulated=only` stays available in every deployment until open
  question 6 is decided.
- The contract's open questions stay open: which events notify admins (1),
  urgent support requests (2), an order-level CSV (3), support hours (4),
  reopening a resolved request (5).
- **Linked in #217: shell, dashboard, live map, activity and settings. Linked
  in #219: support requests, the audit log and admin notifications.** The
  reports screen still runs on its mock in real mode until its link issue.
- **Support in real mode resolves with one note** (5 to 500 characters),
  kept on the request and not in the audit log. There is no resolution
  picker, no points and no urgent count; a refused note shows under the
  field in the server's words. Confirming without the code, withdrawing and
  cancelling are done from the order's page and the hold review. A driver in
  the contacts reads "Driver" (the contacts carry no delivery type).
- **The audit log shows plain words for the codes the backend writes** and
  any other code as it is. Codes built from a status
  (`deletion_request_<status>`, `water_source_<status>`) show as the code until
  words are added. Under each action a smaller line says what it is about, the
  kind of record in words and the first 6 characters of its id ("Driver ·
  4f3a2c"), until the backend sends a label (#296). The Reason column shows
  `details.reason` on the four driver decisions (`driver_approved`,
  `driver_suspended`, `driver_activated`, `driver_deactivated`) and "None" on
  every other row, even if a later action stores a note in `details`; the words
  are in `features/admin/auditWording.ts` (#293, `docs/design/admin-audit-log.md`).
- **The Riders reason box carries a hint**, "Do not include customer details.":
  the reason is stored in the audit log, which staff read.
- **Real-mode screens show only what the backend sends.** The dashboard has
  no "Rider payouts due" or "Payments to verify" cards, and its "Refill
  stations" panel lists the live map's water sources (no count of active
  loads). Settings is read only: the support number and the delivery code
  limit, with no support hours, safe load or save button. A live-map
  delivery with no delivery type gets a neutral marker, and with no plate it
  shows the driver's name.
- **My account and Refill stations (#235).** My account reads `GET /auth/me`
  (`getAdminAccount` in `features/admin/real/operations.ts`): the name and
  phone, and the role "Admin" (one staff role); the page shows no last
  sign-in. Refill stations has no admin endpoint (stations stay on the
  command-line tool), so with the real API the page is switched off
  (`STATIONS_PAGE_ENABLED` in `lib/features.ts`): no menu entry, the old
  link goes to the dashboard, and the dashboard panel keeps listing the live
  map's water sources without its "Manage" link. Mock mode keeps the page.
- **A database with only demo accounts shows zeros on the dashboard.** It
  counts real orders by default (BR-09); the screens send no `simulated`
  parameter and have no toggle.
