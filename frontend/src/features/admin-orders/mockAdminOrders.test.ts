import { describe, expect, it } from 'vitest'
import type { AdminOrderListParams } from '../../lib/api/adminOrders'
import { ApiError } from '../../lib/api/client'
import { createMockAdminOrdersSource, MOCK_ADMIN_ORDERS, queryMockOrders } from './mockAdminOrders'
import { normaliseReference } from './reference'

const allParams: AdminOrderListParams = { status: [], limit: 100, offset: 0 }

describe('mock admin orders', () => {
  it('flags every fixture as simulated (BR-09)', () => {
    expect(MOCK_ADMIN_ORDERS.every((order) => order.is_simulated)).toBe(true)
  })

  it('returns newest first', () => {
    const { items } = queryMockOrders(MOCK_ADMIN_ORDERS, allParams)
    const created = items.map((order) => order.created_at)
    expect(created).toEqual([...created].sort().reverse())
  })

  it('filters by any of several statuses', () => {
    const { items, total } = queryMockOrders(MOCK_ADMIN_ORDERS, { ...allParams, status: ['failed', 'disputed'] })
    expect(total).toBe(2)
    expect(items.map((order) => order.status).sort()).toEqual(['disputed', 'failed'])
  })

  it('filters by is_simulated like the agreed contract (BR-09)', () => {
    const real = { ...MOCK_ADMIN_ORDERS[0], id: 'real-1', reference: 'MO-REAL000001', is_simulated: false }
    const orders = [...MOCK_ADMIN_ORDERS, real]
    expect(queryMockOrders(orders, { ...allParams, is_simulated: false }).items).toEqual([real])
    expect(queryMockOrders(orders, { ...allParams, is_simulated: true }).total).toBe(MOCK_ADMIN_ORDERS.length)
    expect(queryMockOrders(orders, allParams).total).toBe(MOCK_ADMIN_ORDERS.length + 1)
  })

  it('filters by inclusive Lagos creation dates', () => {
    // MO-4NB9DQ6R3Y was created 2026-10-09T23:30Z, which is 10 Oct in Lagos.
    const { items } = queryMockOrders(MOCK_ADMIN_ORDERS, {
      ...allParams,
      created_from: '2026-10-10',
      created_to: '2026-10-10',
    })
    expect(items.map((order) => order.reference)).toContain('MO-4NB9DQ6R3Y')
    expect(items.every((order) => order.created_at >= '2026-10-09T23:00:00Z')).toBe(true)
    expect(items.every((order) => order.created_at < '2026-10-10T23:00:00Z')).toBe(true)
  })

  it('pages with limit and offset and reports the full total', () => {
    const page = queryMockOrders(MOCK_ADMIN_ORDERS, { ...allParams, limit: 10, offset: 20 })
    expect(page.total).toBe(MOCK_ADMIN_ORDERS.length)
    expect(page.items).toHaveLength(MOCK_ADMIN_ORDERS.length - 20)
    expect(page.offset).toBe(20)
  })

  it('rejects unknown references with order_not_found', async () => {
    const source = createMockAdminOrdersSource({ latencyMs: 0 })
    const error = await source.getOrder('MO-0000000000').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 404, code: 'order_not_found' })
  })

  it('rejects with AbortError when the request is cancelled', async () => {
    const source = createMockAdminOrdersSource({ latencyMs: 1000 })
    const controller = new AbortController()
    const pending = source.listOrders(allParams, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('normaliseReference', () => {
  it('accepts references typed in any case, with or without the prefix', () => {
    expect(normaliseReference(' mo-7kq2m9xh4t ')).toBe('MO-7KQ2M9XH4T')
    expect(normaliseReference('7KQ2 M9XH 4T')).toBe('MO-7KQ2M9XH4T')
  })

  it('rejects wrong lengths and non-Crockford characters', () => {
    expect(normaliseReference('MO-123')).toBeNull()
    expect(normaliseReference('MO-7KQ2M9XH4I')).toBeNull()
    expect(normaliseReference('')).toBeNull()
  })
})
