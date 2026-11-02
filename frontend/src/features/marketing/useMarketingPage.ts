import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { track } from '../../lib/analytics'

/** Same stylesheet as index.html (Fraunces and Inter): already there in the app, added here only if missing. */
const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,400..800,0..100,0..1;1,9..144,400..800,0..100,0..1&family=Inter:wght@400..800&display=swap'
const APP_TITLE = 'Waterline'
const APP_DESCRIPTION = 'Order water in Enugu and have it poured into your tank.'

function setDescription(text: string) {
  document.querySelector('meta[name="description"]')?.setAttribute('content', text)
}

/**
 * Shared set-up for the public pages:
 * - makes sure Fraunces and Inter are loaded (index.html loads them; offline
 *   fallback in styles/fonts.css);
 * - sends a Google Analytics page view, which does nothing unless the visitor
 *   accepted analytics (lib/analytics.ts); only public pages call this, so
 *   screens inside the signed-in apps are never reported;
 * - sets the tab title and meta description, and puts the app's back when
 *   leaving;
 * - scrolls (smoothly, unless reduced motion is on) to `#section` after
 *   navigation, because React Router does not (e.g. "How It Works" from the
 *   FAQ page goes to `/#how`).
 */
export function useMarketingPage(title: string, description: string) {
  const { hash, pathname, key } = useLocation()

  // Add the font stylesheet once; it stays for the rest of the visit.
  useEffect(() => {
    if (document.querySelector(`link[href="${FONTS_HREF}"]`)) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = FONTS_HREF
    document.head.appendChild(link)
  }, [])

  useEffect(() => {
    track('page_view', { page_title: title, page_location: `${window.location.origin}${pathname}` })
  }, [title, pathname])

  useEffect(() => {
    document.title = title
    setDescription(description)
    return () => {
      document.title = APP_TITLE
      setDescription(APP_DESCRIPTION)
    }
  }, [title, description])

  // Jump to the section named in the hash, or to the top for a new page.
  // `key` changes on every navigation, so tapping the same link again re-scrolls.
  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0)
      return
    }
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth' })
  }, [hash, pathname, key])
}
