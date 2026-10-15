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
    <span className="inline-flex items-center gap-1 text-small text-success-700">
      <ShieldCheck aria-hidden className="size-4" />
      Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-small text-warning-800">
      <ShieldAlert aria-hidden className="size-4" />
      Unverified
    </span>
  )
}

/**
 * Orders as a table on tablets and desktops and as list rows on phones
 * (design-system.md "Table" and "List row"). Each row opens the order detail.
 */
export function OrderList({ orders }: OrderListProps) {
  const detailLink = useDetailLink()

  return (
    <>
      <div className="hidden overflow-x-auto tablet:block">
        <table className="w-full min-w-190 text-left text-small">
          <caption className="sr-only">Orders, newest first</caption>
          <thead className="border-b border-border bg-neutral-50 font-semibold text-text-primary">
            <tr>
              <th scope="col" className="h-12 px-4">Order</th>
              <th scope="col" className="h-12 px-4">Status</th>
              <th scope="col" className="h-12 px-4 text-right">Quantity</th>
              <th scope="col" className="h-12 px-4">Contact</th>
              <th scope="col" className="hidden h-12 px-4 desktop:table-cell">Delivery address</th>
              <th scope="col" className="h-12 px-4">Preferred date</th>
              <th scope="col" className="h-12 px-4"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {orders.map((order) => (
              // `relative` lets the reference link stretch over the whole row.
              <tr key={order.id} className="group relative transition-colors hover:bg-neutral-50">
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link
                      {...detailLink(order.reference)}
                      className="font-mono font-semibold text-primary-700 after:absolute after:inset-0 group-hover:underline"
                    >
                      {order.reference}
                    </Link>
                    {order.is_simulated && <SimulatedBadge />}
                  </div>
                  <time dateTime={order.created_at} className="mt-1 block text-caption text-text-secondary">
                    {formatLagosDateTime(order.created_at)}
                  </time>
                </td>
                <td className="px-4 py-3 align-top">
                  <OrderStatusBadge status={order.status} />
                </td>
                <td className="px-4 py-3 text-right align-top font-semibold tabular-nums">
                  {formatLitres(order.quantity_litres)}
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="font-semibold">{order.contact_name}</div>
                  <PhoneVerification verified={order.customer.phone_verified} />
                </td>
                <td className="hidden max-w-xs px-4 py-3 align-top desktop:table-cell">
                  <div className="truncate" title={order.delivery_address}>{order.delivery_address}</div>
                  {order.landmark && <div className="truncate text-caption text-text-secondary">{order.landmark}</div>}
                </td>
                <td className="px-4 py-3 align-top whitespace-nowrap">
                  {order.preferred_delivery_date ? (
                    formatCalendarDate(order.preferred_delivery_date)
                  ) : (
                    <span className="text-text-secondary">Not given</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right align-top">
                  <ChevronRight aria-hidden className="inline size-5 text-text-secondary group-hover:text-primary-700" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-neutral-200 tablet:hidden">
        {orders.map((order) => (
          <li key={order.id}>
            <Link
              {...detailLink(order.reference)}
              className="flex min-h-18 items-center gap-3 px-4 py-3 hover:bg-neutral-50 active:bg-neutral-100"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono font-semibold text-primary-700">{order.reference}</p>
                    <p className="mt-0.5 truncate font-semibold">{order.contact_name}</p>
                  </div>
                  <p className="shrink-0 font-semibold tabular-nums">{formatLitres(order.quantity_litres)}</p>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <OrderStatusBadge status={order.status} />
                  {order.is_simulated && <SimulatedBadge />}
                </div>
                <p className="mt-2 truncate text-small text-text-secondary">{order.delivery_address}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-text-secondary">
                  <PhoneVerification verified={order.customer.phone_verified} />
                  {order.preferred_delivery_date && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays aria-hidden className="size-4" />
                      Prefers {formatCalendarDate(order.preferred_delivery_date)}
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-text-secondary" />
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
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading orders…</span>
      <div className="divide-y divide-neutral-200">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex min-h-18 items-center gap-4 px-4 py-3">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="hidden h-7 w-28 rounded-full tablet:block" />
            <Skeleton className="h-5 w-14" />
          </div>
        ))}
      </div>
    </div>
  )
}
