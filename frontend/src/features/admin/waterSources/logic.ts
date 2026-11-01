/**
 * The rules and words of the admin Water sources screen
 * (docs/design/admin-water-sources.md, docs/api/admin-water-sources.md, #309).
 * Kept apart from the components so each rule is tested without rendering.
 */
import type { ChipTone } from '../../../components/ui/Chip'
import type { ActivationRead, WaterSourceKind } from '../../../lib/api/adminWaterSources'
import { ApiError } from '../../../lib/api/client'
import { errorMessage } from '../../../lib/api/errorMessage'
import { lagosToday } from '../confirm/logic'

/** Field limits from the contract (`water_sources` and `water_source_categories`). */
export const NAME_MAX = 120
export const LOCATION_MAX = 200
export const REPORT_MAX = 100
export const REASON_MAX = 500

export const KIND_LABEL: Record<WaterSourceKind, string> = { borehole: 'Borehole', ninth_mile: 'Ninth Mile' }
export const STATUS_LABEL: Record<ActivationRead['status'], string> = { activated: 'Activated', suspended: 'Suspended', revoked: 'Revoked' }
export const STATUS_TONE: Record<ActivationRead['status'], ChipTone> = { activated: 'green', suspended: 'amber', revoked: 'red' }

/** The line that keeps the screen from reading as the approval itself (decision 2 on #309; FR-012). */
export const NOT_VERIFIED_LINE = 'MmiriOma records the report reference. The app does not check the laboratory report.'

/** What the screen says after a change (docs/design/admin-water-sources.md, "Dialogs"). */
export const TOAST = {
  added: 'Source added. Activate it for a category before it can serve an order.',
  updated: 'Source updated.',
  activated: (category: string) => `Activated for ${category}.`,
  renewed: (category: string) => `Renewed for ${category}.`,
  suspended: (category: string) => `Suspended for ${category}.`,
  revoked: (category: string) => `Revoked for ${category}.`,
} as const

/**
 * The expiry badge of an Activated row, or `null` when there is nothing to warn about.
 *
 * Only an Activated row warns: a Suspended or Revoked row shows its status first.
 * `expires_soon` covers 0 to 30 days (the server fixes the window), and the
 * last valid day reads "Expires today" because `approved_until` is inclusive.
 *
 * @param activation - The activation as the server sent it.
 * @returns The words and the tone, or `null` for no badge.
 */
export function expiryBadge(activation: Pick<ActivationRead, 'status' | 'expiry'>): { text: string; tone: ChipTone } | null {
  if (activation.status !== 'activated') return null
  const { state, days_left } = activation.expiry
  if (state === 'expired') return { text: 'Expired', tone: 'red' }
  if (state !== 'expires_soon') return null
  if (days_left === 0) return { text: 'Expires today', tone: 'amber' }
  return { text: days_left === 1 ? 'Expires in 1 day' : `Expires in ${days_left} days`, tone: 'amber' }
}

/** Digits, then an optional point and one or two decimals. */
const COST_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/

/**
 * Naira typed with up to two decimals, as whole kobo.
 *
 * Commas are allowed as thousands separators. A third decimal is refused
 * rather than rounded: the supplier's cost is never changed silently. The
 * conversion works on the digits, not on a float.
 *
 * @param text - What was typed, e.g. "1.50", "2", "1,200.5".
 * @returns Kobo, or `null` when the text is not an amount with at most two decimals.
 */
export function costTextToKobo(text: string): number | null {
  const match = COST_PATTERN.exec(text.trim().replace(/,/g, ''))
  if (!match) return null
  const kobo = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return Number.isSafeInteger(kobo) ? kobo : null
}

/** Kobo as the naira text the cost field is filled with: 150 gives "1.50", 200 gives "2.00". */
export function koboToCostText(kobo: number): string {
  const whole = Math.trunc(kobo / 100)
  return `${whole}.${String(kobo % 100).padStart(2, '0')}`
}

/** The fields of the Add and Edit dialogs. */
export interface SourceDraft {
  name: string
  location: string
  /** `''` is "Not set yet". */
  kind: WaterSourceKind | ''
}

export type SourceErrors = Partial<Record<keyof SourceDraft, string>>

export const EMPTY_SOURCE: SourceDraft = { name: '', location: '', kind: '' }

/** The messages the design gives each field (docs/design/admin-water-sources.md, "States"). */
export function sourceErrors(draft: SourceDraft): SourceErrors {
  const errors: SourceErrors = {}
  if (draft.name.trim() === '' || draft.name.trim().length > NAME_MAX) errors.name = 'Enter a name.'
  if (draft.location.trim() === '' || draft.location.trim().length > LOCATION_MAX) errors.location = 'Enter a location.'
  return errors
}

/**
 * What an edit changes: only the fields that differ from the stored source, so
 * the server writes nothing when nothing changed. A kind cannot be cleared, so
 * "Not set yet" on a source that has a kind is not a change.
 *
 * @returns The fields to send; an empty object when nothing differs.
 */
export function sourceChanges(
  current: { name: string; approximate_location: string; kind: WaterSourceKind | null },
  draft: SourceDraft,
): { name?: string; approximate_location?: string; kind?: WaterSourceKind } {
  const changes: { name?: string; approximate_location?: string; kind?: WaterSourceKind } = {}
  if (draft.name.trim() !== current.name) changes.name = draft.name.trim()
  if (draft.location.trim() !== current.approximate_location) changes.approximate_location = draft.location.trim()
  if (draft.kind !== '' && draft.kind !== current.kind) changes.kind = draft.kind
  return changes
}

/** The fields of the Activate and Renew dialog. */
export interface ActivationDraft {
  report: string
  until: string
  cost: string
}

export type ActivationErrors = Partial<Record<keyof ActivationDraft, string>>

/**
 * A fresh activation form, or the current values when renewing. The date
 * starts empty on a renewal of an expired approval, since a past date is refused.
 */
export function activationDraft(current: ActivationRead | null, today: string = lagosToday()): ActivationDraft {
  if (!current) return { report: '', until: '', cost: '' }
  return {
    report: current.report_reference,
    until: current.approved_until >= today ? current.approved_until : '',
    cost: koboToCostText(current.cost_per_litre_minor_units),
  }
}

/** The messages the design gives each field; a date before today in Lagos is refused as the server does. */
export function activationErrors(draft: ActivationDraft, today: string = lagosToday()): ActivationErrors {
  const errors: ActivationErrors = {}
  if (draft.report.trim() === '' || draft.report.trim().length > REPORT_MAX) errors.report = 'Enter the report reference.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.until) || draft.until < today) errors.until = 'Choose a date from today.'
  if (costTextToKobo(draft.cost) === null) errors.cost = 'Enter the cost as naira, for example 1.50.'
  return errors
}

/** The reason of a Suspend or Revoke: required, up to 500 characters. */
export function reasonError(reason: string): string | undefined {
  return reason.trim() === '' || reason.trim().length > REASON_MAX ? 'Say why.' : undefined
}

/** The server codes that mean the source or its activation is no longer what the screen showed. */
const GONE_CODES: ReadonlySet<string> = new Set(['water_source_not_found', 'water_category_not_found', 'activation_not_found'])

/**
 * What a dialog says when a save fails, and whether it offers Refresh
 * (docs/design/admin-water-sources.md, "States"). A 404 means the list is out
 * of date; no connection keeps the shared wording; anything else is a plain
 * "try again" that keeps what was typed.
 *
 * @param error - What the mutation rejected with.
 * @returns The message and whether to offer Refresh.
 */
export function saveFailure(error: unknown): { message: string; refresh: boolean } {
  if (error instanceof ApiError) {
    if (error.kind === 'network') return { message: errorMessage(error), refresh: false }
    if (GONE_CODES.has(error.code)) return { message: 'This source has changed or been removed.', refresh: true }
  }
  return { message: "We couldn't save this. Try again.", refresh: false }
}
