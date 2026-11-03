import { useSyncExternalStore } from 'react'

/**
 * Whether a CSS media query matches now, updating when it changes (a window
 * resized, a phone rotated). False where `matchMedia` does not exist (tests,
 * old browsers), so the phone layout is the default.
 *
 * @param query - A media query, e.g. `(min-width: 1024px)`.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => {}
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
    () => false,
  )
}
