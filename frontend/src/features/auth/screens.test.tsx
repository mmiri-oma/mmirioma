import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { PasswordField, Field } from '../../components/ui/Field'
import type { Session } from '../../lib/api/auth'
import type { SessionStatus } from './access'
import { AppGate } from './components/AppGate'
import { AuthBannerView } from './components/AuthBannerView'
import { SessionSplash, WrongAppScreen } from './components/StatusScreens'
import { CreateAccountPage } from './pages/CreateAccountPage'
import { AdminShell } from '../../components/layout/AdminShell'
import { MyOrdersPage } from '../customer-orders/pages/MyOrdersPage'
import { SignInPage } from './pages/SignInPage'
import { WelcomePage } from './pages/WelcomePage'
import { SessionContext } from './sessionContext'

/*
 * Screen tests render static HTML (no DOM library is installed), so they
 * check what each designed state shows, not interaction.
 */

const SESSION: Session = {
  user: {
    id: 'u1',
    name: 'Sample Customer',
    phone: '+2348000000001',
    role: 'customer',
    phone_verified: false,
  },
  csrf_token: 'csrf',
  expires_at: '2026-10-22T09:00:00Z',
}

function render(
  ui: ReactNode,
  {
    status,
    session = null,
    state,
  }: { status: SessionStatus; session?: Session | null; state?: unknown },
): string {
  const value = {
    status,
    session,
    retry: vi.fn(),
    signedIn: vi.fn(),
    signedOut: vi.fn(),
    dismissSignedOutNotice: vi.fn(),
  }
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[{ pathname: '/', state }]}>
        <SessionContext value={value}>{ui}</SessionContext>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const signedOut: SessionStatus = { kind: 'signed-out', ended: false, byUser: false }

describe('sign-in screens (C3, S1)', () => {
  it('customer sign-in has contact guidance and a Create account link, no reset flow', () => {
    const html = render(<SignInPage app="customer" />, { status: signedOut })
    expect(html).toContain('<h1 class="text-h1">Sign in</h1>')
    expect(html).toContain('Forgot your password?')
    expect(html).toContain('Contact us')
    expect(html).toContain('href="/create-account"')
    expect(html).not.toMatch(/reset password|verification code|OTP/i)
  })

  it('staff sign-in has its title, the technical-lead guidance and no sign-up link', () => {
    const html = render(<SignInPage app="staff" />, { status: signedOut })
    expect(html).toContain('MmiriOma staff')
    expect(html).toContain('Forgot your password? Ask the technical lead to reset it.')
    expect(html).not.toContain('Create account')
  })

  it('shows "Your session has ended" when the session ended (X2)', () => {
    const html = render(<SignInPage app="staff" />, {
      status: { kind: 'signed-out', ended: true, byUser: false },
    })
    expect(html).toContain('Your session has ended. Please sign in again.')
    expect(html).toContain('role="status"')
  })

  it('shows the splash, not the form, while checking (X1)', () => {
    const html = render(<SignInPage app="customer" />, { status: { kind: 'checking' } })
    expect(html).toContain('Checking your session')
    expect(html).not.toContain('Password')
  })

  it('offers Retry when the session check cannot reach the server', () => {
    const html = render(<SignInPage app="customer" />, {
      status: { kind: 'unavailable' },
    })
    expect(html).toContain(
      'Unable to reach the server. Check your connection and try again.',
    )
    expect(html).toContain('Retry')
  })

  it('shows the signed-out toast after signing out (X5)', () => {
    const html = render(<SignInPage app="staff" />, {
      status: { kind: 'signed-out', ended: false, byUser: true },
    })
    expect(html).toContain('You&#x27;ve signed out.')
  })
})

describe('create account (C2)', () => {
  it('has the three labelled fields with the designed helpers', () => {
    const html = render(<CreateAccountPage />, { status: signedOut })
    for (const label of ['Full name', 'Phone number', 'Password'])
      expect(html).toContain(`>${label}</label>`)
    expect(html).toContain('We&#x27;ll use this to contact you about deliveries.')
    expect(html).toContain('At least 8 characters.')
    expect(html).toContain('autoComplete="new-password"')
  })
})

describe('banners', () => {
  it('rate limit: warning with the wait in minutes', () => {
    const html = renderToStaticMarkup(
      <AuthBannerView
        banner={{
          tone: 'warning',
          title: 'Too many attempts. Please wait and try again.',
          waitSeconds: 720,
        }}
      />,
    )
    expect(html).toContain('Too many attempts. Please wait and try again.')
    expect(html).toContain('Try again in 12 minutes')
  })

  it('account exists: error with "Sign in instead"', () => {
    const html = renderToStaticMarkup(
      <AuthBannerView
        banner={{
          tone: 'error',
          title: 'An account with this phone number already exists',
          action: 'sign-in-instead',
        }}
        onAction={vi.fn()}
      />,
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('Sign in instead')
  })
})

describe('fields', () => {
  it('links the inline error and marks the field invalid', () => {
    const html = renderToStaticMarkup(
      <Field
        id="p"
        label="Phone number"
        error="Enter a Nigerian mobile number, for example 08000000001"
      />,
    )
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('aria-describedby="p-description"')
    expect(html).toContain('id="p-description"')
  })

  it('locks the password field while sending, keeping it readable', () => {
    const html = renderToStaticMarkup(<PasswordField id="pw" label="Password" locked />)
    expect(html).toContain('readOnly=""')
    expect(html).toContain('aria-label="Show password"')
    expect(html).toContain('disabled=""')
  })
})

describe('session and access states', () => {
  it('X1 splash has a screen-reader label', () => {
    expect(renderToStaticMarkup(<SessionSplash />)).toContain('Checking your session')
  })

  it.each([
    ['customer', 'This account is for MmiriOma staff. Use the staff or driver app.'],
    ['staff', 'You do not have access to this page.'],
  ] as const)('X4 in the %s app', (app, message) => {
    const html = renderToStaticMarkup(
      <WrongAppScreen app={app} onSignOut={vi.fn()} signingOut={false} />,
    )
    expect(html).toContain(message)
    expect(html).toContain('Sign out')
  })

  it('guards the staff app against a customer account (X4)', () => {
    const html = render(<AppGate app="staff">{() => <p>staff page</p>}</AppGate>, {
      status: { kind: 'signed-in', role: 'customer' },
      session: SESSION,
    })
    expect(html).toContain('You do not have access to this page.')
    expect(html).not.toContain('staff page')
  })

  it('shows the welcome screen to a signed-out customer (C1)', () => {
    const html = render(
      <AppGate app="customer" signedOut={<WelcomePage />}>
        {() => <p>home</p>}
      </AppGate>,
      { status: signedOut },
    )
    expect(html).toContain('href="/create-account"')
    expect(html).toContain('href="/sign-in"')
    expect(html).not.toContain('home')
  })

  it('renders the page for the right role', () => {
    const html = render(<AppGate app="customer">{() => <p>home page</p>}</AppGate>, {
      status: { kind: 'signed-in', role: 'customer' },
      session: SESSION,
    })
    expect(html).toContain('home page')
  })
})

describe('signed-in homes', () => {
  it('customer home: unconfirmed-phone banner without a close button (X6)', () => {
    const html = render(<MyOrdersPage session={SESSION} />, {
      status: { kind: 'signed-in', role: 'customer' },
      session: SESSION,
    })
    expect(html).toContain(
      'We&#x27;ll confirm your phone number before your first delivery.',
    )
    expect(html).not.toContain('Got it')
    expect(html).toContain('Sample Customer')
  })

  it('customer home: one-time notice after creating an account', () => {
    const html = render(<MyOrdersPage session={SESSION} />, {
      status: { kind: 'signed-in', role: 'customer' },
      session: SESSION,
      state: { justRegistered: true },
    })
    expect(html).toContain(
      'A team member will confirm your phone number before your first delivery is confirmed.',
    )
    expect(html).toContain('Got it')
  })

  it('customer home: no banner once the phone is confirmed', () => {
    const confirmed = { ...SESSION, user: { ...SESSION.user, phone_verified: true } }
    const html = render(<MyOrdersPage session={confirmed} />, {
      status: { kind: 'signed-in', role: 'customer' },
      session: confirmed,
    })
    expect(html).not.toContain('confirm your phone number')
  })

  it('admin shell: staff name and Sign out (X5)', () => {
    const staff = {
      ...SESSION,
      user: { ...SESSION.user, name: 'Sample Dispatcher', role: 'admin' as const },
    }
    const html = render(<AdminShell user={staff.user} />, {
      status: { kind: 'signed-in', role: 'admin' },
      session: staff,
    })
    expect(html).toContain('Sample Dispatcher')
    expect(html).toContain('Sign out')
  })
})
