/**
 * Types for the admin order endpoints, mirroring docs/api/orders.md (S1-01).
 *
 * That contract is still "proposed", and `GET /admin/orders` is not implemented
 * yet (S1-03). The admin UI therefore reads from an `AdminOrdersSource`
 * (src/features/admin-orders/source.ts) that is backed by mock data until the
 * S1-10 integration supplies functions calling these endpoints. If the contract
 * changes, update these types in the same PR.
 */

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
  /** 1–100. */
  limit: number
  offset: number
}
