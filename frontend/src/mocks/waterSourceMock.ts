/**
 * Mock admin water-source endpoints (docs/api/admin-water-sources.md, #309).
 *
 * The same shapes and rules as the real endpoints, so the mock demo behaves
 * like the backend: a past `approved_until` is a 422, an unknown source,
 * category or activation is a 404 with the contract's code, a save that
 * changes nothing changes nothing, and the expiry state is worked out from
 * today's Lagos date with a 30-day warning window.
 *
 * The records live in this module and start again at each page load (or
 * `resetWaterSourceMock()` in tests). Every name, reference and amount is
 * SAMPLE DATA, and the screen tags it as such.
 */
import type {
  ActivationRead,
  ActivationStatusWrite,
  ActivationWrite,
  WaterCategoryRead,
  WaterSourceCreate,
  WaterSourceList,
  WaterSourceRead,
  WaterSourceUpdate,
} from '../lib/api/adminWaterSources'
import { clone, delay, mockError, newId } from './store'

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

/** Sample sources: one valid, one close to expiry, one expired and suspended, one never activated. */
export function seedWaterSources(now = new Date()): WaterSourceRead[] {
  const created_at = new Date(now.getTime() - 40 * DAY_MS).toISOString()
  const seed: WaterSourceRead[] = [
    {
      id: 'ws-sample-1',
      name: 'Sample Borehole A',
      approximate_location: 'Off Ogui Road, Enugu',
      kind: 'borehole',
      is_simulated: true,
      created_at,
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
      activations: [activation(UTILITY, 'suspended', inDays(-3, now), { report_reference: 'SAMPLE-LR-0003', cost_per_litre_minor_units: 200, status_reason: 'Sample: supplier reported a pump repair.' }, now)],
    },
    {
      id: 'ws-sample-3',
      name: 'Sample Borehole B',
      approximate_location: 'Near the Abakpa market gate',
      kind: null,
      is_simulated: true,
      created_at,
      activations: [],
    },
  ]
  return seed.map((source) => ({ ...source, activations: source.activations.map((a) => ({ ...a, reasons: reasonsOf(a, now) })) }))
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
  return copy
}

/** `GET /admin/water-sources`. */
export async function listWaterSources(): Promise<WaterSourceList> {
  await delay(undefined)
  return { items: [...sources].sort((a, b) => a.name.localeCompare(b.name)).map(view), categories: clone(CATEGORIES) }
}

/** `POST /admin/water-sources`. */
export async function createWaterSource(body: WaterSourceCreate): Promise<WaterSourceRead> {
  await delay(undefined)
  const source: WaterSourceRead = {
    id: newId('ws'),
    name: body.name.trim(),
    approximate_location: body.approximate_location.trim(),
    kind: body.kind,
    is_simulated: true,
    created_at: new Date().toISOString(),
    activations: [],
  }
  sources.push(source)
  return view(source)
}

/** `PATCH /admin/water-sources/{id}`. */
export async function updateWaterSource(id: string, body: WaterSourceUpdate): Promise<WaterSourceRead> {
  await delay(undefined)
  const source = find(id)
  if (body.name !== undefined) source.name = body.name.trim()
  if (body.approximate_location !== undefined) source.approximate_location = body.approximate_location.trim()
  if (body.kind !== undefined) source.kind = body.kind
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
  const next = activation(category, 'activated', body.approved_until, body)
  const index = source.activations.findIndex((a) => a.category.id === category.id)
  if (index === -1) source.activations.push(next)
  else source.activations[index] = next
  source.activations.sort((a, b) => a.category.label.localeCompare(b.category.label))
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
