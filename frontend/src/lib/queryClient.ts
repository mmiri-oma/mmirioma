import {
  MutationCache,
  QueryCache,
  QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import {
  LOGOUT_MUTATION_KEY,
  SESSION_QUERY_KEY,
  isSessionLost,
} from '../features/auth/sessionQuery'
import { ApiError } from './api/client'

function sameKey(key: QueryKey | undefined, expected: readonly string[]): boolean {
  return (
    key !== undefined &&
    key.length === expected.length &&
    key.every((part, i) => part === expected[i])
  )
}

/**
 * Create the app's TanStack Query client.
 *
 * - Queries retry once for network and 5xx failures, which are often
 *   transient on mobile connections, but never for 4xx: a 404
 *   `order_not_found` will not fix itself and should show immediately.
 *   Mutations are never retried, so nothing is sent twice.
 * - Any request that fails with 401 `not_authenticated` (outside the session
 *   query itself and sign-out, which handle it directly) re-checks the
 *   session. The re-check returns `null`, and the session provider then shows
 *   "Your session has ended" (X2) on the app's sign-in screen.
 */
export function createQueryClient(): QueryClient {
  const recheckSession = () =>
    queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })

  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (isSessionLost(error) && !sameKey(query.queryKey, SESSION_QUERY_KEY)) {
          void recheckSession()
        }
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _onMutateResult, mutation) => {
        if (
          isSessionLost(error) &&
          !sameKey(mutation.options.mutationKey, LOGOUT_MUTATION_KEY)
        ) {
          void recheckSession()
        }
      },
    }),
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          const clientError =
            error instanceof ApiError && error.status !== null && error.status < 500
          return !clientError && failureCount < 1
        },
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  })
  return queryClient
}
