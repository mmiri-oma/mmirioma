/**
 * Display formatting. The API sends UTC timestamps and Africa/Lagos calendar
 * dates (docs/api/README.md "Formats"); the UI always shows Lagos time
 * (SRS §2.1).
 */

export const LAGOS_TIME_ZONE = 'Africa/Lagos'

const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: LAGOS_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
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

/**
 * Format a UTC ISO timestamp in Lagos time, e.g. `14 Oct 2026, 10:30`.
 *
 * @param isoTimestamp - ISO 8601 timestamp from the API.
 */
export function formatLagosDateTime(isoTimestamp: string): string {
  return dateTimeFormat.format(new Date(isoTimestamp))
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
 * Format an API calendar date, e.g. `2026-10-16` as `Fri, 16 Oct 2026`.
 *
 * @param calendarDate - Date in `YYYY-MM-DD` form.
 */
export function formatCalendarDate(calendarDate: string): string {
  const [year, month, day] = calendarDate.split('-').map(Number)
  return calendarDateFormat.format(new Date(Date.UTC(year, month - 1, day)))
}

/**
 * Format whole litres with thousands separators, e.g. `1,000 L`.
 *
 * @param litres - Integer litres.
 */
export function formatLitres(litres: number): string {
  return `${numberFormat.format(litres)} L`
}
