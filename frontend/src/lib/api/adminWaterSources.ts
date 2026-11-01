/**
 * Types and typed calls for the admin water-source endpoints, mirroring
 * docs/api/admin-water-sources.md (agreed 2026-11-01, built in #309).
 *
 * `cost_per_litre_minor_units` is the supplier's cost. It is in these bodies
 * only, which only an admin can reach; the admin Water sources screen is the
 * one place it is shown or typed in. It is integer kobo, never naira.
 *
 * Responses are checked at runtime with Zod, so an unexpected shape is
 * reported as `ApiError` `invalid_response` instead of showing a wrong source.
 *
 * If the contract changes, update these types and schemas in the same PR.
 */

import { z } from 'zod'
import { apiClient, ApiError, type ApiClient } from './client'

const PATH = '/api/v1/admin/water-sources'

/** Where a source collects water; a Tanker customer's preference is matched against it. */
export const WATER_SOURCE_KINDS = ['borehole', 'ninth_mile'] as const
export type WaterSourceKind = (typeof WATER_SOURCE_KINDS)[number]

const categorySchema = z.object({ id: z.string(), code: z.string(), label: z.string() })
/** `WaterCategoryRead`: the label is a name, never a claim about the water. */
export type WaterCategoryRead = z.infer<typeof categorySchema>

/** Why a source cannot serve a category today (the order confirmation contract's reasons). */
export const ELIGIBILITY_REASONS = ['not_activated', 'suspended', 'revoked', 'approval_expired'] as const

const activationSchema = z.object({
  category: categorySchema,
  status: z.enum(['activated', 'suspended', 'revoked']),
  /** The last Lagos date the approval is valid, inclusive (`YYYY-MM-DD`). */
  approved_until: z.string(),
  report_reference: z.string(),
  cost_per_litre_minor_units: z.number().int(),
  status_reason: z.string().nullable(),
  /** Worked out by the server: `days_left` is 0 on the last valid day and negative once expired. */
  expiry: z.object({ state: z.enum(['ok', 'expires_soon', 'expired']), days_left: z.number().int() }),
  reasons: z.array(z.enum(ELIGIBILITY_REASONS)),
})
/** `ActivationRead`. */
export type ActivationRead = z.infer<typeof activationSchema>

const sourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  approximate_location: z.string(),
  kind: z.enum(WATER_SOURCE_KINDS).nullable(),
  is_simulated: z.boolean(),
  created_at: z.string(),
  activations: z.array(activationSchema),
})
/** `WaterSourceRead`. */
export type WaterSourceRead = z.infer<typeof sourceSchema>

const listSchema = z.object({ items: z.array(sourceSchema), categories: z.array(categorySchema) })
/** `WaterSourceListRead`: every source by name, and both water categories. */
export type WaterSourceList = z.infer<typeof listSchema>

/** `WaterSourceCreate`. `kind` is `null` until it is set. */
export interface WaterSourceCreate {
  name: string
  approximate_location: string
  kind: WaterSourceKind | null
}

/** `WaterSourceUpdate`: send only what changes; at least one field, and none `null`. */
export interface WaterSourceUpdate {
  name?: string
  approximate_location?: string
  kind?: WaterSourceKind
}

/** `ActivationWrite`. */
export interface ActivationWrite {
  /** `YYYY-MM-DD`, today in Lagos or later. */
  approved_until: string
  report_reference: string
  /** Integer kobo, `>= 0`. */
  cost_per_litre_minor_units: number
}

/** `ActivationStatusWrite`. */
export interface ActivationStatusWrite {
  status: 'suspended' | 'revoked'
  reason: string
}

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

const sourcePath = (sourceId: string) => `${PATH}/${encodeURIComponent(sourceId)}`
const activationPath = (sourceId: string, categoryId: string) => `${sourcePath(sourceId)}/activations/${encodeURIComponent(categoryId)}`

/**
 * Every source with its activations, and both categories (`GET /admin/water-sources`).
 *
 * @throws {ApiError} `invalid_response`; shared 401/403; `network_error`.
 */
export async function listAdminWaterSources(signal?: AbortSignal, client: ApiClient = apiClient): Promise<WaterSourceList> {
  return parse(listSchema, await client.request<unknown>(PATH, { signal }))
}

/**
 * Add a source (`POST /admin/water-sources`). It serves no category until it is activated.
 *
 * @throws {ApiError} `validation_error` (422); `csrf_failed`; `invalid_response`; `network_error`.
 */
export async function createAdminWaterSource(body: WaterSourceCreate, client: ApiClient = apiClient): Promise<WaterSourceRead> {
  return parse(sourceSchema, await client.request<unknown>(PATH, { method: 'POST', body }))
}

/**
 * Edit a source's name, location or kind (`PATCH /admin/water-sources/{id}`).
 *
 * @throws {ApiError} `water_source_not_found` (404); `validation_error` (422); `csrf_failed`;
 *   `invalid_response`; `network_error`.
 */
export async function updateAdminWaterSource(id: string, body: WaterSourceUpdate, client: ApiClient = apiClient): Promise<WaterSourceRead> {
  return parse(sourceSchema, await client.request<unknown>(sourcePath(id), { method: 'PATCH', body }))
}

/**
 * Activate a source for a category, or renew it in any status
 * (`PUT /admin/water-sources/{id}/activations/{category_id}`).
 *
 * @throws {ApiError} `water_source_not_found`, `water_category_not_found` (404);
 *   `validation_error` (422, including a date before today); `csrf_failed`;
 *   `invalid_response`; `network_error`.
 */
export async function putAdminActivation(sourceId: string, categoryId: string, body: ActivationWrite, client: ApiClient = apiClient): Promise<WaterSourceRead> {
  return parse(sourceSchema, await client.request<unknown>(activationPath(sourceId, categoryId), { method: 'PUT', body }))
}

/**
 * Suspend or revoke an activation
 * (`POST /admin/water-sources/{id}/activations/{category_id}/status`).
 *
 * @throws {ApiError} `water_source_not_found`, `water_category_not_found`,
 *   `activation_not_found` (404); `validation_error` (422); `csrf_failed`;
 *   `invalid_response`; `network_error`.
 */
export async function setAdminActivationStatus(
  sourceId: string,
  categoryId: string,
  body: ActivationStatusWrite,
  client: ApiClient = apiClient,
): Promise<WaterSourceRead> {
  return parse(sourceSchema, await client.request<unknown>(`${activationPath(sourceId, categoryId)}/status`, { method: 'POST', body }))
}
