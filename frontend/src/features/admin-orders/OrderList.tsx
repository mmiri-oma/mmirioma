import { CalendarDays, ChevronRight, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { Skeleton } from '../../components/ui/Skeleton'
import type { AdminOrderRead } from '../../lib/api/adminOrders'
import { formatCalendarDate, formatLagosDateTime, formatLitres } from '../../lib/format'
import { OrderStatusBadge, SimulatedBadge } from './OrderStatusBadge'

interface OrderListProps {
  orders: AdminOrderRead[]
}

/**
 * Props for a link to an order's detail page. The directory's query string
 * travels in router state, so "Back to orders" restores the same filters.
 */
function useDetailLink() {
  const { search } = useLocation()
  return (reference: string) => ({ to: `/admin/orders/${reference}`, state: { fromSearch: search } })
}

function PhoneVerification({ verified }: { verified: boolean }) {
  // Icon plus text: verification must not be conveyed by colour alone (NFR-021).
  return verified ? (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
      <ShieldCheck aria-hidden className="size-3.5" />
      Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-amber-700">
      <ShieldAlert aria-hidden className="size-3.5" />
      Unverified
    </span>
  )
}

/**
 * Orders as a table on tablets and desktops and as stacked cards on phones.
 * Each row or card opens the order detail.
 */
export function OrderList({ orders }: OrderListProps) {
  const detailLink = useDetailLink()

  return (
    <>
      <div className="hidden md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Orders, newest first</caption>
          <thead className="border-b border-line bg-canvas/60 text-xs font-semibold tracking-wide text-ink-muted uppercase">
            <tr>
              <th scope="col" className="px-5 py-3">Order</th>
              <th scope="col" className="px-3 py-3">Status</th>
              <th scope="col" className="px-3 py-3 text-right">Quantity</th>
              <th scope="col" className="px-3 py-3">Contact</th>
              <th scope="col" className="hidden px-3 py-3 xl:table-cell">Delivery address</th>
              <th scope="col" className="px-3 py-3">Preferred date</th>
              <th scope="col" className="px-5 py-3"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {orders.map((order) => (
              // `relative` lets the reference link stretch over the whole row.
              <tr key={order.id} className="group relative transition-colors hover:bg-brand-50/50">
                <td className="px-5 py-3.5 align-top">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link
                      {...detailLink(order.reference)}
                      className="font-mono text-[0.8125rem] font-semibold text-brand-700 after:absolute after:inset-0 group-hover:underline"
                    >
                      {order.reference}
                    </Link>
                    {order.is_simulated && <SimulatedBadge />}
                  </div>
                  <time dateTime={order.created_at} className="mt-1 block text-xs text-ink-muted">
                    {formatLagosDateTime(order.created_at)}
                  </time>
                </td>
                <td className="px-3 py-3.5 align-top">
                  <OrderStatusBadge status={order.status} />
                </td>
                <td className="px-3 py-3.5 text-right align-top font-semibold tabular-nums">
                  {formatLitres(order.quantity_litres)}
                </td>
                <td className="px-3 py-3.5 align-top">
                  <div className="font-medium">{order.contact_name}</div>
                  <PhoneVerification verified={order.customer.phone_verified} />
                </td>
                <td className="hidden max-w-xs px-3 py-3.5 align-top xl:table-cell">
                  <div className="truncate" title={order.delivery_address}>{order.delivery_address}</div>
                  {order.landmark && <div className="truncate text-xs text-ink-muted">{order.landmark}</div>}
                </td>
                <td className="px-3 py-3.5 align-top whitespace-nowrap">
                  {order.preferred_delivery_date ? (
                    formatCalendarDate(order.preferred_delivery_date)
                  ) : (
                    <span className="text-ink-muted">Not given</span>
                  )}
                </td>
                <td className="px-5 py-3.5 text-right align-top">
                  <ChevronRight aria-hidden className="inline size-4 text-ink-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line md:hidden">
        {orders.map((order) => (
          <li key={order.id}>
            <Link {...detailLink(order.reference)} className="block px-4 py-4 active:bg-brand-50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[0.8125rem] font-semibold text-brand-700">{order.reference}</p>
                  <p className="mt-0.5 truncate font-medium">{order.contact_name}</p>
                </div>
                <p className="shrink-0 text-base font-semibold tabular-nums">{formatLitres(order.quantity_litres)}</p>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <OrderStatusBadge status={order.status} />
                {order.is_simulated && <SimulatedBadge />}
              </div>
              <p className="mt-2 truncate text-sm text-ink-muted">{order.delivery_address}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
                <PhoneVerification verified={order.customer.phone_verified} />
                {order.preferred_delivery_date && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays aria-hidden className="size-3.5" />
                    Prefers {formatCalendarDate(order.preferred_delivery_date)}
                  </span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}

/** Loading placeholder shaped like the list, so the layout does not jump. */
export function OrderListSkeleton() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading orders…</span>
      <div className="divide-y divide-line">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex items-center gap-4 px-4 py-4 md:px-5">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="hidden h-6 w-28 rounded-full md:block" />
            <Skeleton className="h-5 w-14" />
          </div>
        ))}
      </div>
    </div>
  )
}
