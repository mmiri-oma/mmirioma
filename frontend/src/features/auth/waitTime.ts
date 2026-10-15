/**
 * Rate-limit wait wording (docs/design/authentication.md, Decision 8).
 */

import { ApiError } from '../../lib/api/client'

/**
 * Read how long to wait from a 429 `too_many_attempts` error.
 *
 * The server sends the wait in `details.retry_after_seconds` (and the
 * `Retry-After` header, which the browser client does not expose).
 *
 * @param error - Any thrown value.
 * @returns Whole seconds to wait, or null if the error is not a rate limit or
 *   carries no usable wait.
 */
export function retryAfterSeconds(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.code !== 'too_many_attempts') return null
  const details = error.details
  if (typeof details !== 'object' || details === null) return null
  const seconds = (details as { retry_after_seconds?: unknown }).retry_after_seconds
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0)
    return null
  return Math.ceil(seconds)
}

/**
 * Word a remaining wait in whole minutes, rounded up, never less than one.
 *
 * Rounding up means the app never invites a retry before the server allows
 * it; seconds are never shown, so there is no ticking countdown.
 *
 * @param seconds - Remaining wait in seconds (greater than zero).
 * @returns For example "Try again in 1 minute" or "Try again in 12 minutes".
 */
export function formatWait(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60))
  return `Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}
