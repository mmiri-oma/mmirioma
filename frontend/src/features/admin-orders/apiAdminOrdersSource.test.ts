import { describe, expect, it, vi } from 'vitest'
import { adminOrderListQuery, type AdminOrderListParams } from '../../lib/api/adminOrders'
import { ApiError, createApiClient } from '../../lib/api/client'
import { createApiAdminOrdersSource } from './apiAdminOrdersSource'
import { MOCK_ADMIN_ORDERS } from './mockAdminOrders'

const BASE_URL = 'http://api.test'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function setup(response: Response) {
  const fetchMock = vi.fn<typeof fetch>(async () => response)
  const source = createApiAdminOrdersSource(
    createApiClient({ baseUrl: BASE_URL, fetch: fetchMock }),
  )
  return { fetchMock, source }
}

const params: AdminOrderListParams = { status: [], limit: 50, offset: 0 }

describe('adminOrderListQuery', () => {
  it('sends only paging when no filter is set', () => {
    expect(adminOrderListQuery(params)).toBe('limit=50&offset=0')
  })

  it('repeats status and includes every set filter', () => {
    const query = adminOrderListQuery({
      status: ['quote_requested', 'confirmed'],
      created_from: '2026-10-01',
      created_to: '2026-10-14',
      is_simulated: false,
      limit: 50,
      offset: 100,
    })
    expect(query).toBe(
      'status=quote_requested&status=confirmed&created_from=2026-10-01' +
        '&created_to=2026-10-14&is_simulated=false&limit=50&offset=100',
    )
  })

  it('sends is_simulated=true for simulated-only', () => {
    expect(adminOrderListQuery({ ...params, is_simulated: true })).toContain(
      'is_simulated=true',
    )
  })
})

describe('API admin orders source', () => {
  it('is not a mock, so no sample-data notice shows', () => {
    expect(setup(jsonResponse({})).source.isMock).toBe(false)
  })

  it('lists orders from GET /api/v1/admin/orders with credentials', async () => {
    const page = { items: MOCK_ADMIN_ORDERS.slice(0, 2), total: 2, limit: 50, offset: 0 }
    const { fetchMock, source } = setup(jsonResponse(page))
    const signal = new AbortController().signal

    await expect(
      source.listOrders({ ...params, status: ['failed'] }, signal),
    ).resolves.toEqual(page)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE_URL}/api/v1/admin/orders?status=failed&limit=50&offset=0`)
    expect(init?.method).toBe('GET')
    expect(init?.credentials).toBe('include')
    expect(init?.signal).toBe(signal)
  })

  it('loads one order by reference, encoding the path segment', async () => {
    const { fetchMock, source } = setup(jsonResponse(MOCK_ADMIN_ORDERS[0]))
    await source.getOrder('MO-7KQ2M9XH4T')
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BASE_URL}/api/v1/admin/orders/MO-7KQ2M9XH4T`,
    )

    const odd = setup(jsonResponse(MOCK_ADMIN_ORDERS[0]))
    await odd.source.getOrder('MO-a/b?c')
    expect(odd.fetchMock.mock.calls[0][0]).toBe(
      `${BASE_URL}/api/v1/admin/orders/MO-a%2Fb%3Fc`,
    )
  })

  it('passes order_not_found through for the "Order not found" state', async () => {
    const { source } = setup(
      jsonResponse(
        { error: { code: 'order_not_found', message: 'Order not found', details: null } },
        404,
      ),
    )
    const error = await source
      .getOrder('MO-0000000000')
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('order_not_found')
  })
})
