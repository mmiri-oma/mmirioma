import { describe, expect, it, vi } from 'vitest'
import {
  createAdminWaterSource,
  listAdminWaterSources,
  putAdminActivation,
  setAdminActivationStatus,
  updateAdminWaterSource,
  type WaterSourceRead,
} from './adminWaterSources'
import { ApiError, createApiClient, CSRF_HEADER } from './client'

const BASE_URL = 'http://api.test'

const SOURCE: WaterSourceRead = {
  id: '5c7e9a1b-3d5f-4a7c-8e1b-3d5f7a9c1e30',
  name: 'Sample Borehole A',
  approximate_location: 'Off Ogui Road, Enugu',
  kind: 'borehole',
  is_simulated: true,
  created_at: '2026-10-27T08:00:00Z',
  activations: [
    {
      category: { id: 'c-utility', code: 'utility', label: 'Utility Water' },
      status: 'activated',
      approved_until: '2026-11-20',
      report_reference: 'SAMPLE-LR-0001',
      cost_per_litre_minor_units: 150,
      status_reason: null,
      expiry: { state: 'expires_soon', days_left: 19 },
      reasons: [],
    },
  ],
}

function setup(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
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
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }
  throw new Error('expected the call to fail')
}

describe('the admin water-source calls (docs/api/admin-water-sources.md)', () => {
  it('lists the sources and both categories', async () => {
    const categories = [{ id: 'c-utility', code: 'utility', label: 'Utility Water' }]
    const { fetchMock, client } = setup({ items: [SOURCE], categories })
    const list = await listAdminWaterSources(undefined, client)
    expect(sent(fetchMock)).toMatchObject({ url: `${BASE_URL}/api/v1/admin/water-sources`, method: 'GET' })
    expect(list.items[0].activations[0].cost_per_litre_minor_units).toBe(150)
    expect(list.categories).toEqual(categories)
  })

  it('adds a source with a kind of null until it is set', async () => {
    const { fetchMock, client } = setup({ ...SOURCE, kind: null, activations: [] }, 201)
    const source = await createAdminWaterSource({ name: 'Sample Borehole A', approximate_location: 'Off Ogui Road', kind: null }, client)
    expect(sent(fetchMock)).toEqual({
      url: `${BASE_URL}/api/v1/admin/water-sources`,
      method: 'POST',
      body: { name: 'Sample Borehole A', approximate_location: 'Off Ogui Road', kind: null },
      csrf: 'csrf-token',
    })
    expect(source.kind).toBeNull()
  })

  it('edits only the fields it is given', async () => {
    const { fetchMock, client } = setup(SOURCE)
    await updateAdminWaterSource(SOURCE.id, { name: 'Sample Borehole B' }, client)
    expect(sent(fetchMock)).toMatchObject({ url: `${BASE_URL}/api/v1/admin/water-sources/${SOURCE.id}`, method: 'PATCH', body: { name: 'Sample Borehole B' } })
  })

  it('activates with a PUT to the source and category, the cost in integer kobo', async () => {
    const { fetchMock, client } = setup(SOURCE)
    await putAdminActivation(SOURCE.id, 'c-utility', { approved_until: '2027-03-31', report_reference: 'SAMPLE-LR-0002', cost_per_litre_minor_units: 175 }, client)
    expect(sent(fetchMock)).toEqual({
      url: `${BASE_URL}/api/v1/admin/water-sources/${SOURCE.id}/activations/c-utility`,
      method: 'PUT',
      body: { approved_until: '2027-03-31', report_reference: 'SAMPLE-LR-0002', cost_per_litre_minor_units: 175 },
      csrf: 'csrf-token',
    })
  })

  it('suspends or revokes with a POST to the status path and a reason', async () => {
    const { fetchMock, client } = setup(SOURCE)
    await setAdminActivationStatus(SOURCE.id, 'c-utility', { status: 'revoked', reason: 'Withdrawn.' }, client)
    expect(sent(fetchMock)).toMatchObject({
      url: `${BASE_URL}/api/v1/admin/water-sources/${SOURCE.id}/activations/c-utility/status`,
      method: 'POST',
      body: { status: 'revoked', reason: 'Withdrawn.' },
    })
  })

  it.each([
    [404, 'water_source_not_found'],
    [404, 'activation_not_found'],
    [403, 'forbidden'],
    [422, 'validation_error'],
  ])('passes %d %s through', async (status, code) => {
    const { client } = setup({ error: { code, message: 'No', details: null } }, status)
    const error = await rejection(setAdminActivationStatus(SOURCE.id, 'c-utility', { status: 'suspended', reason: 'x' }, client))
    expect([error.status, error.code]).toEqual([status, code])
  })

  it('reports a response of the wrong shape as invalid_response, not a wrong source', async () => {
    const { client } = setup({ items: [{ ...SOURCE, kind: 'spring' }], categories: [] })
    expect((await rejection(listAdminWaterSources(undefined, client))).code).toBe('invalid_response')
  })

  it('refuses a cost that is not an integer, so a float never reaches the screen', async () => {
    const bad = { ...SOURCE, activations: [{ ...SOURCE.activations[0], cost_per_litre_minor_units: 1.5 }] }
    const { client } = setup({ items: [bad], categories: [] })
    expect((await rejection(listAdminWaterSources(undefined, client))).code).toBe('invalid_response')
  })
})
