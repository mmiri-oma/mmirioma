/**
 * Types and typed calls for the admin water-source endpoints, mirroring
 * docs/api/admin-water-sources.md (agreed 2026-11-01, built in #309), with the
 * #385 pickup point and the #407 amendment (supplier details, order fit and
 * the cost-only change; agreed 2026-11-12, PR #417).
 *
 * `cost_per_litre_minor_units` is the supplier's cost. It is in these bodies
 * only, which only an admin can reach; the admin Water sources screen is the
 * one place it is shown or typed in. It is integer kobo, never naira. The
 * supplier contact follows the same rule.
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

/** Why a source is excluded from every order today, whatever its category (#407 `source_reasons`). */
export const SOURCE_WIDE_REASONS = ['kind_not_set', 'unavailable'] as const
export type SourceWideReason = (typeof SOURCE_WIDE_REASONS)[number]

/** The vehicles that can load at a source (#407 `vehicle_kinds`), Keke first. */
export const VEHICLE_KINDS = ['keke', 'tanker'] as const
export type VehicleKind = (typeof VEHICLE_KINDS)[number]

const locationSchema = z.object({ latitude: z.number(), longitude: z.number() })
/** A source's pickup point, WGS 84 degrees (#385). Never sent to a customer or driver. */
export type SourceLocation = z.infer<typeof locationSchema>

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
  /** The pickup point, or `null` (#385). */
  location: locationSchema.nullable(),
  /** Who to call at the source (#407), or `null`. Admin-only. */
  contact_name: z.string().nullable(),
  /** E.164 (`+234...`), or `null`. Admin-only. */
  contact_phone: z.string().nullable(),
  /** The smallest complete order the supplier serves, in litres, or `null` for no minimum. */
  min_litres_per_order: z.number().int().nullable(),
  /** The largest complete order, in litres, or `null` for no maximum. */
  max_litres_per_order: z.number().int().nullable(),
  /** Whether the source takes new work. Not a safety status. */
  is_available: z.boolean(),
  /** At least one; Keke before Tanker. */
  vehicle_kinds: z.array(z.enum(VEHICLE_KINDS)),
  /** `kind_not_set` and `unavailable`, in that order, when they apply. */
  source_reasons: z.array(z.enum(SOURCE_WIDE_REASONS)),
})
/** `WaterSourceRead`. */
export type WaterSourceRead = z.infer<typeof sourceSchema>

const listSchema = z.object({ items: z.array(sourceSchema), categories: z.array(categorySchema) })
/** `WaterSourceListRead`: every source by name, and both water categories. */
export type WaterSourceList = z.infer<typeof listSchema>

/** The #407 supplier fields a create or an edit may send. */
export interface SupplierFields {
  contact_name: string | null
  /** A Nigerian mobile number; the server stores it as E.164. */
  contact_phone: string | null
  min_litres_per_order: number | null
  max_litres_per_order: number | null
  is_available: boolean
  vehicle_kinds: VehicleKind[]
}

/** `WaterSourceCreate`. `kind` is `null` until it is set; the #407 fields take their defaults when left out. */
export interface WaterSourceCreate extends Partial<SupplierFields> {
  name: string
  approximate_location: string
  kind: WaterSourceKind | null
  location?: SourceLocation | null
}

/**
 * `WaterSourceUpdate`: send only what changes; at least one field. `null` clears
 * the pickup point, the contact and the litre limits; nothing else may be `null`.
 */
export interface WaterSourceUpdate extends Partial<SupplierFields> {
  name?: string
  approximate_location?: string
  kind?: WaterSourceKind
  location?: SourceLocation | null
}

/** `ActivationWrite`. */
export interface ActivationWrite {
  /** `YYYY-MM-DD`, today in Lagos or later. */
  approved_until: string
  report_reference: string
  /** Integer kobo, `>= 0`. */
  cost_per_litre_minor_units: number
}

/** `ActivationCostWrite` (#407): only the cost, integer kobo `>= 0`. */
export interface ActivationCostWrite {
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
 * Edit any field of a source (`PATCH /admin/water-sources/{id}`).
 *
 * @throws {ApiError} `water_source_not_found` (404); `validation_error` (422, including a
 *   pickup point outside the delivery bounds or a maximum below the minimum); `csrf_failed`;
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
 *   `water_source_kind_required` (409, #407: the source has no kind);
 *   `validation_error` (422, including a date before today); `csrf_failed`;
 *   `invalid_response`; `network_error`.
 */
export async function putAdminActivation(sourceId: string, categoryId: string, body: ActivationWrite, client: ApiClient = apiClient): Promise<WaterSourceRead> {
  return parse(sourceSchema, await client.request<unknown>(activationPath(sourceId, categoryId), { method: 'PUT', body }))
}

/**
 * Change only an activation's cost per litre, in any status (#407,
 * `PATCH /admin/water-sources/{id}/activations/{category_id}`). New quotes use
 * it; quotes and orders already made keep their price.
 *
 * @throws {ApiError} `water_source_not_found`, `water_category_not_found`,
 *   `activation_not_found` (404); `validation_error` (422); `csrf_failed`;
 *   `invalid_response`; `network_error`.
 */
export async function patchAdminActivationCost(
  sourceId: string,
  categoryId: string,
  body: ActivationCostWrite,
  client: ApiClient = apiClient,
): Promise<WaterSourceRead> {
  return parse(sourceSchema, await client.request<unknown>(activationPath(sourceId, categoryId), { method: 'PATCH', body }))
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
