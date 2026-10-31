/**
 * Mock handlers for the partner (Keke rider and tanker driver) apps.
 *
 * Rules applied here, as a server would:
 * - Only approved partners can go online and accept work.
 * - The pool shows only orders for the partner's vehicle type (decision 9);
 *   tanker drivers see only orders their tank can carry.
 * - No countdown: a job stays in the pool until someone accepts it or admin
 *   assigns it. The first partner to accept gets it; others get 409.
 * - An assigned job can be declined only with a reason (decision 13); it goes
 *   back to the pool and admin is told (FR-032).
 * - Pickup must confirm the load (FR-034); delivery needs the customer's
 *   6-digit code, 3 tries, then admin must confirm (FR-035).
 */
import type {
  DeclineReason,
  PartnerEarnings,
  PartnerIssueType,
  PartnerJob,
  PartnerNotification,
  PartnerProfile,
  PartnerSignupInput,
  SignupArea,
} from '../domain/partner'
import type { IssueType } from '../domain/admin'
import { ISSUE_LABEL } from '../domain/partner'
import type { Session } from '../lib/api/auth'
import { litresFromGallons } from '../domain/quantity'
import { tankCapacityError } from '../domain/tankCapacity'
import { normalizeNigerianPhone } from '../lib/format/phone'
import { requireUserId, startSession } from './authMock'
import { mutate, read } from './db'
import { addActivity, addAdminNotification, nextFleetCode, nextIssueNumber } from './adminState'
import { eligible } from './eligibility'
import { applyAccepted, applyCollected, completeDelivery, findCustomerOrder } from './orderSync'
import type { MockState, PartnerData, StoredJob } from './seed'
import { jobCash } from './partnerCashMock'
import { clone, delay, mockError, newDeliveryCode, newId } from './store'

const CODE_TRIES = 3
const RESEND_SECONDS = 120

/**
 * How long after arrival the mock lets a partner end a job as "customer not
 * reachable". The backend waits the full 10 minutes (FR-038); a demo should not,
 * so the mock waits one minute. Everything else about the rule is the same.
 */
export const MOCK_UNREACHABLE_WAIT_MS = 60_000

function partnerOf(s: MockState): { id: string; data: PartnerData } {
  const id = requireUserId()
  const user = s.users.find((u) => u.id === id)
  const data = s.partners[id]
  if (!user || user.role !== 'driver' || !data) throw mockError(403, 'forbidden', 'This account is not a partner account')
  return { id, data }
}

function codeFor(s: MockState, job: StoredJob): string | null {
  return findCustomerOrder(s, job.reference)?.order.delivery_code ?? job.mock_code
}

/** Strip server-only fields; add the demo code in mock mode. */
function view(s: MockState, job: StoredJob): PartnerJob {
  const copy: Partial<StoredJob> & PartnerJob = clone(job)
  delete copy.partner_id
  delete copy.declined_by
  delete copy.mock_code
  delete copy.mock_code_expired
  delete copy.mock_unloading_started
  // Partners never see the order's payment status (FR-040, BR-13).
  delete copy.payment_status
  const code = job.stage === 'collected' && job.code_tries_left !== null ? codeFor(s, job) : null
  if (code) copy.demo_code = code
  copy.cash = jobCash(s, job)
  copy.ended_at = job.ended?.at ?? null
  copy.end_reason = job.ended?.reason_code ?? null
  // What the server would allow now, worked out as the server does (#250); the screens never use the clock.
  if (job.arrived_at && job.stage === 'collected') {
    const open = !job.mock_unloading_started
    copy.can_start_unloading = open
    copy.can_fail_unreachable = open && (job.contact_attempts?.length ?? 0) >= 2 && Date.now() >= Date.parse(job.unreachable_allowed_at ?? '')
  }
  return copy
}

function findVisible(s: MockState, partnerId: string, data: PartnerData, reference: string): StoredJob {
  const job = s.jobs.find((j) => j.reference === reference)
  if (!job || !(job.partner_id === partnerId || eligible(job, partnerId, data))) {
    throw mockError(404, 'job_not_found', 'This order is not available to you')
  }
  return job
}

function requireApproved(data: PartnerData) {
  if (data.profile.approval !== 'approved') {
    throw mockError(403, 'partner_not_approved', 'Your account is waiting for approval. You can take orders once admin approves your vehicle.')
  }
}

/* ---------- Account ---------- */

export async function getPartnerProfile(): Promise<PartnerProfile> {
  await delay(null)
  const s = read()
  const { id, data } = partnerOf(s)
  const user = s.users.find((u) => u.id === id)!
  return clone({ name: user.name, phone: user.phone, ...data.profile })
}

export async function updatePartnerProfile(update: { preferences?: Partial<PartnerProfile['preferences']> }): Promise<PartnerProfile> {
  await delay(null)
  mutate((s) => {
    const { data } = partnerOf(s)
    if (update.preferences) data.profile.preferences = { ...data.profile.preferences, ...update.preferences }
  })
  return getPartnerProfile()
}

export async function setOnline(online: boolean): Promise<PartnerProfile> {
  await delay(null, 150)
  mutate((s) => {
    const { data } = partnerOf(s)
    if (online) requireApproved(data)
    if (online && !data.profile.online) {
      const user = s.users.find((u) => u.id === s.sessionUserId)
      addActivity(s, 'online', `${data.profile.vehicle.type === 'keke' ? 'Keke rider' : 'Tanker driver'} ${user?.name ?? ''} went online`)
    }
    data.profile.online = online
  })
  return getPartnerProfile()
}

export async function uploadDocument(documentId: string, fileName: string): Promise<PartnerProfile> {
  await delay(null, 400)
  mutate((s) => {
    const { data } = partnerOf(s)
    const doc = data.profile.documents.find((d) => d.id === documentId)
    if (!doc || !doc.can_upload) throw mockError(404, 'document_not_found', 'Document not found')
    doc.status = 'checking'
    doc.note = `Uploaded ${fileName}. Admin will check it.`
  })
  return getPartnerProfile()
}

/** The areas a new partner can choose at sign-up: the enabled service areas, by name (as `GET /service-zones`). */
export async function listSignupAreas(): Promise<SignupArea[]> {
  await delay(null)
  return read()
    .admin.areas.filter((a) => a.enabled)
    .map((a) => ({ id: a.id, name: a.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * A new partner's record, waiting for approval. Used by self sign-up and by
 * admin's "Add rider".
 */
export function newPartnerData(
  s: MockState,
  input: Pick<PartnerSignupInput, 'vehicle_type' | 'plate' | 'tank_gallons'> & { service_area: string },
): PartnerData {
  return {
    fleet_code: nextFleetCode(s, input.vehicle_type),
    rating: null,
    profile: {
      approval: 'pending',
      online: false,
      partner_since: new Date().toISOString().slice(0, 10),
      vehicle: {
        type: input.vehicle_type,
        plate: input.plate.trim().toUpperCase(),
        description: input.vehicle_type === 'keke' ? 'Tricycle' : `${input.tank_gallons?.toLocaleString('en-NG')} gal (${litresFromGallons(input.tank_gallons ?? 0).toLocaleString('en-NG')} L) tank`,
        tank_gallons: input.vehicle_type === 'tanker' ? input.tank_gallons : null,
        safe_load_litres: null,
        can_pour_into: input.vehicle_type === 'keke' ? 'Drums, ground tanks' : 'Ground and overhead tanks (pump)',
      },
      service_areas: [input.service_area.trim()].filter(Boolean),
      documents: [
        { id: 'd1', name: input.vehicle_type === 'keke' ? "Rider's licence" : "Driver's licence", status: 'missing', note: 'Upload a photo of your licence', can_upload: true },
        { id: 'd2', name: input.vehicle_type === 'keke' ? 'Vehicle papers' : 'Tanker papers', status: 'missing', note: 'Upload your road papers', can_upload: true },
        { id: 'd3', name: 'Clean handling training', status: 'missing', note: 'Booked by admin after approval', can_upload: false },
      ],
      preferences: { new_order_alerts: true, sms_updates: true },
      payout_account_ending: null,
    },
    wallet_minor_units: 0,
    week: [0, 0, 0, 0, 0, 0, 0],
    today_minor_units: 0,
    deliveries_today: 0,
    earnings: [],
    payouts: [],
    notifications: [],
    issues: [],
  }
}

/**
 * Partner self sign-up (decision 9). Not in the auth contract: staff accounts
 * are created by a command-line tool today. New partners start `pending` and
 * get no orders until admin approves the vehicle.
 */
export async function partnerSignup(input: PartnerSignupInput): Promise<Session> {
  await delay(null)
  const phone = normalizeNigerianPhone(input.phone)
  const details: { loc: string[]; msg: string; type: string }[] = []
  if (!phone) details.push({ loc: ['body', 'phone'], msg: 'Enter a Nigerian mobile number', type: 'value_error' })
  if (input.password.length < 8) details.push({ loc: ['body', 'password'], msg: 'Use 8 to 128 characters', type: 'value_error' })
  if (input.plate.trim().length < 4) details.push({ loc: ['body', 'plate'], msg: 'Enter the plate number', type: 'value_error' })
  if (input.vehicle_type === 'tanker') {
    const msg = tankCapacityError(input.tank_gallons)
    if (msg) details.push({ loc: ['body', 'tank_gallons'], msg, type: 'value_error' })
  }
  const area = read().admin.areas.find((a) => a.id === input.service_zone_id && a.enabled)
  if (!area) details.push({ loc: ['body', 'service_zone_id'], msg: 'Choose an active service zone', type: 'value_error' })
  if (details.length) throw mockError(422, 'validation_error', 'Request validation failed', details)
  if (read().users.some((u) => u.phone === phone)) throw mockError(409, 'phone_already_registered', 'This phone number already has an account')
  const user = mutate((s) => {
    const id = newId('user')
    const created = { id, name: input.name.trim(), phone: phone!, role: 'driver' as const, phone_verified: false, password: input.password }
    s.users.push(created)
    s.partners[id] = newPartnerData(s, { ...input, service_area: area!.name })
    addActivity(s, 'admin', `${created.name} signed up as a ${input.vehicle_type === 'keke' ? 'Keke rider' : 'tanker driver'}`)
    addAdminNotification(s, 'New partner waiting for approval', `${created.name} (${input.vehicle_type === 'keke' ? 'Keke' : 'Tanker'}, ${input.plate.trim().toUpperCase()})`, '/admin/riders')
    startSession(s, id)
    return created
  })
  return {
    user: { id: user.id, name: user.name, phone: user.phone, role: 'driver', phone_verified: false },
    csrf_token: 'mock-csrf-token',
    expires_at: read().sessionExpiresAt!,
  }
}

/* ---------- Jobs ---------- */

/** The pool for this partner. Empty when offline or not approved. */
export async function listAvailableJobs(): Promise<PartnerJob[]> {
  await delay(null)
  const s = read()
  const { id, data } = partnerOf(s)
  if (data.profile.approval !== 'approved' || !data.profile.online) return []
  return s.jobs.filter((j) => eligible(j, id, data)).map((j) => view(s, j))
}

/** Jobs assigned to or accepted by this partner and not finished. */
export async function listMyActiveJobs(): Promise<PartnerJob[]> {
  await delay(null)
  const s = read()
  const { id } = partnerOf(s)
  return s.jobs.filter((j) => j.partner_id === id && ['assigned', 'accepted', 'collected'].includes(j.stage)).map((j) => view(s, j))
}

export async function getJob(reference: string): Promise<PartnerJob> {
  await delay(null)
  const s = read()
  const { id, data } = partnerOf(s)
  return view(s, findVisible(s, id, data, reference))
}

export async function acceptJob(reference: string): Promise<PartnerJob> {
  await delay(null, 350)
  return mutate((s) => {
    const { id, data } = partnerOf(s)
    requireApproved(data)
    const job = s.jobs.find((j) => j.reference === reference)
    if (!job) throw mockError(404, 'job_not_found', 'This order is not available to you')
    const mineAssigned = job.stage === 'assigned' && job.partner_id === id
    if (!mineAssigned && !eligible(job, id, data)) {
      if (job.partner_id && job.partner_id !== id) throw mockError(409, 'order_taken', 'Another partner already took this order')
      if (job.partner_id === id) return view(s, job)
      throw mockError(404, 'job_not_found', 'This order is not available to you')
    }
    const now = new Date().toISOString()
    job.stage = 'accepted'
    job.partner_id = id
    job.accepted_at = now
    job.assigned_by = null
    applyAccepted(s, reference, id, now)
    return view(s, job)
  })
}

export async function declineJob(reference: string, reason: DeclineReason, note: string): Promise<void> {
  await delay(null, 300)
  mutate((s) => {
    const { id, data } = partnerOf(s)
    const job = s.jobs.find((j) => j.reference === reference)
    if (!job || job.stage !== 'assigned' || job.partner_id !== id) throw mockError(409, 'not_assigned_to_you', 'Only an order assigned to you can be declined')
    if (!reason) throw mockError(422, 'validation_error', 'Request validation failed', [{ loc: ['body', 'reason'], msg: 'Choose a reason', type: 'value_error' }])
    job.stage = 'available'
    job.partner_id = null
    job.assigned_by = null
    job.declined_by.push(id)
    data.issues.unshift({ id: newId('pi'), type: `decline:${reason}`, note: note.trim(), reference, at: new Date().toISOString() })
    const user = s.users.find((u) => u.id === id)
    addActivity(s, 'admin', `${user?.name ?? 'A partner'} declined ${reference.slice(0, 7)}; back in the pool`, reference)
    addAdminNotification(s, 'Assigned order declined', `${user?.name ?? 'A partner'} declined ${reference.slice(0, 7)}. Assign someone else or leave it in the pool.`, '/admin/orders')
  })
}

export async function confirmPickup(
  reference: string,
  pickup: { loaded: boolean; receipt: boolean; photo_url: string | null; gallons_loaded: number | null },
): Promise<PartnerJob> {
  await delay(null, 300)
  return mutate((s) => {
    const { id, data } = partnerOf(s)
    const job = findVisible(s, id, data, reference)
    if (job.partner_id !== id || job.stage !== 'accepted') throw mockError(409, 'invalid_job_transition', 'This order is not waiting for pickup')
    if (!pickup.loaded) throw mockError(422, 'load_not_confirmed', 'Confirm the full load before you leave the station')
    if (job.choice.delivery_type === 'tanker') {
      const need = job.choice.tank_size_gallons ?? 0
      if ((pickup.gallons_loaded ?? 0) < need) throw mockError(422, 'load_not_confirmed', `Load ${need.toLocaleString('en-NG')} gallons before you leave`)
    }
    const now = new Date().toISOString()
    job.stage = 'collected'
    job.collected_at = now
    job.pickup = pickup
    job.remaining =
      job.customer.distance_km !== null && job.customer.minutes !== null ? { distance_km: job.customer.distance_km, minutes: job.customer.minutes } : null
    // No code yet: it is issued when unloading is done (FR-035, #13).
    job.code_tries_left = null
    job.code_resend_at = null
    applyCollected(s, job, now)
    return view(s, job)
  })
}

/** The partner's own job that is on its way to, or at, the customer. */
function jobAtCustomer(s: MockState, reference: string): StoredJob {
  const { id, data } = partnerOf(s)
  const job = findVisible(s, id, data, reference)
  if (job.partner_id !== id || job.stage !== 'collected') throw mockError(409, 'invalid_order_transition', 'This job is not at the step that allows this action.')
  return job
}

/** A job the partner has arrived at and not started unloading. */
function jobWaitingAtCustomer(s: MockState, reference: string): StoredJob {
  const job = jobAtCustomer(s, reference)
  if (!job.arrived_at || job.mock_unloading_started) throw mockError(409, 'invalid_order_transition', 'This job is not at the step that allows this action.')
  return job
}

/**
 * "I have arrived" (U1, #250): stamps the arrival and the earliest time the
 * partner may end the job as unreachable. No location. Repeating changes nothing.
 */
export async function arriveAtCustomer(reference: string): Promise<PartnerJob> {
  await delay(null, 300)
  return mutate((s) => {
    const job = jobAtCustomer(s, reference)
    if (!job.arrived_at) {
      const now = Date.now()
      job.arrived_at = new Date(now).toISOString()
      job.unreachable_allowed_at = new Date(now + MOCK_UNREACHABLE_WAIT_MS).toISOString()
      job.contact_attempts = []
    }
    return view(s, job)
  })
}

/** "Start unloading" (U2, #250). Repeating changes nothing. */
export async function startUnloading(reference: string): Promise<PartnerJob> {
  await delay(null, 300)
  return mutate((s) => {
    const job = jobAtCustomer(s, reference)
    if (!job.arrived_at) throw mockError(409, 'invalid_order_transition', 'This job is not at the step that allows this action.')
    job.mock_unloading_started = true
    return view(s, job)
  })
}

/** "I tried to reach the customer" (U3, #250): one more attempt, with the server's time. No maximum. */
export async function recordContactAttempt(reference: string): Promise<PartnerJob> {
  await delay(null, 300)
  return mutate((s) => {
    const job = jobWaitingAtCustomer(s, reference)
    job.contact_attempts = [...(job.contact_attempts ?? []), new Date().toISOString()]
    return view(s, job)
  })
}

/**
 * "Fail the delivery" (U3-S, #250, FR-038): refused until two attempts are
 * recorded and the wait since arrival is over, with the backend's 409 and its
 * `details.missing`. Then the job ends as failed, "customer_unreachable".
 *
 * @throws 409 `transition_requirements_unmet` (`contact_attempts_recorded`, `unreachable_wait_elapsed`).
 */
export async function failUnreachable(reference: string): Promise<PartnerJob> {
  await delay(null, 300)
  return mutate((s) => {
    const job = jobWaitingAtCustomer(s, reference)
    const missing: string[] = []
    if ((job.contact_attempts?.length ?? 0) < 2) missing.push('contact_attempts_recorded')
    if (Date.now() < Date.parse(job.unreachable_allowed_at ?? '')) missing.push('unreachable_wait_elapsed')
    if (missing.length > 0) throw mockError(409, 'transition_requirements_unmet', 'This step needs more information before it can be recorded.', { missing })
    const now = new Date().toISOString()
    const by = s.users.find((u) => u.id === job.partner_id)?.name ?? 'The partner'
    job.stage = 'failed'
    job.ended = { kind: 'failed', reason_code: 'customer_unreachable', note: null, by, at: now }
    const found = findCustomerOrder(s, reference)
    if (found) found.order.timeline.push({ label: 'Delivery failed', at: now })
    addActivity(s, 'admin', `${by} could not reach the customer for ${reference.slice(0, 7)}; the delivery failed`, reference)
    return view(s, job)
  })
}

/** The job's code step, refused until unloading is done. */
function waitingCode(s: MockState, reference: string): StoredJob & { code_tries_left: number } {
  const { id, data } = partnerOf(s)
  const job = findVisible(s, id, data, reference)
  if (job.partner_id !== id || job.stage !== 'collected') throw mockError(409, 'invalid_job_transition', 'This order is not waiting for its code')
  if (job.code_tries_left === null) throw mockError(409, 'transition_requirements_unmet', 'Finish unloading first', { missing: ['unloading_confirmed'] })
  return job as StoredJob & { code_tries_left: number }
}

/**
 * Unloading is done: send the customer's delivery code (FR-035, #13). The
 * code of a linked customer order is the one the customer already sees.
 * Repeating it changes nothing.
 */
export async function completeUnloading(reference: string): Promise<PartnerJob> {
  await delay(null, 300)
  return mutate((s) => {
    const { id, data } = partnerOf(s)
    const job = findVisible(s, id, data, reference)
    if (job.partner_id !== id || job.stage !== 'collected') throw mockError(409, 'invalid_job_transition', 'This order is not being unloaded')
    if (job.code_tries_left === null) {
      if (!findCustomerOrder(s, reference)) job.mock_code ??= newDeliveryCode()
      job.code_tries_left = CODE_TRIES
      job.code_resend_at = new Date(Date.now() + RESEND_SECONDS * 1000).toISOString()
      job.code_sms_status = 'accepted'
    }
    return view(s, job)
  })
}

/**
 * Demo and test switch: make the job's current code look like the backend's
 * trouble cases (#138). `sms_failed`: the SMS was refused, so the code was
 * not sent. `expired`: `verifyCode` answers `delivery_code_expired`. `null`
 * clears both. A new code (`resendCode`) clears them too.
 *
 * @throws 409 `transition_requirements_unmet` before unloading is done.
 */
export function simulateCodeProblem(reference: string, problem: 'sms_failed' | 'expired' | null): void {
  mutate((s) => {
    const job = waitingCode(s, reference)
    job.code_sms_status = problem === 'sms_failed' ? 'failed' : 'accepted'
    job.mock_code_expired = problem === 'expired'
  })
}

/**
 * Check the customer's delivery code. Wrong codes count down from 3; at 0 the
 * code is locked and admin must confirm the delivery (`r-otp-error`).
 *
 * @throws 409 `transition_requirements_unmet` before unloading is done;
 *   422 `invalid_code` with `details.tries_left`; 423 `code_locked`.
 */
export async function verifyCode(reference: string, code: string): Promise<PartnerJob> {
  await delay(null, 400)
  return mutate((s) => {
    const { data } = partnerOf(s)
    const job = waitingCode(s, reference)
    if (job.code_tries_left <= 0) throw mockError(423, 'code_locked', 'Too many wrong codes. Ask admin to confirm the delivery.')
    if (job.mock_code_expired) throw mockError(400, 'delivery_code_expired', 'This code has expired. Send a new code.')
    if (code !== codeFor(s, job)) {
      job.code_tries_left -= 1
      if (job.code_tries_left <= 0) throw mockError(423, 'code_locked', 'Too many wrong codes. Ask admin to confirm the delivery.')
      throw mockError(422, 'invalid_code', 'That code is not right', { tries_left: job.code_tries_left })
    }
    completeDelivery(s, job, data)
    return view(s, job)
  })
}

/** Send the customer a new code. Allowed once unloading is done and the resend wait is over. */
export async function resendCode(reference: string): Promise<PartnerJob> {
  await delay(null, 300)
  return mutate((s) => {
    const job = waitingCode(s, reference)
    const wait = job.code_resend_at ? Math.ceil((Date.parse(job.code_resend_at) - Date.now()) / 1000) : 0
    if (wait > 0) throw mockError(429, 'too_many_attempts', 'Wait before sending a new code', { retry_after_seconds: wait })
    const fresh = newDeliveryCode()
    const linked = findCustomerOrder(s, reference)
    if (linked) linked.order.delivery_code = fresh
    else job.mock_code = fresh
    job.code_tries_left = CODE_TRIES
    job.code_resend_at = new Date(Date.now() + RESEND_SECONDS * 1000).toISOString()
    job.code_sms_status = 'accepted'
    job.mock_code_expired = false
    return view(s, job)
  })
}

/* ---------- Earnings, history, notifications, issues ---------- */

/** How a partner's report shows in the admin support queue. */
const PARTNER_ISSUE_TYPE: Record<PartnerIssueType, IssueType> = {
  customer_unreachable: 'customer_unreachable',
  unsafe_pour: 'unsafe_access',
  bad_address: 'other',
  station_problem: 'station_problem',
  vehicle_breakdown: 'other',
  code_not_working: 'code_not_working',
}

export async function getEarnings(): Promise<PartnerEarnings> {
  await delay(null)
  const s = read()
  const { id, data } = partnerOf(s)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const today = new Date(Date.now() + 3_600_000).getUTCDay()
  const week = data.week.map((amount, i) => ({
    day: i === 6 ? 'Today' : days[(today - (6 - i) + 7) % 7],
    amount_minor_units: amount,
  }))
  const weekAgo = Date.now() - 7 * 86_400_000
  const weekJobs = s.jobs.filter((j) => j.partner_id === id && j.stage === 'delivered' && j.delivered_at && Date.parse(j.delivered_at) > weekAgo)
  return clone({
    wallet_minor_units: data.wallet_minor_units,
    today_minor_units: data.today_minor_units,
    deliveries_today: data.deliveries_today,
    week_minor_units: data.week.reduce((a, b) => a + b, 0),
    trips_this_week: weekJobs.length,
    gallons_this_week: weekJobs.reduce((a, j) => a + (j.choice.delivery_type === 'tanker' ? (j.choice.tank_size_gallons ?? 0) : 0), 0),
    week,
    entries: data.earnings,
    payouts: data.payouts,
    is_sample: true,
  })
}

export async function requestPayout(amountMinorUnits: number): Promise<PartnerEarnings> {
  await delay(null, 400)
  mutate((s) => {
    const { data } = partnerOf(s)
    if (!Number.isSafeInteger(amountMinorUnits) || amountMinorUnits <= 0) {
      throw mockError(422, 'validation_error', 'Request validation failed', [{ loc: ['body', 'amount_minor_units'], msg: 'Enter an amount', type: 'value_error' }])
    }
    if (amountMinorUnits > data.wallet_minor_units) throw mockError(422, 'insufficient_balance', 'That is more than your wallet balance')
    if (!data.profile.payout_account_ending) throw mockError(409, 'no_payout_account', 'Add a bank account with admin before requesting a payout')
    data.wallet_minor_units -= amountMinorUnits
    data.payouts.unshift({ id: newId('po'), at: new Date().toISOString(), amount_minor_units: amountMinorUnits, status: 'requested' })
  })
  return getEarnings()
}

export async function listHistory(): Promise<PartnerJob[]> {
  await delay(null)
  const s = read()
  const { id } = partnerOf(s)
  return s.jobs
    .filter((j) => j.partner_id === id && (j.stage === 'delivered' || j.stage === 'cancelled' || j.stage === 'failed'))
    .sort((a, b) => Date.parse(b.delivered_at ?? b.ended?.at ?? '') - Date.parse(a.delivered_at ?? a.ended?.at ?? ''))
    .map((j) => view(s, j))
}

export async function listPartnerNotifications(): Promise<PartnerNotification[]> {
  await delay(null)
  return clone(partnerOf(read()).data.notifications)
}

export async function markPartnerNotificationsRead(): Promise<void> {
  await delay(null, 100)
  mutate((s) => partnerOf(s).data.notifications.forEach((n) => (n.read = true)))
}

export async function reportIssue(input: { type: PartnerIssueType; note: string; reference: string | null }): Promise<{ id: string }> {
  await delay(null, 300)
  return mutate((s) => {
    const { data } = partnerOf(s)
    const issue = { id: newId('pi'), type: input.type, note: input.note.trim(), reference: input.reference, at: new Date().toISOString() }
    data.issues.unshift(issue)
    // The same report goes to the admin support queue (a-support). A failing
    // code with the customer waiting is urgent.
    const user = s.users.find((u) => u.id === s.sessionUserId)
    const title = ISSUE_LABEL[input.type](data.profile.vehicle.type)
    const number = nextIssueNumber(s)
    s.admin.issues.unshift({
      id: issue.id,
      number,
      type: PARTNER_ISSUE_TYPE[input.type],
      title,
      message: issue.note || title,
      reference: input.reference,
      reported_by: data.profile.vehicle.type === 'keke' ? 'rider' : 'driver',
      reporter_name: user?.name ?? 'Partner',
      at: issue.at,
      urgent: input.type === 'code_not_working' || input.type === 'unsafe_pour',
      status: 'open',
      resolution: null,
    })
    addActivity(s, 'complaint', `${title}${input.reference ? ` on ${input.reference.slice(0, 7)}` : ''}`, input.reference)
    addAdminNotification(s, input.type === 'code_not_working' ? 'Urgent: delivery code not working' : 'New support issue', `${number} · ${user?.name ?? 'Partner'}`, '/admin/support')
    return { id: issue.id }
  })
}
