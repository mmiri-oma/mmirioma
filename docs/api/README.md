# MmiriOma API contracts (v1)

Shared contracts that backend and frontend build against. Agree changes here
**before** implementing them (CLAUDE.md, "API contract").

| Document | Covers | Implemented by |
| --- | --- | --- |
| [auth.md](auth.md) | Roles, sessions, CSRF, register/login/logout/me | S1-02 |
| [orders.md](orders.md) | Order statuses and transitions, order create/read, admin list/detail | S1-03 |
| [examples/](examples/) | Mock JSON responses for frontend work (S1-05, S1-09) | n/a |

Delivery assignment states (assignment, acceptance, pickup, transit, proof,
failure, reassignment) are defined in S1-06. [orders.md](orders.md) only fixes
the order-level statuses they must map onto.

**Status:** proposed for review by Chidinma (orders) and Chukwuebuka (delivery).
A contract is agreed once both reviews are done. Each document ends with its own
open questions.

## Conventions (apply to every endpoint)

### Base path and versioning

- Every endpoint lives under `/api/v1`. Paths below omit this prefix.
- Adding optional response fields or new endpoints is non-breaking. Renaming or
  removing fields, changing types, status codes, or error codes is breaking and
  needs agreement plus a docs update (and a new version once released).

### Formats

| Thing | Format | Example |
| --- | --- | --- |
| Body | JSON, `snake_case` keys | `{"quantity_litres": 200}` |
| Timestamps | ISO 8601, UTC, `Z` suffix | `"2026-10-14T09:30:00Z"` |
| Calendar dates | `YYYY-MM-DD`, meaning the date in Africa/Lagos | `"2026-10-16"` |
| Money | Integer kobo in NGN, fields named `*_minor_units` (SRS §5, BR-01) | `200000` = ₦2,000.00 |
| Quantities | Integer litres, fields named `*_litres` | `200` |
| Phone numbers | E.164 Nigerian format, normalized by the server | `"+2348000000001"` |
| Internal IDs | UUID strings | `"6f1c..."` |
| Order references | Public-safe, non-guessable (FR-027) | `"MO-7KQ2M9XH4T"` |

The frontend displays times in Africa/Lagos (SRS §2.1) and converts kobo to
naira only for display. It never computes prices (FR-022).

### Errors

Every non-2xx response uses the envelope from `backend/app/core/errors.py`
(see [backend architecture](../architecture/backend.md#error-handling-appcoreerrorspy)):

```json
{ "error": { "code": "order_not_found", "message": "Order not found", "details": null } }
```

Clients branch on `code`; `message` may change. Shared codes:

| Status | `code` | When |
| --- | --- | --- |
| 401 | `not_authenticated` | No valid session cookie |
| 403 | `forbidden` | Signed in, but the role may not do this |
| 403 | `csrf_failed` | Unsafe method without a valid `X-CSRF-Token` header |
| 404 | `not_found` | Unknown route |
| 422 | `validation_error` | Invalid body or query; `details` is a list of `{loc, msg, type}` |
| 500 | `internal_server_error` | Unexpected error (no internal details) |
| 503 | `service_unavailable` | Database unreachable |

Each feature document lists its own domain codes.

### Authentication

Browser sessions use an HttpOnly cookie. Every unsafe request (`POST`, `PUT`,
`PATCH`, `DELETE`) also sends an `X-CSRF-Token` header. Details are in
[auth.md](auth.md). The frontend client already sends `credentials: 'include'`.

### Pagination

List endpoints accept `limit` (1–100, default 50) and `offset` (default 0), and
return:

```json
{ "items": [], "total": 0, "limit": 50, "offset": 0 }
```

### Simulated data

Demo and test records are flagged `is_simulated: true` and excluded from real
metrics (BR-09, NFR-031). The flag is set by the server (seed scripts, and
orders placed by demo accounts), never by customer input, and only appears in
staff responses.
