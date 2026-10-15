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
 * Any request that fails with 401 `not_authenticated` (outside the session
 * query itself and sign-out, which handle it directly) re-checks the session.
 * The re-check returns `null`, and the session provider then shows "Your
 * session has ended" (X2) on the app's sign-in screen.
 *
 * Queries are not retried automatically: on slow networks the screens show
 * the error with a Retry button instead of waiting silently.
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
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return queryClient
}
