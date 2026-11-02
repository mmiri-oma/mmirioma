/**
 * Which pages search engines may index. Shared by the app (`lib/seo.ts`, the
 * robots meta tag and canonical link on each route) and the build
 * (`vite.config.ts`, sitemap.xml), so the two never disagree. Plain data, no
 * browser APIs, because the build imports it in Node.
 */

/** Pages that are public and useful in search: listed in the sitemap and indexable. */
export const SITEMAP_PATHS = ['/', '/faq', '/terms', '/privacy', '/signup', '/partner/signup'] as const

/** Indexable but not worth listing in the sitemap. */
const OTHER_INDEXABLE = ['/signin', '/partner/login'] as const

/**
 * Whether a page may appear in search results. Everything else (the apps,
 * the order flow, staff screens, the 404 page) is `noindex`.
 *
 * @param pathname - The route path, e.g. `/faq`.
 */
export function isIndexable(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return (SITEMAP_PATHS as readonly string[]).includes(path) || (OTHER_INDEXABLE as readonly string[]).includes(path)
}
