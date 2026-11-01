# MmiriOma API contracts (v1)

Shared contracts that backend and frontend build against. Agree changes here
**before** implementing them (CLAUDE.md, "API contract").

| Document | Covers | Implemented by |
| --- | --- | --- |
| [auth.md](auth.md) | Roles, sessions, CSRF, register/login/logout/me, phone verification and change; change password (**agreed** 2026-10-26, #8) | S1-02; change password #56 |
| [orders.md](orders.md) | Order statuses and transitions, order create/read, admin list/detail | S1-03 |
| [deliveries.md](deliveries.md) | Order state machine and assignments; driver job endpoints (list incl. later-day jobs, detail, decline, pickup, new delivery code, incidents; part 2: accept, steps, arrival, contact attempts, unloading complete, proof, built in #75); admin dispatch endpoints (driver list, assign, withdraw, history; built in #61); order confirmation endpoints (confirmation options, confirm; agreed in PR #111, built in #112 and #113) | S1-06, S1-07, PR #50, PR #59, #61, #75, #113 |
| [payments.md](payments.md) | Cash collection, remittance and reconciliation for the pilot (pay on delivery only, F4): driver record and handover, admin receive and reconcile, payment status on the order. **Agreed** 2026-10-22 (#98); backend built in #123, with amendments 1-3 proposed there | #123 |
| [order-details-and-price.md](order-details-and-price.md) | Delivery type (Keke or Tanker), jerrycan and tank details, water source preference, `POST /quotes` (FR-022, total only), `quote_id` and `service_zone_id` on `POST /orders`, details, zone and quote on `OrderRead` (**agreed** 2026-10-26, #10 and #42) | #21 (needs #37) |
| [customer-account.md](customer-account.md) | Customer profile read, saved addresses, order feedback (FR-051), in-app notifications (FR-050), support requests, account deletion request (privacy notice §9); no points endpoint (**agreed** 2026-10-27, #11 and #48) | not yet |
| [partners.md](partners.md) | Partner (rider and driver) self sign-up as an auth amendment, approval status, profile read and update, going online, in-app notifications. Documents, earnings and payouts out of the MVP. Amends `auth.md` (**agreed** 2026-10-26, #14 and #47) | not yet |
| [admin-operations.md](admin-operations.md) | Admin shell counts, dashboard and reports (FR-052, real orders by default, BR-09), live map without GPS, recent activity, support requests (list, detail, resolve with a note), audit log, admin notifications, read-only settings. Payouts, points and saving settings not proposed (**agreed** 2026-10-27, #22 and PR #71) | not yet |
| [examples/](examples/) | Mock JSON responses for frontend work (S1-05, S1-09) | n/a |
| [push.md](push.md) | Push subscriptions and message payload: **not in the MVP** (decided in #8; not an SRS channel, needs a new library); kept as a reference | not built |
| [public-site.md](public-site.md) | Support contact for the website from backend settings (FR-055); newsletter left out of the pilot (**agreed** 2026-10-26, #8) | #56 |
| [admin-directory.md](admin-directory.md) | Admin customers and saved addresses, drivers (list, approve or suspend with vehicle verification, activate; revised for #43, no staff-created accounts), service zones (FR-010), versioned FR-022 price lists (**agreed**: service zones and price lists on 2026-10-26, customers and drivers on 2026-10-28 (#43); zones amended for #30: one fallback fee per category, `GET /service-zones`) | zones: #30; price lists: #37; customers and drivers: #45 |
| [admin-water-sources.md](admin-water-sources.md) | Admin water sources: list, add, edit, activate or renew, suspend or revoke, with an expiry state on each activation; amends C1 so the cost per litre travels on these admin endpoints only (**agreed**, #309) | #309 |

Delivery assignment states (assignment, acceptance, pickup, transit, proof,
failure, reassignment) are defined in S1-06. [orders.md](orders.md) only fixes
the order-level statuses they must map onto.

**Status:** proposed for review by Chidinma (orders) and Chukwuebuka (delivery).
A contract is agreed once both reviews are done, or when the technical lead
agrees it alone (CLAUDE.md, "Team workflow"). Each document ends with its
own open questions.

### Privacy notice page: no endpoints

The privacy notice page and its links (design,
#100) call no endpoint: the notice text is bundled with the frontend at build
time and the page does not check the session. G3 for that slice is passed
without a contract. Any later change that loads the notice from the server
needs a contract here first.

## Conventions (apply to every endpoint)

### Base path and versioning

- Every endpoint lives under `/api/v1`. Paths below omit this prefix.
- Adding optional response fields or new endpoints is non-breaking. Renaming or
  removing fields, changing types, status codes, or error codes is breaking and
  needs agreement plus a docs update (and a new version once released).

### Formats

| Thing | Format | Example |
| --- | --- | --- |
| Body | JSON, `snake_case` keys | `{"quantity_litres": 1200}` |
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
