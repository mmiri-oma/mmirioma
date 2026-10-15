/**
 * The session query: `GET /auth/me`, shared by every screen through TanStack
 * Query under {@link SESSION_QUERY_KEY}.
 */

import { getMe, type Session } from '../../lib/api/auth'
import { ApiError } from '../../lib/api/client'

/** Query key of the current session (`Session`, or `null` when signed out). */
export const SESSION_QUERY_KEY = ['auth', 'session'] as const

/** Mutation key of sign-out, so the global 401 handler can skip it. */
export const LOGOUT_MUTATION_KEY = ['auth', 'logout'] as const

/**
 * True when an error means the session is gone: 401 `not_authenticated`
 * (expired after 7 days, signed out elsewhere, or account deactivated,
 * FR-002). The server does not say which, and the UI does not explain.
 */
export function isSessionLost(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'not_authenticated'
}

/**
 * Load the session. A signed-out visitor is a normal result (`null`), not an
 * error; other failures (no connection) are thrown so the app can offer a
 * retry instead of wrongly showing the sign-in screen.
 *
 * @param signal - Cancels the request when the query is dropped.
 * @returns The session, or null when not signed in.
 * @throws {ApiError} Network and unexpected server failures.
 */
export async function loadSession(signal?: AbortSignal): Promise<Session | null> {
  try {
    return await getMe(signal)
  } catch (error) {
    if (isSessionLost(error)) return null
    throw error
  }
}
