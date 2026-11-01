/**
 * Mock admin backend (a-* screens and the added admin pages). It works on the
 * same mock database as the customer and partner apps, so an assignment here
 * reaches the rider's app, a price change reaches the next customer quote,
 * and a closed station stops new orders from using it.
 *
 * Rules enforced as a server would (no admin contract exists yet):
 * - Staff only: any other role gets 403 `forbidden`.
 * - Sensitive actions (suspend, cancel, resolve, refund, point changes) need
 *   a reason and are written to the audit log.
 * - Only open stations with valid water-source papers are used (FR-012).
 * - Saving prices creates a new version; placed orders keep their quote (FR-024).
 * - Payment is confirmed by staff and kept apart from delivery (FR-040, BR-07).
 * All naira amounts are SAMPLES (decision 10, 16).
 */
import type {
  ActivityEntry,
  AdminCustomer,
  AdminCustomerSummary,
  AdminDashboard,
  AdminIssue,
  AdminNotification,
  AdminOrder,
  AdminOrderFilter,
  AdminOrderPartner,
  AdminOrderStatus,
  AdminPartnerEarnings,
  AdminPayment,
  AdminPayout,
  AdminReport,
  AdminRider,
  AdminSettings,
  AdminStationView,
  AuditEntry,
  CreateOrderByAdminInput,
  EligibleRider,
  NewAddressInput,
  NewCustomerInput,
  NewRiderInput,
  SamplePriceTable,
  SamplePriceTableInput,
  ReportRange,
  ResolutionAction,
  ServiceArea,
  StaffMember,
  StationInput,
} from '../domain/admin'
import { endReasonLabel, HOLD_KIND_LABEL, holdConcernLabel, holdDecisionLabel, RESOLUTION_LABEL } from '../domain/admin'
import type { DeliveryType, PaymentMethod, PaymentStatus, Quote, SavedAddress, WaterChoice } from '../domain/orders'
import { choiceLitres, describeChoice } from '../domain/orders'
import type { WithdrawRequest } from '../lib/api/adminDispatch'
import type { AdminTransitionRequest, CancelReason, CancellationOutcome, HoldDecisionRequest, HoldReview, ProofOverrideRequest } from '../lib/api/adminHolds'
import type { PartnerNotification } from '../domain/partner'
import { withContactAttempts } from '../features/admin/timeline'
import { tankCapacityError } from '../domain/tankCapacity'
import { formatNaira } from '../lib/format/money'
import { normalizeNigerianPhone } from '../lib/format/phone'
import type { MockServiceArea } from './adminSeed'
import { addActivity, addAudit, currentPrices, papersState, stationForAddress } from './adminState'
import { requireUserId } from './authMock'
import { mutate, read } from './db'
import { eligible } from './eligibility'
import { alertPartnersOfNewJob, completeDelivery, findCustomerOrder, jobForNewOrder } from './orderSync'
import { newPartnerData } from './partnerMock'
import { ANY_PLACE, areaForAddress, quoteFor } from './pricing'
import { emptyCustomerData, type CustomerData, type MockCustomerOrder, type MockHold, type MockState, type PartnerData, type StoredJob } from './seed'
import { clone, delay, mockError, newDeliveryCode, newId, newReference } from './store'

/* ---------- Access and small helpers ---------- */

/** The signed-in staff member's id; 403 for customers and partners. */
function requireAdmin(s: MockState = read()): string {
  const id = requireUserId()
  const user = s.users.find((u) => u.id === id)
  if (user?.role !== 'admin') throw mockError(403, 'forbidden', 'Only MmiriOma staff can do this')
  return id
}

function actorName(s: MockState): string {
  return s.users.find((u) => u.id === s.sessionUserId)?.name ?? 'Staff'
}

/** A reason of at least 5 characters, for the audit log. */
function requireReason(reason: string | null | undefined, field = 'reason'): string {
  const r = (reason ?? '').trim()
  if (r.length < 5) throw mockError(422, 'validation_error', 'Request validation failed', [{ loc: ['body', field], msg: 'Write a short reason for the audit log', type: 'value_error' }])
  return r
}

function short(reference: string): string {
  return reference.slice(0, 7)
}

function notifyPartner(p: PartnerData, kind: PartnerNotification['kind'], title: string, body: string, reference: string | null): void {
  p.notifications.unshift({ id: newId('pn'), kind, title, body, at: new Date().toISOString(), read: false, reference })
}

function notifyCustomer(d: CustomerData, kind: CustomerData['notifications'][number]['kind'], title: string, body: string, reference: string | null): void {
  d.notifications.unshift({ id: newId('n'), kind, title, body, at: new Date().toISOString(), read: false, reference })
}

/** The account id that owns a customer data record. */
function customerIdOf(s: MockState, data: CustomerData): string | null {
  return Object.entries(s.customers).find(([, d]) => d === data)?.[0] ?? null
}

/** A partner as the mock knows it: code, vehicle and plate are always set. */
type MockOrderPartner = AdminOrderPartner & { code: string; vehicle: DeliveryType; plate: string }

/**
 * Admin's order as the mock builds it. The mock always knows the area, the
 * choice, the payment status, the station and the partner's details, so they
 * are never `null` here; screens get the wider `AdminOrder`, which also fits
 * the real API.
 */
type MockAdminOrder = AdminOrder & {
  area: string
  choice: WaterChoice
  payment: { method: PaymentMethod; status: PaymentStatus }
  station_name: string
  partner: MockOrderPartner | null
}

function partnerSummary(s: MockState, id: string | null): MockOrderPartner | null {
  if (!id) return null
  const user = s.users.find((u) => u.id === id)
  const p = s.partners[id]
  if (!user || !p) return null
  return { id, name: user.name, code: p.fleet_code, vehicle: p.profile.vehicle.type, plate: p.profile.vehicle.plate }
}

function statusFromJob(job: StoredJob): AdminOrderStatus {
  switch (job.stage) {
    case 'available':
      return 'awaiting_rider'
    case 'assigned':
      return 'assigned'
    case 'accepted':
      return 'loading'
    case 'collected':
      return 'on_the_way'
    default:
      return job.stage
  }
}

function statusFromOrder(o: MockCustomerOrder): AdminOrderStatus {
  switch (o.stage) {
    // Before confirmation no rider can be assigned (admin-confirm-order.md, decision 3).
    // No mock order reaches these: the mock places orders straight to waiting_rider.
    case 'request_received':
    case 'awaiting_confirmation':
      return 'awaiting_confirmation'
    case 'waiting_rider':
      return 'awaiting_rider'
    case 'rider_assigned':
      return 'loading'
    case 'picked_up':
    case 'on_the_way':
      return 'on_the_way'
    case 'failed':
    case 'under_review':
    case 'order_update':
      // The admin design has no status for these yet (api-mapping.md, open
      // question 5), and no mock order reaches them; fail loudly, never guess.
      throw new Error(`Admin mock has no status for customer stage "${o.stage}"`)
    default:
      return o.stage
  }
}

/** Every order reference: pool jobs plus customer orders without a job (older history). */
function allReferences(s: MockState): string[] {
  const refs = new Set(s.jobs.map((j) => j.reference))
  for (const d of Object.values(s.customers)) d.orders.forEach((o) => refs.add(o.reference))
  return [...refs]
}

/** Admin's view of one order, joining the job (dispatch) and the customer order (payment, owner). */
function orderRow(s: MockState, reference: string): MockAdminOrder | null {
  const job = s.jobs.find((j) => j.reference === reference)
  const found = findCustomerOrder(s, reference)
  if (!job && !found) return null
  const o = found?.order
  const user = found ? s.users.find((u) => u.id === customerIdOf(s, found.data)) : undefined
  const choice = o?.choice ?? job!.choice
  const priced = o ? o.quote.total_minor_units : (() => {
    const q = quoteFor(choice, ANY_PLACE, currentPrices(s))
    return q.status === 'quote_available' ? q.total_minor_units : null
  })()
  // A copy: the lines pushed below belong to this read, not to the stored order (each read added them again).
  const timeline = [...(o?.timeline ?? [
    { label: 'Order placed', at: job!.created_at },
    ...(job!.accepted_at ? [{ label: 'Rider accepted', at: job!.accepted_at }] : []),
    ...(job!.collected_at ? [{ label: 'Water collected', at: job!.collected_at }] : []),
    ...(job!.delivered_at && job!.stage === 'delivered' ? [{ label: 'Delivered, code verified', at: job!.delivered_at }] : []),
  ])]
  const held = job?.hold ?? null
  // The history's "Hold opened" line (admin-hold-review.md, H): who, the concern in words, the driver's note.
  // It stays after the hold is decided, then the decision follows, as in the real history.
  const opened = held ?? job?.past_hold ?? null
  if (opened) {
    const by = partnerSummary(s, job!.partner_id)?.name ?? job!.withdrawn?.driver
    const detail = [by, holdConcernLabel(opened.category), `"${opened.driver_note}"`].filter(Boolean).join(' · ')
    timeline.push({ label: `Hold opened: ${HOLD_KIND_LABEL[opened.kind]}`, at: opened.since, detail })
  }
  const decided = job?.hold_decision ?? null
  if (decided) timeline.push({ label: holdDecisionLabel(decided.decision) ?? 'Hold decided', at: decided.at, detail: `${decided.by} · "${decided.note}"` })
  // A withdrawn job has no decision line: the withdraw closed the hold, and shows as its own status change.
  const withdrawn = job?.withdrawn ?? null
  if (withdrawn) timeline.push({ label: `Job withdrawn from ${withdrawn.driver}`, at: withdrawn.at, ...(withdrawn.note ? { detail: withdrawn.note } : {}) })
  // A failed or cancelled job shows its status change, with who, why and the note (a hold it closed has no decision line).
  // An order with a customer order already has its "Cancelled" line from `cancelJob`.
  const ended = job?.ended ?? null
  if (ended && !(ended.kind === 'cancelled' && o)) {
    const detail = [ended.by, endReasonLabel(ended.reason_code), ended.note ? `"${ended.note}"` : null].filter(Boolean).join(' · ')
    timeline.push({ label: ended.kind === 'failed' ? 'Delivery failed' : 'Cancelled', at: ended.at, detail })
  }
  return {
    reference,
    created_at: o?.created_at ?? job!.created_at,
    customer_id: user?.id ?? null,
    customer_name: user?.name ?? o?.receiver_name ?? job!.customer.contact_name,
    customer_phone: user?.phone ?? o?.receiver_phone ?? job!.customer.phone,
    area: job?.customer.area ?? areaForAddress(o!.address, s.admin.areas)?.name ?? o!.address_label,
    address: o?.address ?? job!.customer.address,
    landmark: o?.landmark ?? job?.customer.landmark ?? null,
    choice,
    quantity: describeChoice(choice, 'short'),
    total_minor_units: priced,
    payment: o?.payment ?? { method: 'pay_on_delivery', status: job!.payment_status },
    status: job ? statusFromJob(job) : statusFromOrder(o!),
    hold: held ? { id: held.id, kind: held.kind, since: held.since } : null,
    partner: partnerSummary(s, job?.partner_id ?? null),
    assigned_by: job?.assigned_by ?? null,
    station_name: job?.station.name ?? o?.station_name ?? '',
    // The attempts the partner recorded (docs/design/admin-order-contact-attempts.md, #280); a new list, so the stored timeline is not changed.
    timeline: withContactAttempts(timeline, job?.contact_attempts ?? []),
    instructions: o?.instructions ?? job?.instructions ?? null,
    tank_note: job?.tank_note ?? null,
  }
}

function allOrders(s: MockState): MockAdminOrder[] {
  return allReferences(s)
    .map((r) => orderRow(s, r)!)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
}

const IN_PROGRESS: AdminOrderStatus[] = ['assigned', 'loading', 'on_the_way']

function matchesFilter(o: AdminOrder, f: AdminOrderFilter): boolean {
  if (f === 'all') return true
  if (f === 'on_hold') return o.hold !== null
  if (f === 'in_progress') return IN_PROGRESS.includes(o.status)
  return o.status === f
}

function matchesQuery(text: string, q: string | undefined): boolean {
  const t = (q ?? '').trim().toLowerCase()
  if (!t) return true
  const digits = t.replace(/\D/g, '')
  return text.toLowerCase().includes(t) || (digits.length >= 4 && text.replace(/\D/g, '').includes(digits))
}

function orderSearchText(o: AdminOrder): string {
  return `${o.reference} ${o.customer_name} ${o.customer_phone} 0${o.customer_phone.slice(4)} ${o.area}`
}

function isToday(iso: string | null, now = new Date()): boolean {
  if (!iso) return false
  const lagos = (d: Date) => new Date(d.getTime() + 3_600_000).toISOString().slice(0, 10)
  return lagos(new Date(iso)) === lagos(now)
}

/* ---------- Shell, dashboard, map, activity ---------- */

export interface AdminShellData {
  user: { name: string; role: string }
  counts: { orders: number; support: number }
  unread: number
}

export async function getShellData(): Promise<AdminShellData> {
  await delay(null, 80)
  const s = read()
  const id = requireAdmin(s)
  const staff = s.admin.staff.find((m) => m.id === id)
  return {
    user: { name: actorName(s), role: staff?.role ?? 'Staff' },
    counts: {
      orders: s.jobs.filter((j) => j.stage === 'available').length,
      support: s.admin.issues.filter((i) => i.status === 'open').length,
    },
    unread: s.admin.notifications.filter((n) => !n.read).length,
  }
}

export async function getDashboard(): Promise<AdminDashboard> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  const now = new Date()
  const today = allOrders(s).filter((o) => isToday(o.created_at, now) || IN_PROGRESS.includes(o.status) || o.status === 'awaiting_rider')
  const waiting = today.filter((o) => o.status === 'awaiting_rider')
  const oldest = waiting.length ? Math.round((now.getTime() - Math.min(...waiting.map((o) => Date.parse(o.created_at)))) / 60_000) : null
  const partners = Object.values(s.partners)
  const online = partners.filter((p) => p.profile.online && p.profile.approval === 'approved')
  const deliveredToday = s.jobs.filter((j) => j.stage === 'delivered' && isToday(j.delivered_at, now))
  const revenue = deliveredToday.reduce((sum, j) => sum + (orderRow(s, j.reference)?.total_minor_units ?? 0), 0)
  const due = partners.filter((p) => p.wallet_minor_units > 0)
  return {
    date: now.toISOString(),
    orders: {
      total: today.length,
      awaiting_rider: waiting.length,
      in_progress: today.filter((o) => IN_PROGRESS.includes(o.status)).length,
      delivered: today.filter((o) => o.status === 'delivered').length,
      cancelled: today.filter((o) => o.status === 'cancelled').length,
      oldest_waiting_minutes: oldest,
    },
    disputes_open: s.admin.issues.filter((i) => i.status === 'open').length,
    riders_online: { total: online.length, keke: online.filter((p) => p.profile.vehicle.type === 'keke').length, tanker: online.filter((p) => p.profile.vehicle.type === 'tanker').length },
    stations: { open: s.admin.stations.filter((st) => st.open).length, closed: s.admin.stations.filter((st) => !st.open).length },
    revenue_today_minor_units: revenue,
    payouts_due: { amount_minor_units: due.reduce((sum, p) => sum + p.wallet_minor_units, 0), riders: due.length },
    payments_to_verify: allOrders(s).filter((o) => o.payment.status === 'awaiting_verification').length,
    by_type: { keke: today.filter((o) => o.choice.delivery_type === 'keke').length, tanker: today.filter((o) => o.choice.delivery_type === 'tanker').length },
    is_sample: true,
  }
}

/** Active deliveries for the illustrative map (decision 14: positions are drawn by area, not GPS). */
export interface LiveMapData {
  /**
   * `code` (the driver's plate), `vehicle` (the order's delivery type), `station_area` and
   * `customer_area` are `null` when the server has none: the map draws a neutral marker and
   * no label rather than inventing one (admin-operations.md, live map).
   */
  deliveries: { reference: string; code: string | null; vehicle: 'keke' | 'tanker' | null; status: AdminOrderStatus; station_area: string | null; customer_area: string | null; partner: string }[]
  stations: { id: string; name: string; area: string | null; open: boolean }[]
}

export async function getLiveMap(): Promise<LiveMapData> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  const deliveries = s.jobs
    .filter((j) => j.partner_id && (j.stage === 'assigned' || j.stage === 'accepted' || j.stage === 'collected'))
    .map((j) => {
      const p = partnerSummary(s, j.partner_id)!
      return { reference: j.reference, code: p.code, vehicle: p.vehicle, status: statusFromJob(j), station_area: j.station.area, customer_area: j.customer.area, partner: p.name }
    })
  return { deliveries, stations: s.admin.stations.map((st) => ({ id: st.id, name: st.name, area: st.area, open: st.open })) }
}

export async function listActivity(limit = 5): Promise<ActivityEntry[]> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  return clone(s.admin.activity.slice(0, limit))
}

/* ---------- Orders ---------- */

export interface OrderList {
  orders: AdminOrder[]
  counts: Record<AdminOrderFilter, number>
}

export async function listOrders(filter: AdminOrderFilter = 'all', query?: string): Promise<OrderList> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  const found = allOrders(s).filter((o) => matchesQuery(orderSearchText(o), query))
  const counts = { all: 0, awaiting_confirmation: 0, awaiting_rider: 0, in_progress: 0, on_hold: 0, delivered: 0, failed: 0, cancelled: 0 } as Record<AdminOrderFilter, number>
  for (const f of Object.keys(counts) as AdminOrderFilter[]) counts[f] = found.filter((o) => matchesFilter(o, f)).length
  return { orders: found.filter((o) => matchesFilter(o, filter)), counts }
}

export async function getOrder(reference: string): Promise<AdminOrder> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  const o = orderRow(s, reference)
  if (!o) throw mockError(404, 'order_not_found', 'Order not found')
  return o
}

function canTake(s: MockState, job: StoredJob, partnerId: string): boolean {
  const p = s.partners[partnerId]
  if (!p || p.profile.approval !== 'approved') return false
  // Same rule as the pool, but an order already assigned elsewhere may be reassigned.
  return eligible({ ...job, stage: 'available' }, partnerId, p)
}

export async function listEligibleRiders(reference: string): Promise<EligibleRider[]> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  const job = s.jobs.find((j) => j.reference === reference)
  if (!job) throw mockError(404, 'order_not_found', 'Order not found')
  const area = job.customer.area.toLowerCase()
  return Object.entries(s.partners)
    .filter(([id]) => canTake(s, job, id) && id !== job.partner_id)
    .map(([id, p]) => ({
      id,
      name: s.users.find((u) => u.id === id)?.name ?? '',
      vehicle: p.profile.vehicle.type,
      rating: p.rating,
      active_orders: s.jobs.filter((j) => j.partner_id === id && ['assigned', 'accepted', 'collected'].includes(j.stage)).length,
      online: p.profile.online,
      works_in_area: p.profile.service_areas.some((a) => a.toLowerCase() === area),
    }))
    .sort((a, b) => Number(b.online) - Number(a.online) || Number(b.works_in_area) - Number(a.works_in_area) || a.active_orders - b.active_orders || (b.rating ?? 0) - (a.rating ?? 0))
}

/** Put the customer's order back to "waiting for a rider" (assignment moved or undone). */
function resetCustomerOrder(s: MockState, reference: string, label: string): void {
  const found = findCustomerOrder(s, reference)
  if (!found || found.order.stage === 'delivered' || found.order.stage === 'cancelled') return
  found.order.stage = 'waiting_rider'
  found.order.partner = null
  found.order.station_name = null
  found.order.eta_minutes = null
  found.order.timeline.push({ label, at: new Date().toISOString() })
}

/** Assign or reassign inside `mutate`. Shared by the Orders page and "create order, assign now". */
function assignJob(s: MockState, job: StoredJob, partnerId: string): void {
  if (job.stage === 'delivered' || job.stage === 'cancelled') throw mockError(409, 'order_closed', 'This order is already finished')
  if (job.stage === 'collected') throw mockError(409, 'already_collected', 'The water is already on its way with the current rider. Resolve it in Support instead.')
  if (job.partner_id === partnerId) throw mockError(409, 'already_assigned', 'This rider already has the order')
  if (!canTake(s, job, partnerId)) throw mockError(422, 'rider_not_eligible', 'This rider cannot take this order (vehicle, tank size, approval or an earlier decline)')
  const actor = actorName(s)
  const previous = job.partner_id ? partnerSummary(s, job.partner_id) : null
  if (previous) {
    notifyPartner(s.partners[previous.id], 'reassigned', 'Order moved to another rider', `${short(job.reference)} was reassigned by admin. You do not need to deliver it.`, job.reference)
    resetCustomerOrder(s, job.reference, 'Reassigned by support')
  }
  const next = partnerSummary(s, partnerId)!
  job.stage = 'assigned'
  job.partner_id = partnerId
  job.assigned_by = actor
  job.accepted_at = null
  job.pickup = null
  notifyPartner(s.partners[partnerId], 'assigned', 'Admin assigned you an order', `${short(job.reference)} · ${describeChoice(job.choice)} · ${job.customer.area}`, job.reference)
  addAudit(s, actor, previous ? `Reassigned ${short(job.reference)} from ${previous.name} to ${next.name}` : `Assigned ${short(job.reference)} to ${next.name}`)
  addActivity(s, 'admin', `${short(job.reference)} assigned to ${next.name}`, job.reference)
}

export async function assignOrder(reference: string, partnerId: string): Promise<AdminOrder> {
  await delay(null, 350)
  return mutate((s) => {
    requireAdmin(s)
    const job = s.jobs.find((j) => j.reference === reference)
    if (!job) throw mockError(404, 'order_not_found', 'Order not found')
    assignJob(s, job, partnerId)
    return orderRow(s, reference)!
  })
}

/**
 * Cancel inside `mutate`: job, customer order, paid orders become refund due,
 * and the partner told. The agreed cancel notifies nobody (deliveries.md,
 * "POST .../transition (fail and cancel)"), so it passes `notifyDriver` false.
 */
function cancelJob(s: MockState, reference: string, reason: string, notifyDriver = true): void {
  const job = s.jobs.find((j) => j.reference === reference)
  const found = findCustomerOrder(s, reference)
  if (!job && !found) throw mockError(404, 'order_not_found', 'Order not found')
  if (job?.stage === 'delivered' || found?.order.stage === 'delivered') throw mockError(409, 'order_closed', 'A delivered order cannot be cancelled')
  if (job?.stage === 'cancelled' || found?.order.stage === 'cancelled') throw mockError(409, 'order_closed', 'This order is already cancelled')
  const now = new Date().toISOString()
  if (job) {
    if (notifyDriver && job.partner_id) notifyPartner(s.partners[job.partner_id], 'reassigned', 'Order cancelled', `${short(reference)} was cancelled by admin.`, reference)
    job.stage = 'cancelled'
    job.delivered_at = now
  }
  if (found) {
    const o = found.order
    o.stage = 'cancelled'
    o.delivery_code = null
    o.eta_minutes = null
    o.timeline.push({ label: 'Cancelled', at: now, detail: 'Cancelled by support' })
    if (o.payment.status === 'paid') o.payment.status = 'refund_due'
    if (job) job.payment_status = o.payment.status
  }
  addAudit(s, actorName(s), `Cancelled ${short(reference)}`, reason)
}

/* ---------- Hold review (docs/api/deliveries.md, "Admin hold review endpoints") ---------- */

const minutesBefore = (iso: string, m: number): string => new Date(Date.parse(iso) - m * 60_000).toISOString()

/** The server's answer on the source a held job used (deliveries.md, "Source eligibility (R2)"), worked out from the seeded hold. */
function sourceAnswer(hold: MockHold): { answer: 'eligible' | 'not_eligible'; message: string } {
  return hold.category === 'source_mismatch'
    ? { answer: 'not_eligible', message: 'This source is not in the source records.' }
    : { answer: 'eligible', message: "This source is activated for the order's water category." }
}

/** The evidence for a held job, from the seeded hold. All of it is SAMPLE text. */
function holdEvidence(s: MockState, job: StoredJob): HoldReview {
  const hold = job.hold!
  const driver = { id: job.partner_id ?? '', name: partnerSummary(s, job.partner_id)?.name ?? '' }
  const base = { id: hold.id, kind: hold.kind, since: hold.since, driver, proof: null, pickup: null, source_eligibility: null, report: null, incidents: [], withdraw_allowed: false }
  if (hold.kind === 'proof_review') {
    return {
      ...base,
      order_status: 'unloading',
      proof: {
        delivered_litres: choiceLitres(job.choice) ?? 0,
        reason: 'customer_cannot_receive_code',
        driver_note: hold.driver_note,
        arrived_at: minutesBefore(hold.since, 28),
        unloading_completed_at: minutesBefore(hold.since, 4),
        sent_at: hold.since,
        delivery_code: { issued_at: minutesBefore(hold.since, 4), sms_status: 'accepted', attempts_used: 3, attempts_limit: 5, expired: true },
        contact_attempts: [{ attempted_at: minutesBefore(hold.since, 2) }],
        location: null,
      },
    }
  }
  if (hold.kind === 'source_review') {
    // A mismatch used another source (not in the source records); a safety concern used the assigned one.
    const other = hold.category === 'source_mismatch'
    return {
      ...base,
      order_status: 'collected',
      pickup: {
        assigned_source: { id: 'source-ninth-mile', name: job.station.name, approximate_location: job.station.address },
        used_source: other ? { assigned: false, name: 'Borehole near the market' } : { assigned: true },
        source_reference: 'SR-0042',
        volume_collected_litres: choiceLitres(job.choice) ?? 0,
        picked_up_at: job.collected_at ?? minutesBefore(hold.since, 30),
        safety_concern: !other,
        safety_note: other ? null : hold.driver_note,
      },
      source_eligibility: sourceAnswer(hold),
      incidents: [{ kind: 'running_late', reported_at: minutesBefore(hold.since, 90), note: 'Traffic on the expressway' }],
    }
  }
  return {
    ...base,
    order_status: 'accepted',
    report: { kind: 'unsafe_access', note: hold.driver_note, reported_at: hold.since, order_status_then: 'accepted' },
    withdraw_allowed: job.stage === 'accepted',
  }
}

export async function getHoldReview(reference: string): Promise<HoldReview> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  const job = s.jobs.find((j) => j.reference === reference)
  if (!job) throw mockError(404, 'order_not_found', 'Order not found')
  if (!job.hold) throw mockError(404, 'hold_not_found', 'This order has no open hold')
  return holdEvidence(s, job)
}

/** Approve or reject alternative proof (R1). The same checks the server makes, with its refusals. */
export async function decideProof(reference: string, request: ProofOverrideRequest): Promise<void> {
  await delay(null, 250)
  const details: { loc: string[]; msg: string; type: string }[] = []
  const note = request.note.trim()
  if (note.length < 1 || note.length > 500) details.push({ loc: ['body', 'note'], msg: 'Write a note (1 to 500 characters)', type: 'value_error' })
  if (request.decision === 'approve') {
    const ack = request.customer_acknowledgment
    if (ack.method === 'other' && !(ack.note ?? '').trim()) details.push({ loc: ['body', 'customer_acknowledgment', 'note'], msg: 'Add details for Other', type: 'value_error' })
    if (!(Date.parse(ack.confirmed_at) <= Date.now() + 120_000)) details.push({ loc: ['body', 'customer_acknowledgment', 'confirmed_at'], msg: "The time can't be in the future", type: 'value_error' })
  }
  if (details.length) throw mockError(422, 'validation_error', 'Request validation failed', details)
  return mutate((s) => {
    requireAdmin(s)
    const job = s.jobs.find((j) => j.reference === reference)
    if (!job) throw mockError(404, 'order_not_found', 'Order not found')
    // A decision names the hold it decides; a stale one changes nothing (deliveries.md, "Hold review rules").
    if (!job.hold || job.hold.id !== request.hold_id || job.hold.kind !== 'proof_review') throw mockError(409, 'hold_not_open', 'This hold has already been decided or has changed')
    const now = new Date().toISOString()
    const approve = request.decision === 'approve'
    // Approving delivers the order, as a verified code would; payment is not touched (BR-12).
    const partner = job.partner_id ? s.partners[job.partner_id] : undefined
    if (approve) {
      if (partner) completeDelivery(s, job, partner, now)
      else {
        job.stage = 'delivered'
        job.delivered_at = now
      }
    }
    job.hold_decision = { decision: approve ? 'proof_approved' : 'proof_rejected', by: actorName(s), at: now, note }
    job.past_hold = job.hold
    job.hold = null
    addAudit(s, actorName(s), `${approve ? 'Approved' : 'Rejected'} alternative proof for ${short(reference)}`, note)
  })
}

/**
 * The shared checks of a note decision (continue, resume): a note of 1 to 500
 * characters (422), then a hold that is still open and of the kind the call
 * decides (409 `hold_not_open`), as the server refuses them.
 */
function openHold(s: MockState, reference: string, request: HoldDecisionRequest, kind: MockHold['kind']): StoredJob & { hold: MockHold } {
  const job = s.jobs.find((j) => j.reference === reference)
  if (!job) throw mockError(404, 'order_not_found', 'Order not found')
  if (!job.hold || job.hold.id !== request.hold_id || job.hold.kind !== kind) throw mockError(409, 'hold_not_open', 'This hold has already been decided or has changed')
  return job as StoredJob & { hold: MockHold }
}

function requireDecisionNote(note: string): string {
  const trimmed = note.trim()
  if (trimmed.length < 1 || trimmed.length > 500) {
    throw mockError(422, 'validation_error', 'Request validation failed', [{ loc: ['body', 'note'], msg: 'Write a note (1 to 500 characters)', type: 'value_error' }])
  }
  return trimmed
}

function closeHold(s: MockState, job: StoredJob, decision: NonNullable<StoredJob['hold_decision']>['decision'], note: string): void {
  job.hold_decision = { decision, by: actorName(s), at: new Date().toISOString(), note }
  job.past_hold = job.hold
  job.hold = null
}

/** Continue after a source review (R2): only when the source can be used, checked again here. */
export async function continueSource(reference: string, request: HoldDecisionRequest): Promise<void> {
  await delay(null, 250)
  const note = requireDecisionNote(request.note)
  return mutate((s) => {
    requireAdmin(s)
    const job = openHold(s, reference, request, 'source_review')
    const answer = sourceAnswer(job.hold)
    if (answer.answer !== 'eligible') throw mockError(409, 'source_not_eligible', answer.message, { answer: answer.answer })
    closeHold(s, job, 'source_continued', note)
    addAudit(s, actorName(s), `Continued the delivery after a source review for ${short(reference)}`, note)
  })
}

/** Resume after an unsafe stop (R3), with the safe alternative as the note. */
export async function resumeUnsafe(reference: string, request: HoldDecisionRequest): Promise<void> {
  await delay(null, 250)
  const note = requireDecisionNote(request.note)
  return mutate((s) => {
    requireAdmin(s)
    const job = openHold(s, reference, request, 'unsafe_stop')
    closeHold(s, job, 'unsafe_resumed', note)
    addAudit(s, actorName(s), `Resumed the delivery after an unsafe stop for ${short(reference)}`, note)
  })
}

/**
 * Take back an accepted job before the driver leaves (R3, row 11): the order
 * goes back to the pool and the hold closes with it (`withdrawn`, no decision line).
 */
export async function withdrawJob(reference: string, request: WithdrawRequest): Promise<void> {
  await delay(null, 250)
  const note = (request.note ?? '').trim()
  if (note.length > 500) throw mockError(422, 'validation_error', 'Request validation failed', [{ loc: ['body', 'note'], msg: 'Up to 500 characters', type: 'value_error' }])
  return mutate((s) => {
    requireAdmin(s)
    const job = s.jobs.find((j) => j.reference === reference)
    if (!job) throw mockError(404, 'order_not_found', 'Order not found')
    if (!job.partner_id) throw mockError(404, 'assignment_not_found', 'This order has no driver assigned')
    // Only an accepted job can be taken back here; after departure it is a fail or a cancel.
    if (request.expected_status !== 'accepted' || job.stage !== 'accepted') throw mockError(409, 'invalid_order_transition', 'This order has changed')
    const driver = partnerSummary(s, job.partner_id)?.name ?? 'the driver'
    job.stage = 'available'
    job.partner_id = null
    job.assigned_by = null
    job.accepted_at = null
    job.withdrawn = { driver, at: new Date().toISOString(), note: note || null }
    job.past_hold = job.hold ?? null
    job.hold = null
    addAudit(s, actorName(s), `Withdrew the job for ${short(reference)} from ${driver}`, note || null)
  })
}

/**
 * The server's own status for a mock job, for `expected_status`. A job's stage
 * covers several (a collected job is `collected`, or `unloading` while its
 * proof is under review).
 */
export function mockBackendStatus(job: StoredJob): string {
  if (job.hold?.kind === 'proof_review') return 'unloading'
  switch (job.stage) {
    case 'available':
      return 'confirmed'
    default:
      return job.stage
  }
}

/** What cancelling for `reason` costs the customer (FR-044): the server's sentence, here a SAMPLE. */
export async function getCancellationOutcome(reference: string, reason: CancelReason): Promise<CancellationOutcome> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  const job = s.jobs.find((j) => j.reference === reference)
  const stage = job?.stage ?? findCustomerOrder(s, reference)?.order.stage
  if (!stage) throw mockError(404, 'order_not_found', 'Order not found')
  if (stage === 'delivered' || stage === 'cancelled') throw mockError(409, 'invalid_order_transition', 'This order can no longer be cancelled')
  return { reason_code: reason, customer_charge_minor_units: 0, message: 'The customer is not charged for this cancellation.' }
}

const FAIL_REASONS: string[] = ['source_quality_concern', 'unsafe_access', 'other']
const CANCEL_REASON_CODES: string[] = ['mmirioma_unable', 'customer_request']

/**
 * Fail a delivery (row 20) or cancel an order (row 23), with the
 * checks and refusals the server makes. Every open hold on the job closes with
 * it, with no decision line; nothing notifies the driver.
 */
export async function transitionOrder(reference: string, request: AdminTransitionRequest): Promise<void> {
  await delay(null, 250)
  const details: { loc: string[]; msg: string; type: string }[] = []
  const note = (request.note ?? '').trim()
  const reasonOk = request.to === 'failed' ? FAIL_REASONS.includes(request.reason_code) : CANCEL_REASON_CODES.includes(request.reason_code)
  if (!reasonOk) details.push({ loc: ['body', 'reason_code'], msg: 'Choose a reason', type: 'value_error' })
  if (request.to === 'failed' && request.reason_code === 'other' && !note) details.push({ loc: ['body', 'note'], msg: 'A note is required for Other', type: 'value_error' })
  if (note.length > 500) details.push({ loc: ['body', 'note'], msg: 'Up to 500 characters', type: 'value_error' })
  // FR-044: unloading has started, so the administrator's cancel is the review and says why (deliveries.md, #174).
  if (request.to === 'cancelled' && request.expected_status === 'unloading' && !note) details.push({ loc: ['body', 'note'], msg: 'Say why: unloading has already started', type: 'value_error' })
  if (details.length) throw mockError(422, 'validation_error', 'Request validation failed', details)
  return mutate((s) => {
    requireAdmin(s)
    const job = s.jobs.find((j) => j.reference === reference)
    if (!job) throw mockError(404, 'order_not_found', 'Order not found')
    // The status the dispatcher saw, and the order's rows (20: assigned to unloading; 23: anything not ended).
    const failable = job.stage === 'assigned' || job.stage === 'accepted' || job.stage === 'collected'
    const cancellable = job.stage !== 'delivered' && job.stage !== 'cancelled'
    if (request.expected_status !== mockBackendStatus(job) || !(request.to === 'failed' ? failable : cancellable)) {
      throw mockError(409, 'invalid_order_transition', 'This order has changed')
    }
    if (request.hold_id !== null && (!job.hold || job.hold.id !== request.hold_id)) throw mockError(409, 'hold_not_open', 'This hold has already been decided or has changed')
    const now = new Date().toISOString()
    const found = findCustomerOrder(s, reference)
    if (request.to === 'cancelled') {
      cancelJob(s, reference, note || (request.reason_code === 'customer_request' ? 'The customer asked to cancel' : 'MmiriOma is unable to deliver'), false)
    } else {
      job.stage = 'failed'
      if (found) found.order.timeline.push({ label: 'Delivery failed', at: now })
    }
    job.past_hold = job.hold ?? job.past_hold ?? null
    job.hold = null
    job.ended = { kind: request.to, reason_code: request.reason_code, note: note || null, by: actorName(s), at: now }
    addAudit(s, actorName(s), `${request.to === 'failed' ? 'Failed the delivery of' : 'Cancelled'} ${short(reference)}`, note || null)
  })
}

/** The price a customer would see for this choice and address (same rules as the app). */
export async function quoteForAdmin(choice: WaterChoice, address: string | null): Promise<Quote> {
  await delay(null, 150)
  const s = read()
  requireAdmin(s)
  return quoteFor(choice, address === null ? null : { area: areaForAddress(address, s.admin.areas) }, currentPrices(s))
}

/**
 * Create an order for a customer (a-create): same records and rules as an
 * order placed in the customer app, with "placed by support" in its timeline.
 */
export async function createOrderForCustomer(input: CreateOrderByAdminInput): Promise<AdminOrder> {
  await delay(null, 500)
  return mutate((s) => {
    requireAdmin(s)
    const user = s.users.find((u) => u.id === input.customer_id && u.role === 'customer')
    const data = s.customers[input.customer_id]
    if (!user || !data) throw mockError(404, 'customer_not_found', 'Customer not found')
    const address = data.addresses.find((a) => a.id === input.address_id)
    if (!address) throw mockError(422, 'validation_error', 'Request validation failed', [{ loc: ['body', 'address_id'], msg: 'Choose a delivery address', type: 'value_error' }])
    const quote = quoteFor(input.choice, { area: areaForAddress(address.address, s.admin.areas) }, currentPrices(s))
    if (quote.status !== 'quote_available') throw mockError(422, 'manual_quote_required', quote.reason)
    if (!stationForAddress(s, address.address)) throw mockError(409, 'no_station_open', 'No refill station is open with valid papers for this area')
    const now = new Date().toISOString()
    const actor = actorName(s)
    const order: MockCustomerOrder = {
      reference: newReference(),
      created_at: now,
      choice: input.choice,
      address_label: address.label,
      address: address.address,
      landmark: address.landmark,
      receiver_name: user.name,
      receiver_phone: user.phone,
      instructions: null,
      stage: 'waiting_rider',
      payment: { method: input.payment_method, status: 'unpaid' },
      quote,
      partner: null,
      station_name: null,
      eta_minutes: null,
      delivery_code: newDeliveryCode(),
      timeline: [{ label: 'Order placed', at: now, detail: `By support (${actor})` }],
      delivery_window: null,
      delivered_at: null,
      delivered_quantity: null,
      points_earned: null,
      feedback: null,
    }
    data.orders.unshift(order)
    const job = jobForNewOrder(s, order, user.name)
    s.jobs.unshift(job)
    notifyCustomer(data, 'order_received', 'Order received', `Our team placed ${short(order.reference)} for you. We are finding a rider.`, order.reference)
    addAudit(s, actor, `Created ${short(order.reference)} for ${user.name}`)
    addActivity(s, 'new_order', `New order ${short(order.reference)} placed by support for ${user.name}`, order.reference)
    if (input.assign_to) assignJob(s, job, input.assign_to)
    else alertPartnersOfNewJob(s, job, now)
    return orderRow(s, order.reference)!
  })
}

/* ---------- Customers ---------- */

function customerSummary(s: MockState, id: string): AdminCustomerSummary {
  const u = s.users.find((x) => x.id === id)!
  return { id, name: u.name, phone: u.phone, phone_verified: u.phone_verified, orders: s.customers[id]?.orders.length ?? 0 }
}

export async function listCustomers(query?: string): Promise<{ customers: AdminCustomerSummary[]; total: number; ordered_this_week: number }> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  const ids = s.users.filter((u) => u.role === 'customer').map((u) => u.id)
  const weekAgo = Date.now() - 7 * 86_400_000
  return {
    customers: ids.map((id) => customerSummary(s, id)).filter((c) => matchesQuery(`${c.name} ${c.phone} 0${c.phone.slice(4)}`, query)),
    total: ids.length,
    ordered_this_week: ids.filter((id) => s.customers[id]?.orders.some((o) => Date.parse(o.created_at) >= weekAgo)).length,
  }
}

function customerDetail(s: MockState, id: string): AdminCustomer {
  const base = customerSummary(s, id)
  const d = s.customers[id]
  const refs = new Set(d.orders.map((o) => o.reference))
  return {
    ...base,
    email: d.profile.email,
    customer_since: d.profile.customer_since,
    total_paid_minor_units: d.orders.filter((o) => o.payment.status === 'paid').reduce((sum, o) => sum + o.quote.total_minor_units, 0),
    points: d.points.balance,
    complaints: s.admin.issues.filter((i) => i.reported_by === 'customer' && ((i.reference && refs.has(i.reference)) || i.reporter_name === base.name)).length,
    addresses: d.addresses.map((a) => ({ id: a.id, label: a.label, address: a.address, landmark: a.landmark, is_default: a.is_default })),
    recent_orders: d.orders
      .slice()
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, 5)
      .map((o) => ({ reference: o.reference, quantity: describeChoice(o.choice, 'short'), delivery_type: o.choice.delivery_type, created_at: o.created_at, status: orderRow(s, o.reference)!.status })),
  }
}

export async function getCustomer(id: string): Promise<AdminCustomer> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  if (!s.customers[id] || !s.users.some((u) => u.id === id && u.role === 'customer')) throw mockError(404, 'customer_not_found', 'Customer not found')
  return customerDetail(s, id)
}

/**
 * Create a customer account for someone who called in (a-create "+ New
 * customer"). The phone starts unverified (FR-003); they set a password later
 * with "Forgot password" in the app.
 */
export async function createCustomer(input: NewCustomerInput): Promise<AdminCustomer> {
  await delay(null, 300)
  const phone = normalizeNigerianPhone(input.phone)
  const name = input.name.trim()
  const details: { loc: string[]; msg: string; type: string }[] = []
  if (!phone) details.push({ loc: ['body', 'phone'], msg: 'Enter a Nigerian mobile number', type: 'value_error' })
  if (name.length < 2 || name.length > 100) details.push({ loc: ['body', 'name'], msg: 'Enter the customer’s name', type: 'value_error' })
  if (details.length) throw mockError(422, 'validation_error', 'Request validation failed', details)
  return mutate((s) => {
    requireAdmin(s)
    if (s.users.some((u) => u.phone === phone)) throw mockError(409, 'phone_already_registered', 'This phone number already has an account')
    const id = newId('user')
    s.users.push({ id, name, phone: phone!, role: 'customer', phone_verified: false, password: crypto.randomUUID() })
    s.customers[id] = emptyCustomerData()
    addAudit(s, actorName(s), `Created a customer account for ${name}`)
    return customerDetail(s, id)
  })
}

export async function addCustomerAddress(customerId: string, input: NewAddressInput): Promise<AdminCustomer> {
  await delay(null, 250)
  const label = input.label.trim()
  const address = input.address.trim()
  const details: { loc: string[]; msg: string; type: string }[] = []
  if (label.length < 2) details.push({ loc: ['body', 'label'], msg: 'Give the address a name, e.g. Home', type: 'value_error' })
  if (address.length < 5) details.push({ loc: ['body', 'address'], msg: 'Enter the street and area', type: 'value_error' })
  if (details.length) throw mockError(422, 'validation_error', 'Request validation failed', details)
  return mutate((s) => {
    requireAdmin(s)
    const d = s.customers[customerId]
    if (!d) throw mockError(404, 'customer_not_found', 'Customer not found')
    const saved: SavedAddress = { id: newId('addr'), label, address, landmark: input.landmark?.trim() || null, is_default: d.addresses.length === 0 }
    d.addresses.push(saved)
    return customerDetail(s, customerId)
  })
}

/** Manual phone confirmation after a call (FR-003: no automated verification is claimed). */
export async function verifyCustomerPhone(customerId: string): Promise<AdminCustomer> {
  await delay(null, 250)
  return mutate((s) => {
    requireAdmin(s)
    const u = s.users.find((x) => x.id === customerId && x.role === 'customer')
    if (!u) throw mockError(404, 'customer_not_found', 'Customer not found')
    u.phone_verified = true
    addAudit(s, actorName(s), `Marked phone verified for ${u.name}`, 'Confirmed by phone call')
    return customerDetail(s, customerId)
  })
}

/**
 * Change a customer's points with a history line. `limit` caps manual
 * adjustments (a typo guard); refunds as points pass `null` because their
 * size follows the order total.
 */
function adjustPointsIn(s: MockState, customerId: string, points: number, label: string, limit: number | null = 10_000): void {
  const d = s.customers[customerId]
  if (!d) throw mockError(404, 'customer_not_found', 'Customer not found')
  if (!Number.isInteger(points) || points === 0 || (limit !== null && Math.abs(points) > limit)) {
    throw mockError(422, 'validation_error', 'Request validation failed', [{ loc: ['body', 'points'], msg: 'Enter whole points between -10,000 and 10,000, not 0', type: 'value_error' }])
  }
  if (d.points.balance + points < 0) throw mockError(422, 'insufficient_points', 'The customer does not have that many points')
  d.points.balance += points
  d.points.history.unshift({ id: newId('p'), kind: 'adjusted', label, at: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' }).format(new Date()), points })
  notifyCustomer(d, 'points', points > 0 ? `You received ${points} points` : `${-points} points removed`, label, null)
}

export async function adjustPoints(customerId: string, points: number, reason: string): Promise<AdminCustomer> {
  await delay(null, 250)
  return mutate((s) => {
    requireAdmin(s)
    const r = requireReason(reason)
    adjustPointsIn(s, customerId, points, `Adjusted by support · ${r}`)
    const name = s.users.find((u) => u.id === customerId)?.name ?? ''
    addAudit(s, actorName(s), `${points > 0 ? 'Added' : 'Removed'} ${Math.abs(points)} points for ${name}`, r)
    return customerDetail(s, customerId)
  })
}

/* ---------- Riders and drivers ---------- */

export type RiderFilter = 'all' | 'keke' | 'tanker' | 'pending' | 'suspended'

function riderRow(s: MockState, id: string): AdminRider {
  const u = s.users.find((x) => x.id === id)!
  const p = s.partners[id]
  const docs = p.profile.documents.filter((d) => d.status === 'expiring' || d.status === 'missing' || d.status === 'checking')
  return {
    id,
    name: u.name,
    phone: u.phone,
    code: p.fleet_code,
    vehicle: { type: p.profile.vehicle.type, plate: p.profile.vehicle.plate, tank_gallons: p.profile.vehicle.tank_gallons },
    service_areas: p.profile.service_areas,
    online: p.profile.online,
    approval: p.profile.approval,
    today_minor_units: p.today_minor_units,
    trips: s.jobs.filter((j) => j.partner_id === id && j.stage === 'delivered').length,
    rating: p.rating,
    payout_due_minor_units: p.wallet_minor_units,
    documents_note: docs.length ? `${docs[0].name}: ${docs[0].note}` : 'Papers valid',
    active_orders: s.jobs.filter((j) => j.partner_id === id && ['assigned', 'accepted', 'collected'].includes(j.stage)).length,
    reported_issues: p.issues.filter((i) => !i.type.startsWith('decline:')).length,
    partner_since: p.profile.partner_since,
  }
}

/** The riders page data. `counts.suspended` is `null` when the server has no such count (the real API). */
export interface RiderList {
  riders: AdminRider[]
  counts: Record<RiderFilter, number | null>
  online: number
  pending: number
}

export async function listRiders(filter: RiderFilter = 'all', query?: string): Promise<RiderList> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  const all = Object.keys(s.partners)
    .map((id) => riderRow(s, id))
    .filter((r) => matchesQuery(`${r.name} ${r.phone} 0${r.phone.slice(4)} ${r.vehicle.plate} ${r.code}`, query))
  const keep: Record<RiderFilter, (r: AdminRider) => boolean> = {
    all: () => true,
    keke: (r) => r.vehicle.type === 'keke',
    tanker: (r) => r.vehicle.type === 'tanker',
    pending: (r) => r.approval === 'pending',
    suspended: (r) => r.approval === 'suspended',
  }
  const counts = Object.fromEntries((Object.keys(keep) as RiderFilter[]).map((f) => [f, all.filter(keep[f]).length])) as Record<RiderFilter, number>
  return { riders: all.filter(keep[filter]), counts, online: all.filter((r) => r.online).length, pending: counts.pending }
}

export async function getRider(id: string): Promise<AdminRider> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  if (!s.partners[id]) throw mockError(404, 'rider_not_found', 'Rider not found')
  return riderRow(s, id)
}

export type ApprovalAction = 'approve' | 'suspend' | 'reactivate'

/**
 * Approve, suspend or reactivate a partner (a-riders). Suspending takes them
 * offline and puts orders assigned but not yet accepted back in the pool;
 * a trip already under way is finished or resolved in Support.
 */
export async function setRiderApproval(id: string, action: ApprovalAction, reason: string): Promise<AdminRider> {
  await delay(null, 300)
  return mutate((s) => {
    requireAdmin(s)
    const p = s.partners[id]
    if (!p) throw mockError(404, 'rider_not_found', 'Rider not found')
    const name = s.users.find((u) => u.id === id)?.name ?? ''
    const from = p.profile.approval
    const allowed = (action === 'approve' && from === 'pending') || (action === 'suspend' && from === 'approved') || (action === 'reactivate' && from === 'suspended')
    if (!allowed) throw mockError(409, 'invalid_approval_change', `A ${from} rider cannot be ${action === 'approve' ? 'approved' : action === 'suspend' ? 'suspended' : 'reactivated'}`)
    const r = action === 'approve' ? (reason ?? '').trim() || null : requireReason(reason)
    if (action === 'suspend') {
      p.profile.approval = 'suspended'
      p.profile.online = false
      for (const j of s.jobs.filter((x) => x.partner_id === id && x.stage === 'assigned')) {
        j.stage = 'available'
        j.partner_id = null
        j.assigned_by = null
      }
      notifyPartner(p, 'account', 'Account suspended', 'You will not get new orders. Contact admin to find out why.', null)
    } else {
      p.profile.approval = 'approved'
      notifyPartner(p, 'account', action === 'approve' ? 'You are approved' : 'Account reactivated', 'You can go online and accept orders now.', null)
    }
    addAudit(s, actorName(s), `${action === 'approve' ? 'Approved' : action === 'suspend' ? 'Suspended' : 'Reactivated'} ${name}`, r)
    return riderRow(s, id)
  })
}

/** Add a rider or driver from the office (same checks as self sign-up; starts pending until papers are checked). */
export async function addRider(input: NewRiderInput): Promise<AdminRider> {
  await delay(null, 400)
  const phone = normalizeNigerianPhone(input.phone)
  const details: { loc: string[]; msg: string; type: string }[] = []
  if (input.name.trim().length < 2) details.push({ loc: ['body', 'name'], msg: 'Enter the full name', type: 'value_error' })
  if (!phone) details.push({ loc: ['body', 'phone'], msg: 'Enter a Nigerian mobile number', type: 'value_error' })
  if (input.plate.trim().length < 4) details.push({ loc: ['body', 'plate'], msg: 'Enter the plate number', type: 'value_error' })
  if (input.service_area.trim().length < 2) details.push({ loc: ['body', 'service_area'], msg: 'Enter the area they work in', type: 'value_error' })
  if (input.vehicle_type === 'tanker') {
    const msg = tankCapacityError(input.tank_gallons)
    if (msg) details.push({ loc: ['body', 'tank_gallons'], msg, type: 'value_error' })
  }
  if (details.length) throw mockError(422, 'validation_error', 'Request validation failed', details)
  return mutate((s) => {
    requireAdmin(s)
    if (s.users.some((u) => u.phone === phone)) throw mockError(409, 'phone_already_registered', 'This phone number already has an account')
    const id = newId('user')
    s.users.push({ id, name: input.name.trim(), phone: phone!, role: 'driver', phone_verified: true, password: crypto.randomUUID() })
    s.partners[id] = newPartnerData(s, input)
    addAudit(s, actorName(s), `Added ${input.vehicle_type === 'keke' ? 'Keke rider' : 'tanker driver'} ${input.name.trim()}`)
    return riderRow(s, id)
  })
}

/* ---------- Stations and service areas ---------- */

function stationView(st: MockState['admin']['stations'][number]): AdminStationView {
  return { ...clone(st), papers_state: papersState(st) }
}

export async function listStations(query?: string): Promise<AdminStationView[]> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  return s.admin.stations.filter((st) => matchesQuery(`${st.name} ${st.address} ${st.area}`, query)).map(stationView)
}

/** Open or close a station. Partners are told when it closes; it cannot open with expired or missing papers (FR-012). */
export async function setStationOpen(id: string, open: boolean): Promise<AdminStationView> {
  await delay(null, 250)
  return mutate((s) => {
    requireAdmin(s)
    const st = s.admin.stations.find((x) => x.id === id)
    if (!st) throw mockError(404, 'station_not_found', 'Station not found')
    const papers = papersState(st)
    if (open && (papers === 'expired' || papers === 'missing')) throw mockError(409, 'papers_not_valid', 'Upload valid water-source papers before opening this station')
    st.open = open
    if (!open) {
      const others = s.admin.stations.filter((x) => x.open).map((x) => x.name)
      for (const p of Object.values(s.partners)) {
        if (p.profile.approval === 'approved') notifyPartner(p, 'station_closed', 'Station closed', `${st.name} is closed for now.${others.length ? ` Use ${others.slice(0, 2).join(' or ')}.` : ''}`, null)
      }
    }
    addAudit(s, actorName(s), `${open ? 'Opened' : 'Closed'} ${st.name}`)
    return stationView(st)
  })
}

function validateStation(input: StationInput) {
  const details: { loc: string[]; msg: string; type: string }[] = []
  if (input.name.trim().length < 3) details.push({ loc: ['body', 'name'], msg: 'Enter the station name', type: 'value_error' })
  if (input.address.trim().length < 5) details.push({ loc: ['body', 'address'], msg: 'Enter the address', type: 'value_error' })
  if (input.area.trim().length < 2) details.push({ loc: ['body', 'area'], msg: 'Enter the area', type: 'value_error' })
  if (input.hours.trim().length < 3) details.push({ loc: ['body', 'hours'], msg: 'Enter the opening hours', type: 'value_error' })
  if (details.length) throw mockError(422, 'validation_error', 'Request validation failed', details)
}

export async function saveStation(id: string | null, input: StationInput): Promise<AdminStationView> {
  await delay(null, 300)
  validateStation(input)
  return mutate((s) => {
    requireAdmin(s)
    const fields = { name: input.name.trim(), address: input.address.trim(), area: input.area.trim(), hours: input.hours.trim(), products: input.products.trim(), capacity: input.capacity?.trim() || null }
    if (id) {
      const st = s.admin.stations.find((x) => x.id === id)
      if (!st) throw mockError(404, 'station_not_found', 'Station not found')
      Object.assign(st, fields)
      addAudit(s, actorName(s), `Edited ${st.name}`)
      return stationView(st)
    }
    // A new station starts closed with no papers, so it cannot be used until they are uploaded (FR-012).
    const st = { id: newId('st'), ...fields, open: false, papers: { verified_on: null, valid_until: null, file_name: null }, loading_now: 0, today: 0, loading_log: [] }
    s.admin.stations.push(st)
    addAudit(s, actorName(s), `Added ${st.name}`)
    return stationView(st)
  })
}

/** Record new water-source papers: the file name and the expiry date (the mock keeps no file). */
export async function uploadStationPapers(id: string, fileName: string, validUntil: string | null): Promise<AdminStationView> {
  await delay(null, 400)
  if (validUntil && (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil) || Date.parse(validUntil) < Date.now() - 86_400_000)) {
    throw mockError(422, 'validation_error', 'Request validation failed', [{ loc: ['body', 'valid_until'], msg: 'Enter a date in the future', type: 'value_error' }])
  }
  return mutate((s) => {
    requireAdmin(s)
    const st = s.admin.stations.find((x) => x.id === id)
    if (!st) throw mockError(404, 'station_not_found', 'Station not found')
    st.papers = { verified_on: new Date().toISOString().slice(0, 10), valid_until: validUntil, file_name: fileName }
    addAudit(s, actorName(s), `Uploaded water-source papers for ${st.name}`)
    return stationView(st)
  })
}

/** The area as the screen sees it, without the mock-only station and distance. */
function areaView(area: MockServiceArea): ServiceArea {
  return clone({ id: area.id, name: area.name, enabled: area.enabled, centre: area.centre, fixed_fee_minor_units: area.fixed_fee_minor_units })
}

export async function listAreas(): Promise<ServiceArea[]> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  return s.admin.areas.map(areaView)
}

export async function saveArea(id: string | null, input: Omit<ServiceArea, 'id'>): Promise<ServiceArea> {
  await delay(null, 250)
  const name = input.name.trim()
  const details: { loc: string[]; msg: string; type: string }[] = []
  if (name.length < 2) details.push({ loc: ['body', 'name'], msg: 'Enter the area name', type: 'value_error' })
  const { latitude, longitude } = input.centre
  if (!(latitude >= -90 && latitude <= 90)) details.push({ loc: ['body', 'centre', 'latitude'], msg: 'Enter a latitude between -90 and 90', type: 'value_error' })
  if (!(longitude >= -180 && longitude <= 180)) details.push({ loc: ['body', 'centre', 'longitude'], msg: 'Enter a longitude between -180 and 180', type: 'value_error' })
  if (input.fixed_fee_minor_units !== null && (!Number.isSafeInteger(input.fixed_fee_minor_units) || input.fixed_fee_minor_units < 0)) details.push({ loc: ['body', 'fixed_fee_minor_units'], msg: 'Enter a fee in whole naira', type: 'value_error' })
  if (details.length) throw mockError(422, 'validation_error', 'Request validation failed', details)
  return mutate((s) => {
    requireAdmin(s)
    if (s.admin.areas.some((a) => a.id !== id && a.name.toLowerCase() === name.toLowerCase())) throw mockError(409, 'area_exists', 'An area with this name already exists')
    const next = { ...input, name }
    if (id) {
      const area = s.admin.areas.find((a) => a.id === id)
      if (!area) throw mockError(404, 'area_not_found', 'Area not found')
      Object.assign(area, next)
      addAudit(s, actorName(s), `Updated service area ${name}`)
      return areaView(area)
    }
    const area: MockServiceArea = { id: newId('ar'), station_id: null, distance_km: null, ...next }
    s.admin.areas.push(area)
    addAudit(s, actorName(s), `Added service area ${name}`)
    return areaView(area)
  })
}

/* ---------- Pricing and points ---------- */

export async function listPriceLists(): Promise<SamplePriceTable[]> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  return clone(s.admin.prices).reverse()
}

/** Short summary of what changed between two lists, for the change log. */
function describeChanges(a: SamplePriceTable, b: SamplePriceTableInput): string {
  const out: string[] = []
  const money = (k: number) => formatNaira(k)
  for (const size of [25, 50] as const) {
    if (a.keke.can_minor_units[size] !== b.keke.can_minor_units[size]) out.push(`Keke ${size} L can ${money(a.keke.can_minor_units[size])} → ${money(b.keke.can_minor_units[size])}`)
  }
  if (a.keke.delivery_minor_units !== b.keke.delivery_minor_units) out.push(`Keke delivery fee ${money(a.keke.delivery_minor_units)} → ${money(b.keke.delivery_minor_units)}`)
  if (a.keke.rider_pay_minor_units !== b.keke.rider_pay_minor_units) out.push(`Keke rider pay ${money(a.keke.rider_pay_minor_units)} → ${money(b.keke.rider_pay_minor_units)}`)
  for (const size of [500, 750, 1000] as const) {
    const x = a.tanker[size]
    const y = b.tanker[size]
    const g = size.toLocaleString('en-NG')
    if (x.water_minor_units.borehole !== y.water_minor_units.borehole) out.push(`Tanker ${g} gal ${money(x.water_minor_units.borehole)} → ${money(y.water_minor_units.borehole)}`)
    if (x.water_minor_units.ninth_mile !== y.water_minor_units.ninth_mile) out.push(`Tanker ${g} gal Ninth Mile ${money(x.water_minor_units.ninth_mile)} → ${money(y.water_minor_units.ninth_mile)}`)
    if (x.delivery_minor_units !== y.delivery_minor_units) out.push(`Tanker ${g} gal delivery ${money(x.delivery_minor_units)} → ${money(y.delivery_minor_units)}`)
    if (x.driver_pay_minor_units !== y.driver_pay_minor_units) out.push(`Tanker ${g} gal driver pay ${money(x.driver_pay_minor_units)} → ${money(y.driver_pay_minor_units)}`)
  }
  const fa = a.delivery_fee
  const fb = b.delivery_fee
  if (fa.per_km_enabled !== fb.per_km_enabled) out.push(`Rate per km ${fb.per_km_enabled ? 'on' : 'off'}`)
  if (fa.per_km_minor_units !== fb.per_km_minor_units) out.push(`Rate per km ${money(fa.per_km_minor_units)} → ${money(fb.per_km_minor_units)}`)
  if (fa.per_area_enabled !== fb.per_area_enabled) out.push(`Fixed fee per area ${fb.per_area_enabled ? 'on' : 'off'}`)
  const pa = a.points
  const pb = b.points
  if (pa.naira_per_point !== pb.naira_per_point) out.push(`1 point per ₦${pb.naira_per_point}`)
  if (pa.welcome_bonus !== pb.welcome_bonus) out.push(`Welcome bonus ${pb.welcome_bonus} points`)
  if (pa.naira_per_redeemed_point !== pb.naira_per_redeemed_point) out.push(`1 point = ₦${pb.naira_per_redeemed_point} off`)
  if (pa.round_to !== pb.round_to) out.push(`Points rounded to ${pb.round_to}`)
  return out.slice(0, 3).join('; ') + (out.length > 3 ? ` and ${out.length - 3} more` : '')
}

function validPrices(p: SamplePriceTableInput): boolean {
  const kobo = (n: number, allowZero = true) => Number.isSafeInteger(n) && (allowZero ? n >= 0 : n > 0) && n % 100 === 0
  const rows = [500, 750, 1000] as const
  return (
    kobo(p.keke.can_minor_units[25], false) &&
    kobo(p.keke.can_minor_units[50], false) &&
    kobo(p.keke.delivery_minor_units) &&
    kobo(p.keke.rider_pay_minor_units) &&
    rows.every((r) => kobo(p.tanker[r].water_minor_units.borehole, false) && kobo(p.tanker[r].water_minor_units.ninth_mile, false) && kobo(p.tanker[r].delivery_minor_units) && kobo(p.tanker[r].driver_pay_minor_units)) &&
    kobo(p.delivery_fee.per_km_minor_units) &&
    [p.points.naira_per_point, p.points.round_to, p.points.naira_per_redeemed_point].every((n) => Number.isInteger(n) && n > 0) &&
    Number.isInteger(p.points.welcome_bonus) &&
    p.points.welcome_bonus >= 0
  )
}

/** Save a new price list version. Orders already placed keep their price (FR-024). */
export async function savePriceList(input: SamplePriceTableInput): Promise<SamplePriceTable> {
  await delay(null, 400)
  if (!validPrices(input)) throw mockError(422, 'validation_error', 'Request validation failed', [{ loc: ['body'], msg: 'Use whole naira amounts; water and can prices above ₦0', type: 'value_error' }])
  return mutate((s) => {
    requireAdmin(s)
    const current = currentPrices(s)
    const note = describeChanges(current, input)
    if (!note) throw mockError(409, 'no_changes', 'Nothing has changed since the current version')
    const next: SamplePriceTable = { ...clone(input), version: current.version + 1, created_at: new Date().toISOString(), created_by: actorName(s), note }
    s.admin.prices.push(next)
    addAudit(s, next.created_by, `Saved price list v${next.version}`, note)
    return clone(next)
  })
}

/* ---------- Payments and payouts ---------- */

export type PaymentFilter = 'all' | 'to_verify' | 'unpaid' | 'paid' | 'refunds'

export async function listPayments(filter: PaymentFilter = 'all', customerId?: string): Promise<{ payments: AdminPayment[]; counts: Record<PaymentFilter, number> }> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  const rows = allOrders(s)
    .filter((o) => !customerId || o.customer_id === customerId)
    .map<AdminPayment>((o) => ({
      reference: o.reference,
      customer_id: o.customer_id,
      customer_name: o.customer_name,
      amount_minor_units: o.total_minor_units,
      method: o.payment.method,
      status: o.payment.status,
      order_status: o.status,
      created_at: o.created_at,
    }))
  const keep: Record<PaymentFilter, (p: AdminPayment) => boolean> = {
    all: () => true,
    to_verify: (p) => p.status === 'awaiting_verification',
    unpaid: (p) => p.status === 'unpaid' && p.order_status !== 'cancelled',
    paid: (p) => p.status === 'paid',
    refunds: (p) => p.status === 'refund_due' || p.status === 'refunded',
  }
  const counts = Object.fromEntries((Object.keys(keep) as PaymentFilter[]).map((f) => [f, rows.filter(keep[f]).length])) as Record<PaymentFilter, number>
  return { payments: rows.filter(keep[filter]), counts }
}

function setPayment(s: MockState, reference: string, status: PaymentStatus): { data: CustomerData | null; order: MockCustomerOrder | null } {
  const found = findCustomerOrder(s, reference)
  const job = s.jobs.find((j) => j.reference === reference)
  if (!found && !job) throw mockError(404, 'order_not_found', 'Order not found')
  if (found) found.order.payment.status = status
  if (job) job.payment_status = status
  return { data: found?.data ?? null, order: found?.order ?? null }
}

/** Staff confirm a payment (pay on delivery or a bank transfer they checked, FR-040). */
export async function confirmPayment(reference: string, method: PaymentMethod | null = null): Promise<AdminPayment[]> {
  await delay(null, 300)
  mutate((s) => {
    requireAdmin(s)
    const row = orderRow(s, reference)
    if (!row) throw mockError(404, 'order_not_found', 'Order not found')
    if (!['unpaid', 'awaiting_verification'].includes(row.payment.status)) throw mockError(409, 'invalid_payment_change', 'Only unpaid or to-verify payments can be confirmed')
    if (row.status === 'cancelled') throw mockError(409, 'invalid_payment_change', 'This order was cancelled')
    const { data, order } = setPayment(s, reference, 'paid')
    if (order && method) order.payment.method = method
    if (data) notifyCustomer(data, 'payment', 'Payment confirmed', `Our team confirmed your payment for ${short(reference)}.`, reference)
    addAudit(s, actorName(s), `Confirmed payment for ${short(reference)}`)
  })
  return (await listPayments('all')).payments
}

/**
 * Refund as MmiriOma points (Terms §7: no cash refunds). Sample rule: the
 * price list's "1 point = ₦N off", so ₦5,900 at ₦1 a point is 5,900 points.
 */
export async function refundAsPoints(reference: string, reason: string): Promise<AdminPayment[]> {
  await delay(null, 300)
  mutate((s) => {
    requireAdmin(s)
    const r = requireReason(reason)
    const row = orderRow(s, reference)
    if (!row) throw mockError(404, 'order_not_found', 'Order not found')
    if (row.payment.status !== 'refund_due' && !(row.payment.status === 'paid' && row.status === 'cancelled')) throw mockError(409, 'invalid_payment_change', 'Only a refund that is due can be paid')
    if (!row.customer_id || !row.total_minor_units) throw mockError(409, 'no_customer_account', 'Points need a customer account')
    const points = Math.floor(row.total_minor_units / 100 / currentPrices(s).points.naira_per_redeemed_point)
    setPayment(s, reference, 'refunded')
    adjustPointsIn(s, row.customer_id, points, `Refund for ${short(reference)} as points`, null)
    addAudit(s, actorName(s), `Refunded ${short(reference)} as ${points.toLocaleString('en-NG')} points`, r)
  })
  return (await listPayments('all')).payments
}

export async function listPayouts(): Promise<{ payouts: AdminPayout[]; partners: AdminPartnerEarnings[] }> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  const payouts: AdminPayout[] = []
  const partners: AdminPartnerEarnings[] = []
  for (const [id, p] of Object.entries(s.partners)) {
    const name = s.users.find((u) => u.id === id)?.name ?? ''
    p.payouts.forEach((po) => payouts.push({ id: po.id, partner_id: id, partner_name: name, code: p.fleet_code, amount_minor_units: po.amount_minor_units, status: po.status, at: po.at, account_ending: p.profile.payout_account_ending }))
    partners.push({ partner_id: id, name, code: p.fleet_code, vehicle: p.profile.vehicle.type, wallet_minor_units: p.wallet_minor_units, week_minor_units: p.week.reduce((a, b) => a + b, 0), trips: s.jobs.filter((j) => j.partner_id === id && j.stage === 'delivered').length })
  }
  payouts.sort((a, b) => Number(a.status === 'paid') - Number(b.status === 'paid') || Date.parse(b.at) - Date.parse(a.at))
  return { payouts, partners }
}

/** Mark a requested payout as sent; the partner is told (and pushed, if they opted in). */
export async function markPayoutPaid(partnerId: string, payoutId: string): Promise<void> {
  await delay(null, 300)
  mutate((s) => {
    requireAdmin(s)
    const p = s.partners[partnerId]
    const po = p?.payouts.find((x) => x.id === payoutId)
    if (!p || !po) throw mockError(404, 'payout_not_found', 'Payout not found')
    if (po.status === 'paid') throw mockError(409, 'already_paid', 'This payout was already sent')
    po.status = 'paid'
    notifyPartner(p, 'payout', 'Payout sent', `${formatNaira(po.amount_minor_units)} sent to your bank account${p.profile.payout_account_ending ? ` ending ${p.profile.payout_account_ending}` : ''}.`, null)
    const name = s.users.find((u) => u.id === partnerId)?.name ?? ''
    addAudit(s, actorName(s), `Sent payout of ${formatNaira(po.amount_minor_units)} to ${name}`)
  })
}

/* ---------- Reports ---------- */

export async function getReport(range: ReportRange): Promise<AdminReport> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  const days = range === 'today' ? 0 : range === '7d' ? 7 : 30
  const since = Date.now() - days * 86_400_000
  const inRange = allOrders(s).filter((o) => (range === 'today' ? isToday(o.created_at) : Date.parse(o.created_at) >= since))
  const delivered = inRange.filter((o) => o.status === 'delivered')
  const byArea = new Map<string, { orders: number; delivered: number }>()
  for (const o of inRange) {
    const a = byArea.get(o.area) ?? { orders: 0, delivered: 0 }
    a.orders += 1
    if (o.status === 'delivered') a.delivered += 1
    byArea.set(o.area, a)
  }
  const byRider = new Map<string, { name: string; code: string; trips: number; earned_minor_units: number }>()
  for (const j of s.jobs.filter((x) => x.stage === 'delivered' && x.partner_id && inRange.some((o) => o.reference === x.reference))) {
    const p = partnerSummary(s, j.partner_id)!
    const r = byRider.get(p.id) ?? { name: p.name, code: p.code, trips: 0, earned_minor_units: 0 }
    r.trips += 1
    r.earned_minor_units += j.earning_minor_units
    byRider.set(p.id, r)
  }
  const byStation = new Map<string, number>()
  for (const o of inRange.filter((x) => x.station_name)) byStation.set(o.station_name, (byStation.get(o.station_name) ?? 0) + 1)
  return {
    range,
    orders: inRange.length,
    delivered: delivered.length,
    cancelled: inRange.filter((o) => o.status === 'cancelled').length,
    revenue_minor_units: delivered.reduce((sum, o) => sum + (o.total_minor_units ?? 0), 0),
    by_type: { keke: inRange.filter((o) => o.choice.delivery_type === 'keke').length, tanker: inRange.filter((o) => o.choice.delivery_type === 'tanker').length },
    by_area: [...byArea].map(([area, v]) => ({ area, ...v })).sort((a, b) => b.orders - a.orders),
    by_rider: [...byRider.values()].sort((a, b) => b.trips - a.trips),
    by_station: [...byStation].map(([name, loads]) => ({ name, loads })).sort((a, b) => b.loads - a.loads),
    is_sample: true,
  }
}

/* ---------- Support ---------- */

export async function listIssues(query?: string): Promise<AdminIssue[]> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  return clone(s.admin.issues)
    .filter((i) => matchesQuery(`${i.number} ${i.title} ${i.reference ?? ''} ${i.reporter_name}`, query))
    .sort((a, b) => Number(a.status === 'resolved') - Number(b.status === 'resolved') || Number(b.urgent) - Number(a.urgent) || Date.parse(b.at) - Date.parse(a.at))
}

/** The people on an issue's order, for the "Call" buttons. */
export async function getIssuePeople(issueId: string): Promise<{ name: string; role: string; phone: string }[]> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  const issue = s.admin.issues.find((i) => i.id === issueId)
  if (!issue) throw mockError(404, 'issue_not_found', 'Issue not found')
  const row = issue.reference ? orderRow(s, issue.reference) : null
  const people: { name: string; role: string; phone: string }[] = []
  if (row) people.push({ name: row.customer_name, role: 'Customer', phone: row.customer_phone })
  const partner = row?.partner ? s.users.find((u) => u.id === row.partner!.id) : undefined
  if (partner && row?.partner) people.push({ name: partner.name, role: row.partner.vehicle === 'keke' ? 'Rider' : 'Driver', phone: partner.phone })
  return people
}

/**
 * Resolve a support issue with one action and a reason (a-support). Every
 * resolution is written to the audit log; the reporter's ticket is closed.
 */
export async function resolveIssue(issueId: string, action: ResolutionAction, reason: string, points?: number): Promise<AdminIssue> {
  await delay(null, 400)
  return mutate((s) => {
    requireAdmin(s)
    const issue = s.admin.issues.find((i) => i.id === issueId)
    if (!issue) throw mockError(404, 'issue_not_found', 'Issue not found')
    if (issue.status === 'resolved') throw mockError(409, 'already_resolved', 'This issue is already resolved')
    const r = requireReason(reason)
    const ref = issue.reference
    const job = ref ? s.jobs.find((j) => j.reference === ref) : undefined
    const row = ref ? orderRow(s, ref) : null
    switch (action) {
      case 'confirm_without_code': {
        if (!job || job.stage !== 'collected' || !job.partner_id) throw mockError(409, 'invalid_job_transition', 'Only an order that is on its way can be confirmed without the code')
        completeDelivery(s, job, s.partners[job.partner_id])
        const found = findCustomerOrder(s, job.reference)
        found?.order.timeline.push({ label: 'Confirmed by support without the code', at: new Date().toISOString(), detail: r })
        break
      }
      case 'reassign': {
        if (!job || job.stage === 'delivered' || job.stage === 'cancelled') throw mockError(409, 'order_closed', 'This order is already finished')
        if (job.partner_id) notifyPartner(s.partners[job.partner_id], 'reassigned', 'Order taken back by admin', `${short(job.reference)} goes back to the pool. You do not need to deliver it.`, job.reference)
        job.stage = 'available'
        job.partner_id = null
        job.assigned_by = null
        job.accepted_at = null
        job.collected_at = null
        job.pickup = null
        resetCustomerOrder(s, job.reference, 'Back to the pool: support is finding another rider')
        break
      }
      case 'goodwill_points': {
        const customerId = row?.customer_id ?? s.users.find((u) => u.role === 'customer' && u.name === issue.reporter_name)?.id
        if (!customerId) throw mockError(409, 'no_customer_account', 'Points need a customer account')
        if (!points || points <= 0 || points > 1000) throw mockError(422, 'validation_error', 'Request validation failed', [{ loc: ['body', 'points'], msg: 'Enter 1 to 1,000 points', type: 'value_error' }])
        adjustPointsIn(s, customerId, points, `Goodwill from support · ${issue.title}`)
        break
      }
      case 'cancel_order':
        if (!ref) throw mockError(409, 'no_order', 'This issue is not about an order')
        cancelJob(s, ref, r)
        break
      case 'call_and_close':
        break
    }
    issue.status = 'resolved'
    issue.resolution = { action, reason: r, by: actorName(s), at: new Date().toISOString(), ...(action === 'goodwill_points' ? { points } : {}) }
    // Close the reporter's own ticket in the customer app.
    for (const d of Object.values(s.customers)) {
      const t = d.tickets.find((x) => x.id === issue.id || x.number === issue.number)
      if (t) {
        t.status = 'resolved'
        t.note = RESOLUTION_LABEL[action]
      }
    }
    addAudit(s, actorName(s), `Resolved ${issue.number} (${RESOLUTION_LABEL[action]}${action === 'goodwill_points' ? `, ${points}` : ''})`, r)
    return clone(issue)
  })
}

/* ---------- Audit, notifications, settings, account ---------- */

export async function listAudit(limit = 50): Promise<AuditEntry[]> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  return clone(s.admin.audit.slice(0, limit))
}

export async function listAdminNotifications(): Promise<AdminNotification[]> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  return clone(s.admin.notifications)
}

export async function markAdminNotificationsRead(): Promise<void> {
  await delay(null, 150)
  mutate((s) => {
    requireAdmin(s)
    s.admin.notifications.forEach((n) => (n.read = true))
  })
}

export async function getSettings(): Promise<{ settings: AdminSettings; staff: StaffMember[] }> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  return clone({ settings: s.admin.settings, staff: s.admin.staff })
}

/**
 * Save the operations settings (mock only). The support WhatsApp is not here:
 * it comes from the backend's one configuration value (FR-055, #8).
 */
export async function saveSettings(next: AdminSettings): Promise<AdminSettings> {
  await delay(null, 300)
  const clean = (v: string | null) => (v ?? '').trim() || null
  return mutate((s) => {
    requireAdmin(s)
    s.admin.settings = {
      support_phone: clean(next.support_phone),
      support_hours: clean(next.support_hours),
      code_time_limit: clean(next.code_time_limit),
      safe_load: { keke: clean(next.safe_load.keke), tanker: clean(next.safe_load.tanker) },
    }
    addAudit(s, actorName(s), 'Updated operations settings')
    return clone(s.admin.settings)
  })
}

export async function getAdminAccount(): Promise<{ name: string; phone: string; role: string; last_active: string | null }> {
  await delay(null)
  const s = read()
  const id = requireAdmin(s)
  const u = s.users.find((x) => x.id === id)!
  const staff = s.admin.staff.find((m) => m.id === id)
  return { name: u.name, phone: u.phone, role: staff?.role ?? 'Staff', last_active: staff?.last_active ?? null }
}
