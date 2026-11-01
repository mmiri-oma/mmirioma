// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import shellSample from '../../../../../docs/api/examples/admin-shell.json'

// The Water sources screen against the real API (#309, docs/design/admin-water-sources.md): the client and the
// shared fetch layer run for real, and only `fetch` is replaced. See support.screens.test.tsx for why the app is
// imported after the stub is installed.
vi.mock('../../../lib/api/mode', () => ({ USE_MOCKS: false }))

const WAIT = 10_000
const SLOW = 20_000

const ME = { user: { id: 'u1', name: 'Sample Admin', phone: '+2348000000099', role: 'admin', phone_verified: true }, csrf_token: 'csrf', expires_at: '2099-01-01T00:00:00Z' }

/** A Lagos calendar date `days` from today, as `YYYY-MM-DD` (Lagos is UTC+1 all year). */
function inDays(days: number): string {
  return new Date(Date.now() + 60 * 60 * 1000 + days * 86_400_000).toISOString().slice(0, 10)
}

const POTABLE = { id: 'c-potable', code: 'potable', label: 'Potable Water' }
const UTILITY = { id: 'c-utility', code: 'utility', label: 'Utility Water' }

function activation(over: Record<string, unknown> = {}) {
  return {
    category: UTILITY,
    status: 'activated',
    approved_until: inDays(19),
    report_reference: 'SAMPLE-LR-0001',
    cost_per_litre_minor_units: 150,
    status_reason: null,
    expiry: { state: 'expires_soon', days_left: 19 },
    reasons: [],
    ...over,
  }
}

const BOREHOLE = {
  id: 's1',
  name: 'Sample Borehole A',
  approximate_location: 'Off Ogui Road, Enugu',
  kind: 'borehole',
  is_simulated: true,
  created_at: '2026-10-27T08:00:00Z',
  activations: [activation()],
}
const SUSPENDED = {
  id: 's2',
  name: 'Sample Ninth Mile Supplier',
  approximate_location: 'Ninth Mile Corner',
  kind: null,
  is_simulated: false,
  created_at: '2026-10-27T08:00:00Z',
  activations: [
    activation({
      category: POTABLE,
      status: 'suspended',
      approved_until: inDays(-3),
      cost_per_litre_minor_units: 200,
      status_reason: 'Pump repair.',
      expiry: { state: 'expired', days_left: -3 },
      reasons: ['suspended', 'approval_expired'],
    }),
  ],
}
const LIST = { items: [BOREHOLE, SUSPENDED], categories: [POTABLE, UTILITY] }

type Route = { body: unknown; status?: number }
let routes: Record<string, Route | ((init: RequestInit | undefined) => Route)> = {}
const calls: { method: string; path: string; body: unknown }[] = []

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = new URL(String(input), 'http://localhost').pathname.replace('/api/v1', '')
  const method = init?.method ?? 'GET'
  calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null })
  const hit = routes[`${method} ${path}`]
  const { body, status = 200 } = typeof hit === 'function' ? hit(init) : (hit ?? { body: { error: { code: 'not_found', message: 'No', details: null } }, status: 404 })
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
})

function serve(overrides: typeof routes = {}) {
  calls.length = 0
  routes = { 'GET /auth/me': { body: ME }, 'GET /admin/shell': { body: shellSample }, 'GET /admin/water-sources': { body: LIST }, ...overrides }
}

const envelope = (code: string, message = 'No') => ({ error: { code, message, details: null } })
const writes = () => calls.filter((c) => c.method !== 'GET')

let App: typeof import('../../../app/providers').AppProviders
let appRoutes: typeof import('../../../app/router').routes

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchStub)
  vi.stubEnv('VITE_API_BASE_URL', 'http://api.test')
  App = (await import('../../../app/providers')).AppProviders
  appRoutes = (await import('../../../app/router')).routes
})

afterAll(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function renderPage() {
  render(
    <App>
      <RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: ['/admin/water-sources'] })} />
    </App>,
  )
}

beforeEach(() => serve())

/** The card of one source: its heading's container. */
async function card(name: string) {
  const heading = await screen.findByRole('heading', { name }, { timeout: WAIT })
  return within(heading.closest('div[class*="flex-col"]') as HTMLElement)
}

describe('the Water sources screen against the real API (#309)', () => {
  it('lists each source with its kind, SIMULATED tag and one row per category', async () => {
    renderPage()
    const borehole = await card('Sample Borehole A')
    expect(borehole.getByText('Borehole')).toBeInTheDocument()
    expect(borehole.getByText('SIMULATED')).toBeInTheDocument()
    expect(borehole.getByText('Off Ogui Road, Enugu')).toBeInTheDocument()
    expect(borehole.getByText('Potable Water')).toBeInTheDocument()
    expect(borehole.getByText('Not activated')).toBeInTheDocument()
    expect(borehole.getByText('Activated')).toBeInTheDocument()
    expect(borehole.getByText('SAMPLE-LR-0001')).toBeInTheDocument()
    expect(borehole.getByText('₦1.50')).toBeInTheDocument()
    expect(screen.queryByText('SAMPLE DATA')).toBeNull()
  }, SLOW)

  it('warns on an activation close to expiry, in words', async () => {
    renderPage()
    const borehole = await card('Sample Borehole A')
    expect(borehole.getByText('Expires in 19 days')).toBeInTheDocument()
  }, SLOW)

  it('shows a suspended row with its reason and no expiry badge, and a source with no kind', async () => {
    renderPage()
    const supplier = await card('Sample Ninth Mile Supplier')
    expect(supplier.getByText('Kind not set')).toBeInTheDocument()
    expect(supplier.getByText('Suspended')).toBeInTheDocument()
    expect(supplier.getByText('Pump repair.')).toBeInTheDocument()
    expect(supplier.queryByText('Expired')).toBeNull()
    expect(supplier.getByText('₦2')).toBeInTheDocument()
    // Suspend is not offered on a suspended row; Revoke and Renew are.
    expect(supplier.queryByRole('button', { name: 'Suspend' })).toBeNull()
    expect(supplier.getByRole('button', { name: 'Revoke' })).toBeInTheDocument()
    expect(supplier.getByRole('button', { name: 'Renew' })).toBeInTheDocument()
  }, SLOW)

  it('says nothing about the water itself', async () => {
    renderPage()
    await card('Sample Borehole A')
    expect(document.body.textContent).not.toMatch(/\b(safe|clean|tested|certified|quality)\b/i)
  }, SLOW)

  it('adds the sidebar entry', async () => {
    renderPage()
    expect((await screen.findAllByRole('link', { name: 'Water sources' }, { timeout: WAIT })).length).toBeGreaterThan(0)
  }, SLOW)

  it('tells a new deployment to add the first source', async () => {
    serve({ 'GET /admin/water-sources': { body: { items: [], categories: [POTABLE, UTILITY] } } })
    renderPage()
    expect(await screen.findByText('No water sources yet.', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.getByText(/Add the first one, then activate it for a category/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a source' })).toBeInTheDocument()
  }, SLOW)

  it('says it could not load, and Try again loads it', async () => {
    const user = userEvent.setup()
    let failing = true
    serve({ 'GET /admin/water-sources': () => (failing ? { status: 500, body: envelope('internal_error') } : { body: LIST }) })
    renderPage()
    expect(await screen.findByText("We couldn't load the water sources.", {}, { timeout: WAIT })).toBeInTheDocument()
    failing = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Sample Borehole A' }, { timeout: WAIT })).toBeInTheDocument()
  }, SLOW)

  it('shows the shared 403 wording and offers no retry', async () => {
    serve({ 'GET /admin/water-sources': { status: 403, body: envelope('forbidden') } })
    renderPage()
    expect(await screen.findByText("You can't open this page.", {}, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  }, SLOW)
})

describe('adding and editing a source', () => {
  it('names the missing fields, then adds a source with no kind yet', async () => {
    const user = userEvent.setup()
    const added = { ...BOREHOLE, id: 's3', name: 'New Borehole', approximate_location: 'Near the gate', kind: null, activations: [] }
    serve({ 'POST /admin/water-sources': { status: 201, body: added } })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Add a source' }, { timeout: WAIT }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Add source' }))
    expect(within(dialog).getByText('Enter a name.')).toBeInTheDocument()
    expect(within(dialog).getByText('Enter a location.')).toBeInTheDocument()
    expect(writes()).toEqual([])

    await user.type(within(dialog).getByLabelText('Name'), '  New Borehole ')
    await user.type(within(dialog).getByLabelText('Location'), 'Near the gate')
    await user.click(within(dialog).getByRole('button', { name: 'Add source' }))
    expect(await screen.findByText('Source added. Activate it for a category before it can serve an order.', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(writes()).toEqual([{ method: 'POST', path: '/admin/water-sources', body: { name: 'New Borehole', approximate_location: 'Near the gate', kind: null } }])
    expect(screen.queryByRole('alertdialog')).toBeNull()
  }, SLOW)

  it('keeps Save changes off until something differs, then sends only that field', async () => {
    const user = userEvent.setup()
    serve({ 'PATCH /admin/water-sources/s1': { body: { ...BOREHOLE, name: 'Sample Borehole B' } } })
    renderPage()
    const borehole = await card('Sample Borehole A')
    await user.click(borehole.getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('alertdialog')
    const save = within(dialog).getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()
    const name = within(dialog).getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Sample Borehole B')
    expect(save).toBeEnabled()
    await user.click(save)
    expect(await screen.findByText('Source updated.', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(writes()).toEqual([{ method: 'PATCH', path: '/admin/water-sources/s1', body: { name: 'Sample Borehole B' } }])
  }, SLOW)
})

describe('activating, renewing, suspending and revoking', () => {
  it('shows the line that the app does not check the report, and no "report checked" control', async () => {
    const user = userEvent.setup()
    renderPage()
    const borehole = await card('Sample Borehole A')
    await user.click(borehole.getByRole('button', { name: 'Activate' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Activate for Potable Water')).toBeInTheDocument()
    expect(within(dialog).getByText('MmiriOma records the report reference. The app does not check the laboratory report.')).toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
  }, SLOW)

  it('refuses a past date and a third decimal, then activates with the cost in whole kobo', async () => {
    const user = userEvent.setup()
    serve({ 'PUT /admin/water-sources/s1/activations/c-potable': { body: BOREHOLE } })
    renderPage()
    const borehole = await card('Sample Borehole A')
    await user.click(borehole.getByRole('button', { name: 'Activate' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.type(within(dialog).getByLabelText('Report reference'), 'SAMPLE-LR-0009')
    fireEvent.change(within(dialog).getByLabelText('Approved until'), { target: { value: '2020-01-01' } })
    await user.type(within(dialog).getByLabelText('Cost per litre (₦)'), '1.505')
    await user.click(within(dialog).getByRole('button', { name: 'Activate' }))
    expect(within(dialog).getByText('Choose a date from today.')).toBeInTheDocument()
    expect(within(dialog).getByText('Enter the cost as naira, for example 1.50.')).toBeInTheDocument()
    expect(writes()).toEqual([])

    const until = inDays(90)
    fireEvent.change(within(dialog).getByLabelText('Approved until'), { target: { value: until } })
    const cost = within(dialog).getByLabelText('Cost per litre (₦)')
    await user.clear(cost)
    await user.type(cost, '1.50')
    await user.click(within(dialog).getByRole('button', { name: 'Activate' }))
    expect(await screen.findByText('Activated for Potable Water.', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(writes()).toEqual([
      { method: 'PUT', path: '/admin/water-sources/s1/activations/c-potable', body: { approved_until: until, report_reference: 'SAMPLE-LR-0009', cost_per_litre_minor_units: 150 } },
    ])
  }, SLOW)

  it('renews with the current values filled in and says Renewed', async () => {
    const user = userEvent.setup()
    serve({ 'PUT /admin/water-sources/s1/activations/c-utility': { body: BOREHOLE } })
    renderPage()
    const borehole = await card('Sample Borehole A')
    await user.click(borehole.getByRole('button', { name: 'Renew' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Renew for Utility Water')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Report reference')).toHaveValue('SAMPLE-LR-0001')
    expect(within(dialog).getByLabelText('Cost per litre (₦)')).toHaveValue('1.50')
    await user.click(within(dialog).getByRole('button', { name: 'Renew' }))
    expect(await screen.findByText('Renewed for Utility Water.', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(writes()[0]).toMatchObject({ method: 'PUT', body: { cost_per_litre_minor_units: 150, report_reference: 'SAMPLE-LR-0001' } })
  }, SLOW)

  it('needs a reason to suspend, explains what it does, then suspends', async () => {
    const user = userEvent.setup()
    serve({ 'POST /admin/water-sources/s1/activations/c-utility/status': { body: BOREHOLE } })
    renderPage()
    const borehole = await card('Sample Borehole A')
    await user.click(borehole.getByRole('button', { name: 'Suspend' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/From now on this source cannot be chosen for new orders in this category/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Suspend' }))
    expect(within(dialog).getByText('Say why.')).toBeInTheDocument()
    expect(writes()).toEqual([])
    await user.type(within(dialog).getByLabelText('Reason'), 'Supplier reported a pump repair.')
    await user.click(within(dialog).getByRole('button', { name: 'Suspend' }))
    expect(await screen.findByText('Suspended for Utility Water.', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(writes()).toEqual([
      { method: 'POST', path: '/admin/water-sources/s1/activations/c-utility/status', body: { status: 'suspended', reason: 'Supplier reported a pump repair.' } },
    ])
  }, SLOW)

  it('says the source changed when the server answers 404, keeps the dialog, and Refresh reloads', async () => {
    const user = userEvent.setup()
    serve({ 'POST /admin/water-sources/s1/activations/c-utility/status': { status: 404, body: envelope('activation_not_found') } })
    renderPage()
    const borehole = await card('Sample Borehole A')
    await user.click(borehole.getByRole('button', { name: 'Revoke' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.type(within(dialog).getByLabelText('Reason'), 'Withdrawn.')
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }))
    expect(await within(dialog).findByText(/This source has changed or been removed\./, {}, { timeout: WAIT })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Reason')).toHaveValue('Withdrawn.')
    const before = calls.filter((c) => c.method === 'GET' && c.path === '/admin/water-sources').length
    await user.click(within(dialog).getByRole('button', { name: 'Refresh' }))
    await vi.waitFor(() => expect(calls.filter((c) => c.method === 'GET' && c.path === '/admin/water-sources').length).toBeGreaterThan(before), { timeout: WAIT })
    expect(screen.queryByRole('alertdialog')).toBeNull()
  }, SLOW)

  it('keeps what was typed and says to try again on a server error', async () => {
    const user = userEvent.setup()
    serve({ 'POST /admin/water-sources/s1/activations/c-utility/status': { status: 500, body: envelope('internal_error', 'SELECT secret FROM x') } })
    renderPage()
    const borehole = await card('Sample Borehole A')
    await user.click(borehole.getByRole('button', { name: 'Suspend' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.type(within(dialog).getByLabelText('Reason'), 'Pump repair.')
    await user.click(within(dialog).getByRole('button', { name: 'Suspend' }))
    expect(await within(dialog).findByText("We couldn't save this. Try again.", {}, { timeout: WAIT })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Reason')).toHaveValue('Pump repair.')
    expect(document.body.textContent).not.toContain('SELECT')
  }, SLOW)
})
