/**
 * Live prices on the customer screens (#121), as designed in
 * docs/design/customer-live-prices.md (#79, approved). Customers see a total
 * only, never a breakdown (order-details-and-price.md, decision 6), and the
 * price comes after the address and area (#42). Wording is @chidimmamogbo's,
 * decided on #79; the screens never show a reason or error code.
 */
import type { WaterChoice } from '../../../domain/orders'
import { ApiError } from '../../../lib/api/client'
import { retryAfterSeconds } from '../../../lib/forms'

/** An area (service zone) a customer can pick (FR-020). */
export interface AreaOption {
  id: string
  name: string
}

/** The area chosen for a new address: one from the list, "My area is not listed", or none yet. */
export type AreaChoice = AreaOption | 'not_listed' | null

/** What the Review screen asks a price for. */
export interface PriceRequest {
  choice: WaterChoice
  address: string
  /** The picked area's id; `null` when the address is in no listed area (answers `outside_service_zone`). */
  zone_id: string | null
  /** The typed gallons for a custom tank size (`choice.tank_size_gallons` null). */
  custom_gallons: number | null
}

/** A price for the order, or the reason there is none in the app. */
export type PriceQuote =
  | {
      status: 'quote_available'
      /** Sent with the order. `null` in mock mode, where the mock prices the order again. */
      quote_id: string | null
      total_minor_units: number
      price_valid_until: string
      /** The server's litres (FR-021); `null` when the mock does not say. */
      quantity_litres: number | null
      /** The water category accepted with the price (FR-023); `null` in mock mode. */
      category: { label: string; supported_uses: string | null } | null
      /** Mock prices are labelled "Sample". */
      is_sample: boolean
    }
  | { status: 'manual_quote_required'; reason: string }

/** Review, no price in the app: one message per reason (decision 1). */
const NO_PRICE: Record<string, { title: string; body: string }> = {
  outside_service_zone: { title: "We don't deliver to this area yet.", body: 'Send your request and our team will call you about it.' },
  category_unavailable: { title: "This water isn't available right now.", body: "Send your request and we'll call you." },
  no_eligible_source: { title: 'No water source can take this order today.', body: "Send your request and we'll call you with a price." },
  no_vehicle_plan: { title: 'This is more water than one delivery can carry.', body: "Send your request and we'll call you to plan it." },
  delivery_cost_unavailable: {
    title: "We can't price delivery to this area in the app yet.",
    body: "Send your request and we'll call you with a price.",
  },
  no_price_rule: { title: "We can't price this order in the app yet.", body: "Send your request and we'll call you with a price." },
}

const NO_PRICE_FALLBACK = { title: "We can't show a price for this order in the app.", body: "Send your request and we'll call you with a price." }

/** The message for a `manual_quote_required` reason; an unknown reason gets the generic one. */
export function noPriceMessage(reason: string): { title: string; body: string } {
  return Object.hasOwn(NO_PRICE, reason) ? NO_PRICE[reason] : NO_PRICE_FALLBACK
}

/** What Review shows for an error when getting a price or placing the order. */
export interface PriceProblem {
  tone: 'note' | 'error'
  title: string
  body: string
  /**
   * What the footer button does: place the order at the new price (after it is
   * fetched again), send it as a request, go back to the area, wait, or retry.
   */
  next: 'new_price' | 'send_request' | 'choose_area' | 'wait' | 'retry'
  /** For `wait`: seconds until the next price check is allowed. */
  wait_seconds?: number
}

/** "Wait N minutes": whole minutes, at least one. */
export function waitMinutes(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60))
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}

/**
 * The designed message for an error from `POST /quotes` or `POST /orders`
 * ("Review: errors when placing"), or `null` for any other error, which the
 * screen shows with the usual error block. `phone_not_verified` is `null`
 * too: the existing verify-phone banner handles it (design E3).
 */
export function priceProblem(error: unknown): PriceProblem | null {
  if (!(error instanceof ApiError)) return null
  if (error.kind === 'network') {
    return {
      tone: 'error',
      title: "We couldn't reach Waterline.",
      // Never "Nothing was ordered": the app cannot know whether it arrived (FR-026).
      body: "Check your connection and try again. Trying again won't place a second order.",
      next: 'retry',
    }
  }
  switch (error.code) {
    case 'quote_expired':
      return { tone: 'note', title: 'Your price has expired.', body: "Here's the new price: check it and place your order again.", next: 'new_price' }
    case 'quote_mismatch':
      return { tone: 'note', title: 'Your order changed after we priced it.', body: "Here's the updated price.", next: 'new_price' }
    case 'no_eligible_source':
      return { tone: 'note', title: "The water for this order isn't available any more.", body: "Send your request and we'll call you.", next: 'send_request' }
    case 'service_zone_not_found':
      return { tone: 'error', title: "This area isn't on our list any more.", body: 'Choose your area again.', next: 'choose_area' }
    case 'too_many_attempts': {
      const seconds = retryAfterSeconds(error) ?? 60
      return { tone: 'note', title: 'Too many price checks.', body: `Wait ${waitMinutes(seconds)}, then try again.`, next: 'wait', wait_seconds: seconds }
    }
    default:
      return null
  }
}

/** True once a price's `price_valid_until` has passed. */
export function isPriceExpired(validUntil: string, now: number): boolean {
  return Date.parse(validUntil) <= now
}
