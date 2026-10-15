import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '../../lib/api/auth'
import { apiClient } from '../../lib/api/client'
import type { SessionStatus } from './access'
import { SessionContext, type SessionContextValue } from './sessionContext'
import { SESSION_QUERY_KEY, loadSession } from './sessionQuery'

/** Sessions last 7 days and rarely change; re-check every 5 minutes at most. */
const SESSION_STALE_MS = 5 * 60 * 1000

/**
 * Loads the session once on start (`GET /auth/me`, which also restores the
 * in-memory CSRF token after a reload) and shares it with every screen.
 *
 * It also works out whether a session **ended** while the app was open: the
 * person was signed in, and the session is now gone without them signing out
 * (expired, or the account was disabled, FR-002). Those screens show "Your
 * session has ended" (X2). A visitor who opens the app already signed out
 * sees the normal sign-in screen, because the app keeps nothing in storage
 * that could tell the two apart.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: ({ signal }) => loadSession(signal),
    staleTime: SESSION_STALE_MS,
  })

  const cachedSession = query.data ?? null
  const userId = cachedSession?.user.id ?? null

  // A session set by sign-in or sign-out, used until the query cache catches
  // up. The cache notifies subscribers a moment after `setQueryData`, but the
  // navigation that follows sign-in or sign-out happens at once; without this
  // the next screen would see the old session (for example, the staff
  // sign-in screen would bounce a person who just signed out back to /staff).
  // `undefined` means no override.
  const [override, setOverride] = useState<Session | null | undefined>(undefined)

  // Track the cache across renders to spot a session ending, and drop the
  // override once the cache has the new value. Adjusting state during render
  // (not in an effect) follows React's "storing information from previous
  // renders" pattern.
  const [tracked, setTracked] = useState({
    userId: null as string | null,
    updatedAt: 0,
    ended: false,
  })
  if (query.data !== undefined && query.dataUpdatedAt !== tracked.updatedAt) {
    // Ended: there was a user, now there is none, and the person did not
    // choose to sign out (that sets an override of null first).
    const ended = tracked.userId !== null && userId === null && override === undefined
    setTracked({
      userId,
      updatedAt: query.dataUpdatedAt,
      ended: userId === null && (ended || tracked.ended),
    })
    if (override !== undefined) setOverride(undefined)
  }

  const session = override !== undefined ? override : cachedSession

  const signedIn = useCallback(
    (next: Session) => {
      setOverride(next)
      queryClient.setQueryData(SESSION_QUERY_KEY, next)
    },
    [queryClient],
  )
  const signedOut = useCallback(() => {
    setOverride(null)
    apiClient.setCsrfToken(null)
    queryClient.setQueryData(SESSION_QUERY_KEY, null)
  }, [queryClient])
  const { refetch } = query
  const retry = useCallback(() => void refetch(), [refetch])

  const loaded = query.data !== undefined
  const unavailable = !loaded && query.isError && !query.isFetching
  const role = session?.user.role ?? null
  const chosen = override === null
  const status = useMemo<SessionStatus>(() => {
    // While a retry after "unavailable" runs, the splash shows again.
    if (!loaded) return unavailable ? { kind: 'unavailable' } : { kind: 'checking' }
    if (role === null) return { kind: 'signed-out', ended: tracked.ended && !chosen }
    return { kind: 'signed-in', role }
  }, [loaded, unavailable, role, tracked.ended, chosen])

  const value = useMemo<SessionContextValue>(
    () => ({ status, session, retry, signedIn, signedOut }),
    [status, session, retry, signedIn, signedOut],
  )
  return <SessionContext value={value}>{children}</SessionContext>
}
