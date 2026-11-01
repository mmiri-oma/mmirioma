// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import customerSample from '../../../../docs/api/examples/admin-customer.json'
import customersPageSample from '../../../../docs/api/examples/admin-customers-page.json'
import driversPageSample from '../../../../docs/api/examples/admin-drivers-page.json'
import shellSample from '../../../../docs/api/examples/admin-shell.json'

// The real-API branches of the Customers and Riders screens (#220): the adapters and the shared client run for
// real, and only `fetch` is replaced. See operations.screens.test.tsx for why the app is imported after the stub.
vi.mock('../../lib/api/mode', () => ({ USE_MOCKS: false }))

const WAIT = 10_000
const SLOW = 20_000

const ME = { user: { id: 'u1', name: 'Sample Admin', phone: '+2348000000099', role: 'admin', phone_verified: true }, csrf_token: 'csrf', expires_at: '2099-01-01T00:00:00Z' }
const [APPROVED_TANKER, PENDING_KEKE] = driversPageSample.items
const SUSPENDED = { ...APPROVED_TANKER, id: 'd-suspended', name: 'Sample Suspended', approval_status: 'suspended', is_available: false }

type Route = { body: unknown; status?: number }
let routes: Record<string, Route | ((init: RequestInit | undefined) => Route)> = {}
const calls: { method: string; path: string; search: string; body: unknown }[] = []

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), 'http://localhost')
  const path = url.pathname.replace('/api/v1', '')
  const method = init?.method ?? 'GET'
  calls.push({ method, path, search: url.search, body: init?.body ? JSON.parse(String(init.body)) : null })
  const hit = routes[`${method} ${path}`]
  const { body, status = 200 } = typeof hit === 'function' ? hit(init) : (hit ?? { body: { error: { code: 'not_found', message: 'No', details: null } }, status: 404 })
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
})

function serve(overrides: typeof routes = {}) {
  calls.length = 0
  routes = {
    'GET /auth/me': { body: ME },
    'GET /admin/shell': { body: shellSample },
    'GET /admin/customers': { body: customersPageSample },
    [`GET /admin/customers/${customersPageSample.items[0].id}`]: { body: customerSample },
    'GET /admin/drivers': { body: driversPageSample },
    [`GET /admin/drivers/${APPROVED_TANKER.id}`]: { body: APPROVED_TANKER },
    [`GET /admin/drivers/${PENDING_KEKE.id}`]: { body: PENDING_KEKE },
    'GET /admin/drivers/d-suspended': { body: SUSPENDED },
    ...overrides,
  }
}

let App: typeof import('../../app/providers').AppProviders
let appRoutes: typeof import('../../app/router').routes

// Importing the whole app is the slow part: under a full parallel run it went
// past Vitest's default 10 s hook timeout, so the hook gets SLOW.
beforeAll(async () => {
  vi.stubGlobal('fetch', fetchStub)
  vi.stubEnv('VITE_API_BASE_URL', 'http://api.test')
  App = (await import('../../app/providers')).AppProviders
  appRoutes = (await import('../../app/router')).routes
}, SLOW)

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

describe('the Customers screen against the real API (#220, G2 approved by the technical lead)', () => {
  it('says "ordered in the last 7 days" and shows the customer with no points, complaints or email', async () => {
    renderAt('/admin/customers')
    expect((await screen.findAllByText('Sample Customer', {}, { timeout: WAIT })).length).toBeGreaterThan(0)
    expect(screen.getByText(/ordered in the last 7 days/)).toBeInTheDocument()
    expect(await screen.findByText('Total paid', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.queryByText('Points')).toBeNull()
    expect(screen.queryByText('Complaints')).toBeNull()
    expect(screen.queryByText(/no email/)).toBeNull()
    // Real money, not a sample.
    expect(screen.getByText('₦45,000')).toBeInTheDocument()
    expect(screen.queryByText('SAMPLE')).toBeNull()
  }, SLOW)

  it('shows the addresses, and words an order with no delivery type without a Keke or Tanker word', async () => {
    const old = { ...customerSample, recent_orders: [{ ...customerSample.recent_orders[0], delivery_type: null }, customerSample.recent_orders[1]] }
    serve({ [`GET /admin/customers/${customersPageSample.items[0].id}`]: { body: old } })
    renderAt('/admin/customers')
    expect(await screen.findByText(/12 Sample Close, Independence Layout, Enugu/, {}, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.getByText('Default')).toBeInTheDocument()
    // The first order has no type: just its quantity; the second is a Keke order.
    expect(screen.getByText('3,000 L · 750 gal')).toBeInTheDocument()
    expect(screen.getByText('1,200 L · 300 gal Keke')).toBeInTheDocument()
  }, SLOW)

  it('shows the error state for a customer that is not found (404)', async () => {
    serve({ [`GET /admin/customers/${customersPageSample.items[0].id}`]: { body: { error: { code: 'customer_not_found', message: 'Customer not found', details: null } }, status: 404 } })
    renderAt('/admin/customers')
    expect(await screen.findByText(/Customer not found/, {}, { timeout: WAIT })).toBeInTheDocument()
  }, SLOW)
})

describe('the Riders screen against the real API (#220, G2 approved by the technical lead)', () => {
  it('lists active riders with the server counts, the vehicle and plate, and no code or Today column', async () => {
    renderAt('/admin/riders')
    expect(await screen.findByText(/2 riders · 1 online now · 1 waiting for approval/, {}, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.getAllByText('Tanker · ENU-456-CD').length).toBeGreaterThan(0)
    expect(screen.queryByRole('columnheader', { name: 'Today' })).toBeNull()
    expect(screen.queryByText(/KK-014|TK-102/)).toBeNull()
    expect(screen.queryByText(/SAMPLE/)).toBeNull()
    // Active accounts only, and the first 100.
    const list = calls.find((c) => c.path === '/admin/drivers')!
    expect(Object.fromEntries(new URLSearchParams(list.search))).toMatchObject({ is_active: 'true', limit: '100' })
  }, SLOW)

  it('shows an approved rider with Trips and Active orders, and none of the lines the backend has no source for', async () => {
    renderAt(`/admin/riders?id=${APPROVED_TANKER.id}`)
    expect(await screen.findByRole('button', { name: 'Suspend rider' }, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.getByText('Trips')).toBeInTheDocument()
    expect(screen.getByText('Active orders')).toBeInTheDocument()
    for (const hidden of ['Rating', 'Payout due', 'Documents', 'Reported issues']) expect(screen.queryByText(hidden)).toBeNull()
  }, SLOW)

  it('suspends with a reason, sending no vehicle', async () => {
    const user = userEvent.setup()
    routes[`POST /admin/drivers/${APPROVED_TANKER.id}/approval`] = { body: { ...APPROVED_TANKER, approval_status: 'suspended' } }
    renderAt(`/admin/riders?id=${APPROVED_TANKER.id}`)
    await user.type(await screen.findByLabelText(/Reason to suspend/, {}, { timeout: WAIT }), 'Vehicle papers expired')
    await user.click(screen.getByRole('button', { name: 'Suspend rider' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Suspend' }))
    expect(await screen.findByText('Saved. The rider sees the change in their app.', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ approval_status: 'suspended', reason: 'Vehicle papers expired' })
  }, SLOW)

  it('shows a reason the server refuses under the field, in the server’s own words (422)', async () => {
    const user = userEvent.setup()
    routes[`POST /admin/drivers/${APPROVED_TANKER.id}/approval`] = {
      status: 422,
      body: { error: { code: 'validation_error', message: 'Request validation failed', details: [{ loc: ['body'], msg: 'Value error, The reason must be 500 characters or fewer', type: 'value_error' }] } },
    }
    renderAt(`/admin/riders?id=${APPROVED_TANKER.id}`)
    await user.type(await screen.findByLabelText(/Reason to suspend/, {}, { timeout: WAIT }), 'Vehicle papers expired')
    await user.click(screen.getByRole('button', { name: 'Suspend rider' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Suspend' }))
    // The server reports this rule at ["body"] with pydantic's prefix; it shows under the reason field without the prefix.
    expect(await screen.findByText('The reason must be 500 characters or fewer', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.queryByText('Saved. The rider sees the change in their app.')).toBeNull()
  }, SLOW)

  it('asks for a suspend reason before it opens the confirm sheet, and sends nothing (#294)', async () => {
    const user = userEvent.setup()
    renderAt(`/admin/riders?id=${APPROVED_TANKER.id}`)
    const box = await screen.findByLabelText(/Reason to suspend/, {}, { timeout: WAIT })
    await user.click(screen.getByRole('button', { name: 'Suspend rider' }))
    expect(await screen.findByText('A reason of at least 5 characters is required')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    // Spaces do not count, and a short reason is refused the same way.
    await user.type(box, '   ab  ')
    expect(screen.queryByText('A reason of at least 5 characters is required')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Suspend rider' }))
    expect(await screen.findByText('A reason of at least 5 characters is required')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
    // A reason that is long enough takes the message away and opens the sheet.
    await user.clear(box)
    await user.type(box, 'Papers expired')
    await user.click(screen.getByRole('button', { name: 'Suspend rider' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(screen.queryByText('A reason of at least 5 characters is required')).toBeNull()
  }, SLOW)

  it('tells the dispatcher not to put customer details in the reason, for a suspension and a reactivation (#293)', async () => {
    renderAt(`/admin/riders?id=${APPROVED_TANKER.id}`)
    await screen.findByLabelText(/Reason to suspend/, {}, { timeout: WAIT })
    expect(screen.getByText('Do not include customer details.')).toBeInTheDocument()
  }, SLOW)

  it('shows the same hint under the reactivation reason (#293)', async () => {
    renderAt('/admin/riders?id=d-suspended')
    await screen.findByLabelText(/Reason to reactivate/, {}, { timeout: WAIT })
    expect(screen.getByText('Do not include customer details.')).toBeInTheDocument()
  }, SLOW)

  it('shows no hint on an approval, which has no reason box (#293)', async () => {
    renderAt(`/admin/riders?id=${PENDING_KEKE.id}`)
    expect(await screen.findByRole('button', { name: 'Approve rider' }, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.queryByLabelText(/Reason to/)).toBeNull()
    expect(screen.queryByText('Do not include customer details.')).toBeNull()
  }, SLOW)

  it('does not ask for a reason to reactivate: it is optional (#294)', async () => {
    const user = userEvent.setup()
    renderAt('/admin/riders?id=d-suspended')
    await user.click(await screen.findByRole('button', { name: 'Reactivate rider' }, { timeout: WAIT }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(screen.queryByText('A reason of at least 5 characters is required')).toBeNull()
  }, SLOW)

  it('empties the reason once a suspend is saved, so the reactivate box starts empty (#294)', async () => {
    const user = userEvent.setup()
    routes[`POST /admin/drivers/${APPROVED_TANKER.id}/approval`] = () => {
      // After the save the server reports the rider as suspended.
      routes[`GET /admin/drivers/${APPROVED_TANKER.id}`] = { body: { ...APPROVED_TANKER, approval_status: 'suspended' } }
      return { body: { ...APPROVED_TANKER, approval_status: 'suspended' } }
    }
    renderAt(`/admin/riders?id=${APPROVED_TANKER.id}`)
    await user.type(await screen.findByLabelText(/Reason to suspend/, {}, { timeout: WAIT }), 'Papers expired')
    await user.click(screen.getByRole('button', { name: 'Suspend rider' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Suspend' }))
    const next = await screen.findByLabelText(/Reason to reactivate/, {}, { timeout: WAIT })
    expect(next).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Reactivate rider' })).toBeInTheDocument()
  }, SLOW)

  it('asks for the verified vehicle when approving a partner who has none, with the declared claim next to it', async () => {
    const user = userEvent.setup()
    routes[`POST /admin/drivers/${PENDING_KEKE.id}/approval`] = { body: { ...PENDING_KEKE, approval_status: 'approved' } }
    renderAt(`/admin/riders?id=${PENDING_KEKE.id}`)
    expect(await screen.findByText('Vehicle you checked', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.getByText(/Declared by the partner, not checked:/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Vehicle'), 'Tricycle with 1,000 L tank')
    await user.type(screen.getByLabelText('Safe payload per trip (litres)'), '1000')
    await user.click(screen.getByLabelText('Ground'))
    await user.click(screen.getByRole('button', { name: 'Approve rider' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('Saved. The rider sees the change in their app.', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      approval_status: 'approved',
      reason: null,
      vehicle: { description: 'Tricycle with 1,000 L tank', safe_payload_litres: 1000, transfer_methods: ['ground'] },
    })
  }, SLOW)

  describe('the vehicle form examples follow the vehicle type (#294)', () => {
    /** Open the approval form for a pending partner whose declared vehicle type is `type`. */
    async function openForm(type: 'keke' | 'tanker' | null) {
      const partner = { ...PENDING_KEKE, id: `d-pending-${type}`, vehicle: { ...PENDING_KEKE.vehicle, delivery_type: type } }
      routes[`GET /admin/drivers/${partner.id}`] = { body: partner }
      renderAt(`/admin/riders?id=${partner.id}`)
      await screen.findByText('Vehicle you checked', {}, { timeout: WAIT })
    }

    it('shows Keke examples for a Keke, with no capacity number', async () => {
      await openForm('keke')
      expect(screen.getByLabelText('Vehicle')).toHaveAttribute('placeholder', 'e.g. Keke')
      expect(screen.getByLabelText('Safe payload per trip (litres)')).toHaveAttribute('placeholder', 'Litres you measured')
    }, SLOW)

    it('shows the tanker examples for a tanker', async () => {
      await openForm('tanker')
      expect(screen.getByLabelText('Vehicle')).toHaveAttribute('placeholder', 'e.g. Tanker truck')
      expect(screen.getByLabelText('Safe payload per trip (litres)')).toHaveAttribute('placeholder', 'e.g. 12000')
    }, SLOW)

    it('keeps the tanker examples when the vehicle type is not known', async () => {
      await openForm(null)
      expect(screen.getByLabelText('Vehicle')).toHaveAttribute('placeholder', 'e.g. Tanker truck')
      expect(screen.getByLabelText('Safe payload per trip (litres)')).toHaveAttribute('placeholder', 'e.g. 12000')
    }, SLOW)
  })

  it('shows a refused vehicle field under that field (422)', async () => {
    const user = userEvent.setup()
    routes[`POST /admin/drivers/${PENDING_KEKE.id}/approval`] = {
      status: 422,
      body: {
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          details: [{ loc: ['body', 'vehicle', 'safe_payload_litres'], msg: 'Input should be greater than or equal to 1', type: 'greater_than_equal' }],
        },
      },
    }
    renderAt(`/admin/riders?id=${PENDING_KEKE.id}`)
    await user.type(await screen.findByLabelText('Vehicle'), 'Tricycle')
    await user.click(screen.getByRole('button', { name: 'Approve rider' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('Input should be greater than or equal to 1', {}, { timeout: WAIT })).toBeInTheDocument()
  }, SLOW)

  it('reactivates a suspended partner who already has a verified vehicle with no vehicle fields', async () => {
    const user = userEvent.setup()
    routes['POST /admin/drivers/d-suspended/approval'] = { body: { ...SUSPENDED, approval_status: 'approved' } }
    renderAt('/admin/riders?id=d-suspended')
    expect(await screen.findByRole('button', { name: 'Reactivate rider' }, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.queryByText('Vehicle you checked')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Reactivate rider' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reactivate' }))
    expect(await screen.findByText('Saved. The rider sees the change in their app.', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ approval_status: 'approved', reason: null })
  }, SLOW)

  it('shows a deactivated account as an error, never as suspended', async () => {
    serve({ 'GET /admin/drivers/d-off': { body: { ...APPROVED_TANKER, id: 'd-off', is_active: false } } })
    renderAt('/admin/riders?id=d-off')
    expect(await screen.findByText('This account is deactivated.', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.queryByText('Reactivate rider')).toBeNull()
  }, SLOW)

  it('says so when the phone is not verified (409 partner_phone_not_verified)', async () => {
    const user = userEvent.setup()
    routes[`POST /admin/drivers/${PENDING_KEKE.id}/approval`] = {
      status: 409,
      body: { error: { code: 'partner_phone_not_verified', message: 'Verify the partner phone before approving', details: null } },
    }
    renderAt(`/admin/riders?id=${PENDING_KEKE.id}`)
    await user.type(await screen.findByLabelText('Vehicle'), 'Tricycle')
    await user.type(screen.getByLabelText('Safe payload per trip (litres)'), '1000')
    await user.click(screen.getByRole('button', { name: 'Approve rider' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('Verify the partner phone before approving', {}, { timeout: WAIT })).toBeInTheDocument()
  }, SLOW)
})
