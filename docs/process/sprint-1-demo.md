# Sprint 1 demo script and known gaps

Issue: S1-11 (#12) · Demo: 18 Oct 2026 · Slice: a customer sends a water
request and a dispatcher sees it (S1-10, #11).

Rehearsed on 2026-10-16 against `main` at `b5396f7`, with the real backend
and database, using only the seeded demo accounts. Every step below passed.

## 1. Before the demo (about 10 minutes)

From the repository root, with the PostGIS container running
(`docker compose up -d`; see `LOG.md` if port 5432 is taken):

```bash
cd backend && source .venv/bin/activate
alembic upgrade head
python -m app.modules.demo.seed      # prompts once for the demo password
uvicorn app.main:app --port 8000
```

Run the seed **after** any integration tests: with `TEST_DATABASE_URL`
pointing at this database, `test_demo_seed_integration.py` deletes the demo
accounts (see `LOG.md`).

In a second terminal:

```bash
cd frontend
npm ci
npm run dev                           # http://localhost:5173, real API by default
```

Leave `VITE_ORDERS_SOURCE` unset, so the screens read the real API.
**Fallback:** if the backend cannot run, set `VITE_ORDERS_SOURCE=mock` in
`frontend/.env.local` and restart `npm run dev`. Every screen then shows a
"Sample data" notice, and requests vanish on reload. Say so to the audience.

Demo accounts (created by the seed; all fictional, all marked as demo):

| Role | Name | Phone | Seeded orders |
| --- | --- | --- | --- |
| Staff (admin) | Demo Dispatcher | 0800 009 0001 | none |
| Driver | Demo Driver | 0800 009 0002 | none |
| Customer | Demo Customer One | 0800 009 0011 | 200 L, 50 L |
| Customer | Demo Customer Two | 0800 009 0012 | 500 L, 25 L |

The password is the one typed into the seed command. Share it in person, not
in chat or this file.

Use two browser windows: a normal one for the customer, and a private one for
staff, so the two sessions do not sign each other out.

## 2. Demo script

| # | Who | Do | Point out |
| --- | --- | --- | --- |
| 1 | Customer | Open `http://localhost:5173` | Welcome screen. Customers create their own accounts; staff and drivers are given accounts |
| 2 | Customer | Sign in with 0800 009 0011 | My orders lists the two seeded requests, newest first. The banner: the phone is confirmed by staff by hand, never "verified by SMS" (FR-003) |
| 3 | Customer | Request water | Receiver prefilled from the account and editable. The price box says the price comes later: **no prices in Sprint 1** (FR-021, FR-022) |
| 4 | Customer | Choose 300 litres, enter an address and a landmark, Send request | Request received with a copyable reference. It says **"not a confirmed delivery yet"**, never "confirmed" (FR-027) |
| 5 | Customer | View my orders | The new request is at the top |
| 6 | Customer | (Optional) Press Send twice quickly on a new request | Only one order is created: the idempotency key (FR-026, T-06) |
| 7 | Staff | In the private window, open `http://localhost:5173/admin/orders` | Redirects to staff sign-in. Sign in with 0800 009 0001; it returns to the order list |
| 8 | Staff | Look at the list | The customer's new request is the top row. It and the seeded orders carry the **Simulated** tag, because they come from demo accounts (BR-09). Status "Request received", customer, "Phone not confirmed", Lagos times |
| 9 | Staff | Filter: Status, then Records "Simulated only" | Filters live in the address; Back keeps them |
| 10 | Staff | Open the new order | Request, Delivery (receiver) and Customer account shown separately; "No price yet - this is a quote request." |
| 11 | Customer | Try opening the staff app (`/admin/orders`) | "You do not have access to this page." The server refuses too (403, FR-001) |
| 12 | Driver | Sign in on the customer app with 0800 009 0002 | "This account is for MmiriOma staff…": driver screens come in Sprint 2 |

Things **not** to promise during the demo: prices, delivery windows, drivers
accepting jobs, live tracking, payments, or that water is safe to drink. None
of these exist, and the honesty rules forbid suggesting them.

## 3. Known gaps

### Resolved before the demo

- **Orders created live by a demo customer were not marked Simulated.** Found
  in the rehearsal and fixed in #43: an order placed by a demo account
  (reserved phone block and "Demo" name) is now stored as simulated, so a
  live demo never adds real orders (BR-09). Rechecked in the browser.

### Not built yet, by plan

| Gap | Where it is planned |
| --- | --- |
| Driver screens and the delivery workflow (state machine, assignment, accept/decline) | Sprint 2 (#7, #8, #19) |
| Prices and quotes, delivery windows, order confirmation, cancellation, status history | Later issues; contract "Planned" section ([orders.md](../api/orders.md)) |
| Staff confirming a customer's phone (FR-003) | Later issue; needs the written procedure |
| Reports that exclude simulated data (FR-052, T-13) | Later |
| A command to remove demo data | Not planned yet ([demo-data.md](../features/demo-data.md)) |

### Open business decisions (S1-12, #13)

- Real support phone and WhatsApp numbers ("Contact us" is text only).
- Approved preset quantities (25-500 L are sample values, FR-021).
- The written manual phone-confirmation procedure.
- Payment method and cash handling (SRS §12.5).
- Proof of delivery method (SRS §12.7).
- Water category names and supported uses (PRD §13.2).
- Whether customers may cancel, and until which status.

### Technical limitations

- **Rate limits** live in process memory: a restart clears them, and several
  server processes would each count separately.
- **No admin user-management API:** staff and driver accounts come from the
  command line.
- **Session ended** is detected only while the app is open, and the typed
  request is lost on a page reload (customer design Decision 10).
- **Frontend bundle:** about 522 kB (160 kB gzipped), over Vite's 500 kB
  warning; code splitting is a separate change.
- **Font:** Noto Sans is not loaded yet (system font fallback).
- **Admin layout:** the status filter is toggles, not the multi-select panel;
  the table is tight at about 768-850 px.
- **Browser checks:** the customer screens still need a visual pass at 360 and
  768 px.

Details and the rest: section 10 of each feature document in
[docs/features/](../features/).

## 4. Checks at rehearsal time

- `bash .claude/skills/mmirioma-engineering/scripts/check.sh`: all pass
  (backend 175, frontend 200 tests).
- Backend with a test database (`TEST_DATABASE_URL` set): 206 passed.
- `alembic downgrade -1`, `alembic upgrade head`, `alembic check`: clean.
- Seed command run twice: 4 accounts and 4 simulated orders, then nothing new.
