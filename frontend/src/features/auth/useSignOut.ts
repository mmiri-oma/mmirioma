import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { logout } from '../../lib/api/auth'
import { ApiError } from '../../lib/api/client'
import { isSessionLost, LOGOUT_MUTATION_KEY } from './sessionQuery'
import { useSession } from './sessionContext'

/**
 * Why sign-out failed, if it did:
 * - `security`: 403 `csrf_failed`; show the X3 banner with "Reload"
 *   (Decision 7: the only Sprint 1 action that can fail this way).
 * - `network`: no connection; show the error toast with "Try again". The
 *   person stays signed in.
 */
export type SignOutProblem = 'security' | 'network' | null

/**
 * Sign out (`POST /auth/logout`).
 *
 * A 401 means the session was already gone, which is the outcome the person
 * wanted, so it is treated as success. On success the session is cleared and
 * the route guard shows the signed-out landing (customer welcome or staff
 * sign-in) with the toast. It does not navigate itself: React Router runs
 * navigations as transitions, so a `navigate()` here would lose a race with
 * the guard's own redirect.
 *
 * @returns `signOut()`, whether it is running, and the last problem.
 */
export function useSignOut() {
  const { signedOut } = useSession()
  const [problem, setProblem] = useState<SignOutProblem>(null)

  const finish = () => signedOut()

  const mutation = useMutation({
    mutationKey: LOGOUT_MUTATION_KEY,
    mutationFn: () => logout(),
    onMutate: () => setProblem(null),
    onSuccess: finish,
    onError: (error) => {
      if (isSessionLost(error)) finish()
      else if (error instanceof ApiError && error.code === 'csrf_failed')
        setProblem('security')
      else setProblem('network')
    },
  })

  return {
    signOut: () => mutation.mutate(),
    signingOut: mutation.isPending,
    problem,
    clearProblem: () => setProblem(null),
  }
}

/** What {@link useSignOut} returns; passed to the sign-out controls. */
export type SignOutState = ReturnType<typeof useSignOut>
