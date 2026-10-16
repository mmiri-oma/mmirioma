// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '../../App'
import { getMe, login, logout, type Session } from '../../lib/api/auth'
import { ApiError } from '../../lib/api/client'
import type { OrderCreate, OrderRead } from '../../lib/api/orders'
import { createQueryClient } from '../../lib/queryClient'
import { SessionProvider } from '../auth/SessionProvider'
import { SESSION_QUERY_KEY } from '../auth/sessionQuery'
import { MOCK_CUSTOMER_ORDERS, createMockCustomerOrdersSource } from './mockCustomerOrders'
import { RequestDraftContext, createRequestDraftStore } from './requestDraft'
import { CustomerOrdersSourceContext, type CustomerOrdersSource } from './source'

/*
 * Customer ordering flows (S1-05) through the real routes, guards and session
 * provider. The auth API is mocked and orders come from an in-memory source,
 * so no server is needed.
 */

vi.mock('../../lib/api/auth', () => ({
  getMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
}))

const getMeMock = vi.mocked(getMe)
const loginMock = vi.mocked(login)
const logoutMock = vi.mocked(logout)

const CUSTOMER: Session = {
  user: {
    id: 'customer-1',
    name: 'Ada Sample',
    phone: '+2348000000001',
    role: 'customer',
    phone_verified: false,
  },
  csrf_token: 'csrf',
  expires_at: '2026-10-22T09:00:00Z',
}

const ORDER: OrderRead = {
  reference: 'MO-7KQ2M9XH4T',
  status: 'quote_requested',
  quantity_litres: 200,
  contact_name: 'Ada Sample',
  contact_phone: '+2348000000001',
  delivery_address: '12 Sample Close, Independence Layout, Enugu',
  landmark: null,
  delivery_instructions: null,
  preferred_delivery_date: null,
  created_at: '2026-10-14T09:30:00Z',
  updated_at: '2026-10-14T09:30:00Z',
}

function apiError(code: string, status: number | null, details: unknown = null) {
  return new ApiError({
    kind: status === null ? 'network' : 'http',
    status,
    code,
    message: code === 'network_error' ? 'Unable to reach the server. Check your connection and try again.' : code,
    details,
  })
}

/** Many orders, for paging: `count` copies of ORDER with distinct references. */
function manyOrders(count: number): OrderRead[] {
  return Array.from({ length: count }, (_, index) => ({
    ...ORDER,
    reference: `MO-TEST${String(index).padStart(6, '0')}`,
  }))
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

/**
 * Render the app at `url` with `source` for orders and a fresh draft store.
 * Every source method is a spy around the given (or default) source.
 */
function renderApp(url: string, source: CustomerOrdersSource = createMockCustomerOrdersSource({ latencyMs: 0, orders: [] })) {
  const spied: CustomerOrdersSource = {
    isMock: source.isMock,
    createOrder: vi.fn((input: OrderCreate) => source.createOrder(input)),
    listOrders: vi.fn((params, signal) => source.listOrders(params, signal)),
    getOrder: vi.fn((reference, signal) => source.getOrder(reference, signal)),
  }
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { retry: false } })
  const store = createRequestDraftStore()
  render(
    <QueryClientProvider client={queryClient}>
      <CustomerOrdersSourceContext value={spied}>
        <RequestDraftContext value={store}>
          <MemoryRouter initialEntries={[url]}>
            <SessionProvider>
              <AppRoutes />
              <LocationProbe />
            </SessionProvider>
          </MemoryRouter>
        </RequestDraftContext>
      </CustomerOrdersSourceContext>
    </QueryClientProvider>,
  )
  return { source: spied, store, queryClient, user: userEvent.setup() }
}

const location = () => screen.getByTestId('location').textContent

/** Fill the request form with valid values (receiver is prefilled). */
async function fillRequest(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('radio', { name: '200 litres' }))
  await user.type(
    screen.getByLabelText('Delivery address'),
    '12 Sample Close, Independence Layout, Enugu',
  )
}

const sendButton = () => screen.getByRole('button', { name: /Send request|Sending request/ })

beforeEach(() => {
  getMeMock.mockResolvedValue(CUSTOMER)
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('O1 My orders', () => {
  it('lists own orders newest first with customer wording, 20 at a time', async () => {
    const { source, user } = renderApp(
      '/',
      createMockCustomerOrdersSource({ latencyMs: 0, orders: manyOrders(25) }),
    )
    expect(await screen.findByText('Showing 20 of 25 orders')).toBeTruthy()
    expect(source.listOrders).toHaveBeenCalledWith({ limit: 20, offset: 0 }, expect.anything())
    expect(screen.getAllByRole('link', { name: /MO-TEST/ })).toHaveLength(20)

    await user.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('Showing 25 of 25 orders')).toBeTruthy()
    expect(source.listOrders).toHaveBeenLastCalledWith({ limit: 20, offset: 20 }, expect.anything())
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('shows "Confirmed" for an assigned order, never the assignment (FR-032)', async () => {
    renderApp(
      '/',
      createMockCustomerOrdersSource({ latencyMs: 0, orders: [{ ...ORDER, status: 'assigned' }] }),
    )
    const card = await screen.findByRole('link', { name: /MO-7KQ2M9XH4T/ })
    expect(within(card).getAllByText('Confirmed').length).toBeGreaterThan(0)
    expect(within(card).queryByText(/assigned/i)).toBeNull()
  })

  it('card shows quantity, address, Lagos time, and no price', async () => {
    renderApp(
      '/',
      createMockCustomerOrdersSource({
        latencyMs: 0,
        orders: [{ ...ORDER, preferred_delivery_date: '2026-10-16' }],
      }),
    )
    const card = await screen.findByRole('link', { name: /MO-7KQ2M9XH4T/ })
    expect(card.getAttribute('href')).toBe('/orders/MO-7KQ2M9XH4T')
    expect(within(card).getByText('200 litres')).toBeTruthy()
    expect(within(card).getByText('Preferred date: Fri 16 Oct 2026')).toBeTruthy()
    expect(within(card).getByText('Sent Wed 14 Oct 2026, 10:30 am')).toBeTruthy()
    expect(within(card).getAllByText('Request received').length).toBeGreaterThan(0)
    expect(card.textContent).not.toMatch(/₦|confirmed/i)
  })

  it('empty: the empty card holds the only Request water button, under the X6 banner', async () => {
    renderApp('/')
    expect(await screen.findByText('You have no orders yet')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Request water' })).toHaveLength(2) // nav + empty card
    expect(screen.getByText("We'll confirm your phone number before your first delivery.")).toBeTruthy()
  })

  it('could not load: Retry repeats the request; Request water still works', async () => {
    const source = createMockCustomerOrdersSource({ latencyMs: 0, orders: [ORDER] })
    const failing: CustomerOrdersSource = {
      ...source,
      listOrders: vi
        .fn<CustomerOrdersSource['listOrders']>()
        .mockRejectedValueOnce(apiError('network_error', null))
        .mockImplementation((params, signal) => source.listOrders(params, signal)),
    }
    const { user } = renderApp('/', failing)
    expect(await screen.findByText("We couldn't load your orders")).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Request water' }).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('link', { name: /MO-7KQ2M9XH4T/ })).toBeTruthy()
  })

  it('load-more failure keeps the orders shown and retries the same page', async () => {
    const source = createMockCustomerOrdersSource({ latencyMs: 0, orders: manyOrders(21) })
    const listOrders = vi.fn<CustomerOrdersSource['listOrders']>((params, signal) =>
      source.listOrders(params, signal),
    )
    listOrders.mockImplementationOnce((params, signal) => source.listOrders(params, signal))
    listOrders.mockRejectedValueOnce(apiError('network_error', null))
    const { user } = renderApp('/', { ...source, listOrders })

    await user.click(await screen.findByRole('button', { name: 'Load more' }))
    expect(await screen.findByText("We couldn't load more orders")).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /MO-TEST/ })).toHaveLength(20)

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Showing 21 of 21 orders')).toBeTruthy()
    expect(listOrders).toHaveBeenLastCalledWith({ limit: 20, offset: 20 }, expect.anything())
  })

  it('shows the sample-data notice only while mock data is used (BR-09)', async () => {
    renderApp('/')
    expect(await screen.findByText(/requests are not sent to MmiriOma/)).toBeTruthy()
    cleanup()

    const real = { ...createMockCustomerOrdersSource({ latencyMs: 0, orders: [] }), isMock: false }
    renderApp('/', real)
    expect(await screen.findByText('You have no orders yet')).toBeTruthy()
    expect(screen.queryByText(/requests are not sent to MmiriOma/)).toBeNull()
  })
})

describe('O2 Request water', () => {
  it('prefills the receiver from the account', async () => {
    renderApp('/request')
    expect(((await screen.findByLabelText("Receiver's name")) as HTMLInputElement).value).toBe(
      'Ada Sample',
    )
    expect((screen.getByLabelText("Receiver's phone") as HTMLInputElement).value).toBe(
      '0800 000 0001',
    )
    expect(
      screen.getByText(
        "We'll send you the total price before anything is confirmed. You don't pay anything now.",
      ),
    ).toBeTruthy()
  })

  it('field errors: summary takes focus, values kept, nothing sent', async () => {
    const { source, user } = renderApp('/request')
    await user.click(await screen.findByRole('radio', { name: /Other amount/ }))
    await user.type(screen.getByLabelText('Amount'), '0')
    await user.clear(screen.getByLabelText("Receiver's phone"))
    await user.type(screen.getByLabelText("Receiver's phone"), '0800 000 00')
    await user.type(screen.getByLabelText('Delivery address'), 'Enu')
    await user.click(sendButton())

    const summary = await screen.findByText('Check 3 things before sending')
    await waitFor(() => expect(summary.closest('[tabindex="-1"]')).toBe(document.activeElement))
    expect(screen.getByRole('link', { name: 'Amount' })).toBeTruthy()
    expect(screen.getByText('Enter a whole number of litres from 1 to 100,000.')).toBeTruthy()
    expect(screen.getByText('Enter the full delivery address (at least 5 characters).')).toBeTruthy()
    expect((screen.getByLabelText('Delivery address') as HTMLTextAreaElement).value).toBe('Enu')
    expect(source.createOrder).not.toHaveBeenCalled()
  })

  it('asks for a quantity when no tile is chosen', async () => {
    const { user } = renderApp('/request')
    await user.type(await screen.findByLabelText('Delivery address'), '12 Sample Close')
    await user.click(sendButton())
    expect(await screen.findByText('Choose how much water you need.')).toBeTruthy()
    expect(screen.getByText('Check 1 thing before sending')).toBeTruthy()
  })

  it('sends once, then shows Request received in place of the form (FR-026, FR-027)', async () => {
    const { source, user } = renderApp('/request')
    await fillRequest(user)
    await user.type(screen.getByLabelText(/Landmark/), '  Opposite the blue gate ')
    // Two quick submits: only one request goes out (NFR-022).
    await user.dblClick(sendButton())

    expect(await screen.findByRole('heading', { level: 1, name: 'Request received' })).toBeTruthy()
    expect(source.createOrder).toHaveBeenCalledTimes(1)
    expect(vi.mocked(source.createOrder).mock.calls[0][0]).toEqual({
      idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/),
      quantity_litres: 200,
      contact_name: 'Ada Sample',
      contact_phone: '0800 000 0001',
      delivery_address: '12 Sample Close, Independence Layout, Enugu',
      landmark: 'Opposite the blue gate',
    })
    expect(location()).toBe('/request/received')
    expect(
      screen.getByText(
        "We've got your request. It is not a confirmed delivery yet: we'll send you a price first.",
      ),
    ).toBeTruthy()
    expect(screen.getByText(/^MO-[0-9A-Z]{10}$/)).toBeTruthy()
    expect(screen.getByText('Opposite the blue gate')).toBeTruthy()
    // Optional fields that were not given are hidden on O3 (Decision 6).
    expect(screen.queryByText('Preferred delivery date')).toBeNull()
    expect(screen.queryByText(/order confirmed/i)).toBeNull()
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 })),
    )
  })

  it('locks the form while sending', async () => {
    let finish: (order: OrderRead) => void = () => {}
    const source: CustomerOrdersSource = {
      ...createMockCustomerOrdersSource({ latencyMs: 0, orders: [] }),
      createOrder: () => new Promise((resolve) => (finish = resolve)),
    }
    const { user } = renderApp('/request', source)
    await fillRequest(user)
    await user.click(sendButton())

    expect(await screen.findByRole('button', { name: 'Sending request' })).toBeTruthy()
    expect((screen.getByLabelText('Delivery address') as HTMLTextAreaElement).readOnly).toBe(true)
    expect((screen.getByLabelText("Receiver's name") as HTMLInputElement).readOnly).toBe(true)
    // A locked tile ignores clicks.
    await user.click(screen.getByRole('radio', { name: '500 litres' }))
    expect((screen.getByRole('radio', { name: '200 litres' }) as HTMLInputElement).checked).toBe(true)

    await act(async () => finish(ORDER))
    expect(await screen.findByRole('heading', { name: 'Request received' })).toBeTruthy()
  })

  it('no connection: banner, values kept, Retry resends with the same key (T-06)', async () => {
    const source = createMockCustomerOrdersSource({ latencyMs: 0, orders: [] })
    const createOrder = vi
      .fn<CustomerOrdersSource['createOrder']>()
      .mockRejectedValueOnce(apiError('network_error', null))
      .mockImplementation((input) => source.createOrder(input))
    const { user } = renderApp('/request', { ...source, createOrder })
    await fillRequest(user)
    await user.click(sendButton())

    expect(await screen.findByText('Your request was not sent')).toBeTruthy()
    expect(screen.getByText('Everything you typed is kept.')).toBeTruthy()
    expect((screen.getByLabelText('Delivery address') as HTMLTextAreaElement).value).toBe(
      '12 Sample Close, Independence Layout, Enugu',
    )

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Request received' })).toBeTruthy()
    const [first, second] = createOrder.mock.calls.map(([input]) => input.idempotency_key)
    expect(second).toBe(first)
  })

  it('keeps the same key even after editing a field (Decision 9)', async () => {
    const source = createMockCustomerOrdersSource({ latencyMs: 0, orders: [] })
    const createOrder = vi
      .fn<CustomerOrdersSource['createOrder']>()
      .mockRejectedValueOnce(apiError('internal_server_error', 500))
      .mockImplementation((input) => source.createOrder(input))
    const { user } = renderApp('/request', { ...source, createOrder })
    await fillRequest(user)
    await user.click(sendButton())
    await screen.findByText('Your request was not sent')

    await user.click(screen.getByRole('radio', { name: '300 litres' }))
    await user.click(sendButton())
    await screen.findByRole('heading', { name: 'Request received' })
    expect(createOrder.mock.calls[1][0].idempotency_key).toBe(
      createOrder.mock.calls[0][0].idempotency_key,
    )
    expect(createOrder.mock.calls[1][0].quantity_litres).toBe(300)
  })

  it('409 idempotency_key_reused: opens My orders with "already received", no second order', async () => {
    const source = createMockCustomerOrdersSource({ latencyMs: 0, orders: [ORDER] })
    const createOrder = vi
      .fn<CustomerOrdersSource['createOrder']>()
      .mockRejectedValue(apiError('idempotency_key_reused', 409))
    const { user, store } = renderApp('/request', { ...source, createOrder })
    await fillRequest(user)
    await user.click(sendButton())

    expect(
      await screen.findByText('We already received this request. It is at the top of your list.'),
    ).toBeTruthy()
    expect(location()).toBe('/')
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(store.hasDraft()).toBe(false)
  })

  it('422 validation_error: the message shows under the matching field', async () => {
    const createOrder = vi.fn<CustomerOrdersSource['createOrder']>().mockRejectedValue(
      apiError('validation_error', 422, [
        { loc: ['body', 'delivery_address'], msg: 'too short', type: 'string_too_short' },
      ]),
    )
    const { user } = renderApp('/request', {
      ...createMockCustomerOrdersSource({ latencyMs: 0, orders: [] }),
      createOrder,
    })
    await fillRequest(user)
    await user.click(sendButton())

    expect(
      await screen.findByText('Enter the full delivery address (at least 5 characters).'),
    ).toBeTruthy()
    expect(screen.getByText('Check 1 thing before sending')).toBeTruthy()
    expect(screen.getByLabelText('Delivery address').getAttribute('aria-invalid')).toBe('true')
  })

  it('403 csrf_failed: X3 banner with Reload, values kept', async () => {
    const createOrder = vi
      .fn<CustomerOrdersSource['createOrder']>()
      .mockRejectedValue(apiError('csrf_failed', 403))
    const { user } = renderApp('/request', {
      ...createMockCustomerOrdersSource({ latencyMs: 0, orders: [] }),
      createOrder,
    })
    await fillRequest(user)
    await user.click(sendButton())

    expect(
      await screen.findByText('Security token missing or invalid. Reload the page and try again.'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect((screen.getByLabelText('Delivery address') as HTMLTextAreaElement).value).not.toBe('')
  })

  it('session ends while typing: X2 says the request is kept, and the form reopens filled (Decision 10)', async () => {
    const source = createMockCustomerOrdersSource({ latencyMs: 0, orders: [] })
    const createOrder = vi
      .fn<CustomerOrdersSource['createOrder']>()
      .mockRejectedValueOnce(apiError('not_authenticated', 401))
      .mockImplementation((input) => source.createOrder(input))
    getMeMock.mockResolvedValueOnce(CUSTOMER).mockRejectedValue(apiError('not_authenticated', 401))
    const { user } = renderApp('/request', { ...source, createOrder })
    await fillRequest(user)
    await user.click(sendButton())

    expect(await screen.findByText('Your session has ended. Please sign in again.')).toBeTruthy()
    expect(
      screen.getByText('Your request has not been sent. What you typed is kept.'),
    ).toBeTruthy()
    expect(location()).toBe('/sign-in')

    loginMock.mockResolvedValue(CUSTOMER)
    await user.type(screen.getByLabelText('Phone number'), '08000000001')
    await user.type(screen.getByLabelText('Password'), 'sample-pass')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const address = (await screen.findByLabelText('Delivery address')) as HTMLTextAreaElement
    expect(location()).toBe('/request')
    expect(address.value).toBe('12 Sample Close, Independence Layout, Enugu')
    await user.click(sendButton())
    await screen.findByRole('heading', { name: 'Request received' })
    expect(createOrder.mock.calls[1][0].idempotency_key).toBe(
      createOrder.mock.calls[0][0].idempotency_key,
    )
  })

  it('signing out clears the typed request (Decision 10)', async () => {
    logoutMock.mockResolvedValue(undefined)
    const { user, store } = renderApp('/request')
    await fillRequest(user)
    expect(store.hasDraft()).toBe(true)

    await user.click(screen.getByRole('button', { name: /Ada Sample/ }))
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(store.hasDraft()).toBe(false))
  })

  it('a new form after a sent request starts empty with a new key', async () => {
    const { source, user } = renderApp('/request')
    await fillRequest(user)
    await user.click(sendButton())
    await user.click(await screen.findByRole('link', { name: 'Request more water' }))

    expect(((await screen.findByLabelText('Delivery address')) as HTMLTextAreaElement).value).toBe('')
    await fillRequest(user)
    await user.click(sendButton())
    await screen.findByRole('heading', { name: 'Request received' })
    const keys = vi.mocked(source.createOrder).mock.calls.map(([input]) => input.idempotency_key)
    expect(keys[1]).not.toBe(keys[0])
  })
})

describe('O3 Request received', () => {
  it('opened without an order (after a reload) goes to My orders', async () => {
    renderApp('/request/received')
    await waitFor(() => expect(location()).toBe('/'))
  })
})

describe('O4 Order detail', () => {
  it('shows every field, the status explanation and "None given" for empty fields', async () => {
    renderApp(
      '/orders/MO-7KQ2M9XH4T',
      createMockCustomerOrdersSource({ latencyMs: 0, orders: [ORDER] }),
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'MO-7KQ2M9XH4T' })).toBeTruthy()
    expect(screen.getByText("We're preparing your price.")).toBeTruthy()
    expect(screen.getByText('Sent Wed 14 Oct 2026, 10:30 am')).toBeTruthy()
    expect(screen.getByText('Last updated Wed 14 Oct 2026, 10:30 am')).toBeTruthy()
    expect(screen.getByText('200 litres')).toBeTruthy()
    expect(screen.getByText('0800 000 0001')).toBeTruthy()
    expect(screen.getAllByText('None given')).toHaveLength(3)
    expect(
      screen.getByText('To change or cancel this request, contact us and quote the reference.'),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: /cancel|edit/i })).toBeNull()
    expect(document.body.textContent).not.toMatch(/₦/)
  })

  it('shows the same "Order not found" for unknown and other customers\' orders (T-07)', async () => {
    renderApp('/orders/MO-0000000000', createMockCustomerOrdersSource({ latencyMs: 0, orders: [] }))
    expect(await screen.findByText('Order not found')).toBeTruthy()
    expect(screen.getByText('Check the reference, or find the order in your list.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to my orders' })).toBeTruthy()
  })

  it('could not load: Retry repeats the request', async () => {
    const source = createMockCustomerOrdersSource({ latencyMs: 0, orders: [ORDER] })
    const getOrder = vi
      .fn<CustomerOrdersSource['getOrder']>()
      .mockRejectedValueOnce(apiError('network_error', null))
      .mockImplementation((reference, signal) => source.getOrder(reference, signal))
    const { user } = renderApp('/orders/MO-7KQ2M9XH4T', { ...source, getOrder })
    expect(await screen.findByText("We couldn't load this order")).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'MO-7KQ2M9XH4T' })).toBeTruthy()
  })

  it('opens from a card on My orders', async () => {
    const { user } = renderApp(
      '/',
      createMockCustomerOrdersSource({ latencyMs: 0, orders: MOCK_CUSTOMER_ORDERS }),
    )
    await user.click(await screen.findByRole('link', { name: /MO-3HV8PZ2D6M/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'MO-3HV8PZ2D6M' })).toBeTruthy()
    expect(
      screen.getByText(
        "You accepted the price. We're checking the details before we confirm a delivery window.",
      ),
    ).toBeTruthy()
  })
})

describe('session handling on customer pages', () => {
  it('a signed-out visitor opening Request water is sent to sign in', async () => {
    getMeMock.mockRejectedValue(apiError('not_authenticated', 401))
    renderApp('/request')
    await waitFor(() => expect(location()).toBe('/sign-in'))
    expect(screen.queryByText('Your request has not been sent. What you typed is kept.')).toBeNull()
  })

  it('a session that ends on My orders shows X2 without the request line', async () => {
    const { queryClient } = renderApp('/')
    await screen.findByText('You have no orders yet')
    getMeMock.mockRejectedValue(apiError('not_authenticated', 401))
    await act(() => queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY }))
    expect(await screen.findByText('Your session has ended. Please sign in again.')).toBeTruthy()
    expect(screen.queryByText('Your request has not been sent. What you typed is kept.')).toBeNull()
  })
})
