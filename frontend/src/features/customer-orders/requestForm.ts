/**
 * The "Request water" form (O2): values, client checks, and how they map to
 * `POST /orders` (docs/api/orders.md, "Field rules").
 *
 * The client checks repeat the server's rules so mistakes show before
 * anything is sent; the server still validates everything. Error texts are
 * the approved copy in docs/design/customer-ordering.md.
 */

import { z } from 'zod'
import { ApiError } from '../../lib/api/client'
import type { OrderCreate } from '../../lib/api/orders'
import { toLagosDate } from '../../lib/format'
import { PHONE_FORMAT_MESSAGE, formatPhoneForDisplay, isNigerianMobile } from '../auth/phone'

/**
 * Preset quantity tiles in litres. These are **sample values pending
 * business approval** (FR-021 pilot defaults, PRD §13; customer design open
 * question 1). Any quantity becomes a manual quote request in Sprint 1, so
 * changing them needs no other change.
 */
export const PRESET_LITRES = [25, 50, 100, 200, 300, 500] as const

/** Quantity bounds from the contract; the upper bound only rejects nonsense. */
export const MIN_LITRES = 1
export const MAX_LITRES = 100_000

export const FIELD_LIMITS = {
  contactName: 100,
  deliveryAddress: 500,
  landmark: 200,
  deliveryInstructions: 500,
} as const

export const REQUEST_MESSAGES = {
  chooseQuantity: 'Choose how much water you need.',
  litres: 'Enter a whole number of litres from 1 to 100,000.',
  contactName: "Enter the receiver's name.",
  contactPhone: PHONE_FORMAT_MESSAGE,
  deliveryAddress: 'Enter the full delivery address (at least 5 characters).',
  deliveryAddressTooLong: 'Use 500 characters or fewer.',
  landmark: 'Use 200 characters or fewer.',
  deliveryInstructions: 'Use 500 characters or fewer.',
  preferredDate: 'Choose today or a later date.',
} as const

/** Form values as typed. Every control holds a string. */
export interface RequestFormValues {
  /** A preset in litres (`'200'`), `'other'`, or `''` when nothing is chosen. */
  quantityChoice: string
  /** Litres typed after choosing "Other amount". */
  otherLitres: string
  contactName: string
  contactPhone: string
  deliveryAddress: string
  landmark: string
  deliveryInstructions: string
  /** `YYYY-MM-DD` from the date picker, or `''`. */
  preferredDate: string
}

export type RequestField = keyof RequestFormValues

/** Order of fields on the page, used for the error summary. */
export const FIELD_ORDER: RequestField[] = [
  'quantityChoice',
  'otherLitres',
  'contactName',
  'contactPhone',
  'deliveryAddress',
  'landmark',
  'deliveryInstructions',
  'preferredDate',
]

/** Short names of the fields for the error summary links. */
export const FIELD_LABELS: Record<RequestField, string> = {
  quantityChoice: 'How much water',
  otherLitres: 'Amount',
  contactName: "Receiver's name",
  contactPhone: "Receiver's phone",
  deliveryAddress: 'Delivery address',
  landmark: 'Landmark',
  deliveryInstructions: 'Delivery instructions',
  preferredDate: 'Preferred delivery date',
}

/**
 * A new, empty form with the receiver prefilled from the signed-in account
 * (O2: someone else may receive the water, so both stay editable). The phone
 * is shown in the local `0800 000 0001` form, which the server accepts.
 */
export function emptyRequestValues(user: { name: string; phone: string }): RequestFormValues {
  return {
    quantityChoice: '',
    otherLitres: '',
    contactName: user.name,
    contactPhone: formatPhoneForDisplay(user.phone),
    deliveryAddress: '',
    landmark: '',
    deliveryInstructions: '',
    preferredDate: '',
  }
}

/** Today's calendar date in Africa/Lagos, `YYYY-MM-DD`. */
export function lagosToday(now: Date = new Date()): string {
  return toLagosDate(now.toISOString())
}

const WHOLE_NUMBER = /^\d+$/

/**
 * Build the form schema. `today` is passed in so the "today or later" rule
 * follows the Lagos calendar and tests can fix the date.
 *
 * @param today - Lagos date `YYYY-MM-DD`; earlier preferred dates are errors.
 */
export function requestSchema(today: string) {
  return z
    .object({
      quantityChoice: z.string(),
      otherLitres: z.string(),
      contactName: z
        .string()
        .trim()
        .min(1, REQUEST_MESSAGES.contactName)
        .max(FIELD_LIMITS.contactName, REQUEST_MESSAGES.contactName),
      contactPhone: z.string().refine(isNigerianMobile, REQUEST_MESSAGES.contactPhone),
      deliveryAddress: z
        .string()
        .trim()
        .min(5, REQUEST_MESSAGES.deliveryAddress)
        .max(FIELD_LIMITS.deliveryAddress, REQUEST_MESSAGES.deliveryAddressTooLong),
      landmark: z.string().trim().max(FIELD_LIMITS.landmark, REQUEST_MESSAGES.landmark),
      deliveryInstructions: z
        .string()
        .trim()
        .max(FIELD_LIMITS.deliveryInstructions, REQUEST_MESSAGES.deliveryInstructions),
      // ISO dates compare correctly as strings.
      preferredDate: z
        .string()
        .refine((date) => date === '' || date >= today, REQUEST_MESSAGES.preferredDate),
    })
    .superRefine((values, context) => {
      if (values.quantityChoice === '') {
        context.addIssue({
          code: 'custom',
          path: ['quantityChoice'],
          message: REQUEST_MESSAGES.chooseQuantity,
        })
      } else if (values.quantityChoice === 'other' && litresOf(values.otherLitres) === null) {
        context.addIssue({ code: 'custom', path: ['otherLitres'], message: REQUEST_MESSAGES.litres })
      }
    })
}

/** Whole litres within the contract's bounds, or null. */
function litresOf(raw: string): number | null {
  const trimmed = raw.trim()
  if (!WHOLE_NUMBER.test(trimmed)) return null
  const litres = Number(trimmed)
  return litres >= MIN_LITRES && litres <= MAX_LITRES ? litres : null
}

/**
 * Turn checked form values into the `POST /orders` body. Text is trimmed and
 * empty optional fields are left out.
 *
 * @param values - Values that passed {@link requestSchema}.
 * @param idempotencyKey - The form's key (Decision 9).
 */
export function toOrderCreate(values: RequestFormValues, idempotencyKey: string): OrderCreate {
  const quantity =
    values.quantityChoice === 'other' ? litresOf(values.otherLitres) : Number(values.quantityChoice)
  const body: OrderCreate = {
    idempotency_key: idempotencyKey,
    quantity_litres: quantity ?? 0,
    contact_name: values.contactName.trim(),
    contact_phone: values.contactPhone.trim(),
    delivery_address: values.deliveryAddress.trim(),
  }
  const landmark = values.landmark.trim()
  const instructions = values.deliveryInstructions.trim()
  if (landmark) body.landmark = landmark
  if (instructions) body.delivery_instructions = instructions
  if (values.preferredDate) body.preferred_delivery_date = values.preferredDate
  return body
}

/** Form field and approved message for each `OrderCreate` field. */
const SERVER_FIELDS: Record<string, { field: RequestField; message: string }> = {
  contact_name: { field: 'contactName', message: REQUEST_MESSAGES.contactName },
  contact_phone: { field: 'contactPhone', message: REQUEST_MESSAGES.contactPhone },
  delivery_address: { field: 'deliveryAddress', message: REQUEST_MESSAGES.deliveryAddress },
  landmark: { field: 'landmark', message: REQUEST_MESSAGES.landmark },
  delivery_instructions: {
    field: 'deliveryInstructions',
    message: REQUEST_MESSAGES.deliveryInstructions,
  },
  preferred_delivery_date: { field: 'preferredDate', message: REQUEST_MESSAGES.preferredDate },
}

/**
 * Match a 422 `validation_error` to form fields through `details[].loc`
 * (O2-c note 4). Each field shows the design's message, not the server's
 * technical text.
 *
 * @param error - The error thrown by `POST /orders`.
 * @param quantityChoice - Current choice, to put a quantity error on the
 *   "Amount" field or on the tiles.
 * @returns Field errors, empty when none could be matched.
 */
export function serverFieldErrors(
  error: ApiError,
  quantityChoice: string,
): Partial<Record<RequestField, string>> {
  const result: Partial<Record<RequestField, string>> = {}
  if (!Array.isArray(error.details)) return result
  for (const item of error.details as unknown[]) {
    const loc = (item as { loc?: unknown } | null)?.loc
    const name = Array.isArray(loc) ? loc[loc.length - 1] : undefined
    if (typeof name !== 'string') continue
    if (name === 'quantity_litres') {
      if (quantityChoice === 'other') result.otherLitres = REQUEST_MESSAGES.litres
      else result.quantityChoice = REQUEST_MESSAGES.chooseQuantity
      continue
    }
    const match = SERVER_FIELDS[name]
    if (match) result[match.field] = match.message
  }
  return result
}

/**
 * A new random UUID v4 for `idempotency_key`. Uses `crypto.randomUUID` where
 * available; it is missing outside secure contexts (for example a phone
 * opening the dev server over plain HTTP), so the same format is built from
 * `crypto.getRandomValues` there.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
