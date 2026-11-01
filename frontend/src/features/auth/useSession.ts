import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../lib/api/client'
import type { LoginInput, RegisterInput, Session, User } from '../../lib/api/auth'
import type { CodePurpose, PhoneChangeInput } from '../../lib/api/phoneVerification'
import { clearDraft } from '../customer/order/draft'
import { getMe, getPhoneCodeStatus, login, logout, register, requestPhoneChange, requestPhoneVerification, verifyPhone, verifyPhoneChange } from './authApi'

export const SESSION_KEY = ['session'] as const

/**
 * The current session, or `null` when signed out.
 *
 * Calls `GET /auth/me` once per page load (the CSRF token lives only in
 * memory, so a reload must fetch it again, see frontend.md). A 401 means
 * "signed out", not an error.
 */
export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async ({ signal }): Promise<Session | null> => {
      try {
        return await getMe(signal)
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    },
    staleTime: Infinity,
    retry: false,
  })
}

/**
 * Sign in; on success the session query holds the new session. The order draft
 * is cleared too: it holds a receiver's name, phone and address and is not tied
 * to an account, so the previous person's draft must not reach this one.
 */
export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: LoginInput) => login(input),
    onSuccess: (session) => {
      qc.clear()
      clearDraft()
      qc.setQueryData(SESSION_KEY, session)
    },
  })
}

/** Create a customer account and sign in. */
export function useRegister() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: RegisterInput) => register(input),
    onSuccess: (session) => {
      qc.clear()
      clearDraft()
      qc.setQueryData(SESSION_KEY, session)
    },
  })
}

/**
 * Sign out. All cached data and the saved order draft are dropped so the next
 * person on a shared phone never sees the previous account's orders, name,
 * phone number or address (#272).
 */
export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => logout(),
    onSettled: () => {
      qc.clear()
      clearDraft()
      qc.setQueryData(SESSION_KEY, null)
    },
  })
}

/**
 * Put the updated user from a phone verification or change into the session,
 * and refetch everything else, since screens such as the profile show the
 * phone and its status too.
 */
function useApplyUser() {
  const qc = useQueryClient()
  return (user: User) => {
    qc.setQueryData<Session | null>(SESSION_KEY, (s) => (s ? { ...s, user } : s))
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== SESSION_KEY[0] })
  }
}

/** Send an SMS code to the account's phone (FR-003, docs/api/auth.md). */
export function useRequestPhoneVerification() {
  return useMutation({ mutationFn: () => requestPhoneVerification() })
}

/** Check the SMS code; on success the session shows the phone as verified. */
export function useVerifyPhone() {
  const apply = useApplyUser()
  return useMutation({ mutationFn: (code: string) => verifyPhone(code), onSuccess: apply })
}

/** Send an SMS code to a new number (FR-004). The account keeps its number until verified. */
export function useRequestPhoneChange() {
  return useMutation({ mutationFn: (input: PhoneChangeInput) => requestPhoneChange(input) })
}

/** Check the code sent to the new number; on success the session has the new number. */
export function useVerifyPhoneChange() {
  const apply = useApplyUser()
  return useMutation({ mutationFn: (code: string) => verifyPhoneChange(code), onSuccess: apply })
}

/** How often the app asks whether an SMS code arrived, while it is still only "accepted". */
const DELIVERY_POLL_MS = 5_000

/**
 * Whether the newest SMS code reached the phone (docs/api/auth.md, status
 * endpoints). Polls every few seconds while the provider has only accepted the
 * message, and stops at `delivered` or `failed`. A new code (`sentAt` changes)
 * starts a fresh check. Errors are ignored: not knowing is shown as "no news",
 * never as delivered.
 *
 * @param purpose - Which flow the code belongs to.
 * @param sentAt - When the code was sent (any value that changes per send).
 */
export function useCodeDelivery(purpose: CodePurpose, sentAt: number) {
  const status = useQuery({
    queryKey: ['phone-code-status', purpose, sentAt],
    queryFn: () => getPhoneCodeStatus(purpose),
    retry: false,
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.delivery_status === 'accepted' || query.state.data === undefined ? DELIVERY_POLL_MS : false),
  })
  return status.data?.delivery_status ?? 'accepted'
}
