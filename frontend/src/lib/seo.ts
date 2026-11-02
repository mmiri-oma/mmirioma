/**
 * Search and share metadata in `<head>`, kept right as the single-page app
 * moves between routes. index.html carries the defaults (title, description,
 * Open Graph, structured data) for crawlers that do not run JavaScript; this
 * module updates them for crawlers that do (Google renders the app).
 */
import { isIndexable } from './seoPaths'

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

/**
 * Point search engines at the right page for `pathname`: indexable public
 * pages get `index, follow` and a canonical link to themselves (without query
 * or hash); every other route gets `noindex, nofollow` and no canonical link.
 * Called by the app root on every route change.
 *
 * @param pathname - The route path.
 */
export function applySearchRules(pathname: string) {
  const indexable = isIndexable(pathname)
  upsertMeta('name', 'robots', indexable ? 'index, follow' : 'noindex, nofollow')
  const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!indexable) {
    canonical?.remove()
    return
  }
  const href = `${window.location.origin}${pathname}`
  if (canonical) canonical.href = href
  else {
    const link = document.createElement('link')
    link.rel = 'canonical'
    link.href = href
    document.head.appendChild(link)
  }
}

/**
 * Set the share metadata (Open Graph and X/Twitter cards) for a public page,
 * matching its title and description.
 *
 * @param title - The page title.
 * @param description - The page description.
 * @param pathname - The route path, for `og:url`.
 */
export function applyShareMeta(title: string, description: string, pathname: string) {
  upsertMeta('property', 'og:title', title)
  upsertMeta('property', 'og:description', description)
  upsertMeta('property', 'og:url', `${window.location.origin}${pathname}`)
  upsertMeta('name', 'twitter:title', title)
  upsertMeta('name', 'twitter:description', description)
}

/**
 * JSON for a `<script type="application/ld+json">`, with `<` escaped so text
 * can never close the script element early.
 */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
