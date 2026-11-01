/**
 * Deciding a hold in admin (#166), as designed in
 * docs/design/admin-hold-review.md (#128, approved G2) against the agreed
 * contract (docs/api/deliveries.md, "Admin hold review endpoints"). This part
 * covers proof review (R1). Pure functions only, so the screens stay thin.
 */
import type { ProofEvidence, ProofOverrideRequest } from '../../../lib/api/adminHolds'
import { ApiError } from '../../../lib/api/client'
import type { AgreementMethod } from '../../../lib/api/confirmationTypes'
import { errorMessage } from '../../../lib/api/errorMessage'
import { formatTime } from '../../../lib/format/datetime'
import { lagosIso, lagosNowTime, lagosToday } from '../confirm/logic'

/** A decision note, and the customer's details, are at most this long (contract). */
export const NOTE_MAX = 500

/** Why there is no delivery code, in staff words (design R1). */
export const PROOF_REASON_LABEL: Record<NonNullable<ProofEvidence['reason']>, string> = {
  customer_cannot_receive_code: 'Customer cannot receive the code',
  other: 'Other',
}

/** How the customer confirmed (design R1; the contract's codes). */
export const CONFIRM_METHOD_LABEL: Record<AgreementMethod, string> = {
  phone_call: 'Phone call with the customer',
  in_person_to_staff: 'Customer confirmed in person to staff',
  other: 'Other (details required)',
}

/** The order's status in staff words (docs/api/orders.md, "Order statuses"): the sheet shows the server's own status, not the admin grouping. */
export const STAFF_STATUS_LABEL: Record<string, string> = {
  quote_requested: 'Request received',
  awaiting_payment: 'Awaiting payment',
  awaiting_confirmation: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  assigned: 'Assigned - awaiting driver',
  accepted: 'Driver accepted',
  departed: 'Driver departed',
  collected: 'Water collected',
  en_route: 'On the way',
  arrived: 'Driver arrived',
  unloading: 'Unloading',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  failed: 'Delivery failed',
  disputed: 'Disputed',
}

/** The driver's other reports on the job, by type (deliveries.md, incidents). An unknown type shows as "Report". */
export const INCIDENT_LABEL: Record<string, string> = {
  running_late: 'Running late',
  unsafe_access: 'Unsafe access',
  unsafe_transfer: 'Unsafe transfer',
  volume_issue: 'Volume issue',
  source_concern: 'Source concern',
  vehicle_problem: 'Vehicle problem',
  other: 'Other',
}

/** The delivery code line: whether it was issued, the SMS, the attempts and whether it expired. The code itself is never shown. */
export function deliveryCodeLine(code: ProofEvidence['delivery_code']): string {
  if (!code) return 'No code was issued.'
  const sms = code.sms_status === 'accepted' ? 'SMS accepted' : 'SMS not accepted'
  return `Issued ${formatTime(code.issued_at)} · ${sms} · ${code.attempts_used} of ${code.attempts_limit} attempts used · ${code.expired ? 'Expired' : 'Not expired'}`
}

export interface ProofForm {
  choice: 'approve' | 'reject'
  /** How the customer confirmed (approve only). */
  method: AgreementMethod
  /** When they confirmed, Lagos time: `YYYY-MM-DD` and `HH:MM` (approve only). */
  date: string
  time: string
  /** Details of the confirmation: required for "Other", optional otherwise (approve only). */
  details: string
  /** The dispatcher's own note: required, 1 to 500. For a rejection, the reason. */
  note: string
}

export function initialProofForm(now: Date = new Date()): ProofForm {
  return { choice: 'approve', method: 'phone_call', date: lagosToday(now), time: lagosNowTime(now), details: '', note: '' }
}

export interface ProofErrors {
  when?: string
  details?: string
  note?: string
  /** FAIL only: no reason chosen (or one the server refused). */
  reason?: string
}

/** The clock tolerance the contract gives the confirmation time (2 minutes). */
const CLOCK_TOLERANCE_MS = 2 * 60_000

/**
 * The checks the contract makes, worded for the form: a note of 1 to 500
 * characters; for an approval, a confirmation time that is not in the future
 * and not before unloading was completed, and details for "Other".
 */
export function proofErrors(form: ProofForm, evidence: ProofEvidence, now: Date = new Date()): ProofErrors {
  const errors: ProofErrors = {}
  const note = form.note.trim()
  if (note.length < 1 || note.length > NOTE_MAX) errors.note = `Write a note (up to ${NOTE_MAX} characters).`
  if (form.choice === 'reject') return errors
  if (!form.date || !form.time) {
    errors.when = 'Enter when the customer confirmed.'
  } else {
    const at = Date.parse(lagosIso(form.date, form.time))
    if (Number.isNaN(at)) errors.when = 'Enter when the customer confirmed.'
    else if (at > now.getTime() + CLOCK_TOLERANCE_MS) errors.when = "The time can't be in the future."
    else if (evidence.unloading_completed_at && at < Date.parse(evidence.unloading_completed_at) - CLOCK_TOLERANCE_MS) {
      errors.when = `The time can't be before unloading was completed (${formatTime(evidence.unloading_completed_at)}).`
    }
  }
  if (form.method === 'other' && !form.details.trim()) errors.details = 'Add details for Other.'
  return errors
}

/** The request for the form. Call only when `proofErrors` finds nothing. */
export function buildProofRequest(form: ProofForm, holdId: string): ProofOverrideRequest {
  const note = form.note.trim()
  if (form.choice === 'reject') return { hold_id: holdId, decision: 'reject', note }
  return {
    hold_id: holdId,
    decision: 'approve',
    customer_acknowledgment: { method: form.method, confirmed_at: lagosIso(form.date, form.time), note: form.details.trim() || null },
    note,
  }
}

/** "This order has changed." with Refresh: every stale case (design decision 11). */
export const CHANGED_MESSAGE = 'This order has changed.'

export interface DecisionFailure {
  message: string
  /** The hold or the order moved on: offer Refresh instead of a retry. */
  changed: boolean
  /** A field the server refused (422), to show under it. */
  fields: ProofErrors
  /** Continue only: the server's new answer on the source (409 `source_not_eligible`), so the card can update. */
  eligibility?: 'not_eligible' | 'cannot_check'
}

/** Whether a decision note is valid: 1 to 500 characters once trimmed. */
export const noteError = (note: string): string | undefined =>
  note.trim().length < 1 || note.trim().length > NOTE_MAX ? `Write a note (up to ${NOTE_MAX} characters).` : undefined

/** The server's answer on a source, as the card shows it (design R2). */
export const ELIGIBILITY_CHIP = {
  eligible: { label: 'Can be used', tone: 'green' },
  not_eligible: { label: 'Cannot be used', tone: 'red' },
  cannot_check: { label: 'Cannot be checked', tone: 'amber' },
} as const

/** The kind of unsafe report (R3). */
export const REPORT_KIND_LABEL: Record<string, string> = { unsafe_access: 'Unsafe access', unsafe_transfer: 'Unsafe transfer' }

/** Why Continue is off when the source cannot be used (design R2). */
export const CONTINUE_OFF = 'Continue is only possible when the source can be used. Fail or cancel the order instead.'

/** Which form field a 422 `loc` points at. */
function fieldOf(loc: unknown): keyof ProofErrors | null {
  if (!Array.isArray(loc)) return null
  if (loc.includes('reason_code')) return 'reason'
  if (loc.includes('confirmed_at')) return 'when'
  if (loc.includes('customer_acknowledgment') && loc.includes('note')) return 'details'
  if (loc.at(-1) === 'note') return 'note'
  return null
}

/**
 * Words for a refused decision (design R1 errors). A stale hold or order is
 * "This order has changed."; the rest are the contract's messages, or plain
 * words for a lost connection (what was typed is kept).
 */
export function decisionFailure(error: unknown): DecisionFailure {
  const none: ProofErrors = {}
  if (!(error instanceof ApiError)) return { message: errorMessage(error), changed: false, fields: none }
  switch (error.code) {
    case 'hold_not_open':
    case 'hold_not_found':
    case 'invalid_order_transition':
      return { message: CHANGED_MESSAGE, changed: true, fields: none }
    case 'own_delivery_override':
      return { message: "You can't approve proof for a delivery you made.", changed: false, fields: none }
    case 'source_not_eligible': {
      // The server's sentence as written, and its new answer for the card.
      const answer = (error.details as { answer?: unknown } | null)?.answer
      return { message: error.message, changed: false, fields: none, ...(answer === 'not_eligible' || answer === 'cannot_check' ? { eligibility: answer } : {}) }
    }
    case 'assignment_not_found':
      return { message: 'This order has no driver assigned', changed: false, fields: none }
    case 'csrf_failed':
      return { message: 'Your security check failed. Reload the page.', changed: false, fields: none }
    case 'validation_error': {
      const fields: ProofErrors = {}
      if (Array.isArray(error.details)) {
        for (const item of error.details as { loc?: unknown; msg?: unknown }[]) {
          const field = fieldOf(item.loc)
          if (field && typeof item.msg === 'string' && !fields[field]) fields[field] = item.msg
        }
      }
      return { message: 'Check the fields marked below.', changed: false, fields }
    }
    default:
      if (error.kind === 'network') return { message: 'No connection. What you typed is kept. Try again.', changed: false, fields: none }
      return { message: errorMessage(error), changed: false, fields: none }
  }
}

/** Toast text after a decision (design decision 13). */
export const PROOF_TOAST = {
  approve: 'Proof approved. The order is now Delivered.',
  reject: 'Proof rejected. The driver can send a new code.',
} as const

/** FAIL: the three reasons agreed for these screens (deliveries.md, row 20), in staff words. `customer_unreachable` and `vehicle_failure` are not offered here (design decision 6). */
export const FAIL_REASONS = [
  { code: 'source_quality_concern', label: 'Source quality concern' },
  { code: 'unsafe_access', label: 'Unsafe access' },
  { code: 'other', label: 'Other (a note is required)' },
] as const
export type FailReasonCode = (typeof FAIL_REASONS)[number]['code']

export interface FailForm {
  reason: FailReasonCode | null
  note: string
}

/** The contract's checks on FAIL: a reason, and a note of up to 500 characters that `other` requires. */
export function failErrors(form: FailForm): ProofErrors {
  const errors: ProofErrors = {}
  if (!form.reason) errors.reason = 'Choose a reason.'
  const note = form.note.trim()
  if (form.reason === 'other' && note.length < 1) errors.note = 'Write a note: Other needs one.'
  else if (note.length > NOTE_MAX) errors.note = `Write a note (up to ${NOTE_MAX} characters).`
  return errors
}

/** CANCEL: the two reasons the contract accepts (deliveries.md, "Cancel because the customer asked"), in staff words. Neither is preset (design #174, decision 10). */
export const CANCEL_REASONS = [
  { code: 'customer_request', label: 'The customer asked to cancel' },
  { code: 'mmirioma_unable', label: 'MmiriOma is unable to deliver' },
] as const
export type CancelReasonCode = (typeof CANCEL_REASONS)[number]['code']

/** The contract's checks on CANCEL: a note of up to 500 characters, required once unloading has started (FR-044 administrator review). */
export function cancelNoteError(note: string, expectedStatus: string): string | undefined {
  const text = note.trim()
  if (text.length > NOTE_MAX) return `Write a note (up to ${NOTE_MAX} characters).`
  if (expectedStatus === 'unloading' && text.length < 1) return 'Say why: unloading has already started.'
  return undefined
}

/** The sentence the CANCEL dialog says about the driver (design #129, C1): the job ends only if a driver has one. */
export const CANCEL_DRIVER_LIVE = "The driver's job ends and leaves their list. Nothing notifies the driver."
export const CANCEL_DRIVER_NONE = "No driver is assigned, so no driver's job changes."
/** A rider is on the order but the job is no longer live (for example after a failed delivery): #274. */
export const CANCEL_DRIVER_ENDED = "This order's job has ended, so no driver's job changes."
export const CANCEL_CUSTOMER = 'No cancellation message is sent to the customer yet: tell them yourself.'

/** Why the cost sentence could not be shown: the order cannot be cancelled (409), or the lookup failed. */
export function outcomeFailure(error: unknown): { message: string; retry: boolean } {
  if (error instanceof ApiError && error.code === 'invalid_order_transition') return { message: 'This order can no longer be cancelled.', retry: false }
  return { message: "We couldn't check what this costs the customer.", retry: true }
}

/**
 * The status the dispatcher saw, as the server names it, for `expected_status`
 * when the order is opened from the panel. The real list carries it; a mock
 * order does not, so it is worked out from the admin status.
 */
export function backendStatusFor(order: { status: string; backend_status?: string }): string {
  if (order.backend_status) return order.backend_status
  const byAdminStatus: Record<string, string> = {
    awaiting_confirmation: 'awaiting_confirmation',
    awaiting_rider: 'confirmed',
    assigned: 'assigned',
    loading: 'accepted',
    on_the_way: 'collected',
  }
  return byAdminStatus[order.status] ?? order.status
}

/** Whether a delivery can be failed from the panel: the driver has accepted it, and it has not ended (row 20; design: "Driver accepted or later"). */
export function canFail(order: { status: string; backend_status?: string }): boolean {
  return ['accepted', 'departed', 'collected', 'en_route', 'arrived', 'unloading'].includes(backendStatusFor(order))
}

/**
 * Whether the order panel offers "Cancel this order" (admin-order-cancellation.md,
 * decision 2). The contract refuses a cancel from cancelled, delivered and
 * disputed (row 23), so the button is not on the page for those.
 */
export function canCancel(order: { status: string }): boolean {
  return !['delivered', 'cancelled', 'disputed'].includes(order.status)
}

/**
 * Whether a driver's job is live, so the CANCEL dialog may say it ends
 * (decision 4). Before a rider is assigned, and after a failed delivery,
 * there is no live assignment to end.
 */
export function hasLiveDriver(order: { status: string }): boolean {
  return ['assigned', 'loading', 'on_the_way'].includes(order.status)
}

/** What the CANCEL dialog says about the driver: a live job, a job that has ended, or no driver. */
export type CancelDriverState = 'live' | 'ended' | 'none'

export const CANCEL_DRIVER_NOTE: Record<CancelDriverState, string> = {
  live: CANCEL_DRIVER_LIVE,
  ended: CANCEL_DRIVER_ENDED,
  none: CANCEL_DRIVER_NONE,
}

/**
 * Picks the CANCEL dialog's driver note from the order, not only its status
 * (#274). The panel shows a rider on a failed order, so "No driver is
 * assigned" would be false there; the job has simply ended.
 *
 * @param order The order's status and the rider the panel shows, if any.
 * @returns `live` while the job is live, `ended` when a rider is shown but the
 *   job is not live, `none` when there is no rider.
 */
export function cancelDriverState(order: { status: string; partner: unknown | null }): CancelDriverState {
  if (hasLiveDriver(order)) return 'live'
  return order.partner ? 'ended' : 'none'
}

export const FAIL_TOAST = 'Delivery marked as failed.'
export const CANCEL_TOAST = 'Order cancelled. Tell the customer.'

export const CONTINUE_TOAST = 'Continued. The driver can go on to the customer.'
export const RESUME_TOAST = 'Resumed. The driver can continue.'
export const WITHDRAW_TOAST = 'Job withdrawn. The order is back to Confirmed.'
