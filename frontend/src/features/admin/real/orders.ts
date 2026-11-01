/**
 * Admin order adapters (#15): the real-API side of `listOrders` and
 * `getOrder` in `adminApi.ts`.
 *
 * Statuses follow docs/architecture/api-mapping.md ("Admin order status"),
 * with `failed` and `disputed` as their own admin statuses (open question 5,
 * decided in #15). What the backend does not send is left out, never filled
 * in: the list has no payment status, and a partner's fleet code and plate
 * are never sent. The list names an order's live driver (`driver`, #204) but
 * not their vehicle; the detail has the vehicle.
 */
import {
  endReasonLabel,
  HOLD_KIND_LABEL,
  holdConcernLabel,
  holdDecisionLabel,
  type AdminOrder,
  type AdminOrderFilter,
  type AdminOrderStatus,
  type AdminPaymentStatus,
} from '../../../domain/admin'
import { describeChoice } from '../../../domain/orders'
import { describeQuantity } from '../../../domain/quantity'
import { ApiError, apiClient, type ApiClient } from '../../../lib/api/client'
import { getAdminOrderDetail, getOrderHistory, type AdminOrderDetail, type AdminOrderEvent } from '../../../lib/api/adminDispatch'
import { listAdminOrders, type AdminOrderRead, type AdminOrderStatus as BackendStatus } from '../../../lib/api/adminOrders'
import type { OrderList } from '../../../mocks/adminMock'
import { choiceFromRead } from '../../customer/real/order'
import { confirmationLine } from '../confirm/logic'
import { withContactAttempts } from '../timeline'

const STATUS_BY_BACKEND: Record<BackendStatus, AdminOrderStatus> = {
  // Not confirmed yet, so no rider can be assigned (admin-confirm-order.md, decision 3).
  quote_requested: 'awaiting_confirmation',
  awaiting_confirmation: 'awaiting_confirmation',
  confirmed: 'awaiting_rider',
  awaiting_payment: 'awaiting_rider',
  assigned: 'assigned',
  accepted: 'assigned',
  departed: 'loading',
  collected: 'on_the_way',
  en_route: 'on_the_way',
  arrived: 'on_the_way',
  unloading: 'on_the_way',
  delivered: 'delivered',
  cancelled: 'cancelled',
  failed: 'failed',
  disputed: 'disputed',
}

/**
 * Backend payment statuses the admin screens show: the exact design
 * equivalents, plus `pending_collection` as "Cash to collect" (decided on PR
 * #92) and `partially_paid` as "Part paid" (the approved cash design). The
 * others (`disputed`, `partially_refunded`) have no label yet, so the order
 * shows no payment chip rather than a wrong one; the cash pages show them in
 * full (#19).
 */
const PAYMENT_BY_BACKEND: Partial<Record<string, AdminPaymentStatus>> = {
  pending_collection: 'pending_collection',
  unpaid: 'unpaid',
  awaiting_verification: 'awaiting_verification',
  paid: 'paid',
  partially_paid: 'partially_paid',
  refunded: 'refunded',
}

/**
 * The backend statuses behind each pill of the order list (`a-orders`). `all`
 * sends none; `on_hold` sends none either and asks for `on_hold=true` instead
 * (see `listParams`): a hold is not a status.
 */
export const STATUSES_BY_FILTER: Record<AdminOrderFilter, BackendStatus[]> = {
  all: [],
  awaiting_confirmation: ['quote_requested', 'awaiting_confirmation'],
  awaiting_rider: ['confirmed', 'awaiting_payment'],
  in_progress: ['assigned', 'accepted', 'departed', 'collected', 'en_route', 'arrived', 'unloading'],
  on_hold: [],
  delivered: ['delivered'],
  cancelled: ['cancelled'],
}

const FILTERS = Object.keys(STATUSES_BY_FILTER) as AdminOrderFilter[]

/** The query a pill sends: its statuses, or `on_hold=true` for the "On hold" pill (deliveries.md, "Hold object on admin orders"). */
function listParams(filter: AdminOrderFilter): { status: BackendStatus[]; on_hold?: boolean } {
  return filter === 'on_hold' ? { status: [], on_hold: true } : { status: STATUSES_BY_FILTER[filter] }
}

/** The newest orders a text search looks through: the contract's page maximum. */
const SEARCH_LIMIT = 100

/** A public order reference (FR-027): `MO-` and 10 characters. */
const REFERENCE = /^MO-[0-9A-Z]{10}$/i

/**
 * The admin status for a backend status. An unknown one can only come from a
 * newer backend; it shows as "Awaiting rider" so the order is not hidden.
 */
export function adminStatusFromBackend(status: string): AdminOrderStatus {
  return Object.hasOwn(STATUS_BY_BACKEND, status) ? STATUS_BY_BACKEND[status as BackendStatus] : 'awaiting_rider'
}

/** Whether an order matches a pill, by its admin status (or, for "On hold", its hold). */
function inFilter(order: AdminOrder, filter: AdminOrderFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'on_hold') return order.hold !== null
  if (filter === 'in_progress') return order.status === 'assigned' || order.status === 'loading' || order.status === 'on_the_way'
  return order.status === filter
}

/** Free-text match on what staff see in a row, as the mock does (names, phones, references, addresses). */
function matchesText(order: AdminOrder, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const text = [order.reference, order.customer_name, order.customer_phone, order.address, order.area ?? ''].join(' ')
  const digits = q.replace(/\D/g, '')
  return text.toLowerCase().includes(q) || (digits.length >= 4 && text.replace(/\D/g, '').includes(digits))
}

/** The partner a list row names (`driver`, #204), or `null`: no live driver, or a server that does not send the field. */
function listedDriver(read: AdminOrderRead | AdminOrderDetail): AdminOrder['partner'] {
  const driver = read.driver
  if (!driver || typeof driver.id !== 'string' || typeof driver.name !== 'string') return null
  return { id: driver.id, name: driver.name, code: null, vehicle: null, plate: null }
}

/**
 * The driver who held an order that has ended (#243): the detail's assignment when the order is delivered, failed or
 * cancelled and the driver had taken the job (a `completed` assignment, or a `withdrawn` one the driver had accepted).
 * An offer that was never accepted, or was declined, names nobody, and an order back in the pool keeps no driver.
 */
function endedDriver(read: AdminOrderRead | AdminOrderDetail): AdminOrder['partner'] {
  const assignment = 'assignment' in read ? read.assignment : null
  if (!assignment || (read.status !== 'delivered' && read.status !== 'failed' && read.status !== 'cancelled')) return null
  const held =
    assignment.status === 'completed' || (assignment.status === 'withdrawn' && assignment.responded_at !== null && !assignment.decline_reason)
  if (!held) return null
  const vehicleType = assignment.vehicle?.type
  return {
    id: assignment.driver.id,
    name: assignment.driver.name,
    code: null,
    vehicle: vehicleType === 'keke' || vehicleType === 'tanker' ? vehicleType : null,
    plate: null,
  }
}

/**
 * Backend order (list row or detail) to the design's admin order.
 *
 * @param read - `AdminOrderRead` from the list, or `AdminOrderDetail`, which
 *   adds the live assignment, the confirmed source and price, and payment.
 */
export function adminOrderFromRead(read: AdminOrderRead | AdminOrderDetail): AdminOrder {
  const detail = 'assignment' in read ? read : null
  const choice = choiceFromRead(read)
  // Only a live offer or acceptance names the order's partner; an ended one does not.
  const live = detail?.assignment && (detail.assignment.status === 'offered' || detail.assignment.status === 'accepted') ? detail.assignment : null
  const vehicleType = live?.vehicle?.type
  return {
    reference: read.reference,
    created_at: read.created_at,
    customer_id: read.customer.id,
    customer_name: read.customer.name,
    customer_phone: read.customer.phone,
    area: read.service_zone?.name ?? null,
    address: read.delivery_address,
    landmark: read.landmark,
    choice,
    quantity: choice ? describeChoice(choice, 'short') : describeQuantity(read.quantity_litres, 'litres', 'short'),
    // The confirmed price wins; before confirmation, the quote the order was placed with.
    total_minor_units: detail?.price?.total_minor_units ?? read.quote?.total_minor_units ?? null,
    // Every pilot order is pay on delivery (F4); the status comes with the detail only.
    payment: { method: 'pay_on_delivery', status: (detail?.payment && PAYMENT_BY_BACKEND[detail.payment.status]) ?? null },
    status: adminStatusFromBackend(read.status),
    backend_status: read.status,
    // Both the list row and the detail carry it (admin hold review, R0); a server without it reads as no hold.
    hold: read.hold ?? null,
    partner: live
      ? {
          id: live.driver.id,
          name: live.driver.name,
          code: null,
          vehicle: vehicleType === 'keke' || vehicleType === 'tanker' ? vehicleType : null,
          plate: null,
        }
      : // A list row names its live driver only; the detail names them through the assignment (#204), and the driver of an ended order too (#243).
        (endedDriver(read) ?? listedDriver(read)),
    assigned_by: live?.offered_by.name ?? null,
    station_name: detail?.source?.name ?? null,
    // The history is a separate endpoint; `getOrder` adds its assignment events (#16).
    timeline: [{ label: 'Order placed', at: read.created_at }],
    instructions: read.delivery_instructions,
    tank_note: read.tanker ? (read.tanker.tank_type === 'overhead' ? 'Overhead tank' : 'Ground tank') : null,
  }
}

/** How many orders each pill holds: one small request per pill, reading `total`. */
async function serverCounts(client: ApiClient): Promise<Record<AdminOrderFilter, number>> {
  const totals = await Promise.all(
    FILTERS.map((f) => listAdminOrders({ ...listParams(f), limit: 1, offset: 0 }, undefined, client).then((p) => p.total)),
  )
  return Object.fromEntries(FILTERS.map((f, i) => [f, totals[i]])) as Record<AdminOrderFilter, number>
}

function localCounts(orders: AdminOrder[]): Record<AdminOrderFilter, number> {
  return Object.fromEntries(FILTERS.map((f) => [f, orders.filter((o) => inFilter(o, f)).length])) as Record<AdminOrderFilter, number>
}

/**
 * The order list with its pill counts.
 *
 * - No search: the pill's orders from the server (newest 100) and every pill's
 *   count from the server.
 * - A reference (`MO-…`): that one order, looked up directly.
 * - Other text: matched against the newest 100 orders only, because the
 *   backend has no text search; the counts are then of those matches.
 *
 * @throws {ApiError} The backend's errors unchanged.
 */
export async function listOrders(filter: AdminOrderFilter = 'all', query?: string, client: ApiClient = apiClient): Promise<OrderList> {
  const q = (query ?? '').trim()
  if (REFERENCE.test(q)) {
    let found: AdminOrder[] = []
    try {
      found = [adminOrderFromRead(await getAdminOrderDetail(q.toUpperCase(), undefined, client))]
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'order_not_found')) throw error
    }
    return { orders: found.filter((o) => inFilter(o, filter)), counts: localCounts(found) }
  }
  if (q) {
    const page = await listAdminOrders({ status: [], limit: SEARCH_LIMIT, offset: 0 }, undefined, client)
    const found = page.items.map(adminOrderFromRead).filter((o) => matchesText(o, q))
    return { orders: found.filter((o) => inFilter(o, filter)), counts: localCounts(found) }
  }
  const [page, counts] = await Promise.all([
    listAdminOrders({ ...listParams(filter), limit: SEARCH_LIMIT, offset: 0 }, undefined, client),
    serverCounts(client),
  ])
  return { orders: page.items.map(adminOrderFromRead), counts }
}

type TimelineEntry = AdminOrder['timeline'][number]

/**
 * The line for an assignment event, in the contract's words (deliveries.md,
 * "AdminOrderEvent"), or `null` for every other event (the driver's steps have
 * their own lines, see `progressLine`).
 */
function assignmentLine(event: AdminOrderEvent): string | null {
  if (!event.assignment) return null
  const driver = event.assignment.driver.name
  if (event.reason_code === 'driver_declined') return `Declined by ${driver}`
  if (event.reason_code === 'reassigned') {
    if (event.from_status === 'assigned') return `Offer to ${driver} withdrawn`
    if (event.from_status === 'accepted') return `Job withdrawn from ${driver}`
    return null
  }
  if (event.to_status === 'assigned') return `Offered to ${driver}`
  if (event.from_status === 'assigned' && event.to_status === 'accepted') return `Accepted by ${driver}`
  return null
}

/**
 * The line for a hold entry (admin-hold-review.md, H): "Hold opened: <kind>"
 * with who, the concern in words and the driver's note; or the decision
 * ("Proof approved", ...) with the administrator and their note. `null` for a
 * hold closed by a fail, cancel or withdraw (it has no decision entry; its
 * status change is already in the timeline) and for anything else.
 */
function holdLine(event: AdminOrderEvent): { label: string; detail: string } | null {
  if (!event.hold) return null
  const by = event.actor?.name
  const note = event.note ? `"${event.note}"` : null
  if (event.kind === 'hold_opened') {
    const detail = [by, holdConcernLabel(event.hold.category), note].filter(Boolean).join(' · ')
    return { label: `Hold opened: ${HOLD_KIND_LABEL[event.hold.kind]}`, detail }
  }
  if (event.kind === 'hold_decided') {
    const label = event.hold.decision ? holdDecisionLabel(event.hold.decision) : null
    return label ? { label, detail: [by, note].filter(Boolean).join(' · ') } : null
  }
  return null
}

/**
 * The line for the status change that ended the order's delivery: "Delivery
 * failed" or "Cancelled", with who, why in words and the note. A hold the
 * change closed has no decision entry, so this is where the timeline shows it
 * (admin-hold-review.md, H). `null` for every other event.
 */
function endLine(event: AdminOrderEvent): { label: string; detail: string } | null {
  if (event.kind !== 'status_change' || (event.to_status !== 'failed' && event.to_status !== 'cancelled')) return null
  const reason = event.reason_code ? endReasonLabel(event.reason_code) : null
  const detail = [event.actor?.name, reason, event.note ? `"${event.note}"` : null].filter(Boolean).join(' · ')
  return { label: event.to_status === 'failed' ? 'Delivery failed' : 'Cancelled', detail }
}

/** The driver's delivery steps after accepting, in order, and the line each one makes (#242). */
const PROGRESS_LABEL: Record<string, string> = {
  departed: 'Departed',
  collected: 'Collected',
  en_route: 'En route',
  arrived: 'Arrived',
  unloading: 'Unloading',
  delivered: 'Delivered',
}

/**
 * The name of a driver's step (`departed` to `delivered`), or `null` for any other status. The order timeline and the
 * activity feed both use it, so a step keeps one name across the admin app (#275).
 */
export function progressStepLabel(status: string): string | null {
  return Object.hasOwn(PROGRESS_LABEL, status) ? PROGRESS_LABEL[status] : null
}

/**
 * The line for a driver's step: the status change into `departed`,
 * `collected`, `en_route`, `arrived`, `unloading` or `delivered`. `null` for
 * every other event.
 */
function progressLine(event: AdminOrderEvent): string | null {
  if (event.kind !== 'status_change' || !event.to_status) return null
  return progressStepLabel(event.to_status)
}

/**
 * The order's timeline: "Order placed", then its confirmation (#136, design
 * Q5), hold (admin-hold-review.md, H), ending (failed or cancelled),
 * assignment and delivery-step (departed to delivered, #242) events, oldest
 * first (the history comes newest first). An assignment event's note is its
 * detail; a confirmation, hold or ending line carries its own (who, concern,
 * reason, note, ...).
 *
 * @param contactAttempts - The order's attempt times from the detail (#280); each
 *   becomes a "Contact attempt N" line at its time (`withContactAttempts`).
 */
export function timelineFromHistory(createdAt: string, history: AdminOrderEvent[], contactAttempts: readonly string[] = []): TimelineEntry[] {
  const lines = [...history].reverse().flatMap((event): TimelineEntry[] => {
    const confirmation = confirmationLine(event)
    if (confirmation) return [{ label: confirmation.label, at: event.created_at, detail: confirmation.detail }]
    const hold = holdLine(event)
    if (hold) return [{ label: hold.label, at: event.created_at, ...(hold.detail ? { detail: hold.detail } : {}) }]
    const end = endLine(event)
    if (end) return [{ label: end.label, at: event.created_at, ...(end.detail ? { detail: end.detail } : {}) }]
    const step = progressLine(event)
    if (step) return [{ label: step, at: event.created_at }]
    const label = assignmentLine(event)
    return label ? [{ label, at: event.created_at, ...(event.note ? { detail: event.note } : {}) }] : []
  })
  return withContactAttempts([{ label: 'Order placed', at: createdAt }, ...lines], contactAttempts)
}

/**
 * One order with its live assignment, confirmation, payment and assignment
 * history.
 *
 * The history is a separate read that can fail on its own (deliveries.md,
 * H1). The detail page has no state for that, so a failed history leaves
 * the timeline at "Order placed" and the order still shows.
 *
 * @throws {ApiError} 404 `order_not_found`.
 */
export async function getOrder(reference: string, client: ApiClient = apiClient): Promise<AdminOrder> {
  const [detail, history] = await Promise.all([
    getAdminOrderDetail(reference, undefined, client),
    getOrderHistory(reference, undefined, client).catch(() => null),
  ])
  const order = adminOrderFromRead(detail)
  // The attempts join the timeline only with the history: without it the timeline stays at "Order placed" (design decision 4).
  return history ? { ...order, timeline: timelineFromHistory(detail.created_at, history, detail.contact_attempts.map((a) => a.attempted_at)) } : order
}
