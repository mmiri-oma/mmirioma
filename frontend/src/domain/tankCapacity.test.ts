// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { resetMockDb } from '../mocks/db'
import { getPartnerProfile, listSignupAreas, partnerSignup } from '../mocks/partnerMock'
import { MAX_TANKER_GALLONS, MIN_TANKER_GALLONS, parseGallons, tankCapacityError } from './tankCapacity'

beforeEach(() => resetMockDb())

describe('parseGallons', () => {
  it('reads whole gallons with or without commas and spaces', () => {
    expect(parseGallons('4,000')).toBe(4000)
    expect(parseGallons(' 4000 ')).toBe(4000)
    expect(parseGallons('4 000')).toBe(4000)
  })

  it('refuses anything that is not a whole number', () => {
    expect(parseGallons('')).toBeNull()
    expect(parseGallons('4000.5')).toBeNull()
    expect(parseGallons('four thousand')).toBeNull()
    expect(parseGallons('-500')).toBeNull()
  })
})

describe('tankCapacityError', () => {
  it('accepts a tanker between the smallest order and the sanity limit', () => {
    expect(tankCapacityError(4000)).toBeNull()
    expect(tankCapacityError(MIN_TANKER_GALLONS)).toBeNull()
    expect(tankCapacityError(MAX_TANKER_GALLONS)).toBeNull()
    expect(tankCapacityError(null)).toMatch(/Enter how many gallons/)
    expect(tankCapacityError(MIN_TANKER_GALLONS - 1)).toMatch(/at least 500/)
    expect(tankCapacityError(MAX_TANKER_GALLONS + 1)).toMatch(/Check the number/)
  })
})

describe('tanker sign-up (mock)', () => {
  const base = { name: 'Ngozi Eze', password: 'long-enough', vehicle_type: 'tanker' as const, plate: 'ENU 900 XA' }
  const withArea = async () => ({ ...base, service_zone_id: (await listSignupAreas())[0].id })

  it('saves the typed capacity', async () => {
    await partnerSignup({ ...(await withArea()), phone: '0809 000 0201', tank_gallons: 4000 })
    const p = await getPartnerProfile()
    expect(p.vehicle.tank_gallons).toBe(4000)
    expect(p.vehicle.description).toBe('4,000 gal (16,000 L) tank')
  })

  it('rejects a capacity below the smallest order', async () => {
    await expect(partnerSignup({ ...(await withArea()), phone: '0809 000 0202', tank_gallons: 300 })).rejects.toMatchObject({ status: 422, code: 'validation_error' })
  })
})
