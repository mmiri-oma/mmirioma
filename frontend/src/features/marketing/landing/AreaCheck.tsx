import { useState } from 'react'
import { UseMyLocation } from '../../../components/ui/UseMyLocation'
import { track } from '../../../lib/analytics'
import { cx } from '../../../lib/cx'
import { PhoneIcon } from './Art'
import { matchAreas } from './logic'

/**
 * "Is your street on our route?": type an area, or tap "Use my location"
 * (Google Maps names where you are), and the list answers. The list is the
 * sample from the landing content, so a miss sends people to the phone,
 * never to a "we don't deliver there". The search text and the location are
 * never sent to analytics, only whether they matched.
 */
export function AreaCheck({ areas, phoneLabel, phoneHref, autoFocus = false }: { areas: string[]; phoneLabel: string; phoneHref: string; autoFocus?: boolean }) {
  const [search, setSearch] = useState('')
  const [foundNear, setFoundNear] = useState<string | null>(null)
  const hits = matchAreas(areas, search)
  const typed = search.trim()

  let message = `${areas.length} areas so far, and nearby streets.`
  let tone: 'ok' | 'no' | null = null
  if (foundNear && !hits.length) {
    message = `We found you near ${foundNear}. That is not on our list yet. Call us and we will check.`
    tone = 'no'
  } else if (typed && hits.length === 1) {
    message = `Yes, ${hits[0]} is on our list.`
    tone = 'ok'
  } else if (typed && hits.length > 1) {
    message = `${hits.length} areas match. Pick yours below.`
    tone = 'ok'
  } else if (typed) {
    message = `“${typed}” is not on the list yet. Call us and we will check.`
    tone = 'no'
  }

  return (
    <div className="wl-area-box">
      <label className="wl-area-search">
        <span className="sr-only">Search for your area</span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={search}
          placeholder="Type your area, e.g. Trans-Ekulu"
          autoComplete="off"
          // In the pop-up the search is the only thing to do, so start there.
          autoFocus={autoFocus}
          onChange={(e) => {
            setSearch(e.target.value)
            setFoundNear(null)
          }}
          onBlur={() => typed && track('area_check', { found: hits.length > 0, method: 'typed' })}
        />
      </label>
      <UseMyLocation
        place="area_check"
        className="mt-3"
        onFound={(location) => {
          // The most specific place name that is on our list, else the most specific one.
          const match = location.placeNames.map((n) => matchAreas(areas, n)[0]).find(Boolean)
          setSearch(match ?? location.placeNames[0] ?? '')
          setFoundNear(match ? null : location.address)
          track('area_check', { found: Boolean(match), method: 'location' })
        }}
      />
      <p className={cx('wl-area-msg', tone === 'ok' && 'wl-ok', tone === 'no' && 'wl-no')} aria-live="polite">
        {message}
      </p>
      <ul className="wl-area-list">
        {areas.map((a) => (
          <li key={a} className={cx(typed && (hits.includes(a) ? 'wl-match' : 'wl-dim'))}>
            {a}
          </li>
        ))}
      </ul>
      <div className="wl-area-ask">
        <div>
          <b>Not on the list?</b>
          <span>Ask us. We are adding new areas.</span>
        </div>
        <a className="wl-btn wl-btn-ghost wl-btn-sm" href={phoneHref}>
          <PhoneIcon />
          <span>{phoneLabel}</span>
        </a>
      </div>
    </div>
  )
}
