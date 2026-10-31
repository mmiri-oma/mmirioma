// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import auditSample from '../../../../docs/api/examples/admin-audit-logs-page.json'
import notificationsSample from '../../../../docs/api/examples/admin-notifications-page.json'
import settingsSample from '../../../../docs/api/examples/admin-settings.json'
import shellSample from '../../../../docs/api/examples/admin-shell.json'
import requestsPageSample from '../../../../docs/api/examples/admin-support-requests-page.json'

// The real-API branches of the Support, Settings (audit log) and notification screens (#219): the adapters and the
// shared client run for real, and only `fetch` is replaced. See operations.screens.test.tsx for why the app is
// imported after the stub is installed.
vi.mock('../../lib/api/mode', () => ({ USE_MOCKS: false }))

const WAIT = 10_000
const SLOW = 20_000

const ME = { user: { id: 'u1', name: 'Sample Admin', phone: '+2348000000099', role: 'admin', phone_verified: true }, csrf_token: 'csrf', expires_at: '2099-01-01T00:00:00Z' }
const CONTACTS = [
  { name: 'Sample Customer', role: 'customer', phone: '+2348000000001' },
  { name: 'Sample Driver One', role: 'driver', phone: '+2348000000011' },
]
const RESOLVED_REQUEST = { ...requestsPageSample.items[0], status: 'resolved', resolution: { note: 'Called the customer and checked the tank.', resolved_by: { id: 'a1', name: 'Sample Admin' }, resolved_at: '2026-10-27T10:30:00Z' } }

type Route = { body: unknown; status?: number }
let routes: Record<string, Route | ((init: RequestInit | undefined) => Route)> = {}
const calls: { method: string; path: string; body: unknown }[] = []

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = new URL(String(input), 'http://localhost').pathname.replace('/api/v1', '')
  const method = init?.method ?? 'GET'
  calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null })
  const hit = routes[`${method} ${path}`]
  const { body, status = 200 } = typeof hit === 'function' ? hit(init) : (hit ?? { body: { error: { code: 'not_found', message: 'No', details: null } }, status: 404 })
  return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
})

function serve(overrides: typeof routes = {}) {
  calls.length = 0
  routes = {
    'GET /auth/me': { body: ME },
    'GET /admin/shell': { body: shellSample },
    'GET /admin/support-requests': { body: requestsPageSample },
    'GET /admin/support-requests/SR-9P3T6W2Z': { body: { ...requestsPageSample.items[0], contacts: CONTACTS } },
    'GET /admin/settings': { body: settingsSample },
    'GET /admin/audit-logs': { body: auditSample },
    'GET /admin/notifications': { body: notificationsSample },
    ...overrides,
  }
}

let App: typeof import('../../app/providers').AppProviders
let appRoutes: typeof import('../../app/router').routes

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchStub)
  vi.stubEnv('VITE_API_BASE_URL', 'http://api.test')
  App = (await import('../../app/providers')).AppProviders
  appRoutes = (await import('../../app/router')).routes
})

afterAll(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function renderAt(path: string) {
  render(
    <App>
      <RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: [path] })} />
    </App>,
  )
}

beforeEach(() => serve())

describe('the Support screen against the real API (#219, G2 approved by the technical lead)', () => {
  it('lists the requests with titles from their type, and no urgent count', async () => {
    renderAt('/admin/support')
    expect((await screen.findAllByText('Wrong quantity', {}, { timeout: WAIT })).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Delivery was late').length).toBeGreaterThan(0)
    expect(screen.getByText(/1 open\./)).toBeInTheDocument()
    expect(screen.queryByText(/urgent/i)).toBeNull()
  }, SLOW)

  it('offers one required Note and the pointer line: no picker, no points, no audit-log promise', async () => {
    renderAt('/admin/support')
    expect(await screen.findByLabelText('Note', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.getByText("If this needs an action, take it first on the order's page (confirm, withdraw or cancel), then resolve the request here.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply and resolve' })).toBeInTheDocument()
    expect(screen.queryByText('Points to add')).toBeNull()
    expect(screen.queryByText('Confirm without the code')).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Resolution' })).toBeNull()
    expect(screen.queryByText(/saved in the audit log/i)).toBeNull()
  }, SLOW)

  it('dials the customer and the driver from the contacts', async () => {
    renderAt('/admin/support')
    expect(await screen.findByText('Sample Driver One', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.getByText('Driver')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Call' })).toHaveLength(2)
  }, SLOW)

  it('resolves with the note only, then keeps showing that request with who resolved it and the note', async () => {
    const user = userEvent.setup()
    // The server lists open requests first, so once this one is resolved another open request becomes the first in the list.
    const another = { ...requestsPageSample.items[0], reference: 'SR-2B4D6F8H', message: 'Another open request.' }
    serve({ 'GET /admin/support-requests': { body: { ...requestsPageSample, items: [requestsPageSample.items[0], another, requestsPageSample.items[1]] } } })
    routes['POST /admin/support-requests/SR-9P3T6W2Z/resolve'] = () => {
      routes['GET /admin/support-requests'] = { body: { ...requestsPageSample, items: [another, RESOLVED_REQUEST, requestsPageSample.items[1]] } }
      return { body: RESOLVED_REQUEST }
    }
    renderAt('/admin/support')
    await user.type(await screen.findByLabelText('Note', {}, { timeout: WAIT }), 'Called the customer and checked the tank.')
    await user.click(screen.getByRole('button', { name: 'Apply and resolve' }))
    expect(await screen.findByText(/Resolved by Sample Admin, .*Note: Called the customer and checked the tank\./, {}, { timeout: WAIT })).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ path: '/admin/support-requests/SR-9P3T6W2Z/resolve', body: { note: 'Called the customer and checked the tank.' } })
  }, SLOW)

  it('shows a refused note under the field, in the server’s own words (422)', async () => {
    const user = userEvent.setup()
    routes['POST /admin/support-requests/SR-9P3T6W2Z/resolve'] = {
      status: 422,
      body: { error: { code: 'validation_error', message: 'Request validation failed', details: [{ loc: ['body', 'note'], msg: 'String should have at least 5 characters', type: 'string_too_short' }] } },
    }
    renderAt('/admin/support')
    await user.type(await screen.findByLabelText('Note', {}, { timeout: WAIT }), 'ok')
    await user.click(screen.getByRole('button', { name: 'Apply and resolve' }))
    expect(await screen.findByText('String should have at least 5 characters', {}, { timeout: WAIT })).toBeInTheDocument()
    // What was typed is kept, and nothing says the request was resolved.
    expect(screen.getByLabelText('Note')).toHaveValue('ok')
    expect(screen.queryByText(/Resolved by/)).toBeNull()
  }, SLOW)

  it('says so when the request was already resolved (409)', async () => {
    const user = userEvent.setup()
    routes['POST /admin/support-requests/SR-9P3T6W2Z/resolve'] = { status: 409, body: { error: { code: 'support_request_already_resolved', message: 'This request is already resolved', details: null } } }
    renderAt('/admin/support')
    await user.type(await screen.findByLabelText('Note', {}, { timeout: WAIT }), 'Called the customer.')
    await user.click(screen.getByRole('button', { name: 'Apply and resolve' }))
    expect(await screen.findByText('This request is already resolved', {}, { timeout: WAIT })).toBeInTheDocument()
  }, SLOW)

  it('shows an already resolved request as its note, with no action label', async () => {
    serve({ 'GET /admin/support-requests': { body: { ...requestsPageSample, items: [RESOLVED_REQUEST] } }, 'GET /admin/support-requests/SR-9P3T6W2Z': { body: { ...RESOLVED_REQUEST, contacts: CONTACTS } } })
    renderAt('/admin/support')
    expect(await screen.findByText(/Resolved by Sample Admin, .*Note: Called the customer and checked the tank\./, {}, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apply and resolve' })).toBeNull()
  }, SLOW)

  it('shows an empty state when there are no requests', async () => {
    serve({ 'GET /admin/support-requests': { body: { items: [], total: 0, limit: 100, offset: 0 } } })
    renderAt('/admin/support')
    expect(await screen.findByText('No issues.', {}, { timeout: WAIT })).toBeInTheDocument()
  }, SLOW)
})

describe('the audit log and notifications against the real API (#219)', () => {
  it('shows the audit log on Settings in plain words, with the record under each action, and no "not connected" message', async () => {
    renderAt('/admin/settings')
    expect((await screen.findAllByText('Resolved a support request', {}, { timeout: WAIT })).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Approved alternative proof').length).toBeGreaterThan(0)
    expect(screen.queryByText(/not connected/i)).toBeNull()
    const log = screen.getByRole('table', { name: 'Audit log' })
    // These two rows carry no reason, so the Reason column reads "None"; each shows what it is about.
    expect(within(log).getAllByText('None').length).toBeGreaterThan(0)
    expect(within(log).getByText('Support request · 6a8c0e')).toBeInTheDocument()
    expect(within(log).getByText('Order · 1c7e9a')).toBeInTheDocument()
  }, SLOW)

  it('shows a driver decision with its reason and the driver, and a cash action in words (#293)', async () => {
    const actor = { id: 'a1', name: 'Sample Admin', role: 'admin' }
    serve({
      'GET /admin/audit-logs': {
        body: {
          items: [
            { id: 'r1', at: '2026-10-31T10:00:00Z', actor, action: 'driver_suspended', target_type: 'driver', target_id: '4f3a2c9e-1111-4222-8333-444455556666', details: { reason: 'Papers expired' } },
            { id: 'r2', at: '2026-10-31T09:00:00Z', actor, action: 'cash_received', target_type: 'cash_collection', target_id: '3b9f1111-2222-4333-8444-555566667777', details: { order_id: 'x', reason: 'Not for the screen' } },
          ],
          total: 2,
          limit: 50,
          offset: 0,
        },
      },
    })
    renderAt('/admin/settings')
    const log = await screen.findByRole('table', { name: 'Audit log' }, { timeout: WAIT })
    expect(await within(log).findByText('Suspended a driver', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(within(log).getByText('Papers expired')).toBeInTheDocument()
    expect(within(log).getByText('Driver · 4f3a2c')).toBeInTheDocument()
    expect(within(log).getByText('Received cash')).toBeInTheDocument()
    expect(within(log).getByText('Cash collection · 3b9f11')).toBeInTheDocument()
    expect(within(log).queryByText('cash_received')).toBeNull()
    // A reason on any other action stays off the screen.
    expect(within(log).queryByText('Not for the screen')).toBeNull()
  }, SLOW)

  it('lists the notifications, and marks them all read with an empty body', async () => {
    const user = userEvent.setup()
    routes['POST /admin/notifications/read'] = { body: null, status: 204 }
    renderAt('/admin/notifications')
    expect(await screen.findByText('A driver declined an order', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.getByText('A partner is waiting for approval')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark all as read' }))
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/admin/notifications/read')).toBe(true), { timeout: WAIT })
    expect(calls.find((c) => c.method === 'POST' && c.path === '/admin/notifications/read')?.body).toEqual({})
  }, SLOW)
})

