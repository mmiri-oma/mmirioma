/**
 * Delivery partner (Keke rider and tanker driver) domain types. One server
 * role, `driver` (docs/api/auth.md); the vehicle type chosen at sign-up
 * decides which app and which orders the partner sees (decision 9).
 *
 * No contract exists yet; served by mocks. Money in kobo, times in UTC.
 */
import type { JobCash } from '../lib/api/driverCash'
import type { WaterChoice } from './orders'

export type VehicleType = 'keke' | 'tanker'
export type ApprovalStatus = 'pending' | 'approved' | 'suspended'

/**
 * Where a job is for this partner.
 *
 * - `available`: in the pool, any eligible partner may accept (no countdown).
 * - `assigned`: admin assigned it to this partner; not accepted yet. The
 *   partner may accept, or decline with a reason (decision 13).
 * - `accepted`: accepted, heading to the refill station.
 * - `collected`: water collected, heading to the customer.
 * - `delivered`: completed with the customer's code.
 * - `cancelled`: cancelled by admin.
 * - `failed`: a delivery attempt failed, e.g. the customer was unreachable
 *   (FR-038). Shown as "Delivery failed".
 * - `under_review`: the order is disputed and staff are reviewing it.
 *   Shown as "Under review".
 *
 * `failed` and `under_review` follow the customer stages (api-mapping.md,
 * decision 3; @chidimmamogbo on #12). History shows them; they are never
 * hidden.
 */
export type JobStage = 'available' | 'assigned' | 'accepted' | 'collected' | 'delivered' | 'cancelled' | 'failed' | 'under_review'

/** Words for the stages a job can end in, for history lists. */
export const ENDED_STAGE_LABEL: Partial<Record<JobStage, string>> = {
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  failed: 'Delivery failed',
  under_review: 'Under review',
}

export interface JobPlace {
  name: string
  /**
   * Full address. `null` with the real API when the job does not carry it:
   * history and ended jobs (summary fields only), and the customer's address
   * on an offer. Screens then show `area` (@chidimmamogbo on #12).
   */
  address: string | null
  /** Area name for lists ("GRA", "Independence Layout"). */
  area: string
  /**
   * Distance and time from the previous point. Sample estimates in mock
   * mode; `null` with the real API, which has no road distance (no OSRM,
   * SRS §12.1). Screens hide them when `null`.
   */
  distance_km: number | null
  minutes: number | null
  landmark?: string | null
}

/**
 * One job as the partner sees it. There is no payment status: partners must
 * not see an order's payment status (FR-040, BR-13; docs/design/driver-cash.md,
 * decision 3). The K1 Cash card (#20) takes its place on the done screens.
 */
export interface PartnerJob {
  reference: string
  /** Ordered litres. Always known; the server stores litres (FR-021). */
  quantity_litres: number
  /**
   * The cans or tank the customer chose. `null` until the backend sends
   * them (#21); screens then show `quantity_litres` in litres and gallons.
   */
  choice: WaterChoice | null
  /** Ground or overhead details for tanker jobs ("Overhead tank on a 3 m stand..."). */
  tank_note: string | null
  station: JobPlace
  /**
   * `contact_name` and `phone` are `null` with the real API before the
   * partner accepts (FR-032: no receiver on an offer) and after the job ends.
   * Screens then name the area only and show no call or message button
   * (@chidimmamogbo on #12).
   */
  customer: JobPlace & { contact_name: string | null; phone: string | null }
  instructions: string | null
  /**
   * What the partner earns for the trip. SAMPLE rider pay (decision 16) in
   * mock mode; `null` with the real API, since partner pay is out of the MVP
   * (docs/api/partners.md, decision 7). Screens hide the line when `null`.
   */
  earning_minor_units: number | null
  stage: JobStage
  /** Admin who assigned it, when stage is `assigned`; `null` when unknown. */
  assigned_by: string | null
  /**
   * Code tries left before admin must confirm the delivery. `null` before
   * the code is issued; the code screen then shows "waiting for the code",
   * never "locked" (@chidimmamogbo on #12).
   */
  code_tries_left: number | null
  /** When a new code may be requested again (UTC ISO). */
  code_resend_at: string | null
  /**
   * Whether the SMS provider accepted the customer's code. `'failed'` means
   * the code was recorded but not sent, so the code screen must not say it
   * was sent (FR-050, #138). `null` or absent: no code issued yet.
   */
  code_sms_status?: 'accepted' | 'failed' | null
  accepted_at: string | null
  collected_at: string | null
  delivered_at: string | null
  /** Pickup checklist and optional photo, recorded at the station (FR-034). */
  pickup: { loaded: boolean; receipt: boolean; photo_url: string | null; gallons_loaded: number | null } | null
  /** The partner's own estimate to the customer once collected (sample). */
  remaining: { distance_km: number; minutes: number } | null
  /**
   * The K1 Cash card (docs/design/driver-cash.md, #20): the amount due and the
   * cash recorded, from the job's `cash` object (payments.md, amendment 2).
   * `null` or absent until unloading is complete, and on a job that ended
   * without unloading (no card).
   */
  cash?: JobCash | null
  /**
   * When the partner pressed "I have arrived" at the customer (UTC ISO, the
   * server's time; FR-038, docs/design/driver-arrival-unreachable.md, U1 and
   * U2). `null` or absent before arrival. Self-reported: no location is sent.
   */
  arrived_at?: string | null
  /**
   * The times of the partner's attempts to reach the customer (UTC ISO,
   * server time, oldest first; FR-038, U3). Empty or absent before the first
   * attempt. There is no maximum: every attempt is recorded.
   */
  contact_attempts?: string[]
  /**
   * The earliest time the partner may end the job as "customer not
   * reachable": `arrived_at` plus the full 10 minutes (FR-038, U3 "wait
   * until"). `null` or absent before arrival.
   */
  unreachable_allowed_at?: string | null
  /**
   * Whether the server offers "Start unloading" now (`allowed_actions`
   * contains `start_unloading`). Tells U2 from the code screen, since both
   * arrived and unloading are stage `collected`. Absent: not known, as in mock
   * mode.
   */
  can_start_unloading?: boolean
  /**
   * Whether the server allows ending the job as "customer not reachable"
   * (`allowed_actions` contains `record_failed_attempt`: two attempts recorded
   * and `unreachable_allowed_at` passed). The phone's clock never decides
   * this (design decision 6). Absent: not known, as in mock mode.
   */
  can_fail_unreachable?: boolean
  /**
   * When the job ended (UTC ISO, the server's time): the backend's `ended_at`.
   * `null` or absent while the job is open. Used for a failed job's "Recorded
   * at" time and its history row (docs/design/driver-arrival-unreachable.md, U4).
   */
  ended_at?: string | null
  /**
   * Why a failed or cancelled job ended, as the backend's reason code, e.g.
   * `customer_unreachable` (FR-038). `null` or absent while the job is open or
   * when it was delivered.
   */
  end_reason?: string | null
  /**
   * Mock mode only: the customer's code, so a demo can finish a delivery
   * without the customer's phone. Never sent by a real server.
   */
  demo_code?: string
}

export interface PartnerDocument {
  id: string
  name: string
  /** `checking`: uploaded, waiting for admin to check it. */
  status: 'valid' | 'expiring' | 'done' | 'missing' | 'checking'
  /** "Checked 14 Aug 2026", "Expires 31 Oct 2026". */
  note: string
  can_upload: boolean
}

export interface PartnerProfile {
  name: string
  phone: string
  approval: ApprovalStatus
  online: boolean
  partner_since: string
  vehicle: {
    type: VehicleType
    plate: string
    /** "Blue tricycle", "1,000 gal (4,000 L) tank". */
    description: string
    /** Tank size for tanker drivers; null for Keke. */
    tank_gallons: number | null
    /** Placeholder until verified: shown as `[SAFE LOAD]`. */
    safe_load_litres: number | null
    can_pour_into: string
  }
  service_areas: string[]
  documents: PartnerDocument[]
  /** No email and no "News and offers" for partners in the pilot (#85). */
  preferences: { new_order_alerts: boolean; sms_updates: boolean }
  /** Bank account ending, for payouts. */
  payout_account_ending: string | null
}

export interface EarningEntry {
  reference: string
  at: string
  amount_minor_units: number
  status: 'pending' | 'completed'
  /** "750 gal", "25 L × 24" for lists. */
  label: string
}

export interface PayoutEntry {
  id: string
  at: string
  amount_minor_units: number
  status: 'requested' | 'paid'
}

export interface PartnerEarnings {
  wallet_minor_units: number
  today_minor_units: number
  deliveries_today: number
  week_minor_units: number
  trips_this_week: number
  gallons_this_week: number
  /** Last 7 days, oldest first; the last one is today. */
  week: { day: string; amount_minor_units: number }[]
  entries: EarningEntry[]
  payouts: PayoutEntry[]
  is_sample: boolean
}

export interface PartnerNotification {
  id: string
  /** `reassigned`: admin moved or cancelled an order the partner had; `account`: approved, suspended or reactivated. */
  kind: 'assigned' | 'new_orders' | 'payout' | 'station_closed' | 'papers_due' | 'reassigned' | 'account'
  title: string
  body: string
  at: string
  read: boolean
  reference: string | null
}

/**
 * The newest notifications, plus the unread count across all of them. The
 * list may be one page (the real API sends the newest 50), so badges and
 * "Mark all read" use `unread_count`, never the unread items in the list.
 */
export interface PartnerNotificationList {
  items: PartnerNotification[]
  unread_count: number
}

export type PartnerIssueType =
  | 'customer_unreachable'
  | 'unsafe_pour'
  | 'bad_address'
  | 'station_problem'
  | 'vehicle_breakdown'
  | 'code_not_working'

export const ISSUE_LABEL: Record<PartnerIssueType, (vehicle: VehicleType) => string> = {
  customer_unreachable: () => 'Customer not reachable',
  unsafe_pour: () => 'Cannot pour safely',
  bad_address: () => 'Wrong or unclear address',
  station_problem: () => 'Problem at the station',
  vehicle_breakdown: (v) => (v === 'keke' ? 'My keke broke down' : 'My tanker broke down'),
  code_not_working: () => 'Delivery code not working',
}

/** Valid reasons to decline an order admin assigned (decision 13). */
export type DeclineReason = 'vehicle_problem' | 'outside_area' | 'station_unavailable' | 'too_large' | 'not_available'

export const DECLINE_LABEL: Record<DeclineReason, (vehicle: VehicleType) => string> = {
  vehicle_problem: (v) => (v === 'keke' ? 'My keke has a problem' : 'My tanker has a problem'),
  outside_area: () => 'Outside my service area',
  station_unavailable: () => 'Station closed or no water',
  too_large: (v) => (v === 'keke' ? 'Too much for my keke' : 'Too much for my tank'),
  not_available: () => 'I am not available now',
}

export interface PartnerSignupInput {
  name: string
  phone: string
  password: string
  vehicle_type: VehicleType
  plate: string
  /** Tanker drivers only. */
  tank_gallons: number | null
  /** ID of an active service zone chosen from {@link SignupArea}s (`GET /service-zones`). */
  service_zone_id: string
}

/** An area a new partner can choose at sign-up: an active service zone, by name. */
export interface SignupArea {
  id: string
  name: string
}
