# MmiriOma — MVP Software Requirements Specification (SRS)

**Version:** 0.3 — Product decisions of 19 October 2026 incorporated (#55)\
**Date:** 19 October 2026 (v0.2: 17 October 2026; v0.1: 13 October 2026)\
**Related document:** [MmiriOma MVP PRD](MmiriOma_MVP_PRD.md)  
**Target:** Working web MVP plus at least one safely and lawfully completed real-world pilot  
**Normative wording:** **MUST/SHALL** = required; **SHOULD** = preferred; **MAY** = optional\
**Changes in v0.3 and v0.2:** see [§13 Change history](#13-change-history)

## 1. Scope and boundaries

This document specifies a minimum, deployable software system to manage small-volume water delivery in one pilot service zone of Enugu, with assisted quotation for oversized orders. It covers customer booking, admin-controlled prices and delivery windows, source eligibility, operator assignment, delivery proof, payments (pay on delivery, staff-verified bank transfer and Paystack online payment), cancellations and refunds, operational costs and basic reporting.

It **does not** authorize water production, assert water potability, define a compliant treatment process or replace regulatory consultation. It also does not require owning vehicles, GPS telemetry, AI agents, subscriptions billing or a dedicated supplier application.

**Requirements are intentionally technology-neutral**: the team should choose one stack it can reliably build, test, deploy and maintain in four weeks. A modular monolith with responsive web pages and JSON APIs is sufficient. Do not split into microservices.

## 2. System context

**Actors:** Customer, Administrator/Dispatcher, Driver/Delivery Partner, optional Pilot Supervisor, external messaging (Termii SMS, a configurable transactional email provider), payment (Paystack) and road-distance (OSRM) systems, Supplier (managed admin record, not logged-in actor).

**Logical components:**

1. Customer mobile web application.
2. Role-protected administration/dispatch web application.
3. Driver mobile web interface.
4. Backend API and business rules.
5. Relational database and event/audit records.
6. Messaging (SMS, email), payment and road-distance (OSRM) adapters, each with a transparent manual fallback.

### 2.1 Operating assumptions

- Pilot serves configured active service zones (FR-010); no nationwide availability promise.
- Automatic confirmation and dispatch are approved as the target for eligible orders (#411, PR #416, 12 November 2026). Dispatcher control remains for exceptions and manual overrides; the implementation is gated on #407, #408, #410 and approved designs.
- Customers may pay online through Paystack, by bank transfer verified by staff, or on delivery. Pay on delivery is available for **all** order amounts (FR-040).
- Customers have an account identified by a Nigerian mobile number, which must be verified by SMS one-time code before their first order (FR-003). Abuse prevention is required for real delivery.
- The app offers two water categories, **Potable Water** and **Utility Water** (FR-014), each only when backed by a supplier activated for that category after independent laboratory verification (FR-012) and a valid handling pathway. Water is never described as potable or drinkable without that evidence.
- MmiriOma's customer support number is **+234 813 377 4902**, held as one configured value (FR-055). WhatsApp support links are enabled only once WhatsApp is confirmed active on it.
- All timestamps stored in UTC and displayed in **Africa/Lagos** time zone.

## 3. Functional requirements

Each requirement has an identifier and testable condition. Priority **P0** blocks release; **P1** should be implemented after the P0 flow is stable; **P2** deferred.

### 3.1 Identity and access

**FR-001 (P0) Roles.** The system SHALL enforce Customer, Dispatcher/Admin and Driver roles on the server for both web and API operations. Customers may read only their own orders through secure authenticated or appropriately verified access. Drivers can see only assigned jobs and the delivery details necessary to fulfil them.

**FR-002 (P0) Staff login.** Staff and drivers SHALL authenticate securely. Admin can activate/deactivate partner accounts; deactivated accounts cannot access future job data.

**FR-003 (P0) Customer phone verification.** A Nigerian mobile number, normalized to E.164, is the customer's primary identifier. The customer SHALL verify possession of the number by SMS one-time code (OTP) before placing their **first** order; order creation by an unverified customer is rejected. Later orders need no new verification unless the number changes (FR-004).

- The code is 6 digits from a cryptographically secure generator and expires **5 minutes** after it is sent.
- At most **5** verification attempts per code; after the fifth wrong attempt the code is void and a new one must be requested.
- Resend cooldown **60 seconds**. At most **3** codes per phone number per rolling hour, plus IP-based rate limits on requesting and verifying codes (NFR-002).
- Codes are single-use. Issuing a new code invalidates earlier unused codes for the same number and purpose.
- Codes are stored only as keyed hashes, never in plain text, logs or responses.
- Responses SHALL NOT reveal more about whether a number has an account than registration already does.
- SMS is sent through a provider adapter: an in-house **mock provider** in development and test (it makes codes visible only on the developer's machine and sends nothing), and **Termii** in production, selected by configuration. A production deployment SHALL refuse to start with the mock provider.
- Verification time is recorded (`verified_at`). If the SMS provider fails, the request returns a clear error and no verification is claimed. A dispatcher-controlled, documented manual verification MAY be used as a fallback; it is recorded in the audit log with the verifying staff member and is never presented as automated.

**FR-004 (P0) Phone number change.** Changing a customer's phone number SHALL require verifying the **new** number with the FR-003 rules. The current number stays on the account until the new one is verified, and a number already used by another account cannot be adopted.

### 3.2 Service zone and water sources

**FR-010 (P0) Service area.** Administrators SHALL configure service zones, each with a name, coordinates, an optional geographic polygon, an active/inactive flag and eligibility. Customers can place orders only within an **active** service zone; out-of-zone checkout SHALL show a request-assistance state rather than quote an unsupported instant delivery. Each zone carries admin-configured delivery-zone rates, used as the FR-022 fallback when road distance is unavailable.

**FR-011 (P0) Source records.** Admin SHALL create supplier/source records with name, contact, approximate pickup location, supplied categories, **water cost per litre** (integer kobo, configured by admin for each supplier and water category), verified status per category, effective dates and documentary references. Supplier documents and laboratory evidence are stored privately (NFR-006). A source record also SHALL hold its kind (borehole or Ninth Mile), an optional pickup point (latitude/longitude), optional minimum and maximum litres per order, whether it is available for new work, and the vehicle kinds (Keke, Tanker) that can load there; a source without a kind SHALL NOT be activated or chosen for an order. The cost per litre MAY be changed on its own; a change applies to new quotes only (FR-024). Stock levels are not recorded (amended 12 November 2026, #407).

**FR-012 (P0) Safety gate.** A supplier SHALL be activated for a water category only after appropriate **independent laboratory verification** for that category and verification of the applicable regulatory and operating requirements, recorded with its evidence. A source/category combination lacking required approved status, necessary current records or operational supervisor authorization SHALL NOT be available for confirmed real-order dispatch. Expired or revoked status blocks new assignments. Administrators SHALL **suspend** affected sources when a serious safety concern arises (BR-10). Collection, transportation and handling follow documented safe procedures. Specific compliance criteria are configured after qualified guidance; do not equate a database flag with legal compliance.

**FR-013 (P0) Capacity.** Administrators SHALL configure vehicle types, each vehicle's verified safe usable water payload in litres (adjusted for container/equipment weight), its availability and available time windows, and whether the operator can handle a given transfer method. The number of trips an order needs is its quantity divided by the chosen vehicle profile's verified payload, rounded up; a vehicle makes at most **two trips** per order. An order that exceeds the vehicle's safe capacity, or would need more than two trips, SHALL use a larger vehicle or become a manual quote. A load SHALL never exceed the vehicle's verified capacity (BR-03).

**FR-014 (P0) Water categories.** The system supports two categories, **Potable Water** and **Utility Water**; Utility Water replaces the v0.2 pilot category "Domestic water". Their labels and supported-uses descriptions are admin-configured. A category is offered only while at least one supplier is activated for it (FR-012). The system SHALL NOT make unsupported potable-water claims: water is described as potable or drinkable only in the Potable Water category, backed by independent laboratory verification of the supplier. A later label or category change does not alter existing orders, which keep their snapshot (FR-024).

### 3.3 Quote and checkout

**FR-020 (P0) Address.** Customer SHALL submit contact name, phone, delivery address, landmark/instructions and service zone; map pin MAY be provided but is not mandatory. Road-distance pricing needs a pinned or geocoded location; without one, the FR-022 fallback applies.

**FR-021 (P0) Quantity.** Quantities are stored in whole **litres**. The local unit is the **local gallon = 4 litres**. Approved pilot presets (admin-configurable):

| Litres | Local gallons |
|---|---|
| 600 | 150 |
| 1,200 | 300 |
| 2,000 | 500 |
| 3,000 | 750 |
| 4,000 | 1,000 |
| 5,000 | 1,250 |

Custom quantities MAY be entered in litres or local gallons. The **server** converts gallons to litres (× 4) and validates the result; the minimum is **600 litres**. A custom litre value need not be a multiple of 4; its gallon equivalent is shown exactly (up to two decimal places). Client-side conversion is for display only. Quantities that no configured vehicle and trip plan can fulfil (FR-013) become a manual-quote enquiry rather than a standard order.

**FR-022 (P0) Price calculation.** The server SHALL compute every quote; prices submitted by a customer's or driver's client are never trusted. The total is **water cost + delivery cost + handling cost + MmiriOma margin**:

- **Water cost:** the supplier's cost per litre for the order's water category (FR-011, FR-014) × litres.
- **Delivery cost:** **base delivery fee + distance charge + additional-trip charges**. The distance charge uses the **actual road distance** between source and delivery location, obtained from **OSRM**; additional-trip charges apply to the trips beyond the first (FR-013). Straight-line distance SHALL NOT be used for delivery pricing.
- **Handling cost:** admin-configured handling rates.
- **MmiriOma margin:** admin-configured, either a **fixed amount** or a **percentage of water cost + delivery cost + handling cost**.

All rates are admin-configurable and MAY differ between Potable Water and Utility Water. When OSRM cannot provide a road distance, the delivery cost falls back to the delivery zone's admin-configured rates (FR-010), or the order becomes a manual quote. **No fabricated route estimates.** Amounts are calculated in integer kobo; a fractional intermediate value (for example a percentage margin) is computed with decimal arithmetic and converted to whole kobo, and the **final payable amount is rounded up to the next whole naira** (an amount already in whole naira is unchanged). The rounding adjustment is part of the quote snapshot (FR-024).

**FR-023 (P0) Quote disclosure.** Customer SHALL see final total price, quantity, applicable water category/use description, delivery time window, price validity, the payment method and the potential cancellation and redelivery charges (FR-044, FR-038) before confirming. Discount/repricing SHALL require explicit approval if customer total changes.

**FR-024 (P0) Quote snapshot.** At order creation the backend SHALL persist quote amount, currency (NGN), rule versions, each cost component (water, delivery, handling, margin), the rates applied, the road distance and its source or the zone fallback used, the vehicle profile and trips, the margin type, the rounding adjustment to whole naira, and expiry. Editing current pricing rules SHALL NOT retroactively alter an accepted order.

**FR-025 (P0) Available slots.** Administrators SHALL configure the available delivery windows (date/time slots) per service zone, with a maximum confirmed order or volume capacity; only windows with available delivery capacity are offered. Slot allocation SHALL prevent overbooking under concurrent checkout/confirmation requests.

**FR-026 (P0) Idempotency.** Duplicate checkout submissions with the same idempotency key SHALL create no more than one order; customer retry SHALL show the existing result.

**FR-027 (P0) Order receipt.** Successful submission SHALL return a non-guessable/public-safe order reference and its current status. An enquiry/awaiting-confirmation state must not appear as guaranteed fulfilment.

### 3.4 Dispatch and fulfilment

**FR-030 (P0) Dispatcher queue.** Dispatcher SHALL list/filter orders by status, date and zone and inspect order detail including constraints, customer window, source eligibility, payment and costs.

**FR-031 (P0) Assignment.** The system or dispatcher SHALL assign only active, approved drivers meeting verified capacity, service area, availability, delivery type and handling requirements. Automatic offers additionally require fresh driver location, an eligible selected source, configured operating hours and no previous offer to that driver for the same order. A driver with an offered or accepted assignment SHALL NOT receive another live job; delivery holds keep the driver held. At most two trips are allowed and a quoted order SHALL NOT require more trips than quoted. Assignment SHALL be logged with actor/time (system actions have a null actor); concurrent assignments shall not overcommit a driver. A successful manual assign or withdrawal, or escalation, leaves the order under persistent dispatcher-only control. Details: docs/api/deliveries.md, "Automatic dispatch and reassignment (#411)" (agreed, not implemented).

**FR-032 (P0) Driver acceptance.** Driver SHALL accept or decline assigned work. System offers expire after a configured timeout (default five minutes). Decline or expiry retries the next eligible driver; three failed system offers by default stop automation and escalate once to administrators. No eligible driver does not count as a failed offer. Dispatcher offers retain manual withdrawal without automatic expiry. Admin SHALL be informed of rejection or timeout through dashboard state; system SHALL not claim acceptance beforehand. A late response to the driver's own expired offer is 409 `offer_expired`; other drivers retain 404 without access to delivery details.

**FR-033 (P0) State machine.** The order status tracks fulfilment only. Payment has its own status (FR-040); neither is inferred from the other (BR-12). Ordinary progression:

`draft/quote_requested → [awaiting_payment] → [awaiting_confirmation] → confirmed → assigned → accepted → departed → collected → en_route → arrived → unloading → delivered`

Statuses in brackets are used only when they apply. Alternatives: `cancelled`, `failed` and `disputed`. Meanings added in v0.2:

- `awaiting_payment`: **prepaid orders only** (Paystack or bank transfer). The customer accepted the price; payment is not yet verified. Pay-on-delivery orders never enter this status.
- `awaiting_confirmation`: price accepted (and, if prepaid, payment verified), but a check needs dispatcher action, for example a manual quote, source eligibility or slot.
- `confirmed`: eligible for dispatch. A pay-on-delivery order is `confirmed` with payment status `pending_collection`.
- `departed`: the driver has left to fulfil the order (the order is dispatched).
- `arrived`: the driver recorded arrival at the delivery location.
- `unloading`: the driver started unloading. The delivery code is issued once the driver records that unloading is complete (FR-035).
- `failed`: a delivery attempt failed (FR-038); the order may be rescheduled.

For #411, a valid customer-accepted pay-on-delivery quote with a verified phone, eligible source and accepted delivery window MAY be confirmed automatically at creation (row 4, system actor). Row 7 also permits the system when waiting only for opening hours, after revalidation; otherwise exceptions remain with the dispatcher. #408 must agree operating-hour and window semantics before implementation; a missing valid window remains `awaiting_confirmation`. Row 8 permits admin or system offers; row 10 permits system expiry. These are approved target transitions, not a claim of implementation.

State transitions SHALL be validated server-side by role and prior state; unauthorized/invalid transitions return a meaningful error. State names may be simplified in implementation but meanings must remain distinguishable.

**FR-034 (P0) Source pickup record.** Driver or dispatcher SHALL record actual source, pickup time, source reference and volume collected. Source mismatch or safety failure SHALL require dispatcher review before continuing.

**FR-035 (P0) Proof of delivery.** Completion SHALL capture the actual quantity delivered (litres), the delivery timestamp, the driver's confirmation that they unloaded the water, and the receiver's acknowledgement with a **delivery code**:

- The delivery code is a separate 6-digit one-time code (never the phone-verification code). It allows at most **5** verification attempts, is single-use and is stored hashed. It is sent to the customer by SMS and shown on their order screen; the customer gives it to the driver, who enters it. A new code MAY be issued after expiry and invalidates the previous one.
- The code is issued (activated) only **after unloading**: once the driver records that unloading is complete, it is sent to the customer and becomes usable (#67). It is valid **10 minutes** from issue (final, team decision of 19 October 2026).
- The driver unloads the water **before** delivery is confirmed and records unloading and delivery progress **manually**; the system does not detect unloading completion automatically. `delivered` cannot be reached without the delivered quantity, the unloading confirmation and a verified code or approved alternative proof (BR-06, T-08).
- Delivery GPS coordinates are **optional**. They are collected only with **consent obtained beforehand**, with an explanation that location evidence supports delivery verification, and only when the driver's device grants location permission. Missing GPS does not block completion and is never presented as tracking.
- Only **authorized administrators** MAY approve alternative proof (for example when the customer cannot receive the code), on supporting evidence: the customer's acknowledgment, the delivery timestamp, the driver's report and, where consented, a photo or GPS. The approving administrator, reason, evidence and timestamp are recorded in the audit log. A driver can never approve an override for their own delivery (BR-13).
- Partial deliveries record the delivered quantity and open an exception (FR-036). Disputes and failed attempts are recorded.
- Delivery completion does not depend on payment: the customer can confirm receipt while payment is outstanding (BR-12).

Photograph MAY be supported only with explicit consent and secure retention; not required for MVP.

**FR-036 (P0) Exceptions.** Dispatcher SHALL record late, missing, incorrect-volume, unsafe-access, source-quality concern, vehicle failure and customer-unavailable incidents; orders may be reassigned or cancelled with reason. Changed windows/prices require customer acknowledgment. Partial deliveries, failed attempts (FR-038), disputes and water-quality concerns are recorded as exceptions; water-quality disputes require administrator review. A customer MAY open an ordinary delivery dispute within **48 hours** after delivery; safety and suspected-contamination complaints remain reportable after that period (BR-16). Disputes, their evidence, actions and resolutions are recorded.

**FR-037 (P1) Customer status.** Customer SHALL see major confirmed state changes and latest announced window without false real-time GPS tracking.

**FR-038 (P0) Customer unreachable.** If the customer cannot be reached on arrival, the driver SHALL make **two** contact attempts (each recorded with its time) and wait the **full 10 minutes** from arrival; the driver cannot mark the customer unreachable earlier. If the customer is still unreachable, the driver records a failed attempt and the order becomes `failed` with reason `customer_unreachable`; failed deliveries are recorded and the customer may reschedule. A redelivery MAY attract the applicable delivery fee for the additional trip (the potential charge is disclosed before confirmation, FR-023) only when the failure is attributable to the customer and the driver arrived within the confirmed delivery window; the fee SHALL be disclosed and the customer's approval obtained **before rescheduling**. No charge applies when the driver arrived outside the window or the failure is attributable to MmiriOma (BR-14). A phone call before every delivery is not required; notifications (FR-050) keep the customer informed.

### 3.5 Payments and cost accounting

**FR-040 (P0) Payment methods.** The system SHALL support (a) **Paystack** online payment, (b) **bank transfer** verified by staff, and (c) **pay on delivery** for all order amounts, collected **after** the water has been unloaded (BR-15). Each order has a payment status separate from its order status (BR-12):

| Payment status | Meaning |
|---|---|
| `unpaid` | Prepaid order; nothing received yet |
| `awaiting_verification` | A Paystack payment or bank transfer was started or reported but is not verified |
| `pending_collection` | Pay on delivery; to be collected after unloading |
| `partially_paid` | Verified amount is below the order total; the outstanding balance is recorded |
| `paid` | Verified amount covers the order total |
| `partially_refunded` / `refunded` | A verified refund was completed (FR-043) |
| `disputed` | Payment is under dispute |

Payment status SHALL never be inferred from a customer upload, reference entry or browser redirect. Drivers cannot create or modify prices or amounts due.

**FR-041 (P0) Payment verification and reconciliation.**

- Online payments SHALL be verified **server-side** with Paystack (signed webhook and/or transaction verification), checking the reference, amount in kobo, currency (NGN) and order. The browser callback alone never marks a payment.
- Every payment is recorded against its order with method, amount, status, provider or evidence reference, verifier, time and notes.
- Duplicate payments are prevented: provider and transfer references are unique, repeated webhooks and confirmations are idempotent, and duplicates are flagged, not double-counted (NFR-011).
- Underpayments are recorded as `partially_paid` with the outstanding balance; overpayments are flagged for refund review.
- The customer receives an acknowledgment for each verified payment.
- Only authorized staff confirm bank transfers and cash handovers.
- Cash: the driver collects cash **after unloading** and records the amount. The driver remits collected cash to an authorized administrator acting as finance officer (an administrator, not a separate role) **before 6:00 PM (Africa/Lagos) daily**; cash collected after 6:00 PM is remitted the next day. Every day is an operating day. Each cash collection moves through **`collected → awaiting_remittance → remitted → reconciled`**; custody, remittance and reconciliation are tracked separately, and only authorized staff mark it remitted (received from the driver) and reconciled. Discrepancies are recorded as exceptions. Delivery completion stays independent of payment status (BR-12).

**FR-042 (P0) Actual costs.** Staff SHALL record per-order procurement, transport, labour/handling, consumables, payment fees, subsidies and refunds separately. Cost corrections SHALL have an audit record. The system SHALL calculate contribution as recognized collected revenue minus recorded variable fulfilment costs; do not label contribution as net profit.

**FR-043 (P0) Refunds and adjustments.** The system SHALL support full refunds, partial refunds, replacement deliveries and missing-quantity deliveries. Each requires administrator approval and records the reason, amount (kobo), requester, approver and approval time, payment and refund references, and status (`requested → approved → initiated → completed`, or `rejected` / `failed`).

- Prepaid refunds return through the original payment method where supported (Paystack refund; transfer back for bank transfers).
- Cash refunds are paid only to a **verified customer bank account**, recorded before payout. The account is verified through Paystack's **Account Resolve API** (the account number and bank resolve to the customer's account name). For the MVP, an administrator SHALL approve each cash refund before it is processed.
- Approved refunds should be **initiated within 48 hours** (a target, subject to provider processing times).
- Only a provider- or staff-verified completed refund sets payment status `partially_refunded` or `refunded`.
- Water-quality disputes require administrator review before any refund or replacement decision.

**FR-044 (P0) Customer cancellation.** Charges depend on how far fulfilment has gone:

| Order stage | Prepaid order | Pay-on-delivery order |
|---|---|---|
| `quote_requested` | Free | Free |
| `awaiting_payment` | Free cancellation | Not applicable |
| `awaiting_confirmation`, `confirmed`, `assigned`, `accepted` (driver not departed) | Full refund | Free cancellation |
| `departed`, `collected`, `en_route`, `arrived` (unloading not started) | Refund minus the actual delivery costs incurred, capped at the delivery charge disclosed in the quote | Actual delivery costs incurred may be charged, capped at the disclosed delivery charge |
| `unloading` | Administrator review required | Administrator review required |
| `delivered` | No normal cancellation; complaints go to refund/replacement review (FR-043) | Same |

- Potential cancellation charges are disclosed before order confirmation (FR-023). Cancellation before the driver departs is free. After departure, only delivery expenses **actually incurred** are deducted, never more than the delivery charge disclosed at checkout; they are recorded as verifiable order costs (FR-042) with a reason and evidence.
- If MmiriOma cannot fulfil an order, the customer is offered a full refund or a rescheduling they approve, with no charge.
- Failed deliveries attributable to MmiriOma are never charged; failures caused by customer unavailability MAY attract the disclosed redelivery charge (FR-038).

### 3.6 Messaging, feedback and reporting

**FR-050 (P1) Notifications.** System SHOULD support configurable event messages for order created, confirmed, driver assigned, delayed, delivered or cancelled. The channel may be SMS, transactional email (through a configurable email provider) or staff-operated manual messaging; WhatsApp only under FR-055. SMS is used for phone verification (FR-003) and the applicable notifications below. Channel failure SHALL not mutate actual order status. Template language must not promise unverified delivery or water quality. In v0.2 the following are **P0**, sent by SMS (Termii): order **confirmed**, order **dispatched** (`departed`), the delivery code (FR-035), payment acknowledgment (FR-041) and cancellation/refund outcomes (FR-043, FR-044). Templates include the support number (FR-055).

**FR-051 (P1) Feedback.** Customer SHOULD be able to rate timeliness, unloading experience, received quantity and willingness to reorder. Feedback SHALL be linked to order and protected against trivial duplicate spam.

**FR-052 (P1) Dashboard.** Dashboard SHOULD show orders by status, completed deliveries, on-time count/rate, collected revenue, refunds, variable costs, contribution per order and service-zone results. Simulated and test orders are excluded from actual financial, operational and customer performance reports and from real traction totals (BR-09).

**FR-053 (P1) Export.** Admin SHOULD export non-sensitive aggregated results and authorized order-level CSV for pilot analysis, with proper access controls and minimal customer data.

**FR-055 (P0) Support contact.** The official MmiriOma support number is **+234 813 377 4902**. It SHALL be used consistently in customer-facing support and contact interfaces, order and delivery assistance, cancellation and refund information, and notification and email templates, and SHALL come from one central configuration value rather than being repeated in code. WhatsApp support links SHALL be enabled only after it is confirmed that WhatsApp is active on this number.

**FR-054 (P1) Repeat preference.** System MAY store preferred repeat frequency and notify staff, but must NOT create guaranteed subscriptions or automatic billing without customer confirmation and implementation.

## 4. Business rules

| Rule | Requirement |
|---|---|
| BR-01 | Every accepted quote uses NGN and a frozen price snapshot. |
| BR-02 | A quote can only reference an available eligible source and service region. |
| BR-03 | Actual delivery allocation cannot exceed verified vehicle/operational carrying capacity. |
| BR-04 | Customer is not expected to lift/empty water for a service advertised as hands-off. |
| BR-05 | Substantial price/window change requires documented customer agreement. |
| BR-06 | An order marked delivered requires proof of completion and quantity. |
| BR-07 | Paid state requires independent staff/provider-confirmed payment, not a customer assertion. |
| BR-08 | One live fulfilment is not proof of scale, repeat retention or sustainable profit. |
| BR-09 | Real and simulated/demo orders are clearly distinguished (`is_simulated`, `simulation_batch_id`). Unverified, test and simulated orders are excluded from actual financial, operational and customer performance reports. A simulated batch can be removed without affecting real customer records. |
| BR-10 | Water-source status can be revoked or suspended (for example after a serious safety concern) and blocks subsequent assignments. |
| BR-11 | Customer data is not included in public investor demo unless consent and minimization rules are satisfied. |
| BR-12 | Delivery (order) status and payment status are independent; delivery completion never waits for payment. |
| BR-13 | Drivers cannot set or change prices and cannot approve overrides of their own deliveries. |
| BR-14 | Customers are not charged for failures attributable to MmiriOma or when the driver arrives outside the confirmed delivery window. |
| BR-15 | Cash on delivery is collected only after the water has been unloaded. |
| BR-16 | Ordinary delivery disputes may be opened within 48 hours after delivery. Only safety and suspected-contamination complaints may be opened after that, at any time. |

## 5. Core data model

Minimum recommended entities and example fields (not an exhaustive physical schema):

| Entity | Minimum fields |
|---|---|
| users | id, name, phone/email, password hash when applicable, role, status, verified_at |
| phone_verifications | id, phone (E.164), purpose (account or phone change), code hash, expires_at, attempts, consumed_at, created_at |
| customers | id, user_id nullable, contact name/phone, verification status |
| addresses | id, customer_id, zone_id, freeform address, landmark, latitude/longitude optional |
| service_zones | id, name, active, coordinates, optional geographic polygon, delivery-zone rates (fallback), default pricing zone |
| water_sources | id, supplier name, supplier contact name/phone, pickup details, kind, pickup point (PostGIS point, SRID 4326, optional), minimum/maximum litres per order (optional), available flag, allowed vehicle kinds, categories with cost per litre (kobo) and activation state per category, laboratory evidence reference, valid_through, suspended flag and reason, document references |
| water_categories | id, label (Potable Water, Utility Water), supported-uses description, active, evidence reference |
| vehicle_profiles | id, type, verified safe payload per trip, availability, handling capabilities |
| drivers | id, user_id, vehicle_profile_id, active, availability |
| delivery_slots | id, zone_id, date, start/end UTC, order/volume capacity, reserved capacity |
| pricing_rules | id, version, zone, quantity band, source/category, base delivery fee, distance rate, additional-trip charge, handling rates, margin type (fixed/percentage) and value, zone fallback rates, effective dates |
| quotes | id, customer/session, quantity, category, pricing snapshot JSON (water, base fee, distance charge, additional trips, handling, margin type and amount, rates, road distance and source, vehicle, trips, rounding adjustment), total, currency, expires_at |
| orders | id, public reference, customer/address, quote, quantity, source, slot, amount, state, payment method, payment status, outstanding balance, confirmed_at, is_simulated, simulation_batch_id |
| assignments | id, order_id, driver_id, status, accepted_at, rejected_at, assignment history |
| order_events | id, order_id, actor, event type, from/to status, timestamp, metadata |
| pickup_records | id, order_id, source_id, collected volume, timestamp, handler |
| delivery_proofs | id, order_id, delivered volume, receiver, ack method/reference, unloaded_by_driver, timestamp, GPS (optional) and consent, override approver, reason and evidence |
| delivery_codes | id, order_id, code hash, issued_at, expires_at, attempts, used_at |
| delivery_attempts | id, order_id, arrived_at, contact attempts with times, outcome, reason, within_window flag, GPS (optional) |
| payments | id, order_id, method, provider, amount, currency, status, unique provider/transfer reference, verified_by, verified_at |
| cash_collections | id, order_id, driver_id, amount, status (collected/awaiting_remittance/remitted/reconciled), collected_at, remitted_at, received_by, reconciled_at, reconciled_by |
| refunds | id, order_id, payment_id, type (full/partial/replacement/missing quantity), reason, amount, status, requested_by, approved_by, verified bank account (cash refunds), provider or payout reference, timestamps |
| notifications | id, order_id or user_id, template, channel, status, provider reference, sent_at (never the code itself) |
| order_costs | id, order_id, type, amount, subsidy flag, changed_by, reason |
| exceptions | id, order_id, category, description, resolution status, actor, timestamps |
| disputes | id, order_id, raised_by, reason, opened_at, evidence references, actions, resolution, resolved_by, resolved_at |
| documents | id, owner (supplier/source), kind (for example laboratory report), private storage reference, uploaded_by, timestamps |
| document_access_logs | id, document_id, actor, action (view, download, change), time |
| simulation_batches | id, label, created_by, created_at, removed_at |
| feedback | id, order_id, rating, timeliness, handling, reorder intent, message |
| audit_logs | id, actor, action, target type/id, time, security relevant metadata |

Use relational constraints, indexed foreign keys, numeric money as integer **kobo**, integer litres (or decimal where needed), and explicit status enumerations. Avoid floating-point money values.

## 6. API contracts (illustrative, not mandatory endpoint names)

All write endpoints use authenticated or verified access, validation and consistent error responses. Sensitive staff endpoints require role checks. Recommended version prefix `/api/v1`.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/service-availability?zone=...` | Determine supported zone and categories |
| GET | `/delivery-slots?zone=...&date=...` | Available booking windows |
| POST | `/quotes` | Server-side quotation or assisted quote status |
| POST | `/auth/phone-verification` | Send a phone verification code (FR-003) |
| POST | `/auth/phone-verification/verify` | Verify the code |
| POST | `/me/phone-change` | Start a phone number change; verified like FR-003 (FR-004) |
| POST | `/orders` | Idempotent verified contact checkout |
| POST | `/orders/{reference}/cancel` | Customer cancellation with the FR-044 outcome |
| POST | `/orders/{reference}/payments/paystack` | Start a Paystack payment for the server-computed amount |
| POST | `/payments/paystack/webhook` | Signed Paystack event; server-side verification (FR-041) |
| GET | `/orders/{reference}` | Authenticated/verified customer tracking |
| GET | `/admin/orders` | Filtered dispatch queue |
| POST | `/admin/orders/{id}/confirm` | Confirm source, price and slot |
| POST | `/admin/orders/{id}/assign` | Assign eligible driver |
| POST | `/driver/jobs/{id}/accept` | Accept assignment |
| POST | `/driver/jobs/{id}/transition` | Valid state change |
| POST | `/driver/jobs/{id}/arrive` | Record arrival (FR-038) |
| POST | `/driver/jobs/{id}/unloading-complete` | Record that unloading is complete; issues the delivery code (FR-035) |
| POST | `/driver/jobs/{id}/contact-attempts` | Record a contact attempt (FR-038) |
| POST | `/driver/jobs/{id}/proof` | Delivery quantity, unload confirmation and delivery code |
| POST | `/driver/jobs/{id}/cash-collection` | Record cash collected after unloading |
| POST | `/admin/orders/{id}/payments` | Authorized reconciliation |
| POST | `/admin/orders/{id}/costs` | Record variable costs |
| POST | `/admin/orders/{id}/refunds` | Request, approve and record refunds (FR-043) |
| POST | `/admin/orders/{id}/proof-overrides` | Approve alternative proof of delivery (FR-035) |
| POST | `/admin/cash-reconciliations` | Daily cash remittance and reconciliation (FR-041) |
| POST | `/admin/orders/{id}/exceptions` | Log incidents and resolution |
| POST | `/orders/{reference}/feedback` | Verified customer feedback |
| GET | `/admin/reports/pilot` | Genuine operational metrics |

**Example `POST /quotes` request:**

```json
{
  "service_zone_id": "zone-001",
  "water_category_id": "domestic-water",
  "quantity_litres": 1200,
  "address_id": "addr-001",
  "desired_slot_id": "slot-001"
}
```

**Example success response (illustrative money only):**

```json
{
  "quote_id": "quote-001",
  "currency": "NGN",
  "total_minor_units": 200000,
  "price_valid_until": "2026-10-14T13:00:00Z",
  "status": "quote_available",
  "requires_manual_approval": false
}
```

A custom quantity MAY be sent in local gallons instead (for example `"quantity_local_gallons": 300`); the server converts it (FR-021). If no price is reliable, use a structured `manual_quote_required` response instead of fake numbers. `POST /orders` MUST accept a quote identifier and unique idempotency key, not a client-supplied price.

## 7. Non-functional requirements

### 7.1 Security and privacy

- **NFR-001 (P0):** HTTPS for any deployed system handling real customer or payment details; secure cookies/tokens, CSRF protection as applicable, password hashing and server-side authorization.
- **NFR-002 (P0):** Validate all inputs; use parameterized queries/ORM; rate-limit authentication, quote, OTP and order endpoints (phone OTP limits in FR-003, delivery code limits in FR-035); verify Paystack webhook signatures; guard against enumeration of public references.
- **NFR-003 (P0):** Encrypt sensitive data in transit; restrict access to contact/address information; avoid recording payment secrets. No collection of bank card credentials in MVP: cards are entered only on Paystack's hosted checkout. OTPs and delivery codes are stored hashed. Termii and Paystack keys are environment secrets (NFR-030).
- **NFR-004 (P0):** Record auditable state changes, source overrides, payment verifications, cash custody changes, refund approvals, proof-of-delivery overrides, phone number changes, cost edits, and document access and administrative changes to documents.
- **NFR-005 (P0):** Publish a simple privacy notice, define retention/deletion process and review Nigeria Data Protection Act obligations with qualified guidance as appropriate.
- **NFR-006 (P0):** Store supplier documents and laboratory evidence **privately**, with role-based access control. Record document access and administrative changes (NFR-004). Sensitive documents are never publicly accessible.

### 7.2 Reliability and performance

- **NFR-010 (P0):** Two concurrent attempts to reserve the last slot cannot both succeed; transactional concurrency control required.
- **NFR-011 (P0):** Network retry of payment/order creation must not cause duplicate rows or double-counting.
- **NFR-012 (P0):** Recoverable errors should display clear guidance and retain user-entered non-sensitive form fields.
- **NFR-013 (P1):** On ordinary mobile connectivity, aim for p95 API reads under 1 second and core screens usable within approximately 3 seconds, excluding external network/provider delays; measure on realistic throttling before claiming success.
- **NFR-014 (P0):** Database backup/restore approach defined and tested once before live pilot.
- **NFR-015 (P0):** System errors logged with correlation/request IDs without exposing customers' personal data in logs.

### 7.3 Usability and accessibility

- **NFR-020 (P0):** Responsive customer and driver flows usable on an entry-level Android browser; administration usable on laptop and mobile.
- **NFR-021 (P1):** Clear labels, accessible contrast, keyboard support and no reliance on colour alone for status.
- **NFR-022 (P0):** All server mutations provide loading, success and error states; form double-submit is prevented at UI and API levels.

### 7.4 Maintainability and operations

- **NFR-030 (P0):** Environment-specific configuration/secrets are not committed to repository.
- **NFR-031 (P0):** Database schema managed through migrations; seeded **demo** fixtures cannot be confused with genuine pilot orders. Simulated records carry `is_simulated` and, where they belong to a batch, `simulation_batch_id`; a batch can be removed safely without touching real customer records (BR-09).
- **NFR-032 (P0):** Automated tests cover calculation, access control, order transitions, duplicate checkout and payment reconciliation; run before demo deployment.
- **NFR-033 (P0):** One reproducible deployment procedure and a rollback plan must exist.
- **NFR-034 (P1):** Backend modules separate pricing, orders, dispatch, payments and reporting concerns while remaining one service.

## 8. State and edge-case specifications

- **Quote expires:** Order submission fails with `quote_expired`; customer must requote.
- **Zone becomes unavailable:** Pending requests can be declined; do not accept fresh orders.
- **Approved source revoked:** New dispatch blocked; existing pending orders escalated for revalidation.
- **Last slot booked concurrently:** One booking succeeds; other receives `slot_unavailable`.
- **Driver rejects job:** A system offer returns the order to `confirmed` for retry with the next eligible driver, subject to the attempt limit. Manual-only or escalated orders return to the dispatcher. The customer is not told a driver accepted.
- **Delivery late:** Record reason; notify/propose revised window; do not falsify delivery time.
- **Partial delivery:** Record delivered quantity and open dispute/adjustment; don't mark original quantity fully delivered.
- **Customer unreachable:** Two recorded contact attempts and the full 10 minutes' wait, then a failed attempt; marking it earlier is refused; rescheduling allowed; a redelivery fee only under FR-038, disclosed and approved before rescheduling.
- **Road distance unavailable (OSRM down or no route):** Delivery-zone rates or a manual quote; never straight-line distance (FR-022).
- **Dispute after 48 hours:** Refused as an ordinary dispute; safety and suspected-contamination complaints are still accepted (BR-16).
- **Serious safety concern about a source:** The source is suspended and new dispatch against it is blocked (FR-012, BR-10).
- **Cash collected after 6:00 PM:** Remitted the next day; every day is an operating day (FR-041).
- **Driver arrives outside the confirmed window:** No redelivery or cancellation penalty for the customer (BR-14).
- **Phone code expired or attempts used up:** Customer requests a new code; cooldown and hourly limits apply (FR-003).
- **SMS provider unavailable:** No verification or notification is claimed as sent; manual fallback under FR-003; order status unaffected (FR-050).
- **Paystack redirect without verification:** Payment stays `awaiting_verification` until server-side verification succeeds.
- **Duplicate Paystack webhook or repeated confirmation:** Recorded once.
- **Underpayment on delivery:** Order can be `delivered` with payment `partially_paid` and the outstanding balance recorded.
- **Delivery code expired or reused:** Rejected; a new code may be issued; a used code is never accepted again.
- **Customer cannot receive the delivery code:** Administrator-approved alternative proof with audit trail; never approved by the delivering driver.
- **MmiriOma cannot fulfil:** Full refund or customer-approved rescheduling, no charge.
- **Driver reports unsafe transfer:** Stop work; dispatcher handles safe alternative.
- **Bank transfer screenshot:** Status remains awaiting verification until independently checked.
- **Customer retries order:** Same idempotency key returns the same order.
- **App loses connectivity:** Driver may collect offline notes for later supervised entry; no false real-time sync claim.
- **Demo mode:** Simulated sources/customers/orders flagged (`is_simulated`, `simulation_batch_id`); excluded from live pilot reports; a batch can be removed without touching real records.

## 9. Test plan and acceptance criteria

| Test ID | Scenario | Pass criterion | Requirement |
|---|---|---|---|
| T-01 | Valid customer requests eligible 1,200L quote | Correct server total based on active rule; clear breakdown for admin | FR-022–024 |
| T-02 | Customer chooses unsupported zone | Manual enquiry or rejection; no confirmed booking | FR-010 |
| T-03 | Request beyond the verified payload of available vehicles | No auto-assignment beyond capacity; a plan of at most two trips, a larger vehicle or a manual quote | FR-013, FR-021 |
| T-04 | Source approval expires | New order cannot dispatch against source | FR-012 |
| T-05 | Two bookings race for final slot | Only one confirmed slot allocation | FR-025 |
| T-06 | Duplicate checkout retries | Exactly one order created | FR-026 |
| T-07 | Driver attempts another driver's order | Access denied | FR-001 |
| T-08 | Driver tries `delivered` without proof | Transition rejected | FR-033, FR-035 |
| T-09 | Admin changes price rule after confirmation | Original order total unchanged | FR-024 |
| T-10 | Customer sends bank transfer proof | Payment remains unverified until staff reconciliation | FR-040–041 |
| T-11 | Order completed with cost records | Contribution correctly computed; not called net profit | FR-042 |
| T-12 | Customer disputes missing volume | Order flagged disputed with event history | FR-036 |
| T-13 | Simulated order in report | Excluded from real pilot totals | FR-052, BR-09 |
| T-14 | Complete pilot run-through | Booking, assignment, driver proof and reconciliation demonstrated without DB edits | All P0 |
| T-15 | Phone code expires, 6th attempt, resend within 60 s, 4th code in an hour | Each rejected; codes stored hashed | FR-003 |
| T-16 | Unverified customer places first order | Rejected until the phone is verified | FR-003 |
| T-17 | Custom quantity of 300 local gallons; 599 L | 1,200 L accepted; 599 L rejected | FR-021 |
| T-18 | Quote without reliable road distance | Zone fixed price or manual quote; never straight-line distance | FR-022 |
| T-19 | Paystack redirect with forged or mismatched amount | Payment not marked paid | FR-041 |
| T-20 | Duplicate Paystack webhook | Exactly one payment recorded | FR-041, NFR-011 |
| T-21 | Cash collected, remitted and reconciled | Each status change by authorized role, audited | FR-041 |
| T-22 | Delivery code requested before unloading is recorded complete; code expired, reused, 6th attempt | Each rejected | FR-035 |
| T-23 | Driver approves an override of their own delivery | Denied | FR-035, BR-13 |
| T-24 | Customer confirms delivery with payment outstanding | `delivered`; payment status unchanged | FR-035, BR-12 |
| T-25 | Customer unreachable | `failed` only after two attempts and the full 10 minutes (earlier is refused); no charge when driver was outside the window | FR-038, BR-14 |
| T-26 | Customer cancels at each stage, prepaid and pay on delivery | Charge or refund matches the FR-044 table | FR-044 |
| T-27 | Refund approved and completed | `refunded` only after verified completion | FR-043 |
| T-28 | Ordinary dispute 49 hours after delivery; contamination complaint after 49 hours | First refused; second accepted | FR-036, BR-16 |
| T-29 | Remove a simulated batch | Its records are removed; real orders, payments and reports unchanged | BR-09, NFR-031 |

### 9.1 Mandatory pilot evidence

For each **actual** delivery, securely retain: anonymized order ID, date/time, ordered quantity, source and eligibility evidence reference, driver assignment, promised window, actual completion time, delivered volume, payment verification status, supplier/transport/handling costs, incident details, and customer feedback where provided. Obtain permission before taking or displaying images/testimonials.

The demo should label what was **actually measured**, what was **simulated**, and what is **forecast**.

## 10. Requirements traceability

| PRD requirement | Primary SRS links |
|---|---|
| PR-01 | FR-010, FR-020 |
| PR-02 | FR-003, FR-004, FR-020 |
| PR-03 | FR-013, FR-021 |
| PR-04 | FR-022–024, FR-042 |
| PR-05 | FR-025 |
| PR-06 | FR-026–027, FR-033, FR-037 |
| PR-07 | FR-030–031, FR-036 |
| PR-08 | FR-032–035, FR-038 |
| PR-09 | FR-011–012, FR-014, FR-034 |
| PR-10 | FR-040–041, FR-043–044 |
| PR-11 | FR-042, FR-052 |
| PR-12 | FR-050, FR-055 |
| PR-13 | FR-051 |
| PR-14 | FR-054 |
| PR-15 | FR-013, FR-021 |
| PR-16 | FR-052–053 |

## 11. Proposed implementation sequence

**Sprint A — Foundation and order path:** roles, zones/sources, data model, pricing rules, quote, checkout, idempotency, slots.

**Sprint B — Fulfilment:** admin queue, assignment, driver workflow, server-state validations, source eligibility, delivery evidence.

**Sprint C — Reconciliation and hardening:** payment verification, cost recording, incident handling, metrics, UI polish, automated tests, deployed demo.

**Sprint D — Pilot rehearsal and delivery:** operator dry-run, safe/approved live pilot, collection of genuine outcomes, pitch demo and backups.

Prioritize a complete **vertical slice** over building a large number of disconnected screens.

## 12. Unresolved technical/product decisions

Status after v0.3 (19 October 2026, #55). Resolved items keep their number so references stay valid. What is still undecided is marked **Open**.

1. **Partly resolved.** Stack: see `CLAUDE.md`. SMS provider: **Termii**. Online payments: **Paystack**. Road distance: **OSRM**, with admin-configured delivery-zone rates as the fallback; never straight-line distance (FR-022). **Open:** the deployment host, and where OSRM runs (hosting and map data).
2. **Resolved:** service zones are configured by administrators with names, coordinates and optional geographic polygons; customers order only within active zones (FR-010). Administrators configure delivery windows, which respect delivery capacity (FR-025).
3. **Resolved:** delivery cost = base delivery fee + distance charge + additional-trip charges; total adds supplier water cost per litre, handling costs and a fixed or percentage MmiriOma margin; all rates admin-configurable and may differ between Potable Water and Utility Water; integer kobo; the final payable amount is rounded **up** to the next whole naira; a percentage margin is a percentage of water + delivery + handling cost (FR-022).
4. **Resolved:** SMS one-time code (FR-003, FR-004).
5. **Resolved:** cash on delivery for every amount, collected after unloading; remitted to an authorized finance/admin officer before 6:00 PM daily, otherwise the next operating day; custody, remittance and reconciliation tracked separately (FR-041). The finance officer is an administrator, not a new role; every day is an operating day.
6. **Resolved:** supplier documents and laboratory evidence stored privately with role-based access; access and administrative changes recorded (NFR-006, NFR-004). The storage technology is chosen when the feature is built.
7. **Resolved:** delivery GPS is optional and collected only with prior consent, explaining that location evidence supports delivery verification; alternative proof may include the customer's acknowledgment, delivery timestamp, driver's report and consented photo or GPS, approved only by authorized administrators with approver, reason, evidence and timestamp recorded (FR-035). The exact consent text is user-interface copy written within these rules.
8. **Resolved (policy):** two categories, Potable Water and Utility Water (FR-014); a supplier is activated for a category only after independent laboratory verification and verification of applicable regulatory and operating requirements; safe collection, transport and handling; no unsupported potable claims; affected sources suspended on serious safety concerns (FR-012, BR-10). The verification itself is an external dependency (below).
9. **Resolved:** real and simulated records distinguished with `is_simulated` and `simulation_batch_id`, simulated records excluded from actual reports, and simulated batches removable without affecting real records (BR-09, NFR-031).
10. **Resolved:** a redelivery may attract the applicable delivery fee for the additional trip, disclosed and approved by the customer before rescheduling (FR-038); a cancellation after departure deducts verifiable delivery expenses actually incurred, never more than the delivery charge disclosed at checkout (FR-044).
11. **Resolved:** cash refunds are paid to a verified customer bank account with administrator approval; amount, reason, approval, reference and status recorded; approved refunds initiated within 48 hours as a target (FR-043). The bank account is verified through Paystack's Account Resolve API, and for the MVP an administrator approves each cash refund before it is processed.
12. **Resolved:** administrators configure vehicle types, verified payloads and availability; at most two trips per vehicle per order; larger orders need a larger vehicle or a manual quote; loads never exceed verified capacity (FR-013, BR-03). The actual vehicles and payloads are configuration data, entered by administrators.
13. **Resolved:** a configurable transactional email provider; SMS for phone verification and applicable notifications; support number +234 813 377 4902, centrally configured; WhatsApp support links only after WhatsApp is confirmed active on that number (FR-050, FR-055). A transactional email provider is an approved service (`CLAUDE.md`). **Open:** which provider.
14. **Resolved:** the delivery code is a separate 6-digit OTP with at most 5 attempts, **issued after unloading**, once the driver records that unloading is complete (#67); no automatic unloading-completion detection, drivers record unloading and delivery progress manually; administrators may approve alternative proof (FR-035). The **10-minute** validity is final (team decision, 19 October 2026).

The team must resolve the open points before coding the features that depend on them. Where external providers or regulatory approvals are unavailable, implement transparent manual fallback rather than imitating completed integration or compliance.

**External dependencies** (not decisions): Termii Sender ID approval and DND route activation for production SMS (FR-003); water-source laboratory verification, regulatory checks and operational arrangements before the real-world delivery pilot (FR-012, #13); confirming WhatsApp is active on the support number (FR-055).

## 13. Change history

**12 November 2026 (no version change, #407, agreed by @nnamdi-security (+ Codex) in PR #417; not implemented).** FR-011 and the §5 `water_sources` row gain the source fields automatic source selection needs: supplier contact, kind, pickup point, minimum and maximum litres per order, availability and allowed vehicle kinds. A source without a kind can no longer be activated or chosen. The cost per litre can be changed on its own and applies to new quotes only (FR-024, T-09). No stock levels.

**12 November 2026 (#411, PR #416; agreed by @nnamdi-security with Codex).**
Approved automatic confirmation and dispatch as target behavior, including
two-trip eligibility, one live assignment per driver, expiry/retry/escalation
and persistent manual control. This documentation does not enable automation.
#407/#408/#410, the window/operating-hours agreement and G2 designs remain
implementation gates. Existing source-safety and customer-agreement rules
remain in force; after pickup, source loss requires a hold and staff review.

**19 October 2026 (v0.3 amendment, #67).** The delivery code is issued after unloading, once the driver records that unloading is complete, instead of at arrival (FR-033 `arrived` and `unloading`, FR-035, illustrative API, T-22, §12 item 14). The 10-minute validity is unchanged and, by the team's later decision the same day, **final** (no longer provisional).

**v0.3 (19 October 2026).** Product decisions approved by the team (#55):

- Road distance from OSRM with delivery-zone rate fallback, never straight-line (FR-022, §12.1).
- Pricing: base delivery fee + distance charge + additional-trip charges + handling + fixed or percentage margin, supplier water cost per litre per category, margin percentage of water + delivery + handling, all rates admin-configurable, integer kobo, final amount rounded up to whole naira (FR-022, FR-024).
- Service zones with names, coordinates and optional polygons; orders only in active zones; delivery windows within capacity (FR-010, FR-025).
- Vehicles configured by administrators; at most two trips per vehicle per order (FR-013).
- Water categories **Potable Water** and **Utility Water**; Utility Water replaces the v0.2 pilot category "Domestic water"; laboratory verification before a supplier is activated for a category; source suspension on serious safety concerns (FR-012, FR-014, BR-10).
- Cash remittance to an administrator (finance officer) before 6:00 PM daily, every day an operating day (FR-041); redelivery fee for the additional trip with customer approval (FR-038); verifiable incurred costs on cancellation (FR-044); cash refunds to a bank account verified with Paystack's Account Resolve API, each approved by an administrator (FR-043).
- Delivery code: 6 digits, 5 attempts, 10 minutes provisional, activation timing open (#67); manual unloading records; GPS optional with prior consent; alternative proof evidence (FR-035).
- Customer unreachable: the driver waits the full 10 minutes and cannot mark it earlier (FR-038, T-25).
- Disputes within 48 hours, safety and contamination complaints at any time (FR-036, BR-16, T-28).
- Private document storage with access logging (NFR-006); simulated batches (`simulation_batch_id`; BR-09, NFR-031, T-29).
- Transactional email provider; WhatsApp support links only once confirmed (FR-050, FR-055).
- §12 updated: items 2-13 resolved, except where §12 says **Open** (deployment host and OSRM hosting; email provider); item 14 partly resolved (#67).

**19 October 2026 (no version change).** Open decision 14 added: delivery code validity (FR-035), raised by the driver design. FR-035 is unchanged.

**v0.2 (17 October 2026).** Approved business policies incorporated, with the technical lead's decisions of the same date:

- Phone verification by SMS OTP before the first order, phone number change, Termii and a mock provider (FR-003, FR-004).
- Water category "Domestic water"; potable label only with evidence (FR-014).
- Quantity presets 600–5,000 L, local gallon = 4 L, custom minimum 600 L (FR-021); replaces the 25–500 L pending defaults.
- Pricing formula with road distance, load capacity and trips; zone fallback; snapshot of breakdown and rates (FR-013, FR-022–FR-024).
- Order states `awaiting_payment` (prepaid only), `departed`, `arrived`, `unloading`; order status separate from payment status (FR-033, BR-12).
- Delivery code proof of delivery, GPS with permission, admin-approved alternative proof (FR-035); customer unreachable policy (FR-038).
- Paystack, verified bank transfer and pay on delivery for all amounts; payment statuses incl. `pending_collection`; cash custody and daily reconciliation (FR-040, FR-041).
- Refunds (FR-043) and customer cancellation charges (FR-044); FR-043 no longer assumes no automatic funds movement, since Paystack refunds are supported.
- SMS notifications for confirmed and dispatched orders, delivery code and payments (FR-050); support number +234 813 377 4902 (FR-055).
- Business rules BR-12 to BR-15; data model, illustrative API, NFR-002/003/004, edge cases and tests T-15 to T-27 updated accordingly; open decisions in §12 updated.

**v0.1 (13 October 2026).** Engineering review draft.
