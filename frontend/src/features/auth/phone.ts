/**
 * Nigerian mobile numbers in the browser.
 *
 * The server is the authority (backend/app/shared/phone.py). This module only
 * repeats its format check so people see the error before anything is sent
 * (design: docs/design/authentication.md, "Phone format"), and formats stored
 * numbers for display.
 */

/** Separators people commonly type; the server ignores the same set. */
const SEPARATORS = /[\s\-().]/g
/** National significant number: 10 digits starting 7, 8 or 9. */
const NATIONAL_NUMBER = /^[789]\d{9}$/

/** Inline error shown when the format check fails (exact text, prompt 04). */
export const PHONE_FORMAT_MESSAGE =
  'Enter a Nigerian mobile number, for example 08000000001'

/**
 * Return the national significant number (10 digits) or null.
 *
 * Accepts `08000000001`, `2348000000001` and `+2348000000001`, with spaces,
 * dashes, dots and brackets, exactly like the server.
 */
function nationalNumber(raw: string): string | null {
  const digits = raw.replace(SEPARATORS, '')
  let national: string
  if (digits.startsWith('+234')) national = digits.slice(4)
  else if (digits.startsWith('234')) national = digits.slice(3)
  else if (digits.startsWith('0')) national = digits.slice(1)
  else national = digits
  return NATIONAL_NUMBER.test(national) ? national : null
}

/**
 * Check a typed phone number against the server's accepted formats.
 *
 * @param raw - The number as typed.
 * @returns True when the server would accept it.
 */
export function isNigerianMobile(raw: string): boolean {
  return nationalNumber(raw) !== null
}

/**
 * Format a phone number for display as `0800 000 0001` (design system,
 * "Formatting rules": 11 digits grouped 4, 3, 4).
 *
 * @param phone - A number in any accepted format, usually E.164 from the API.
 * @returns The grouped local form, or the input unchanged if it is not a
 *   Nigerian mobile number.
 */
export function formatPhoneForDisplay(phone: string): string {
  const national = nationalNumber(phone)
  if (national === null) return phone
  const local = `0${national}`
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`
}
