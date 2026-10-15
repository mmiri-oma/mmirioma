import { createContext, useContext } from 'react'
import type { Session } from '../../lib/api/auth'
import type { SessionStatus } from './access'

/** What every screen can read and do with the session. */
export interface SessionContextValue {
  status: SessionStatus
  /** The signed-in session, or null. */
  session: Session | null
  /** Re-run `GET /auth/me` after "Unable to reach the server". */
  retry: () => void
  /** Store a session just returned by sign-in or account creation. */
  signedIn: (session: Session) => void
  /**
   * Forget the session after the person chose to sign out, so it is not
   * reported as "Your session has ended".
   */
  signedOut: () => void
}

export const SessionContext = createContext<SessionContextValue | null>(null)

/**
 * Read the session. Must be used inside `SessionProvider`.
 *
 * @throws {Error} When no provider is mounted (a programming error).
 */
export function useSession(): SessionContextValue {
  const value = useContext(SessionContext)
  if (value === null) throw new Error('useSession must be used inside SessionProvider')
  return value
}
