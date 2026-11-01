/**
 * Types and typed calls for the admin customers and drivers endpoints,
 * mirroring docs/api/admin-directory.md (agreed, G3, 2026-10-28; built in #45).
 *
 * Every response is checked at runtime with Zod: a value the contract does
 * not allow is reported as `ApiError` `invalid_response` rather than shown as
 * the wrong state. An unknown approval status or order status is kept as a
 * string (the contract says clients must not fail on a value they do not
 * know), and the adapter decides how to word it.
 *
 * If the contract changes, update these types and schemas in the same PR.
 */

import { z } from 'zod'
import { apiClient, ApiError, type ApiClient } from './client'

const deliveryTypeSchema = z.enum(['keke', 'tanker'])

/** `AdminCustomerSummary`: one row of the customer list. */
export const customerSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  phone_verified: z.boolean(),
  is_active: z.boolean(),
  /** Every order of the customer, any status. */
  orders_count: z.number().int(),
  created_at: z.string(),
})
export type AdminCustomerSummaryRead = z.infer<typeof customerSummarySchema>

/** `Address`: one saved address. */
export const addressSchema = z.object({
  id: z.string(),
  label: z.string(),
  address: z.string(),
  landmark: z.string().nullable(),
  zone: z.object({ id: z.string(), name: z.string(), is_active: z.boolean() }),
  is_default: z.boolean(),
  created_at: z.string(),
})
export type AdminAddressRead = z.infer<typeof addressSchema>

/** `AdminCustomer`: the detail. `paid_total_minor_units` is integer kobo (BR-01). */
export const customerSchema = customerSummarySchema.extend({
  paid_total_minor_units: z.number().int(),
  addresses: z.array(addressSchema),
  recent_orders: z.array(
    z.object({
      reference: z.string(),
      created_at: z.string(),
      /** Backend order status; the adapter maps it to the admin status. */
      status: z.string(),
      quantity_litres: z.number().int(),
      /** `null` for an order created before delivery details existed (#21). */
      delivery_type: deliveryTypeSchema.nullable(),
    }),
  ),
})
export type AdminCustomerRead = z.infer<typeof customerSchema>

const pageOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int(), limit: z.number().int(), offset: z.number().int() })

const customerPageSchema = pageOf(customerSummarySchema).extend({
  /** Customers with a real order in the last 7 days (not the calendar week); simulated orders left out (BR-09). */
  ordered_last_7_days: z.number().int(),
})
export type AdminCustomerPage = z.infer<typeof customerPageSchema>

/** `AdminDriver`: a rider or driver. */
export const driverSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  phone_verified: z.boolean(),
  /** False for a deactivated account (FR-002): it cannot sign in. */
  is_active: z.boolean(),
  /** `pending`, `approved` or `suspended`; an unknown value is kept as it is. */
  approval_status: z.string(),
  is_available: z.boolean(),
  /** The declared fields are what the partner typed at sign-up; the verified ones are set at approval (FR-013). */
  vehicle: z.object({
    delivery_type: deliveryTypeSchema.nullable(),
    plate: z.string().nullable(),
    description: z.string().nullable(),
    declared_capacity_gallons: z.number().nullable(),
    declared_capacity_litres: z.number().nullable(),
    safe_payload_litres: z.number().nullable(),
    transfer_methods: z.array(z.string()),
  }),
  zones: z.array(z.object({ id: z.string(), name: z.string() })),
  /** Assignments `offered` or `accepted`. */
  live_jobs: z.number().int(),
  /** Assignments `completed`, including jobs whose order failed or was cancelled: not a delivery count. */
  completed_jobs: z.number().int(),
  /** `completed` assignments whose order is `delivered`: the design's "trips" (#275). Absent from an older server. */
  delivered_jobs: z.number().int().optional(),
  created_at: z.string(),
})
export type AdminDriverRead = z.infer<typeof driverSchema>

const driverPageSchema = pageOf(driverSchema).extend({
  /** Over every driver, ignoring the filters. */
  counts: z.object({
    all: z.number().int(),
    keke: z.number().int(),
    tanker: z.number().int(),
    pending: z.number().int(),
    inactive: z.number().int(),
    available: z.number().int(),
  }),
})
export type AdminDriverPage = z.infer<typeof driverPageSchema>

/**
 * Check a response against a schema.
 *
 * @throws {ApiError} `invalid_response` if it does not match.
 */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ApiError({
      kind: 'parse',
      status: 200,
      code: 'invalid_response',
      message: 'The server returned an unexpected response.',
      cause: result.error,
    })
  }
  return result.data
}

/** Query parameters of `GET /admin/customers`. */
export interface CustomerListParams {
  /** Part of the name, or (4 or more digits) of the phone; 1 to 100 characters. */
  q?: string
  limit?: number
  offset?: number
}

/** The body of `POST /admin/customers/{id}/addresses`. */
export interface AddressCreate {
  /** 1 to 50 characters. */
  label: string
  /** 5 to 500 characters. */
  address: string
  /** Up to 200 characters. */
  landmark: string | null
  /** Required (FR-020): an address always has a zone. */
  zone_id: string
}

/** Query parameters of `GET /admin/drivers`. */
export interface DriverListParams {
  delivery_type?: 'keke' | 'tanker'
  approval_status?: 'pending' | 'approved' | 'suspended'
  is_active?: boolean
  q?: string
  limit?: number
  offset?: number
}

/** The vehicle an admin verified at approval (FR-013). */
export interface ApprovalVehicle {
  /** 1 to 50 characters, for example "Tanker truck". */
  description: string
  /** 1 to 100,000. */
  safe_payload_litres: number
  transfer_methods: ('ground' | 'overhead')[]
}

/** The body of `POST /admin/drivers/{id}/approval`. */
export interface ApprovalChange {
  approval_status: 'approved' | 'suspended'
  /** Required, 5 to 500 characters, to suspend; optional, up to 500, to approve. */
  reason: string | null
  /** Required to approve a partner with no verified vehicle; not allowed with `suspended`. */
  vehicle?: ApprovalVehicle
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value))
  return search.size ? `?${search}` : ''
}

/**
 * List customers, newest first (`GET /admin/customers`).
 *
 * @throws {ApiError} 401, 403; `validation_error` (422) for a bad query; `invalid_response`.
 */
export async function listAdminCustomers(params: CustomerListParams = {}, signal?: AbortSignal, client: ApiClient = apiClient): Promise<AdminCustomerPage> {
  return parse(customerPageSchema, await client.request<unknown>(`/api/v1/admin/customers${query({ ...params })}`, { signal }))
}

/**
 * One customer with their addresses and recent orders (`GET /admin/customers/{id}`).
 *
 * @throws {ApiError} `customer_not_found` (404), also for an id that is not a customer account.
 */
export async function getAdminCustomer(id: string, signal?: AbortSignal, client: ApiClient = apiClient): Promise<AdminCustomerRead> {
  return parse(customerSchema, await client.request<unknown>(`/api/v1/admin/customers/${encodeURIComponent(id)}`, { signal }))
}

/**
 * Save an address on a customer (`POST /admin/customers/{id}/addresses`, 201).
 * Returns the whole customer.
 *
 * @throws {ApiError} `customer_not_found` (404); `service_zone_not_found` (404); `validation_error` (422); `csrf_failed` (403).
 */
export async function addAdminCustomerAddress(id: string, body: AddressCreate, client: ApiClient = apiClient): Promise<AdminCustomerRead> {
  return parse(
    customerSchema,
    await client.request<unknown>(`/api/v1/admin/customers/${encodeURIComponent(id)}/addresses`, { method: 'POST', body }),
  )
}

/**
 * List riders and drivers, by name (`GET /admin/drivers`), with counts over every driver.
 *
 * @throws {ApiError} 401, 403; `validation_error` (422); `invalid_response`.
 */
export async function listAdminDrivers(params: DriverListParams = {}, signal?: AbortSignal, client: ApiClient = apiClient): Promise<AdminDriverPage> {
  return parse(driverPageSchema, await client.request<unknown>(`/api/v1/admin/drivers${query({ ...params })}`, { signal }))
}

/**
 * One rider or driver (`GET /admin/drivers/{id}`).
 *
 * @throws {ApiError} `driver_not_found` (404), also for a driver account with no dispatch profile.
 */
export async function getAdminDriver(id: string, signal?: AbortSignal, client: ApiClient = apiClient): Promise<AdminDriverRead> {
  return parse(driverSchema, await client.request<unknown>(`/api/v1/admin/drivers/${encodeURIComponent(id)}`, { signal }))
}

/**
 * Approve or suspend a partner (`POST /admin/drivers/{id}/approval`).
 *
 * @throws {ApiError} `driver_not_found` (404); `driver_inactive`, `partner_phone_not_verified`,
 *   `driver_has_accepted_job` (409); `validation_error` (422); `csrf_failed` (403).
 */
export async function changeAdminDriverApproval(id: string, body: ApprovalChange, client: ApiClient = apiClient): Promise<AdminDriverRead> {
  return parse(
    driverSchema,
    await client.request<unknown>(`/api/v1/admin/drivers/${encodeURIComponent(id)}/approval`, { method: 'POST', body }),
  )
}
