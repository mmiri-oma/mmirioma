/**
 * Fixed texts of the customer ordering screens, from the approved design
 * (docs/design/customer-ordering.md, "Exact text").
 */

import { ApiError } from '../../lib/api/client'
import { AUTH_TEXT } from '../auth/messages'

export const ORDER_TEXT = {
  emptyTitle: 'You have no orders yet',
  emptyBody: "Tell us how much water you need and where. We'll send you a price.",
  listFailed: "We couldn't load your orders",
  moreFailed: "We couldn't load more orders",
  orderFailed: "We couldn't load this order",
  notFoundTitle: 'Order not found',
  notFoundBody: 'Check the reference, or find the order in your list.',
  alreadyReceived: 'We already received this request. It is at the top of your list.',
  requestIntro: "Tell us what you need. We'll reply with a price.",
  dateHelp:
    "This is a preference, not a booked time. We'll confirm the delivery window with you.",
  priceNote:
    "We'll send you the total price before anything is confirmed. You don't pay anything now.",
  notSent: 'Your request was not sent',
  typedKept: 'Everything you typed is kept.',
  receivedLead:
    "We've got your request. It is not a confirmed delivery yet: we'll send you a price first.",
  referenceHelp: 'Use this reference if you contact us.',
  changeOrCancel: 'To change or cancel this request, contact us and quote the reference.',
  /** X2 second line when a request form was open (auth design). */
  draftKept: 'Your request has not been sent. What you typed is kept.',
  network: AUTH_TEXT.network,
  csrfFailed: AUTH_TEXT.csrfFailed,
} as const

/** "What happens next" steps on Request received (O3). */
export const NEXT_STEPS = [
  'We review your request and send you a price.',
  'You accept the price.',
  'We confirm a delivery window.',
  'A driver delivers and unloads the water for you.',
] as const

/**
 * The sentence to show under a "could not load" title. Network failures and
 * server errors carry the client's or server's human-readable message;
 * anything unexpected falls back to the connection text.
 *
 * @param error - What a query threw.
 */
export function loadErrorText(error: unknown): string {
  return error instanceof ApiError ? error.message : ORDER_TEXT.network
}
