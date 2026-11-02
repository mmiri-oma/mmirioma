// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONSENT_KEY,
  cookieSettingsOpen,
  currentConsent,
  openCookieSettings,
  readConsent,
  resetAnalyticsForTests,
  saveConsent,
  startAnalytics,
  track,
} from './analytics'

const gaScripts = () => document.head.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]')

beforeEach(() => {
  window.localStorage.clear()
  resetAnalyticsForTests()
  document.head.querySelectorAll('script').forEach((s) => s.remove())
  delete window.gtag
  delete window.dataLayer
  vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST123')
})

afterEach(() => vi.unstubAllEnvs())

describe('consent storage', () => {
  it('has no choice until the visitor answers, then remembers it', () => {
    expect(readConsent()).toBeNull()
    saveConsent(false)
    expect(readConsent()).toMatchObject({ analytics: false })
    expect(JSON.parse(window.localStorage.getItem(CONSENT_KEY)!)).toMatchObject({ analytics: false })
  })

  it('ignores a damaged saved value instead of guessing consent', () => {
    window.localStorage.setItem(CONSENT_KEY, '{"analytics":"yes"}')
    expect(readConsent()).toBeNull()
    window.localStorage.setItem(CONSENT_KEY, 'not json')
    expect(readConsent()).toBeNull()
  })

  it('opens the settings again from the footer and closes them on save', () => {
    saveConsent(true)
    openCookieSettings()
    expect(cookieSettingsOpen()).toBe(true)
    saveConsent(false)
    expect(cookieSettingsOpen()).toBe(false)
    expect(currentConsent()?.analytics).toBe(false)
  })
})

describe('Google Analytics loading', () => {
  it('loads nothing before consent', () => {
    startAnalytics()
    expect(gaScripts()).toHaveLength(0)
    expect(window.gtag).toBeUndefined()
  })

  it('loads gtag.js once after Accept, with only analytics storage granted', () => {
    saveConsent(true)
    startAnalytics()
    expect(gaScripts()).toHaveLength(1)
    expect(gaScripts()[0].getAttribute('src')).toContain('id=G-TEST123')
    const calls = (window.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>))
    expect(calls).toContainEqual(['consent', 'default', expect.objectContaining({ analytics_storage: 'denied', ad_storage: 'denied' })])
    expect(calls).toContainEqual(['consent', 'update', { analytics_storage: 'granted' }])
    expect(calls).toContainEqual(['config', 'G-TEST123', { send_page_view: false }])
  })

  it('does nothing without a measurement ID, even after Accept', () => {
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', '')
    saveConsent(true)
    expect(gaScripts()).toHaveLength(0)
  })

  it('sends events only while analytics is allowed', () => {
    track('order_cta_click', { location: 'hero' })
    expect(window.dataLayer).toBeUndefined()
    saveConsent(true)
    track('order_cta_click', { location: 'hero' })
    const events = (window.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>)).filter((c) => c[0] === 'event')
    // Accepting counts the page it happened on, then later events follow.
    expect(events).toEqual([
      ['event', 'page_view', expect.objectContaining({ page_title: expect.any(String) })],
      ['event', 'order_cta_click', { location: 'hero' }],
    ])
  })

  it('denies storage and removes the GA cookies after Reject', () => {
    saveConsent(true)
    document.cookie = '_ga=GA1.1.123; path=/'
    document.cookie = '_ga_TEST123=GS1.1.1; path=/'
    document.cookie = 'other=keep; path=/'
    saveConsent(false)
    expect(document.cookie).not.toMatch(/_ga/)
    expect(document.cookie).toMatch(/other=keep/)
    const calls = (window.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>))
    expect(calls.at(-1)).toEqual(['consent', 'update', { analytics_storage: 'denied' }])
  })
})
