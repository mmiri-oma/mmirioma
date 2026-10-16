import { Inbox, Plus } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { buttonClasses } from '../../../components/ui/buttonVariants'
import type { Session } from '../../../lib/api/auth'
import { cn } from '../../../lib/cn'
import { CustomerAccountNotices } from '../../auth/pages/HomePages'
import { CustomerLayout } from '../components/CustomerLayout'
import { OrderCard, OrderCardSkeleton } from '../components/OrderCard'
import { ORDER_TEXT, loadErrorText } from '../messages'
import { useCustomerOrderList } from '../useCustomerOrders'

/** Router state My orders understands. */
export interface MyOrdersLocationState {
  /**
   * Set after `POST /orders` returned 409 `idempotency_key_reused`: an earlier
   * send from the same form was stored (customer design Decision 9).
   */
  alreadyReceived?: boolean
}

function RequestWaterLink({ className }: { className?: string }) {
  return (
    <Link to="/request" className={cn(buttonClasses('primary', 'md'), className)}>
      <Plus aria-hidden className="size-5" />
      Request water
    </Link>
  )
}

/**
 * O1 Home / My orders: the customer's own orders, newest first, 20 at a
 * time with "Load more" (`GET /orders`).
 *
 * States: loading skeleton; empty; could not load (Retry); list; loading
 * more; load-more failed (the orders already shown stay). "Request water"
 * stays usable while the list loads or has failed, and is hidden only in the
 * empty state, where the empty card holds the one primary button.
 */
export function MyOrdersPage({ session }: { session: Session }) {
  const location = useLocation()
  const alreadyReceived =
    (location.state as MyOrdersLocationState | null)?.alreadyReceived === true
  const query = useCustomerOrderList(session.user.id)

  const orders = query.data?.pages.flatMap((page) => page.items) ?? []
  const total = query.data?.pages.at(-1)?.total ?? 0
  const loaded = query.data !== undefined
  const empty = loaded && total === 0

  return (
    <CustomerLayout user={session.user}>
      <CustomerAccountNotices user={session.user} />
      {alreadyReceived ? (
        <Alert tone="info">
          <p>{ORDER_TEXT.alreadyReceived}</p>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1">My orders</h1>
        {empty ? null : <RequestWaterLink />}
      </div>

      {query.isPending ? (
        <div role="status" aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">Loading your orders</span>
          <OrderCardSkeleton />
          <OrderCardSkeleton />
          <OrderCardSkeleton />
        </div>
      ) : query.isError && !loaded ? (
        <Alert
          tone="error"
          title={ORDER_TEXT.listFailed}
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        >
          <p>{loadErrorText(query.error)}</p>
        </Alert>
      ) : empty ? (
        <section className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-4 py-8 text-center shadow-xs">
          <span className="grid size-14 place-items-center rounded-full bg-primary-50 text-primary-700">
            <Inbox aria-hidden className="size-7" />
          </span>
          <h2 className="text-h2">{ORDER_TEXT.emptyTitle}</h2>
          <p className="max-w-sm text-text-secondary">{ORDER_TEXT.emptyBody}</p>
          <RequestWaterLink />
        </section>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {orders.map((order) => (
              <li key={order.reference}>
                <OrderCard order={order} />
              </li>
            ))}
          </ul>
          <div className="flex flex-col items-center gap-3">
            <p className="text-small text-text-secondary">
              Showing {orders.length} of {total} {total === 1 ? 'order' : 'orders'}
            </p>
            {query.isFetchNextPageError ? (
              <Alert
                tone="error"
                title={ORDER_TEXT.moreFailed}
                className="w-full"
                action={
                  <Button variant="secondary" onClick={() => void query.fetchNextPage()}>
                    Retry
                  </Button>
                }
              >
                <p>{loadErrorText(query.error)}</p>
              </Alert>
            ) : query.hasNextPage ? (
              <Button
                variant="secondary"
                loading={query.isFetchingNextPage}
                // Extra taps while loading are ignored (Button drops onClick).
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? 'Loading more' : 'Load more'}
              </Button>
            ) : null}
          </div>
        </>
      )}
    </CustomerLayout>
  )
}
