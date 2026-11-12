import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '../lib/api/client'
import {
  UTILITY,
  POTABLE,
  activateWaterSource,
  changeWaterSourceCost,
  createWaterSource,
  expiryOf,
  listWaterSources,
  resetWaterSourceMock,
  setWaterSourceStatus,
  updateWaterSource,
} from './waterSourceMock'

const NOW = new Date('2026-11-01T10:00:00Z')

beforeEach(() => resetWaterSourceMock(NOW))

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }
  throw new Error('expected the call to fail')
}

/** A Lagos date `days` from today. */
const inDays = (days: number) => new Date(Date.now() + 60 * 60 * 1000 + days * 86_400_000).toISOString().slice(0, 10)

describe('the mock water-source endpoints behave like the real ones (docs/api/admin-water-sources.md)', () => {
  it('lists the sample sources by name with both categories, each activation with its expiry and reasons', async () => {
    const { items, categories } = await listWaterSources()
    expect(categories.map((c) => c.code)).toEqual(['potable', 'utility'])
    expect(items.map((s) => s.name)).toEqual(['Sample Borehole A', 'Sample Borehole B', 'Sample Ninth Mile Supplier'])
    const suspended = items[2].activations[0]
    expect(suspended.status).toBe('suspended')
    expect(suspended.reasons).toEqual(['suspended', 'approval_expired'])
    expect(items[1].activations).toEqual([])
  })

  it.each([
    [-1, 'expired'],
    [0, 'expires_soon'],
    [30, 'expires_soon'],
    [31, 'ok'],
  ])('works out the expiry for a date %d days away as %s', (days, state) => {
    const date = new Date(NOW.getTime() + days * 86_400_000 + 60 * 60 * 1000).toISOString().slice(0, 10)
    expect(expiryOf(date, NOW)).toEqual({ state, days_left: days })
  })

  it('adds a source with no activations and trims its text', async () => {
    const added = await createWaterSource({ name: '  New  ', approximate_location: ' Here ', kind: null })
    expect(added).toMatchObject({ name: 'New', approximate_location: 'Here', kind: null, activations: [] })
    expect((await listWaterSources()).items.map((s) => s.name)).toContain('New')
  })

  it('edits only the fields it is given', async () => {
    const updated = await updateWaterSource('ws-sample-1', { kind: 'ninth_mile' })
    expect(updated).toMatchObject({ name: 'Sample Borehole A', kind: 'ninth_mile' })
  })

  it('activates a never-activated category, and renewing reinstates a suspended one with its reason cleared', async () => {
    await updateWaterSource('ws-sample-3', { kind: 'borehole' })
    const first = await activateWaterSource('ws-sample-3', UTILITY.id, { approved_until: inDays(90), report_reference: 'R-1', cost_per_litre_minor_units: 150 })
    expect(first.activations).toHaveLength(1)
    expect(first.activations[0]).toMatchObject({ status: 'activated', status_reason: null, reasons: [], cost_per_litre_minor_units: 150 })
    const renewed = await activateWaterSource('ws-sample-2', UTILITY.id, { approved_until: inDays(60), report_reference: 'R-2', cost_per_litre_minor_units: 175 })
    expect(renewed.activations[0]).toMatchObject({ status: 'activated', status_reason: null, report_reference: 'R-2' })
  })

  it('refuses a past approved_until with 422, and stores nothing', async () => {
    const error = await failure(activateWaterSource('ws-sample-3', UTILITY.id, { approved_until: inDays(-1), report_reference: 'R', cost_per_litre_minor_units: 0 }))
    expect([error.status, error.code]).toEqual([422, 'validation_error'])
    expect((await listWaterSources()).items.find((s) => s.id === 'ws-sample-3')!.activations).toEqual([])
  })

  it('suspends and revokes with a reason, and a revoked activation may move to suspended', async () => {
    const revoked = await setWaterSourceStatus('ws-sample-1', UTILITY.id, { status: 'revoked', reason: 'Withdrawn.' })
    expect(revoked.activations.find((a) => a.category.id === UTILITY.id)).toMatchObject({ status: 'revoked', status_reason: 'Withdrawn.', reasons: ['revoked'] })
    const moved = await setWaterSourceStatus('ws-sample-1', UTILITY.id, { status: 'suspended', reason: 'Under review.' })
    expect(moved.activations.find((a) => a.category.id === UTILITY.id)!.status).toBe('suspended')
  })

  it('starts with a source that has no kind, reported in source_reasons (#407)', async () => {
    const { items } = await listWaterSources()
    expect(items.map((s) => s.source_reasons)).toEqual([[], ['kind_not_set'], []])
    expect(items[0]).toMatchObject({ contact_name: 'Sample Contact', min_litres_per_order: 600, max_litres_per_order: 10000, vehicle_kinds: ['keke', 'tanker'] })
  })

  it('refuses to activate a source with no kind with 409, and stores nothing (#407)', async () => {
    const error = await failure(activateWaterSource('ws-sample-3', UTILITY.id, { approved_until: inDays(10), report_reference: 'R', cost_per_litre_minor_units: 0 }))
    expect([error.status, error.code]).toEqual([409, 'water_source_kind_required'])
    expect((await listWaterSources()).items.find((s) => s.id === 'ws-sample-3')!.activations).toEqual([])
  })

  it('adds a source with supplier details, the phone as E.164 and the vehicles Keke first (#407)', async () => {
    const added = await createWaterSource({
      name: 'New',
      approximate_location: 'Here',
      kind: 'borehole',
      contact_phone: '0800 000 0001',
      vehicle_kinds: ['tanker', 'keke'],
      location: { latitude: 6.44, longitude: 7.5 },
    })
    expect(added).toMatchObject({ contact_phone: '+2348000000001', vehicle_kinds: ['keke', 'tanker'], is_available: true, location: { latitude: 6.44, longitude: 7.5 } })
  })

  it.each([
    ['a maximum below the minimum', { min_litres_per_order: 1000, max_litres_per_order: 999 }, 'max_litres_per_order'],
    ['no vehicle', { vehicle_kinds: [] }, 'vehicle_kinds'],
    ['a phone that is not a Nigerian mobile', { contact_phone: '+442071234567' }, 'contact_phone'],
    ['a point outside the delivery bounds', { location: { latitude: 51.5, longitude: -0.1 } }, 'location'],
  ])('refuses %s with 422 naming the field (#407)', async (_, change, field) => {
    const error = await failure(createWaterSource({ name: 'N', approximate_location: 'L', kind: null, ...change }))
    expect([error.status, error.code]).toEqual([422, 'validation_error'])
    expect((error.details as { loc: string[] }[])[0].loc).toEqual(['body', field])
  })

  it('checks an edit against the stored limit, marks a source unavailable and clears the contact (#407)', async () => {
    const error = await failure(updateWaterSource('ws-sample-1', { max_litres_per_order: 500 }))
    expect((error.details as { loc: string[] }[])[0].loc).toEqual(['body', 'max_litres_per_order'])
    const edited = await updateWaterSource('ws-sample-1', { is_available: false, contact_phone: null })
    expect(edited).toMatchObject({ is_available: false, contact_phone: null, source_reasons: ['unavailable'] })
  })

  it('changes only the cost, and keeps a suspension (#407)', async () => {
    const changed = await changeWaterSourceCost('ws-sample-2', UTILITY.id, { cost_per_litre_minor_units: 180 })
    expect(changed.activations[0]).toMatchObject({ cost_per_litre_minor_units: 180, status: 'suspended', report_reference: 'SAMPLE-LR-0003' })
    expect((await failure(changeWaterSourceCost('ws-sample-3', UTILITY.id, { cost_per_litre_minor_units: 1 }))).code).toBe('activation_not_found')
    expect((await failure(changeWaterSourceCost('ws-sample-1', UTILITY.id, { cost_per_litre_minor_units: -1 }))).code).toBe('validation_error')
  })

  it('answers 404 with the contract’s codes', async () => {
    const body = { approved_until: inDays(10), report_reference: 'R', cost_per_litre_minor_units: 0 }
    expect((await failure(updateWaterSource('nope', { name: 'X' }))).code).toBe('water_source_not_found')
    expect((await failure(activateWaterSource('ws-sample-1', 'nope', body))).code).toBe('water_category_not_found')
    expect((await failure(setWaterSourceStatus('ws-sample-3', POTABLE.id, { status: 'suspended', reason: 'x' }))).code).toBe('activation_not_found')
  })
})
