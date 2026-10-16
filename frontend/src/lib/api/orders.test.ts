import { describe, expect, it, vi } from 'vitest'
import { CSRF_HEADER, createApiClient } from './client'
import { createOrder, getOrder, listOrders, type OrderCreate } from './orders'

const BASE_URL = 'http://api.test'

function setup(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
  const client = createApiClient({ baseUrl: BASE_URL, fetch: fetchMock })
  return { fetch: fetchMock, client }
}

const REQUEST: OrderCreate = {
  idempotency_key: '5b0e2c3a-7d1f-4e8a-b6c9-0a1b2c3d4e5f',
  quantity_litres: 200,
  contact_name: 'Sample Customer',
  contact_phone: '08000000001',
  delivery_address: '12 Sample Close, Independence Layout, Enugu',
}

describe('orders endpoints', () => {
  it('POST /orders sends the body as JSON with the CSRF token and cookies', async () => {
    const { fetch, client } = setup({ reference: 'MO-7KQ2M9XH4T' }, 201)
    client.setCsrfToken('csrf-1')

    const order = await createOrder(REQUEST, client)

    expect(order).toEqual({ reference: 'MO-7KQ2M9XH4T' })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`${BASE_URL}/api/v1/orders`)
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(JSON.parse(init?.body as string)).toEqual(REQUEST)
    expect((init?.headers as Record<string, string>)[CSRF_HEADER]).toBe('csrf-1')
  })

  it('GET /orders sends limit and offset', async () => {
    const { fetch, client } = setup({ items: [], total: 0, limit: 20, offset: 40 })
    await listOrders({ limit: 20, offset: 40 }, undefined, client)
    expect(fetch.mock.calls[0][0]).toBe(`${BASE_URL}/api/v1/orders?limit=20&offset=40`)
    expect(fetch.mock.calls[0][1]?.method).toBe('GET')
  })

  it('GET /orders/{reference} encodes the reference and passes the abort signal', async () => {
    const { fetch, client } = setup({ reference: 'MO-7KQ2M9XH4T' })
    const controller = new AbortController()
    await getOrder('MO-7KQ2M9XH4T/../x', controller.signal, client)
    expect(fetch.mock.calls[0][0]).toBe(`${BASE_URL}/api/v1/orders/MO-7KQ2M9XH4T%2F..%2Fx`)
    expect(fetch.mock.calls[0][1]?.signal).toBe(controller.signal)
  })

  it('surfaces 404 order_not_found as an ApiError', async () => {
    const { client } = setup(
      { error: { code: 'order_not_found', message: 'Order not found', details: null } },
      404,
    )
    await expect(getOrder('MO-0000000000', undefined, client)).rejects.toMatchObject({
      status: 404,
      code: 'order_not_found',
    })
  })
})
