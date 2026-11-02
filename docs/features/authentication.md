# Authentication and role authorization

Requirements: FR-001, FR-002, FR-003 (SMS verification: [phone-verification.md](phone-verification.md)), NFR-001 (partial), NFR-002 (auth endpoints),
NFR-012, NFR-020, NFR-021, NFR-022 ·
Acceptance tests: T-07 (guard only; the order-level test lands with S1-03) ·
Contract: [docs/api/auth.md](../api/auth.md) · Design:
[docs/design/authentication.md](../design/authentication.md) · Issues: S1-02 (backend),
S1-17 (frontend)

## 1. Overview and purpose

Lets customers, admins/dispatchers and drivers sign in with a phone number and
password, keeps them signed in with a secure server-side cookie session, and
gives other modules one-line guards that enforce roles (FR-001) and CSRF
protection on every authenticated write.

Customers register themselves. Admin and driver accounts are created by the
technical lead with a command-line tool. Deactivating an account signs it out
everywhere at once (FR-002). Login and registration are rate limited
(NFR-002). Any signed-in account can change its password (#8, built in
#56), which signs out its other devices.

The frontend (S1-17) implements the approved sign-in, account and session
screens for the **customer app** (`/`) and the **staff app** (`/admin`) of
the single React app. The driver app's screens follow with S1-15.

## 2. Feature workflow

```
Register / login                         Authenticated request
---------------------------------        --------------------------------------------
POST /auth/register or /auth/login       Cookie mmirioma_session=<token>
  validate body (phone normalized)       [+ X-CSRF-Token for POST/PUT/PATCH/DELETE]
  rate limit: count attempt or 429
  register: create customer (scrypt)       get_auth_session dependency
  login: verify password (scrypt)            hash token -> find session row
  start_session: random token,               (unrevoked, unexpired, user active)
    store HMAC(token) + expires_at             else 401 not_authenticated
  Set-Cookie: HttpOnly session token         unsafe method: check CSRF
  body: user + csrf_token + expires_at         else 403 csrf_failed
                                           require_roles(...) -> else 403 forbidden
Frontend keeps csrf_token in memory      handler runs with the User
(api client), re-reads it via /auth/me
after a page reload.                     POST /auth/logout -> revoke row, clear cookie
```

Frontend, on every page load and navigation:

```
main.tsx: QueryClientProvider > BrowserRouter > SessionProvider > AppRoutes
SessionProvider: useQuery(['auth','session'], GET /auth/me)
  pending                  -> status checking    -> splash (X1)
  401                      -> null, signed-out   -> welcome (C1) or sign-in
  network failure          -> status unavailable -> "Unable to reach the server" + Retry
  200                      -> signed-in(role)    -> AppGate checks the app's role
  was signed in, now null,
  not chosen by the person -> signed-out, ended  -> sign-in with X2 banner
AppGate(app): decideAccess(status, app)
  allowed -> page | wrong-app -> X4 | sign-in -> Navigate(sign-in, {from})
Any other request with 401 not_authenticated -> re-check the session (lib/queryClient.ts)
Sign in / create account -> store session in the query cache -> app home (or `from`)
Sign out -> POST /auth/logout -> clear session (marked "by user")
  -> AppGate: customer welcome / staff sign-in, each with the toast
Redirects after sign-in, account creation and sign-out are rendered from the
session state (<Navigate>), never navigate() calls: React Router runs
navigations as transitions, which would lose to the guards' own redirects.
```

## 3. Important files

| File | Responsibility |
| --- | --- |
| `backend/app/modules/auth/models.py` | `User`, `UserSession`, `UserRole` |
| `backend/app/modules/auth/security.py` | scrypt hashing, session token generation and hashing, CSRF derivation |
| `backend/app/modules/auth/service.py` | Create user, authenticate, check and change the password, start/look up/revoke sessions, activate/deactivate |
| `backend/app/modules/auth/dependencies.py` | `get_auth_session`, `require_roles`, `CurrentUser` / `CurrentCustomer` / `CurrentAdmin` / `CurrentDriver` |
| `backend/app/modules/auth/router.py` | `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/password`, `/auth/me` (and phone verification, partner sign-up) |
| `backend/app/modules/auth/rate_limit.py` | In-memory sliding-window limits for login and registration |
| `backend/app/modules/auth/cli.py` | `create-user`, `activate`, `deactivate` commands |
| `backend/app/modules/auth/schemas.py` | Request/response models and password/name limits |
| `backend/app/shared/phone.py` | Nigerian phone normalization to E.164 (shared with orders) |
| `backend/app/core/config.py` | `SESSION_*` settings and their validation |
| `backend/alembic/versions/20261014_0002_add_users_and_user_sessions.py` | Migration `0002` |
| `frontend/src/lib/api/client.ts` | `setCsrfToken`, sends `X-CSRF-Token` on non-GET requests |
| `frontend/src/lib/api/auth.ts` | Typed `register`, `login`, `getMe`, `logout` |
| `frontend/src/main.tsx`, `frontend/src/App.tsx` | Providers and routes (`/sign-in`, `/create-account`, `/admin/sign-in`, the customer ordering routes behind the customer guard, `/admin/*` behind the staff guard) |
| `frontend/src/lib/queryClient.ts` | TanStack Query client; re-checks the session after any 401 |
| `frontend/src/features/auth/SessionProvider.tsx`, `sessionContext.ts`, `sessionQuery.ts` | Session query, status (checking, unavailable, signed out/ended, signed in) |
| `frontend/src/features/auth/access.ts` | `decideAccess` route-guard decision, app roles and paths, X4 messages |
| `frontend/src/features/auth/components/AppGate.tsx` | Route guard component |
| `frontend/src/features/auth/pages/` | C1 welcome, C2 create account (success goes to V1 Verify your phone number), C3/S1 sign in, and the customer account notice (the verify-phone banner that replaced X6) shown on My orders. The customer home itself is My orders ([customer-ordering.md](customer-ordering.md)) |
| `frontend/src/features/auth/components/` | Auth layout, banners with rate-limit wait, splash, X4 screen, customer header, account panel and sign-out controls (`AccountControls.tsx`) |
| `frontend/src/components/layout/AdminShell.tsx` | Admin layout (S1-09); shows the staff name and Sign out (X5) |
| `frontend/src/features/auth/useSignOut.ts` | Sign-out and its failure states |
| `frontend/src/features/auth/phone.ts`, `schemas.ts`, `messages.ts`, `waitTime.ts`, `contact.ts` | Phone check and display, form rules, exact texts and error mapping, wait wording, support links |
| `frontend/src/components/ui/` | Design-system components: `Button`, `Field`/`PasswordField`, `Alert`, `Toast`, `Logo` |
| `frontend/src/index.css` | Tailwind `@theme` tokens from the approved design system |

## 4. Database models and relationships

Migration `0002` (revises `0001`).

`users`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | |
| `name` | varchar(100) | |
| `phone` | varchar(16), **unique** (`uq_users_phone`) | E.164 `+234...`; the sign-in identifier |
| `password_hash` | varchar(255) | `scrypt$<log2N>$<r>$<p>$<salt>$<hash>` |
| `role` | varchar(20), CHECK `ck_users_user_role` | `customer`, `admin`, `driver` |
| `is_active` | boolean, default true | false blocks login and all sessions |
| `phone_verified_at` | timestamptz, nullable | Set when the customer verifies the phone by SMS code (FR-003, [phone-verification.md](phone-verification.md)); required before ordering |
| `created_at`, `updated_at` | timestamptz | |

`user_sessions` (many per user, `ON DELETE CASCADE`)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | |
| `user_id` | UUID FK → `users.id`, indexed | |
| `token_hash` | varchar(64) hex, **unique** | HMAC-SHA256(`SESSION_SECRET`, cookie token); the raw token is never stored |
| `expires_at` | timestamptz | Creation + `SESSION_MAX_AGE_SECONDS` |
| `revoked_at` | timestamptz, nullable | Set on logout or deactivation |
| `created_at`, `updated_at` | timestamptz | |

The SRS `customers` entity is not a separate table yet. A customer is a `users`
row with role `customer`; orders will reference `users.id`.

## 5. API endpoints

All under `/api/v1`.

| Method | Path | Roles | Request | Success | Errors (status + code) |
| --- | --- | --- | --- | --- | --- |
| POST | `/auth/register` | public | `{name, phone, password}` (extra fields rejected) | 201 `{user, csrf_token, expires_at}` + cookie | 409 `phone_already_registered`, 422 `validation_error`, 429 `too_many_attempts` |
| POST | `/auth/login` | public | `{phone, password}` | 200 `{user, csrf_token, expires_at}` + cookie | 401 `invalid_credentials`, 422 `validation_error`, 429 `too_many_attempts` |
| POST | `/auth/logout` | any signed-in | none; `X-CSRF-Token` header | 204, cookie cleared | 401 `not_authenticated`, 403 `csrf_failed` |
| GET | `/auth/me` | any signed-in | none | 200 `{user, csrf_token, expires_at}` | 401 `not_authenticated` |
| POST | `/auth/password` | any signed-in | `{current_password, new_password}`; `X-CSRF-Token` header | 204 | 401 `not_authenticated`, 403 `csrf_failed`, 403 `password_incorrect`, 422 `validation_error`, 429 `too_many_attempts` |

`user` is `{id, name, phone, role, phone_verified}`. The full contract and
examples are in [docs/api/auth.md](../api/auth.md). The phone verification
and phone change endpoints (`/auth/phone-verification`, `/auth/phone-change`
and their `/verify`) are documented in
[phone-verification.md](phone-verification.md).

## 6. Business rules

- **Roles are server-side (FR-001).** Registration always creates `customer`;
  a `role` field in the body is rejected with 422. Staff accounts come only from
  the CLI.
- **One identifier: phone.** Numbers are normalized to E.164 before storage and
  comparison, so `0800...`, `234800...` and `+234800...` are the same account.
- **Sign-in screens (Waterline redesign, `feat/waterline-redesign`).** Every
  sign-in and sign-up screen (customer, rider/driver, staff) uses
  `frontend/src/features/auth/AuthShell.tsx`: a side panel whose tank fills
  as the form becomes valid (decoration only), a band on phones, and a dark
  tone for staff. The phone field (`PhoneField` in
  `components/ui/Field.tsx`) has a country picker listing
  `PHONE_COUNTRIES` (Nigeria, +234 only, because FR-003 accepts Nigerian
  numbers only); it also accepts the bare 10 digits typed after "+234", and
  the form sends the E.164 form. Customer and rider/driver sign-up ask for
  the password twice ("Type your password again"; "The two passwords do not
  match."), checked in the browser only: there is no self-service reset, so
  a typo would lock the person out. The API still takes one `password`.
- **Deactivation is immediate (FR-002).** Session lookup requires
  `users.is_active`, and `deactivate` also revokes every open session.
- **Contact verification (FR-003).** Customers start unverified
  (`phone_verified: false`) and verify by SMS code before their first order
  (SRS v0.2; [phone-verification.md](phone-verification.md)). The C2 one-time
  notice and the X6 banner, which promised manual confirmation, were
  replaced by that design.
- **Rate limits (NFR-002)**, sliding windows, in process memory:

  | What | Key | Limit |
  | --- | --- | --- |
  | Failed logins | normalized phone | 5 per 15 minutes |
  | Failed logins | client IP | 50 per 15 minutes |
  | Registration attempts (any outcome) | client IP | 20 per hour |

  The per-phone limit is the real brute-force defence. Per-IP limits are
  generous because many Nigerian mobile users share a public IP through carrier
  NAT. Each login attempt is counted when it starts (check and count happen
  together, before the slow password check) and withdrawn if it succeeds.
  Counting after the check would let concurrent requests slip past the limit.
  A successful login clears the phone's count but withdraws only that one
  attempt from the IP count. While limited, even the correct password gets 429,
  and the password is not checked at all.
- **Changing the password** (`POST /auth/password`, #8, built in #56): any
  role. The current password is checked under the **sign-in failure limits**
  for the account's phone and the client IP (counted when the attempt
  starts, withdrawn on success), so the endpoint cannot guess passwords
  faster than login. A wrong one is 403 `password_incorrect`, not 401: the
  session is still valid. On success, in one transaction, the new hash is
  stored, **every other session of the account is revoked** (decided by
  @chidimmamogbo on #8), and an audit row `password_changed` is written
  with no password, hash or session data (NFR-004). This session keeps its
  cookie and CSRF token. The new password may equal the old one (no SRS
  rule). No SMS is sent about the change (FR-050 lists none).
- **Passwords:** 8–128 characters, no composition rules (NIST SP 800-63B).
  scrypt N=2^16, r=8, p=2 (OWASP equivalent-strength setting, about 64 MiB per
  hash), 16-byte random salt. Parameters are stored per hash so they can be
  raised later. Chosen over argon2/bcrypt to avoid a new dependency.

## 7. Authentication and authorization

- **Cookie:** `mmirioma_session`, HttpOnly, `Path=/`, `SameSite` from
  `SESSION_COOKIE_SAMESITE` (default `lax`), `Secure` from
  `SESSION_COOKIE_SECURE` (default on in production only; production refuses an
  explicit `false`). `Max-Age` = `SESSION_MAX_AGE_SECONDS` (default 7 days,
  absolute, no sliding renewal).
- **Session token:** 256 random bits. The database stores only an HMAC with
  `SESSION_SECRET`, so a database leak alone does not yield usable cookies.
- **CSRF:** the token is HMAC(`SESSION_SECRET`, "csrf:" + session token). It is
  returned in session responses and must come back in `X-CSRF-Token` on every
  unsafe method. The check is inside `get_auth_session`, which every role guard
  uses, so no authenticated write can skip it. `login` and `register` have no
  session and are exempt. A cross-site HTML form cannot send them anyway: it
  cannot set a JSON content type, and FastAPI rejects non-JSON bodies.
- **Guards for other modules:**

  ```python
  from app.modules.auth.dependencies import CurrentAdmin, CurrentCustomer

  @router.get("/orders/{reference}")
  async def get_order(reference: str, customer: CurrentCustomer, db: DbSession) -> OrderRead:
      ...  # still check that the order belongs to `customer` (per-object, T-07)
  ```

  Role guards answer "may this role call this endpoint?". Ownership checks
  ("is this *their* order?") stay in each module's service.
- **CORS** now allows the `X-CSRF-Token` request header for `FRONTEND_URL`.
- **Frontend guards** only decide what to show; the server enforces every
  rule. The customer app admits `customer`, the staff app `admin`. Any other
  signed-in role sees the X4 "wrong app" screen with only "Sign out".
- **CSRF token in the browser** stays in memory in the API client (never in
  storage) and is restored by `GET /auth/me` on every page load.

## 8. Error handling and edge cases

| Situation | Result |
| --- | --- |
| Wrong password, unknown phone, or inactive account | 401 `invalid_credentials`, identical body. An unknown phone still runs one scrypt hash, so timing does not reveal accounts |
| Phone already registered (any format) | 409 `phone_already_registered`. The database unique constraint decides, so concurrent registrations cannot both succeed |
| No cookie, unknown token, revoked, expired, or inactive user | 401 `not_authenticated` |
| Unsafe method without a valid CSRF token | 403 `csrf_failed` (checked before the role) |
| Signed in with the wrong role | 403 `forbidden` |
| Invalid phone, short/long password, blank name, extra fields | 422 `validation_error`. Messages never echo the password or phone |
| `SESSION_SECRET` changes (or is unset in development and the process restarts) | Every existing session becomes invalid and users must sign in again |
| Logged-out cookie replayed | 401: revocation is server-side, not just cookie deletion |
| Too many failed logins for a phone or IP, or registrations from an IP | 429 `too_many_attempts`, `Retry-After` header and `details.retry_after_seconds`. Same answer for registered and unknown phones |
| Change password with a wrong current password | 403 `password_incorrect`; nothing changes; counted as a failed sign-in for the phone |
| Change password while the phone is limited | 429 `too_many_attempts`, even with the right password, which is not checked |
| Change password: new password under 8 or over 128 characters, or an extra field (such as a "new password again") | 422 `validation_error` on that field |

Passwords and session tokens are never logged or returned. Phone numbers are not
logged.

Frontend (exact texts in [the design](../design/authentication.md)):

| Situation | Screen behaviour |
| --- | --- |
| Form fields fail the client check | Inline errors under each field; nothing is sent |
| 401 `invalid_credentials`, 409 `phone_already_registered` | Error banner with the server's text; "Sign in instead" (C2) carries the phone to C3 |
| 429 `too_many_attempts` | Warning banner and "Try again in N minutes" (seconds rounded up to minutes, at least 1); submit is off until the wait ends |
| No connection while submitting | Error banner with Retry; Retry focuses the cleared password field first |
| Any failed attempt | The phone number (and name) are kept, the password is cleared (NFR-012) |
| Submitting | Fields read-only, button spinner, extra taps ignored (NFR-022) |
| Session check cannot reach the server | Splash with the no-connection alert and Retry; the app does not claim the person is signed out |
| Session ends while the app is open (expiry, deactivation, any 401) | The app's sign-in screen with "Your session has ended. Please sign in again." After signing in, people return to the page they were on, with its query string. If a customer had an unsent water request, the banner adds "Your request has not been sent. What you typed is kept." and the form reopens filled in |
| Sign-out: 403 `csrf_failed` | X3 banner with "Reload" in the account panel or staff top bar (Decision 7) |
| Sign-out: 401 | Treated as signed out (the session was already gone) |
| Sign-out: no connection | Error toast "Couldn't sign out…" with "Try again"; the person stays signed in |
| Customer phone not verified | Verify-phone banner on My orders, no close button ([phone-verification.md](phone-verification.md)) |

## 9. Testing

From `backend/` with the virtualenv active:

```bash
pytest tests/test_auth_api.py tests/test_auth_rate_limit.py tests/test_auth_security.py \
  tests/test_phone.py tests/test_config.py
TEST_DATABASE_URL="$(grep '^DATABASE_URL=' ../.env | cut -d= -f2-)" pytest tests/test_auth_integration.py
```

- `test_auth_security.py`: hashing round trip, salting, malformed hashes, older
  parameters, token and CSRF derivation.
- `test_auth_api.py` (no database, session lookup faked): 401/403 paths for each
  role, CSRF missing/wrong/valid, CSRF before role, 422 validation without
  echoing secrets, CORS preflight for `X-CSRF-Token`.
- `test_auth_rate_limit.py` (no database): sliding window, retry-after,
  eviction, attempts counted before they finish (concurrency regression),
  success handling, per-IP limit, 429 from both endpoints, all phone formats
  counted as one.
- `test_auth_integration.py` (real database): register, cookie flags, hashed
  storage, duplicate phone in another format, login in another format,
  indistinguishable failures, logout with CSRF and replay rejection,
  deactivation (FR-002), expiry, staff login with its role, lockout after five
  failures. Test accounts use
  random phones and are deleted afterwards.
- `test_change_password_api.py` (no database): every role, signed out,
  CSRF, `password_incorrect`, wrong passwords using up the sign-in limit
  then 429, the right password not using it up, every validation rule.
- `test_change_password_integration.py` (real database): the change keeps
  this session and its CSRF token, signs out another device, only the new
  password signs in, one `password_changed` audit row with empty metadata;
  a wrong current password changes nothing and keeps the session.
- Migration: `alembic upgrade head`, `alembic downgrade -1`,
  `alembic upgrade head`, `alembic check`.

Frontend (from `frontend/`): `npm test`.

- `src/lib/api/auth.test.ts`: storing, sending and clearing the CSRF token.
- `src/features/auth/logic.test.ts`: phone formats (same cases as the server),
  wait wording (Decision 8), error-to-banner mapping with exact texts, route
  guard decisions for every app and role, form rules, support links.
- `src/features/auth/session.test.ts`: 401 on load means signed out; network
  failure is rethrown; any other 401 re-checks the session, sign-out does not.
- `src/features/auth/screens.test.tsx`: renders each designed state to static
  HTML and checks its content: C1, C2, C3, S1, X1, X2, X4, the verify-phone
  banner, the admin shell's name and Sign out, banners and field
  accessibility attributes.
- `src/features/auth/flows.test.tsx` (jsdom, Testing Library): the real
  routes, guards and session provider with the auth API mocked. Wrong
  password (phone kept, password cleared), phone format checked before
  sending, rate limit (wait text, button off), account creation going to V1
  and "Do this later", "Sign in instead" carrying the phone, wrong app in each
  app, session ended while open (X2), no connection on start with Retry,
  sign-out success, offline failure with Try again, security failure (X3),
  staff redirect to sign-in and back to the page with its filters, and the
  staff sign-out landing (regression for the transition race).

Manual check in a browser: run the backend and `npm run dev`, open
`http://localhost:5173` (customer) and `http://localhost:5173/admin` (staff;
create an admin with `python -m app.modules.auth.cli create-user`).

Manual check:

```bash
curl -i -c /tmp/jar -H 'Content-Type: application/json' \
  -d '{"name":"Sample","phone":"08000000001","password":"long enough"}' \
  http://localhost:8000/api/v1/auth/register
curl -b /tmp/jar http://localhost:8000/api/v1/auth/me
```

## 10. Known limitations

- **Rate limits live in process memory.** A restart clears them, and running
  several uvicorn workers or instances gives each its own counters (move them
  to the database or a shared store before scaling out). Behind a reverse
  proxy, run uvicorn with `--proxy-headers --forwarded-allow-ips=<proxy IP>`,
  or every client shares the proxy's IP and its limit.
- **Lockout can be triggered by others.** Anyone who knows a phone number can
  make five bad attempts and lock that account out for 15 minutes. This is the
  usual tradeoff of per-account limits.
- **No manual phone verification.** Customers verify by SMS code; the
  dispatcher fallback FR-003 allows is not built.
- **No admin user-management API.** Creating, activating and deactivating staff
  is CLI-only, and there is no password reset for a forgotten password.
- **Change password screens are linked** (#57): customer, partner and admin
  use `POST /auth/password`; a wrong current password shows on its field, a
  429 shows the wait, and success says other devices were signed out.
- **No audit log of sign-ins.** NFR-004 does not require it. A password
  change is audited (`password_changed`).
- **Expired and revoked sessions are never deleted.** The table grows slowly; a
  cleanup job can be added when it matters.
- **Absolute session lifetime only.** No idle timeout.
- **Frontend: "session ended" is only detected while the app is open.** A
  person who reopens the app after the session expired sees the normal
  sign-in screen: nothing is kept in storage that could tell the cases apart.
- **Frontend: the typed water request is kept in memory only** (customer
  design Decision 10). The X2 line "Your request has not been sent. What you
  typed is kept." holds while the app stays open; a page reload (including
  "Reload" on the X3 banner) loses the draft.
- **Frontend: support contacts.** The support phone and WhatsApp come from
  `GET /public/contact` (FR-055, [public-contact.md](public-contact.md));
  WhatsApp buttons hide while it is off. The fallback while it cannot be read
  is the official number, +234 813 377 4902 (`frontend/src/lib/whatsapp.ts`).
- **Frontend: the rate-limit countdown re-enabling the button** is not
  exercised by a test (it needs fake timers across a 15-minute wait); the
  wording and the disabled state are.
- **Frontend: Noto Sans is not loaded yet.** The font stack falls back to the
  phone's system font until the self-hosted subset is added.
- **Frontend: driver app screens** (D1 and the driver variants of X1-X5) come
  with S1-15.
