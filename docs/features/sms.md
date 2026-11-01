# SMS (Termii) and the live SMS test

## 1. Overview and purpose

Customers receive SMS for phone verification (FR-003) and the P0
notifications of SRS v0.2 FR-050: order confirmed, order dispatched, the
delivery code (FR-035), payment acknowledgment (FR-041) and
cancellation/refund outcomes (FR-043, FR-044). Every message goes through one
provider adapter: a mock in development and test, Termii in production.

Before the pilot, each P0 message must be proven on the team's real phones
from a non-production run (#102, Phase 2 step 8). The command
`app.modules.messaging.live_test` sends every built template, with sample
values, to one team phone, and the results go in the pilot plan's
SMS live test record.

## 2. Feature workflow

Sending in the app:

```
feature service (auth, confirmation, deliveries, payments)
  builds the text with its *_message() function    (support number included, FR-055)
  sms.send(phone, text)                            app/modules/messaging/sms.py
    mock:   keeps it in memory, logs it masked on this machine, sends nothing
    termii: POST {TERMII_BASE_URL}/api/sms/send    "code": "ok" = accepted
  on SmsDeliveryError: the feature records "not accepted" or tells the user;
  the order never changes because of it (FR-050)
```

Live test (on a developer machine, never production):

```
python -m app.modules.messaging.live_test --to <team phone>          # preview
python -m app.modules.messaging.live_test --to <team phone> --send   # Termii
  -> one line per message: time (WAT), key, accepted / NOT accepted
  -> the phone's holder records what arrived in the pilot plan
```

## 3. Important files and their responsibilities

| File | Responsibility |
| --- | --- |
| `backend/app/modules/messaging/sms.py` | `SmsProvider`, `MockSmsProvider`, `TermiiSmsProvider`, `mask_phone`, `get_sms_provider` |
| `backend/app/modules/messaging/live_test.py` | Live SMS test command: preview or send every P0 template |
| `backend/app/core/config.py` | `SMS_PROVIDER`, `TERMII_*`, `SMS_TIMEOUT_SECONDS`; production refuses `mock` |
| `backend/app/modules/auth/phone_verification.py` | `code_message`: verification code |
| `backend/app/modules/confirmation/service.py` | `confirmation_message`: order confirmed |
| `backend/app/modules/deliveries/service.py` | `dispatched_message`: order dispatched |
| `backend/app/modules/deliveries/codes.py` | `code_message`: delivery code |
| `backend/app/modules/payments/service.py` | `payment_message`: cash received, with any outstanding amount |

## 4. Database models and relationships

The adapter stores nothing. Features record whether their message was
accepted:

| Message | Where the outcome is stored |
| --- | --- |
| Verification code | Not stored: on failure the code is rolled back and the API returns 503 |
| Order confirmed | `orders.confirmation_sms_status`, `orders.confirmation_sms_attempted_at` |
| Dispatched | Not stored; a failure is logged with the order reference |
| Delivery code | `delivery_codes.sms_status` (`accepted` or `failed`) |
| Payment received | `cash_collections.payment_sms_status`, `payment_sms_attempted_at` |

The live test command reads and writes no database.

## 5. API endpoints and request/response behavior

None for the live test (command line only). The messages are sent by the
endpoints of their features; see
[phone-verification.md](phone-verification.md),
[order-confirmation.md](order-confirmation.md),
[driver-jobs.md](driver-jobs.md) and [cash-remittance.md](cash-remittance.md).

Command options:

| Option | Meaning |
| --- | --- |
| `--to` | Required. The team phone, any Nigerian mobile form (`0803...`, `+234803...`) |
| `--send` | Send with Termii. Without it, the texts are printed and nothing is sent |
| `--only` | Comma-separated keys: `verification_code`, `order_confirmed`, `dispatched`, `delivery_code`, `payment_received`, `payment_part_paid` |

Exit code 0 when everything selected was previewed or accepted, 1 on an
error or if any message was not accepted.

## 6. Important business rules

- **Mock never in production** (SRS §2): with `APP_ENV=production` the app
  refuses to start unless `SMS_PROVIDER=termii`, so no customer is told a
  code was sent when it was not.
- **A channel failure never changes an order** and is never shown as sent
  (FR-050). Each feature's handling is in section 4.
- **No unverified promises** (FR-050): no arrival time, no water-quality
  claim. The confirmed window is the one the dispatcher set; "dispatched"
  says only that the driver started the delivery.
- **Support number in every template** (FR-055), from `SUPPORT_PHONE`.
- **One GSM-7 SMS where possible:** amounts use "N", not "₦" (which would
  force a costlier Unicode SMS). The sample texts are 86 to 153 characters.
  A confirmation whose window crosses midnight names both dates and can
  exceed 160 characters, which Termii sends as two parts.
- **Live test values are samples**, labelled as such: reference
  `MO-SAMPLE0001`, code `123456`, total N45,000.00 (part payment N30,000.00).
  They are not real orders or valid codes.

## 7. Authentication and authorization requirements

- The Termii API key and sender ID are environment secrets (NFR-003,
  NFR-030): the local `.env` for the live test, the server's `deploy/.env`
  in production. Never in the repository, the log, issues or chat.
- The live test runs only outside production and needs shell access to a
  machine with the key; there is no endpoint for it.
- Logs never contain message text from Termii sends or the API key; phone
  numbers are masked (`+234803****567`).

## 8. Error handling and edge cases

- `--send` with `SMS_PROVIDER=mock`: refused ("SMS_PROVIDER is mock, which
  sends nothing"), because nothing would reach the phone.
- `APP_ENV=production`: refused.
- A message Termii does not accept is reported as `NOT accepted: <reason>`
  (network error, HTTP status, or a body without `"code": "ok"`). The other
  messages are still sent.
- "Accepted by Termii" is not proof of receipt: DND filtering, an
  unregistered sender ID or a network problem can still stop it. Only the
  phone's holder can record "received".
- `--only cancellation_outcome`: refused; that SMS is not built and is sent
  manually under fallback F10 (section 10).

## 9. Testing instructions

```bash
cd backend
pytest tests/test_sms_live_test.py tests/test_sms.py tests/test_config.py
```

- `tests/test_sms_live_test.py`: every built P0 message covered, one SMS
  each with the support number, preview sends nothing, `--send` sends every
  text to the normalized number, failures reported, mock and production
  refused, unknown and unbuilt keys rejected.
- `tests/test_sms.py`: the Termii request and response handling.
- `tests/test_config.py`: production refuses `SMS_PROVIDER=mock`.

Live test on real phones:

1. In your local `.env` (never committed): `SMS_PROVIDER=termii`,
   `TERMII_API_KEY`, `TERMII_SENDER_ID`, `TERMII_CHANNEL=dnd`, and the
   account's `TERMII_BASE_URL`. Keep `APP_ENV` as `development`. The test
   suite still uses the mock provider: `tests/conftest.py` sets
   `SMS_PROVIDER=mock`, which takes precedence over `.env`.
2. Preview: `python -m app.modules.messaging.live_test --to <team phone>`.
3. Send: add `--send`. Copy the result lines.
4. The phone's holder fills the
   SMS live test record:
   who, when, received or not, and any difference from the preview.
5. Repeat on a phone on the Do-Not-Disturb list, which only the `dnd` route
   reaches.

## Delivery to every network (Airtel and Glo not receiving codes)

**Symptom (production, 2026-10-31):** MTN customers receive the verification
code, Airtel and Glo customers do not, although the app showed the code as
sent.

**What the code change established.**

- The app only ever knew "Termii accepted the request" (`"code": "ok"`). That
  does not mean the handset got the SMS, so a message dropped by a carrier or
  the Do-Not-Disturb filter looked like a success. This was the app's own
  defect and is fixed (see below).
- Numbers were already normalized to `+234` plus ten digits and sent to Termii
  as `234XXXXXXXXXX`, whether typed as `080...`, `+234...` or `234...`. A kept
  trunk zero (`+2340803...`) is now handled too. Number format is not the cause.
- The app sends every verification code with `TERMII_CHANNEL` (default `dnd`)
  and `TERMII_SENDER_ID`. Which network drops a message is decided by Termii's
  routing and the carriers, per account. **This cannot be seen from the code or
  proven without the Termii account**, so the cause below is a shortlist to
  check, not a finding.

**Check these in the Termii dashboard / with Termii support, in this order.**

1. **Channel in production.** `TERMII_CHANNEL` must be `dnd`. Termii documents
   `generic` as a promotional route that does not reach DND numbers and is not
   for OTPs; if production was set to `generic`, MTN can still deliver while
   other networks refuse.
2. **DND route activation.** Termii: the `dnd` channel "requires activation on
   your account, which you request from support". Ask support to confirm it is
   active for **Airtel and Glo** destinations, not only MTN.
3. **Sender ID.** Ask Termii (or `GET /api/sender-id`) to confirm
   `TERMII_SENDER_ID` has status `active` and is approved on **every** network.
   A pending or network-limited Sender ID is a common reason one network drops
   messages. A new Sender ID is requested in the Termii dashboard or with
   `POST /api/sender-id/request` (needs Termii's approval; no workaround in
   code).
4. **Delivery reports.** For a failed Airtel or Glo message, Termii's report
   shows why (`DND Active on Phone Number`, `Rejected`, `Message Failed`,
   `Expired`). Read it with the live test:
   `python -m app.modules.messaging.live_test --to <airtel or glo phone> --send --only verification_code --check-delivery 30`.
   Send the same to an MTN phone and compare.

**Do not** switch channels or routes to "try something": `generic` is not for
OTPs, `whatsapp` and `voice` need their own Termii approval and, for WhatsApp,
approved templates. If Termii must enable a route or approve a Sender ID, ask
them; the app needs no code change for that.

**What changed in the app.**

- `SmsProvider.send` returns the provider's message id, and
  `delivery_status(message_id)` reads Termii's report. Only an explicit
  `Delivered` counts as delivered; unknown or unreadable reports stay
  `accepted`.
- `phone_verifications` stores `sms_message_id`, `sms_status`
  (`accepted`/`delivered`/`failed`) and `sms_status_checked_at` (migration
  `0023`). The status endpoints (`GET /auth/phone-verification/status`,
  `/auth/phone-change/status`) refresh it from the provider.
- The code screen polls every 5 seconds. On `failed` it says "The code did not
  reach your phone" and the customer can send a new code when the 60-second
  cooldown ends. Expiry (5 min), attempts (5), cooldown (60 s) and 3 per hour
  are unchanged.
- A refusal at send time is classified (`invalid_number`, `sender_id`,
  `route_not_enabled`, `insufficient_balance`, `account_inactive`,
  `rate_limited`, `provider_unavailable`, `rejected`) and logged as
  `reason=...` with no phone number, code or key. The customer still gets the
  same 503 `sms_unavailable` message.

## 10. Known limitations

- The cancellation and refund outcome SMS (FR-043, FR-044) is not built.
  For the pilot an administrator sends the outcome manually (pilot plan
  fallback F10, agreed 2026-10-23); the live test lists it as not available.
- The dispatched SMS outcome is only logged, not stored, so staff cannot see
  in the app whether it was accepted.
- Delivery reports are read on demand (verification codes, and the live test
  with `--check-delivery`). The other P0 messages (confirmation, dispatch,
  delivery code, payment) still record only "accepted".
- Termii's history endpoint documents `Delivered` and `Failed` and the webhook
  lists more statuses; the app maps the documented words only. A report can
  lag by minutes, so `accepted` for a while is normal.
- The live test sends sample texts directly; it does not exercise each
  feature's flow end to end. The flows' sending is covered by their tests
  with the mock provider.
