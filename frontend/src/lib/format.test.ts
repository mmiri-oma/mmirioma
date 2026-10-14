import { describe, expect, it } from 'vitest'
import { formatCalendarDate, formatLagosDateTime, formatLitres, toLagosDate } from './format'

describe('format', () => {
  it('shows UTC timestamps in Lagos time (UTC+1)', () => {
    expect(formatLagosDateTime('2026-10-14T09:30:00Z')).toBe('14 Oct 2026, 10:30')
  })

  it('moves late-evening UTC timestamps to the next Lagos day', () => {
    expect(toLagosDate('2026-10-14T23:30:00Z')).toBe('2026-10-15')
    expect(toLagosDate('2026-10-14T22:59:00Z')).toBe('2026-10-14')
  })

  it('formats calendar dates without shifting the day', () => {
    expect(formatCalendarDate('2026-10-16')).toBe('Fri, 16 Oct 2026')
  })

  it('formats litres with separators', () => {
    expect(formatLitres(3000)).toBe('3,000 L')
    expect(formatLitres(25)).toBe('25 L')
  })
})
