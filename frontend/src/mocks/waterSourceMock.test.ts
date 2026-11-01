import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '../lib/api/client'
import {
  UTILITY,
  POTABLE,
  activateWaterSource,
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

  it('answers 404 with the contract’s codes', async () => {
    const body = { approved_until: inDays(10), report_reference: 'R', cost_per_litre_minor_units: 0 }
    expect((await failure(updateWaterSource('nope', { name: 'X' }))).code).toBe('water_source_not_found')
    expect((await failure(activateWaterSource('ws-sample-1', 'nope', body))).code).toBe('water_category_not_found')
    expect((await failure(setWaterSourceStatus('ws-sample-3', POTABLE.id, { status: 'suspended', reason: 'x' }))).code).toBe('activation_not_found')
  })
})
