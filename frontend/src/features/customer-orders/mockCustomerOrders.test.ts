import { describe, expect, it } from 'vitest'
import { ApiError } from '../../lib/api/client'
import type { OrderCreate } from '../../lib/api/orders'
import { MOCK_CUSTOMER_ORDERS, createMockCustomerOrdersSource } from './mockCustomerOrders'

const REQUEST: OrderCreate = {
  idempotency_key: '5b0e2c3a-7d1f-4e8a-b6c9-0a1b2c3d4e5f',
  quantity_litres: 200,
  contact_name: 'Ada Sample',
  contact_phone: '0800 000 0001',
  delivery_address: '12 Sample Close, Independence Layout, Enugu',
}

const source = (orders = MOCK_CUSTOMER_ORDERS) =>
  createMockCustomerOrdersSource({
    latencyMs: 0,
    orders,
    now: () => new Date('2026-10-15T09:00:00Z'),
  })

describe('mock customer orders source', () => {
  it('is marked as mock so the screens show the sample-data notice', () => {
    expect(source().isMock).toBe(true)
  })

  it('creates a quote request with no price and puts it first', async () => {
    const orders = source()
    const order = await orders.createOrder(REQUEST)

    expect(order).toMatchObject({
      status: 'quote_requested',
      quantity_litres: 200,
      contact_phone: '+2348000000001',
      landmark: null,
      created_at: '2026-10-15T09:00:00.000Z',
    })
    expect(order.reference).toMatch(/^MO-[0-9A-HJKMNP-TV-Z]{10}$/)
    expect(order).not.toHaveProperty('price')
    const page = await orders.listOrders({ limit: 1, offset: 0 })
    expect(page.items[0].reference).toBe(order.reference)
  })

  it('returns the stored order for a retry with the same key and body (T-06)', async () => {
    const orders = source([])
    const first = await orders.createOrder(REQUEST)
    const retry = await orders.createOrder({ ...REQUEST })
    expect(retry).toEqual(first)
    expect((await orders.listOrders({ limit: 20, offset: 0 })).total).toBe(1)
  })

  it('rejects the same key with a different body (409 idempotency_key_reused)', async () => {
    const orders = source([])
    await orders.createOrder(REQUEST)
    await expect(orders.createOrder({ ...REQUEST, quantity_litres: 300 })).rejects.toMatchObject({
      status: 409,
      code: 'idempotency_key_reused',
    })
  })

  it('pages newest first with the shared page shape', async () => {
    const page = await source().listOrders({ limit: 2, offset: 2 })
    expect(page).toMatchObject({ total: MOCK_CUSTOMER_ORDERS.length, limit: 2, offset: 2 })
    expect(page.items.map((order) => order.reference)).toEqual(
      MOCK_CUSTOMER_ORDERS.slice(2, 4).map((order) => order.reference),
    )
  })

  it('answers 404 order_not_found for an unknown reference', async () => {
    const error = await source()
      .getOrder('MO-0000000000')
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 404, code: 'order_not_found' })
  })

  it('uses only fictional contact data', () => {
    for (const order of MOCK_CUSTOMER_ORDERS) {
      expect(order.contact_phone).toMatch(/^\+234800000/)
      expect(order.delivery_address).toMatch(/Sample|Example/)
    }
  })
})
