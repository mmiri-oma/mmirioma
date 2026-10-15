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
  TriangleAlert,
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
      <ArrowLeft aria-hidden className="size-5" />
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
                  No order has the reference <span className="font-mono font-semibold text-text-primary">{reference}</span>.
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
                <Button variant="secondary" onClick={() => query.refetch()} loading={query.isFetching}>
                  {!query.isFetching && <RefreshCw aria-hidden className="size-5" />}
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

      <header className="flex flex-col gap-4 tablet:flex-row tablet:items-start tablet:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-h1 text-text-primary">{order.reference}</h1>
            <CopyButton text={order.reference} />
          </div>
          <p className="mt-1 text-small text-text-secondary">
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

      <div className="grid gap-5 desktop:grid-cols-3">
        <div className="space-y-5 desktop:col-span-2">
          <DeliveryCard order={order} />
          <Card title="Price">
            <div className="flex items-start gap-3 p-4">
              <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-info-600" />
              {/* No invented prices: Sprint 1 orders are manual quote requests (FR-021, FR-022). */}
              <p className="text-text-secondary">
                <span className="font-semibold text-text-primary">No price yet.</span> This is a quote request. A price is set
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
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-text-secondary" />
      <div className="min-w-0">
        <dt className="text-small text-text-secondary">{label}</dt>
        <dd className="mt-0.5 font-semibold wrap-break-word text-text-primary">{children}</dd>
      </div>
    </div>
  )
}

function DeliveryCard({ order }: { order: AdminOrderRead }) {
  return (
    <Card title="Delivery">
      <div className="grid gap-5 p-4 tablet:grid-cols-[auto_1fr]">
        <div className="self-start rounded-box border border-primary-200 bg-primary-50 px-5 py-4 text-primary-800 tablet:min-w-40">
          <p className="text-small font-semibold">Quantity</p>
          <p className="mt-1 text-h2 font-bold tabular-nums">{formatLitres(order.quantity_litres)}</p>
        </div>
        <dl className="space-y-4">
          <Detail icon={MapPin} label="Address">
            {order.delivery_address}
            {order.landmark && <span className="block font-normal text-text-secondary">Landmark: {order.landmark}</span>}
          </Detail>
          <Detail icon={NotebookPen} label="Instructions">
            {order.delivery_instructions ?? <span className="font-normal text-text-secondary">None given</span>}
          </Detail>
          <Detail icon={CalendarDays} label="Preferred date">
            {order.preferred_delivery_date ? (
              <>
                {formatCalendarDate(order.preferred_delivery_date)}
                {/* Slots (FR-025) do not exist yet; this is only the customer's wish. */}
                <span className="block text-small font-normal text-text-secondary">Customer preference, not a booked slot.</span>
              </>
            ) : (
              <span className="font-normal text-text-secondary">Not given</span>
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
      <dl className="space-y-4 p-4">
        <div>
          <dt className="text-small text-text-secondary">Account holder</dt>
          <dd className="mt-0.5 font-semibold text-text-primary">{customer.name}</dd>
          <dd>
            <a href={`tel:${customer.phone}`} className="inline-flex min-h-touch items-center gap-1.5 font-semibold text-primary-700 underline-offset-2 hover:underline">
              <Phone aria-hidden className="size-4" />
              {customer.phone}
            </a>
          </dd>
        </div>
        {receiverDiffers && (
          <div>
            <dt className="text-small text-text-secondary">Receiving the delivery</dt>
            <dd className="mt-0.5 font-semibold text-text-primary">{order.contact_name}</dd>
            <dd>
              <a href={`tel:${order.contact_phone}`} className="inline-flex min-h-touch items-center gap-1.5 font-semibold text-primary-700 underline-offset-2 hover:underline">
                <Phone aria-hidden className="size-4" />
                {order.contact_phone}
              </a>
            </dd>
          </div>
        )}
        {!customer.phone_verified && (
          // FR-003: contact must be verified before a real order is confirmed.
          <p className="flex items-start gap-2 rounded-box border border-warning-200 bg-warning-50 px-3 py-2.5 text-small text-warning-800">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-700" />
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
      <div className="p-4">
        {offPath || order.status === 'disputed' ? (
          <p className="mb-4 rounded-box border border-border bg-neutral-50 px-3 py-2.5 text-small text-text-primary">
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
                    <span aria-hidden className={cn('absolute top-6 left-2.75 h-[calc(100%-1.25rem)] w-0.5', state === 'done' ? 'bg-primary' : 'bg-border')} />
                  )}
                  <span
                    aria-hidden
                    className={cn(
                      'relative grid size-6 shrink-0 place-items-center rounded-full border-2',
                      state === 'done' && 'border-primary bg-primary text-text-inverse',
                      state === 'current' && 'border-primary bg-surface ring-4 ring-primary-100',
                      state === 'upcoming' && 'border-border-strong bg-surface',
                    )}
                  >
                    {state === 'done' && <Check className="size-4" strokeWidth={3} />}
                    {state === 'current' && <span className="size-2 rounded-full bg-primary" />}
                  </span>
                  <span className={cn('pt-0.5 text-small', state === 'upcoming' ? 'text-text-secondary' : 'font-semibold text-text-primary', state === 'current' && 'font-bold')}>
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
      variant="icon"
      aria-label={copied ? 'Reference copied' : 'Copy reference'}
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => setCopied(true), () => setCopied(false))
      }}
    >
      {copied ? <Check aria-hidden className="size-5 text-success-600" /> : <Copy aria-hidden className="size-5" />}
    </Button>
  )
}

function DetailSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-5">
      <span className="sr-only">Loading order…</span>
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-5 desktop:grid-cols-3">
        <Skeleton className="h-56 desktop:col-span-2" />
        <Skeleton className="h-56" />
      </div>
    </div>
  )
}
