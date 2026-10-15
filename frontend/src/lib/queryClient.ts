import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api/client'

/**
 * Create the app's TanStack Query client.
 *
 * Retries once for network and 5xx failures, which are often transient on
 * mobile connections, but never for 4xx: a 404 `order_not_found` will not fix
 * itself and should show immediately.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          const clientError = error instanceof ApiError && error.status !== null && error.status < 500
          return !clientError && failureCount < 1
        },
        refetchOnWindowFocus: false,
      },
    },
  })
}
