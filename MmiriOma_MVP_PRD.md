# MmiriOma — MVP Product Requirements Document (PRD)

**Version:** 0.1 — Team review draft  
**Date:** 13 October 2026  
**Product:** MmiriOma  
**Audience:** Five-person hackathon team, mentors, pilot partners and prospective sponsor/investor  
**Delivery horizon:** Four-week hackathon; working software MVP **and at least one real, compliant pilot delivery**  
**Status:** Proposed requirements; not approval to operate or claims of regulatory compliance

## 1. Executive summary

MmiriOma is a mobile-first, technology-enabled water delivery coordination service for customers in Enugu. It aims to help households and small businesses order water, see a clear price, choose an available delivery window, and receive water without personally unloading it. The operating team sources from vetted suppliers and uses suitable contracted delivery providers. The software coordinates ordering, quotation, dispatch, fulfilment, payment reconciliation and operational reporting.

**Product promise to test:** Convenient, reliable, competitively priced water delivery, with appropriate water-quality controls and transparent sourcing.

**Hackathon outcome:** Demonstrate the complete order-to-delivery workflow through software, capture trustworthy operating data and fulfil at least one actual customer order **only after required safety and operating conditions are satisfied**. In case approval or safe water sourcing is not ready, provide a fully functional simulated demonstration and explicitly record the unmet live-pilot requirement; do not present simulation as a real delivery.

## 2. Evidence and assumptions

### 2.1 Findings reported by the team

- Customers interviewed in the initial Enugu field outreach purchase varied volumes, approximately **25–3,000 litres**.
- **Most observed purchases were below 500 litres**, with a smaller number above 1,000 litres.
- Prices differ even for equivalent quantities within the same neighbourhood.
- The team identified three desirable differentiators: **hands-off unloading**, **reliable scheduled arrival**, and **competitive pricing**.
- Enugu has competing informal vendors and established operators, and water demand is seasonal.
- The team has **no dedicated validation budget**; members may contribute personally.
- Hackathon assessment requires working MVP software and **at least one live pilot**.
- A possible investor is a sponsor of the programme; funding is **not promised**.

These findings are qualitative and not yet statistically representative or an estimate of total demand.

### 2.2 Open assumptions requiring validation

| ID | Hypothesis | How it will be tested |
|---|---|---|
| H-01 | Households and small businesses will buy through MmiriOma | Real orders and repeat intent |
| H-02 | Customers value no-lift delivery | Pilot survey and behaviour |
| H-03 | Target customers accept scheduled windows | Pilot booking and feedback |
| H-04 | Competitive pricing can produce positive contribution margin | Order-level recorded costs |
| H-05 | A contracted operator can meet service standards without vehicle ownership | Reserved-shift trial |
| H-06 | Safe and legally appropriate source-to-customer handling is achievable | Supplier documentation, testing and regulatory advice |
| H-07 | Grouped neighbourhood deliveries improve economics | Compare cost per order in pilot and projected routes |

## 3. Goals, non-goals and success measures

### 3.1 Goals

1. Enable a customer to request/confirm a water delivery using a mobile browser.
2. Quote transparent pricing using configured quantity, route zone/distance, fulfilment method and handling charges.
3. Automatically confirm and offer eligible orders to capable, available operators, with dispatcher approval and assignment for exceptions and manual overrides (#411 target approved 12 November 2026; not yet implemented).
4. Communicate confirmed delivery windows and status changes.
5. Record evidence of complete unloading and customer acknowledgement.
6. Record actual revenue and variable delivery costs for unit-economics assessment.
7. Safely execute and document at least one real delivery when conditions permit.

### 3.2 MVP non-goals

- Purchasing or managing a five-vehicle owned fleet.
- Building a purification plant, storage hub or water-production facility.
- Fully automated AI/WhatsApp conversation agents.
- AI routing, GPS tracking, vehicle telemetry or automatic traffic predictions.
- Native Android/iOS applications.
- Complex subscriptions with advance charging, payment splits or wallets.
- Nationwide or all-Enugu dispatch coverage.
- Automatic pricing for orders exceeding validated vehicle/operational capacity.
- Claims that any water is potable without applicable verification.

### 3.3 Pilot metrics

| Metric | Definition | Target/status |
|---|---|---|
| Live deliveries | Real, safely fulfilled customer deliveries recorded in system | **≥1 required** |
| End-to-end technical workflow | Order → quote → confirm → assign → dispatch → deliver → reconcile | 100% of critical demo flow functional |
| On-time rate | Delivered within confirmed window / completed deliveries | Measure baseline; aspirational ≥90% only after sufficient observations |
| Price transparency | Accepted order matches displayed quote unless customer explicitly approves repricing | 100% |
| Unloading compliance | Driver completes the agreed transfer without customer labour | 100% for qualifying pilot orders |
| Cost capture | Completed orders with revenue and variable costs recorded | 100% |
| Customer satisfaction | Post-delivery feedback and willingness to reorder | Collect; no statistically significant claim from tiny sample |

## 4. Personas and permissions

| Persona | Needs | MVP access |
|---|---|---|
| Customer | Order simply, see final price, book delivery window, know status, give feedback | Mobile web; account or verified contact-based checkout |
| Dispatcher/administrator | Set service coverage and prices, verify supply, assign orders, manage exceptions | Protected admin dashboard |
| Delivery operator | See assigned job, accept it, update pickup/transit/delivery, record proof | Mobile-friendly driver interface |
| Supplier | Provide sourced water and quality documentation | Managed by admin in MVP; no supplier login required |
| Investor/judge | Understand service and observe the pilot | Read-only demo/report with non-sensitive sample data |

**Access principle:** No role may view more customer details than necessary for its tasks.

## 5. MVP scope and priorities

Priority labels: **P0 = must work for live pilot**, **P1 = desirable within four weeks**, **P2 = defer**.

| ID | Capability | Priority | Acceptance summary |
|---|---|---|---|
| PR-01 | Service-zone availability | P0 | Unsupported locations cannot silently checkout |
| PR-02 | Customer contact, address and delivery instructions | P0 | Required information validated and stored |
| PR-03 | Quantity selection and order classification | P0 | Supported quantities quoted; oversized orders request manual quote |
| PR-04 | Price preview and cost breakdown in admin | P0 | Customer sees all-in price; admin can audit components |
| PR-05 | Delivery slot booking | P0 | Confirmed bookings respect slot capacity |
| PR-06 | Order creation and tracking | P0 | Unique reference and clear current status |
| PR-07 | Dispatcher workflow | P0 | Admin can verify, approve and assign |
| PR-08 | Driver workflow | P0 | Driver can accept, update status and prove delivery |
| PR-09 | Water-source/quality gate | P0 | Ineligible source blocks pilot order assignment |
| PR-10 | Payment record | P0 | Cash/transfer or manual verified payment recorded, never assumed paid |
| PR-11 | Operational cost and margin capture | P0 | Staff log supplier, delivery and handling costs |
| PR-12 | Notifications | P1 | Basic status notification via configured channel and fallback manual workflow |
| PR-13 | Customer feedback | P1 | Rating, lateness and unloading feedback recorded |
| PR-14 | Recurring order preference | P1 | Preference recorded for manual future scheduling; no auto-charge |
| PR-15 | Standard/large order quote request | P1 | > configured maximum diverted to assisted quote |
| PR-16 | Summary reporting | P1 | Orders, delivered-on-time, gross revenue and contribution shown |
| PR-17 | Multi-stop route optimization | P2 | Deferred |
| PR-18 | AI ordering/support | P2 | Deferred |
| PR-19 | Self-service supplier onboarding | P2 | Deferred |
| PR-20 | Fleet purchase/asset maintenance module | P2 | Deferred |

## 6. Customer journeys

### 6.1 Standard scheduled order

1. Customer selects delivery address or drops a map pin (optional; manual address remains available).
2. System determines supported service zone; otherwise presents **request a quote/contact support**.
3. Customer selects water category **only among verified, available options** and quantity.
4. System checks pricing and capacity and displays the **final price**, source/category description, supported-use notice, and available windows.
5. Customer enters a verified phone/contact method and accepts the price and delivery terms.
6. System creates an order reference and automatically confirms an eligible order only after phone, source, capacity, accepted window and payment conditions pass. Exceptions remain awaiting dispatcher confirmation; missing operating-hour/window rules block automation.
7. System offers eligible orders to a suitable operator, who accepts. Declines and timed-out system offers retry within a configured limit, then escalate to staff. Manual intervention persists until staff resolve the order; a busy or held driver cannot receive another live job.
8. Operator records pickup and progress; customer can view status.
9. Operator handles unloading/transfer; customer confirms quantity and delivery or disputes it.
10. Dispatcher reconciles payment and actual costs; optional feedback is collected.

### 6.2 Larger order

If requested quantity exceeds configured single-order service capability or safe vehicle payload, **do not return a fabricated instant price or default to tricycle**. Create a bulk-quote request with customer contact, quantity, timing and location. Dispatcher obtains appropriate tanker/multi-trip quotation, compliance check and customer consent before confirming.

### 6.3 Delay or failed delivery

Dispatcher can record delay reason, propose a new window, cancel or reassign. Customer must explicitly accept a materially changed price or window. Funds collected for failed service are managed under documented refund/manual reconciliation procedures.

## 7. Pricing requirements and principles

Pricing must **not rely solely on straight-line distance**. MVP price quotes should derive from admin-configured rules covering:

- Verified supplier and water-unit cost.
- Quantity band and vehicle capacity/number of trips.
- Road-based distance estimate or predefined service-zone fee.
- Loading, transfer/unloading and sanitation/consumable costs.
- Payment/transaction costs where applicable.
- Minimum order or small-order fee (if adopted).
- Minimum contribution-margin policy and discounts requiring administrator authority.

**Formula (conceptual):** Final customer price = water procurement cost + transport allocation + handling + other variable costs + planned contribution. Actual contribution = collected order revenue − recorded variable costs. The admin panel stores the quote-version/rule snapshot so historical orders remain auditable when prices change.

Customers see **one all-inclusive price** and any disclosed exceptions. Prices may differ by service zone and quantity; adjacent orders should not vary unexpectedly without a documented rule. Pricing remains a hypothesis until validated with operator and supplier quotations.

## 8. Operations and source controls

- Each fulfilled order must reference a specific approved supplier/source record and water category.
- Before live pilot, obtain and review appropriate water-source evidence and understand regulatory requirements for the precise intended use and handling model.
- Operators must use appropriate dedicated handling containers/equipment, safe carrying limits and agreed sanitation process.
- A water-quality failure, missing required documentation or unsafe source status blocks dispatch of affected water category.
- Driver must not require customer to lift or pour water as part of a service promising hands-off unloading.
- Drivers may refuse unsafe access or transfers; dispatcher must communicate alternatives transparently.
- Pilot supervisor confirms appropriate permissions, supply controls and incident procedure before executing a real order.

## 9. Product experience

- Designed first for low-bandwidth Android browsers; responsive desktop admin.
- Simple, accessible forms; clear typography and large-enough touch targets.
- Customer journey should not require installing an app.
- Quote before commitment, with delivery date/window and clear payment state.
- Show understandable order status; no false live tracking claims.
- Accessible design, keyboard operation, error messages and visible loading/empty states.
- Support call fallback (the official support number, SRS FR-055) when a service area is unavailable or an order is delayed; WhatsApp only once it is confirmed active on that number.

## 10. Dependencies and risks

| Risk | Product response |
|---|---|
| No funding | Manual coordination, reusable tooling, existing vehicle partner |
| Rainy-season lower demand | Target customers already purchasing; pilot tests fulfilment, not scale |
| Unsafe/untested source | Do not dispatch; demo remains simulated until resolved |
| Demand low or price sensitivity high | Tight service zone, grouped bookings, reconsider minimum quantity |
| Vehicle capacity mismatch | Per-vehicle max payload rules; assisted bulk quote |
| Driver nonperformance | Agreed service terms, dispatch oversight and reassignment |
| Network/connectivity outage | Clear retry states, unique order submission keys, manual recovery |
| Regulatory uncertainty | Seek qualified guidance; do not mislabel water as potable |
| Fraud or false proof | Driver/customer confirmation, timestamped audit trail and dispute flag |

## 11. Delivery milestones (four weeks)

| Week | Product and validation milestone | Evidence |
|---|---|---|
| 1 | Confirm service zone, supplier/operator shortlist, flow and price rules; set up foundation | Signed-off PRD, quotations, safety action list, prototype |
| 2 | Customer order/quote + admin dispatch and driver status implementation | Internal end-to-end test on seeded data |
| 3 | Payment reconciliation, source gate, exception handling, feedback; supervised dry runs | Demo run, defects fixed, operational checklist |
| 4 | Approved real delivery pilot if safe/legal, metrics capture, demo rehearsal and pitch | Order audit trail, genuine results, investor-ready report |

**Go/no-go gate for live pilot:** appropriate supplier/source evidence; regulatory/handling requirements understood and satisfied; trained available operator; validated equipment/load; feasible price and agreed window; customer consent; incident contact; production-like ordering flow tested.

## 12. Definition of done

MVP is complete when all P0 requirements pass acceptance tests, roles and permissions are correctly enforced, one coherent demo can be completed without manually editing the database, actual costs can be recorded, critical defects are closed, and the team can accurately distinguish simulated activity from real fulfilment.

The **hackathon live pilot requirement is a separate completion criterion**: it is met only by a genuine delivery conducted under appropriate operating and water-safety conditions and documented with truthful results.

## 13. Open product decisions

1. Exact pilot neighbourhood and service coverage.
2. Whether initial water is intended for drinking or specified domestic uses, and approved source evidence for that category.
3. Supported standard quantities and vehicle/load limits.
4. Starting quote strategy: quantity-plus-zone rate card versus per-order manual approval.
5. Whether to require contact verification or use a verified pilot customer list.
6. First payment method: cash on delivery, bank transfer or both.
7. Minimum contribution policy and handling of discounts.
8. Whether subscription preference is realistic within the pilot.

These must be settled through team decisions and field evidence, not invented as facts by developers.

**Update, 17 October 2026:** decisions 2 (category "Domestic water"; no potable claim without evidence), 3 (quantity presets), 5 (SMS phone verification) and 6 (Paystack, verified bank transfer and pay on delivery) are now recorded in SRS v0.2 (FR-003, FR-014, FR-021, FR-040); see its §13 Change history. The others remain open.

**Update, 19 October 2026 (#55):** recorded in SRS v0.3; see its §12 and §13.

- **1 (coverage):** administrators configure service zones by name, coordinates and optional polygon, and customers order only in active zones (FR-010). Which neighbourhoods form the pilot is configuration data, entered when the pilot is set up.
- **2 (category):** two categories, **Potable Water** and **Utility Water**; Utility Water replaces "Domestic water"; a supplier is activated for a category only after independent laboratory verification; no unsupported potable claims (FR-012, FR-014).
- **3 (vehicle limits):** administrators configure vehicles and verified payloads; at most two trips per vehicle per order; larger orders need a larger vehicle or a manual quote (FR-013).
- **4 (quote strategy):** server-computed quotes from supplier water cost, base delivery fee, OSRM road-distance charge, additional-trip charges, handling and a fixed margin or a percentage of water + delivery + handling, rounded up to whole naira, with delivery-zone rates as the fallback and a manual quote for what no plan fits (FR-022).
- **Still open:** 7 (minimum contribution policy and discounts) and 8 (whether a subscription preference is realistic); and, in SRS §12, the narrow open points listed there, including when the delivery code is activated (#67).

**Update, 12 November 2026 (#411, PR #416):** automatic confirmation, offers,
expiry, retries and escalation are approved target behavior under the agreed
dispatch contract. Dispatcher control and safe manual fallbacks remain. This
is a requirements amendment, not an implementation or deployment claim;
#407/#408/#410, window/operating-hours agreement and G2 designs remain gates.
