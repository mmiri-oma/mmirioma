/**
 * Display formatting. The API sends UTC timestamps and Africa/Lagos calendar
 * dates (docs/api/README.md "Formats"); the UI always shows Lagos time
 * (SRS §2.1) in the design system's style (design-system.md "Formatting
 * rules"): `Fri 16 Oct 2026`, `9:00 am`, `1,000 litres`.
 */

export const LAGOS_TIME_ZONE = 'Africa/Lagos'

const lagosDateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: LAGOS_TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

// en-CA formats as YYYY-MM-DD, matching the API's calendar-date format.
const isoDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: LAGOS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

// Calendar dates carry no time zone, so they are formatted as UTC to stop the
// viewer's own offset from shifting the day.
const calendarDateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const numberFormat = new Intl.NumberFormat('en-NG')

type Parts = Partial<Record<Intl.DateTimeFormatPartTypes, string>>

function partsOf(format: Intl.DateTimeFormat, date: Date): Parts {
  return Object.fromEntries(format.formatToParts(date).map((part) => [part.type, part.value]))
}

/**
 * Format a UTC ISO timestamp in Lagos time, e.g. `Wed 14 Oct 2026, 10:30 am`.
 * Built from parts so the result does not depend on the browser's punctuation.
 *
 * @param isoTimestamp - ISO 8601 timestamp from the API.
 */
export function formatLagosDateTime(isoTimestamp: string): string {
  const p = partsOf(lagosDateTimeFormat, new Date(isoTimestamp))
  // Some engines report midnight as hour 0 under hour12; the rule is 12-hour.
  const hour = p.hour === '0' ? '12' : p.hour
  return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${hour}:${p.minute} ${p.dayPeriod?.toLowerCase()}`
}

/**
 * Return the Africa/Lagos calendar date (`YYYY-MM-DD`) of a UTC timestamp.
 *
 * @param isoTimestamp - ISO 8601 timestamp from the API.
 */
export function toLagosDate(isoTimestamp: string): string {
  return isoDateFormat.format(new Date(isoTimestamp))
}

/**
 * Format an API calendar date, e.g. `2026-10-16` as `Fri 16 Oct 2026`.
 *
 * @param calendarDate - Date in `YYYY-MM-DD` form.
 */
export function formatCalendarDate(calendarDate: string): string {
  const [year, month, day] = calendarDate.split('-').map(Number)
  const p = partsOf(calendarDateFormat, new Date(Date.UTC(year, month - 1, day)))
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`
}

/**
 * Format whole litres with thousands separators, e.g. `1,000 litres`.
 *
 * @param litres - Integer litres.
 */
export function formatLitres(litres: number): string {
  return `${numberFormat.format(litres)} litres`
}
