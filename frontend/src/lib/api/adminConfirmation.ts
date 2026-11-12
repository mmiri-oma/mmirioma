/**
 * Types and typed calls for the order confirmation endpoints, mirroring
 * docs/api/deliveries.md, "Order confirmation endpoints" (agreed G3, PR #111;
 * built in #113). The confirmation fields on the order detail and history
 * are parsed in `adminDispatch.ts`, with the rest of the order.
 *
 * The options drive which category and source can be chosen, so they are
 * checked at runtime with Zod: an unknown reason is reported as `ApiError`
 * `invalid_response` rather than shown as an eligible source.
 *
 * If the contract changes, update these types and schemas in the same PR.
 */

import { z } from 'zod'
import { parseDetail, type AdminOrderDetail } from './adminDispatch'
import { apiClient, ApiError, type ApiClient } from './client'
import { SOURCE_REASONS, type AgreementMethod, type DeliveryWindow } from './confirmationTypes'

/**
 * Why a source cannot serve the order being confirmed (C1): the four shared
 * safety reasons, then the six #407 order-fit reasons, in the server's order
 * (docs/api/admin-water-sources.md, "The order-fit check"; agreed PR #417).
 *
 * Only the C1 options use this list. The hold review (R2) and the order
 * detail's `source.reasons` keep the four values of `SOURCE_REASONS`, so that
 * list is not widened. An unknown value still fails the parse as
 * `invalid_response` instead of reading as an eligible source.
 */
export const C1_SOURCE_REASONS = [
  ...SOURCE_REASONS,
  'kind_not_set',
  'unavailable',
  'kind_mismatch',
  'below_minimum_litres',
  'above_maximum_litres',
  'vehicle_not_suitable',
] as const
export type C1SourceReason = (typeof C1_SOURCE_REASONS)[number]

const sourceOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  approximate_location: z.string(),
  /** For this category; `null` when the source is not activated for it. Never a document or link (F1). */
  report_reference: z.string().nullable(),
  /** Lagos calendar date the approval is valid through (inclusive), or `null`. */
  approved_until: z.string().nullable(),
  is_simulated: z.boolean(),
  /** Empty means the source may be chosen for this order (FR-012; #407 order fit). */
  reasons: z.array(z.enum(C1_SOURCE_REASONS)),
  /**
   * Where it collects water, or `null` until set (amendment #72). A quoted
   * Tanker order needs the customer's kind. Missing (an older server) reads
   * as `null`. Never a quality claim (FR-014).
   */
  kind: z.enum(['ninth_mile', 'borehole']).nullable().default(null),
})
/** One source for one category. The cost per litre is never sent. */
export type SourceOption = z.infer<typeof sourceOptionSchema>

const categoryOptionsSchema = z.object({
  id: z.string(),
  /** Admin-configured label (FR-014); never a description of the water. */
  label: z.string(),
  /** Every source, eligible first, then by name. */
  sources: z.array(sourceOptionSchema),
})
export type CategoryOptions = z.infer<typeof categoryOptionsSchema>

const optionsSchema = z.object({ categories: z.array(categoryOptionsSchema) })

/** Row 7 conditions a refused confirmation can name (`details.missing`). */
export const CONFIRMATION_REQUIREMENTS = ['phone_verified', 'source_eligible', 'delivery_window_set'] as const
export type ConfirmationRequirement = (typeof CONFIRMATION_REQUIREMENTS)[number]

/**
 * Body of `POST .../transition` with `to: confirmed`: a quote request with a
 * manual total (rows 26 and 7), or an order placed with a server quote (row 7
 * alone, #21), which sends no total.
 */
export interface ConfirmRequest {
  to: 'confirmed'
  /** `quote_requested` (manual price) or `awaiting_confirmation` (server price). */
  expected_status: 'quote_requested' | 'awaiting_confirmation'
  /** For a quoted order, the quote's category (amendment #72), else 422. */
  water_category_id: string
  /** For a quoted Tanker order, a source of the customer's kind, else 422. */
  source_id: string
  /** Aware ISO timestamps; the end after the start, the start not in the past. */
  delivery_window: DeliveryWindow
  /**
   * With `quote_requested`: integer kobo, a whole naira (multiple of 100), at
   * least 100, no upper limit (decision 7). With `awaiting_confirmation`:
   * absent (422 if sent); the quote's total is confirmed.
   */
  manual_quote_total_minor_units?: number
  customer_agreement: {
    method: AgreementMethod
    /** Aware ISO timestamp, not in the future, not before the order was sent. */
    agreed_at: string
    /** The five points were told to the customer (F5). Always `true`. */
    disclosures_confirmed: true
  }
  /** Optional, up to 500 characters; required with `other`. */
  note: string | null
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

const orderPath = (reference: string) => `/api/v1/admin/orders/${encodeURIComponent(reference)}`

/**
 * Every active water category with every source and its eligibility for
 * this order (`GET .../confirmation-options`, C1). Empty `sources` in every
 * category means no water sources are set up.
 *
 * @throws {ApiError} `order_not_found` (404); `invalid_response`.
 */
export async function getConfirmationOptions(
  reference: string,
  signal?: AbortSignal,
  client: ApiClient = apiClient,
): Promise<CategoryOptions[]> {
  const body = await client.request<unknown>(`${orderPath(reference)}/confirmation-options`, { signal })
  return parse(optionsSchema, body).categories
}

/**
 * Confirm an order with its window, category and source, and a manual quote
 * for a quote request (`POST .../transition`, `to: confirmed`). One request
 * writes rows 26 and 7 (row 7 alone for a quoted order); the confirmation
 * SMS is sent after it and its outcome is on the order.
 *
 * @returns The order, now `confirmed`.
 * @throws {ApiError} `transition_requirements_unmet` (409, `details.missing`);
 *   `invalid_order_transition` (409); `validation_error` (422, per field);
 *   `order_not_found` (404); `csrf_failed` (403); `network_error`.
 */
export async function confirmOrder(
  reference: string,
  request: ConfirmRequest,
  client: ApiClient = apiClient,
): Promise<AdminOrderDetail> {
  return parseDetail(
    await client.request<unknown>(`${orderPath(reference)}/transition`, { method: 'POST', body: request }),
  )
}

/**
 * The row 7 conditions named by a `transition_requirements_unmet` refusal,
 * in the server's order, ignoring any the client does not know.
 */
export function missingRequirements(error: ApiError): ConfirmationRequirement[] {
  const details = error.details as { missing?: unknown } | null
  if (!Array.isArray(details?.missing)) return []
  return details.missing.filter((item): item is ConfirmationRequirement =>
    (CONFIRMATION_REQUIREMENTS as readonly unknown[]).includes(item),
  )
}
