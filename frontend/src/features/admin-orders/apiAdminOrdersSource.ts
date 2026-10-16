import { getAdminOrder, listAdminOrders } from '../../lib/api/adminOrders'
import { apiClient, type ApiClient } from '../../lib/api/client'
import { ORDERS_DATA } from '../../lib/ordersData'
import { mockAdminOrdersSource } from './mockAdminOrders'
import type { AdminOrdersSource } from './source'

/**
 * Admin order source backed by the real API (`GET /admin/orders`,
 * `GET /admin/orders/{reference}`, docs/api/orders.md). Errors come through
 * unchanged as `ApiError`, so the screens' error states work as with the mock.
 *
 * @param client - Override for tests; defaults to the shared client.
 */
export function createApiAdminOrdersSource(
  client: ApiClient = apiClient,
): AdminOrdersSource {
  return {
    isMock: false,
    listOrders: (params, signal) => listAdminOrders(params, signal, client),
    getOrder: (reference, signal) => getAdminOrder(reference, signal, client),
  }
}

/**
 * The admin order source the app uses, chosen once at start-up from
 * `VITE_ORDERS_SOURCE` (see `lib/ordersData.ts`).
 */
export const adminOrdersSource: AdminOrdersSource =
  ORDERS_DATA === 'api' ? createApiAdminOrdersSource() : mockAdminOrdersSource
