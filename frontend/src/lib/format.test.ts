import { describe, expect, it } from 'vitest'
import { formatCalendarDate, formatLagosDateTime, formatLitres, toLagosDate } from './format'

describe('format', () => {
  it('shows UTC timestamps in Lagos time (UTC+1) on a 12-hour clock', () => {
    expect(formatLagosDateTime('2026-10-14T09:30:00Z')).toBe('Wed 14 Oct 2026, 10:30 am')
    expect(formatLagosDateTime('2026-10-14T13:30:00Z')).toBe('Wed 14 Oct 2026, 2:30 pm')
  })

  it('shows Lagos midnight and noon as 12', () => {
    expect(formatLagosDateTime('2026-10-14T23:05:00Z')).toBe('Thu 15 Oct 2026, 12:05 am')
    expect(formatLagosDateTime('2026-10-14T11:00:00Z')).toBe('Wed 14 Oct 2026, 12:00 pm')
  })

  it('moves late-evening UTC timestamps to the next Lagos day', () => {
    expect(toLagosDate('2026-10-14T23:30:00Z')).toBe('2026-10-15')
    expect(toLagosDate('2026-10-14T22:59:00Z')).toBe('2026-10-14')
  })

  it('formats calendar dates without shifting the day', () => {
    expect(formatCalendarDate('2026-10-16')).toBe('Fri 16 Oct 2026')
  })

  it('formats litres with separators', () => {
    expect(formatLitres(3000)).toBe('3,000 litres')
    expect(formatLitres(25)).toBe('25 litres')
  })
})
