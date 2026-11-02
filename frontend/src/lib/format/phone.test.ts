import { describe, expect, it } from 'vitest'
import { formatPhone, normalizeNigerianPhone, phoneEnding } from './phone'

describe('normalizeNigerianPhone', () => {
  it('accepts the three documented input forms with spaces and dashes', () => {
    expect(normalizeNigerianPhone('0803 123 4567')).toBe('+2348031234567')
    expect(normalizeNigerianPhone('234-803-123-4567')).toBe('+2348031234567')
    expect(normalizeNigerianPhone('+2348031234567')).toBe('+2348031234567')
  })

  it('accepts the 10 digits typed after the +234 country picker', () => {
    expect(normalizeNigerianPhone('803 123 4567')).toBe('+2348031234567')
    expect(normalizeNigerianPhone('6031234567')).toBeNull() // must start 7, 8 or 9
  })

  it('rejects numbers that are not Nigerian mobiles', () => {
    expect(normalizeNigerianPhone('0603 123 4567')).toBeNull() // must start 7, 8 or 9
    expect(normalizeNigerianPhone('0803 123 456')).toBeNull() // too short
    expect(normalizeNigerianPhone('+447700900123')).toBeNull()
    expect(normalizeNigerianPhone('')).toBeNull()
  })
})

describe('formatPhone', () => {
  it('formats E.164 the way the design shows numbers', () => {
    expect(formatPhone('+2348031234567')).toBe('0803 123 4567')
    expect(formatPhone('not a phone')).toBe('not a phone')
    expect(phoneEnding('+2348031234567')).toBe('4567')
  })
})
