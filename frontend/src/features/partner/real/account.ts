/**
 * Partner account adapters (#67): sign-up, profile and preferences, going
 * online, and notifications, against docs/api/partners.md. Conversions
 * follow its "Mapping to the design types" and
 * docs/architecture/api-mapping.md. Fields the contract does not return keep
 * the screen's empty or "not connected yet" state, never made-up values:
 *
 * - `documents`: `[]`; uploads stay on their own `notConnected` (decision 6).
 * - `payout_account_ending`: `null`; earnings and payouts stay unlinked
 *   (decision 7).
 *
 * Server errors pass through unchanged as `ApiError`, except sign-up field
 * errors, which `partnerSignup` renames to the form's fields.
 */
import type {
  ApprovalStatus,
  PartnerNotification,
  PartnerNotificationList,
  PartnerProfile,
  PartnerSignupInput,
  SignupArea,
  VehicleType,
} from '../../../domain/partner'
import { litresFromGallons } from '../../../domain/quantity'
import type { Session } from '../../../lib/api/auth'
import { apiClient, ApiError, type ApiClient } from '../../../lib/api/client'
import {
  getDriverProfile,
  listDriverNotifications,
  listServiceZoneOptions,
  markDriverNotificationsRead,
  registerPartner,
  setDriverAvailability,
  updateDriverProfile,
  type NotificationRead,
  type PartnerProfileRead,
} from '../../../lib/api/partners'

const APPROVAL_STATUSES: readonly ApprovalStatus[] = ['pending', 'approved', 'suspended']
const NOTIFICATION_KINDS: readonly PartnerNotification['kind'][] = [
  'assigned',
  'new_orders',
  'payout',
  'station_closed',
  'papers_due',
  'reassigned',
  'account',
]

/**
 * The design's vehicle type. `delivery_type` is `null` only for drivers made
 * with the command-line tool before it asked; a declared tank capacity then
 * means a tanker, anything else a Keke (agreed for #67).
 */
function vehicleType(vehicle: PartnerProfileRead['vehicle']): VehicleType {
  return vehicle.delivery_type ?? (vehicle.declared_capacity_gallons !== null ? 'tanker' : 'keke')
}

/** Admin's vehicle text, else built from the sign-up details in the mock's words. */
function vehicleDescription(vehicle: PartnerProfileRead['vehicle'], type: VehicleType): string {
  if (vehicle.description !== null) return vehicle.description
  if (type === 'keke') return 'Tricycle'
  const gallons = vehicle.declared_capacity_gallons
  if (gallons === null) return 'Tanker'
  const litres = vehicle.declared_capacity_litres ?? litresFromGallons(gallons)
  return `${gallons.toLocaleString('en-NG')} gal (${litres.toLocaleString('en-NG')} L) tank`
}

/** `transfer_methods` in words. Empty until admin sets them at approval (partners.md, question 4). */
function pourInto(methods: string[]): string {
  const ground = methods.includes('ground')
  const overhead = methods.includes('overhead')
  if (ground && overhead) return 'Ground and overhead tanks'
  if (ground) return 'Ground tanks'
  if (overhead) return 'Overhead tanks'
  return 'Not set yet'
}

/**
 * Backend partner profile to the design's `PartnerProfile`.
 *
 * An `approval_status` this build does not know is read as `pending`: the
 * partner cannot go online from the screen, and the server still decides.
 */
export function partnerProfileFromRead(read: PartnerProfileRead): PartnerProfile {
  const type = vehicleType(read.vehicle)
  return {
    name: read.name,
    phone: read.phone,
    approval: APPROVAL_STATUSES.find((s) => s === read.approval_status) ?? 'pending',
    online: read.is_available,
    partner_since: read.partner_since,
    vehicle: {
      type,
      plate: read.vehicle.plate ?? '',
      description: vehicleDescription(read.vehicle, type),
      tank_gallons: read.vehicle.declared_capacity_gallons,
      safe_load_litres: read.vehicle.safe_payload_litres,
      can_pour_into: pourInto(read.vehicle.transfer_methods),
    },
    service_areas: read.service_zones.map((zone) => zone.name),
    documents: [],
    preferences: { ...read.preferences },
    payout_account_ending: null,
  }
}

const isKnownKind = (kind: string): kind is PartnerNotification['kind'] => (NOTIFICATION_KINDS as readonly string[]).includes(kind)

/**
 * Backend notifications to the design's list. A `kind` this build does not
 * know is shown as `account`, the neutral style, with the server's title and
 * body: partners.md says clients show such a message rather than fail or
 * hide it (@chidimmamogbo on PR #69). The screen has no icon of its own for
 * it, and tapping it opens the profile.
 */
export function partnerNotificationsFromRead(items: NotificationRead[]): PartnerNotification[] {
  return items.map((n) => ({
    id: n.id,
    kind: isKnownKind(n.kind) ? n.kind : 'account',
    title: n.title,
    body: n.body,
    at: n.created_at,
    read: n.read_at !== null,
    reference: n.reference,
  }))
}

/** Contract field names to the sign-up form's, so the screen puts server errors under the right field. */
const SIGNUP_FIELD: Record<string, string> = { declared_capacity_gallons: 'tank_gallons', delivery_type: 'vehicle_type' }

type FieldError = { loc?: unknown[]; msg?: string; type?: string }

/** The active service zones a new partner can choose from (`GET /service-zones`, no session needed). */
export async function listSignupAreas(client: ApiClient = apiClient): Promise<SignupArea[]> {
  const zones = await listServiceZoneOptions(undefined, client)
  return zones.map((zone) => ({ id: zone.id, name: zone.name })).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Sign up (`POST /auth/partner-register`) with the ID of the zone the partner
 * chose from {@link listSignupAreas}. The server checks that the zone exists
 * and is active.
 *
 * @throws {ApiError} `validation_error` (422) with `details` named after the
 *   form's fields; a zone switched off since the list was loaded is reported
 *   on `service_zone_id` with a message the form can show. Also
 *   `phone_already_registered` (409) and `too_many_attempts` (429).
 */
export async function partnerSignup(input: PartnerSignupInput, client: ApiClient = apiClient): Promise<Session> {
  try {
    return await registerPartner(
      {
        name: input.name,
        phone: input.phone,
        password: input.password,
        delivery_type: input.vehicle_type,
        plate: input.plate,
        declared_capacity_gallons: input.vehicle_type === 'tanker' ? input.tank_gallons : null,
        service_zone_id: input.service_zone_id,
      },
      client,
    )
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'validation_error' || !Array.isArray(error.details)) throw error
    const details = (error.details as FieldError[]).map((d): FieldError => {
      const last = d.loc?.at(-1)
      if (last === 'service_zone_id') return { ...d, msg: 'This area is not open for sign-up any more. Choose another area.' }
      if (typeof last !== 'string' || !Object.hasOwn(SIGNUP_FIELD, last)) return d
      return { ...d, loc: [...d.loc!.slice(0, -1), SIGNUP_FIELD[last]] }
    })
    throw new ApiError({ kind: error.kind, status: error.status, code: error.code, message: error.message, details, cause: error })
  }
}

/** The signed-in partner's profile (`GET /driver/profile`). */
export async function getPartnerProfile(client: ApiClient = apiClient): Promise<PartnerProfile> {
  return partnerProfileFromRead(await getDriverProfile(undefined, client))
}

/** Change preferences (`PATCH /driver/profile`). */
export async function updatePartnerProfile(
  update: { preferences?: Partial<PartnerProfile['preferences']> },
  client: ApiClient = apiClient,
): Promise<PartnerProfile> {
  return partnerProfileFromRead(await updateDriverProfile({ preferences: update.preferences ?? {} }, client))
}

/** Go online or offline (`PUT /driver/availability`). */
export async function setOnline(online: boolean, client: ApiClient = apiClient): Promise<PartnerProfile> {
  return partnerProfileFromRead(await setDriverAvailability(online, client))
}

/**
 * The newest page (50) of the partner's notifications
 * (`GET /driver/notifications`), with the server's `unread_count` across all
 * pages for the badges and "Mark all read".
 */
export async function listPartnerNotifications(client: ApiClient = apiClient): Promise<PartnerNotificationList> {
  const page = await listDriverNotifications({}, undefined, client)
  return { items: partnerNotificationsFromRead(page.items), unread_count: page.unread_count }
}

/** Mark every unread notification read (`POST /driver/notifications/read`, no ids). */
export async function markPartnerNotificationsRead(client: ApiClient = apiClient): Promise<void> {
  await markDriverNotificationsRead(undefined, client)
}
