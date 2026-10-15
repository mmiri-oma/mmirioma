/**
 * Which screen a route shows for the current session (route guards).
 *
 * The server enforces roles on every request (FR-001); these guards only
 * decide what to show, so a person never sees screens for another role.
 */

import type { UserRole } from '../../lib/api/auth'

/** The two apps built in Sprint 1. The driver app follows with S1-15. */
export type AppArea = 'customer' | 'staff'

/** Role each app admits. Staff screens are for `admin` (dispatchers). */
export const APP_ROLE: Record<AppArea, UserRole> = {
  customer: 'customer',
  staff: 'admin',
}

/** Home of each app, where a signed-in person lands. */
export const APP_HOME: Record<AppArea, string> = { customer: '/', staff: '/staff' }

/** Sign-in screen of each app. */
export const SIGN_IN_PATH: Record<AppArea, string> = {
  customer: '/sign-in',
  staff: '/staff/sign-in',
}

/** What the session query currently knows. */
export type SessionStatus =
  | { kind: 'checking' }
  | { kind: 'unavailable' }
  | { kind: 'signed-out'; ended: boolean }
  | { kind: 'signed-in'; role: UserRole }

/**
 * What a protected route renders:
 * - `checking`: splash (X1) while `GET /auth/me` runs; never the sign-in form.
 * - `unavailable`: the server could not be reached, so it is unknown.
 * - `sign-in`: send to the app's sign-in screen, with the X2 banner if the
 *   session ended while the app was open.
 * - `wrong-app`: signed in with a role this app does not serve (X4).
 * - `allowed`: render the page.
 */
export type AccessDecision =
  | { kind: 'checking' }
  | { kind: 'unavailable' }
  | { kind: 'sign-in'; sessionEnded: boolean }
  | { kind: 'wrong-app' }
  | { kind: 'allowed' }

/**
 * Decide what a protected route in `app` shows for `status`.
 *
 * @param status - Current session status.
 * @param app - The app the route belongs to.
 * @returns The decision; see {@link AccessDecision}.
 */
export function decideAccess(status: SessionStatus, app: AppArea): AccessDecision {
  switch (status.kind) {
    case 'checking':
      return { kind: 'checking' }
    case 'unavailable':
      return { kind: 'unavailable' }
    case 'signed-out':
      return { kind: 'sign-in', sessionEnded: status.ended }
    case 'signed-in':
      return status.role === APP_ROLE[app] ? { kind: 'allowed' } : { kind: 'wrong-app' }
  }
}

/** X4 message for each app (exact text, docs/design/authentication.md). */
export const WRONG_APP_MESSAGE: Record<AppArea, string> = {
  customer: 'This account is for MmiriOma staff. Use the staff or driver app.',
  staff: 'You do not have access to this page.',
}
