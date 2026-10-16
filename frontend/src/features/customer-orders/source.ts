import { createContext, useContext } from 'react'
import {
  createOrder,
  getOrder,
  listOrders,
  type OrderCreate,
  type OrderListParams,
  type OrderRead,
  type Page,
} from '../../lib/api/orders'
import { ORDERS_DATA } from '../../lib/ordersData'
import { mockCustomerOrdersSource } from './mockCustomerOrders'

/**
 * Where the customer order screens get their data.
 *
 * Signatures match `POST /orders`, `GET /orders` and `GET /orders/{reference}`
 * (docs/api/orders.md), so the S1-10 integration only has to provide
 * {@link apiCustomerOrdersSource} instead of the mock.
 */
export interface CustomerOrdersSource {
  /**
   * `true` when data is simulated. The screens then show a "Sample data"
   * notice so nothing is mistaken for a real request (BR-09).
   */
  isMock: boolean
  /**
   * @throws {ApiError} 409 `idempotency_key_reused`, 422 `validation_error`,
   *   403 `csrf_failed`, 401 `not_authenticated`, or a network failure.
   */
  createOrder(input: OrderCreate): Promise<OrderRead>
  /**
   * @throws {ApiError} On failure; aborted requests reject with `AbortError`.
   */
  listOrders(params: OrderListParams, signal?: AbortSignal): Promise<Page<OrderRead>>
  /**
   * @throws {ApiError} 404 `order_not_found` for an unknown reference or
   *   another customer's order.
   */
  getOrder(reference: string, signal?: AbortSignal): Promise<OrderRead>
}

/** Source calling the real API through `apiClient`. */
export const apiCustomerOrdersSource: CustomerOrdersSource = {
  isMock: false,
  createOrder: (input) => createOrder(input),
  listOrders: (params, signal) => listOrders(params, signal),
  getOrder: (reference, signal) => getOrder(reference, signal),
}

/**
 * The customer order source the app uses, chosen once at start-up from
 * `VITE_ORDERS_SOURCE` (see `lib/ordersData.ts`): the real API unless mock
 * data is asked for, or in tests. `App.tsx` provides it to the customer
 * routes (S1-10).
 */
export const customerOrdersSource: CustomerOrdersSource =
  ORDERS_DATA === 'api' ? apiCustomerOrdersSource : mockCustomerOrdersSource

/**
 * Provide a source with `<CustomerOrdersSourceContext value={...}>` (the app
 * passes {@link customerOrdersSource}; tests pass their own). Without a
 * provider, the mock is used.
 */
export const CustomerOrdersSourceContext =
  createContext<CustomerOrdersSource>(mockCustomerOrdersSource)

/** The customer order data source for the current tree. */
export function useCustomerOrdersSource(): CustomerOrdersSource {
  return useContext(CustomerOrdersSourceContext)
}
