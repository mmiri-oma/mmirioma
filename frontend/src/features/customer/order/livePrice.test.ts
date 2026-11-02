import { describe, expect, it } from 'vitest'
import { ApiError } from '../../../lib/api/client'
import { isPriceExpired, noPriceMessage, priceProblem, waitMinutes } from './livePrice'

const apiError = (code: string, status: number, details: unknown = null) => new ApiError({ kind: 'http', status, code, message: 'from the server', details })

describe('noPriceMessage', () => {
  it('gives the approved message per reason (customer-live-prices.md, decision 1)', () => {
    expect(noPriceMessage('outside_service_zone')).toEqual({
      title: "We don't deliver to this area yet.",
      body: 'Send your request and our team will call you about it.',
    })
    expect(noPriceMessage('no_vehicle_plan').body).toBe("Send your request and we'll call you to plan it.")
  })

  it('falls back to the generic message for a reason this build does not know', () => {
    expect(noPriceMessage('something_new').title).toBe("We can't show a price for this order in the app.")
    expect(noPriceMessage('toString').title).toBe("We can't show a price for this order in the app.")
  })
})

describe('priceProblem', () => {
  it('fetches a new price after 409 quote_expired and 422 quote_mismatch', () => {
    expect(priceProblem(apiError('quote_expired', 409))).toMatchObject({ title: 'Your price has expired.', next: 'new_price' })
    expect(priceProblem(apiError('quote_mismatch', 422))).toMatchObject({ next: 'new_price' })
  })

  it('offers a request after 409 no_eligible_source and the area again after 404 service_zone_not_found', () => {
    expect(priceProblem(apiError('no_eligible_source', 409))?.next).toBe('send_request')
    expect(priceProblem(apiError('service_zone_not_found', 404))).toMatchObject({ tone: 'error', body: 'Choose your area again.', next: 'choose_area' })
  })

  it('waits the server\'s time after 429 too_many_attempts', () => {
    expect(priceProblem(apiError('too_many_attempts', 429, { retry_after_seconds: 240 }))).toMatchObject({
      body: 'Wait 4 minutes, then try again.',
      next: 'wait',
      wait_seconds: 240,
    })
  })

  it('never says "Nothing was ordered" after a lost connection: the retry is safe (FR-026)', () => {
    const problem = priceProblem(new ApiError({ kind: 'network', status: null, code: 'network_error', message: 'offline' }))
    expect(problem).toMatchObject({ title: "We couldn't reach Waterline.", next: 'retry' })
    expect(problem?.body).toContain("Trying again won't place a second order.")
    expect(problem?.body).not.toContain('Nothing was ordered')
  })

  it('leaves other errors (and phone_not_verified, which has its own banner) to the screen', () => {
    expect(priceProblem(apiError('phone_not_verified', 403))).toBeNull()
    expect(priceProblem(apiError('validation_error', 422))).toBeNull()
    expect(priceProblem(new Error('boom'))).toBeNull()
  })
})

describe('waitMinutes and isPriceExpired', () => {
  it('rounds the wait up to whole minutes, at least one', () => {
    expect(waitMinutes(5)).toBe('1 minute')
    expect(waitMinutes(61)).toBe('2 minutes')
  })

  it('treats a price as expired from its valid-until time', () => {
    const until = '2026-10-26T13:30:00Z'
    expect(isPriceExpired(until, Date.parse(until) - 1)).toBe(false)
    expect(isPriceExpired(until, Date.parse(until))).toBe(true)
  })
})
