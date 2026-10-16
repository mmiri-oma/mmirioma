import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api/client'
import {
  REQUEST_MESSAGES,
  emptyRequestValues,
  lagosToday,
  newIdempotencyKey,
  requestSchema,
  serverFieldErrors,
  toOrderCreate,
  type RequestFormValues,
} from './requestForm'

const TODAY = '2026-10-15'

const VALID: RequestFormValues = {
  quantityChoice: '200',
  otherLitres: '',
  contactName: 'Ada Sample',
  contactPhone: '0800 000 0001',
  deliveryAddress: '12 Sample Close, Independence Layout, Enugu',
  landmark: '',
  deliveryInstructions: '',
  preferredDate: '',
}

/** Field → first message, for a value that fails the schema. */
function errorsOf(values: RequestFormValues): Record<string, string> {
  const result = requestSchema(TODAY).safeParse(values)
  if (result.success) return {}
  return Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]))
}

describe('request form checks (docs/api/orders.md field rules)', () => {
  it('accepts a complete request', () => {
    expect(errorsOf(VALID)).toEqual({})
  })

  it('asks for a quantity when no tile is chosen', () => {
    expect(errorsOf({ ...VALID, quantityChoice: '' })).toEqual({
      quantityChoice: REQUEST_MESSAGES.chooseQuantity,
    })
  })

  it.each(['', '0', '100001', '12.5', '-3', 'ten'])(
    'rejects "%s" as an other amount',
    (litres) => {
      expect(errorsOf({ ...VALID, quantityChoice: 'other', otherLitres: litres })).toEqual({
        otherLitres: REQUEST_MESSAGES.litres,
      })
    },
  )

  it('accepts other amounts from 1 to 100,000 litres', () => {
    expect(errorsOf({ ...VALID, quantityChoice: 'other', otherLitres: '1' })).toEqual({})
    expect(errorsOf({ ...VALID, quantityChoice: 'other', otherLitres: ' 100000 ' })).toEqual({})
  })

  it('checks name, phone and address with the approved copy', () => {
    expect(
      errorsOf({ ...VALID, contactName: '   ', contactPhone: '0800 000 00', deliveryAddress: 'Enu' }),
    ).toEqual({
      contactName: REQUEST_MESSAGES.contactName,
      contactPhone: 'Enter a Nigerian mobile number, for example 08000000001',
      deliveryAddress: REQUEST_MESSAGES.deliveryAddress,
    })
  })

  it('limits landmark to 200 and instructions to 500 characters', () => {
    expect(
      errorsOf({ ...VALID, landmark: 'x'.repeat(201), deliveryInstructions: 'x'.repeat(501) }),
    ).toEqual({
      landmark: 'Use 200 characters or fewer.',
      deliveryInstructions: 'Use 500 characters or fewer.',
    })
    expect(errorsOf({ ...VALID, landmark: 'x'.repeat(200) })).toEqual({})
  })

  it('accepts today or later as the preferred date, never earlier', () => {
    expect(errorsOf({ ...VALID, preferredDate: TODAY })).toEqual({})
    expect(errorsOf({ ...VALID, preferredDate: '2026-12-01' })).toEqual({})
    expect(errorsOf({ ...VALID, preferredDate: '2026-10-14' })).toEqual({
      preferredDate: REQUEST_MESSAGES.preferredDate,
    })
  })
})

describe('lagosToday', () => {
  it('uses the Lagos calendar, one hour ahead of UTC', () => {
    expect(lagosToday(new Date('2026-10-15T22:59:00Z'))).toBe('2026-10-15')
    expect(lagosToday(new Date('2026-10-15T23:00:00Z'))).toBe('2026-10-16')
  })
})

describe('emptyRequestValues', () => {
  it('prefills the receiver from the account, phone in local form', () => {
    expect(emptyRequestValues({ name: 'Ada Sample', phone: '+2348000000001' })).toMatchObject({
      quantityChoice: '',
      contactName: 'Ada Sample',
      contactPhone: '0800 000 0001',
    })
  })
})

describe('toOrderCreate', () => {
  it('sends a preset quantity, trims text and leaves out empty optional fields', () => {
    expect(
      toOrderCreate(
        { ...VALID, contactName: '  Ada Sample ', landmark: '   ', deliveryAddress: ' 12 Sample Close ' },
        'key-1',
      ),
    ).toEqual({
      idempotency_key: 'key-1',
      quantity_litres: 200,
      contact_name: 'Ada Sample',
      contact_phone: '0800 000 0001',
      delivery_address: '12 Sample Close',
    })
  })

  it('sends the other amount and every optional field when given', () => {
    expect(
      toOrderCreate(
        {
          ...VALID,
          quantityChoice: 'other',
          otherLitres: '750',
          landmark: 'Opposite the blue gate',
          deliveryInstructions: 'Tank is behind the house',
          preferredDate: '2026-10-16',
        },
        'key-2',
      ),
    ).toMatchObject({
      quantity_litres: 750,
      landmark: 'Opposite the blue gate',
      delivery_instructions: 'Tank is behind the house',
      preferred_delivery_date: '2026-10-16',
    })
  })

  it('never sends a price or status field', () => {
    const body = toOrderCreate(VALID, 'key-3')
    expect(Object.keys(body).sort()).toEqual(
      ['contact_name', 'contact_phone', 'delivery_address', 'idempotency_key', 'quantity_litres'].sort(),
    )
  })
})

describe('serverFieldErrors (422 details[].loc)', () => {
  const validation = (details: unknown) =>
    new ApiError({ kind: 'http', status: 422, code: 'validation_error', message: 'Invalid', details })

  it('maps body fields to form fields with the approved messages', () => {
    const error = validation([
      { loc: ['body', 'contact_phone'], msg: 'bad', type: 'value_error' },
      { loc: ['body', 'preferred_delivery_date'], msg: 'past', type: 'value_error' },
      { loc: ['body', 'unknown_field'], msg: 'x', type: 'x' },
    ])
    expect(serverFieldErrors(error, '200')).toEqual({
      contactPhone: 'Enter a Nigerian mobile number, for example 08000000001',
      preferredDate: REQUEST_MESSAGES.preferredDate,
    })
  })

  it('puts a quantity error on the amount field or on the tiles', () => {
    const error = validation([{ loc: ['body', 'quantity_litres'], msg: 'x', type: 'x' }])
    expect(serverFieldErrors(error, 'other')).toEqual({ otherLitres: REQUEST_MESSAGES.litres })
    expect(serverFieldErrors(error, '200')).toEqual({
      quantityChoice: REQUEST_MESSAGES.chooseQuantity,
    })
  })

  it('returns nothing for details it cannot read', () => {
    expect(serverFieldErrors(validation(null), '200')).toEqual({})
    expect(serverFieldErrors(validation([null, { loc: 'body' }]), '200')).toEqual({})
  })
})

describe('newIdempotencyKey', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('makes a different UUID v4 each time', () => {
    const first = newIdempotencyKey()
    expect(first).toMatch(UUID_V4)
    expect(newIdempotencyKey()).not.toBe(first)
  })

  it('still makes a UUID v4 where randomUUID is missing (plain HTTP)', () => {
    const realCrypto = globalThis.crypto
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint8Array<ArrayBuffer>) => realCrypto.getRandomValues(array),
    })
    expect(newIdempotencyKey()).toMatch(UUID_V4)
  })
})
