import {
  Ban,
  Check,
  CircleCheck,
  CircleX,
  Clock,
  Droplet,
  Inbox,
  Search,
  Truck,
  UserCheck,
  type LucideIcon,
} from 'lucide-react'
import type { BadgeTone } from '../../components/ui/Badge'
import type { OrderStatus } from '../../lib/api/orders'

interface CustomerStatusMeta {
  /** Badge text: the contract's "Customer sees it as" column. */
  label: string
  /** One sentence shown on the order detail status box (O4). */
  explanation: string
  tone: BadgeTone
  icon: LucideIcon
}

const CONFIRMED: CustomerStatusMeta = {
  label: 'Confirmed',
  explanation: "Your delivery is confirmed. We're arranging a driver.",
  tone: 'brand',
  icon: Check,
}

/**
 * Customer wording for each order status (docs/design/customer-ordering.md,
 * "Status wording"; docs/api/orders.md "Customer sees it as").
 *
 * - `quote_requested` reads "Request received", never "confirmed" (FR-027).
 * - `assigned` is shown exactly like `confirmed`: a driver has been assigned
 *   but has not accepted, and the customer must not be told about the
 *   assignment before acceptance (FR-032).
 * - `en_route` says "On the way" with no tracking or ETA claim (PRD §9).
 *
 * Tones and icons follow the design system's status badges, the same as the
 * staff screens. Only `quote_requested` occurs in Sprint 1.
 */
export const CUSTOMER_STATUS_META: Record<OrderStatus, CustomerStatusMeta> = {
  quote_requested: {
    label: 'Request received',
    explanation: "We're preparing your price.",
    tone: 'info',
    icon: Inbox,
  },
  awaiting_confirmation: {
    label: 'Awaiting confirmation',
    explanation:
      "You accepted the price. We're checking the details before we confirm a delivery window.",
    tone: 'warning',
    icon: Clock,
  },
  confirmed: CONFIRMED,
  assigned: CONFIRMED,
  accepted: {
    label: 'Driver assigned',
    explanation: 'A driver has accepted your delivery.',
    tone: 'brand',
    icon: UserCheck,
  },
  collected: {
    label: 'Water collected',
    explanation: 'The driver has collected your water.',
    tone: 'brand',
    icon: Droplet,
  },
  en_route: {
    label: 'On the way',
    explanation: 'The driver is on the way to your address.',
    tone: 'info',
    icon: Truck,
  },
  delivered: {
    label: 'Delivered',
    explanation: 'Your water was delivered.',
    tone: 'success',
    icon: CircleCheck,
  },
  cancelled: {
    label: 'Cancelled',
    explanation: 'This order was cancelled. Contact us if you have questions.',
    tone: 'off',
    icon: Ban,
  },
  failed: {
    label: 'Delivery failed',
    explanation: "We couldn't complete this delivery. Contact us.",
    tone: 'danger',
    icon: CircleX,
  },
  disputed: {
    label: 'Under review',
    explanation: "We're looking into a problem with this delivery.",
    tone: 'review',
    icon: Search,
  },
}
