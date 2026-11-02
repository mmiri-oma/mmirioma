// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../../app/providers'
import { routes } from '../../app/router'
import { resetMockDb } from '../../mocks/db'
import { FAQS, OBJECTIONS, filterFaqs } from './content'
import { FaqPage } from './FaqPage'
import { MarketingHeader } from './MarketingParts'

beforeAll(() => {
  // jsdom has no layout, so scrolling is a no-op here.
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  Element.prototype.scrollIntoView = vi.fn()
})

describe('filterFaqs', () => {
  it('matches the search in questions and answers, ignoring case', () => {
    expect(filterFaqs('CASH ON DELIVERY', 'All').list.map((f) => f.q)).toEqual(['What payment methods do you accept?'])
    expect(filterFaqs('gateman', 'All').list).toHaveLength(1)
    expect(filterFaqs('   ', 'All').list).toHaveLength(FAQS.length)
  })

  it('counts each category for the current search and filters by category', () => {
    const { counts } = filterFaqs('code', 'All')
    expect(counts['Delivery code']).toBe(3)
    expect(counts.All).toBe(Object.entries(counts).reduce((n, [k, v]) => (k === 'All' ? n : n + v), 0))
    expect(filterFaqs('code', 'Delivery code').list.every((f) => f.cat === 'Delivery code')).toBe(true)
  })

  it('keeps no question that promises what the app does not do', () => {
    const text = [...FAQS, ...OBJECTIONS].map((f) => `${f.q} ${f.a}`).join(' ').toLowerCase()
    expect(text).not.toMatch(/sealed|track your rider live|schedule|one tap|safe to drink|purified|minutes|paystack|points|payout/)
  })
})

describe('FAQ page', () => {
  it('shows the empty state for a search with no match, and Clear search resets search and category', async () => {
    const user = userEvent.setup()
    render(
      <AppProviders>
        <MemoryRouter initialEntries={['/faq']}>
          <FaqPage />
        </MemoryRouter>
      </AppProviders>,
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Frequently asked questions')
    await user.click(screen.getByRole('button', { name: /^Payments/ }))
    expect(screen.getByRole('button', { name: /^Payments/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('2 questions')).toBeInTheDocument()

    await user.type(screen.getByRole('searchbox', { name: 'Search FAQs' }), 'zzzz')
    expect(screen.getByText('No questions match your search.')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /^All/ })).getByText('0')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByRole('searchbox', { name: 'Search FAQs' })).toHaveValue('')
    expect(screen.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(`${FAQS.length} questions`)).toBeInTheDocument()
  })
})

describe('MarketingHeader', () => {
  it('opens the mobile menu and closes it with Escape or a link', async () => {
    const user = userEvent.setup()
    render(
      <AppProviders>
        <MemoryRouter initialEntries={['/']}>
          <MarketingHeader current="home" />
        </MemoryRouter>
      </AppProviders>,
    )
    const button = screen.getByRole('button', { name: 'Open menu' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await user.click(button)
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true')
    expect(document.body.style.overflow).toBe('hidden')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')

    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    await user.click(within(screen.getByRole('navigation', { name: 'Mobile' })).getByRole('link', { name: 'FAQs' }))
    expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument()
  })
})

describe('Check your area', () => {
  it('opens from the header and answers without scrolling the page', async () => {
    const user = userEvent.setup()
    render(
      <AppProviders>
        <MemoryRouter initialEntries={['/']}>
          <MarketingHeader current="home" />
        </MemoryRouter>
      </AppProviders>,
    )
    await user.click(screen.getByRole('button', { name: 'Check your area' }))
    const dialog = screen.getByRole('dialog', { name: 'Do we deliver to you?' })
    await user.type(within(dialog).getByRole('searchbox'), 'trans ekulu')
    expect(within(dialog).getByText('Yes, Trans-Ekulu is on our list.')).toBeInTheDocument()
  })
})

describe('routes', () => {
  function renderAt(path: string) {
    const router = createMemoryRouter(routes, { initialEntries: [path] })
    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    )
    return router
  }

  it('shows the landing page at / to everyone', async () => {
    resetMockDb()
    renderAt('/')
    expect(await screen.findByRole('heading', { level: 1, name: /Water at\s*your gate/ }, { timeout: 10_000 })).toBeInTheDocument()
    const order = screen.getAllByRole('link', { name: /Order Water/ })
    // Sticky header, hero and the closing button after the worries section.
    expect(order.length).toBeGreaterThanOrEqual(3)
    for (const link of order) expect(link).toHaveAttribute('href', '/order')
    const apply = screen.getAllByRole('link', { name: /Become a Rider or Driver/ })
    expect(apply.length).toBeGreaterThan(0)
    for (const link of apply) expect(link).toHaveAttribute('href', '/partner/signup')
  }, 20_000)

  it('tells the story before the details, answers worries before the closing button, with no newsletter (#8)', async () => {
    resetMockDb()
    renderAt('/')
    const why = await screen.findByRole('heading', { level: 2, name: /Water, without the wahala/ }, { timeout: 10_000 })
    const how = screen.getByRole('heading', { level: 2, name: /Four steps from order to a full tank/ })
    const worries = screen.getByRole('heading', { level: 3, name: /Worried about something/ })
    const closing = screen.getByRole('heading', { level: 2, name: /Drums running low/ })
    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(why, how)).toBe(true)
    expect(follows(how, worries)).toBe(true)
    expect(follows(worries, closing)).toBe(true)
    expect(screen.queryByRole('heading', { name: 'Hear first when we reach your area' })).not.toBeInTheDocument()
    for (const o of OBJECTIONS) expect(screen.getByRole('heading', { level: 4, name: o.q })).toBeInTheDocument()
    expect(within(closing.closest('section')!).getByRole('link', { name: /Order Water/ })).toHaveAttribute('href', '/order')
  }, 20_000)

  it('shows a 6-digit sample delivery code and no prices (FR-035, FR-022)', async () => {
    resetMockDb()
    renderAt('/')
    expect(await screen.findByRole('img', { name: 'Sample delivery code 4 8 1 7 3 5' }, { timeout: 10_000 })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/₦/)
  }, 20_000)

  it('has a floating WhatsApp chat button on the support number from the server (FR-055)', async () => {
    resetMockDb()
    renderAt('/')
    const chat = await screen.findByRole('link', { name: /Chat with Waterline on WhatsApp/ }, { timeout: 10_000 })
    expect(chat).toHaveAttribute('href', expect.stringMatching(/^https:\/\/wa\.me\/2348133774902\?text=/))
    expect(chat).toHaveAttribute('target', '_blank')
    expect(chat).toHaveAttribute('rel', 'noopener noreferrer')
  }, 20_000)

  it('shows the 404 page with a way out for the part of the site the link was in', async () => {
    resetMockDb()
    renderAt('/no-such-page')
    expect(await screen.findByRole('heading', { level: 1, name: "This page doesn't exist" }, { timeout: 10_000 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Order Water' })).toHaveAttribute('href', '/order')
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/')
  }, 20_000)

  it('sends a broken driver-app link back to the driver app', async () => {
    resetMockDb()
    renderAt('/partner/no-such-page')
    expect(await screen.findByRole('link', { name: 'Go to the driver app' }, { timeout: 10_000 })).toHaveAttribute('href', '/partner/')
  }, 20_000)

  // /app loads the lazy sign-in page; allow for a slow machine or CI runner.
  it('still sends /app to sign-in when signed out', async () => {
    resetMockDb()
    const router = renderAt('/app')
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/signin'), { timeout: 10_000 })
  }, 20_000)
})
