// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '../../App'
import { getMe, login, logout, register, type Session } from '../../lib/api/auth'
import { ApiError } from '../../lib/api/client'
import { createQueryClient } from '../../lib/queryClient'
import { SessionProvider } from './SessionProvider'
import { SESSION_QUERY_KEY } from './sessionQuery'

/*
 * End-to-end flows through the real routes, guards and session provider,
 * with the auth API functions mocked (no server).
 */

vi.mock('../../lib/api/auth', () => ({
  getMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
}))
// The admin sidebar's API status check is not under test.
vi.mock('../../lib/api/health', () => ({ getHealth: () => new Promise(() => {}) }))

const getMeMock = vi.mocked(getMe)
const loginMock = vi.mocked(login)
const logoutMock = vi.mocked(logout)
const registerMock = vi.mocked(register)

function session(
  role: 'customer' | 'admin',
  name: string,
  phoneVerified = false,
): Session {
  return {
    user: {
      id: `${role}-1`,
      name,
      phone: '+2348000000001',
      role,
      phone_verified: phoneVerified,
    },
    csrf_token: 'csrf',
    expires_at: '2026-10-22T09:00:00Z',
  }
}
const CUSTOMER = session('customer', 'Sample Customer')
const DISPATCHER = session('admin', 'Sample Dispatcher')

function apiError(code: string, status: number | null, details: unknown = null) {
  return new ApiError({
    kind: status === null ? 'network' : 'http',
    status,
    code,
    message: code,
    details,
  })
}
const notAuthenticated = () => apiError('not_authenticated', 401)

/** Shows the router's current path and query so tests can assert redirects. */
function LocationProbe() {
  const location = useLocation()
  return (
    <output data-testid="location">{`${location.pathname}${location.search}`}</output>
  )
}

function renderApp(url: string) {
  const queryClient = createQueryClient()
  // No retries in tests, so failures show at once.
  queryClient.setDefaultOptions({ queries: { retry: false } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <SessionProvider>
          <AppRoutes />
          <LocationProbe />
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { queryClient, user: userEvent.setup() }
}

const location = () => screen.getByTestId('location').textContent

beforeEach(() => {
  getMeMock.mockRejectedValue(notAuthenticated())
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('customer app', () => {
  it('shows the welcome screen to a signed-out visitor after the session check', async () => {
    renderApp('/')
    expect(await screen.findByRole('link', { name: 'Create account' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy()
  })

  it('wrong password: banner, phone kept, password cleared', async () => {
    loginMock.mockRejectedValue(apiError('invalid_credentials', 401))
    const { user } = renderApp('/sign-in')
    const phone = await screen.findByLabelText('Phone number')
    const password = screen.getByLabelText('Password')
    await user.type(phone, '0800 000 0001')
    await user.type(password, 'wrong-pass')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Phone number or password is incorrect')).toBeTruthy()
    expect((phone as HTMLInputElement).value).toBe('0800 000 0001')
    expect((password as HTMLInputElement).value).toBe('')
    expect(loginMock).toHaveBeenCalledWith({
      phone: '0800 000 0001',
      password: 'wrong-pass',
    })
  })

  it('checks the phone format before sending anything', async () => {
    const { user } = renderApp('/sign-in')
    await user.type(await screen.findByLabelText('Phone number'), '0800 000 00')
    await user.type(screen.getByLabelText('Password'), 'whatever')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(
      await screen.findByText('Enter a Nigerian mobile number, for example 08000000001'),
    ).toBeTruthy()
    expect(loginMock).not.toHaveBeenCalled()
  })

  it('rate limit: wait in minutes and the button stays off', async () => {
    loginMock.mockRejectedValue(
      apiError('too_many_attempts', 429, { retry_after_seconds: 899 }),
    )
    const { user } = renderApp('/sign-in')
    await user.type(await screen.findByLabelText('Phone number'), '08000000001')
    await user.type(screen.getByLabelText('Password'), 'sample-pass')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Try again in 15 minutes')).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('create account: success opens home with the one-time notice; Got it hides it', async () => {
    registerMock.mockResolvedValue(CUSTOMER)
    const { user } = renderApp('/create-account')
    await user.type(await screen.findByLabelText('Full name'), 'Sample Customer')
    await user.type(screen.getByLabelText('Phone number'), '08000000001')
    await user.type(screen.getByLabelText('Password'), 'sample-pass')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    const notice =
      'A team member will confirm your phone number before your first delivery is confirmed.'
    expect(await screen.findByText(notice)).toBeTruthy()
    expect(location()).toBe('/')
    expect(
      screen.getByText("We'll confirm your phone number before your first delivery."),
    ).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByText(notice)).toBeNull())
  })

  it('account exists: "Sign in instead" carries the phone to sign in', async () => {
    registerMock.mockRejectedValue(apiError('phone_already_registered', 409))
    const { user } = renderApp('/create-account')
    await user.type(await screen.findByLabelText('Full name'), 'Sample Customer')
    await user.type(screen.getByLabelText('Phone number'), '0800 000 0001')
    await user.type(screen.getByLabelText('Password'), 'sample-pass')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await user.click(await screen.findByRole('button', { name: 'Sign in instead' }))

    await waitFor(() => expect(location()).toBe('/sign-in'))
    const phone = (await screen.findByLabelText('Phone number')) as HTMLInputElement
    expect(phone.value).toBe('0800 000 0001')
  })

  it('a staff account in the customer app sees the wrong-app screen', async () => {
    getMeMock.mockResolvedValue(DISPATCHER)
    renderApp('/')
    expect(
      await screen.findByText(
        'This account is for MmiriOma staff. Use the staff or driver app.',
      ),
    ).toBeTruthy()
  })

  it('session ended while open: sign-in screen with the X2 banner', async () => {
    getMeMock.mockResolvedValue(CUSTOMER)
    const { queryClient } = renderApp('/')
    expect(await screen.findByRole('button', { name: /Sample Customer/ })).toBeTruthy()

    getMeMock.mockRejectedValue(notAuthenticated())
    await act(() => queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY }))

    expect(
      await screen.findByText('Your session has ended. Please sign in again.'),
    ).toBeTruthy()
    expect(location()).toBe('/sign-in')
  })

  it('no connection on start: Retry checks again', async () => {
    getMeMock.mockRejectedValueOnce(apiError('network_error', null))
    getMeMock.mockRejectedValueOnce(notAuthenticated())
    const { user } = renderApp('/')
    await user.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('link', { name: 'Create account' })).toBeTruthy()
  })

  it('sign out returns to welcome with the toast', async () => {
    getMeMock.mockResolvedValue(CUSTOMER)
    logoutMock.mockResolvedValue(undefined)
    const { user } = renderApp('/')
    await user.click(await screen.findByRole('button', { name: /Sample Customer/ }))
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByText("You've signed out.")).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Create account' })).toBeTruthy()
    expect(screen.queryByText('Your session has ended. Please sign in again.')).toBeNull()
  })

  it('sign out offline: error toast, still signed in, Try again works', async () => {
    getMeMock.mockResolvedValue(CUSTOMER)
    logoutMock.mockRejectedValueOnce(apiError('network_error', null))
    logoutMock.mockResolvedValueOnce(undefined)
    const { user } = renderApp('/')
    await user.click(await screen.findByRole('button', { name: /Sample Customer/ }))
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(
      await screen.findByText("Couldn't sign out. Check your connection and try again."),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: /Sample Customer/ })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText("You've signed out.")).toBeTruthy()
  })

  it('sign out security failure: X3 banner with Reload in the account panel', async () => {
    getMeMock.mockResolvedValue(CUSTOMER)
    logoutMock.mockRejectedValue(apiError('csrf_failed', 403))
    const { user } = renderApp('/')
    await user.click(await screen.findByRole('button', { name: /Sample Customer/ }))
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(
      await screen.findByText(
        'Security token missing or invalid. Reload the page and try again.',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  })
})

describe('staff app', () => {
  it('redirects to staff sign-in, then back to the page and filters', async () => {
    loginMock.mockResolvedValue(DISPATCHER)
    const { user } = renderApp('/admin/orders?status=quote_requested')
    await waitFor(() => expect(location()).toBe('/admin/sign-in'))
    expect(screen.getByRole('heading', { name: 'MmiriOma staff' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Create account' })).toBeNull()

    await user.type(screen.getByLabelText('Phone number'), '08000000001')
    await user.type(screen.getByLabelText('Password'), 'sample-pass')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(location()).toBe('/admin/orders?status=quote_requested'))
    expect(screen.getAllByText('Sample Dispatcher').length).toBeGreaterThan(0)
  })

  it('a customer account in the staff app sees "You do not have access to this page."', async () => {
    getMeMock.mockResolvedValue(CUSTOMER)
    renderApp('/admin/orders')
    expect(await screen.findByText('You do not have access to this page.')).toBeTruthy()
  })

  it('sign out lands on staff sign-in with the toast (regression: no bounce back)', async () => {
    getMeMock.mockResolvedValue(DISPATCHER)
    logoutMock.mockResolvedValue(undefined)
    const { user } = renderApp('/admin/orders')
    await screen.findAllByText('Sample Dispatcher')
    // jsdom applies no CSS, so both the sidebar and the top-bar panel exist;
    // use the sidebar's button (the first one).
    await user.click(screen.getAllByRole('button', { name: 'Sign out' })[0])

    expect(await screen.findByText("You've signed out.")).toBeTruthy()
    expect(location()).toBe('/admin/sign-in')
    expect(screen.queryByText('Your session has ended. Please sign in again.')).toBeNull()
  })
})
