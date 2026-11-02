/**
 * Form helpers shared by React Hook Form + Zod screens.
 */
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { z } from 'zod'
import { ApiError } from './api/client'
import { normalizeNigerianPhone } from './format/phone'

/** Message the auth design uses for a bad phone number (docs/api/auth.md). */
export const PHONE_MESSAGE = 'Enter a Nigerian mobile number, for example 0803 123 4567.'

/**
 * A Nigerian mobile number in any accepted input form, including the bare 10
 * digits typed after the "+234" country picker. The submitted value is the
 * `+234` (E.164) form, which the server accepts (docs/api/auth.md).
 */
export const phoneField = z
  .string()
  .trim()
  .min(1, 'Enter your phone number.')
  .refine((v) => normalizeNigerianPhone(v) !== null, PHONE_MESSAGE)
  .transform((v) => normalizeNigerianPhone(v) ?? v)

/** New password rule from the auth contract: 8 to 128 characters, no composition rules. */
export const newPasswordField = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(128, 'Use 128 characters or fewer.')

/** Shown under "Type your password again" when the two passwords differ. */
export const PASSWORD_MISMATCH = 'The two passwords do not match.'

/**
 * The form values without the repeated password: the confirmation is checked
 * in the browser only, and the API takes one password (docs/api/auth.md).
 */
export function withoutConfirm<T extends { confirm: string }>(values: T): Omit<T, 'confirm'> {
  const copy: Partial<T> = { ...values }
  delete copy.confirm
  return copy as Omit<T, 'confirm'>
}

/** Something@something.something with no spaces: the email check shared by forms and mocks. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Longest email address accepted (RFC 5321 path limit). */
export const EMAIL_MAX_LENGTH = 254
const EMAIL_MESSAGE = 'Enter a valid email address, like you@example.com.'

/** Optional email; empty text means "no email". */
export const optionalEmailField = z
  .string()
  .trim()
  .max(EMAIL_MAX_LENGTH, 'This email is too long.')
  .refine((v) => v === '' || EMAIL_PATTERN.test(v), EMAIL_MESSAGE)

/**
 * Put a backend `validation_error` (details `[{loc, msg}]`) on the matching
 * form fields. `loc` is like `["body", "phone"]`; `fields` maps API field
 * names to form field names where they differ.
 *
 * @returns true if at least one field error was set.
 */
export function applyServerFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: Record<string, Path<T>>,
): boolean {
  if (!(error instanceof ApiError) || error.code !== 'validation_error' || !Array.isArray(error.details)) return false
  let applied = false
  for (const d of error.details as { loc?: unknown[]; msg?: string }[]) {
    const name = typeof d.loc?.at(-1) === 'string' ? (d.loc.at(-1) as string) : null
    const field = name ? fields[name] : undefined
    if (field) {
      setError(field, { type: 'server', message: d.msg ?? 'Check this field.' })
      applied = true
    }
  }
  return applied
}

/** Seconds to wait from a 429 `too_many_attempts` error, if present. */
export function retryAfterSeconds(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.code !== 'too_many_attempts') return null
  const details = error.details as { retry_after_seconds?: unknown } | null
  return typeof details?.retry_after_seconds === 'number' ? details.retry_after_seconds : null
}
