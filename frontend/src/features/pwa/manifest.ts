/**
 * Which installable app a page belongs to (decision Q1: two apps).
 *
 * Every page is the same `index.html`, so the `<link rel="manifest">` is
 * switched by path: pages under `/partner/` belong to "Waterline Partner"
 * (`partner.webmanifest`), everything else to the customer app
 * (`manifest.webmanifest`). The browser installs whichever app the current
 * page names, and the installed partner app only opens `/partner/` pages.
 */
import { manifestChanged } from './installPrompt'

export type AppKind = 'customer' | 'partner'

/** Each app's name, as in its manifest (decision Q8 of round 2). */
export const APP_NAME: Record<AppKind, string> = { customer: 'Waterline', partner: 'Waterline Partner' }

/** The app a path belongs to. `/partner` itself is the partner app's start page. */
export function appFor(pathname: string): AppKind {
  return pathname === '/partner' || pathname.startsWith('/partner/') ? 'partner' : 'customer'
}

export const MANIFEST_HREF: Record<AppKind, string> = {
  customer: '/manifest.webmanifest',
  partner: '/partner.webmanifest',
}

/** Point the page's manifest link at the app for `pathname`. */
export function applyManifest(pathname: string): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  const href = MANIFEST_HREF[appFor(pathname)]
  if (!link || link.getAttribute('href') === href) return
  link.setAttribute('href', href)
  manifestChanged(href)
}
