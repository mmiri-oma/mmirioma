/**
 * Confirming an order in admin (#136), as designed in
 * docs/design/admin-confirm-order.md (#72, approved G2) against the agreed
 * confirmation contract (docs/api/deliveries.md, "Order confirmation
 * endpoints", and its amendment #72).
 *
 * Two kinds share one sheet: a priced order ("Server price",
 * `awaiting_confirmation`), confirmed at its quote's total and category, and
 * a price request ("Manual price", `quote_requested`), confirmed with the
 * total agreed on the call. Pure functions only, so the screens stay thin.
 */
import type { AgreementMethod, SourceReason } from '../../../lib/api/confirmationTypes'
import { missingRequirements, type CategoryOptions, type ConfirmationRequirement, type ConfirmRequest, type SourceOption } from '../../../lib/api/adminConfirmation'
import type { AdminOrderDetail, AdminOrderEvent } from '../../../lib/api/adminDispatch'
import { ApiError } from '../../../lib/api/client'
import { formatDayDate, formatTime } from '../../../lib/format/datetime'
import { formatNaira, nairaInputToKobo } from '../../../lib/format/money'

export type ConfirmKind = 'server' | 'manual'

/** The price chip on the panel, sheet, dialog, summary and history (design decision 5). */
export const KIND_CHIP: Record<ConfirmKind, string> = { server: 'Server price', manual: 'Manual price' }

/** Why a source cannot be used, one line each with a ban icon (upstream C1 labels). */
export const REASON_LABEL: Record<SourceReason, string> = {
  not_activated: 'Not activated for this category',
  suspended: 'Suspended after a safety concern',
  revoked: 'Activation revoked',
  approval_expired: 'Laboratory approval expired',
}

/** How the customer agreed: the hold review's codes and labels (confirmation decision 4). */
export const AGREEMENT_LABEL: Record<AgreementMethod, string> = {
  phone_call: 'Phone call with the customer',
  in_person_to_staff: 'Customer agreed in person to staff',
  other: 'Other (add a note)',
}

/** One line per missing check on a refusal (409 `transition_requirements_unmet`). */
export const REQUIREMENT_LABEL: Record<ConfirmationRequirement, string> = {
  phone_verified: "The customer's phone is not verified",
  source_eligible: 'The chosen water source can no longer be used for this category',
  delivery_window_set: 'The delivery window is not set',
}

/** The customer's source preference, as the customer app words it (decision 10b). */
export const SOURCE_KIND_LABEL: Record<'ninth_mile' | 'borehole', string> = {
  ninth_mile: 'Ninth Mile water',
  borehole: 'Any borehole water',
}

/**
 * Which kind of confirmation an order needs, or `null` when it cannot be
 * confirmed (already confirmed, moving, or ended).
 */
export function confirmKind(detail: Pick<AdminOrderDetail, 'status' | 'quote'>): ConfirmKind | null {
  if (detail.status === 'awaiting_confirmation' && detail.quote) return 'server'
  if (detail.status === 'quote_requested') return 'manual'
  return null
}

/**
 * The kind of source a priced Tanker order must use (the customer's
 * `water_source`), or `null` when any kind may be used: a Keke order, or a
 * price request, where the preference is only a hint.
 */
export function requiredSourceKind(detail: Pick<AdminOrderDetail, 'delivery_type' | 'water_source'>, kind: ConfirmKind): 'ninth_mile' | 'borehole' | null {
  return kind === 'server' && detail.delivery_type === 'tanker' ? detail.water_source : null
}

/**
 * A category's sources, split as the sheet shows them: those that can be
 * used (no reasons, and of the required kind), then those that cannot. A
 * source of another kind is left out for a priced Tanker order (design Q1,
 * section 5), and a source with no kind never matches it (deliveries.md).
 */
export function sourcesFor(
  category: CategoryOptions | undefined,
  requiredKind: 'ninth_mile' | 'borehole' | null,
): { usable: SourceOption[]; unusable: SourceOption[] } {
  const sources = (category?.sources ?? []).filter((s) => requiredKind === null || s.kind === requiredKind)
  return { usable: sources.filter((s) => s.reasons.length === 0), unusable: sources.filter((s) => s.reasons.length > 0) }
}

/** Categories a price request can use: those with at least one usable source. */
export function usableCategories(options: CategoryOptions[]): CategoryOptions[] {
  return options.filter((c) => c.sources.some((s) => s.reasons.length === 0))
}

/** "Tue, 28 Oct 2026, 10:00 AM to 12:00 PM" (Lagos time). */
export function formatWindow(start: string, end: string): string {
  return `${formatDayDate(start)}, ${formatTime(start)} to ${formatTime(end)}`
}

/** Today's date in Africa/Lagos, `YYYY-MM-DD`. */
export function lagosToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** The current Lagos time, `HH:MM` (24-hour). */
export function lagosNowTime(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
}

/**
 * A Lagos date and time typed by the dispatcher as an aware timestamp.
 * Africa/Lagos is UTC+1 all year (no daylight saving).
 */
export function lagosIso(date: string, time: string): string {
  return `${date}T${time}:00+01:00`
}

export interface ConfirmForm {
  categoryId: string | null
  sourceId: string | null
  /** The window, Lagos time: `YYYY-MM-DD`, `HH:MM`, `HH:MM`. */
  date: string
  from: string
  to: string
  /** Manual price only: whole naira as typed. */
  total: string
  method: AgreementMethod
  agreedDate: string
  agreedTime: string
  /** The required tick box: the customer was told the five points (F5). */
  told: boolean
  note: string
}

export type ConfirmField = 'category' | 'source' | 'window' | 'price' | 'agreement' | 'note'

/**
 * Checks before sending, in the sheet's order, so the error summary lists
 * them top to bottom. The server checks everything again.
 */
export function formErrors(form: ConfirmForm, kind: ConfirmKind): Partial<Record<ConfirmField, string>> {
  const errors: Partial<Record<ConfirmField, string>> = {}
  if (kind === 'manual') {
    const kobo = nairaInputToKobo(form.total)
    if (kobo === null || kobo < 100) errors.price = 'Enter the total in whole naira, at least ₦1.'
  }
  if (!form.categoryId) errors.category = 'Choose a water category.'
  if (!form.sourceId) errors.source = 'Choose a water source.'
  if (!form.date || !form.from || !form.to) errors.window = 'Enter the date and both times of the delivery window.'
  else if (form.to <= form.from) errors.window = 'The delivery window must end after it starts.'
  if (!form.agreedDate || !form.agreedTime) errors.agreement = 'Enter when the customer agreed.'
  else if (!form.told) errors.agreement = 'Tick the box once you have told the customer.'
  if (form.note.length > 500) errors.note = 'Use 500 characters or fewer.'
  else if (form.method === 'other' && !form.note.trim()) errors.note = 'Add a note saying how the customer agreed.'
  return errors
}

/**
 * The confirm request for a checked form. A priced order sends no total: the
 * quote's total is confirmed (row 7 alone).
 */
export function buildConfirmRequest(form: ConfirmForm, kind: ConfirmKind): ConfirmRequest {
  const request: ConfirmRequest = {
    to: 'confirmed',
    expected_status: kind === 'server' ? 'awaiting_confirmation' : 'quote_requested',
    water_category_id: form.categoryId ?? '',
    source_id: form.sourceId ?? '',
    delivery_window: { start_at: lagosIso(form.date, form.from), end_at: lagosIso(form.date, form.to) },
    customer_agreement: { method: form.method, agreed_at: lagosIso(form.agreedDate, form.agreedTime), disclosures_confirmed: true },
    note: form.note.trim() || null,
  }
  if (kind === 'manual') request.manual_quote_total_minor_units = nairaInputToKobo(form.total) ?? 0
  return request
}

/**
 * The timeline line for a confirmation event (design Q5), or `null` for any
 * other event: "Awaiting confirmation" for a price request's manual price
 * (row 26), and "Confirmed" with category, source, window and price (row 7),
 * plus its note. A priced order has no row 26, so it shows "Confirmed" only.
 */
export function confirmationLine(event: AdminOrderEvent): { label: string; detail: string } | null {
  if (event.kind !== 'status_change') return null
  const by = event.actor?.name
  if (event.reason_code === 'manual_quote' && event.to_status === 'awaiting_confirmation') {
    return { label: 'Awaiting confirmation', detail: ['Manual price agreed with the customer', by].filter(Boolean).join(' · ') }
  }
  if (event.to_status === 'confirmed' && event.confirmation) {
    const c = event.confirmation
    const price = `${KIND_CHIP[c.manual ? 'manual' : 'server']} ${formatNaira(c.total_minor_units)}`
    const parts = [c.water_category_label, c.source_name, formatWindow(c.delivery_window.start_at, c.delivery_window.end_at), price, by, event.note]
    return { label: 'Confirmed', detail: parts.filter(Boolean).join(' · ') }
  }
  return null
}

/** What the sheet shows after a refused or failed confirm (design Q3). */
export interface ConfirmProblem {
  tone: 'note' | 'error'
  title: string
  lines: string[]
  /** What the sheet does: reload the sources, reload the order, reload the page, or let the dispatcher fix a field. */
  next: 'refresh_sources' | 'refresh_order' | 'reload' | 'retry' | 'fix'
  /** For `fix`: the sections the server named, with its messages. */
  fields?: Partial<Record<ConfirmField, string>>
}

const FIELD_BY_LOC: Record<string, ConfirmField> = {
  water_category_id: 'category',
  source_id: 'source',
  delivery_window: 'window',
  manual_quote_total_minor_units: 'price',
  customer_agreement: 'agreement',
  note: 'note',
}

/** The server's 422 messages by section (`details[].loc[1]`). */
function fieldErrors(error: ApiError): Partial<Record<ConfirmField, string>> {
  const out: Partial<Record<ConfirmField, string>> = {}
  if (!Array.isArray(error.details)) return out
  for (const d of error.details as { loc?: unknown[]; msg?: unknown }[]) {
    const field = typeof d.loc?.[1] === 'string' ? FIELD_BY_LOC[d.loc[1]] : undefined
    if (field && typeof d.msg === 'string' && !out[field]) out[field] = d.msg
  }
  return out
}

/** The designed message for an error from the confirm request, or `null` to show the server's message. */
export function confirmProblem(error: unknown): ConfirmProblem | null {
  if (!(error instanceof ApiError)) return null
  if (error.kind === 'network') {
    return { tone: 'error', title: "We couldn't reach Waterline.", lines: ["Check your connection and try again. Trying again won't confirm it twice."], next: 'retry' }
  }
  switch (error.code) {
    case 'transition_requirements_unmet': {
      const missing = missingRequirements(error)
      const lines = missing.map((m) => `${REQUIREMENT_LABEL[m]}.`)
      if (missing.includes('source_eligible')) lines.push('The source list has been refreshed and your choice cleared. Choose another source.')
      return { tone: 'note', title: 'This order cannot be confirmed yet.', lines, next: missing.includes('source_eligible') ? 'refresh_sources' : 'fix' }
    }
    case 'invalid_order_transition':
      return { tone: 'note', title: 'This order has changed.', lines: ['Another dispatcher confirmed it, or the customer cancelled it.'], next: 'refresh_order' }
    case 'csrf_failed':
      return { tone: 'error', title: 'Your session needs a refresh.', lines: ['Reload the page, then confirm again.'], next: 'reload' }
    case 'validation_error': {
      const fields = fieldErrors(error)
      return { tone: 'error', title: 'Check the highlighted sections.', lines: Object.values(fields), next: 'fix', fields }
    }
    default:
      return null
  }
}
