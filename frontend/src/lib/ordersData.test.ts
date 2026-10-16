import { describe, expect, it } from 'vitest'
import { resolveOrdersDataSetting } from './ordersData'

describe('resolveOrdersDataSetting', () => {
  it('honours an explicit setting in any mode', () => {
    expect(resolveOrdersDataSetting('mock', 'production')).toBe('mock')
    expect(resolveOrdersDataSetting('api', 'test')).toBe('api')
  })

  it('reads the real API by default in development and production (S1-10)', () => {
    expect(resolveOrdersDataSetting(undefined, 'development')).toBe('api')
    expect(resolveOrdersDataSetting('', 'production')).toBe('api')
    expect(resolveOrdersDataSetting('something', 'production')).toBe('api')
  })

  it('uses mock data in the test suite so tests never call a server', () => {
    expect(resolveOrdersDataSetting(undefined, 'test')).toBe('mock')
  })
})
