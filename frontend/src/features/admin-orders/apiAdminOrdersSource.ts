import { getAdminOrder, listAdminOrders } from '../../lib/api/adminOrders'
import { apiClient, type ApiClient } from '../../lib/api/client'
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

/** Which data the admin order screens read. */
export type AdminOrdersSourceSetting = 'api' | 'mock'

/**
 * Choose the admin order source from `VITE_ADMIN_ORDERS_SOURCE`.
 *
 * - `api` or `mock` when set explicitly.
 * - Otherwise: the real API in a production build, so simulated data can
 *   never ship by accident (BR-09); mock data in development, until the
 *   S1-03 part 2 endpoints exist locally.
 *
 * @param setting - The raw setting (may be undefined or anything).
 * @param isProduction - Whether this is a production build.
 * @returns The setting to use.
 */
export function resolveAdminOrdersSourceSetting(
  setting: string | undefined,
  isProduction: boolean,
): AdminOrdersSourceSetting {
  if (setting === 'api' || setting === 'mock') return setting
  return isProduction ? 'api' : 'mock'
}

/** The source the app uses, chosen once at start-up. */
export const adminOrdersSource: AdminOrdersSource =
  resolveAdminOrdersSourceSetting(
    import.meta.env.VITE_ADMIN_ORDERS_SOURCE,
    import.meta.env.PROD,
  ) === 'api'
    ? createApiAdminOrdersSource()
    : mockAdminOrdersSource
