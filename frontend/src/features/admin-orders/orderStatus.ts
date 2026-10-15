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
  /** Staff-facing label. Customer wording differs (docs/api/orders.md). */
  label: string
  /** What the status means for the dispatcher. */
  description: string
  tone: BadgeTone
  icon: LucideIcon
}

/**
 * Display metadata per order status. Meanings follow FR-033 and the status
 * table in docs/api/orders.md; `assigned` is labelled "not accepted" because
 * nobody may treat it as driver acceptance (FR-032).
 *
 * Tones and icons follow the design system's status badges for the matching
 * customer label. The staff labels for `assigned`, `accepted` and `disputed`
 * are not in the design system yet (design-system.md open question 1); the
 * admin design (S1-08) settles them.
 */
export const ORDER_STATUS_META: Record<OrderStatus, StatusMeta> = {
  quote_requested: {
    label: 'Quote requested',
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
    label: 'Assigned, not accepted',
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
    label: 'En route',
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
    label: 'Failed',
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

/** The ordinary progression from FR-033, used for the lifecycle view. */
export const ORDINARY_PROGRESSION: OrderStatus[] = [
  'quote_requested',
  'awaiting_confirmation',
  'confirmed',
  'assigned',
  'accepted',
  'collected',
  'en_route',
  'delivered',
]

/** Narrow an untrusted string (e.g. a URL parameter) to an `OrderStatus`. */
export function isOrderStatus(value: string): value is OrderStatus {
  return Object.hasOwn(ORDER_STATUS_META, value)
}
