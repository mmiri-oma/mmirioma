/**
 * Labels and colours for admin statuses. Every status shows a word, never
 * colour alone (handoff README, "Colour").
 */
import { HOLD_KIND_LABEL, type AdminOrder, type AdminOrderHold, type AdminOrderStatus, type PapersState, type SamplePriceTable, type SamplePriceTableInput } from '../../domain/admin'
import type { ChipTone } from '../../components/ui/Chip'
import type { AdminPaymentStatus } from '../../domain/admin'
import type { PaymentMethod } from '../../domain/orders'
import type { ApprovalStatus } from '../../domain/partner'
import { POINTS_ENABLED } from '../../lib/features'

export const STATUS_TONE: Record<AdminOrderStatus, ChipTone> = {
  awaiting_confirmation: 'amber',
  awaiting_rider: 'amber',
  assigned: 'blue',
  loading: 'violet',
  on_the_way: 'blue',
  delivered: 'green',
  cancelled: 'red',
  failed: 'red',
  disputed: 'amber',
}

/**
 * Whether an "Awaiting rider" order cannot be assigned yet. The design groups
 * `confirmed` and `awaiting_payment` under that status, but the backend assigns
 * only `confirmed` orders (deliveries.md, "Admin dispatch endpoints"). A mock
 * order sends no backend status and is always assignable (#144).
 */
export function notReadyToAssign(order: Pick<AdminOrder, 'status' | 'backend_status'>): boolean {
  return order.status === 'awaiting_rider' && order.backend_status !== undefined && order.backend_status !== 'confirmed'
}

export const PAYMENT_LABEL: Record<AdminPaymentStatus, string> = {
  // Decided by @chidimmamogbo on PR #92.
  pending_collection: 'Cash to collect',
  unpaid: 'Unpaid',
  awaiting_verification: 'To verify',
  paid: 'Paid',
  // The approved cash design's label (docs/design/cash-remittance.md).
  partially_paid: 'Part paid',
  refund_due: 'Refund due',
  refunded: 'Refunded as points',
}

/**
 * Whether the order's payment chip shows. "Cash to collect" is untrue once the
 * order has failed or been cancelled, since no unloading will happen and the
 * Cash page shows nothing waiting; the other payment states stay because
 * refunds and recorded money depend on them (#274, decision by
 * @nnamdi-security). The stored payment status is unchanged.
 */
export function showsPaymentChip(order: Pick<AdminOrder, 'status' | 'payment'>): boolean {
  if (order.payment.status === null) return false
  return !(order.payment.status === 'pending_collection' && (order.status === 'failed' || order.status === 'cancelled'))
}

export const PAYMENT_TONE: Record<AdminPaymentStatus, ChipTone> = {
  // The normal state of a confirmed pay-on-delivery order, not a problem.
  pending_collection: 'gray',
  unpaid: 'gray',
  awaiting_verification: 'amber',
  paid: 'green',
  partially_paid: 'amber',
  refund_due: 'red',
  refunded: 'gray',
}

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  pay_on_delivery: 'Pay on delivery',
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
}

export const APPROVAL_LABEL: Record<ApprovalStatus, string> = { approved: 'Approved', pending: 'Pending', suspended: 'Suspended' }
export const APPROVAL_TONE: Record<ApprovalStatus, ChipTone> = { approved: 'green', pending: 'amber', suspended: 'red' }

export const PAPERS_LABEL: Record<PapersState, string> = { valid: 'Papers valid', expiring: 'Expires soon', expired: 'Papers expired', missing: 'No papers yet' }
export const PAPERS_TONE: Record<PapersState, ChipTone> = { valid: 'blue', expiring: 'amber', expired: 'red', missing: 'red' }

/** "4 min ago", "1 h ago", "Yesterday", "12 Oct". */
export function timeAgo(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  if (hours < 48) return 'Yesterday'
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' }).format(new Date(iso))
}

/** "Proof review · 12 min ago": a hold's kind and age, under the status in the order list (admin-hold-review.md, R0). */
export function holdSummary(hold: AdminOrderHold): string {
  return `${HOLD_KIND_LABEL[hold.kind]} · ${timeAgo(hold.since)}`
}

/** Days until a Lagos calendar date (negative when past). */
export function daysUntil(isoDate: string, now = Date.now()): number {
  return Math.ceil((Date.parse(`${isoDate}T23:59:59+01:00`) - now) / 86_400_000)
}

/** The money pages share these tabs (a-pricing). Loyalty points stay hidden while out of the MVP (#156). */
export const MONEY_TABS = [
  { to: '/admin/pricing', label: 'Pricing' },
  ...(POINTS_ENABLED ? [{ to: '/admin/loyalty', label: 'Loyalty points' }] : []),
  { to: '/admin/payments', label: 'Payouts and payments' },
]

/** What the pricing forms edit: a price list without its version fields. */
export function editablePrices(p: SamplePriceTable): SamplePriceTableInput {
  return { keke: structuredClone(p.keke), tanker: structuredClone(p.tanker), delivery_fee: { ...p.delivery_fee }, points: { ...p.points } }
}

/** Id of the detail panel beside a list (orders, riders, customers, stations, support). */
export const DETAIL_PANEL_ID = 'admin-detail'

/**
 * On phones and tablets the detail panel sits below the list, so after
 * picking an item, scroll its details into view. On laptops and desktops
 * (1024 px and up) the panel is already beside the list and nothing moves.
 */
export function revealDetail(): void {
  if (typeof window === 'undefined' || !window.matchMedia?.('(max-width: 1023.98px)').matches) return
  // After React renders the newly selected item.
  window.setTimeout(() => document.getElementById(DETAIL_PANEL_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
}
