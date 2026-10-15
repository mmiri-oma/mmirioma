import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { logout } from '../../lib/api/auth'
import { ApiError } from '../../lib/api/client'
import type { AppArea } from './access'
import { isSessionLost, LOGOUT_MUTATION_KEY } from './sessionQuery'
import { useSession } from './sessionContext'

/** Where each app goes after signing out (X5): welcome, or staff sign-in. */
export const SIGNED_OUT_PATH: Record<AppArea, string> = {
  customer: '/',
  staff: '/staff/sign-in',
}

/** Router state that makes the landing screen show "You've signed out." */
export interface SignedOutState {
  signedOut: true
}

/**
 * Why sign-out failed, if it did:
 * - `security`: 403 `csrf_failed`; show the X3 banner with "Reload"
 *   (Decision 7: the only Sprint 1 action that can fail this way).
 * - `network`: no connection; show the error toast with "Try again". The
 *   person stays signed in.
 */
export type SignOutProblem = 'security' | 'network' | null

/**
 * Sign out of `app` (`POST /auth/logout`).
 *
 * A 401 means the session was already gone, which is the outcome the person
 * wanted, so it is treated as success.
 *
 * @param app - The app the person is in; decides where they land.
 * @returns `signOut()`, whether it is running, and the last problem.
 */
export function useSignOut(app: AppArea) {
  const { signedOut } = useSession()
  const navigate = useNavigate()
  const [problem, setProblem] = useState<SignOutProblem>(null)

  const finish = () => {
    signedOut()
    const state: SignedOutState = { signedOut: true }
    navigate(SIGNED_OUT_PATH[app], { replace: true, state })
  }

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
