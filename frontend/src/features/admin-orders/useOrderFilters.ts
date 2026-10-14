import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { AdminOrderListParams, OrderStatus } from '../../lib/api/adminOrders'
import { isOrderStatus } from './orderStatus'

export const PAGE_SIZE = 10

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export interface OrderFilters {
  statuses: OrderStatus[]
  createdFrom: string
  createdTo: string
  /** 1-based. */
  page: number
}

/**
 * Directory filters stored in the URL (`?status=…&created_from=…&page=2`), so a
 * filtered queue can be shared, bookmarked and restored with Back.
 *
 * Parameter names match `GET /admin/orders`. Unknown or malformed values are
 * ignored rather than trusted. Changing a filter resets to page 1. Other query
 * parameters (such as `mock`) are preserved.
 *
 * @returns The parsed filters, the matching API params (or `null` when the date
 * range is invalid, so no request is made), and updaters.
 */
export function useOrderFilters() {
  const [searchParams, setSearchParams] = useSearchParams()

  const filters = useMemo<OrderFilters>(() => {
    const date = (key: string) => {
      const value = searchParams.get(key) ?? ''
      return DATE_PATTERN.test(value) ? value : ''
    }
    const page = Number.parseInt(searchParams.get('page') ?? '1', 10)
    return {
      statuses: [...new Set(searchParams.getAll('status').filter(isOrderStatus))],
      createdFrom: date('created_from'),
      createdTo: date('created_to'),
      page: Number.isFinite(page) && page > 0 ? page : 1,
    }
  }, [searchParams])

  const dateRangeInvalid =
    filters.createdFrom !== '' && filters.createdTo !== '' && filters.createdFrom > filters.createdTo

  const params = useMemo<AdminOrderListParams | null>(() => {
    if (dateRangeInvalid) return null
    return {
      status: filters.statuses,
      created_from: filters.createdFrom || undefined,
      created_to: filters.createdTo || undefined,
      limit: PAGE_SIZE,
      offset: (filters.page - 1) * PAGE_SIZE,
    }
  }, [filters, dateRangeInvalid])

  const update = useCallback(
    (changes: Partial<OrderFilters>) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current)
        if (changes.statuses) {
          next.delete('status')
          changes.statuses.forEach((status) => next.append('status', status))
        }
        if (changes.createdFrom !== undefined) setOrDelete(next, 'created_from', changes.createdFrom)
        if (changes.createdTo !== undefined) setOrDelete(next, 'created_to', changes.createdTo)
        const page = changes.page ?? 1
        setOrDelete(next, 'page', page > 1 ? String(page) : '')
        return next
      })
    },
    [setSearchParams],
  )

  const clear = useCallback(() => update({ statuses: [], createdFrom: '', createdTo: '' }), [update])

  const hasFilters = filters.statuses.length > 0 || filters.createdFrom !== '' || filters.createdTo !== ''

  return { filters, params, dateRangeInvalid, hasFilters, update, clear }
}

function setOrDelete(params: URLSearchParams, key: string, value: string) {
  if (value) params.set(key, value)
  else params.delete(key)
}
