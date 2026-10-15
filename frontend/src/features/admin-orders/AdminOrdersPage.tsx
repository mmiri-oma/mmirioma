import { ClipboardList, LoaderCircle, RefreshCw, SearchX } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { StateMessage } from '../../components/ui/StateMessage'
import { ApiError } from '../../lib/api/client'
import { OrderFilters } from './OrderFilters'
import { OrderList, OrderListSkeleton } from './OrderList'
import { Pagination } from './Pagination'
import { ReferenceSearch } from './ReferenceSearch'
import { SimulatedDataNotice } from './SimulatedDataNotice'
import { useAdminOrderList } from './useAdminOrders'
import { useAdminOrdersSource } from './source'
import { PAGE_SIZE, useOrderFilters } from './useOrderFilters'

/**
 * Admin order directory (S1-09, FR-030): the dispatcher's queue of orders,
 * newest first, filterable by status and creation date.
 */
export function AdminOrdersPage() {
  const { isMock } = useAdminOrdersSource()
  const { filters, params, dateRangeInvalid, hasFilters, update, clear } = useOrderFilters()
  const query = useAdminOrderList(params)

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 tablet:flex-row tablet:items-end tablet:justify-between">
        <div>
          <h1 className="text-h1 text-text-primary">
            Orders
            {query.data && !query.isPlaceholderData && (
              <span className="font-normal text-text-secondary"> · {query.data.total}</span>
            )}
          </h1>
          <p className="mt-1 text-text-secondary">Every customer request, newest first. Times are Lagos time.</p>
        </div>
        <ReferenceSearch />
      </header>

      {isMock && <SimulatedDataNotice />}

      <Card>
        <div className="border-b border-neutral-200 p-4">
          <OrderFilters
            filters={filters}
            dateRangeInvalid={dateRangeInvalid}
            hasFilters={hasFilters}
            onChange={update}
            onClear={clear}
          />
        </div>

        <div className="relative">
          {query.isFetching && !query.isPending && (
            <span role="status" className="absolute top-2 right-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-caption text-text-secondary shadow-md">
              <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />
              Updating…
            </span>
          )}
          <ListBody
            query={query}
            hasFilters={hasFilters}
            dateRangeInvalid={dateRangeInvalid}
            onClear={clear}
            onFirstPage={() => update({ page: 1 })}
          />
        </div>

        {query.data && (
          <Pagination page={filters.page} pageSize={PAGE_SIZE} total={query.data.total} onPageChange={(page) => update({ page })} />
        )}
      </Card>
    </div>
  )
}

interface ListBodyProps {
  query: ReturnType<typeof useAdminOrderList>
  hasFilters: boolean
  dateRangeInvalid: boolean
  onClear: () => void
  onFirstPage: () => void
}

function ListBody({ query, hasFilters, dateRangeInvalid, onClear, onFirstPage }: ListBodyProps) {
  if (dateRangeInvalid) {
    return <StateMessage icon={SearchX} title="Fix the date range to see orders" />
  }
  if (query.isPending) return <OrderListSkeleton />
  if (query.isError) {
    const message = query.error instanceof ApiError ? query.error.message : 'Something went wrong loading orders.'
    return (
      <StateMessage
        tone="error"
        icon={RefreshCw}
        title="Orders could not be loaded"
        description={message}
        action={
          <Button variant="secondary" onClick={() => query.refetch()} loading={query.isFetching}>
            {!query.isFetching && <RefreshCw aria-hidden className="size-5" />}
            Retry
          </Button>
        }
      />
    )
  }

  const { items, total } = query.data
  if (items.length === 0 && total > 0) {
    // A stale or hand-edited `page` beyond the last page.
    return (
      <StateMessage
        icon={ClipboardList}
        title="This page has no orders"
        action={<Button variant="secondary" onClick={onFirstPage}>Go to first page</Button>}
      />
    )
  }
  if (items.length === 0) {
    return hasFilters ? (
      <StateMessage
        icon={SearchX}
        title="No orders match these filters"
        description="Try another status or a wider date range."
        action={<Button variant="secondary" onClick={onClear}>Clear filters</Button>}
      />
    ) : (
      <StateMessage
        icon={ClipboardList}
        title="No orders yet"
        description="New customer requests will appear here as soon as they are submitted."
      />
    )
  }

  return (
    <div className={query.isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      <OrderList orders={items} />
    </div>
  )
}
