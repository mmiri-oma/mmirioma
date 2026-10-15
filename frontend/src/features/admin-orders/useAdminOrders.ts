import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { AdminOrderListParams } from '../../lib/api/adminOrders'
import { useAdminOrdersSource } from './source'

/**
 * Load one page of the admin order directory.
 *
 * The previous page stays visible while the next one loads
 * (`keepPreviousData`), so filtering does not flash an empty table. TanStack
 * Query passes an abort signal that cancels superseded requests.
 *
 * @param params - API params, or `null` to skip the request (invalid filters).
 */
export function useAdminOrderList(params: AdminOrderListParams | null) {
  const source = useAdminOrdersSource()
  return useQuery({
    queryKey: ['admin-orders', 'list', params],
    queryFn: ({ signal }) => {
      // Only reached when `enabled` is true, i.e. params is not null.
      if (!params) throw new Error('useAdminOrderList called without params')
      return source.listOrders(params, signal)
    },
    enabled: params !== null,
    placeholderData: keepPreviousData,
  })
}

/**
 * Load one order by its public reference.
 *
 * @param reference - Order reference from the URL.
 */
export function useAdminOrder(reference: string) {
  const source = useAdminOrdersSource()
  return useQuery({
    queryKey: ['admin-orders', 'detail', reference],
    queryFn: ({ signal }) => source.getOrder(reference, signal),
  })
}
