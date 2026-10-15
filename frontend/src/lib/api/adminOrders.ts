/**
 * Types and typed calls for the admin order endpoints, mirroring
 * docs/api/orders.md (agreed in S1-16).
 *
 * The endpoints are being built in S1-03 part 2. The admin UI reads through an
 * `AdminOrdersSource` (src/features/admin-orders/source.ts): the mock source
 * until the endpoints exist, then the API source built on these functions
 * (S1-10). If the contract changes, update these types in the same PR.
 */

import { apiClient, type ApiClient } from './client'

/** Order statuses from FR-033. Terminal: `delivered`, `cancelled`, `failed`. */
export type OrderStatus =
  | 'quote_requested'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'assigned'
  | 'accepted'
  | 'collected'
  | 'en_route'
  | 'delivered'
  | 'cancelled'
  | 'failed'
  | 'disputed'

/** Customer account behind an order (admin view only). */
export interface AdminOrderCustomer {
  id: string
  name: string
  /** E.164, e.g. `+2348000000001`. */
  phone: string
  /** Whether the phone was verified (FR-003). */
  phone_verified: boolean
}

/**
 * `AdminOrderRead`. Sprint 1 orders carry no price: they are manual quote
 * requests until the quotes module exists (FR-021, FR-022).
 */
export interface AdminOrderRead {
  id: string
  /** Public-safe reference, e.g. `MO-7KQ2M9XH4T` (FR-027). */
  reference: string
  status: OrderStatus
  quantity_litres: number
  /** Person receiving the delivery; may differ from the account holder. */
  contact_name: string
  contact_phone: string
  delivery_address: string
  landmark: string | null
  delivery_instructions: string | null
  /** Lagos calendar date `YYYY-MM-DD`. A preference, not a booked slot. */
  preferred_delivery_date: string | null
  /** UTC ISO timestamp. */
  created_at: string
  updated_at: string
  customer: AdminOrderCustomer
  /** Demo/test record, excluded from real metrics (BR-09). */
  is_simulated: boolean
}

/** Standard list envelope (docs/api/README.md "Pagination"). */
export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

/** Query parameters of `GET /admin/orders`. */
export interface AdminOrderListParams {
  /** Any of these statuses; empty means all. Sent as repeated `status=`. */
  status: OrderStatus[]
  /** Inclusive Lagos calendar date `YYYY-MM-DD`. */
  created_from?: string
  /** Inclusive Lagos calendar date `YYYY-MM-DD`. */
  created_to?: string
  /** `true`: only demo records; `false`: only real orders; omitted: both (BR-09). */
  is_simulated?: boolean
  /** 1–100. */
  limit: number
  offset: number
}

/**
 * Build the query string of `GET /admin/orders`.
 *
 * `status` is repeated once per value; optional filters are left out when
 * unset, so the server applies its defaults (all statuses, all dates, both
 * real and simulated records).
 *
 * @param params - Filters and paging.
 * @returns The query string without the leading `?`.
 */
export function adminOrderListQuery(params: AdminOrderListParams): string {
  const query = new URLSearchParams()
  params.status.forEach((status) => query.append('status', status))
  if (params.created_from) query.set('created_from', params.created_from)
  if (params.created_to) query.set('created_to', params.created_to)
  if (params.is_simulated !== undefined) {
    query.set('is_simulated', String(params.is_simulated))
  }
  query.set('limit', String(params.limit))
  query.set('offset', String(params.offset))
  return query.toString()
}

/**
 * List orders for staff, newest first (`GET /api/v1/admin/orders`).
 *
 * @param params - Filters and paging.
 * @param signal - Cancels the request (TanStack Query passes one).
 * @param client - Override for tests; defaults to the shared client.
 * @throws {ApiError} `validation_error` (422) for bad filters; shared 401/403.
 */
export function listAdminOrders(
  params: AdminOrderListParams,
  signal?: AbortSignal,
  client: ApiClient = apiClient,
) {
  return client.request<Page<AdminOrderRead>>(
    `/api/v1/admin/orders?${adminOrderListQuery(params)}`,
    { signal },
  )
}

/**
 * Load one order by its public reference (`GET /api/v1/admin/orders/{reference}`).
 *
 * @param reference - Order reference, e.g. `MO-7KQ2M9XH4T`.
 * @param signal - Cancels the request.
 * @param client - Override for tests; defaults to the shared client.
 * @throws {ApiError} `order_not_found` (404); shared 401/403.
 */
export function getAdminOrder(
  reference: string,
  signal?: AbortSignal,
  client: ApiClient = apiClient,
) {
  return client.request<AdminOrderRead>(
    `/api/v1/admin/orders/${encodeURIComponent(reference)}`,
    { signal },
  )
}
