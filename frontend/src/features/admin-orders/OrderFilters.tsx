import { CircleAlert, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { cn } from '../../lib/cn'
import type { OrderStatus } from '../../lib/api/adminOrders'
import { ORDER_STATUS_META, ORDER_STATUSES } from './orderStatus'
import type { OrderFilters as Filters } from './useOrderFilters'

interface OrderFiltersProps {
  filters: Filters
  dateRangeInvalid: boolean
  hasFilters: boolean
  onChange: (changes: Partial<Filters>) => void
  onClear: () => void
}

/**
 * Status and creation-date filters for the dispatcher queue (FR-030).
 *
 * Zone filtering is not offered yet: orders have no service zone until FR-010
 * lands (docs/api/orders.md "Planned").
 */
export function OrderFilters({ filters, dateRangeInvalid, hasFilters, onChange, onClear }: OrderFiltersProps) {
  const toggleStatus = (status: OrderStatus) => {
    const selected = filters.statuses.includes(status)
    onChange({
      statuses: selected ? filters.statuses.filter((s) => s !== status) : [...filters.statuses, status],
    })
  }

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">Status</legend>
        {/* One scrollable row on phones, wrapping on wider screens. */}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {ORDER_STATUSES.map((status) => {
            const meta = ORDER_STATUS_META[status]
            const selected = filters.statuses.includes(status)
            const Icon = meta.icon
            return (
              <button
                key={status}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleStatus(status)}
                className={cn(
                  'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors',
                  selected
                    ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
                    : 'border-line bg-surface text-ink-muted hover:border-brand-300 hover:text-ink',
                )}
              >
                <Icon aria-hidden className="size-3.5" />
                {meta.label}
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full min-[420px]:w-auto">
          <label htmlFor="created-from" className="mb-1 block text-xs font-semibold text-ink-muted">
            Created from
          </label>
          <Input
            id="created-from"
            type="date"
            value={filters.createdFrom}
            invalid={dateRangeInvalid}
            aria-describedby={dateRangeInvalid ? 'date-range-error' : undefined}
            onChange={(event) => onChange({ createdFrom: event.target.value })}
            className="min-[420px]:w-44"
          />
        </div>
        <div className="w-full min-[420px]:w-auto">
          <label htmlFor="created-to" className="mb-1 block text-xs font-semibold text-ink-muted">
            Created to
          </label>
          <Input
            id="created-to"
            type="date"
            value={filters.createdTo}
            invalid={dateRangeInvalid}
            aria-describedby={dateRangeInvalid ? 'date-range-error' : undefined}
            onChange={(event) => onChange({ createdTo: event.target.value })}
            className="min-[420px]:w-44"
          />
        </div>
        {hasFilters && (
          <Button variant="ghost" onClick={onClear}>
            <X aria-hidden className="size-4" />
            Clear filters
          </Button>
        )}
      </div>

      {dateRangeInvalid && (
        <p id="date-range-error" role="alert" className="flex items-center gap-1.5 text-sm text-rose-700">
          <CircleAlert aria-hidden className="size-4" />
          “Created from” must be on or before “Created to”.
        </p>
      )}
    </div>
  )
}
