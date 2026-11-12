import { describe, expect, it, vi } from 'vitest'
import adminOrderDetail from '../../../../docs/api/examples/admin-order-detail.json'
import historyConfirmed from '../../../../docs/api/examples/admin-order-history-confirmed.json'
import confirmationOptions from '../../../../docs/api/examples/confirmation-options.json'
import confirmRequest from '../../../../docs/api/examples/order-confirm-request.json'
import { C1_SOURCE_REASONS, confirmOrder, getConfirmationOptions, missingRequirements, type ConfirmRequest } from './adminConfirmation'
import { getAdminOrderDetail, getOrderHistory } from './adminDispatch'
import { ApiError, createApiClient } from './client'

const BASE_URL = 'http://api.test'
const PATH = `${BASE_URL}/api/v1/admin/orders/MO-7KQ2M9XH4T`

function setup(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
  const client = createApiClient({ baseUrl: BASE_URL, fetch: fetchMock })
  client.setCsrfToken('csrf-token')
  return { fetchMock, client }
}

describe('order confirmation API functions (deliveries.md, "Order confirmation endpoints")', () => {
  it('reads the options (contract sample): reasons in the server order, never a cost', async () => {
    const { fetchMock, client } = setup(confirmationOptions)
    const categories = await getConfirmationOptions('MO-7KQ2M9XH4T', undefined, client)
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${PATH}/confirmation-options`)
    expect(categories.map((category) => category.label)).toEqual(['Potable Water', 'Utility Water'])
    expect(categories[0].sources[1].reasons).toEqual(['suspended', 'approval_expired'])
    expect(JSON.stringify(categories)).not.toMatch(/cost/)
  })

  it('reads each source kind (amendment #72), and a missing kind (older server) as null', async () => {
    const { client } = setup(confirmationOptions)
    const categories = await getConfirmationOptions('MO-7KQ2M9XH4T', undefined, client)
    expect(categories[0].sources[0].kind).toBe('borehole')
    const older = structuredClone(confirmationOptions) as { categories: { sources: Record<string, unknown>[] }[] }
    for (const c of older.categories) for (const s of c.sources) delete s.kind
    const { client: olderClient } = setup(older)
    expect((await getConfirmationOptions('MO-7KQ2M9XH4T', undefined, olderClient))[0].sources[0].kind).toBeNull()
  })

  it('confirms a priced order with no manual total and passes 409 invalid_order_transition through', async () => {
    const request: ConfirmRequest = { ...(confirmRequest as ConfirmRequest), expected_status: 'awaiting_confirmation' }
    delete request.manual_quote_total_minor_units
    const changed = { error: { code: 'invalid_order_transition', message: 'The order has changed', details: { from: 'confirmed', to: 'confirmed' } } }
    const { fetchMock, client } = setup(changed, 409)
    await expect(confirmOrder('MO-7KQ2M9XH4T', request, client)).rejects.toMatchObject({ status: 409, code: 'invalid_order_transition' })
    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(sent.expected_status).toBe('awaiting_confirmation')
    expect(sent).not.toHaveProperty('manual_quote_total_minor_units')
  })

  it('reports an unknown eligibility reason as invalid_response, never an eligible source', async () => {
    const body = structuredClone(confirmationOptions)
    body.categories[0].sources[0].reasons = ['flooded']
    const { client } = setup(body)
    await expect(getConfirmationOptions('MO-7KQ2M9XH4T', undefined, client)).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('reads every #407 order-fit reason in the C1 options, in the server order', async () => {
    expect(C1_SOURCE_REASONS.slice(4)).toEqual(['kind_not_set', 'unavailable', 'kind_mismatch', 'below_minimum_litres', 'above_maximum_litres', 'vehicle_not_suitable'])
    const body = structuredClone(confirmationOptions)
    body.categories[0].sources[0].reasons = ['approval_expired', ...C1_SOURCE_REASONS.slice(4)]
    const { client } = setup(body)
    const categories = await getConfirmationOptions('MO-7KQ2M9XH4T', undefined, client)
    expect(categories[0].sources[0].reasons).toEqual(['approval_expired', ...C1_SOURCE_REASONS.slice(4)])
  })

  it('keeps the order detail to the four safety reasons: an order-fit reason there is invalid_response', async () => {
    const body = structuredClone(adminOrderDetail) as { source: { reasons: string[] } }
    body.source.reasons = ['unavailable']
    const { client } = setup(body)
    await expect(getAdminOrderDetail('MO-7KQ2M9XH4T', undefined, client)).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('confirms with the agreed body and returns the confirmed order (contract samples)', async () => {
    const { fetchMock, client } = setup(adminOrderDetail)
    const order = await confirmOrder('MO-7KQ2M9XH4T', confirmRequest as ConfirmRequest, client)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`${PATH}/transition`)
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual(confirmRequest)
    expect(order.price).toMatchObject({ total_minor_units: 4_500_000, manual: true })
    expect(order.confirmation_sms?.status).toBe('accepted')
    expect(order.source?.reasons).toEqual([])
  })

  it('reads an order without confirmation fields (older server) as not confirmed', async () => {
    const older: Record<string, unknown> = { ...adminOrderDetail }
    for (const field of ['water_category', 'source', 'delivery_window', 'price', 'confirmation_sms']) delete older[field]
    const { client } = setup(older)
    const order = await getAdminOrderDetail('MO-7KQ2M9XH4T', undefined, client)
    expect([order.water_category, order.source, order.delivery_window, order.price, order.confirmation_sms]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ])
  })

  it('reads the two confirmation history entries (contract sample)', async () => {
    const { client } = setup(historyConfirmed)
    const [confirmed, quote] = await getOrderHistory('MO-7KQ2M9XH4T', undefined, client)
    expect(confirmed.confirmation?.source_name).toBe('Sample Borehole A')
    expect(quote.reason_code).toBe('manual_quote')
    expect(quote.confirmation).toBeNull()
  })

  it('lists the missing row 7 conditions of a refusal, ignoring unknown ones', () => {
    const error = new ApiError({
      kind: 'http',
      status: 409,
      code: 'transition_requirements_unmet',
      message: 'x',
      details: { missing: ['phone_verified', 'source_eligible', 'something_new'] },
    })
    expect(missingRequirements(error)).toEqual(['phone_verified', 'source_eligible'])
    expect(missingRequirements(new ApiError({ kind: 'http', status: 409, code: 'x', message: 'x' }))).toEqual([])
  })
})
