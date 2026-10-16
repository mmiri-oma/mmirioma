/**
 * Customer order endpoints, mirroring docs/api/orders.md (agreed in S1-16).
 *
 * The backend endpoints are built in S1-03 part 2. Until they exist the
 * customer screens read from a `CustomerOrdersSource`
 * (src/features/customer-orders/source.ts) backed by mock data; the S1-10
 * integration switches that source to these functions. If the contract
 * changes, update these types in the same PR.
 */

import type { OrderStatus, Page } from './adminOrders'
import { apiClient, type ApiClient } from './client'

export type { OrderStatus, Page } from './adminOrders'

/**
 * `OrderRead`, the customer's view of their own order. Sprint 1 orders carry
 * no price: they are manual quote requests until quotes exist (FR-021,
 * FR-022).
 */
export interface OrderRead {
  /** Public-safe reference, e.g. `MO-7KQ2M9XH4T` (FR-027). */
  reference: string
  status: OrderStatus
  quantity_litres: number
  /** Person receiving the delivery; may differ from the account holder. */
  contact_name: string
  /** E.164, e.g. `+2348000000001`. */
  contact_phone: string
  delivery_address: string
  landmark: string | null
  delivery_instructions: string | null
  /** Lagos calendar date `YYYY-MM-DD`. A preference, not a booked slot. */
  preferred_delivery_date: string | null
  /** UTC ISO timestamp. */
  created_at: string
  updated_at: string
}

/**
 * `OrderCreate`, the body of `POST /orders`. It has no price, status,
 * customer or simulated fields: the server sets them. Optional fields are
 * left out when empty.
 */
export interface OrderCreate {
  /**
   * One UUID per request form, reused on every retry so a request is never
   * created twice (FR-026, T-06; customer design Decision 9).
   */
  idempotency_key: string
  /** Whole litres, 1–100000. */
  quantity_litres: number
  /** 1–100 characters after trimming. */
  contact_name: string
  /** Any Nigerian mobile format; the server normalizes it. */
  contact_phone: string
  /** 5–500 characters after trimming. */
  delivery_address: string
  /** Up to 200 characters. */
  landmark?: string
  /** Up to 500 characters. */
  delivery_instructions?: string
  /** `YYYY-MM-DD`, today or later in Africa/Lagos. */
  preferred_delivery_date?: string
}

/** Query parameters of `GET /orders`. */
export interface OrderListParams {
  /** 1–100. */
  limit: number
  offset: number
}

/**
 * Send a water request (`POST /api/v1/orders`).
 *
 * @returns The order: 201 when created, 200 when the same key and body were
 *   already stored (an idempotent retry).
 * @throws {ApiError} 409 `idempotency_key_reused` (the key was stored with a
 *   different body), 422 `validation_error`, 403 `csrf_failed`, 401
 *   `not_authenticated`.
 */
export function createOrder(input: OrderCreate, client: ApiClient = apiClient) {
  return client.request<OrderRead>('/api/v1/orders', { method: 'POST', body: input })
}

/**
 * List the signed-in customer's own orders, newest first (`GET /api/v1/orders`).
 *
 * @throws {ApiError} 422 `validation_error` for an out-of-range `limit`.
 */
export function listOrders(
  params: OrderListParams,
  signal?: AbortSignal,
  client: ApiClient = apiClient,
) {
  const query = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
  })
  return client.request<Page<OrderRead>>(`/api/v1/orders?${query}`, { signal })
}

/**
 * Load one of the customer's orders (`GET /api/v1/orders/{reference}`).
 *
 * @throws {ApiError} 404 `order_not_found`, also for another customer's
 *   order, so references cannot be probed (FR-001, T-07).
 */
export function getOrder(reference: string, signal?: AbortSignal, client: ApiClient = apiClient) {
  return client.request<OrderRead>(`/api/v1/orders/${encodeURIComponent(reference)}`, {
    signal,
  })
}
