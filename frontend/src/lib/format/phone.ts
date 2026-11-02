/**
 * Nigerian mobile numbers, following docs/api/auth.md "Identifier and password
 * rules": inputs like `08031234567`, `2348031234567` or `+2348031234567`
 * (spaces and dashes ignored) are the same number, stored as `+234` plus 10
 * digits starting with 7, 8 or 9. The server normalizes too; the client
 * validates early, displays numbers the way people write them, and sends the
 * `+234` form, so it can also accept the bare 10 digits people type after the
 * "+234" country picker (`8031234567`).
 */

/** A country the phone field's picker offers. */
export interface PhoneCountry {
  /** ISO 3166-1 alpha-2 code, e.g. `NG`. */
  code: string
  name: string
  /** International dialling prefix, e.g. `+234`. */
  dial: string
}

/**
 * Countries in the phone field's picker. Nigeria only: accounts are verified
 * by SMS to a Nigerian mobile number (SRS FR-003), and the server rejects any
 * other number. Adding a country needs the backend, the SMS provider and a
 * normalizer for that country first; then list it here.
 */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = [{ code: 'NG', name: 'Nigeria', dial: '+234' }]

/**
 * Normalize a typed Nigerian mobile number to E.164.
 *
 * @returns `+234XXXXXXXXXX`, or `null` if it is not a Nigerian mobile number.
 */
export function normalizeNigerianPhone(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '')
  let national: string
  if (/^\d{10}$/.test(digits)) national = digits
  else if (/^0\d{10}$/.test(digits)) national = digits.slice(1)
  else if (/^234\d{10}$/.test(digits)) national = digits.slice(3)
  else if (/^\+234\d{10}$/.test(digits)) national = digits.slice(4)
  else return null
  return /^[789]\d{9}$/.test(national) ? `+234${national}` : null
}

/**
 * Show an E.164 Nigerian number as the design writes it: `0803 123 4567`.
 * Anything else is returned unchanged.
 */
export function formatPhone(e164: string): string {
  const m = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(e164)
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : e164
}

/** Last four digits, e.g. for "the code we sent to their phone ending 4567". */
export function phoneEnding(e164: string): string {
  return e164.slice(-4)
}
