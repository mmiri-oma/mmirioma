# Phone verification and phone change

Requirements: FR-003, FR-004, FR-055 (SMS template), NFR-002, NFR-003, NFR-004 ·
Acceptance tests: T-15, T-16 · Contract:
[docs/api/auth.md](../api/auth.md#phone-verification-fr-003-fr-004)
(agreed) · Design: [phone-verification.md](../design/phone-verification.md)
(the fork's placement of the main repo design approved 2026-10-19; approved
for the fork 2026-10-26, #6)

## 1. Overview and purpose

A customer's Nigerian mobile number is their identity on MmiriOma. SRS v0.2
requires them to prove they own it with a 6-digit SMS code before their first
order (FR-003), and to prove a new number the same way before it replaces the
old one (FR-004). This feature sends and checks those codes, enforces the
limits that stop abuse, and blocks orders from unverified customers.

The customer screens follow the approved design: V1 Send a code, V2 Enter
the code, V3 Verified (`/verify-phone`) and P1 New number, P2 Enter the code
for the new number, P3 Number changed (`/profile/phone`), reached from Create
account, the Home banner, the order Review screen and My profile. The backend
part below was copied from the main repo (PR #4); the frontend part is the
fork's (#6).

## 2. Feature workflow

```
Verify the account's phone (FR-003)
  POST /auth/phone-verification ─> lock number ─> 60 s / 3 per hour checks
     ─> void older codes ─> store HMAC of new code ─> SMS (Termii | mock)
     ─> commit, 202 {phone, expires_at, resend_available_at}
        (SMS failure: roll back, 503 sms_unavailable)
  POST /auth/phone-verification/verify {code}
     ─> newest usable code (row locked) ─> expired? 400 verification_code_expired
     ─> wrong? attempts+1 (5th voids it), 400 verification_code_invalid
     ─> right: consumed_at, users.phone_verified_at = now, 200 User

Place an order
  POST /orders ─> phone_verified_at null? 403 phone_not_verified ─> create order

Change phone (FR-004)
  POST /auth/phone-change {phone, password}
     ─> password check (sign-in failure limits) ─> number free and different?
     ─> same sending steps as above, code goes to the NEW number
  POST /auth/phone-change/verify {code}
     ─> same checks ─> users.phone = new number, phone_verified_at = now,
        replaced_phone = old number on the verification row
```

Customer app:

```
Create account ─> /verify-phone (V1)        My orders / Request water banner ─> V1
V1 Send code ─> 202 ─> V2 (code field focused, countdown from the response)
V2 Verify ─> 200 ─> session updated (phone_verified) ─> V3 ─> Continue
   ─> back to My orders, or Request water with the typed draft (memory only)
Account menu "Change phone number" ─> /change-phone (P1: number + password)
P1 ─> 202 ─> P2 ─> 200 ─> session updated (new phone) ─> P3 ─> Done
```

## 3. Important files

| File | Responsibility |
| --- | --- |
| `backend/app/modules/auth/phone_verification.py` | Code generation and hashing, sending limits, `send_code`, `verify_code`, SMS text |
| `backend/app/modules/auth/models.py` | `PhoneVerification`, `VerificationPurpose`, `MAX_CODE_ATTEMPTS`; `User.phone_verified_at` |
| `backend/app/modules/auth/router.py` | The four `/auth/phone-*` endpoints |
| `backend/app/modules/auth/schemas.py` | `PhoneCodeSentRead`, `VerifyCodeRequest`, `PhoneChangeRequest` |
| `backend/app/modules/auth/rate_limit.py` | Per-IP limits for code requests and checks |
| `backend/app/modules/auth/service.py` | `check_password` (re-authentication for phone change), `set_phone_verified` (server tools only) |
| `backend/app/modules/messaging/sms.py` | `SmsProvider`, `MockSmsProvider`, `TermiiSmsProvider`, `get_sms_provider` |
| `backend/app/modules/orders/service.py` | `ensure_customer_can_order` (403 `phone_not_verified`) |
| `backend/app/modules/demo/seed.py` | Marks demo customers verified |
| `backend/app/core/config.py` | `SMS_PROVIDER`, `TERMII_*`, `SMS_TIMEOUT_SECONDS`, `SUPPORT_PHONE` |
| `backend/app/shared/phone.py` | `format_phone_for_display` for the support number in SMS |
| `backend/alembic/versions/20261017_0004_add_phone_verifications.py` | Migration `0004` |
| `frontend/src/lib/api/phoneVerification.ts` | Typed `requestPhoneVerification`, `verifyPhone`, `requestPhoneChange`, `verifyPhoneChange` |
| `frontend/src/features/auth/authApi.ts` | The same four functions for screens: real API, or the mock in mock mode |
| `frontend/src/features/auth/useSession.ts` | Mutations; a verified or changed user replaces the session's user |
| `frontend/src/features/auth/PhoneCodeParts.tsx` | `CodeStep` (V2 and P2: code field, tries left, resend countdown, slow-SMS hint), `SuccessStep`, `PhoneDisplay`, `ProblemNotice` |
| `frontend/src/features/auth/phoneCode.ts` | `cleanCode`, `resendWaitMs` (countdown from server times), `waitText` |
| `frontend/src/features/customer/pages/VerifyPhone.tsx` | `/verify-phone`: V1, V2, V3; "Do this later" after Create account |
| `frontend/src/features/customer/pages/ChangePhone.tsx` | `/profile/phone`: P1, P2, P3 |
| `frontend/src/features/customer/components/VerifyPhoneBanner.tsx` | Banner on Home and Review while unverified |
| `frontend/src/features/customer/pages/order/Review.tsx` | Send buttons off while unverified; 403 `phone_not_verified` keeps the details |
| `frontend/src/features/customer/pages/Profile.tsx` | Phone with "Verified" / "Not verified yet", "Verify", "Change phone number" |
| `frontend/src/mocks/phoneVerificationMock.ts` | Mock of the four endpoints (code printed to the browser console) |

## 4. Database models and relationships

Migration `0004` (revises `0003`).

`phone_verifications` (many per user, `ON DELETE CASCADE`)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | Part of the code hash |
| `user_id` | UUID FK → `users.id`, indexed | Account that asked |
| `phone` | varchar(16) | Number the code went to (the new number for a change) |
| `purpose` | varchar(20), CHECK | `account_phone` or `phone_change` |
| `code_hash` | varchar(64) | HMAC-SHA256(`SESSION_SECRET`, `phone-code:<id>:<code>`) |
| `expires_at` | timestamptz | Sending time + 5 minutes |
| `attempts` | int, CHECK 0-5 | Wrong codes entered |
| `consumed_at` | timestamptz, nullable | Right code entered |
| `invalidated_at` | timestamptz, nullable | Replaced by a newer code, or 5 wrong attempts |
| `replaced_phone` | varchar(16), nullable | Old number, for a completed change |
| `created_at`, `updated_at` | timestamptz | `created_at` is the sending time (set by the app's clock) |

Index `ix_phone_verifications_phone_created_at` serves the per-phone limits.
`users.phone_verified_at` (from `0002`) is now set by `verify_code`.

## 5. API endpoints

All under `/api/v1`, customer role, session cookie and `X-CSRF-Token`.
Full request, response and error rules are in the
[contract](../api/auth.md#phone-verification-fr-003-fr-004).

| Method | Path | Success | Main errors |
| --- | --- | --- | --- |
| POST | `/auth/phone-verification` | 202 `{phone, expires_at, resend_available_at}` | 409 `phone_already_verified`, 429 `too_many_attempts`, 503 `sms_unavailable` |
| POST | `/auth/phone-verification/verify` | 200 user | 400 `verification_code_invalid` (`attempts_remaining`), 400 `verification_code_expired` |
| POST | `/auth/phone-change` | 202, code sent to the new number | 403 `password_incorrect`, 409 `phone_unchanged` / `phone_already_registered`, 429, 503 |
| POST | `/auth/phone-change/verify` | 200 user with the new phone | 400 as above, 409 `phone_already_registered` |
| GET | `/auth/phone-verification/status`, `/auth/phone-change/status` | 200 `{delivery_status, expires_at, resend_available_at}` | 400 `verification_code_expired` |

`delivery_status` is `accepted` (the SMS provider took it; not proof it
arrived), `delivered` or `failed` (the carrier reported it did not arrive).
The send responses carry `delivery_status: "accepted"`.

`POST /orders` returns 403 `phone_not_verified` for an unverified customer.

## 6. Business rules

- **Accepted is not delivered** (2026-10-31): the provider accepting the SMS
  is stored as `phone_verifications.sms_status = accepted`. The delivery report
  (Termii `GET /api/sms/inbox?message_id=`) moves it to `delivered` or
  `failed`; an unreadable report leaves it `accepted`. On `failed` the app says
  the code did not reach the phone and offers a resend. Cooldown, hourly limit,
  expiry and attempt limit are unchanged.
- Columns added by migration `0023`: `sms_message_id`, `sms_status`,
  `sms_status_checked_at`.

From SRS v0.2 FR-003 and FR-004:

- **Code:** 6 digits from `secrets.randbelow`; valid **5 minutes**; at most
  **5** attempts (the database also enforces 0-5); single use.
- **Only the newest code works.** Sending a code voids earlier unused codes
  for the same account and purpose.
- **Per-phone limits:** one code per **60 seconds**, **3** per rolling hour.
  They are counted from `phone_verifications`, so they survive restarts and
  apply across workers. `pg_advisory_xact_lock` on the number serializes
  concurrent requests, so two cannot both pass the check. Codes that failed to
  send are rolled back and do not count.
- **Per-IP limits** (engineering choice; the SRS asks for IP limits without
  numbers): 10 code requests per hour, 30 code checks per 15 minutes,
  in-memory like the sign-in limits.
- **Hashing:** a code has only a million values, so a plain hash would be
  reversible. The HMAC is keyed with `SESSION_SECRET` and bound to the row ID.
- **First order needs a verified phone.** Checked on every order, which is
  equivalent: verification is permanent, and a phone change verifies the new
  number before it takes effect.
- **Phone change** needs the current password (the phone is the sign-in
  identifier; a stolen session alone must not move the account). The account
  keeps its old number until the code to the new number is verified; the
  unique constraint on `users.phone` settles races for the same number.
- **SMS text** (FR-050, FR-055): "Your MmiriOma code is 123456. It expires in
  5 minutes. Never share this code. Help: +234 813 377 4902" (one SMS, under
  160 characters; the support number comes from `SUPPORT_PHONE`).
- **No false claims.** The mock provider sends nothing, so production refuses
  to start with it. If Termii fails, nothing is stored and the API says the
  code could not be sent.

## 7. Authentication and authorization requirements

- All four endpoints require a signed-in **customer** (`CurrentCustomer`);
  admins and drivers get 403 `forbidden`. CSRF is required.
- A customer can only verify or change **their own** number: the account is
  taken from the session, never from the request.
- Demo customers are marked verified by the seed (`set_phone_verified`),
  because their fictional numbers cannot receive SMS. They remain identifiable
  as demo data (reserved phone block and "Demo" name).

## 8. Error handling and edge cases

| Case | Result |
| --- | --- |
| Code requested again within 60 s | 429 `too_many_attempts`, `Retry-After` = seconds left |
| Fourth code within an hour | 429, wait until the oldest of the three is an hour old |
| SMS provider down, timeout or rejects the message | 503 `sms_unavailable`; nothing stored; earlier code still valid |
| Wrong code | 400 `verification_code_invalid`, `attempts_remaining` 4…0; at 0 the code is void |
| Expired, replaced, used, voided or never requested | 400 `verification_code_expired` |
| Concurrent guesses | The code row is locked (`SELECT … FOR UPDATE`), so the attempt count is exact |
| Phone already verified | 409 `phone_already_verified` |
| New number equals the current one | 409 `phone_unchanged` |
| New number belongs to another account | 409 `phone_already_registered` (on request and, if taken meanwhile, on verify) |
| Wrong password on phone change | 403 `password_incorrect`; counts against the sign-in failure limits |
| Code with letters, wrong length | 422 `validation_error`, `loc` `["body", "code"]` |
| Logs | Termii: masked phone and message ID only, never text or key. Mock: masked phone and text (development only) |
| UI: phone clock wrong | The resend countdown compares the two server times in the response (`resend_available_at` and `expires_at` − 5 min), so it does not depend on the phone's clock |
| UI: pasted "123 456" | Digits are kept and capped at 6; the field has no `maxlength` |
| UI: Send request while unverified | Banner and Send request off; typing still works. A 403 `phone_not_verified` shows the server text with "Verify phone" and refreshes the session |
| UI: session ends during V2/P2 | The global 401 handling shows X2; a half-typed code is not kept |

## 9. Testing

```bash
cd backend && source .venv/bin/activate
ruff check . && ruff format --check . && pytest
# With the database (use a separate test database, LOG.md 2026-10-16):
TEST_DATABASE_URL=postgresql+asyncpg://mmirioma:<password>@localhost:5432/mmirioma_test pytest
```

- `tests/test_phone_verification.py`: endpoints with a faked service (customer
  only, CSRF, code format and trimming, per-IP limits, password check and its
  rate limit), code generation, hashing, SMS text, timing constants.
- `tests/test_sms.py`: mock provider; Termii payload, failures (HTTP error,
  non-`ok` body, non-JSON, network error) without leaking the key or code;
  provider selection.
- `tests/test_phone_verification_integration.py` (database): T-16 verify then
  order, 60-second cooldown, SMS failure stores nothing, phone change end to
  end (old number kept until verified, `replaced_phone`, sign in with the new
  number), taken number, 3 per hour with exact `retry_after`, 5-minute expiry,
  5 attempts, newest code only and single use, codes stored hashed (T-15).
- `tests/test_orders_api.py`: T-16 403 `phone_not_verified`.
- `tests/test_config.py`: production refuses `SMS_PROVIDER=mock`; Termii needs
  key and sender ID; https base URL; `SUPPORT_PHONE` format.
- `tests/test_demo_seed_integration.py`: demo customers verified, also when
  seeded earlier.

Frontend (`cd frontend && npm test`):

- `src/lib/api/phoneVerification.test.ts`: each endpoint with a mocked
  `fetch`: success and its error codes (429 with the wait, 503, wrong code
  with tries left, wrong password, number taken).
- `src/features/auth/phoneCode.test.ts`: pasted codes, countdown from server
  times only, wait wording.
- `src/mocks/phoneVerificationMock.test.ts`: the mock keeps the contract's
  limits (60 s, 5 tries, one use, already verified, number kept until the
  change is verified).
- `src/features/customer/pages/VerifyPhone.test.tsx` (jsdom, mock mode): "Do
  this later" after sign-up; wrong code with tries left, then verified and
  back to Review; paste; incomplete code; no tries left; wait after too many
  codes; already verified; P1 wrong password; full change with the old number
  kept until verified.

Manual check in development: request a code, then read it in the backend
console line `MOCK SMS (not sent) to +234800****001: Your MmiriOma code is …`.

End-to-end check, 2026-10-19 (backend on `mmirioma_test`, mock SMS, over
HTTP): a new customer's `POST /orders` was refused with 403
`phone_not_verified`; `POST /auth/phone-verification` returned 202 with
`resend_available_at` 60 s after the sending moment (`expires_at` − 5 min),
which is what the screens' countdown uses; the code from the development log
verified the phone (`phone_verified: true`); the same order (300 local
gallons) was then accepted as 1,200 litres in `quote_requested`. The test
account was deleted afterwards. The screens themselves were checked with the
API mocked (above), not in a browser against this server.

## 10. Known limitations

- **Not tested end to end with a real phone.** The screens are tested with
  the API mocked and the backend with the mock SMS provider; the full path
  with Termii delivering a real SMS has not been run.
- **The P1 password stays in memory while P2 is open**, because "Send a new
  code" for a new number must send it again. It is never stored and is
  dropped when the screen closes.
- **A reload during V2 or P2** loses the step; the customer starts again at
  V1 or P1 (the 60-second and hourly limits still apply).
- **No manual fallback.** FR-003 allows dispatcher-controlled verification
  when SMS is unavailable; it needs the written procedure and an admin
  endpoint.
- **Termii setup needed:** API key, registered sender ID, the account's base
  URL, and activation of the `dnd` route by Termii (the `generic` route does
  not reach Do-Not-Disturb numbers). Not tested against the live Termii API.
- **Per-IP limits are per process**, like the sign-in limits; the per-phone
  limits are in the database.
- **The SMS is sent inside the database transaction** that holds the
  per-phone lock, so a slow provider (up to `SMS_TIMEOUT_SECONDS`) holds one
  connection. Acceptable for the pilot.
- **No retention rule** for old `phone_verifications` rows (they contain
  phone numbers). Covered by the open NFR-005 retention decision.
- Staff and driver phones are not verified by SMS; they are created by the
  technical lead.
