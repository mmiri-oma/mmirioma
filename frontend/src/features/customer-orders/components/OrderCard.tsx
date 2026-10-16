import { Link } from 'react-router-dom'
import { Skeleton } from '../../../components/ui/Skeleton'
import type { OrderRead } from '../../../lib/api/orders'
import { formatCalendarDate, formatLagosDateTime, formatLitres } from '../../../lib/format'
import { CustomerStatusBadge } from './CustomerStatusBadge'

/**
 * Order card on My orders (O1): reference, status badge, quantity, address on
 * one truncated line, the preferred date only when given, and when it was
 * sent in Lagos time. The whole card is one link to the order detail (O4).
 * From tablet width the badge and dates move to the right.
 */
export function OrderCard({ order }: { order: OrderRead }) {
  return (
    <Link
      to={`/orders/${order.reference}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-text-primary shadow-xs hover:bg-primary-50 tablet:flex-row tablet:justify-between tablet:gap-6"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 tablet:block">
          <span className="font-mono text-[0.9375rem]/[1.375rem] font-semibold">
            {order.reference}
          </span>
          <span className="tablet:hidden">
            <CustomerStatusBadge status={order.status} />
          </span>
        </div>
        <span className="text-h3 font-bold">{formatLitres(order.quantity_litres)}</span>
        <span className="truncate text-small text-text-secondary">{order.delivery_address}</span>
      </div>
      <div className="flex flex-col gap-1 text-small text-text-secondary tablet:shrink-0 tablet:items-end tablet:text-right">
        <span className="hidden tablet:mb-1 tablet:block">
          <CustomerStatusBadge status={order.status} />
        </span>
        {order.preferred_delivery_date ? (
          <span>Preferred date: {formatCalendarDate(order.preferred_delivery_date)}</span>
        ) : null}
        <span>Sent {formatLagosDateTime(order.created_at)}</span>
      </div>
    </Link>
  )
}

/** Skeleton shaped like an order card (O1-a). Hidden from screen readers. */
export function OrderCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex justify-between gap-3">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-7 w-32 rounded-full" />
      </div>
      <Skeleton className="h-6 w-24" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-48" />
    </div>
  )
}
