/**
 * Admin domain types (design `a-*` screens and the added admin pages).
 *
 * No admin contract exists beyond the Sprint 1 order list/detail
 * (docs/api/orders.md), so these are served by mocks (src/mocks/adminMock.ts).
 * Field names follow the API conventions: snake_case, money as integer kobo in
 * `*_minor_units`, UTC ISO timestamps. Every naira amount here is a SAMPLE
 * (decision 10, 16).
 */
import type { CanSizeLitres, DeliveryType, PaymentMethod, PaymentStatus, TankSizeGallons, TankType, WaterChoice, WaterSource } from './orders'
import type { ApprovalStatus } from './partner'

/* ---------- Orders ---------- */

/**
 * Admin's view of where an order is, from the job and the customer order (a-orders).
 * `failed` and `disputed` show the backend statuses of the same name
 * (api-mapping.md open question 5, decided in #15). `awaiting_confirmation`
 * covers a quote request and a priced order before a dispatcher confirms
 * them: no rider can be assigned yet (admin-confirm-order.md, decision 3).
 */
export type AdminOrderStatus =
  | 'awaiting_confirmation'
  | 'awaiting_rider'
  | 'assigned'
  | 'loading'
  | 'on_the_way'
  | 'delivered'
  | 'cancelled'
  | 'failed'
  | 'disputed'

export const ADMIN_STATUS_LABEL: Record<AdminOrderStatus, string> = {
  awaiting_confirmation: 'Awaiting confirmation',
  awaiting_rider: 'Awaiting rider',
  assigned: 'Assigned',
  loading: 'Loading',
  on_the_way: 'On the way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  // The agreed staff labels (docs/api/orders.md, "Order statuses").
  failed: 'Delivery failed',
  disputed: 'Disputed',
}

/**
 * Payment status on admin screens: the design's statuses plus
 * `pending_collection` ("Cash to collect", decided by @chidimmamogbo on PR #92),
 * the status of a confirmed pay-on-delivery order before the driver collects;
 * and `partially_paid` ("Part paid", from the approved cash design,
 * docs/design/cash-remittance.md), when the driver collects less than due.
 */
export type AdminPaymentStatus = PaymentStatus | 'pending_collection' | 'partially_paid'

/**
 * Order list filters (a-orders pills). "In progress" covers assigned, loading
 * and on the way. "On hold" lists every order with an open hold, whatever its
 * status (admin-hold-review.md, R0).
 */
export type AdminOrderFilter = 'all' | 'awaiting_confirmation' | 'awaiting_rider' | 'in_progress' | 'on_hold' | 'delivered' | 'cancelled'

/** Why a driver's job is on hold (docs/api/deliveries.md, "Hold object on admin orders"). */
export type HoldKind = 'proof_review' | 'source_review' | 'unsafe_stop'

/** Staff words for the hold kinds (admin-hold-review.md, decision 12). */
export const HOLD_KIND_LABEL: Record<HoldKind, string> = {
  proof_review: 'Proof review',
  source_review: 'Source review',
  unsafe_stop: 'Unsafe stop',
}

const HOLD_CONCERN_LABEL: Partial<Record<string, string>> = {
  alternative_proof: 'Alternative proof',
  source_mismatch: 'Another source used',
  pickup_safety_concern: 'Safety concern at pickup',
  unsafe_access: 'Unsafe access',
  unsafe_transfer: 'Unsafe transfer',
}

/**
 * The kind of concern a hold opened with, in words (admin-hold-review.md,
 * decision 12). A category the app does not know has no label and shows no
 * concern line, never a raw code (decision 16).
 */
export const holdConcernLabel = (category: string): string | null => HOLD_CONCERN_LABEL[category] ?? null

const HOLD_DECISION_LABEL: Partial<Record<string, string>> = {
  proof_approved: 'Proof approved',
  proof_rejected: 'Proof rejected',
  source_continued: 'Source continued',
  unsafe_resumed: 'Delivery resumed after unsafe stop',
}

/**
 * The words for a decision recorded on a hold (deliveries.md, "GET .../history
 * (change)"). A hold closed by a fail, cancel or withdraw has none: its status
 * change shows it.
 */
export const holdDecisionLabel = (decision: string): string | null => HOLD_DECISION_LABEL[decision] ?? null

const END_REASON_LABEL: Partial<Record<string, string>> = {
  source_quality_concern: 'Source quality concern',
  unsafe_access: 'Unsafe access',
  customer_unreachable: 'Customer unreachable',
  vehicle_failure: 'Vehicle failure',
  other: 'Other',
  mmirioma_unable: 'MmiriOma is unable to deliver',
  customer_request: 'Customer asked to cancel',
}

/**
 * Why a delivery failed or an order was cancelled, in staff words
 * (admin-hold-review.md, FAIL and CANCEL), for the history. A reason the app
 * does not know has no label and shows no reason, never a raw code.
 */
export const endReasonLabel = (code: string): string | null => END_REASON_LABEL[code] ?? null

/** Whether a timeline line is a hold decision, to show the decided card on the panel. */
export const isHoldDecisionLabel = (label: string): boolean => Object.values(HOLD_DECISION_LABEL).includes(label)

/**
 * The open hold on an order's live job. A hold is not a status: the order keeps
 * its status while it is open. `id` is sent back with a decision.
 */
export interface AdminOrderHold {
  id: string
  kind: HoldKind
  /** When the hold opened (UTC ISO); shown as Lagos time and "12 minutes ago". */
  since: string
}

export interface AdminOrderPartner {
  id: string
  name: string
  /** Short fleet code shown on the map and tables, e.g. KK-014, TK-102. `null` when the server sends none. */
  code: string | null
  /** `null` when the server does not say which vehicle. */
  vehicle: DeliveryType | null
  /** `null` when the server sends no plate. */
  plate: string | null
}

export interface AdminOrder {
  reference: string
  created_at: string
  /** Customer account id, when the order belongs to one. */
  customer_id: string | null
  customer_name: string
  customer_phone: string
  /** The service zone's name, or `null` when the order has none. */
  area: string | null
  address: string
  landmark: string | null
  /** `null` for an order sent before #21, which carries only its litres. */
  choice: WaterChoice | null
  /** "50 L × 12", "750 gal". */
  quantity: string
  total_minor_units: number | null
  /** `status` is `null` when the server sends none (the order list, or before confirmation). */
  payment: { method: PaymentMethod; status: AdminPaymentStatus | null }
  status: AdminOrderStatus
  /**
   * The server's own order status behind `status`, for the few places that must
   * tell apart statuses the design groups: only a `confirmed` order can be
   * assigned, but `awaiting_rider` also covers `awaiting_payment` (#144). Absent
   * in mock mode, which has no such statuses.
   */
  backend_status?: string
  /** The order's open hold, or `null`. */
  hold: AdminOrderHold | null
  partner: AdminOrderPartner | null
  assigned_by: string | null
  /** Where the water is collected, once a source is chosen; `null` before. */
  station_name: string | null
  timeline: { label: string; at: string; detail?: string }[]
  instructions: string | null
  tank_note: string | null
}

/** A rider who could take an order now (a-orders "Eligible Keke riders"). */
export interface EligibleRider {
  id: string
  name: string
  /** `null` when the server does not say Keke or tanker (its vehicle type is free text). */
  vehicle: DeliveryType | null
  rating: number | null
  active_orders: number
  online: boolean
  /**
   * The rider lists the order's area among the areas they work in. No live
   * location (decision 14). `null` while the server does not check service
   * areas (deliveries.md, "Driver eligibility").
   */
  works_in_area: boolean | null
}

/* ---------- Customers ---------- */

export interface AdminCustomerSummary {
  id: string
  name: string
  phone: string
  phone_verified: boolean
  orders: number
}

export interface AdminCustomer extends AdminCustomerSummary {
  /** The backend has no email: `null`, and the real-mode screen shows none. */
  email: string | null
  customer_since: string
  total_paid_minor_units: number
  /** Not sent by the backend (points are out of the MVP): absent, and the real-mode screen hides it. */
  points?: number
  /** Not sent by the backend (no support tickets per customer): absent, and the real-mode screen hides it. */
  complaints?: number
  addresses: { id: string; label: string; address: string; landmark: string | null; is_default: boolean }[]
  /** `delivery_type` is `null` for an order created before delivery details existed (#21). */
  recent_orders: { reference: string; quantity: string; delivery_type: DeliveryType | null; created_at: string; status: AdminOrderStatus }[]
}

/* ---------- Riders and drivers ---------- */

export interface AdminRider {
  id: string
  name: string
  phone: string
  /** Fleet code. The backend has none (admin-directory.md, open question 9): `null`. */
  code: string | null
  /** `type` is `null` for a driver created with the command-line tool before sign-up asked for it. */
  vehicle: { type: DeliveryType | null; plate: string; tank_gallons: number | null }
  /**
   * Real API only: whether an admin has verified the vehicle (description and safe payload). Approving a partner
   * who has none records it (FR-013). Absent in the mock, which has no such step.
   */
  vehicle_verified?: boolean
  /** Real API only: what the partner typed at sign-up, shown as a claim next to the verified vehicle. */
  declared_vehicle?: { plate: string | null; capacity_gallons: number | null; capacity_litres: number | null }
  service_areas: string[]
  online: boolean
  approval: ApprovalStatus
  /** Not sent by the backend (partner pay is out of the MVP): absent, and the real-mode screen hides it. */
  today_minor_units?: number
  /** Delivered jobs only (#275). `null` when the server does not send the count (an older backend): the screen shows "Not known yet". */
  trips: number | null
  rating: number | null
  /** Not sent by the backend (partner pay is out of the MVP): absent, and the real-mode screen hides it. */
  payout_due_minor_units?: number
  /** "Papers due 31 Oct", "Papers valid". Not sent by the backend (papers are checked in person): absent in real mode. */
  documents_note?: string
  active_orders: number
  /** Not sent by the backend (no partner support tickets): absent, and the real-mode screen hides it. */
  reported_issues?: number
  partner_since: string
}

/* ---------- Stations and service areas ---------- */

export interface AdminStation {
  id: string
  name: string
  address: string
  area: string
  open: boolean
  /** "6 AM to 8 PM". */
  hours: string
  /** "Keke cans, tanker". */
  products: string
  /** Daily capacity; null shows the design's `[CAPACITY]` placeholder. */
  capacity: string | null
  /** Water-source papers (FR-012). `valid_until` null shows `[DATE]`. */
  papers: { verified_on: string | null; valid_until: string | null; file_name: string | null }
  loading_now: number
  today: number
  loading_log: { at: string; reference: string; partner: string; quantity: string }[]
}

/** Papers state, derived from the expiry date (FR-012: expired papers block new orders). */
export type PapersState = 'valid' | 'expiring' | 'expired' | 'missing'

/** A station as the admin screens get it: with its papers state worked out by the server. */
export type AdminStationView = AdminStation & { papers_state: PapersState }

export interface ServiceArea {
  id: string
  name: string
  /** Orders to this area are accepted. */
  enabled: boolean
  /**
   * The area's coordinates, WGS 84 decimal degrees, typed in by admin since no
   * map provider is approved (FR-010, docs/api/admin-directory.md, `centre`).
   * Latitude -90 to 90, longitude -180 to 180.
   */
  centre: { latitude: number; longitude: number }
  /**
   * Delivery fee per order for the pilot water category (Z4, "Delivery fee per
   * order (₦)"). `null`: no fee, so quotes for the area become manual.
   */
  fixed_fee_minor_units: number | null
}

/* ---------- Pricing, points, payouts ---------- */

export interface TankerPriceRow {
  water_minor_units: Record<WaterSource, number>
  delivery_minor_units: number
  driver_pay_minor_units: number
}

/**
 * A price list rule's margin (docs/api/admin-directory.md, "Price lists"):
 * a percentage of water + delivery + handling in basis points (1 % = 100),
 * or a fixed amount in kobo.
 */
export type PriceMargin = { type: 'percentage'; basis_points: number } | { type: 'fixed'; amount_minor_units: number }

/**
 * One rule of a price list (FR-022, admin-directory.md "Object"). `zone_id`
 * and `water_category_id` `null` mean every area / every water. Amounts are
 * kobo. In the pilot the zone fee replaces the whole delivery cost, so the
 * three road-distance rates are saved but change no price
 * (order-details-and-price.md, "Pilot note").
 */
export interface PriceRule {
  zone_id: string | null
  water_category_id: string | null
  /** At least 600 (FR-021); inclusive. */
  min_litres: number
  /** `null` for no upper limit; inclusive. */
  max_litres: number | null
  base_delivery_fee_minor_units: number
  distance_rate_minor_units_per_km: number
  additional_trip_minor_units: number
  handling_minor_units: number
  margin: PriceMargin
}

/** One field that changed from the previous version: `rules[i].<field>` or `rules[i]` for an added rule (`from` `null`). */
export interface PriceListChange {
  path: string
  from: unknown
  to: unknown
}

/**
 * One saved version of the FR-022 price list (admin-directory.md, "Price
 * lists", built in #37). Versions are never edited; saving makes the next
 * one, and quotes and orders keep the version they used (FR-024).
 */
export interface PriceList {
  version: number
  /** UTC; the time it was saved (no future dating). */
  effective_from: string
  created_by: { id: string; name: string }
  reason: string | null
  rules: (PriceRule & { id: string })[]
  /** Empty on version 1. */
  changes: PriceListChange[]
}

/** `PriceListCreate`: the whole new set of rules, from the version the admin opened. */
export interface PriceListDraft {
  /** The version edited, `null` for the first list. */
  base_version: number | null
  reason: string | null
  rules: PriceRule[]
}

/** A water category for the Pricing screen's Water picker (`GET /admin/water-categories`, #160). */
export interface WaterCategoryOption {
  id: string
  label: string
  is_active: boolean
}

/**
 * The mock-era flat price table (a-pricing before #173): can and tank
 * prices, partner pay, delivery switches and points. Used only by the mock
 * layer (sample quotes, Service areas, Loyalty points); the real Pricing
 * screen uses `PriceList`, which FR-022 defines.
 */
export interface SamplePriceTable {
  version: number
  created_at: string
  created_by: string
  /** Change summary for the log, e.g. "Tanker 750 gal ₦24,000 → ₦25,000". */
  note: string
  keke: { can_minor_units: Record<CanSizeLitres, number>; delivery_minor_units: number; rider_pay_minor_units: number }
  tanker: Record<TankSizeGallons, TankerPriceRow>
  /**
   * Delivery fee methods (decision 10a). With both off, each order pays the
   * delivery fee in the tables above. "Fixed fee per area" wins when the
   * area has a fee; otherwise "rate per km" uses the area's distance.
   */
  delivery_fee: { per_km_enabled: boolean; per_km_minor_units: number; per_area_enabled: boolean }
  /** Sample loyalty rule (decision 16). */
  points: { naira_per_point: number; round_to: number; welcome_bonus: number; naira_per_redeemed_point: number }
}

/** What admin edits on the pricing pages; the server adds version, time and author. */
export type SamplePriceTableInput = Omit<SamplePriceTable, 'version' | 'created_at' | 'created_by' | 'note'>

export interface AdminPayment {
  reference: string
  customer_id: string | null
  customer_name: string
  amount_minor_units: number | null
  method: PaymentMethod
  status: PaymentStatus
  order_status: AdminOrderStatus
  created_at: string
}

export interface AdminPayout {
  id: string
  partner_id: string
  partner_name: string
  code: string
  amount_minor_units: number
  status: 'requested' | 'paid'
  at: string
  account_ending: string | null
}

export interface AdminPartnerEarnings {
  partner_id: string
  name: string
  code: string
  vehicle: DeliveryType
  wallet_minor_units: number
  week_minor_units: number
  trips: number
}

/* ---------- Support, audit, activity ---------- */

export type IssueType =
  | 'code_not_working'
  | 'late'
  | 'customer_unreachable'
  | 'wrong_quantity'
  | 'quality_concern'
  | 'unsafe_access'
  | 'station_problem'
  | 'other'

export type ResolutionAction = 'confirm_without_code' | 'reassign' | 'goodwill_points' | 'cancel_order' | 'call_and_close'

export const RESOLUTION_LABEL: Record<ResolutionAction, string> = {
  confirm_without_code: 'Confirm delivery without code',
  reassign: 'Reassign or reschedule',
  goodwill_points: 'Add goodwill points',
  cancel_order: 'Cancel order',
  call_and_close: 'Call both and close',
}

export interface AdminIssue {
  id: string
  /** "#CP-012". */
  number: string
  type: IssueType
  title: string
  /** What the reporter wrote. */
  message: string
  reference: string | null
  reported_by: 'customer' | 'rider' | 'driver'
  reporter_name: string
  at: string
  urgent: boolean
  status: 'open' | 'resolved'
  /** The real backend resolves with a note only, so it sends no `action` and no `points`: they belong to the mock. */
  resolution: { action?: ResolutionAction; reason: string; by: string; at: string; points?: number } | null
}

export interface AuditEntry {
  id: string
  at: string
  actor: string
  /** "Assigned MO-3HT8 to Chinedu Okafor". */
  action: string
  /**
   * The staff reason a decision carries, where the backend stores one: today the driver approval, suspension,
   * activation and deactivation rows (`details.reason`). `null` for every other row.
   */
  reason: string | null
  /**
   * What the row is about, in words and a short id ("Driver · 4f3a2c"; docs/design/admin-audit-log.md), until the
   * backend sends a label for the record (#296). `null` or absent when the server sends no target.
   */
  target?: string | null
}

export type ActivityKind = 'accepted' | 'new_order' | 'online' | 'delivered' | 'complaint' | 'admin'

export interface ActivityEntry {
  id: string
  at: string
  kind: ActivityKind
  text: string
  reference: string | null
}

export interface AdminNotification {
  id: string
  at: string
  title: string
  body: string
  read: boolean
  /** In-app path to open. */
  link: string
}

/* ---------- Dashboard, reports, settings ---------- */

export interface AdminDashboard {
  date: string
  orders: { total: number; awaiting_rider: number; in_progress: number; delivered: number; cancelled: number; oldest_waiting_minutes: number | null }
  disputes_open: number
  riders_online: { total: number; keke: number; tanker: number }
  stations: { open: number; closed: number }
  revenue_today_minor_units: number
  /** Not sent by the backend (payouts are out of the MVP): the card is hidden when absent, never shown as zero. */
  payouts_due?: { amount_minor_units: number; riders: number }
  /** Not sent by the backend (transfers are not verified in the pilot): the card is hidden when absent. */
  payments_to_verify?: number
  by_type: { keke: number; tanker: number }
  /** True when the numbers come from simulated records (`is_simulated`), so the screen shows its SAMPLE tag. */
  is_sample: boolean
}

export type ReportRange = 'today' | '7d' | '30d'

export interface AdminReport {
  range: ReportRange
  orders: number
  delivered: number
  cancelled: number
  revenue_minor_units: number
  by_type: { keke: number; tanker: number }
  by_area: { area: string; orders: number; delivered: number }[]
  /**
   * `code` is the plate, `null` when the driver has none. `earned_minor_units` is not sent by the backend (partner pay is out of the MVP):
   * the "Earned" column is hidden when absent, never shown as zero.
   */
  by_rider: { name: string; code: string | null; trips: number; earned_minor_units?: number }[]
  by_station: { name: string; loads: number }[]
  /** True when the numbers come from simulated records (`is_simulated`), so the screen shows its SAMPLE tag. */
  is_sample: boolean
}

export interface StaffMember {
  id: string
  name: string
  /** The backend has one staff role, `Admin`; the mock keeps its three. */
  role: 'Admin' | 'Super admin' | 'Dispatcher' | 'Support'
  phone: string
  /** The newest sign-in; `null` if the staff member never signed in. The backend has no "last active". */
  last_active: string | null
}

export interface AdminSettings {
  support_phone: string | null
  /** `[SUPPORT HOURS]` until set. */
  support_hours: string | null
  /** `[CODE TIME LIMIT]` until set. */
  code_time_limit: string | null
  /** Safe load per vehicle type, `[SAFE LOAD]` until set. */
  safe_load: { keke: string | null; tanker: string | null }
}

/** Inputs for admin forms. */
export interface CreateOrderByAdminInput {
  customer_id: string
  choice: WaterChoice
  address_id: string
  payment_method: PaymentMethod
  /** Assign this rider straight away, or leave the order in the pool. */
  assign_to: string | null
}

export interface NewCustomerInput {
  name: string
  phone: string
}

export interface NewAddressInput {
  label: string
  address: string
  landmark: string | null
  /** The service zone the address is in. The real API requires it (FR-020); the mock does not. */
  zone_id?: string | null
}

/** What an admin verified when approving a partner (FR-013); the real API requires it when the partner has none yet. */
export interface ApprovalVehicleInput {
  /** The vehicle profile's type text, 1 to 50 characters, for example "Tanker truck". */
  description: string
  /** The verified safe payload per trip, 1 to 100,000 litres. */
  safe_payload_litres: number
  transfer_methods: ('ground' | 'overhead')[]
}

export interface NewRiderInput {
  name: string
  phone: string
  vehicle_type: DeliveryType
  plate: string
  tank_gallons: number | null
  service_area: string
}

export interface StationInput {
  name: string
  address: string
  area: string
  hours: string
  products: string
  capacity: string | null
}

export type { TankType }
