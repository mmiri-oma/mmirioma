/**
 * Admin overview adapters (#217): the real-API side of `getShellData`,
 * `getDashboard`, `getLiveMap`, `listActivity` and `getSettings` in
 * `adminApi.ts`, converting with docs/architecture/api-mapping.md ("Admin
 * operations") and docs/api/admin-operations.md.
 *
 * What the backend does not send is left out, never filled in: no payouts or
 * payments to verify, no support hours or safe load, no fleet code. The
 * dashboard counts real orders only (BR-09): these calls send no `simulated`
 * parameter.
 */
import type { ActivityEntry, ActivityKind, AdminDashboard, AdminSettings, StaffMember } from '../../../domain/admin'
import { ADMIN_STATUS_LABEL } from '../../../domain/admin'
import { getMe } from '../../../lib/api/auth'
import { apiClient, type ApiClient } from '../../../lib/api/client'
import {
  getAdminActivity,
  getAdminDashboard,
  getAdminLiveMap,
  getAdminSettings,
  getAdminShell,
  type AdminActivityRead,
  type AdminDashboardRead,
  type AdminSettingsRead,
  type LiveMapRead,
} from '../../../lib/api/adminOperations'
import type { AdminShellData, LiveMapData } from '../../../mocks/adminMock'
import { adminStatusFromBackend, progressStepLabel } from './orders'

/** `MO-7KQ2` for `MO-7KQ2M9XH4T`: the short form staff read in lists (as the mock does). */
function shortReference(reference: string): string {
  return reference.slice(0, 7)
}

/**
 * The header and sidebar data: the name from `GET /auth/me`, the counts from
 * `GET /admin/shell`.
 *
 * The role is "Admin": the backend has one staff role (admin-operations.md).
 *
 * @param client - The API client; tests pass one with a fake `fetch`.
 * @throws {ApiError} As the server sends it (401, 403, network).
 */
export async function getShellData(client: ApiClient = apiClient): Promise<AdminShellData> {
  const [me, shell] = await Promise.all([getMe(undefined, client), getAdminShell(undefined, client)])
  return {
    user: { name: me.user.name, role: 'Admin' },
    counts: { orders: shell.orders_needing_action, support: shell.support_requests_open },
    unread: shell.notifications_unread,
  }
}

/**
 * The signed-in admin's own account, for My account: the name and phone from
 * `GET /auth/me`, and the role "Admin" (the backend has one staff role). The
 * page shows only those, so `last_active` is `null` and the settings staff
 * list is not read (api-mapping.md, "Admin account and refill stations").
 *
 * @param client - The API client; tests pass one with a fake `fetch`.
 * @throws {ApiError} `not_authenticated` (401) and the shared errors.
 */
export async function getAdminAccount(client: ApiClient = apiClient): Promise<{ name: string; phone: string; role: string; last_active: string | null }> {
  const { user } = await getMe(undefined, client)
  return { name: user.name, phone: user.phone, role: 'Admin', last_active: null }
}

/**
 * Today's dashboard.
 *
 * The four order tiles group the backend's `by_status` with the admin status
 * table (api-mapping.md "Admin order status"); `failed` and `disputed` are
 * their own statuses and are in none of the four, and orders still awaiting
 * confirmation are in the total only. `payouts_due` and `payments_to_verify`
 * are left out: no source.
 */
export function dashboardFromRead(read: AdminDashboardRead): AdminDashboard {
  const grouped = { awaiting_rider: 0, in_progress: 0, delivered: 0, cancelled: 0 }
  for (const [status, count] of Object.entries(read.orders.by_status)) {
    switch (adminStatusFromBackend(status)) {
      case 'awaiting_rider':
        grouped.awaiting_rider += count
        break
      case 'assigned':
      case 'loading':
      case 'on_the_way':
        grouped.in_progress += count
        break
      case 'delivered':
        grouped.delivered += count
        break
      case 'cancelled':
        grouped.cancelled += count
        break
      default:
        // awaiting_confirmation, failed, disputed: in the total, in none of the four tiles.
        break
    }
  }
  return {
    date: read.date,
    orders: { total: read.orders.total, ...grouped, oldest_waiting_minutes: read.orders.oldest_waiting_minutes },
    disputes_open: read.support_requests_open,
    riders_online: read.drivers_available,
    stations: { open: read.sources.usable, closed: read.sources.not_usable },
    revenue_today_minor_units: read.cash.collected_minor_units,
    by_type: { keke: read.by_delivery_type.keke, tanker: read.by_delivery_type.tanker },
    is_sample: read.is_simulated,
  }
}

/** Today's dashboard (`GET /admin/dashboard`). */
export async function getDashboard(client: ApiClient = apiClient): Promise<AdminDashboard> {
  return dashboardFromRead(await getAdminDashboard(undefined, client))
}

/**
 * The live map. No GPS: each delivery is placed by its source and zone.
 *
 * A delivery with no delivery type has no vehicle (the map draws a neutral
 * marker); no plate, source location or zone is left `null`. The water
 * sources become the map's stations, `open` being `usable` (the same rule as
 * the dashboard's open and closed counts).
 */
export function liveMapFromRead(read: LiveMapRead): LiveMapData {
  const locationBySource = new Map(read.sources.map((source) => [source.id, source.approximate_location]))
  return {
    deliveries: read.deliveries.map((delivery) => ({
      reference: delivery.reference,
      code: delivery.driver.plate,
      vehicle: delivery.delivery_type,
      status: adminStatusFromBackend(delivery.status),
      station_area: delivery.source ? (locationBySource.get(delivery.source.id) ?? null) : null,
      customer_area: delivery.zone?.name ?? null,
      partner: delivery.driver.name,
    })),
    stations: read.sources.map((source) => ({ id: source.id, name: source.name, area: source.approximate_location, open: source.usable })),
  }
}

/** The live map (`GET /admin/live-map`). */
export async function getLiveMap(client: ApiClient = apiClient): Promise<LiveMapData> {
  return liveMapFromRead(await getAdminLiveMap(undefined, client))
}

/** The kind and wording of one activity item; an unknown kind reads as a plain line. */
function activityEntry(item: AdminActivityRead['items'][number]): ActivityEntry {
  const reference = item.order_reference
  const short = reference ? shortReference(reference) : null
  // Customers are never named: the server sends an actor for staff and drivers only.
  const actor = item.actor?.name ?? null
  let kind: ActivityKind = 'admin'
  let text: string
  if (item.kind === 'support_request') {
    kind = 'complaint'
    text = short ? `New support request on ${short}` : 'New support request'
  } else if (item.kind === 'order_status' && item.to_status) {
    const subject = short ?? 'An order'
    switch (item.to_status) {
      case 'quote_requested':
        kind = 'new_order'
        text = `New order ${short ?? ''}`.trim()
        break
      case 'accepted':
        kind = 'accepted'
        text = actor ? `${actor} accepted ${subject}` : `${subject} accepted`
        break
      case 'delivered':
        kind = 'delivered'
        text = `${subject} delivered`
        break
      default: {
        // A driver step keeps its own name, as on the order timeline (#275, G2); other statuses use the status label.
        const label = progressStepLabel(item.to_status) ?? ADMIN_STATUS_LABEL[adminStatusFromBackend(item.to_status)]
        text = actor ? `${actor} moved ${subject} to ${label}` : `${subject} is now ${label}`
      }
    }
  } else {
    text = short ? `Update on ${short}` : 'Update'
  }
  return { id: item.id, at: item.at, kind, text, reference }
}

/**
 * Recent activity, newest first.
 *
 * @param limit - 1 to 20; the server defaults to 5.
 */
export async function listActivity(limit?: number, client: ApiClient = apiClient): Promise<ActivityEntry[]> {
  const read = await getAdminActivity(limit, undefined, client)
  return read.items.map(activityEntry)
}

/**
 * The read-only settings. `support_hours` and `safe_load` have no source and
 * stay empty; the delivery code limit reads "10 minutes". Every staff member
 * is an "Admin"; `last_active` is their last sign-in (`null` if none).
 */
export function settingsFromRead(read: AdminSettingsRead): { settings: AdminSettings; staff: StaffMember[] } {
  const minutes = read.delivery_code_validity_minutes
  return {
    settings: {
      support_phone: read.support.phone,
      support_hours: null,
      code_time_limit: `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`,
      safe_load: { keke: null, tanker: null },
    },
    staff: read.staff.map((member) => ({ id: member.id, name: member.name, role: 'Admin', phone: member.phone, last_active: member.last_sign_in_at })),
  }
}

/** The settings page data (`GET /admin/settings`). */
export async function getSettings(client: ApiClient = apiClient): Promise<{ settings: AdminSettings; staff: StaffMember[] }> {
  return settingsFromRead(await getAdminSettings(undefined, client))
}
