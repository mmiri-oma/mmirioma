/**
 * Mock FR-022 price lists for the Pricing screen in `VITE_USE_MOCKS=true`
 * (#173), in the contract's shape (docs/api/admin-directory.md, "Price
 * lists"). It refuses what the backend refuses
 * (`backend/app/modules/pricing/price_lists.py`): a stale `base_version`
 * (409 `price_list_changed`), the same rules again (409
 * `price_list_unchanged`), overlapping bands for one area and water (422
 * `price_rules_overlap`) and bad fields (422 `validation_error`). All rules
 * and amounts are SAMPLES; the screen labels them so in mock mode.
 *
 * Separate from the mock-era `SamplePriceTable` in `pricing.ts`, which still
 * prices the mock's sample quotes.
 */
import type { PriceList, PriceListChange, PriceListDraft, PriceRule, WaterCategoryOption } from '../domain/admin'
import { ADMIN_NAME, DEMO_ADMIN_ID } from './adminSeed'
import { requireUserId } from './authMock'
import { mutate, read } from './db'
import type { MockState } from './seed'
import { clone, delay, mockError, newId } from './store'

/** The sample water categories (Utility on, Potable off until a lab-verified source, FR-014). */
export const MOCK_WATER_CATEGORIES: WaterCategoryOption[] = [
  { id: 'wc-potable', label: 'Potable Water', is_active: false },
  { id: 'wc-utility', label: 'Utility Water', is_active: true },
]

const RULE_FIELDS = [
  'zone_id',
  'water_category_id',
  'min_litres',
  'max_litres',
  'base_delivery_fee_minor_units',
  'distance_rate_minor_units_per_km',
  'additional_trip_minor_units',
  'handling_minor_units',
  'margin',
] as const satisfies readonly (keyof PriceRule)[]

function rule(over: Partial<PriceRule>): PriceRule {
  return {
    zone_id: null,
    water_category_id: null,
    min_litres: 600,
    max_litres: null,
    base_delivery_fee_minor_units: 0,
    distance_rate_minor_units_per_km: 0,
    additional_trip_minor_units: 0,
    handling_minor_units: 50_000,
    margin: { type: 'percentage', basis_points: 1000 },
    ...over,
  }
}

/** Two sample versions, so the history has a change to word. */
function seedPriceLists(): PriceList[] {
  const by = { id: DEMO_ADMIN_ID, name: ADMIN_NAME }
  const v1Rules = [rule({ handling_minor_units: 40_000 }), rule({ zone_id: 'ar-indep', water_category_id: 'wc-utility', min_litres: 4001, handling_minor_units: 80_000, margin: { type: 'fixed', amount_minor_units: 150_000 } })]
  const v2Rules = [rule({}), v1Rules[1]]
  const withIds = (rules: PriceRule[]) => rules.map((r, i) => ({ ...r, id: `pr-sample-${i + 1}` }))
  return [
    { version: 1, effective_from: '2026-10-14T09:30:00Z', created_by: by, reason: 'First price list (sample)', rules: withIds(v1Rules), changes: [] },
    { version: 2, effective_from: '2026-10-27T08:00:00Z', created_by: by, reason: 'Diesel price rise (sample)', rules: withIds(v2Rules), changes: changesBetween(v1Rules, v2Rules) },
  ]
}

function listsOf(s: MockState): PriceList[] {
  s.admin.price_lists ??= seedPriceLists()
  return s.admin.price_lists
}

function requireAdmin(s: MockState): { id: string; name: string } {
  const id = requireUserId()
  const user = s.users.find((u) => u.id === id)
  if (user?.role !== 'admin') throw mockError(403, 'forbidden', 'Only Waterline staff can do this')
  return { id, name: user.name }
}

/** A stored rule without its `id`, in the contract's field order, to compare with a draft's. */
function ruleFields(r: PriceRule): PriceRule {
  return Object.fromEntries(RULE_FIELDS.map((f) => [f, r[f]])) as unknown as PriceRule
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** `changes[]` as the backend words them: one per changed field; a whole rule when added or removed. */
function changesBetween(before: PriceRule[], after: PriceRule[]): PriceListChange[] {
  const changes: PriceListChange[] = []
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    const a = before[i]
    const b = after[i]
    if (!a) changes.push({ path: `rules[${i}]`, from: null, to: b })
    else if (!b) changes.push({ path: `rules[${i}]`, from: a, to: null })
    else for (const f of RULE_FIELDS) if (!same(a[f], b[f])) changes.push({ path: `rules[${i}].${f}`, from: a[f], to: b[f] })
  }
  return changes
}

function band(r: PriceRule): string {
  const n = (v: number) => v.toLocaleString('en-NG')
  return r.max_litres === null ? `${n(r.min_litres)} litres and up` : `${n(r.min_litres)} to ${n(r.max_litres)} litres`
}

function fieldError(index: number, field: string, msg: string): never {
  throw mockError(422, 'validation_error', 'Request validation failed', [{ loc: ['body', 'rules', index, field], msg, type: 'value_error' }])
}

function validate(s: MockState, rules: PriceRule[]): void {
  if (rules.length === 0) throw mockError(422, 'validation_error', 'Request validation failed', [{ loc: ['body', 'rules'], msg: 'Add at least one rule', type: 'value_error' }])
  rules.forEach((r, i) => {
    if (r.min_litres < 600) fieldError(i, 'min_litres', 'Must be at least 600 litres')
    if (r.max_litres !== null && r.max_litres < r.min_litres) fieldError(i, 'max_litres', 'Must be at least the From quantity')
    if (r.margin.type === 'percentage' && (r.margin.basis_points < 0 || r.margin.basis_points > 10_000)) fieldError(i, 'margin', 'Must be 0 to 100 %')
  })
  const details: unknown[] = []
  rules.forEach((later, li) => {
    for (let ei = 0; ei < li; ei++) {
      const earlier = rules[ei]
      const sameScope = earlier.zone_id === later.zone_id && earlier.water_category_id === later.water_category_id
      const apart =
        (earlier.max_litres !== null && earlier.max_litres < later.min_litres) || (later.max_litres !== null && later.max_litres < earlier.min_litres)
      if (sameScope && !apart) {
        details.push({ loc: ['body', 'rules', li], msg: `Overlaps rules[${ei}] (${band(earlier)})`, type: 'value_error' })
        break
      }
    }
  })
  if (details.length > 0) throw mockError(422, 'price_rules_overlap', 'Two rules for the same zone and category cover the same quantities', details)
  for (const r of rules) {
    if (r.zone_id !== null && !s.admin.areas.some((a) => a.id === r.zone_id)) throw mockError(404, 'service_zone_not_found', 'Service zone not found')
    if (r.water_category_id !== null && !MOCK_WATER_CATEGORIES.some((c) => c.id === r.water_category_id)) {
      throw mockError(404, 'water_category_not_found', 'Water category not found')
    }
  }
}

/** The current version; 404 `price_list_not_found` when none is saved. */
export async function getCurrentPriceList(): Promise<PriceList> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  const lists = s.admin.price_lists ?? seedPriceLists()
  const current = lists.at(-1)
  if (!current) throw mockError(404, 'price_list_not_found', 'No price list has been saved yet')
  return clone(current)
}

/** Saved versions, newest first. */
export async function listPriceLists(page: { limit?: number; offset?: number } = {}): Promise<{ items: PriceList[]; total: number; limit: number; offset: number }> {
  await delay(null)
  const s = read()
  requireAdmin(s)
  const all = [...(s.admin.price_lists ?? seedPriceLists())].reverse()
  const limit = page.limit ?? 20
  const offset = page.offset ?? 0
  return { items: clone(all.slice(offset, offset + limit)), total: all.length, limit, offset }
}

/** Save the whole set of rules as the next version. */
export async function createPriceList(draft: PriceListDraft): Promise<PriceList> {
  await delay(null, 300)
  return mutate((s) => {
    const actor = requireAdmin(s)
    const lists = listsOf(s)
    const current = lists.at(-1) ?? null
    if ((current?.version ?? null) !== draft.base_version) {
      throw mockError(409, 'price_list_changed', 'Prices changed since you opened this page', { current_version: current?.version ?? null })
    }
    validate(s, draft.rules)
    const before = current?.rules.map(ruleFields) ?? []
    if (current && same(before, draft.rules)) throw mockError(409, 'price_list_unchanged', 'The rules are the same as the current version')
    const next: PriceList = {
      version: (current?.version ?? 0) + 1,
      effective_from: new Date().toISOString(),
      created_by: { id: actor.id, name: actor.name },
      reason: draft.reason?.trim() || null,
      rules: draft.rules.map((r) => ({ ...clone(r), id: newId('pr') })),
      changes: current ? changesBetween(before, draft.rules) : [],
    }
    lists.push(next)
    return clone(next)
  })
}

/** Every sample water category, active or not, by label. */
export async function listWaterCategories(): Promise<WaterCategoryOption[]> {
  await delay(null)
  requireAdmin(read())
  return clone(MOCK_WATER_CATEGORIES)
}
