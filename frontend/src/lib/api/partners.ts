/**
 * Types and typed calls for the partner account endpoints, mirroring
 * docs/api/partners.md (agreed G3 2026-10-26, #47; built in #61): partner
 * sign-up, the partner's own profile and preferences, going online, and the
 * in-app notifications. Also the zone list sign-up picks from
 * (`GET /service-zones`, docs/api/admin-directory.md).
 *
 * Responses are checked at runtime with Zod: the profile decides which app a
 * partner sees and whether they may go online, so an unexpected shape is
 * reported as `ApiError` `invalid_response` instead of showing the wrong
 * state. Values the contract says clients must tolerate (an unknown
 * `approval_status` or notification `kind`) are read as plain strings.
 *
 * If the contract changes, update these types and schemas in the same PR.
 */

import { z } from 'zod'
import type { Session } from './auth'
import { apiClient, ApiError, type ApiClient } from './client'

/** `keke` or `tanker`, chosen at sign-up (design decision 9). */
export const DELIVERY_TYPES = ['keke', 'tanker'] as const
export type DeliveryType = (typeof DELIVERY_TYPES)[number]

const partnerVehicleSchema = z.object({
  /** `null` only for drivers created with the command-line tool before it asked. */
  delivery_type: z.enum(DELIVERY_TYPES).nullable(),
  plate: z.string().nullable(),
  /** The vehicle profile's text, set by admin; `null` until admin links one. */
  description: z.string().nullable(),
  /** Tanker only: what the driver typed at sign-up. A claim, not verified. */
  declared_capacity_gallons: z.number().int().nullable(),
  declared_capacity_litres: z.number().int().nullable(),
  /** The verified safe payload (FR-013); `null` until admin verifies it. */
  safe_payload_litres: z.number().int().nullable(),
  /** `ground`, `overhead`; set by admin at approval, empty until then. */
  transfer_methods: z.array(z.string()),
})

/** Coordinate-free location summary (#410); future state strings remain readable. */
const driverLocationReadSchema = z.object({
  state: z.string(),
  sharing: z.boolean(),
  confirmed_at: z.string().nullable(),
  fresh_until: z.string().nullable(),
  accuracy_metres: z.number().int().positive().nullable(),
})

/** `PartnerProfileRead` (partners.md, "Partner object"). */
export const partnerProfileReadSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** E.164. */
  phone: z.string(),
  phone_verified: z.boolean(),
  /** `pending`, `approved` or `suspended`; a later server may add more. */
  approval_status: z.string(),
  /** FR-031 availability; the design calls it "online". */
  is_available: z.boolean(),
  /** Age/accuracy/sharing only; never device coordinates or a sharing grant (#410). */
  location: driverLocationReadSchema,
  /** `YYYY-MM-DD`, Africa/Lagos. */
  partner_since: z.string(),
  vehicle: partnerVehicleSchema,
  /** The zone chosen at sign-up is the first row. */
  service_zones: z.array(z.object({ id: z.string(), name: z.string() })),
  /** Stored only: nothing is sent to partners yet (partners.md, decision 5). */
  preferences: z.object({ new_order_alerts: z.boolean(), sms_updates: z.boolean() }),
})
export type PartnerProfileRead = z.infer<typeof partnerProfileReadSchema>

const notificationReadSchema = z.object({
  id: z.string(),
  /** See partners.md, "Notifications"; a later server may add more. */
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  /** The order's public reference, or `null`. Never the delivery code. */
  reference: z.string().nullable(),
  created_at: z.string(),
  /** UTC timestamp, or `null` while unread. */
  read_at: z.string().nullable(),
})
export type NotificationRead = z.infer<typeof notificationReadSchema>

const notificationPageSchema = z.object({
  items: z.array(notificationReadSchema),
  /** Unread messages across all pages. */
  unread_count: z.number().int(),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
})
export type NotificationPage = z.infer<typeof notificationPageSchema>

const zoneOptionListSchema = z.object({ items: z.array(z.object({ id: z.string(), name: z.string() })) })
export type ZoneOption = z.infer<typeof zoneOptionListSchema>['items'][number]

/** Body of `POST /auth/partner-register`. */
export interface PartnerRegisterRequest {
  name: string
  /** Any Nigerian mobile format; the server normalizes it. */
  phone: string
  password: string
  /** See `RegisterInput.accepted_terms` in `auth.ts`. */
  accepted_terms: boolean
  delivery_type: DeliveryType
  /** Trimmed and upper-cased by the server, then 4 to 15 characters. */
  plate: string
  /** Tanker: 500 to 20,000. Keke: `null`. */
  declared_capacity_gallons: number | null
  /** An active zone from `GET /service-zones`. */
  service_zone_id: string
}

/** Body of `PATCH /driver/profile`: any subset of the two preferences. */
export interface PartnerProfileUpdate {
  preferences: Partial<PartnerProfileRead['preferences']>
}

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

const PROFILE_PATH = '/api/v1/driver/profile'
const NOTIFICATIONS_PATH = '/api/v1/driver/notifications'

/**
 * Create a partner account and sign in (`POST /auth/partner-register`).
 * The partner starts `pending` and offline. Stores the session's CSRF token
 * like `register` in `auth.ts`.
 *
 * @throws {ApiError} `phone_already_registered` (409), `validation_error`
 *   (422, `loc` names the field), `too_many_attempts` (429).
 */
export async function registerPartner(request: PartnerRegisterRequest, client: ApiClient = apiClient): Promise<Session> {
  const session = await client.request<Session>('/api/v1/auth/partner-register', { method: 'POST', body: request })
  client.setCsrfToken(session.csrf_token)
  return session
}

/**
 * Active service zones, by name (`GET /service-zones`). Needs no session.
 *
 * @throws {ApiError} `invalid_response`; `network_error`.
 */
export async function listServiceZoneOptions(signal?: AbortSignal, client: ApiClient = apiClient): Promise<ZoneOption[]> {
  return parse(zoneOptionListSchema, await client.request<unknown>('/api/v1/service-zones', { signal })).items
}

/**
 * The signed-in partner's profile (`GET /driver/profile`).
 *
 * @throws {ApiError} `no_driver_profile` (404); `invalid_response`; shared 401/403.
 */
export async function getDriverProfile(signal?: AbortSignal, client: ApiClient = apiClient): Promise<PartnerProfileRead> {
  return parse(partnerProfileReadSchema, await client.request<unknown>(PROFILE_PATH, { signal }))
}

/**
 * Change the preferences (`PATCH /driver/profile`). Every other field is
 * admin-managed or fixed at sign-up.
 *
 * @throws {ApiError} `validation_error` (422); `csrf_failed` (403); `no_driver_profile` (404).
 */
export async function updateDriverProfile(request: PartnerProfileUpdate, client: ApiClient = apiClient): Promise<PartnerProfileRead> {
  return parse(partnerProfileReadSchema, await client.request<unknown>(PROFILE_PATH, { method: 'PATCH', body: request }))
}

/**
 * Go online or offline (`PUT /driver/availability`, FR-031). Going offline
 * is always allowed; setting the current value is not an error.
 *
 * @throws {ApiError} `partner_not_approved` (403: going online while pending
 *   or suspended); `csrf_failed` (403); `validation_error` (422).
 */
export async function setDriverAvailability(isAvailable: boolean, client: ApiClient = apiClient): Promise<PartnerProfileRead> {
  const body = await client.request<unknown>('/api/v1/driver/availability', { method: 'PUT', body: { is_available: isAvailable } })
  return parse(partnerProfileReadSchema, body)
}

/**
 * One page of the partner's in-app messages, newest first
 * (`GET /driver/notifications`). The server's default page is 50.
 *
 * @throws {ApiError} `validation_error` (422: bad `limit` or `offset`); shared 401/403.
 */
export async function listDriverNotifications(
  page: { limit?: number; offset?: number } = {},
  signal?: AbortSignal,
  client: ApiClient = apiClient,
): Promise<NotificationPage> {
  const query = new URLSearchParams()
  if (page.limit !== undefined) query.set('limit', String(page.limit))
  if (page.offset !== undefined) query.set('offset', String(page.offset))
  const search = query.toString()
  const path = search ? `${NOTIFICATIONS_PATH}?${search}` : NOTIFICATIONS_PATH
  return parse(notificationPageSchema, await client.request<unknown>(path, { signal }))
}

/**
 * Mark messages read (`POST /driver/notifications/read`, 204). Without
 * `ids`, marks every unread message read. Unknown ids are ignored.
 *
 * @param ids - Up to 100 message ids.
 * @throws {ApiError} `validation_error` (422); `csrf_failed` (403).
 */
export async function markDriverNotificationsRead(ids?: string[], client: ApiClient = apiClient): Promise<void> {
  await client.request<unknown>(`${NOTIFICATIONS_PATH}/read`, { method: 'POST', body: ids ? { ids } : {} })
}
