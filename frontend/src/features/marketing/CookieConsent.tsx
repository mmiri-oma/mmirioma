import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import {
  closeCookieSettings,
  cookieSettingsOpen,
  currentConsent,
  measurementId,
  saveConsent,
  startAnalytics,
  subscribeConsent,
} from '../../lib/analytics'
import './waterline.css'

/**
 * The cookie banner on the public pages.
 *
 * It asks once whether Waterline may use Google Analytics cookies, with
 * "Accept analytics" and "Reject" the same size so neither is the easy
 * choice, and "Choose what to allow" for the detail. Analytics stays off
 * until "Accept" (see `lib/analytics.ts`). The banner does not block the
 * page, and it comes back from "Cookie settings" in the footer. When no GA4
 * measurement ID is configured there is nothing to ask, so it never shows.
 */
export function CookieConsent() {
  const choice = useSyncExternalStore(subscribeConsent, currentConsent, () => null)
  const reopened = useSyncExternalStore(subscribeConsent, cookieSettingsOpen, () => false)

  // A visitor who accepted on an earlier visit gets analytics again on this one.
  useEffect(() => {
    if (choice?.analytics) startAnalytics()
  }, [choice])

  if (!measurementId() || (choice && !reopened)) return null
  // A new key when reopened starts the panel fresh, on the detail view with the saved choice.
  return <ConsentPanel key={reopened ? 'settings' : 'first-visit'} reopened={reopened} saved={choice?.analytics ?? false} />
}

function ConsentPanel({ reopened, saved }: { reopened: boolean; saved: boolean }) {
  const [details, setDetails] = useState(reopened)
  const [analytics, setAnalytics] = useState(saved)
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Reopened from the footer: move keyboard focus to the panel so it is not lost behind it.
  useEffect(() => {
    if (reopened) headingRef.current?.focus()
  }, [reopened])

  return (
    <section className="wl-consent" role="dialog" aria-modal="false" aria-labelledby="wl-consent-title">
      <h2 id="wl-consent-title" ref={headingRef} tabIndex={-1}>
        {details ? 'Cookie settings' : 'Cookies on Waterline'}
      </h2>
      {details ? (
        <>
          <div className="wl-toggle-row">
            <input id="wl-consent-needed" type="checkbox" checked disabled />
            <label htmlFor="wl-consent-needed">
              <b>Necessary</b>
              <small>Keeps you signed in and remembers this choice. Always on.</small>
            </label>
          </div>
          <div className="wl-toggle-row">
            <input id="wl-consent-analytics" type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} />
            <label htmlFor="wl-consent-analytics">
              <b>Analytics</b>
              <small>Google Analytics: pages visited, buttons used, device type and rough location (city or country). No ads.</small>
            </label>
          </div>
          <div className="wl-consent-actions">
            <button type="button" className="wl-btn wl-btn-primary" onClick={() => saveConsent(analytics)}>
              Save choices
            </button>
            <button type="button" className="wl-btn wl-btn-ghost" onClick={() => (reopened ? closeCookieSettings() : setDetails(false))}>
              {reopened ? 'Close' : 'Back'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            We use one cookie to keep you signed in. With your OK we would also use analytics cookies to see which pages help people order and roughly where
            visitors are from. No ads. <Link to="/privacy#cookies">Privacy notice</Link>
          </p>
          <div className="wl-consent-actions">
            <button type="button" className="wl-btn wl-btn-primary" onClick={() => saveConsent(true)}>
              Accept analytics
            </button>
            <button type="button" className="wl-btn wl-btn-ghost" onClick={() => saveConsent(false)}>
              Reject
            </button>
          </div>
          <button type="button" className="wl-consent-more" onClick={() => setDetails(true)}>
            Choose what to allow
          </button>
        </>
      )}
    </section>
  )
}
