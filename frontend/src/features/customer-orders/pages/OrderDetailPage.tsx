import { SearchX } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { buttonClasses } from '../../../components/ui/buttonVariants'
import { Skeleton } from '../../../components/ui/Skeleton'
import { StateMessage } from '../../../components/ui/StateMessage'
import type { Session } from '../../../lib/api/auth'
import { ApiError } from '../../../lib/api/client'
import type { OrderRead } from '../../../lib/api/orders'
import { formatCalendarDate, formatLagosDateTime, formatLitres } from '../../../lib/format'
import { formatPhoneForDisplay } from '../../auth/phone'
import { BackToOrders } from '../components/BackToOrders'
import { CustomerLayout } from '../components/CustomerLayout'
import { CustomerStatusBadge } from '../components/CustomerStatusBadge'
import { SummaryList } from '../components/SummaryList'
import { CUSTOMER_STATUS_META } from '../customerStatus'
import { ORDER_TEXT, loadErrorText } from '../messages'
import { useCustomerOrder } from '../useCustomerOrders'

/**
 * O4 Order detail (`GET /orders/{reference}`).
 *
 * States: loading skeleton; order not found (404 `order_not_found`, the same
 * screen for an unknown reference and another customer's order, so
 * references cannot be probed: FR-001, T-07); could not load (Retry);
 * loaded. There is no cancel or edit button: who may cancel is undecided
 * (orders contract open question 1), so the screen gives contact guidance.
 */
export function OrderDetailPage({ session }: { session: Session }) {
  const { reference = '' } = useParams()
  const query = useCustomerOrder(session.user.id, reference)
  const notFound = query.error instanceof ApiError && query.error.code === 'order_not_found'

  return (
    <CustomerLayout user={session.user}>
      <BackToOrders />
      {query.isPending ? (
        <DetailSkeleton />
      ) : notFound ? (
        <section className="rounded-lg border border-border bg-surface shadow-xs">
          <StateMessage
            icon={SearchX}
            title={ORDER_TEXT.notFoundTitle}
            description={ORDER_TEXT.notFoundBody}
            action={
              <Link to="/" className={buttonClasses('primary')}>
                Go to my orders
              </Link>
            }
          />
        </section>
      ) : query.isError ? (
        <>
          <h1 className="text-h1">Order</h1>
          <Alert
            tone="error"
            title={ORDER_TEXT.orderFailed}
            action={
              <Button variant="secondary" onClick={() => void query.refetch()}>
                Retry
              </Button>
            }
          >
            <p>{loadErrorText(query.error)}</p>
          </Alert>
        </>
      ) : (
        <OrderDetail order={query.data} />
      )}
    </CustomerLayout>
  )
}

function OrderDetail({ order }: { order: OrderRead }) {
  const status = CUSTOMER_STATUS_META[order.status]
  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="text-small text-text-secondary">Order</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-h2 font-semibold">{order.reference}</h1>
          {/* From tablet width the badge sits next to the reference (O4-f). */}
          <span className="hidden tablet:inline-flex">
            <CustomerStatusBadge status={order.status} />
          </span>
        </div>
        <p className="text-small text-text-secondary">
          Sent {formatLagosDateTime(order.created_at)}
        </p>
      </div>

      <section
        aria-label="Status"
        className="flex flex-col gap-2 rounded-box border border-border bg-surface p-4"
      >
        <div className="tablet:hidden">
          <CustomerStatusBadge status={order.status} />
        </div>
        <p>{status.explanation}</p>
        <p className="text-small text-text-secondary">
          Last updated {formatLagosDateTime(order.updated_at)}
        </p>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-xs tablet:p-6">
        <h2 className="text-h3 tablet:sr-only">Request</h2>
        <SummaryList
          items={[
            { label: 'Quantity', value: formatLitres(order.quantity_litres) },
            {
              label: 'Preferred delivery date',
              value: order.preferred_delivery_date
                ? `${formatCalendarDate(order.preferred_delivery_date)} (a preference, not a booked time)`
                : null,
            },
          ]}
        />
        <h2 className="border-t border-border pt-4 text-h3 tablet:sr-only">Delivery</h2>
        <SummaryList
          items={[
            {
              label: 'Receiver',
              value: (
                <>
                  <span className="block tablet:inline">
                    {order.contact_name}
                    <span className="hidden tablet:inline">, </span>
                  </span>
                  <span className="block tablet:inline">
                    {formatPhoneForDisplay(order.contact_phone)}
                  </span>
                </>
              ),
            },
            { label: 'Delivery address', value: order.delivery_address },
            { label: 'Landmark', value: order.landmark },
            { label: 'Delivery instructions', value: order.delivery_instructions },
          ]}
        />
      </section>

      <p className="text-text-secondary">{ORDER_TEXT.changeOrCancel}</p>
    </>
  )
}

/** Skeleton in the shape of the loaded screen (O4-c), announced as "Loading order". */
function DetailSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">Loading order</span>
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-28 w-full rounded-box" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  )
}
