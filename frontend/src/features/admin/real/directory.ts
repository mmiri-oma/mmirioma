/**
 * Admin customers and drivers adapters (#220): the real-API side of
 * `listCustomers`, `getCustomer`, `addCustomerAddress`, `listRiders`,
 * `getRider` and `setRiderApproval` in `adminApi.ts`, converting with
 * docs/architecture/api-mapping.md ("Admin customers and drivers") and
 * docs/api/admin-directory.md.
 *
 * What the backend does not send is left out, never filled in: a customer has
 * no email, points or complaints, and a rider has no fleet code, rating, pay,
 * documents note or issue count. A deactivated account is never listed and
 * never shown as "suspended".
 */
import type { AdminCustomer, AdminCustomerSummary, AdminRider, ApprovalVehicleInput, NewAddressInput } from '../../../domain/admin'
import { describeQuantity } from '../../../domain/quantity'
import type { ApprovalStatus } from '../../../domain/partner'
import {
  addAdminCustomerAddress,
  changeAdminDriverApproval,
  getAdminCustomer,
  getAdminDriver,
  listAdminCustomers,
  listAdminDrivers,
  type AdminCustomerRead,
  type AdminCustomerSummaryRead,
  type AdminDriverRead,
  type DriverListParams,
} from '../../../lib/api/adminDirectory'
import { ApiError, apiClient, type ApiClient } from '../../../lib/api/client'
import type { ApprovalAction, RiderFilter, RiderList } from '../../../mocks/adminMock'
import { adminStatusFromBackend } from './orders'

/** Most customers or riders a page reads: the server's page maximum. */
const PAGE_SIZE = 100

function summaryFromRead(read: AdminCustomerSummaryRead): AdminCustomerSummary {
  return { id: read.id, name: read.name, phone: read.phone, phone_verified: read.phone_verified, orders: read.orders_count }
}

/**
 * A customer as the detail panel shows it. No email, points or complaints
 * (no source); the money is the backend's integer kobo as it is.
 */
export function customerFromRead(read: AdminCustomerRead): AdminCustomer {
  return {
    ...summaryFromRead(read),
    email: null,
    customer_since: read.created_at,
    total_paid_minor_units: read.paid_total_minor_units,
    addresses: read.addresses.map((a) => ({ id: a.id, label: a.label, address: a.address, landmark: a.landmark, is_default: a.is_default })),
    recent_orders: read.recent_orders.map((o) => ({
      reference: o.reference,
      quantity: describeQuantity(o.quantity_litres, 'litres', 'short'),
      delivery_type: o.delivery_type,
      created_at: o.created_at,
      status: adminStatusFromBackend(o.status),
    })),
  }
}

/**
 * The customers, newest first.
 *
 * `ordered_this_week` is the server's `ordered_last_7_days`: the last 7 days,
 * not the calendar week.
 *
 * @param query - The search text (`q`); empty reads every customer.
 * @param client - The API client; tests pass one with a fake `fetch`.
 * @throws {ApiError} As the server sends it (401, 403, 422, network).
 */
export async function listCustomers(query?: string, client: ApiClient = apiClient): Promise<{ customers: AdminCustomerSummary[]; total: number; ordered_this_week: number }> {
  const page = await listAdminCustomers({ q: query?.trim() || undefined, limit: PAGE_SIZE }, undefined, client)
  return { customers: page.items.map(summaryFromRead), total: page.total, ordered_this_week: page.ordered_last_7_days }
}

/**
 * One customer.
 *
 * @throws {ApiError} `customer_not_found` (404), also for an id that is not a customer account.
 */
export async function getCustomer(id: string, client: ApiClient = apiClient): Promise<AdminCustomer> {
  return customerFromRead(await getAdminCustomer(id, undefined, client))
}

/**
 * Save an address on a customer; returns the whole customer.
 *
 * The backend needs the address's service zone (FR-020). The design's address
 * form has no zone field yet, so a call without `zone_id` is refused here as a
 * `validation_error` on `zone_id`, never sent with a guessed zone.
 *
 * @throws {ApiError} `validation_error` (no zone, or as the server says); `customer_not_found` and
 *   `service_zone_not_found` (404).
 */
export async function addCustomerAddress(customerId: string, input: NewAddressInput, client: ApiClient = apiClient): Promise<AdminCustomer> {
  if (!input.zone_id) {
    throw new ApiError({
      kind: 'http',
      status: 422,
      code: 'validation_error',
      message: 'Request validation failed',
      details: [{ loc: ['body', 'zone_id'], msg: 'Choose the area this address is in', type: 'missing' }],
    })
  }
  const body = { label: input.label.trim(), address: input.address.trim(), landmark: input.landmark?.trim() || null, zone_id: input.zone_id }
  return customerFromRead(await addAdminCustomerAddress(customerId, body, client))
}

/** The design's approval status for the server's; one it does not know reads as waiting for approval. */
function approvalFromRead(status: string): ApprovalStatus {
  return status === 'approved' || status === 'suspended' || status === 'pending' ? status : 'pending'
}

/**
 * A rider or driver as the Riders page shows them. No fleet code, rating,
 * pay, documents note or issue count (no source). The vehicle's type and plate
 * are the partner's own declaration; a tanker's gallons are the verified
 * payload in litres divided by 4 (`null` until an admin approves it).
 */
export function riderFromRead(read: AdminDriverRead): AdminRider {
  const { vehicle } = read
  const verified = vehicle.description !== null && vehicle.safe_payload_litres !== null
  return {
    id: read.id,
    name: read.name,
    phone: read.phone,
    code: null,
    vehicle: {
      type: vehicle.delivery_type,
      plate: vehicle.plate ?? '',
      tank_gallons: vehicle.delivery_type === 'tanker' && vehicle.safe_payload_litres !== null ? vehicle.safe_payload_litres / 4 : null,
    },
    vehicle_verified: verified,
    declared_vehicle: { plate: vehicle.plate, capacity_gallons: vehicle.declared_capacity_gallons, capacity_litres: vehicle.declared_capacity_litres },
    service_areas: read.zones.map((zone) => zone.name),
    online: read.is_available,
    approval: approvalFromRead(read.approval_status),
    // Delivered jobs, never `completed_jobs`: a failed or cancelled job also ends `completed` (#275).
    trips: read.delivered_jobs ?? null,
    rating: null,
    active_orders: read.live_jobs,
    partner_since: read.created_at,
  }
}

/** The pill's server filter; `all` has none. */
function filterParams(filter: RiderFilter): DriverListParams {
  if (filter === 'keke' || filter === 'tanker') return { delivery_type: filter }
  if (filter === 'pending' || filter === 'suspended') return { approval_status: filter }
  return {}
}

/**
 * The riders and drivers, by name, with the pill counts from the server.
 *
 * Only active accounts are listed: a deactivated account has no design state
 * and is never shown as "suspended". The server has no suspended count, so
 * that pill's count is `null`, not `0`.
 *
 * @param filter - The pill.
 * @param query - The search text (`q`, also matches the vehicle type).
 */
export async function listRiders(filter: RiderFilter = 'all', query?: string, client: ApiClient = apiClient): Promise<RiderList> {
  const page = await listAdminDrivers({ ...filterParams(filter), is_active: true, q: query?.trim() || undefined, limit: PAGE_SIZE }, undefined, client)
  const { counts } = page
  return {
    riders: page.items.map(riderFromRead),
    counts: { all: counts.all, keke: counts.keke, tanker: counts.tanker, pending: counts.pending, suspended: null },
    online: counts.available,
    pending: counts.pending,
  }
}

/**
 * One rider or driver.
 *
 * @throws {ApiError} `driver_not_found` (404); `driver_inactive` (a client-side 409) for a deactivated
 *   account, which the screen shows as an error and never as "suspended".
 */
export async function getRider(id: string, client: ApiClient = apiClient): Promise<AdminRider> {
  const read = await getAdminDriver(id, undefined, client)
  if (!read.is_active) {
    throw new ApiError({ kind: 'http', status: 409, code: 'driver_inactive', message: 'This account is deactivated.' })
  }
  return riderFromRead(read)
}

/**
 * Approve, reactivate or suspend a partner. `approve` and `reactivate` both send
 * `approved` (a suspended partner who already has a verified vehicle needs no
 * `vehicle`); `suspend` sends `suspended` with the reason and no vehicle.
 *
 * @param reason - Required, 5 to 500 characters, to suspend; optional to approve.
 * @param vehicle - What the admin verified (FR-013): required to approve a partner with none yet.
 * @throws {ApiError} `driver_not_found` (404); `driver_inactive`, `partner_phone_not_verified`,
 *   `driver_has_accepted_job` (409); `validation_error` (422).
 */
export async function setRiderApproval(
  id: string,
  action: ApprovalAction,
  reason: string,
  vehicle?: ApprovalVehicleInput,
  client: ApiClient = apiClient,
): Promise<AdminRider> {
  const note = reason.trim() || null
  const body =
    action === 'suspend'
      ? { approval_status: 'suspended' as const, reason: note }
      : { approval_status: 'approved' as const, reason: note, ...(vehicle ? { vehicle } : {}) }
  return riderFromRead(await changeAdminDriverApproval(id, body, client))
}
