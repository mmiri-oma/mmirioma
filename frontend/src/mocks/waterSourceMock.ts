/**
 * Mock admin water-source endpoints (docs/api/admin-water-sources.md, #309,
 * with the #407 amendment).
 *
 * The same shapes and rules as the real endpoints, so the mock demo behaves
 * like the backend: a past `approved_until` is a 422, an unknown source,
 * category or activation is a 404 with the contract's code, a save that
 * changes nothing changes nothing, and the expiry state is worked out from
 * today's Lagos date with a 30-day warning window. From #407: activating a
 * source with no kind is a 409, a maximum below the minimum, an empty vehicle
 * list, a phone that is not a Nigerian mobile or a pickup point outside the
 * default delivery bounds is a 422, the cost can be changed on its own, and
 * `source_reasons` follows the kind and availability.
 *
 * The records live in this module and start again at each page load (or
 * `resetWaterSourceMock()` in tests). Every name, reference and amount is
 * SAMPLE DATA, and the screen tags it as such.
 */
import type {
  ActivationCostWrite,
  ActivationRead,
  ActivationStatusWrite,
  ActivationWrite,
  SourceLocation,
  SupplierFields,
  WaterCategoryRead,
  WaterSourceCreate,
  WaterSourceList,
  WaterSourceRead,
  WaterSourceUpdate,
} from '../lib/api/adminWaterSources'
import { VEHICLE_KINDS } from '../lib/api/adminWaterSources'
import { normalizeNigerianPhone } from '../lib/format/phone'
import { clone, delay, mockError, newId } from './store'

/** The backend's default `DELIVERY_LOCATION_BOUNDS` (south, west, north, east). */
const BOUNDS = { south: 5.9, west: 6.9, north: 7.2, east: 8.0 }

/** No contact, no limits, available, both vehicles: a new source's #407 fields. */
const DEFAULT_SUPPLIER: SupplierFields = {
  contact_name: null,
  contact_phone: null,
  min_litres_per_order: null,
  max_litres_per_order: null,
  is_available: true,
  vehicle_kinds: ['keke', 'tanker'],
}

const WARNING_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

export const POTABLE: WaterCategoryRead = { id: 'cat-potable', code: 'potable', label: 'Potable Water' }
export const UTILITY: WaterCategoryRead = { id: 'cat-utility', code: 'utility', label: 'Utility Water' }
const CATEGORIES = [POTABLE, UTILITY]

/** Today in Lagos as `YYYY-MM-DD`. Lagos is UTC+1 all year. */
function today(now = new Date()): string {
  return new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** A Lagos date `days` from today, as `YYYY-MM-DD`. */
function inDays(days: number, now = new Date()): string {
  return today(new Date(now.getTime() + days * DAY_MS))
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

function activation(
  category: WaterCategoryRead,
  status: ActivationRead['status'],
  approvedUntil: string,
  fields: Pick<ActivationRead, 'report_reference' | 'cost_per_litre_minor_units'> & { status_reason?: string },
  now = new Date(),
): ActivationRead {
  return {
    category,
    status,
    approved_until: approvedUntil,
    report_reference: fields.report_reference,
    cost_per_litre_minor_units: fields.cost_per_litre_minor_units,
    status_reason: status === 'activated' ? null : (fields.status_reason ?? 'Sample reason.'),
    expiry: expiryOf(approvedUntil, now),
    reasons: [],
  }
}

/** The server's expiry state for an approval date (30 days, inclusive of the last valid day). */
export function expiryOf(approvedUntil: string, now = new Date()): ActivationRead['expiry'] {
  const days = daysBetween(today(now), approvedUntil)
  if (days < 0) return { state: 'expired', days_left: days }
  return { state: days <= WARNING_DAYS ? 'expires_soon' : 'ok', days_left: days }
}

/** The eligibility reasons for an activation today (the order confirmation contract's order). */
function reasonsOf(a: Pick<ActivationRead, 'status' | 'approved_until'>, now = new Date()): ActivationRead['reasons'] {
  const reasons: ActivationRead['reasons'] = []
  if (a.status === 'suspended') reasons.push('suspended')
  if (a.status === 'revoked') reasons.push('revoked')
  if (a.approved_until < today(now)) reasons.push('approval_expired')
  return reasons
}

/** `kind_not_set` and `unavailable`, in that order (#407). */
function sourceReasonsOf(source: Pick<WaterSourceRead, 'kind' | 'is_available'>): WaterSourceRead['source_reasons'] {
  const reasons: WaterSourceRead['source_reasons'] = []
  if (source.kind === null) reasons.push('kind_not_set')
  if (!source.is_available) reasons.push('unavailable')
  return reasons
}

/**
 * Sample sources: one valid with every supplier detail, one tanker-only with
 * its approval expired and suspended, and one with no kind and no activation.
 */
export function seedWaterSources(now = new Date()): WaterSourceRead[] {
  const created_at = new Date(now.getTime() - 40 * DAY_MS).toISOString()
  const seed: Omit<WaterSourceRead, 'source_reasons'>[] = [
    {
      id: 'ws-sample-1',
      name: 'Sample Borehole A',
      approximate_location: 'Off Ogui Road, Enugu',
      kind: 'borehole',
      is_simulated: true,
      created_at,
      ...DEFAULT_SUPPLIER,
      location: { latitude: 6.4361, longitude: 7.5134 },
      contact_name: 'Sample Contact',
      contact_phone: '+2348000000001',
      min_litres_per_order: 600,
      max_litres_per_order: 10000,
      activations: [
        activation(POTABLE, 'activated', inDays(120, now), { report_reference: 'SAMPLE-LR-0001', cost_per_litre_minor_units: 150 }, now),
        activation(UTILITY, 'activated', inDays(19, now), { report_reference: 'SAMPLE-LR-0002', cost_per_litre_minor_units: 100 }, now),
      ],
    },
    {
      id: 'ws-sample-2',
      name: 'Sample Ninth Mile Supplier',
      approximate_location: 'Ninth Mile Corner, Enugu',
      kind: 'ninth_mile',
      is_simulated: true,
      created_at,
      ...DEFAULT_SUPPLIER,
      location: null,
      vehicle_kinds: ['tanker'],
      activations: [activation(UTILITY, 'suspended', inDays(-3, now), { report_reference: 'SAMPLE-LR-0003', cost_per_litre_minor_units: 200, status_reason: 'Sample: supplier reported a pump repair.' }, now)],
    },
    {
      id: 'ws-sample-3',
      name: 'Sample Borehole B',
      approximate_location: 'Near the Abakpa market gate',
      kind: null,
      is_simulated: true,
      created_at,
      ...DEFAULT_SUPPLIER,
      location: null,
      activations: [],
    },
  ]
  return seed.map((source) => ({
    ...source,
    source_reasons: sourceReasonsOf(source),
    activations: source.activations.map((a) => ({ ...a, reasons: reasonsOf(a, now) })),
  }))
}

let sources: WaterSourceRead[] = seedWaterSources()

/** Forget all changes and start again from the seed (tests). */
export function resetWaterSourceMock(now = new Date()): void {
  sources = seedWaterSources(now)
}

function find(id: string): WaterSourceRead {
  const source = sources.find((s) => s.id === id)
  if (!source) throw mockError(404, 'water_source_not_found', 'Water source not found')
  return source
}

function findCategory(id: string): WaterCategoryRead {
  const category = CATEGORIES.find((c) => c.id === id)
  if (!category) throw mockError(404, 'water_category_not_found', 'Water category not found')
  return category
}

/** A refreshed copy: expiry and reasons follow today's date, as the server works them out on every read. */
function view(source: WaterSourceRead): WaterSourceRead {
  const copy = clone(source)
  copy.activations = copy.activations.map((a) => ({ ...a, expiry: expiryOf(a.approved_until), reasons: reasonsOf(a) }))
  copy.source_reasons = sourceReasonsOf(copy)
  return copy
}

type Detail = { loc: (string | number)[]; msg: string; type: string }
const detail = (field: string, msg: string): Detail => ({ loc: ['body', field], msg, type: 'value_error' })

/**
 * The server's checks of the #407 fields and the pickup point, on the values
 * the source would have after the change. A 422 names each field.
 */
function checkSupplier(next: SupplierFields & { location: SourceLocation | null }): void {
  const details: Detail[] = []
  for (const field of ['min_litres_per_order', 'max_litres_per_order'] as const) {
    const value = next[field]
    if (value !== null && !(Number.isInteger(value) && value >= 1)) details.push(detail(field, 'Input should be greater than or equal to 1'))
  }
  if (
    details.length === 0 &&
    next.min_litres_per_order !== null &&
    next.max_litres_per_order !== null &&
    next.min_litres_per_order > next.max_litres_per_order
  ) {
    details.push(detail('max_litres_per_order', 'The largest order cannot be smaller than the smallest'))
  }
  if (next.vehicle_kinds.length === 0 || next.vehicle_kinds.some((kind) => !VEHICLE_KINDS.includes(kind))) {
    details.push(detail('vehicle_kinds', 'List at least one vehicle kind'))
  }
  if (next.location) {
    const { latitude, longitude } = next.location
    if (latitude < BOUNDS.south || latitude > BOUNDS.north || longitude < BOUNDS.west || longitude > BOUNDS.east) {
      details.push(detail('location', 'This location is outside the area we deliver in.'))
    }
  }
  if (details.length > 0) throw mockError(422, 'validation_error', 'Request validation failed', details)
}

/** A typed phone as the server stores it, or a 422. `null` stays `null`. */
function phoneOf(raw: string | null): string | null {
  if (raw === null) return null
  const phone = normalizeNigerianPhone(raw)
  if (!phone) throw mockError(422, 'validation_error', 'Request validation failed', [detail('contact_phone', 'Value error, not a Nigerian mobile number')])
  return phone
}

const ordered = (kinds: SupplierFields['vehicle_kinds']) => VEHICLE_KINDS.filter((kind) => kinds.includes(kind))

/** `GET /admin/water-sources`. */
export async function listWaterSources(): Promise<WaterSourceList> {
  await delay(undefined)
  return { items: [...sources].sort((a, b) => a.name.localeCompare(b.name)).map(view), categories: clone(CATEGORIES) }
}

/** `POST /admin/water-sources`. */
export async function createWaterSource(body: WaterSourceCreate): Promise<WaterSourceRead> {
  await delay(undefined)
  const supplier: SupplierFields = {
    contact_name: body.contact_name?.trim() || null,
    contact_phone: phoneOf(body.contact_phone ?? null),
    min_litres_per_order: body.min_litres_per_order ?? null,
    max_litres_per_order: body.max_litres_per_order ?? null,
    is_available: body.is_available ?? true,
    vehicle_kinds: ordered(body.vehicle_kinds ?? DEFAULT_SUPPLIER.vehicle_kinds),
  }
  const location = body.location ?? null
  checkSupplier({ ...supplier, location })
  const source: WaterSourceRead = {
    id: newId('ws'),
    name: body.name.trim(),
    approximate_location: body.approximate_location.trim(),
    kind: body.kind,
    is_simulated: true,
    created_at: new Date().toISOString(),
    activations: [],
    location,
    ...supplier,
    source_reasons: [],
  }
  sources.push(source)
  return view(source)
}

/** `PATCH /admin/water-sources/{id}`. */
export async function updateWaterSource(id: string, body: WaterSourceUpdate): Promise<WaterSourceRead> {
  await delay(undefined)
  const source = find(id)
  const next = {
    contact_name: body.contact_name === undefined ? source.contact_name : body.contact_name?.trim() || null,
    contact_phone: body.contact_phone === undefined ? source.contact_phone : phoneOf(body.contact_phone),
    min_litres_per_order: body.min_litres_per_order === undefined ? source.min_litres_per_order : body.min_litres_per_order,
    max_litres_per_order: body.max_litres_per_order === undefined ? source.max_litres_per_order : body.max_litres_per_order,
    is_available: body.is_available ?? source.is_available,
    vehicle_kinds: body.vehicle_kinds === undefined ? source.vehicle_kinds : ordered(body.vehicle_kinds),
    location: body.location === undefined ? source.location : body.location,
  }
  checkSupplier(next)
  if (body.name !== undefined) source.name = body.name.trim()
  if (body.approximate_location !== undefined) source.approximate_location = body.approximate_location.trim()
  if (body.kind !== undefined) source.kind = body.kind
  Object.assign(source, next)
  return view(source)
}

/** `PUT /admin/water-sources/{id}/activations/{category_id}`. */
export async function activateWaterSource(id: string, categoryId: string, body: ActivationWrite): Promise<WaterSourceRead> {
  await delay(undefined)
  const source = find(id)
  const category = findCategory(categoryId)
  if (body.approved_until < today()) {
    throw mockError(422, 'validation_error', 'approved_until must be today or later')
  }
  if (source.kind === null) {
    throw mockError(409, 'water_source_kind_required', 'Set where this source collects water before activating it.')
  }
  const next = activation(category, 'activated', body.approved_until, body)
  const index = source.activations.findIndex((a) => a.category.id === category.id)
  if (index === -1) source.activations.push(next)
  else source.activations[index] = next
  source.activations.sort((a, b) => a.category.label.localeCompare(b.category.label))
  return view(source)
}

/** `PATCH /admin/water-sources/{id}/activations/{category_id}` (#407): the cost only, in any status. */
export async function changeWaterSourceCost(id: string, categoryId: string, body: ActivationCostWrite): Promise<WaterSourceRead> {
  await delay(undefined)
  const source = find(id)
  const category = findCategory(categoryId)
  const current = source.activations.find((a) => a.category.id === category.id)
  if (!current) throw mockError(404, 'activation_not_found', 'This source has not been activated for this category')
  if (!Number.isInteger(body.cost_per_litre_minor_units) || body.cost_per_litre_minor_units < 0) {
    throw mockError(422, 'validation_error', 'Request validation failed', [detail('cost_per_litre_minor_units', 'Input should be greater than or equal to 0')])
  }
  current.cost_per_litre_minor_units = body.cost_per_litre_minor_units
  return view(source)
}

/** `POST /admin/water-sources/{id}/activations/{category_id}/status`. */
export async function setWaterSourceStatus(id: string, categoryId: string, body: ActivationStatusWrite): Promise<WaterSourceRead> {
  await delay(undefined)
  const source = find(id)
  const category = findCategory(categoryId)
  const current = source.activations.find((a) => a.category.id === category.id)
  if (!current) throw mockError(404, 'activation_not_found', 'This source has not been activated for this category')
  current.status = body.status
  current.status_reason = body.reason.trim()
  return view(source)
}
