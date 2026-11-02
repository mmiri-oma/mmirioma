// @vitest-environment jsdom
import { matchRoutes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '../app/router'
import { applySearchRules, applyShareMeta, jsonLd } from './seo'
import { isIndexable, SITEMAP_PATHS } from './seoPaths'

const robots = () => document.head.querySelector('meta[name="robots"]')?.getAttribute('content')
const canonical = () => document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute('href')

beforeEach(() => {
  document.head.innerHTML = ''
})

describe('isIndexable', () => {
  it('lets search engines index the public pages and the sign-up pages only', () => {
    for (const path of ['/', '/faq', '/terms', '/privacy', '/signup', '/signin', '/partner/signup', '/faq/']) expect(isIndexable(path)).toBe(true)
    for (const path of ['/home', '/order/review', '/orders', '/admin', '/partner', '/partner/jobs', '/no-such-page']) expect(isIndexable(path)).toBe(false)
  })
})

describe('applySearchRules', () => {
  it('gives a public page index, follow and a canonical link to itself', () => {
    applySearchRules('/faq')
    expect(robots()).toBe('index, follow')
    expect(canonical()).toBe(`${window.location.origin}/faq`)
  })

  it('marks app screens noindex and removes the canonical link', () => {
    applySearchRules('/faq')
    applySearchRules('/home')
    expect(robots()).toBe('noindex, nofollow')
    expect(canonical()).toBeUndefined()
  })
})

describe('applyShareMeta', () => {
  it('matches the share tags to the page', () => {
    applyShareMeta('FAQs | Waterline', 'Answers.', '/faq')
    const meta = (attr: string, key: string) => document.head.querySelector(`meta[${attr}="${key}"]`)?.getAttribute('content')
    expect(meta('property', 'og:title')).toBe('FAQs | Waterline')
    expect(meta('property', 'og:description')).toBe('Answers.')
    expect(meta('property', 'og:url')).toBe(`${window.location.origin}/faq`)
    expect(meta('name', 'twitter:title')).toBe('FAQs | Waterline')
  })
})

describe('jsonLd', () => {
  it('escapes < so text cannot close the script tag', () => {
    expect(jsonLd({ text: '</script><b>' })).toBe('{"text":"\\u003c/script>\\u003cb>"}')
  })
})

describe('SITEMAP_PATHS', () => {
  it('lists only real, indexable pages (never the 404 catch-all)', () => {
    for (const path of SITEMAP_PATHS) {
      const matches = matchRoutes(routes, path)
      expect(matches, path).not.toBeNull()
      expect(matches!.at(-1)!.route.path, path).not.toBe('*')
      expect(isIndexable(path)).toBe(true)
    }
  })
})
