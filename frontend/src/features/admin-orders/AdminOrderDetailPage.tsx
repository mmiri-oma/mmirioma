import {
  ArrowLeft,
  CalendarDays,
  Check,
  Copy,
  Info,
  MapPin,
  NotebookPen,
  Phone,
  RefreshCw,
  SearchX,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { buttonClasses } from '../../components/ui/buttonVariants'
import { Card } from '../../components/ui/Card'
import { Skeleton } from '../../components/ui/Skeleton'
import { StateMessage } from '../../components/ui/StateMessage'
import { cn } from '../../lib/cn'
import type { AdminOrderRead } from '../../lib/api/adminOrders'
import { ApiError } from '../../lib/api/client'
import { formatCalendarDate, formatLagosDateTime, formatLitres } from '../../lib/format'
import { OrderStatusBadge, SimulatedBadge } from './OrderStatusBadge'
import { ORDER_STATUS_META, ORDINARY_PROGRESSION } from './orderStatus'
import { SimulatedDataNotice } from './SimulatedDataNotice'
import { useAdminOrder } from './useAdminOrders'
import { useAdminOrdersSource } from './source'

/**
 * Read-only admin view of one order (S1-09, FR-030). Dispatch actions
 * (confirm, assign, cancel) arrive with their APIs in later issues.
 */
export function AdminOrderDetailPage() {
  const { reference = '' } = useParams()
  const location = useLocation()
  const { isMock } = useAdminOrdersSource()
  const query = useAdminOrder(reference)

  // Return to the directory with the filters the dispatcher came from.
  const fromSearch = (location.state as { fromSearch?: string } | null)?.fromSearch ?? ''
  const backLink = (
    <Link to={`/admin/orders${fromSearch}`} className={cn(buttonClasses('ghost', 'sm'), '-ml-3')}>
      <ArrowLeft aria-hidden className="size-4" />
      Back to orders
    </Link>
  )

  if (query.isPending) {
    return (
      <div className="space-y-5">
        {backLink}
        <DetailSkeleton />
      </div>
    )
  }

  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.code === 'order_not_found'
    return (
      <div className="space-y-5">
        {backLink}
        <Card>
          {notFound ? (
            <StateMessage
              icon={SearchX}
              title="Order not found"
              description={
                <>
                  No order has the reference <span className="font-mono font-semibold text-ink">{reference}</span>.
                  Check it with the customer and try again.
                </>
              }
            />
          ) : (
            <StateMessage
              tone="error"
              icon={RefreshCw}
              title="This order could not be loaded"
              description={query.error instanceof ApiError ? query.error.message : 'Something went wrong.'}
              action={
                <Button variant="secondary" onClick={() => query.refetch()} disabled={query.isFetching}>
                  <RefreshCw aria-hidden className="size-4" />
                  Try again
                </Button>
              }
            />
          )}
        </Card>
      </div>
    )
  }

  const order = query.data
  return (
    <div className="space-y-5">
      {backLink}
      {isMock && <SimulatedDataNotice />}

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{order.reference}</h1>
            <CopyButton text={order.reference} />
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            Created <time dateTime={order.created_at}>{formatLagosDateTime(order.created_at)}</time>
            {order.updated_at !== order.created_at && (
              <> · Updated <time dateTime={order.updated_at}>{formatLagosDateTime(order.updated_at)}</time></>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <OrderStatusBadge status={order.status} />
          {order.is_simulated && <SimulatedBadge />}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <DeliveryCard order={order} />
          <Card title="Price">
            <div className="flex items-start gap-3 px-5 py-4 text-sm">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-600" />
              {/* No invented prices: Sprint 1 orders are manual quote requests (FR-021, FR-022). */}
              <p className="text-ink-muted">
                <span className="font-medium text-ink">No price yet.</span> This is a quote request. A price is set
                once pricing rules are agreed.
              </p>
            </div>
          </Card>
        </div>
        <div className="space-y-5">
          <CustomerCard order={order} />
          <LifecycleCard order={order} />
        </div>
      </div>
    </div>
  )
}

function Detail({ icon: Icon, label, children }: { icon: typeof MapPin; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-muted" />
      <div className="min-w-0">
        <dt className="text-xs font-semibold text-ink-muted">{label}</dt>
        <dd className="mt-0.5 text-sm wrap-break-word text-ink">{children}</dd>
      </div>
    </div>
  )
}

function DeliveryCard({ order }: { order: AdminOrderRead }) {
  return (
    <Card title="Delivery">
      <div className="grid gap-5 p-5 sm:grid-cols-[auto_1fr]">
        <div className="self-start rounded-xl bg-linear-to-br from-brand-500 to-brand-700 px-6 py-5 text-white shadow-sm sm:min-w-40">
          <p className="text-xs font-medium tracking-wide text-brand-100 uppercase">Quantity</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{formatLitres(order.quantity_litres)}</p>
        </div>
        <dl className="space-y-4">
          <Detail icon={MapPin} label="Address">
            {order.delivery_address}
            {order.landmark && <span className="block text-ink-muted">Landmark: {order.landmark}</span>}
          </Detail>
          <Detail icon={NotebookPen} label="Instructions">
            {order.delivery_instructions ?? <span className="text-ink-muted">None given</span>}
          </Detail>
          <Detail icon={CalendarDays} label="Preferred date">
            {order.preferred_delivery_date ? (
              <>
                {formatCalendarDate(order.preferred_delivery_date)}
                {/* Slots (FR-025) do not exist yet; this is only the customer's wish. */}
                <span className="block text-xs text-ink-muted">Customer preference, not a booked slot.</span>
              </>
            ) : (
              <span className="text-ink-muted">Not given</span>
            )}
          </Detail>
        </dl>
      </div>
    </Card>
  )
}

function CustomerCard({ order }: { order: AdminOrderRead }) {
  const { customer } = order
  const receiverDiffers = order.contact_name !== customer.name || order.contact_phone !== customer.phone
  return (
    <Card
      title="Customer"
      aside={
        customer.phone_verified ? (
          <Badge tone="success" icon={ShieldCheck}>Phone verified</Badge>
        ) : (
          <Badge tone="warning" icon={ShieldAlert}>Phone unverified</Badge>
        )
      }
    >
      <dl className="space-y-4 p-5">
        <div>
          <dt className="text-xs font-semibold text-ink-muted">Account holder</dt>
          <dd className="mt-0.5 font-medium text-ink">{customer.name}</dd>
          <dd>
            <a href={`tel:${customer.phone}`} className="inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline">
              <Phone aria-hidden className="size-3.5" />
              {customer.phone}
            </a>
          </dd>
        </div>
        {receiverDiffers && (
          <div>
            <dt className="text-xs font-semibold text-ink-muted">Receiving the delivery</dt>
            <dd className="mt-0.5 font-medium text-ink">{order.contact_name}</dd>
            <dd>
              <a href={`tel:${order.contact_phone}`} className="inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline">
                <Phone aria-hidden className="size-3.5" />
                {order.contact_phone}
              </a>
            </dd>
          </div>
        )}
        {!customer.phone_verified && (
          // FR-003: contact must be verified before a real order is confirmed.
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            The phone must be verified before this order can be confirmed.
          </p>
        )}
      </dl>
    </Card>
  )
}

/**
 * Where the current status sits in the FR-033 progression. Derived from the
 * status alone: there is no event history endpoint yet, so steps show no times.
 */
function LifecycleCard({ order }: { order: AdminOrderRead }) {
  const offPath = order.status === 'cancelled' || order.status === 'failed'
  // A dispute is raised after delivery, so the whole progression was completed.
  const currentIndex = order.status === 'disputed' ? ORDINARY_PROGRESSION.length : ORDINARY_PROGRESSION.indexOf(order.status)

  return (
    <Card title="Lifecycle">
      <div className="p-5">
        {offPath || order.status === 'disputed' ? (
          <p className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-ink">
            <span className="font-semibold">{ORDER_STATUS_META[order.status].label}.</span>{' '}
            {ORDER_STATUS_META[order.status].description}
          </p>
        ) : null}
        {!offPath && (
          <ol className="space-y-0">
            {ORDINARY_PROGRESSION.map((status, index) => {
              const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming'
              const isLast = index === ORDINARY_PROGRESSION.length - 1
              return (
                <li key={status} aria-current={state === 'current' ? 'step' : undefined} className="relative flex gap-3 pb-4 last:pb-0">
                  {!isLast && (
                    <span aria-hidden className={cn('absolute top-6 left-2.75 h-[calc(100%-1.25rem)] w-px', state === 'done' ? 'bg-brand-500' : 'bg-line')} />
                  )}
                  <span
                    aria-hidden
                    className={cn(
                      'relative grid size-6 shrink-0 place-items-center rounded-full border-2',
                      state === 'done' && 'border-brand-500 bg-brand-500 text-white',
                      state === 'current' && 'border-brand-500 bg-surface ring-4 ring-brand-100',
                      state === 'upcoming' && 'border-line bg-surface',
                    )}
                  >
                    {state === 'done' && <Check className="size-3.5" strokeWidth={3} />}
                    {state === 'current' && <span className="size-2 rounded-full bg-brand-500" />}
                  </span>
                  <span className={cn('pt-0.5 text-sm', state === 'upcoming' ? 'text-ink-muted' : 'font-medium text-ink')}>
                    {ORDER_STATUS_META[status].label}
                    <span className="sr-only">
                      {state === 'done' ? ' (completed)' : state === 'current' ? ' (current)' : ' (not reached)'}
                    </span>
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </Card>
  )
}

/** Copies text to the clipboard and briefly confirms. Hidden if the Clipboard API is unavailable. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  // Reset the "Copied" confirmation after 2 s; the timer is cleared if the
  // button unmounts or is pressed again first.
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  if (typeof navigator === 'undefined' || !navigator.clipboard) return null

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={copied ? 'Reference copied' : 'Copy reference'}
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => setCopied(true), () => setCopied(false))
      }}
    >
      {copied ? <Check aria-hidden className="size-4 text-emerald-600" /> : <Copy aria-hidden className="size-4" />}
    </Button>
  )
}

function DetailSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-5">
      <span className="sr-only">Loading order…</span>
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-5 lg:grid-cols-3">
        <Skeleton className="h-56 lg:col-span-2" />
        <Skeleton className="h-56" />
      </div>
    </div>
  )
}
