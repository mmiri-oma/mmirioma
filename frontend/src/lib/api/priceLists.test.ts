import { describe, expect, it, vi } from 'vitest'
import createRequest from '../../../../docs/api/examples/admin-price-list-create-request.json'
import priceList from '../../../../docs/api/examples/admin-price-list.json'
import waterCategories from '../../../../docs/api/examples/admin-water-categories.json'
import errorChanged from '../../../../docs/api/examples/error-price-list-changed.json'
import errorOverlap from '../../../../docs/api/examples/error-price-rules-overlap.json'
import { getCurrentPriceList as currentOrNull, priceListHistory, savePriceList } from '../../features/admin/real/pricing'
import type { PriceListDraft } from '../../domain/admin'
import { ApiError, createApiClient, CSRF_HEADER } from './client'
import { createPriceList, getCurrentPriceList, listPriceLists, listWaterCategories } from './priceLists'

const BASE_URL = 'http://api.test'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function setup(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(body, status))
  const client = createApiClient({ baseUrl: BASE_URL, fetch: fetchMock })
  client.setCsrfToken('csrf-token')
  return { fetchMock, client }
}

function sent(fetchMock: ReturnType<typeof setup>['fetchMock']) {
  const [url, init] = fetchMock.mock.calls[0]
  const request = init as RequestInit
  return {
    url: String(url),
    method: request.method ?? 'GET',
    body: request.body ? JSON.parse(String(request.body)) : null,
    csrf: new Headers(request.headers).get(CSRF_HEADER),
  }
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

const notFound = { error: { code: 'price_list_not_found', message: 'No price list has been saved yet', details: null } }

describe('GET /admin/price-lists/current (#173)', () => {
  it('reads the contract example', async () => {
    const { fetchMock, client } = setup(priceList)
    const list = await getCurrentPriceList(undefined, client)
    expect(sent(fetchMock).url).toBe(`${BASE_URL}/api/v1/admin/price-lists/current`)
    expect(list.version).toBe(3)
    expect(list.rules).toHaveLength(3)
    expect(list.rules[1].margin).toEqual({ type: 'percentage', basis_points: 1000 })
    expect(list.changes[0].path).toBe('rules[1].distance_rate_minor_units_per_km')
  })

  it('turns 404 price_list_not_found into "no price list yet" (null)', async () => {
    const { client } = setup(notFound, 404)
    expect(await currentOrNull(client)).toBeNull()
  })

  it('passes other errors through', async () => {
    const { client } = setup({ error: { code: 'forbidden', message: 'Only Waterline staff can do this', details: null } }, 403)
    expect((await rejection(currentOrNull(client))).code).toBe('forbidden')
  })

  it('reports an unexpected body as invalid_response', async () => {
    const { client } = setup({ ...priceList, rules: [{ ...priceList.rules[0], margin: { type: 'markup' } }] })
    expect((await rejection(getCurrentPriceList(undefined, client))).code).toBe('invalid_response')
  })
})

describe('GET /admin/price-lists (#173)', () => {
  it('reads a page of versions, newest first', async () => {
    const { fetchMock, client } = setup({ items: [priceList], total: 1, limit: 20, offset: 0 })
    const items = await priceListHistory(client)
    expect(sent(fetchMock).url).toBe(`${BASE_URL}/api/v1/admin/price-lists?limit=20&offset=0`)
    expect(items.map((v) => v.version)).toEqual([3])
  })

  it('passes 422 validation_error through', async () => {
    const { client } = setup({ error: { code: 'validation_error', message: 'Request validation failed', details: [] } }, 422)
    expect((await rejection(listPriceLists({ limit: 500 }, undefined, client))).code).toBe('validation_error')
  })
})

describe('POST /admin/price-lists (#173)', () => {
  it('sends the whole set of rules with the version opened, with CSRF', async () => {
    const { fetchMock, client } = setup(priceList, 201)
    const saved = await savePriceList(createRequest as PriceListDraft, client)
    const request = sent(fetchMock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe(`${BASE_URL}/api/v1/admin/price-lists`)
    expect(request.body).toEqual(createRequest)
    expect(request.csrf).toBe('csrf-token')
    expect(saved.version).toBe(3)
  })

  it('passes 409 price_list_changed through with the current version', async () => {
    const { client } = setup(errorChanged, 409)
    const error = await rejection(createPriceList(createRequest as PriceListDraft, client))
    expect(error.code).toBe('price_list_changed')
    expect(error.details).toEqual({ current_version: 4 })
  })

  it('passes 422 price_rules_overlap through with the clashing rule', async () => {
    const { client } = setup(errorOverlap, 422)
    const error = await rejection(createPriceList(createRequest as PriceListDraft, client))
    expect(error.code).toBe('price_rules_overlap')
    expect(error.details).toEqual(errorOverlap.error.details)
  })
})

describe('GET /admin/water-categories (#161)', () => {
  it('reads every category, active or not', async () => {
    const { fetchMock, client } = setup(waterCategories)
    const items = await listWaterCategories(undefined, client)
    expect(sent(fetchMock).url).toBe(`${BASE_URL}/api/v1/admin/water-categories`)
    expect(items).toEqual(waterCategories.items)
  })

  it('reports an unexpected body as invalid_response', async () => {
    const { client } = setup({ items: [{ id: 'x' }] })
    expect((await rejection(listWaterCategories(undefined, client))).code).toBe('invalid_response')
  })
})
