// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONSENT_KEY, openCookieSettings, resetAnalyticsForTests } from '../../lib/analytics'
import { CookieConsent } from './CookieConsent'

function renderBanner() {
  return render(
    <MemoryRouter>
      <CookieConsent />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  resetAnalyticsForTests()
  vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST123')
})

afterEach(() => vi.unstubAllEnvs())

describe('CookieConsent', () => {
  it('asks on a first visit, with Accept and Reject side by side', () => {
    renderBanner()
    expect(screen.getByRole('dialog', { name: 'Cookies on Waterline' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept analytics' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Privacy notice' })).toHaveAttribute('href', '/privacy#cookies')
  })

  it('saves Reject, hides, and stays hidden on the next visit', async () => {
    const user = userEvent.setup()
    const { unmount } = renderBanner()
    await user.click(screen.getByRole('button', { name: 'Reject' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(CONSENT_KEY)!)).toMatchObject({ analytics: false })
    unmount()
    resetAnalyticsForTests()
    renderBanner()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('lets the visitor choose in detail, with analytics off unless they switch it on', async () => {
    const user = userEvent.setup()
    renderBanner()
    await user.click(screen.getByRole('button', { name: 'Choose what to allow' }))
    expect(screen.getByRole('checkbox', { name: /Necessary/ })).toBeDisabled()
    const analytics = screen.getByRole('checkbox', { name: /Analytics/ })
    expect(analytics).not.toBeChecked()
    await user.click(analytics)
    await user.click(screen.getByRole('button', { name: 'Save choices' }))
    expect(JSON.parse(window.localStorage.getItem(CONSENT_KEY)!)).toMatchObject({ analytics: true })
  })

  it('comes back from "Cookie settings" with the saved choice', async () => {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ analytics: true, decidedAt: '2026-11-02T10:00:00.000Z' }))
    renderBanner()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    openCookieSettings()
    expect(await screen.findByRole('dialog', { name: 'Cookie settings' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Analytics/ })).toBeChecked()
  })

  it('never shows when analytics is not configured', () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', '')
    renderBanner()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
