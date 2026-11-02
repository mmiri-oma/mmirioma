/**
 * "Use my location": the device's position, named by Google Maps.
 *
 * The browser asks the person for permission first (the Geolocation API);
 * nothing happens without it. The position then goes to Google's Geocoding
 * service to get a street address and the neighbourhood names around it,
 * which screens match against our area names. The position itself is not
 * stored or sent to our server: saved addresses have no coordinates yet
 * (docs/api/customer-account.md), and the server decides the zone from the
 * area the customer picks (FR-010, FR-020).
 *
 * Google Maps loads only when someone taps the button, and only when
 * `VITE_GOOGLE_MAPS_API_KEY` is set (a browser key, public like every
 * `VITE_` value, so restrict it to the site's domains in Google Cloud).
 * Without a key the button is hidden and screens work as before.
 */

/** A point in WGS 84 decimal degrees. */
export interface LatLng {
  lat: number
  lng: number
}

interface AddressComponent {
  long_name: string
  short_name: string
  types: string[]
}

/** The part of a Google Geocoding result this module reads. */
export interface GeocodeResult {
  formatted_address: string
  address_components: AddressComponent[]
}

/** The few Google Maps classes used here, typed by hand to avoid a new dependency. */
export interface GoogleMapsApi {
  Geocoder: new () => { geocode(request: { location: LatLng }): Promise<{ results: GeocodeResult[] }> }
  Map: new (element: HTMLElement, options: Record<string, unknown>) => unknown
  Marker: new (options: Record<string, unknown>) => unknown
}

declare global {
  interface Window {
    google?: { maps: GoogleMapsApi }
    __waterlineMapsReady?: () => void
  }
}

/** What "Use my location" found. */
export interface FoundLocation {
  position: LatLng
  /** Google's best street address for the position, e.g. "12 Lakeview St, GRA, Enugu". */
  address: string
  /** Neighbourhood, district and town names around the position, most specific first. */
  placeNames: string[]
}

/** Why a location could not be found; `message` is safe to show. */
export class LocationError extends Error {
  readonly reason: 'not_configured' | 'unsupported' | 'denied' | 'unavailable' | 'maps_failed'
  constructor(reason: LocationError['reason'], message: string) {
    super(message)
    this.reason = reason
  }
}

/** The Google Maps browser key, or `null` when maps are not configured. */
export function mapsApiKey(): string | null {
  const key = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim()
  return key ? key : null
}

let loading: Promise<GoogleMapsApi> | null = null

/**
 * Load the Google Maps JavaScript API once. Later calls reuse it. A failed
 * load can be tried again.
 *
 * @throws LocationError `not_configured` without a key, `maps_failed` when the script does not load.
 */
export function loadGoogleMaps(): Promise<GoogleMapsApi> {
  const key = mapsApiKey()
  if (!key) return Promise.reject(new LocationError('not_configured', 'Maps are not set up on this site yet.'))
  if (window.google?.maps?.Geocoder) return Promise.resolve(window.google.maps)
  loading ??= new Promise<GoogleMapsApi>((resolve, reject) => {
    const fail = () => {
      loading = null
      reject(new LocationError('maps_failed', 'Maps could not load. Check your connection and try again.'))
    }
    window.__waterlineMapsReady = () => (window.google?.maps ? resolve(window.google.maps) : fail())
    const script = document.createElement('script')
    script.async = true
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&region=NG&language=en&callback=__waterlineMapsReady`
    script.onerror = fail
    document.head.appendChild(script)
  })
  return loading
}

/**
 * The device's position. The browser asks permission the first time.
 *
 * @throws LocationError `unsupported`, `denied` or `unavailable` (includes time-outs).
 */
export function currentPosition(timeoutMs = 15_000): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new LocationError('unsupported', 'This browser cannot share your location. Type your area instead.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) =>
        reject(
          e.code === 1 // PERMISSION_DENIED
            ? new LocationError('denied', 'Location is off for this site. Allow it in your browser settings, or type your area.')
            : new LocationError('unavailable', 'We could not find your location. Try again outdoors, or type your area.'),
        ),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    )
  })
}

/** Address component types that name an area, most specific first. */
const AREA_TYPES = ['neighborhood', 'sublocality_level_2', 'sublocality_level_1', 'sublocality', 'locality', 'administrative_area_level_2']

/**
 * The area names in Google results, most specific first and without
 * repeats: "Trans Ekulu", then "Enugu North", then "Enugu".
 */
export function placeNamesFrom(results: GeocodeResult[]): string[] {
  const names: string[] = []
  for (const type of AREA_TYPES) {
    for (const r of results) {
      for (const c of r.address_components) {
        if (c.types.includes(type) && !names.includes(c.long_name)) names.push(c.long_name)
      }
    }
  }
  return names
}

/**
 * Find the person: their position, then Google's address and area names.
 *
 * @throws LocationError for every failure, with a message to show.
 */
export async function findMyLocation(): Promise<FoundLocation> {
  if (!mapsApiKey()) throw new LocationError('not_configured', 'Maps are not set up on this site yet.')
  const [position, maps] = await Promise.all([currentPosition(), loadGoogleMaps()])
  let results: GeocodeResult[]
  try {
    results = (await new maps.Geocoder().geocode({ location: position })).results
  } catch {
    throw new LocationError('maps_failed', 'We found you but could not name the place. Type your area instead.')
  }
  if (!results.length) throw new LocationError('unavailable', 'We could not name the place you are in. Type your area instead.')
  return { position, address: results[0].formatted_address, placeNames: placeNamesFrom(results) }
}

/** Test hook: forget a loaded or failed Maps script. */
export function resetMapsForTests() {
  loading = null
}
