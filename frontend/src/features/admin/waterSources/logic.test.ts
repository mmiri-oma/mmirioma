import { describe, expect, it } from 'vitest'
import { ApiError } from '../../../lib/api/client'
import type { ActivationRead } from '../../../lib/api/adminWaterSources'
import {
  activationDraft,
  activationErrors,
  costTextToKobo,
  expiryBadge,
  koboToCostText,
  reasonError,
  saveFailure,
  sourceChanges,
  sourceErrors,
} from './logic'

const TODAY = '2026-11-01'

function activation(over: Partial<ActivationRead> = {}): ActivationRead {
  return {
    category: { id: 'c1', code: 'utility', label: 'Utility Water' },
    status: 'activated',
    approved_until: '2026-12-01',
    report_reference: 'SAMPLE-LR-0001',
    cost_per_litre_minor_units: 150,
    status_reason: null,
    expiry: { state: 'ok', days_left: 30 },
    reasons: [],
    ...over,
  }
}

describe('expiryBadge (the server fixes the 30-day window; the words are the design’s)', () => {
  it.each([
    [{ state: 'expired', days_left: -1 }, 'Expired', 'red'],
    [{ state: 'expires_soon', days_left: 0 }, 'Expires today', 'amber'],
    [{ state: 'expires_soon', days_left: 1 }, 'Expires in 1 day', 'amber'],
    [{ state: 'expires_soon', days_left: 19 }, 'Expires in 19 days', 'amber'],
    [{ state: 'expires_soon', days_left: 30 }, 'Expires in 30 days', 'amber'],
  ] as const)('reads %j as "%s"', (expiry, text, tone) => {
    expect(expiryBadge(activation({ expiry }))).toEqual({ text, tone })
  })

  it('shows nothing beyond the window', () => {
    expect(expiryBadge(activation({ expiry: { state: 'ok', days_left: 31 } }))).toBeNull()
  })

  it.each(['suspended', 'revoked'] as const)('shows no badge on a %s row, which shows its status first', (status) => {
    expect(expiryBadge(activation({ status, expiry: { state: 'expired', days_left: -5 } }))).toBeNull()
  })
})

describe('costTextToKobo (naira with up to two decimals, never rounded)', () => {
  it.each([
    ['1.50', 150],
    ['2', 200],
    ['0', 0],
    ['0.5', 50],
    ['0.05', 5],
    ['1,200.5', 120050],
    [' 3.00 ', 300],
  ])('reads %j as %d kobo', (text, kobo) => {
    expect(costTextToKobo(text)).toBe(kobo)
  })

  it.each(['', '.', '1.505', '-1', '1e3', 'abc', '1.', '.5', '1,5,0.0.0'])('refuses %j', (text) => {
    expect(costTextToKobo(text)).toBeNull()
  })

  it('refuses an amount too large to hold exactly', () => {
    expect(costTextToKobo('9'.repeat(20))).toBeNull()
  })

  it('writes kobo back as the text the field is filled with', () => {
    expect(koboToCostText(150)).toBe('1.50')
    expect(koboToCostText(200)).toBe('2.00')
    expect(koboToCostText(5)).toBe('0.05')
    expect(costTextToKobo(koboToCostText(123456))).toBe(123456)
  })
})

describe('the Add and Edit form', () => {
  it('asks for a name and a location, in the design’s words', () => {
    expect(sourceErrors({ name: ' ', location: '', kind: '' })).toEqual({ name: 'Enter a name.', location: 'Enter a location.' })
    expect(sourceErrors({ name: 'A', location: 'B', kind: '' })).toEqual({})
  })

  it('refuses a name or location longer than the contract allows', () => {
    expect(sourceErrors({ name: 'a'.repeat(121), location: 'b'.repeat(201), kind: '' })).toEqual({ name: 'Enter a name.', location: 'Enter a location.' })
  })

  const stored = { name: 'Sample Borehole A', approximate_location: 'Off Ogui Road', kind: 'borehole' as const }

  it('sends only the fields that differ, so a save that changes nothing sends nothing', () => {
    expect(sourceChanges(stored, { name: 'Sample Borehole A', location: 'Off Ogui Road', kind: 'borehole' })).toEqual({})
    expect(sourceChanges(stored, { name: ' Sample Borehole B ', location: 'Off Ogui Road', kind: 'borehole' })).toEqual({ name: 'Sample Borehole B' })
    expect(sourceChanges(stored, { name: 'Sample Borehole A', location: 'Near the market', kind: 'ninth_mile' })).toEqual({
      approximate_location: 'Near the market',
      kind: 'ninth_mile',
    })
  })

  it('does not treat "Not set yet" as a change: a kind cannot be cleared', () => {
    expect(sourceChanges(stored, { name: 'Sample Borehole A', location: 'Off Ogui Road', kind: '' })).toEqual({})
  })
})

describe('the Activate and Renew form', () => {
  it('starts empty the first time', () => {
    expect(activationDraft(null, TODAY)).toEqual({ report: '', until: '', cost: '' })
  })

  it('fills in the current values when renewing, with the cost as naira text', () => {
    expect(activationDraft(activation(), TODAY)).toEqual({ report: 'SAMPLE-LR-0001', until: '2026-12-01', cost: '1.50' })
  })

  it('leaves the date empty when the approval already passed, since a past date is refused', () => {
    expect(activationDraft(activation({ approved_until: '2026-10-30' }), TODAY).until).toBe('')
    expect(activationDraft(activation({ approved_until: TODAY }), TODAY).until).toBe(TODAY)
  })

  it('names each broken field in the design’s words', () => {
    expect(activationErrors({ report: ' ', until: '', cost: '' }, TODAY)).toEqual({
      report: 'Enter the report reference.',
      until: 'Choose a date from today.',
      cost: 'Enter the cost as naira, for example 1.50.',
    })
  })

  it('accepts today and refuses yesterday, as the server does', () => {
    const base = { report: 'R', cost: '1.50' }
    expect(activationErrors({ ...base, until: TODAY }, TODAY)).toEqual({})
    expect(activationErrors({ ...base, until: '2026-10-31' }, TODAY)).toEqual({ until: 'Choose a date from today.' })
  })

  it('refuses a cost with a third decimal instead of rounding it', () => {
    expect(activationErrors({ report: 'R', until: TODAY, cost: '1.505' }, TODAY).cost).toBeDefined()
  })
})

describe('reasonError', () => {
  it('needs a reason of up to 500 characters', () => {
    expect(reasonError('  ')).toBe('Say why.')
    expect(reasonError('a'.repeat(501))).toBe('Say why.')
    expect(reasonError('Pump repair.')).toBeUndefined()
  })
})

describe('saveFailure (what a dialog says when a save fails)', () => {
  const http = (status: number, code: string) => new ApiError({ kind: 'http', status, code, message: 'No' })

  it.each(['water_source_not_found', 'water_category_not_found', 'activation_not_found'])('offers Refresh on %s', (code) => {
    expect(saveFailure(http(404, code))).toEqual({ message: 'This source has changed or been removed.', refresh: true })
  })

  it('keeps the shared no-connection wording', () => {
    const error = new ApiError({ kind: 'network', status: 0, code: 'network_error', message: 'x' })
    expect(saveFailure(error).message).toMatch(/cannot reach MmiriOma/)
    expect(saveFailure(error).refresh).toBe(false)
  })

  it('says only "try again" for anything else, with no server text', () => {
    expect(saveFailure(http(422, 'validation_error'))).toEqual({ message: "We couldn't save this. Try again.", refresh: false })
    expect(saveFailure(new Error('boom'))).toEqual({ message: "We couldn't save this. Try again.", refresh: false })
  })
})
