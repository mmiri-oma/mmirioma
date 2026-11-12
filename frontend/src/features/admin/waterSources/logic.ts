/**
 * The rules and words of the admin Water sources screen
 * (docs/design/admin-water-sources.md, docs/api/admin-water-sources.md, #309,
 * with the #407 amendment: supplier details, order fit and the cost-only change).
 * Kept apart from the components so each rule is tested without rendering.
 */
import type { ChipTone } from '../../../components/ui/Chip'
import type {
  ActivationRead,
  SourceLocation,
  SupplierFields,
  VehicleKind,
  WaterSourceKind,
  WaterSourceRead,
  WaterSourceUpdate,
} from '../../../lib/api/adminWaterSources'
import { VEHICLE_KINDS } from '../../../lib/api/adminWaterSources'
import { ApiError } from '../../../lib/api/client'
import { errorMessage } from '../../../lib/api/errorMessage'
import { formatPhone, normalizeNigerianPhone } from '../../../lib/format/phone'
import { lagosToday } from '../confirm/logic'

/** Field limits from the contract (`water_sources` and `water_source_categories`). */
export const NAME_MAX = 120
export const LOCATION_MAX = 200
export const REPORT_MAX = 100
export const REASON_MAX = 500
export const CONTACT_NAME_MAX = 120
/** `water_sources.min_litres_per_order` and `max_litres_per_order` are INTEGER columns. */
export const LITRES_MAX = 2 ** 31 - 1

export const KIND_LABEL: Record<WaterSourceKind, string> = { borehole: 'Borehole', ninth_mile: 'Ninth Mile' }
export const STATUS_LABEL: Record<ActivationRead['status'], string> = { activated: 'Activated', suspended: 'Suspended', revoked: 'Revoked' }
export const STATUS_TONE: Record<ActivationRead['status'], ChipTone> = { activated: 'green', suspended: 'amber', revoked: 'red' }
export const VEHICLE_LABEL: Record<VehicleKind, string> = { keke: 'Keke', tanker: 'Tanker' }

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
  costChanged: (category: string) => `Cost updated for ${category}.`,
} as const

/** Under the Change cost field (design amendment #407): the cost is read by new quotes only (FR-024, T-09). */
export const COST_CHANGE_LINE = 'New quotes use this cost. Quotes and orders already made keep their price.'

/** Under the Available switch (design amendment #407). */
export const AVAILABLE_HINT = 'Turn this off when the source is closed or out of water. It is not a safety status: use Suspend for that.'

/** Under Activate and Renew on a source with no kind (decision 407-2). */
export const SET_KIND_FIRST = 'Set the kind first.'

const LITRES = new Intl.NumberFormat('en-GB')

/** "Sample Contact · 0800 000 0001", or "No contact" when both are empty. */
export function contactLine(source: Pick<WaterSourceRead, 'contact_name' | 'contact_phone'>): string {
  const parts = [source.contact_name, source.contact_phone && formatPhone(source.contact_phone)].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'No contact'
}

/**
 * Whether the card says a pickup point is set. Without one the delivery cannot
 * be priced by road distance; nothing more is promised, since the zone may
 * also lack a fee and need a manual quote (design amendment #407, reviewer's correction).
 */
export function pickupLine(source: Pick<WaterSourceRead, 'location'>): { text: string; set: boolean } {
  return source.location ? { text: 'Pickup point set', set: true } : { text: 'No pickup point: road-distance pricing unavailable', set: false }
}

/** "600 to 10,000 litres per order", "From 600 litres", "Up to 10,000 litres" or "Any order size". */
export function orderSizeLine(source: Pick<WaterSourceRead, 'min_litres_per_order' | 'max_litres_per_order'>): string {
  const { min_litres_per_order: min, max_litres_per_order: max } = source
  if (min !== null && max !== null) return `${LITRES.format(min)} to ${LITRES.format(max)} litres per order`
  if (min !== null) return `From ${LITRES.format(min)} litres`
  if (max !== null) return `Up to ${LITRES.format(max)} litres`
  return 'Any order size'
}

/** "Keke and Tanker", "Keke only" or "Tanker only". */
export function vehiclesLine(kinds: readonly VehicleKind[]): string {
  if (kinds.length === VEHICLE_KINDS.length) return 'Keke and Tanker'
  return kinds.length === 1 ? `${VEHICLE_LABEL[kinds[0]]} only` : 'No vehicle'
}

/**
 * The amber notice above the cards, or `null` when every source has a kind
 * (design amendment #407). It counts sources; the amber chips show which.
 */
export function kindNotice(sources: readonly Pick<WaterSourceRead, 'source_reasons'>[]): string | null {
  const count = sources.filter((s) => s.source_reasons.includes('kind_not_set')).length
  if (count === 0) return null
  return count === 1
    ? "1 source has no kind set. It can't serve any order until you set one."
    : `${count} sources have no kind set. They can't serve any order until you set one.`
}

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

/** The fields of the Add and Edit dialogs, as typed. */
export interface SourceDraft {
  name: string
  /** The place in words (`approximate_location`). */
  location: string
  /** `''` is "Not set yet". */
  kind: WaterSourceKind | ''
  contactName: string
  contactPhone: string
  /** The pickup point, both or neither (#385). */
  latitude: string
  longitude: string
  minLitres: string
  maxLitres: string
  available: boolean
  vehicles: VehicleKind[]
}

export type SourceErrors = Partial<Record<'name' | 'location' | 'contactPhone' | 'pickup' | 'minLitres' | 'maxLitres' | 'vehicles', string>>

export const EMPTY_SOURCE: SourceDraft = {
  name: '',
  location: '',
  kind: '',
  contactName: '',
  contactPhone: '',
  latitude: '',
  longitude: '',
  minLitres: '',
  maxLitres: '',
  available: true,
  vehicles: ['keke', 'tanker'],
}

/** The Edit dialog starts from the stored source. */
export function draftOf(source: WaterSourceRead): SourceDraft {
  return {
    name: source.name,
    location: source.approximate_location,
    kind: source.kind ?? '',
    contactName: source.contact_name ?? '',
    contactPhone: source.contact_phone ? formatPhone(source.contact_phone) : '',
    latitude: source.location ? String(source.location.latitude) : '',
    longitude: source.location ? String(source.location.longitude) : '',
    minLitres: source.min_litres_per_order === null ? '' : String(source.min_litres_per_order),
    maxLitres: source.max_litres_per_order === null ? '' : String(source.max_litres_per_order),
    available: source.is_available,
    vehicles: [...source.vehicle_kinds],
  }
}

/** Whole litres of at least 1, `null` for an empty field, `undefined` when it is not a whole number. */
function litresOf(text: string): number | null | undefined {
  const trimmed = text.trim().replace(/,/g, '')
  if (trimmed === '') return null
  if (!/^\d+$/.test(trimmed)) return undefined
  const value = Number(trimmed)
  return value >= 1 && value <= LITRES_MAX ? value : undefined
}

/** A degree value, or `undefined` when the text is not a finite number. */
function degreesOf(text: string): number | undefined {
  const trimmed = text.trim()
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return undefined
  return Number(trimmed)
}

const MESSAGE = {
  phone: 'Enter a Nigerian mobile number, for example 0803 000 0000.',
  pickupHalf: 'Enter both latitude and longitude, or neither.',
  litres: 'Enter a whole number of litres greater than zero.',
  maxBelowMin: "The largest order can't be smaller than the smallest.",
  vehicles: 'Choose at least one vehicle.',
} as const

/**
 * The messages the design gives each field (docs/design/admin-water-sources.md,
 * "States" and amendment #407). The server checks the same rules again; the
 * delivery bounds of a pickup point are checked only there, and its message is
 * shown under the field ({@link serverFieldErrors}).
 */
export function sourceErrors(draft: SourceDraft): SourceErrors {
  const errors: SourceErrors = {}
  if (draft.name.trim() === '' || draft.name.trim().length > NAME_MAX) errors.name = 'Enter a name.'
  if (draft.location.trim() === '' || draft.location.trim().length > LOCATION_MAX) errors.location = 'Enter a location.'
  if (draft.contactPhone.trim() !== '' && normalizeNigerianPhone(draft.contactPhone) === null) errors.contactPhone = MESSAGE.phone
  const lat = draft.latitude.trim()
  const lng = draft.longitude.trim()
  if ((lat === '') !== (lng === '')) errors.pickup = MESSAGE.pickupHalf
  else if (lat !== '' && (degreesOf(lat) === undefined || degreesOf(lng) === undefined)) errors.pickup = MESSAGE.pickupHalf
  const min = litresOf(draft.minLitres)
  const max = litresOf(draft.maxLitres)
  if (min === undefined) errors.minLitres = MESSAGE.litres
  if (max === undefined) errors.maxLitres = MESSAGE.litres
  else if (typeof min === 'number' && typeof max === 'number' && min > max) errors.maxLitres = MESSAGE.maxBelowMin
  if (draft.vehicles.length === 0) errors.vehicles = MESSAGE.vehicles
  return errors
}

/** The pickup point a valid draft describes, or `null` for none. */
function pickupOf(draft: SourceDraft): SourceLocation | null {
  const latitude = degreesOf(draft.latitude)
  const longitude = degreesOf(draft.longitude)
  return latitude === undefined || longitude === undefined ? null : { latitude, longitude }
}

/** The #407 fields of a valid draft, as the request sends them. */
function supplierOf(draft: SourceDraft): SupplierFields {
  return {
    contact_name: draft.contactName.trim() || null,
    contact_phone: draft.contactPhone.trim() === '' ? null : normalizeNigerianPhone(draft.contactPhone),
    min_litres_per_order: litresOf(draft.minLitres) ?? null,
    max_litres_per_order: litresOf(draft.maxLitres) ?? null,
    is_available: draft.available,
    vehicle_kinds: VEHICLE_KINDS.filter((kind) => draft.vehicles.includes(kind)),
  }
}

/** The body of `POST /admin/water-sources` for a valid draft. */
export function sourceBody(draft: SourceDraft) {
  return {
    name: draft.name.trim(),
    approximate_location: draft.location.trim(),
    kind: draft.kind === '' ? null : draft.kind,
    location: pickupOf(draft),
    ...supplierOf(draft),
  }
}

const sameLocation = (a: SourceLocation | null, b: SourceLocation | null) =>
  a === b || (a !== null && b !== null && a.latitude === b.latitude && a.longitude === b.longitude)

/**
 * What an edit changes: only the fields that differ from the stored source, so
 * the server writes nothing when nothing changed. A kind cannot be cleared, so
 * "Not set yet" on a source that has a kind is not a change. Emptying the
 * contact, a litre limit or the pickup point sends `null`, which clears it.
 *
 * @returns The fields to send; an empty object when nothing differs.
 */
export function sourceChanges(current: WaterSourceRead, draft: SourceDraft): WaterSourceUpdate {
  const changes: WaterSourceUpdate = {}
  if (draft.name.trim() !== current.name) changes.name = draft.name.trim()
  if (draft.location.trim() !== current.approximate_location) changes.approximate_location = draft.location.trim()
  if (draft.kind !== '' && draft.kind !== current.kind) changes.kind = draft.kind
  const pickup = pickupOf(draft)
  if (!sameLocation(pickup, current.location)) changes.location = pickup
  const supplier = supplierOf(draft)
  if (supplier.contact_name !== current.contact_name) changes.contact_name = supplier.contact_name
  if (supplier.contact_phone !== current.contact_phone) changes.contact_phone = supplier.contact_phone
  if (supplier.min_litres_per_order !== current.min_litres_per_order) changes.min_litres_per_order = supplier.min_litres_per_order
  if (supplier.max_litres_per_order !== current.max_litres_per_order) changes.max_litres_per_order = supplier.max_litres_per_order
  if (supplier.is_available !== current.is_available) changes.is_available = supplier.is_available
  if (supplier.vehicle_kinds.join() !== current.vehicle_kinds.join()) changes.vehicle_kinds = supplier.vehicle_kinds
  return changes
}

/** Which dialog field a server 422 `loc` belongs to. */
const SERVER_FIELD: Partial<Record<string, keyof SourceErrors>> = {
  location: 'pickup',
  contact_phone: 'contactPhone',
  min_litres_per_order: 'minLitres',
  max_litres_per_order: 'maxLitres',
  vehicle_kinds: 'vehicles',
}

/**
 * The field errors of a server 422, under the field they name. The pickup
 * point shows the server's own bounds message (a sanity box, not a
 * service-area decision); the others use the design's words.
 *
 * @returns The errors, or `null` when the failure is not a 422 naming one of these fields.
 */
export function serverFieldErrors(error: unknown): SourceErrors | null {
  if (!(error instanceof ApiError) || error.code !== 'validation_error' || !Array.isArray(error.details)) return null
  const errors: SourceErrors = {}
  for (const item of error.details as { loc?: unknown[]; msg?: unknown }[]) {
    const field = SERVER_FIELD[String(item.loc?.[1] ?? '')]
    if (!field) continue
    if (field === 'pickup') errors.pickup = typeof item.msg === 'string' ? item.msg : MESSAGE.pickupHalf
    else if (field === 'contactPhone') errors.contactPhone = MESSAGE.phone
    else if (field === 'maxLitres') errors.maxLitres = MESSAGE.maxBelowMin
    else if (field === 'minLitres') errors.minLitres = MESSAGE.litres
    else errors.vehicles = MESSAGE.vehicles
  }
  return Object.keys(errors).length > 0 ? errors : null
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
export function saveFailure(error: unknown): { message: string; refresh: boolean; editSource: boolean } {
  if (error instanceof ApiError) {
    if (error.kind === 'network') return { message: errorMessage(error), refresh: false, editSource: false }
    if (GONE_CODES.has(error.code)) return { message: 'This source has changed or been removed.', refresh: true, editSource: false }
    // #407: another admin may have cleared the kind meanwhile, or the dialog opened before it was known.
    if (error.code === 'water_source_kind_required') {
      return { message: 'Set where this source collects water before activating it.', refresh: false, editSource: true }
    }
  }
  return { message: "We couldn't save this. Try again.", refresh: false, editSource: false }
}
