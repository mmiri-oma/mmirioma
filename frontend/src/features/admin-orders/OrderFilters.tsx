import { Check, CircleAlert, X } from 'lucide-react'
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
 * The design system's filter bar uses a "Status" multi-select panel; whether
 * the admin directory adopts it is for the admin design (S1-08) to decide, so
 * the status toggles stay until then, restyled to the system's tokens.
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
        <legend className="mb-2 font-semibold text-text-primary">Status</legend>
        {/* One scrollable row on phones, wrapping on wider screens. */}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 tablet:mx-0 tablet:flex-wrap tablet:overflow-visible tablet:px-0">
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
                  // 48 px touch target (NFR-020); selected adds a tick so it is clear without colour.
                  'inline-flex min-h-touch shrink-0 items-center gap-1.5 rounded-full border-2 px-4 text-small font-semibold transition-colors',
                  selected
                    ? 'border-primary bg-primary-50 text-primary-800'
                    : 'border-border bg-surface text-text-primary hover:border-neutral-800 hover:bg-neutral-50',
                )}
              >
                <Icon aria-hidden className="size-4" />
                {meta.label}
                {selected && <Check aria-hidden className="size-4" />}
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full min-[420px]:w-auto">
          <label htmlFor="created-from" className="mb-1.5 block font-semibold text-text-primary">
            Created from
          </label>
          <Input
            id="created-from"
            type="date"
            value={filters.createdFrom}
            invalid={dateRangeInvalid}
            aria-describedby={dateRangeInvalid ? 'date-range-error' : undefined}
            onChange={(event) => onChange({ createdFrom: event.target.value })}
            className="min-[420px]:w-45"
          />
        </div>
        <div className="w-full min-[420px]:w-auto">
          <label htmlFor="created-to" className="mb-1.5 block font-semibold text-text-primary">
            Created to
          </label>
          <Input
            id="created-to"
            type="date"
            value={filters.createdTo}
            invalid={dateRangeInvalid}
            aria-describedby={dateRangeInvalid ? 'date-range-error' : undefined}
            onChange={(event) => onChange({ createdTo: event.target.value })}
            className="min-[420px]:w-45"
          />
        </div>
        {hasFilters && (
          <Button variant="ghost" onClick={onClear}>
            <X aria-hidden className="size-5" />
            Clear filters
          </Button>
        )}
      </div>

      {dateRangeInvalid && (
        <p id="date-range-error" role="alert" className="flex items-center gap-1.5 text-small font-semibold text-danger-700">
          <CircleAlert aria-hidden className="size-4" />
          “Created from” must be on or before “Created to”.
        </p>
      )}
    </div>
  )
}
