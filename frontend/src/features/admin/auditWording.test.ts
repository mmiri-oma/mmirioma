import { describe, expect, it } from 'vitest'
import { AUDIT_REASON_ACTIONS, AUDIT_TARGET_WORDS, auditTarget, SHORT_ID_LENGTH } from './auditWording'

describe('auditTarget (#293)', () => {
  it('names the kind in words and the first six characters of the id', () => {
    expect(auditTarget('driver', '4f3a2c9e-1111-4222-8333-444455556666')).toBe('Driver · 4f3a2c')
    expect(auditTarget('service_zone', 'abcdef123456')).toBe('Service area · abcdef')
  })

  it('has words for every kind of record the backend writes, and none for a kind it does not know', () => {
    for (const kind of ['driver', 'order', 'service_zone', 'price_list', 'cash_collection', 'cash_remittance', 'water_source', 'support_request', 'customer_address', 'user', 'deletion_request', 'retention_review']) {
      expect(AUDIT_TARGET_WORDS[kind]).toBeTruthy()
    }
    expect(auditTarget('brand_new_kind', '123456789')).toBe('brand_new_kind · 123456')
  })

  it('does not treat an object property name as a kind it knows', () => {
    expect(auditTarget('constructor', 'abcdef123')).toBe('constructor · abcdef')
  })

  it('keeps a short id short, and shows a short one whole', () => {
    expect(auditTarget('order', 'a'.repeat(40))).toBe(`Order · ${'a'.repeat(SHORT_ID_LENGTH)}`)
    expect(auditTarget('order', 'ab12')).toBe('Order · ab12')
  })

  it('shows what it has when one part is missing, and nothing when both are', () => {
    expect(auditTarget('', 'abcdef123')).toBe('abcdef')
    expect(auditTarget('driver', '')).toBe('Driver')
    expect(auditTarget('', '')).toBeNull()
  })
})

describe('the audit reasons that show (#293)', () => {
  it('are the four driver decisions, and no other action', () => {
    expect([...AUDIT_REASON_ACTIONS].sort()).toEqual(['driver_activated', 'driver_approved', 'driver_deactivated', 'driver_suspended'])
  })
})
