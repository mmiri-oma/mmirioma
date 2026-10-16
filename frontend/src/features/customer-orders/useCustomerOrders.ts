import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useCustomerOrdersSource } from './source'

/** Orders per page on My orders (customer design Decision 3; the API allows 1–100). */
export const ORDERS_PAGE_SIZE = 20

/**
 * Root of every customer order query key. Keys include the account id, so a
 * different person signing in on the same phone never sees cached orders of
 * the previous account.
 */
export const customerOrdersKey = (userId: string) => ['customer-orders', userId] as const

/**
 * Load My orders (O1) page by page, newest first. "Load more" fetches the
 * next 20 and appends them; the list ends when every order is shown
 * (`items so far = total`). TanStack Query passes an abort signal that
 * cancels requests for an unmounted screen.
 *
 * @param userId - Signed-in account id, for the cache key.
 */
export function useCustomerOrderList(userId: string) {
  const source = useCustomerOrdersSource()
  return useInfiniteQuery({
    queryKey: [...customerOrdersKey(userId), 'list'],
    queryFn: ({ pageParam, signal }) =>
      source.listOrders({ limit: ORDERS_PAGE_SIZE, offset: pageParam }, signal),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const shown = pages.reduce((count, page) => count + page.items.length, 0)
      // Also stop on an empty page, so a shrinking list cannot loop.
      return shown < lastPage.total && lastPage.items.length > 0 ? shown : undefined
    },
  })
}

/**
 * Load one of the customer's orders (O4).
 *
 * @param userId - Signed-in account id, for the cache key.
 * @param reference - Order reference from the URL.
 */
export function useCustomerOrder(userId: string, reference: string) {
  const source = useCustomerOrdersSource()
  return useQuery({
    queryKey: [...customerOrdersKey(userId), 'detail', reference],
    queryFn: ({ signal }) => source.getOrder(reference, signal),
  })
}
