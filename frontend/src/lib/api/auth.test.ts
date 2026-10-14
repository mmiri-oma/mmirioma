import { describe, expect, it, vi } from 'vitest'
import { getMe, login, logout, register, type Session } from './auth'
import { ApiError, CSRF_HEADER, createApiClient } from './client'

const BASE_URL = 'http://api.test'

const SESSION: Session = {
  user: {
    id: '0b8f1c5e-2a7d-4d3e-9a51-6f0c2b7e9d14',
    name: 'Sample Customer',
    phone: '+2348000000001',
    role: 'customer',
    phone_verified: false,
  },
  csrf_token: 'csrf-1',
  expires_at: '2026-10-21T09:30:00Z',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function setup(responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    const next = responses.shift()
    if (!next) throw new Error('unexpected request')
    return next
  })
  const client = createApiClient({ baseUrl: BASE_URL, fetch: fetchMock })
  return { fetch: fetchMock, client }
}

function headersOf(fetch: ReturnType<typeof setup>['fetch'], call: number) {
  return fetch.mock.calls[call][1]?.headers as Record<string, string>
}

describe('auth endpoints', () => {
  it('logs in, then sends the CSRF token on unsafe requests only', async () => {
    const { fetch, client } = setup([
      jsonResponse(SESSION),
      jsonResponse({ ok: true }),
      jsonResponse({ ok: true }),
    ])

    const session = await login({ phone: '08000000001', password: 'secret pw' }, client)
    await client.request('/api/v1/orders', { method: 'POST', body: {} })
    await client.request('/api/v1/orders')

    expect(session).toEqual(SESSION)
    expect(fetch.mock.calls[0][0]).toBe(`${BASE_URL}/api/v1/auth/login`)
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
    })
    expect(headersOf(fetch, 0)[CSRF_HEADER]).toBeUndefined()
    expect(headersOf(fetch, 1)[CSRF_HEADER]).toBe('csrf-1')
    expect(headersOf(fetch, 2)[CSRF_HEADER]).toBeUndefined()
  })

  it('register stores the CSRF token of the new session', async () => {
    const { fetch, client } = setup([
      jsonResponse(SESSION, 201),
      new Response(null, { status: 204 }),
    ])

    await register(
      { name: 'Sample', phone: '08000000001', password: 'secret pw' },
      client,
    )
    await logout(client)

    expect(fetch.mock.calls[0][1]?.body).toBe(
      '{"name":"Sample","phone":"08000000001","password":"secret pw"}',
    )
    expect(headersOf(fetch, 1)[CSRF_HEADER]).toBe('csrf-1')
  })

  it('getMe restores the CSRF token after a page reload', async () => {
    const { fetch, client } = setup([
      jsonResponse({ ...SESSION, csrf_token: 'csrf-2' }),
      new Response(null, { status: 204 }),
    ])

    await getMe(undefined, client)
    await logout(client)

    expect(fetch.mock.calls[0][0]).toBe(`${BASE_URL}/api/v1/auth/me`)
    expect(headersOf(fetch, 1)[CSRF_HEADER]).toBe('csrf-2')
  })

  it('logout forgets the CSRF token', async () => {
    const { fetch, client } = setup([
      jsonResponse(SESSION),
      new Response(null, { status: 204 }),
      jsonResponse({ ok: true }),
    ])

    await login({ phone: '08000000001', password: 'secret pw' }, client)
    await logout(client)
    await client.request('/x', { method: 'POST' })

    expect(headersOf(fetch, 2)[CSRF_HEADER]).toBeUndefined()
  })

  it('does not store a token when login fails', async () => {
    const { fetch, client } = setup([
      jsonResponse(
        {
          error: {
            code: 'invalid_credentials',
            message: 'Phone number or password is incorrect',
            details: null,
          },
        },
        401,
      ),
      jsonResponse({ ok: true }),
    ])

    const failure = login({ phone: '08000000001', password: 'wrong' }, client)
    await expect(failure).rejects.toBeInstanceOf(ApiError)
    await expect(failure).rejects.toMatchObject({
      status: 401,
      code: 'invalid_credentials',
    })
    await client.request('/x', { method: 'POST' })

    expect(headersOf(fetch, 1)[CSRF_HEADER]).toBeUndefined()
  })
})
