import { useEffect, useRef, useState } from 'react'
import { track } from '../../lib/analytics'
import { cx } from '../../lib/cx'
import { findMyLocation, loadGoogleMaps, LocationError, mapsApiKey, type FoundLocation, type LatLng } from '../../lib/maps'
import { CrosshairIcon } from '../icons/icons'

/**
 * A small Google map centred on `position`, with a pin. Static for the
 * person: no controls, and on a phone it only pans with two fingers, so the
 * page still scrolls. Loads the map when it mounts.
 */
export function MapPreview({ position, label, className }: { position: LatLng; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  // Draw (or redraw) the map when the position changes. Google keeps no
  // listener on the element that needs cleaning up; React removes the node.
  useEffect(() => {
    let cancelled = false
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !ref.current) return
        const map = new maps.Map(ref.current, {
          center: position,
          zoom: 16,
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: 'cooperative',
        })
        new maps.Marker({ position, map })
      })
      .catch(() => {
        // The address text is already shown; a missing map is not worth an error.
      })
    return () => {
      cancelled = true
    }
  }, [position])
  return <div ref={ref} role="img" aria-label={label} className={cx('h-40 w-full overflow-hidden rounded-option bg-[#E6F3F5]', className)} />
}

interface UseMyLocationProps {
  /** Called with what was found: at once without `actionLabel`, or when that button is tapped. */
  onFound: (location: FoundLocation) => void
  /** Show the result with a map and this button (e.g. "Use this address") instead of applying it at once. */
  actionLabel?: string
  /** Where on the site this is, for analytics (never the location itself). */
  place: string
  className?: string
}

/**
 * "Use my location": asks the browser for the device's position, names it
 * with Google Maps and hands the result to the screen (`lib/maps.ts`).
 * Hidden when maps are not configured. Every failure explains what to do
 * next, and typing the area always still works.
 */
export function UseMyLocation({ onFound, actionLabel, place, className }: UseMyLocationProps) {
  const [state, setState] = useState<{ status: 'idle' | 'locating' } | { status: 'found'; location: FoundLocation } | { status: 'error'; message: string }>({
    status: 'idle',
  })

  if (!mapsApiKey()) return null

  async function locate() {
    setState({ status: 'locating' })
    try {
      const location = await findMyLocation()
      track('use_my_location', { place, result: 'found' })
      if (actionLabel) setState({ status: 'found', location })
      else {
        setState({ status: 'idle' })
        onFound(location)
      }
    } catch (e) {
      const reason = e instanceof LocationError ? e.reason : 'unavailable'
      track('use_my_location', { place, result: reason })
      setState({ status: 'error', message: e instanceof LocationError ? e.message : 'We could not find your location. Type your area instead.' })
    }
  }

  return (
    <div className={cx('flex flex-col gap-2.5', className)}>
      <button
        type="button"
        onClick={() => void locate()}
        disabled={state.status === 'locating'}
        aria-busy={state.status === 'locating'}
        className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 self-start rounded-full border-0 bg-[#E6F3F5] px-4 text-[14.5px] font-bold text-primary-dark transition-colors duration-150 hover:bg-sky disabled:cursor-wait disabled:opacity-70"
      >
        <CrosshairIcon size={18} />
        {state.status === 'locating' ? 'Finding you…' : state.status === 'error' ? 'Try my location again' : 'Use my location'}
      </button>
      {state.status === 'error' && (
        <p role="alert" className="m-0 text-caption font-semibold text-red">
          {state.message}
        </p>
      )}
      {state.status === 'found' && (
        <div className="flex flex-col gap-2.5 rounded-card border border-solid border-card-line bg-white p-3">
          <MapPreview position={state.location.position} label={`Map of ${state.location.address}`} />
          <p className="m-0 text-[14px]">
            <span className="block text-chip text-mute">We found you near</span>
            <b>{state.location.address}</b>
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                onFound(state.location)
                setState({ status: 'idle' })
              }}
              className="min-h-11 cursor-pointer rounded-full border-0 bg-ink px-4 text-[14px] font-bold text-white hover:bg-primary-dark"
            >
              {actionLabel}
            </button>
            <button type="button" onClick={() => setState({ status: 'idle' })} className="min-h-11 cursor-pointer rounded-full border-0 bg-transparent px-3 text-[14px] font-bold text-mute hover:text-ink">
              Not right
            </button>
          </div>
          <p className="m-0 text-tab text-mute">Your position is used only to fill this in. It is not saved.</p>
        </div>
      )}
    </div>
  )
}
