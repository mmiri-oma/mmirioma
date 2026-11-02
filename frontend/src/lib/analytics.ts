/**
 * Website analytics (Google Analytics 4) behind the visitor's consent.
 *
 * Nothing is loaded and no analytics cookie is set until the visitor accepts
 * analytics in the cookie banner. The choice is kept in this browser
 * (`localStorage`), so the banner does not come back on every visit; it can be
 * changed at any time from "Cookie settings" in the footer.
 *
 * - The measurement ID comes from `VITE_GA_MEASUREMENT_ID` (public, like every
 *   `VITE_` value). Without it analytics is off and the banner never shows.
 * - Google Consent Mode v2 starts with everything denied; only
 *   `analytics_storage` is granted, and only after "Accept". Advertising
 *   storage and personalisation stay denied.
 * - Page views are sent by the public pages only (see `useMarketingPage`), so
 *   screens inside the signed-in apps are never reported.
 * - Never put personal data (names, phone numbers, addresses, free text a
 *   visitor typed) in an event.
 */

/** The visitor's saved answer. */
export interface ConsentChoice {
  /** True when the visitor accepted analytics cookies. */
  analytics: boolean
  /** When they chose, ISO 8601. */
  decidedAt: string
}

/** Where the choice is saved. Bump the suffix if the banner's purpose changes, so everyone is asked again. */
export const CONSENT_KEY = 'waterline.consent.v1'

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

/** The GA4 measurement ID, or `null` when analytics is not configured. */
export function measurementId(): string | null {
  const id = (import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined)?.trim()
  return id ? id : null
}

/** Read the saved choice; `null` when the visitor has not answered yet (or storage is blocked). */
export function readConsent(): ConsentChoice | null {
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ConsentChoice>
    return typeof parsed.analytics === 'boolean' && typeof parsed.decidedAt === 'string'
      ? { analytics: parsed.analytics, decidedAt: parsed.decidedAt }
      : null
  } catch {
    return null
  }
}

type Listener = () => void
const listeners = new Set<Listener>()
let choice: ConsentChoice | null | undefined
let settingsOpen = false
let loadedFor: string | null = null

function emit() {
  for (const l of listeners) l()
}

/** Subscribe to changes of the choice or of the settings panel (for `useSyncExternalStore`). */
export function subscribeConsent(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The current choice, read from storage once and then kept in memory. */
export function currentConsent(): ConsentChoice | null {
  if (choice === undefined) choice = readConsent()
  return choice
}

/** True while the visitor has the cookie settings open from the footer. */
export function cookieSettingsOpen(): boolean {
  return settingsOpen
}

/** Open the cookie settings again (footer link). */
export function openCookieSettings() {
  settingsOpen = true
  emit()
}

/** Close the cookie settings without changing the choice. */
export function closeCookieSettings() {
  settingsOpen = false
  emit()
}

/**
 * Save the visitor's answer and act on it at once: load analytics after an
 * "Accept", or turn it off and remove its cookies after a "Reject".
 *
 * @param analytics - True to allow analytics cookies.
 */
export function saveConsent(analytics: boolean) {
  choice = { analytics, decidedAt: new Date().toISOString() }
  try {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify(choice))
  } catch {
    // Storage blocked (private mode): the choice still applies to this visit.
  }
  settingsOpen = false
  if (analytics) {
    startAnalytics()
    // The page they accepted on has already rendered, so count it now (the banner shows on public pages only).
    track('page_view', { page_title: document.title, page_location: `${window.location.origin}${window.location.pathname}` })
  } else {
    stopAnalytics()
  }
  emit()
}

/** Google's `gtag()` queue. gtag.js reads `arguments` objects from `dataLayer`, not arrays. */
const gtag: (...args: unknown[]) => void = function () {
  window.dataLayer = window.dataLayer ?? []
  // eslint-disable-next-line prefer-rest-params
  window.dataLayer.push(arguments)
}

/**
 * Load GA4 if it is configured and the visitor accepted. Safe to call many
 * times: the script is added once per measurement ID.
 */
export function startAnalytics() {
  const id = measurementId()
  if (!id || !currentConsent()?.analytics || loadedFor === id) return
  loadedFor = id
  window.gtag = gtag
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
  })
  gtag('consent', 'update', { analytics_storage: 'granted' })
  gtag('js', new Date())
  // Page views are sent by hand from the public pages only.
  gtag('config', id, { send_page_view: false })
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`
  document.head.appendChild(script)
}

/** Withdraw analytics: deny storage and delete the `_ga` cookies GA4 set on this site. */
function stopAnalytics() {
  if (window.gtag) window.gtag('consent', 'update', { analytics_storage: 'denied' })
  const host = window.location.hostname
  const domains = ['', host, `.${host}`, `.${host.split('.').slice(-2).join('.')}`]
  for (const name of document.cookie.split(';').map((c) => c.split('=')[0].trim())) {
    if (name !== '_ga' && !name.startsWith('_ga_')) continue
    for (const d of domains) {
      document.cookie = `${name}=; Max-Age=0; path=/${d ? `; domain=${d}` : ''}`
    }
  }
}

/**
 * Send an analytics event. Does nothing unless analytics is loaded, so screens
 * can call it freely. Keep parameters to plain facts about the page, never
 * personal data.
 *
 * @param name - GA4 event name, snake_case (e.g. `order_cta_click`).
 * @param params - Extra event parameters.
 */
export function track(name: string, params: Record<string, string | number | boolean> = {}) {
  if (!loadedFor || !window.gtag || !currentConsent()?.analytics) return
  window.gtag('event', name, params)
}

/** Test hook: forget the in-memory state between tests. */
export function resetAnalyticsForTests() {
  choice = undefined
  settingsOpen = false
  loadedFor = null
  listeners.clear()
}
