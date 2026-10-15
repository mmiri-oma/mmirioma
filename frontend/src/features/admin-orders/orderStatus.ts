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
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import type { BadgeTone } from '../../components/ui/Badge'
import type { OrderStatus } from '../../lib/api/adminOrders'

interface StatusMeta {
  /** Staff-facing label ("Staff see it as" in docs/api/orders.md). */
  label: string
  /** What the status means for the dispatcher. */
  description: string
  tone: BadgeTone
  icon: LucideIcon
}

/**
 * Display metadata per order status. Meanings follow FR-033; labels are the
 * staff wording approved in docs/design/admin-orders.md (Decision 9) and listed
 * in docs/api/orders.md. `assigned` reads "Assigned - awaiting driver" because
 * nobody may treat it as driver acceptance (FR-032).
 *
 * Tones and icons follow the design system's status badges.
 */
export const ORDER_STATUS_META: Record<OrderStatus, StatusMeta> = {
  quote_requested: {
    label: 'Request received',
    description: 'Request received. No accepted price yet.',
    tone: 'info',
    icon: Inbox,
  },
  awaiting_confirmation: {
    label: 'Awaiting confirmation',
    description: 'Customer accepted a price. Source, slot and contact still need confirming.',
    tone: 'warning',
    icon: Clock,
  },
  confirmed: {
    label: 'Confirmed',
    description: 'Source, price, slot and contact confirmed. Ready to assign.',
    tone: 'brand',
    icon: Check,
  },
  assigned: {
    label: 'Assigned - awaiting driver',
    description: 'A driver is assigned but has not accepted yet.',
    tone: 'brand',
    icon: UserRound,
  },
  accepted: {
    label: 'Driver accepted',
    description: 'The assigned driver accepted the job.',
    tone: 'brand',
    icon: UserCheck,
  },
  collected: {
    label: 'Water collected',
    description: 'Water picked up from the approved source.',
    tone: 'brand',
    icon: Droplet,
  },
  en_route: {
    label: 'On the way',
    description: 'Driver reported travelling to the customer. Not live tracking.',
    tone: 'info',
    icon: Truck,
  },
  delivered: {
    label: 'Delivered',
    description: 'Delivered with proof of quantity and acknowledgement.',
    tone: 'success',
    icon: CircleCheck,
  },
  cancelled: {
    label: 'Cancelled',
    description: 'Cancelled with a recorded reason.',
    tone: 'off',
    icon: Ban,
  },
  failed: {
    label: 'Delivery failed',
    description: 'Delivery attempt failed.',
    tone: 'danger',
    icon: CircleX,
  },
  disputed: {
    label: 'Disputed',
    description: 'Delivery is under review after a dispute.',
    tone: 'review',
    icon: Search,
  },
}

/** All statuses in queue order: the ordinary FR-033 progression, then exceptions. */
export const ORDER_STATUSES = Object.keys(ORDER_STATUS_META) as OrderStatus[]

/** Narrow an untrusted string (e.g. a URL parameter) to an `OrderStatus`. */
export function isOrderStatus(value: string): value is OrderStatus {
  return Object.hasOwn(ORDER_STATUS_META, value)
}
