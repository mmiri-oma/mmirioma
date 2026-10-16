# Orders

Requirements: FR-001, FR-020, FR-021 (partial), FR-026, FR-027, FR-030 (creation-date
filter), FR-033 (statuses and creation only), NFR-004 (creation event), NFR-011, BR-09 ·
Acceptance tests: T-06, T-07 ·
Contract: [docs/api/orders.md](../api/orders.md) (`Status: agreed`, S1-16) · Issue: S1-03 (#4)

## 1. Overview and purpose

Customers submit water order requests and read their own orders. Admins
(dispatchers) see every order, filter the queue, and see who placed each one.

In Sprint 1 an order is a **price-less request**: pricing, zones and water
categories are open decisions (SRS §12, PRD §13), so every order starts in
`quote_requested` and holds no amount.

Part 1 (#28) added persistence: tables, statuses, the public reference,
database-enforced idempotency and ownership rules. Part 2 adds the five HTTP
endpoints from the agreed contract.

## 2. Feature workflow

```
POST /api/v1/orders            (customer, X-CSRF-Token)
  OrderCreate validation        trim, phone -> E.164, limits, date >= today (Lagos)
  service.create_order
    look up (customer_id, idempotency_key)
      found, same details       -> 200 existing order
      found, different details  -> 409 idempotency_key_reused
      not found -> insert order (quote_requested, MO-XXXXXXXXXX)
                   + order_events row, commit -> 201
      IntegrityError (concurrent retry won / reference collision)
                   -> rollback, look up again (max 3 attempts)

GET /api/v1/orders              (customer)  own orders, newest first, paged
GET /api/v1/orders/{reference}  (customer)  own order, else 404 order_not_found

GET /api/v1/admin/orders        (admin)     all orders, filters, with customer
GET /api/v1/admin/orders/{reference} (admin) any order, with customer
```

## 3. Important files

| File | Responsibility |
| --- | --- |
| `backend/app/modules/orders/models.py` | `Order`, `OrderEvent`, `OrderStatus`, field limits |
| `backend/app/modules/orders/service.py` | `NewOrder`, `generate_order_reference`, `create_order`, customer reads, staff reads (`StaffOrder`) |
| `backend/app/modules/orders/schemas.py` | `OrderCreate`, `OrderRead`, `AdminOrderRead`, page models, `PageParams`, `AdminOrderFilters` |
| `backend/app/modules/orders/router.py` | The five endpoints; role guards |
| `backend/app/modules/auth/service.py` | `get_users_by_ids`, used for the staff view's customer details |
| `backend/app/shared/lagos_time.py` | Today in Lagos; start of a Lagos day in UTC |
| `backend/app/api/v1/router.py` | Registers the orders router |
| `backend/alembic/versions/20261015_0003_add_orders_and_order_events.py` | Migration `0003` |
| `backend/tests/test_orders.py` | Model and reference unit tests |
| `backend/tests/test_orders_api.py` | Endpoint unit tests (fake session and service) |
| `backend/tests/test_orders_integration.py` | Database and HTTP tests, including T-06 and T-07 |

## 4. Database models and relationships

Migration `0003` (revises `0002`). Part 2 adds no migration.

```
users 1 ──< orders 1 ──< order_events >── 0..1 users (actor)
```

**`orders`**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | Internal; only staff responses include it |
| `reference` | varchar(13), unique | `MO-` + 10 Crockford base32 characters (FR-027) |
| `customer_id` | UUID FK `users.id` ON DELETE RESTRICT | The ordering customer |
| `idempotency_key` | UUID | Unique together with `customer_id` (`uq_orders_customer_idempotency`) |
| `status` | varchar(30) + CHECK | One of the 11 statuses below |
| `quantity_litres` | integer, CHECK 1–100000 | Whole litres |
| `contact_name` | varchar(100) | |
| `contact_phone` | varchar(16) | E.164 |
| `delivery_address` | varchar(500) | Free text |
| `landmark` | varchar(200), nullable | |
| `delivery_instructions` | varchar(500), nullable | |
| `preferred_delivery_date` | date, nullable | Preference only, not a slot |
| `is_simulated` | boolean, default false | Demo/test data (BR-09) |
| `created_at`, `updated_at` | timestamptz | Database `now()` |

Indexes: `(customer_id, created_at)` for a customer's list, `(status,
created_at)` for the dispatcher queue.

**`order_events`**: `id`, `order_id` (FK `orders`, RESTRICT), `actor_id`
(FK `users`, RESTRICT, nullable for system actions), `from_status` (nullable
on creation), `to_status`, `reason` (text, nullable), timestamps. Append-only.

**Statuses (FR-033):** `quote_requested`, `awaiting_confirmation`,
`confirmed`, `assigned`, `accepted`, `collected`, `en_route`, `delivered`,
`cancelled`, `failed`, `disputed`. `draft` is not stored.

## 5. API endpoints

All under `/api/v1`; full contract in [docs/api/orders.md](../api/orders.md).

| Method | Path | Role | Success | Errors |
| --- | --- | --- | --- | --- |
| POST | `/orders` | customer | 201 `OrderRead`; 200 on idempotent retry | 409 `idempotency_key_reused`, 422 |
| GET | `/orders` | customer | 200 `{items: OrderRead[], total, limit, offset}` | 422 |
| GET | `/orders/{reference}` | customer | 200 `OrderRead` | 404 `order_not_found` |
| GET | `/admin/orders` | admin | 200 `{items: AdminOrderRead[], total, limit, offset}` | 422 |
| GET | `/admin/orders/{reference}` | admin | 200 `AdminOrderRead` | 404 `order_not_found` |

Every endpoint also returns 401 `not_authenticated` and 403 `forbidden`;
`POST` also 403 `csrf_failed`.

- **`OrderCreate`** (unknown fields rejected): `idempotency_key` (UUID),
  `quantity_litres` (JSON integer 1–100000; strings, decimals and booleans are
  rejected), `contact_name` (trimmed, 1–100), `contact_phone` (Nigerian mobile,
  normalized to E.164), `delivery_address` (trimmed, 5–500), optional
  `landmark` (≤200), `delivery_instructions` (≤500), `preferred_delivery_date`
  (today or later in Lagos). Optional text that is blank after trimming is
  stored as `null`.
- **`OrderRead`**: `reference`, `status`, the request fields, `created_at`,
  `updated_at`. No ID, customer or `is_simulated`.
- **`AdminOrderRead`**: `OrderRead` plus `id`, `customer` (`id`, `name`,
  `phone`, `phone_verified`) and `is_simulated`.
- **Paging:** `limit` 1–100 (default 50), `offset` ≥ 0.
- **Admin filters:** `status` (repeatable), `created_from` / `created_to`
  (inclusive Lagos dates; reversed range is 422 on `created_to`),
  `is_simulated` (`true`, `false`, or omitted for both).

## 6. Business rules

- **No price (FR-021, FR-022, SRS §12):** no amount column or field. A unit
  test fails if a money-like column is added to these tables, and
  `OrderCreate` rejects price fields.
- **Idempotency (FR-026, NFR-011, T-06):** at most one order per
  `(customer_id, idempotency_key)`, enforced by a unique constraint so it holds
  under concurrent retries. A retry with identical details returns the
  existing order with 200. The same key with different details is 409
  `idempotency_key_reused`. "Same details" compares every field after
  normalization, so `08000000001` and `+2348000000001` are the same phone.
  Keys are scoped per customer.
- **Reference (FR-027):** 10 characters from `secrets.choice` over Crockford
  base32 (about 50 bits), unrelated to the ID or time.
- **Ownership (FR-001, T-07):** customer reads filter by reference **and**
  customer, so another customer's order and a missing order give the same
  404. Admins read all orders. Drivers have no order access in Sprint 1.
- **Lagos dates (SRS §2.1):** `preferred_delivery_date` and the admin date
  filters are Africa/Lagos calendar dates. Lagos is a fixed UTC+1 with no
  daylight saving, so `lagos_time` uses a fixed offset rather than a time zone
  database. A `created_to` day ends at the start of the next Lagos day
  (23:00 UTC), exclusive.
- **Audit (NFR-004):** creation writes an `order_events` row in the same
  transaction as the order.
- **Simulated data (BR-09):** `is_simulated` defaults to false, cannot be set
  through the API, appears only in admin responses, and can be filtered there.
  The server sets it in two cases: the demo seed
  (`create_order(..., is_simulated=True)`), and `POST /orders` by a demo
  account, which the router detects with `is_demo_identity`
  (`app/shared/demo_accounts.py`; see [demo data](demo-data.md)).

## 7. Authentication and authorization requirements

- `POST /orders`, `GET /orders`, `GET /orders/{reference}`: `CurrentCustomer`.
- `GET /admin/orders`, `GET /admin/orders/{reference}`: `CurrentAdmin`.
- Session cookie required everywhere (401 otherwise); `POST` also needs the
  `X-CSRF-Token` header (403 `csrf_failed`). See
  [authentication](authentication.md).

## 8. Error handling and edge cases

| Case | Result |
| --- | --- |
| Same key, same details (sequential or concurrent) | 200 with the existing order; exactly one row |
| Same key, different details | 409 `idempotency_key_reused`; no new row |
| Another customer's reference, or unknown | 404 `order_not_found` (identical bodies) |
| Invalid body or query | 422 `validation_error`; `details[].loc` names the field or parameter |
| `created_from` after `created_to` | 422 on `created_to` |
| Preferred date before today (Lagos) | 422 on `preferred_delivery_date` |
| Driver, or wrong role | 403 `forbidden` |
| Deleting a user who has orders | Blocked by RESTRICT foreign keys |

## 9. Testing

From `backend/` with the virtualenv active:

```bash
pytest tests/test_orders.py tests/test_orders_api.py   # no database
alembic upgrade head
TEST_DATABASE_URL="$(grep '^DATABASE_URL=' ../.env | cut -d= -f2-)" pytest tests/test_orders_integration.py
```

- `test_orders_api.py`: 401/403 for every role on every endpoint, CSRF, every
  field rule, 201 vs 200, query validation and response shapes.
- `test_t06_*`: sequential retry, 5 concurrent submissions, and the HTTP flow
  (201, 200, 409, one row).
- `test_t07_*`: identical 404 for someone else's and a non-existent reference,
  at service level and over HTTP; drivers get 403.
- `test_admin_filters_by_status_lagos_dates_and_simulated_flag`: orders
  back-dated to either side of a Lagos midnight, plus status, simulated and
  paging filters.

Migration check (part 1): `alembic upgrade head && alembic downgrade -1 &&
alembic upgrade head && alembic check`.

## 10. Known limitations

- Status transitions after creation are not implemented (admin confirm,
  cancel, delivery phase); the contract lists them as later work (S1-06/S1-07).
- No customer cancellation: an open question in the contract.
- No quote, zone, water category or slot on orders until those features are
  agreed.
- `order_events` has no event type or metadata column, and customers cannot
  see the history yet.
- Admin date filters use creation date; a delivery-date filter waits for slots.
