import { createContext, useContext } from 'react'
import type { AdminOrderListParams, AdminOrderRead, Page } from '../../lib/api/adminOrders'
import { mockAdminOrdersSource } from './mockAdminOrders'

/**
 * Where the admin order screens get their data.
 *
 * Signatures match `GET /admin/orders` and `GET /admin/orders/{reference}`
 * (docs/api/orders.md), so the S1-10 integration only has to provide an
 * implementation that calls `apiClient` instead of the mock.
 */
export interface AdminOrdersSource {
  /** `true` when data is simulated; the UI then shows a sample-data notice (BR-09). */
  isMock: boolean
  /**
   * @throws {ApiError} On failure; aborted requests reject with `AbortError`.
   */
  listOrders(params: AdminOrderListParams, signal?: AbortSignal): Promise<Page<AdminOrderRead>>
  /**
   * @throws {ApiError} 404 `order_not_found` for an unknown reference.
   */
  getOrder(reference: string, signal?: AbortSignal): Promise<AdminOrderRead>
}

/** Provide a different source with `<AdminOrdersSourceContext value={...}>` (tests, real API). */
export const AdminOrdersSourceContext = createContext<AdminOrdersSource>(mockAdminOrdersSource)

/** The admin order data source for the current tree. */
export function useAdminOrdersSource(): AdminOrdersSource {
  return useContext(AdminOrdersSourceContext)
}
