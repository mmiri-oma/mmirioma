# Orders

Requirements: FR-001, FR-020, FR-021 (partial), FR-026, FR-027, FR-033 (statuses only),
NFR-004 (creation event), NFR-011, BR-09 (flag only) ·
Acceptance tests: T-06, T-07 (service level) ·
Contract: [docs/api/orders.md](../api/orders.md) (`Status: proposed`) · Issue: S1-03 (#4)

This document covers **S1-03 part 1: order persistence**. The HTTP endpoints
(part 2) wait for the contract to be agreed in S1-16 (#20, gate G3) and are
**not implemented yet**.

## 1. Overview and purpose

Stores customer water order requests and their status history. In Sprint 1 an
order is a **price-less request**: pricing, zones and water categories are open
decisions (SRS §12, PRD §13), so every order starts in `quote_requested` and
holds no amount.

Part 1 provides the database tables, the status enumeration, the
non-guessable public reference, database-enforced idempotency, and service
functions that apply the customer ownership rule. The endpoints in part 2 will
call these services.

## 2. Feature workflow

```
service.create_order(session, customer_id, NewOrder)
  look up (customer_id, idempotency_key)
    found, same details       -> return (existing order, created=False)
    found, different details  -> 409 idempotency_key_reused
    not found:
      insert orders row        status=quote_requested, reference=MO-XXXXXXXXXX
      insert order_events row  from=None, to=quote_requested, actor=customer
      commit
        IntegrityError (concurrent retry won, or reference collision)
          -> rollback, repeat the lookup (max 3 attempts)
      return (new order, created=True)

service.get_customer_order(session, customer_id, reference)
  WHERE reference = ? AND customer_id = ?   else 404 order_not_found

service.list_customer_orders(session, customer_id, limit, offset)
  own orders, newest first, plus total count
```

## 3. Important files

| File | Responsibility |
| --- | --- |
| `backend/app/modules/orders/models.py` | `Order`, `OrderEvent`, `OrderStatus`, field limits |
| `backend/app/modules/orders/service.py` | `NewOrder`, `generate_order_reference`, `create_order`, `get_customer_order`, `list_customer_orders` |
| `backend/alembic/versions/20261015_0003_add_orders_and_order_events.py` | Migration `0003` |
| `backend/alembic/env.py` | Imports the orders models for autogenerate |
| `backend/tests/test_orders.py` | Unit tests (no database) |
| `backend/tests/test_orders_integration.py` | Database tests, including T-06 and T-07 |

## 4. Database models and relationships

Migration `0003` (revises `0002`).

```
users 1 ──< orders 1 ──< order_events >── 0..1 users (actor)
```

**`orders`**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | Internal only; never in customer URLs |
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
`cancelled`, `failed`, `disputed`. `draft` is not stored. Status columns are
VARCHAR with a named CHECK constraint (not a native enum), so a later status is
a constraint change.

## 5. API endpoints

None yet. `POST /orders`, `GET /orders`, `GET /orders/{reference}`,
`GET /admin/orders` and `GET /admin/orders/{reference}` are planned for S1-03
part 2, after the contract is agreed (S1-16).

## 6. Business rules

- **No price (FR-021, FR-022, SRS §12):** orders have no amount column. Every
  quantity is a manual quote request in Sprint 1. A unit test fails if a
  money-like column is added to these tables.
- **Idempotency (FR-026, NFR-011, T-06):** at most one order per
  `(customer_id, idempotency_key)`, enforced by a unique constraint so it holds
  under concurrent retries. A retry with identical details returns the
  existing order (`created=False`, for a 200 instead of 201 later). The same
  key with different details raises 409 `idempotency_key_reused`. "Same
  details" compares every stored request field after normalization. Keys are
  scoped per customer: another customer's key creates a separate order and
  never reveals the first one.
- **Reference (FR-027):** 10 characters from `secrets.choice` over Crockford
  base32 (about 50 bits), unrelated to the ID or time. A collision fails the
  unique constraint and is retried with a new reference.
- **Ownership (FR-001, T-07):** `get_customer_order` filters by reference
  **and** customer, so another customer's order and a missing order both raise
  the same 404 `order_not_found`.
- **Audit (NFR-004):** creation writes an `order_events` row in the same
  transaction as the order.
- **Simulated data (BR-09):** `is_simulated` defaults to false; nothing in
  customer input sets it. Seed scripts (S1-18) will set it.

## 7. Authentication and authorization requirements

The services take a `customer_id`. Part 2 routers will pass the signed-in user
from `CurrentCustomer` (and use `CurrentAdmin` for the admin endpoints) from
`app/modules/auth/dependencies.py`. Drivers get no order access in Sprint 1.

## 8. Error handling and edge cases

| Case | Result |
| --- | --- |
| Same key, same details (sequential or concurrent) | Existing order returned; exactly one row |
| Same key, different details | `APIError` 409 `idempotency_key_reused`; no new row |
| Reference of another customer, or unknown | `APIError` 404 `order_not_found` |
| Quantity outside 1–100000 | Database CHECK rejects it (`IntegrityError`); request schemas in part 2 must reject it earlier with 422 |
| Customer does not exist | Foreign key rejects it (`IntegrityError`) |
| Deleting a user who has orders | Blocked by RESTRICT foreign keys |

`create_order` retries an `IntegrityError` up to 3 times because it cannot
tell a lost idempotency race or reference collision from other constraint
failures without driver-specific details. Validated input never hits the other
cases.

## 9. Testing

From `backend/` with the virtualenv active:

```bash
pytest tests/test_orders.py                     # unit, no database
alembic upgrade head
TEST_DATABASE_URL="$(grep '^DATABASE_URL=' ../.env | cut -d= -f2-)" pytest tests/test_orders_integration.py
```

- `test_t06_*`: sequential retry and 5 concurrent submissions with one key
  create exactly one order.
- `test_t07_customer_cannot_read_another_customers_order`: identical 404 for
  someone else's and a non-existent reference.
- Constraint tests insert directly to prove the database, not only the service,
  enforces idempotency and the quantity range.

Migration check: `alembic upgrade head && alembic downgrade -1 && alembic
upgrade head && alembic check`.

## 10. Known limitations

- No HTTP endpoints or request/response schemas yet (S1-03 part 2, after S1-16).
  Input validation (trimming, phone normalization, date not in the past) will
  live in those schemas; the services assume validated input.
- Status transitions after creation are not implemented or validated yet. The
  transition table in the contract is proposed, and the delivery rows belong to
  S1-06.
- No admin service functions yet (list with status/date filters, detail);
  they come with the admin endpoints.
- No quote, zone, water category or slot on orders until those features are
  agreed.
- `order_events` has no event type or metadata column; from/to status and
  reason cover Sprint 1. Add them by migration if later events need them.
