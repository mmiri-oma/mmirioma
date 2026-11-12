import { describe, expect, it } from 'vitest'
import { ApiError } from '../../../lib/api/client'
import type { ActivationRead, WaterSourceRead } from '../../../lib/api/adminWaterSources'
import {
  EMPTY_SOURCE,
  activationDraft,
  activationErrors,
  contactLine,
  costTextToKobo,
  draftOf,
  expiryBadge,
  kindNotice,
  koboToCostText,
  orderSizeLine,
  pickupLine,
  reasonError,
  saveFailure,
  serverFieldErrors,
  sourceBody,
  sourceChanges,
  sourceErrors,
  vehiclesLine,
  type SourceDraft,
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

const draft = (over: Partial<SourceDraft> = {}): SourceDraft => ({ ...EMPTY_SOURCE, name: 'A', location: 'B', ...over })

const STORED: WaterSourceRead = {
  id: 'ws-1',
  name: 'Sample Borehole A',
  approximate_location: 'Off Ogui Road',
  kind: 'borehole',
  is_simulated: true,
  created_at: '2026-10-27T08:00:00Z',
  activations: [],
  location: null,
  contact_name: null,
  contact_phone: null,
  min_litres_per_order: null,
  max_litres_per_order: null,
  is_available: true,
  vehicle_kinds: ['keke', 'tanker'],
  source_reasons: [],
}

describe('the Add and Edit form', () => {
  it('asks for a name and a location, in the design’s words', () => {
    expect(sourceErrors(draft({ name: ' ', location: '' }))).toEqual({ name: 'Enter a name.', location: 'Enter a location.' })
    expect(sourceErrors(draft())).toEqual({})
  })

  it('refuses a name or location longer than the contract allows', () => {
    expect(sourceErrors(draft({ name: 'a'.repeat(121), location: 'b'.repeat(201) }))).toEqual({ name: 'Enter a name.', location: 'Enter a location.' })
  })

  it('checks the #407 fields in the design’s words', () => {
    expect(sourceErrors(draft({ contactPhone: '12345' })).contactPhone).toBe('Enter a Nigerian mobile number, for example 0803 000 0000.')
    expect(sourceErrors(draft({ latitude: '6.4' })).pickup).toBe('Enter both latitude and longitude, or neither.')
    expect(sourceErrors(draft({ latitude: 'north', longitude: '7.5' })).pickup).toBe('Enter both latitude and longitude, or neither.')
    expect(sourceErrors(draft({ minLitres: '0' })).minLitres).toBe('Enter a whole number of litres greater than zero.')
    expect(sourceErrors(draft({ maxLitres: '600.5' })).maxLitres).toBe('Enter a whole number of litres greater than zero.')
    expect(sourceErrors(draft({ minLitres: '1000', maxLitres: '999' })).maxLitres).toBe("The largest order can't be smaller than the smallest.")
    expect(sourceErrors(draft({ vehicles: [] })).vehicles).toBe('Choose at least one vehicle.')
  })

  it('accepts equal limits, an empty optional field and a full pickup point', () => {
    expect(sourceErrors(draft({ minLitres: '600', maxLitres: '600', latitude: '6.4361', longitude: '7.5134', contactPhone: '0803 000 0000' }))).toEqual({})
  })

  it('builds the add body with defaults, the phone as E.164 and Keke first', () => {
    expect(sourceBody(draft({ contactPhone: '0803 000 0000', vehicles: ['tanker', 'keke'], latitude: '6.4', longitude: '7.5', maxLitres: '2,000' }))).toEqual({
      name: 'A',
      approximate_location: 'B',
      kind: null,
      location: { latitude: 6.4, longitude: 7.5 },
      contact_name: null,
      contact_phone: '+2348030000000',
      min_litres_per_order: null,
      max_litres_per_order: 2000,
      is_available: true,
      vehicle_kinds: ['keke', 'tanker'],
    })
  })

  it('sends only the fields that differ, so a save that changes nothing sends nothing', () => {
    expect(sourceChanges(STORED, draftOf(STORED))).toEqual({})
    expect(sourceChanges(STORED, { ...draftOf(STORED), name: ' Sample Borehole B ' })).toEqual({ name: 'Sample Borehole B' })
    expect(sourceChanges(STORED, { ...draftOf(STORED), location: 'Near the market', kind: 'ninth_mile' })).toEqual({
      approximate_location: 'Near the market',
      kind: 'ninth_mile',
    })
  })

  it('does not treat "Not set yet" as a change: a kind cannot be cleared', () => {
    expect(sourceChanges(STORED, { ...draftOf(STORED), kind: '' })).toEqual({})
  })

  it('sends the #407 changes, and null when a field is emptied', () => {
    const full: WaterSourceRead = { ...STORED, contact_phone: '+2348030000000', max_litres_per_order: 5000, location: { latitude: 6.4, longitude: 7.5 } }
    expect(sourceChanges(full, draftOf(full))).toEqual({})
    expect(sourceChanges(full, { ...draftOf(full), contactPhone: '', maxLitres: '', latitude: '', longitude: '', available: false, vehicles: ['tanker'] })).toEqual({
      contact_phone: null,
      max_litres_per_order: null,
      location: null,
      is_available: false,
      vehicle_kinds: ['tanker'],
    })
  })
})

describe('the card facts (design amendment #407)', () => {
  it('words the contact, pickup point, order size and vehicles', () => {
    expect(contactLine({ contact_name: 'Sample Contact', contact_phone: '+2348030000000' })).toBe('Sample Contact · 0803 000 0000')
    expect(contactLine({ contact_name: null, contact_phone: null })).toBe('No contact')
    expect(pickupLine({ location: null })).toEqual({ text: 'No pickup point: road-distance pricing unavailable', set: false })
    expect(pickupLine({ location: { latitude: 6.4, longitude: 7.5 } }).text).toBe('Pickup point set')
    expect(orderSizeLine({ min_litres_per_order: 600, max_litres_per_order: 10000 })).toBe('600 to 10,000 litres per order')
    expect(orderSizeLine({ min_litres_per_order: 600, max_litres_per_order: null })).toBe('From 600 litres')
    expect(orderSizeLine({ min_litres_per_order: null, max_litres_per_order: 10000 })).toBe('Up to 10,000 litres')
    expect(orderSizeLine({ min_litres_per_order: null, max_litres_per_order: null })).toBe('Any order size')
    expect(vehiclesLine(['keke', 'tanker'])).toBe('Keke and Tanker')
    expect(vehiclesLine(['tanker'])).toBe('Tanker only')
  })

  it('counts the sources with no kind for the notice, and shows none when every source has one', () => {
    expect(kindNotice([{ source_reasons: [] }])).toBeNull()
    expect(kindNotice([{ source_reasons: ['kind_not_set'] }])).toBe("1 source has no kind set. It can't serve any order until you set one.")
    expect(kindNotice([{ source_reasons: ['kind_not_set', 'unavailable'] }, { source_reasons: ['kind_not_set'] }])).toBe(
      "2 sources have no kind set. They can't serve any order until you set one.",
    )
  })
})

describe('serverFieldErrors (a 422 shown under its field)', () => {
  const invalid = (loc: string[], msg: string) => new ApiError({ kind: 'http', status: 422, code: 'validation_error', message: 'x', details: [{ loc, msg, type: 'value_error' }] })

  it('shows the server’s bounds message under the pickup point', () => {
    expect(serverFieldErrors(invalid(['body', 'location'], 'This location is outside the area we deliver in.'))).toEqual({
      pickup: 'This location is outside the area we deliver in.',
    })
  })

  it('maps a stored-limit refusal to the maximum field', () => {
    expect(serverFieldErrors(invalid(['body', 'max_litres_per_order'], 'The largest order cannot be smaller than the smallest'))).toEqual({
      maxLitres: "The largest order can't be smaller than the smallest.",
    })
  })

  it('returns null for other failures', () => {
    expect(serverFieldErrors(invalid(['body', 'name'], 'x'))).toBeNull()
    expect(serverFieldErrors(new Error('boom'))).toBeNull()
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
    expect(saveFailure(http(404, code))).toEqual({ message: 'This source has changed or been removed.', refresh: true, editSource: false })
  })

  it('keeps the shared no-connection wording', () => {
    const error = new ApiError({ kind: 'network', status: 0, code: 'network_error', message: 'x' })
    expect(saveFailure(error).message).toMatch(/cannot reach MmiriOma/)
    expect(saveFailure(error).refresh).toBe(false)
  })

  it('says only "try again" for anything else, with no server text', () => {
    expect(saveFailure(http(422, 'validation_error'))).toEqual({ message: "We couldn't save this. Try again.", refresh: false, editSource: false })
    expect(saveFailure(new Error('boom'))).toEqual({ message: "We couldn't save this. Try again.", refresh: false, editSource: false })
  })

  it('offers Edit source on 409 water_source_kind_required (#407)', () => {
    expect(saveFailure(http(409, 'water_source_kind_required'))).toEqual({
      message: 'Set where this source collects water before activating it.',
      refresh: false,
      editSource: true,
    })
  })
})
