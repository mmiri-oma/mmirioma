# Design handoff v1 (fork: new design frontend)

Fork: `chidimmamogbo/mmirioma` (now `mmiri-oma/mmirioma`), branch `feat/new-design-frontend` (upstream
`mmiri-oma/mmirioma`, now archived as `mmiri-oma/mmirioma-original`). Status: approved by @chidimmamogbo for this fork on
2026-10-16.

This fork builds a second frontend from the design handoff
(`design/MmiriOma-design-handoff/`, version 1.0, 15 Oct 2026) to compare it
with the design the team is building in the main repo. **In this fork it
replaces [design-system.md](design-system.md)** (Noto Sans, `#0B6786`, 48 px
targets) and the authentication design. Those files are left unchanged so
upstream merges stay clean.

The handoff pack is kept locally and git-ignored (`design/`). It is the
visual source of truth: `screens-png/` for looks, `screens-html/` for exact
sizes and structure, `tokens/` for values.

## Process gates

The repository owner waived the G2/G3 gates (CLAUDE.md "UI-driven workflow")
for frontend work in this fork. Screens without an agreed API contract run on
typed mocks in `frontend/src/mocks/` and are switched to the real API when a
contract exists. Contracts in `docs/api/` are not changed by this fork.

## Screens

57 designed screens: customer 22 (`c-*`), Keke rider 17 (`r-*`), tanker
driver 10 (`t-*`), admin 8 (`a-*`). See the handoff `README.md` for the index.
Screens added from existing patterns (not in the handoff) are listed under
[Added screens](#added-screens).

## Decisions (2026-10-16)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Handoff files | Keep `design/` untracked; added to `.gitignore` |
| 3 | Gates | CLAUDE.md design/contract gates do not block frontend work in this fork |
| 6 | Sign in and sign up | Phone number and password only, as in [auth.md](../api/auth.md). Google sign-in and the sign-up email field are removed. Customers and drivers can add an **optional email** later in their account settings, for updates, newsletters and promo alerts |
| 7 | Verify phone (`c-verify`) | **Superseded** (2026-10-26) by [phone-verification.md](phone-verification.md): SRS v0.2 FR-003 requires an SMS code before the first order. Was: not used, sign-up straight to home, manual verification by admin |
| 8 | Admin login | No design; built from the rider login pattern |
| 9 | Drivers | One `driver` role. Drivers choose a vehicle type (Keke or Tanker) when they sign up; available orders are grouped by vehicle type |
| 10 | Prices | All naira amounts are SAMPLE. Water price is per jerrycan (Keke) or per tank size (Tanker). The final price adds a delivery fee once the address is known, based on distance from the refill source to the customer, configured by admin. The **Tanker** quantity screen also asks for the **water source**: "Ninth Mile water" or "Any Bore hole water". **Changed 2026-10-16: Keke orders do not ask for a source**; jerrycans have one price per size |
| 11 | Tanker sizes | Shown in gallons as designed (500, 750, 1,000, custom), with the litre value shown after a size is chosen |
| 12 | Status labels | Use the design labels; switch to contract labels only where needed for honesty (e.g. an order is not "confirmed" before the dispatcher confirms it) |
| 13 | Dispatch | Admin can assign orders, and drivers can also pick from available orders. A driver can decline an assigned order only with a valid reason |
| 14 | Live map and ETA | Built as drawn on mock data. ETA and "min away" text appear only when real data backs them |
| 15 | Quality claims | Water-quality claims are replaced (e.g. "clean water", "cans are clean and sealed"); there are no sealed cans yet |
| 16 | Points, wallet, payouts, rider pay | Built as SAMPLE mocks; may be kept or removed later |
| 17 | Admin navigation | The full dashboard sidebar on every admin page, and every item has a working page |
| 18 | Tanker menu | Reuses the rider history, papers, notifications and support screens with tanker content |
| 19 | Links | No dead links: every control leads somewhere, even if the feature is not in the design |
| 20 | Motion | Transform/opacity only; `glow`, `blink` and `shine` reworked; SVG `route` and `donut` stroke animations kept (see [frontend.md](../architecture/frontend.md#motion)) |
| 21 | Gold | `#F2B33D` from `mo.css` (not `#E6BA54` from `tokens.json`) |
| 22 | Touch targets | Controls drawn under 44 px keep their look and get an invisible 44 × 44 hit area (`hit-44`) |
| 23 | Font | Plus Jakarta Sans from Google Fonts, with a self-hosted offline fallback |
| 25 | Layout | Responsive on phone, tablet and desktop |
| 27 | Visual comparison | Chrome (Claude in Chrome), no new dev dependency |
| 28 | Mocks | `VITE_USE_MOCKS` switches typed API functions between mocks and `client.ts` |

## Added screens

Built from existing patterns because a decision above needs them. Updated as
they are added.

| Screen | Why | Pattern from |
| --- | --- | --- |
| Admin login | Decision 8 | `r-login` |
| Forgot password (`/forgot-password`) | Decision 19; no reset endpoint, so it points to support | top bar + card |
| Terms, Privacy notice (`/terms`, `/privacy`) | Decision 19; text shown as `[TERMS OF USE TEXT]` / `[PRIVACY NOTICE TEXT]` placeholders | top bar + card |
| Support contact (`/support/contact`) | Call / WhatsApp / Chat tiles; numbers are `[SUPPORT PHONE NUMBER]`, `[WHATSAPP NUMBER]` placeholders | `c-support` cards |
| Add / edit address (`/addresses/new`, `/addresses/:id/edit`) | `c-saved` edit links; editing must not start an order | `c-details` fields |
| Email, Change password, Delete account (`/profile/...`) | Decision 6 (optional email) and decision 19 | form fields + footer button |
| Receipt (`/orders/:ref/receipt`) | "Download receipt" on `c-order-detail`; saves via the phone's print dialog | card + key/value rows |
| Water source question | Decision 10, Tanker only | option tiles |
| Custom tank size field and "Request a quote" | FR-021 custom sizes | text field, footer button |
| Page not found | Any unknown address | top bar + illustration + footer |
| Partner sign-up (`/partner/signup`) | Decision 9: vehicle type at sign-up | `c-signup` + option tiles |
| Decline an assigned order (`/partner/rider/jobs/:ref/decline`) | Decision 13: decline only with a reason | `r-issue` |
| Available orders map view | "Map" tab of `r-available` had no screen | map panel + numbered pins |
| Withdraw request (`/partner/rider/earnings/withdraw`) | "Withdraw" on `r-earnings` | form + footer button |
| Partner profile and settings (`/partner/rider/profile`, `/partner/rider/settings`) | Empty "My profile" and "Account settings" links in `r-menu`; optional email (decision 6) | `c-profile` rows |
| Partner contact, forgot password, change password (`/partner/...`) | "Contact admin", "Call admin now", "Forgot password?" | shared customer screens |
| Tanker assigned-order sheet (`/partner/driver/assigned/:ref`) | No `t-assigned` design; admin can assign tanker orders (decision 13) | `r-assigned` sheet |
| Tanker payout request (`/partner/driver/earnings/withdraw`) | "Request payout" on `t-earnings` | the rider withdraw form |
| Tanker history, papers, notifications, support, profile, settings (`/partner/driver/...`) | `t-menu` links to `r-*` screens (decision 18) | rider screens with tanker words |

## Differences from the PNGs (customer app)

- Text wraps slightly more in a few titles ("Order with Keke", "How can we
  help?") because Plus Jakarta Sans is wider than the Inter the PNGs were
  rendered with.
- The quantity screens show "Delivery: After address" and "Water total"
  instead of a delivery fee and total (decision 10). Review shows the full total.
- `drop-hero` has the "Clean Water Healthier Lives" slogan removed (decision
  15); the home text is "Water poured straight into your tank".
- Sign-in has no Google button or "or use your phone" divider; sign-up has no
  email field (decision 6). The profile shows "Signed in with: Phone number
  and password" and an optional email.
- The profile's phone chip shows "Not verified yet" for unverified customers
  instead of always "Verified".
- New orders without a rider show "Finding a rider" on tracking, with no
  vehicle and no ETA badge (decision 14).
- The delivered screen starts with no stars chosen (the PNG shows a sample 4).

## Differences from the PNGs (Keke rider app)

- `r-login`: "Rider accounts are created by MmiriOma… Contact admin" became
  "MmiriOma checks every vehicle before it gets orders. New here? Create a
  rider or driver account" (decision 9: self sign-up). The sub-title says
  "rider or driver account" because one login serves both apps.
- `r-assigned`: the sheet opens over the real dashboard instead of a grey
  placeholder.
- `r-refill`: the map badge says "Head to GRA Refill Station" instead of the
  turn-by-turn "In 400 m turn right onto Abakaliki Rd", which the app cannot
  know (decision 14). "Start navigation" opens the phone's maps app.
- `r-pickup`: "Cans are clean and sealed" became "Cans are closed for the
  trip" (decision 15: no sealed cans yet, no quality claims). Nothing is
  pre-ticked; the full load must be ticked to continue.
- `r-otp`: in mock mode only, a line under the keypad shows the customer's
  code so a demo can finish without the customer's phone.
- Dashboard numbers ("5 trips", "₦12,500") are seeded sample totals; history
  lists only the seeded trips, so the counts differ (all SAMPLE).

## Differences from the PNGs (tanker driver app)

- `t-refill`: the green banner says "Head to {station}" with the station's
  road instead of "Turn right in 300 m onto Ogui Road" (decision 14). On short
  screens the full-screen map is cropped by the bottom sheet.
- `t-loading`: "Tank was cleaned before loading" was removed and "Valves closed
  and sealed" became "Valves closed for the trip" (decision 15: no quality
  claims). Nothing is pre-ticked; only the full gallons are required. With the
  full load the button reads "Confirm loading". The water level moves with a
  transform instead of `height`.
- `t-home`: no notification bell, as in the PNG; notifications are in the menu.
  An active delivery shows as a green card above the order list (the rider
  dashboard pattern).
- `t-menu`: "My profile" and "Account settings" rows were added (same as the
  rider menu) so those screens are reachable.
- Trip times ("About 31 min") are station + customer leg estimates from the
  sample data, so they differ from the PNG's "About 40 min".

## Answers (2026-10-16, second round)

| # | Topic | Answer |
| --- | --- | --- |
| 11a | Tank sizes in litres | GeePee tank equivalents, shown as approximate ranges after a size is chosen: **500 gal ≈ 2,000 to 2,500 L**, **750 gal ≈ 3,000 L**, **1,000 gal ≈ 4,000 to 5,000 L**. These are tank-maker sizes, not a unit conversion, so the UI says "about" and never computes litres from gallons |
| 11b | Tanker capacity | A standard water tanker carries at least enough to fill two 1,000 gal tanks or four 500 gal tanks. Used for the custom-size quote rule and driver "fits your tank" checks; exact payload per vehicle stays `[SAFE LOAD]` on the vehicle record |
| 11c | Tanker capacity at sign-up (2026-10-20) | Most tankers carry enough to fill four 1,000 gal tanks, so the driver types their tanker's capacity in gallons (500 to 20,000) instead of picking 500, 750 or 1,000 |
| 10a | Delivery fee methods | Admin can switch two fee methods on or off: a **rate per km** and a **fixed fee per area**. Distances for the per-km rate are entered by admin (refill station to area); no map provider is used, and the fee never relies on straight-line distance alone (PRD §7) |
| 10b | Water source price | For tanker orders, "Ninth Mile water" costs more than "Any Bore hole water". Admin sets the price per source. Keke has no source choice |
| 9a | Driver sign-up | Built on mocks now; needs an auth contract and backend change before it works for real |
| 24a | Logo SVG | Not needed yet; ask (with format and sizes) when a favicon or icon needs it |

## Admin (Phase 6, 2026-10-20)

Added screens (no design; built from the admin patterns, decision 17: every
sidebar item has a page):

| Screen | Why | Pattern |
| --- | --- | --- |
| Staff sign in (`/admin/login`) | Decision 8 | `r-login` |
| Service areas (`/admin/areas`) | Sidebar item; decision 10a needs a distance and fee per area | admin table |
| Loyalty points (`/admin/loyalty`) | `a-pricing` tab and sidebar item | `a-pricing` cards and change log |
| Payments (`/admin/payments`) | `a-pricing` "Payouts and payments" tab and sidebar item; FR-040 | `a-orders` table |
| Rider earnings (`/admin/earnings`) | Sidebar item; payout requests from the partner apps | admin tables |
| Reports (`/admin/reports`) | Sidebar item | stat cards and tables |
| Settings (`/admin/settings`) | Sidebar item; placeholders `[SUPPORT HOURS]`, `[CODE TIME LIMIT]`, `[SAFE LOAD]`; audit log | form and table |
| Notifications, My account (`/admin/notifications`, `/admin/account`) | Header bell and profile | lists and cards |
| Full map (`/admin/map`) | "Open full map" on `a-dashboard` | dashboard map |
| Add rider (`/admin/riders/new`) | "+ Add rider" on `a-riders` | partner sign-up form |

## Differences from the PNGs (admin)

- Numbers are worked out from the sample records (14 orders today, not
  120); they still carry SAMPLE DATA. The dashboard stats say "Orders today".
- `a-orders` and `a-create`: eligible riders show "Works in {area}" and
  Online/Offline instead of "1.2 km"; there is no rider location
  (decision 14). Riders are sorted online first, then by area, load and
  rating.
- `a-create`: tanker sizes are 500/750/1,000 with the water source
  (decision 10); a custom size needs a quote first. A payment method choice
  was added to the summary. Creating with "Leave it for eligible riders"
  returns to the order list with a confirmation.
- `a-pricing`: the tanker table has a second water column, "Ninth Mile water"
  (decision 10b), and a "Delivery fee method" card with the two switches
  (decision 10a). The three tabs are links to their own pages.
- `a-stations`: a new station starts closed; it cannot open without valid
  papers (FR-012). "Expires in N days" counts from today.
- `a-support`: the resolution choices depend on the issue (no order: only
  points or close). Goodwill points ask for an amount.
- The sidebar shows all 13 sections on every page (decision 17), as on
  `a-dashboard`; the other PNGs show a shorter list.
- The landing footer's "Staff Login" is shown now that the sign-in exists.

## PWA and public pages (2026-10-19)

The partner apps moved from `/rider` and `/driver` to `/partner/rider` and
`/partner/driver` so the installed partner app owns them. `/` is now the
public landing page and the customer app starts at `/app`. Decisions and
differences: [landing-v1.md](landing-v1.md).

## Service zone changes (2026-10-26, #30)

**Status: approved** (G2) by @nnamdi-security, technical lead, sole
approver under PR #36, on 2026-10-26. Built in the link issues, not here:
#9 (customer), #14 (partner sign-up), and the Service areas link (lane D).

Why: customers order only in an active service zone and pick it themselves
(FR-010, FR-020; contract decision in
[admin-directory.md](../api/admin-directory.md#which-zone-an-address-is-in)),
and the zone's fee replaces the admin-typed distance (FR-022, "no
fabricated route estimates"). No new rule here: each change shows what the
agreed contracts already decide. Reuse the existing components (`Field`,
the `select` input style, `LoadingBlock`, `ErrorBlock`, notices); no new
tokens.

### Z1. Customer: area on Delivery details (`c-details`)

- **New address:** a required **Area** select under the address, listing
  the active zones by name (`GET /service-zones`), with a last option **My
  area is not listed**. Nothing is preselected.
- **Saved address:** its area name shows under the address text; no picker.
  An address whose zone was switched off shows "No longer served" and is
  treated like "not listed".
- **Not listed** shows a neutral notice under the select: "We don't have an
  instant price for your area yet. Send your request and our team will call
  you." The order continues as a quote request (no `quote_id`); never an
  estimated price or a delivery promise (FR-010, FR-022).
- **States:** loading ("Loading areas", Continue disabled); error
  (`ErrorBlock` with Retry; Continue disabled until the list loads); a list
  with no zones (only "My area is not listed", with the notice); a field
  error "Choose your area" when Continue is pressed with none chosen.
- **Review / price:** the `outside_service_zone` and
  `delivery_cost_unavailable` reasons use the existing manual-quote state,
  with the client's wording per reason (contract: clients word the code).

### Z2. Customer: area on saved addresses

- **Save this address? (`c-save`)** is skipped for an address sent as "not
  listed": a saved address must have a zone (customer-account.md, #33).
- **Saved addresses add and edit:** the same required **Area** select, with
  no "not listed" option. Same loading and error states as Z1.

### Z3. Partner sign-up: area select

- The free-text **Area you work in** becomes a required select of the
  active zones (`GET /service-zones`, which needs no session), by name. No
  "not listed" option: partners.md requires an active zone.
- **States:** loading (submit disabled); error (`ErrorBlock` with Retry,
  submit disabled); no zones ("No areas are open for sign-up yet. Please try
  again later.", submit disabled); field error "Choose the area you work in".
- **Amendment 2026-10-31** (production fix, branch `fix/termii-otp-and-driver-area`;
  one reviewer to confirm in the PR): the no-zones notice also gives the
  MmiriOma support phone number (the public contact), so a driver who cannot
  sign up has someone to call. Wording: "Driver sign-up is not open right now
  because no delivery areas are set up yet. Please try again later, or contact
  MmiriOma support on <number>."

### Z4. Admin Service areas: edit form and list

- **Removed:** "Serving station" and "Distance (km)" (contract open
  question 14: no admin-typed distance; sources stay on the command-line
  tool) and their list columns.
- **Added:** **Latitude** and **Longitude** number inputs, both required,
  with the hint "Decimal degrees, e.g. 6.4447 and 7.5108". Errors: "Enter a
  latitude between -90 and 90" and "Enter a longitude between -180 and 180"
  (the only checks the contract makes).
- **"Fixed fee (₦)"** becomes **"Delivery fee per order (₦)"** with the hint
  "Leave empty for no fee: quotes for this area become manual." It edits the
  pilot water category's fee (admin-directory.md mapping). Which category is
  the pilot one is still [#10 open question 2](../api/order-details-and-price.md#open-questions);
  until it is named, the field cannot be linked.
- **Boundary:** not editable on this screen (no map provider); zones keep
  the boundary set through the API.
- **States:** unchanged, plus the 409 `service_zone_name_taken` message "An
  area with this name already exists" (the mock's `area_exists` wording).

## Open questions

1. **Water source and stations.** Does the chosen source (Ninth Mile or
   borehole) limit which refill stations a driver can collect from?
2. **Driver sign-up (decision 9).** Staff accounts are currently created by a
   command-line tool, not through the API. Driver self sign-up needs an auth
   contract change and admin approval before the first order.
