/**
 * What an auth form shows when a request fails, and the fixed texts of the
 * approved design (docs/design/authentication.md, "Exact text").
 */

import { ApiError } from '../../lib/api/client'
import { retryAfterSeconds } from './waitTime'

export const AUTH_TEXT = {
  invalidCredentials: 'Phone number or password is incorrect',
  phoneExists: 'An account with this phone number already exists',
  tooManyAttempts: 'Too many attempts. Please wait and try again.',
  csrfFailed: 'Security token missing or invalid. Reload the page and try again.',
  network: 'Unable to reach the server. Check your connection and try again.',
  sessionEnded: 'Your session has ended. Please sign in again.',
  signedOut: "You've signed out.",
  signOutFailed: "Couldn't sign out. Check your connection and try again.",
  welcomeNotice:
    'A team member will confirm your phone number before your first delivery is confirmed.',
  phoneNotConfirmed: "We'll confirm your phone number before your first delivery.",
} as const

/** Banner action buttons the design uses. */
export type BannerAction = 'retry' | 'sign-in-instead' | 'reload'

/** A banner above an auth form or in the account menu. */
export interface AuthBanner {
  tone: 'error' | 'warning' | 'info'
  title: string
  action?: BannerAction
  /** For rate limits: seconds to wait, shown as "Try again in N minutes". */
  waitSeconds?: number
}

/**
 * Map a failed auth request to the banner the design shows.
 *
 * Known codes use the design's exact text, which matches the server's
 * messages. Anything else shows the error's own message, so nothing fails
 * silently.
 *
 * @param error - The value thrown by an auth API call.
 * @returns The banner to show.
 */
export function bannerForError(error: unknown): AuthBanner {
  if (!(error instanceof ApiError)) {
    return { tone: 'error', title: AUTH_TEXT.network, action: 'retry' }
  }
  switch (error.code) {
    case 'invalid_credentials':
      return { tone: 'error', title: AUTH_TEXT.invalidCredentials }
    case 'phone_already_registered':
      return { tone: 'error', title: AUTH_TEXT.phoneExists, action: 'sign-in-instead' }
    case 'too_many_attempts': {
      const seconds = retryAfterSeconds(error)
      return {
        tone: 'warning',
        title: AUTH_TEXT.tooManyAttempts,
        ...(seconds === null ? {} : { waitSeconds: seconds }),
      }
    }
    case 'csrf_failed':
      return { tone: 'error', title: AUTH_TEXT.csrfFailed, action: 'reload' }
    case 'network_error':
      return { tone: 'error', title: AUTH_TEXT.network, action: 'retry' }
    default:
      return { tone: 'error', title: error.message }
  }
}
