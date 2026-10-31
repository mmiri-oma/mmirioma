/**
 * Types and typed calls for the admin dispatch endpoints, mirroring
 * docs/api/deliveries.md, "Admin dispatch endpoints" (agreed, G3).
 *
 * The parts of a response that drive screen logic (the assignment's status,
 * a driver's eligibility reasons, history events) are checked at runtime with
 * Zod: a value the screens do not know would otherwise show the wrong state
 * silently. A response that does not match is reported as an `ApiError` with
 * code `invalid_response`, like any other unusable response.
 *
 * If the contract changes, update these types and schemas in the same PR.
 */

import { z } from 'zod'
import type { AdminOrderRead, AdminOrderStatus } from './adminOrders'
import { collectionSchema } from './adminCash'
import { apiClient, ApiError, type ApiClient } from './client'
import { confirmationLineSchema, orderConfirmationSchema, type OrderConfirmation } from './confirmationTypes'
import { EXCEPTION_CATEGORIES, HOLD_KINDS, HOLD_RESOLUTIONS, orderHoldSchema } from './holdTypes'

/** Assignment statuses (deliveries.md, "Assignment statuses"). */
export const ASSIGNMENT_STATUSES = ['offered', 'accepted', 'declined', 'expired', 'withdrawn', 'completed'] as const
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number]

/** Why a driver declined (driver design J2-b). */
export const DECLINE_REASONS = ['not_available', 'vehicle_cannot_carry', 'too_far', 'unsafe_access', 'other'] as const
export type DeclineReason = (typeof DECLINE_REASONS)[number]

/** Why a driver cannot take an order (deliveries.md, "Driver eligibility"), in the server's fixed order. */
export const ELIGIBILITY_REASONS = [
  'not_a_driver',
  'inactive',
  'not_approved',
  'no_driver_profile',
  'unavailable',
  'vehicle_inactive',
  'over_payload',
  'busy',
] as const
export type EligibilityReason = (typeof ELIGIBILITY_REASONS)[number]

/** Reason codes recorded with a transition (deliveries.md, "Transitions"). */
export const TRANSITION_REASONS = [
  'driver_declined',
  'reassigned',
  'assignment_expired',
  'recorded_for_driver',
  'customer_unreachable',
  'unsafe_access',
  'vehicle_failure',
  'source_quality_concern',
  'rescheduled',
  'customer_request',
  'mmirioma_unable',
  'missing_quantity',
  'water_quality',
  'handling',
  'dispute_resolved',
  // Row 26 (order confirmation contract, PR #111): accepted here before the
  // backend sends it (#113), because an unknown code fails the history parse.
  'manual_quote',
  'other',
] as const
export type TransitionReason = (typeof TRANSITION_REASONS)[number]

const ORDER_STATUSES = [
  'quote_requested',
  'awaiting_payment',
  'awaiting_confirmation',
  'confirmed',
  'assigned',
  'accepted',
  'departed',
  'collected',
  'en_route',
  'arrived',
  'unloading',
  'delivered',
  'cancelled',
  'failed',
  'disputed',
] as const satisfies readonly AdminOrderStatus[]

const personSchema = z.object({ id: z.string(), name: z.string() })
const vehicleSchema = z.object({ type: z.string(), safe_payload_litres: z.number().int() })

/** `AdminAssignment`: one offer of the order to one driver. */
export const adminAssignmentSchema = z.object({
  id: z.string(),
  status: z.enum(ASSIGNMENT_STATUSES),
  driver: personSchema,
  /** The driver's current vehicle, or `null` if none is recorded. */
  vehicle: vehicleSchema.nullable(),
  offered_by: personSchema,
  /** UTC ISO timestamp of the offer. */
  offered_at: z.string(),
  /** When the driver accepted or declined; `null` before. */
  responded_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  decline_reason: z.enum(DECLINE_REASONS).nullable(),
  /** The driver's own words with a decline (up to 300 characters). */
  decline_note: z.string().nullable(),
})
export type AdminAssignment = z.infer<typeof adminAssignmentSchema>

/**
 * One attempt to reach the customer after arrival (FR-038): the server's time,
 * UTC. Times only; the contract sends no name, number or note
 * (deliveries.md, "Amendment (#280)").
 */
export const contactAttemptSchema = z.object({ attempted_at: z.string() })
export type ContactAttempt = z.infer<typeof contactAttemptSchema>

/**
 * `AdminOrderDetail`: the order plus its **most recent** assignment, live or
 * ended, or `null` if it was never offered, the confirmation fields
 * (category, source, window, price snapshot, SMS outcome; `null` until
 * confirmed), `payment` (`null` until confirmed) and `contact_attempts`
 * (every attempt on the order, oldest first, empty if none). `hold` is in
 * `AdminOrderRead`.
 */
export type AdminOrderDetail = AdminOrderRead & { assignment: AdminAssignment | null } & OrderConfirmation & {
  payment: OrderPayment | null
  contact_attempts: ContactAttempt[]
}

/** `DispatchDriver`: one driver and their eligibility for this order. */
export const dispatchDriverSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** `null` when the driver has no profile (`no_driver_profile`). */
  vehicle: vehicleSchema.nullable(),
  /** Every problem for this order; empty means the driver can be offered it. */
  reasons: z.array(z.enum(ELIGIBILITY_REASONS)),
})
export type DispatchDriver = z.infer<typeof dispatchDriverSchema>

const driverListSchema = z.object({ items: z.array(dispatchDriverSchema) })

/**
 * Cash history events (docs/api/payments.md, "AdminOrderDetail.payment" and
 * the order history; #123). None changes the order status.
 */
export const CASH_EVENT_KINDS = [
  'cash_recorded',
  'cash_handed_over',
  'cash_corrected',
  'cash_received',
  'cash_reconciled',
] as const
export type CashEventKind = (typeof CASH_EVENT_KINDS)[number]

/**
 * Order payment statuses (FR-040; payments.md, "Payment status"). The pilot
 * uses the first three; the rest are listed so a later server value is
 * read, not rejected.
 */
export const PAYMENT_STATUSES = [
  'pending_collection',
  'partially_paid',
  'paid',
  'unpaid',
  'awaiting_verification',
  'partially_refunded',
  'refunded',
  'disputed',
] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

/** Every history entry kind the screens know; `other` stands for any kind they do not. */
const EVENT_KINDS = ['status_change', 'hold_opened', 'hold_decided', ...CASH_EVENT_KINDS, 'other'] as const

/**
 * `AdminOrderEvent`: one history entry (H1), as returned with
 * `include=holds` (decision 8). `kind` is `status_change` for an order
 * event; `hold_opened` and `hold_decided` entries have null statuses and
 * carry `hold`; the cash events have null statuses.
 *
 * The cash events are accepted before the backend sends them (#125, first
 * step, ahead of #123), because a history the client cannot parse fails
 * as a whole. For the same reason a kind the client does not know reads as
 * `other` and the fields only status changes need read as `null` when
 * missing: the history keeps working when the server adds an event.
 */
export const adminOrderEventSchema = z.object({
  id: z.string(),
  /** A missing `kind` (a server without hold entries) reads as a status change; an unknown one as `other`. */
  kind: z.enum(EVENT_KINDS).default('status_change').catch('other'),
  from_status: z.enum(ORDER_STATUSES).nullable().default(null),
  /** `null` on hold and cash entries. */
  to_status: z.enum(ORDER_STATUSES).nullable().default(null),
  /** `null` for the system. */
  actor: z
    .object({ id: z.string(), role: z.enum(['customer', 'admin', 'driver']), name: z.string() })
    .nullable(),
  reason_code: z.enum(TRANSITION_REASONS).nullable().default(null),
  note: z.string().nullable().default(null),
  created_at: z.string(),
  /** Set on offer, accept, decline and withdraw events (rows 8-11). */
  assignment: z
    .object({ id: z.string(), driver: personSchema, decline_reason: z.enum(DECLINE_REASONS).nullable() })
    .nullable()
    .default(null),
  /** The hold a hold entry is about; `decision` only on `hold_decided`. Missing reads as none. */
  hold: z
    .object({
      id: z.string(),
      kind: z.enum(HOLD_KINDS),
      category: z.enum(EXCEPTION_CATEGORIES),
      decision: z.enum(HOLD_RESOLUTIONS).nullable(),
    })
    .nullable()
    .default(null),
  /** Set only on the status change that confirmed the order (row 7). Missing reads as none. */
  confirmation: confirmationLineSchema.nullable().default(null),
  /**
   * Set only on cash entries (payments.md, amendment 1): the amount after the
   * step; the previous amount on `cash_corrected`; the payment status,
   * outstanding balance and SMS outcome on `cash_received`. Missing reads as none.
   */
  cash: z
    .object({
      collection_id: z.string(),
      amount_minor_units: z.number().int(),
      previous_amount_minor_units: z.number().int().nullable().default(null),
      payment_status: z.enum(PAYMENT_STATUSES).nullable().default(null),
      outstanding_balance_minor_units: z.number().int().nullable().default(null),
      sms_status: z.enum(['accepted', 'failed']).nullable().default(null),
    })
    .nullable()
    .default(null),
})
export type AdminOrderEvent = z.infer<typeof adminOrderEventSchema>

const historySchema = z.object({ items: z.array(adminOrderEventSchema) })

/** Body of `POST .../withdraw`: the assignment status the dispatcher saw. */
export interface WithdrawRequest {
  expected_status: 'offered' | 'accepted'
  /** Optional, up to 500 characters; empty is stored as `null`. */
  note: string | null
}

/**
 * Check a response against a schema.
 *
 * @throws {ApiError} `invalid_response` if it does not match.
 */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ApiError({
      kind: 'parse',
      status: 200,
      code: 'invalid_response',
      message: 'The server returned an unexpected response.',
      cause: result.error,
    })
  }
  return result.data
}

/**
 * Check the dispatch, hold and confirmation parts of an order detail. A
 * missing `assignment` reads as "never offered", a missing `hold` as no hold
 * and a missing confirmation field as `null` (an older server). A missing
 * `contact_attempts` reads as none, so a server that does not send it yet
 * (#280) leaves the timeline as it was.
 */
export function parseDetail(value: unknown): AdminOrderDetail {
  const order = value as AdminOrderRead & { assignment?: unknown; hold?: unknown }
  const assignment = parse(adminAssignmentSchema.nullable(), order.assignment ?? null)
  const hold = parse(orderHoldSchema.nullable(), order.hold ?? null)
  const confirmation = parse(orderConfirmationSchema, value)
  const payment = parse(orderPaymentSchema.nullable(), (value as { payment?: unknown }).payment ?? null)
  const contact_attempts = parse(z.array(contactAttemptSchema), (value as { contact_attempts?: unknown }).contact_attempts ?? [])
  return { ...order, assignment, hold, ...confirmation, payment, contact_attempts }
}

/**
 * `AdminOrderDetail.payment` (payments.md, "AdminOrderDetail additions"),
 * for the K6 payment card. The order status and the payment status are
 * separate and never inferred from each other (BR-12, T-24).
 */
const orderPaymentSchema = z.object({
  method: z.string(),
  status: z.enum(PAYMENT_STATUSES),
  outstanding_balance_minor_units: z.number().int(),
  overpaid_minor_units: z.number().int(),
  /** The order's one cash collection, or `null` before the driver records it. */
  cash_collection: collectionSchema.nullable(),
  /** A counted difference at receipt of the remittance that took this order's cash (decision 1). */
  remittance_difference: z
    .object({ difference_minor_units: z.number().int(), note: z.string().nullable(), remittance_id: z.string() })
    .nullable(),
  /** The payment SMS: `null` before receipt or when none was due (₦0.00). */
  sms_status: z.enum(['accepted', 'failed']).nullable(),
})
export type OrderPayment = z.infer<typeof orderPaymentSchema>

const orderPath = (reference: string) => `/api/v1/admin/orders/${encodeURIComponent(reference)}`

/**
 * Load one order with its most recent assignment (`GET /admin/orders/{reference}`).
 *
 * @param reference - Order reference, e.g. `MO-7KQ2M9XH4T`.
 * @param signal - Cancels the request.
 * @param client - Override for tests; defaults to the shared client.
 * @throws {ApiError} `order_not_found` (404); `invalid_response`; shared 401/403.
 */
export async function getAdminOrderDetail(
  reference: string,
  signal?: AbortSignal,
  client: ApiClient = apiClient,
): Promise<AdminOrderDetail> {
  return parseDetail(await client.request<unknown>(orderPath(reference), { signal }))
}

/**
 * Every driver with their eligibility for this order (`GET .../drivers`, D1).
 *
 * @throws {ApiError} `order_not_found` (404); `invalid_response`.
 */
export async function listDispatchDrivers(
  reference: string,
  signal?: AbortSignal,
  client: ApiClient = apiClient,
): Promise<DispatchDriver[]> {
  const body = await client.request<unknown>(`${orderPath(reference)}/drivers`, { signal })
  return parse(driverListSchema, body).items
}

/**
 * Offer a confirmed order to one driver (`POST .../assign`, row 8). The
 * driver has **not** accepted yet (FR-032).
 *
 * @returns The order, now `assigned` with an `offered` assignment.
 * @throws {ApiError} `driver_not_eligible` (409, `details.reasons`);
 *   `invalid_order_transition` (409); `driver_not_found` / `order_not_found`
 *   (404); `csrf_failed` (403); `network_error`.
 */
export async function assignDriver(
  reference: string,
  driverId: string,
  client: ApiClient = apiClient,
): Promise<AdminOrderDetail> {
  const body = await client.request<unknown>(`${orderPath(reference)}/assign`, {
    method: 'POST',
    body: { driver_id: driverId },
  })
  return parseDetail(body)
}

/**
 * Take back an offered or accepted job (`POST .../withdraw`, rows 10-11).
 *
 * @returns The order, back to `confirmed`.
 * @throws {ApiError} `assignment_not_found` (404); `invalid_order_transition`
 *   (409: the assignment is no longer `expected_status`, or the driver has
 *   departed); `csrf_failed` (403); `network_error`.
 */
export async function withdrawAssignment(
  reference: string,
  request: WithdrawRequest,
  client: ApiClient = apiClient,
): Promise<AdminOrderDetail> {
  const body = await client.request<unknown>(`${orderPath(reference)}/withdraw`, {
    method: 'POST',
    body: request,
  })
  return parseDetail(body)
}

/**
 * Every history entry of the order, newest first, with hold opened and hold
 * decided entries (`GET .../history?include=holds`, H1 and HISTORY,
 * decision 8).
 *
 * @throws {ApiError} `order_not_found` (404); `invalid_response`.
 */
export async function getOrderHistory(
  reference: string,
  signal?: AbortSignal,
  client: ApiClient = apiClient,
): Promise<AdminOrderEvent[]> {
  const body = await client.request<unknown>(`${orderPath(reference)}/history?include=holds`, { signal })
  return parse(historySchema, body).items
}

/**
 * The eligibility reasons in a `driver_not_eligible` error's details, or an
 * empty list when there are none or they are not recognised.
 */
export function refusalReasons(error: ApiError): EligibilityReason[] {
  const details = error.details as { reasons?: unknown } | null
  const result = z.array(z.enum(ELIGIBILITY_REASONS)).safeParse(details?.reasons)
  return result.success ? result.data : []
}
