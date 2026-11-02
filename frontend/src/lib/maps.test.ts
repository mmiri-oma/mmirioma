// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentPosition, findMyLocation, LocationError, mapsApiKey, placeNamesFrom, resetMapsForTests, type GeocodeResult } from './maps'

const RESULTS: GeocodeResult[] = [
  {
    formatted_address: '12 Sample Close, Trans Ekulu, Enugu',
    address_components: [
      { long_name: 'Trans Ekulu', short_name: 'Trans Ekulu', types: ['neighborhood', 'political'] },
      { long_name: 'Enugu', short_name: 'Enugu', types: ['locality', 'political'] },
    ],
  },
  {
    formatted_address: 'Enugu North, Enugu',
    address_components: [
      { long_name: 'Enugu North', short_name: 'Enugu North', types: ['administrative_area_level_2', 'political'] },
      { long_name: 'Enugu', short_name: 'Enugu', types: ['locality', 'political'] },
    ],
  },
]

function stubGeolocation(impl: (ok: PositionCallback, fail: PositionErrorCallback) => void) {
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: impl } })
}

beforeEach(() => {
  resetMapsForTests()
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-browser-key')
})

afterEach(() => {
  vi.unstubAllEnvs()
  delete window.google
})

describe('placeNamesFrom', () => {
  it('lists area names most specific first, without repeats', () => {
    expect(placeNamesFrom(RESULTS)).toEqual(['Trans Ekulu', 'Enugu', 'Enugu North'])
  })
})

describe('mapsApiKey', () => {
  it('is null when no key is configured, so the button hides', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '  ')
    expect(mapsApiKey()).toBeNull()
  })
})

describe('currentPosition', () => {
  it('explains a refused permission with what to do next', async () => {
    stubGeolocation((_ok, fail) => fail({ code: 1, message: 'denied' } as GeolocationPositionError))
    await expect(currentPosition()).rejects.toMatchObject({ reason: 'denied', message: expect.stringMatching(/type your area/) })
  })

  it('treats a time-out as unavailable', async () => {
    stubGeolocation((_ok, fail) => fail({ code: 3, message: 'timeout' } as GeolocationPositionError))
    await expect(currentPosition()).rejects.toMatchObject({ reason: 'unavailable' })
  })
})

describe('findMyLocation', () => {
  it('refuses at once without a key, before asking for the position', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
    const ask = vi.fn()
    stubGeolocation(ask)
    await expect(findMyLocation()).rejects.toBeInstanceOf(LocationError)
    expect(ask).not.toHaveBeenCalled()
  })

  it('names the position with Google and returns the address and place names', async () => {
    stubGeolocation((ok) => ok({ coords: { latitude: 6.47, longitude: 7.52 } } as GeolocationPosition))
    const geocode = vi.fn().mockResolvedValue({ results: RESULTS })
    window.google = {
      maps: {
        Geocoder: vi.fn().mockImplementation(function () {
          return { geocode }
        }),
        Map: vi.fn(),
        Marker: vi.fn(),
      } as never,
    }
    const found = await findMyLocation()
    expect(geocode).toHaveBeenCalledWith({ location: { lat: 6.47, lng: 7.52 } })
    expect(found).toEqual({ position: { lat: 6.47, lng: 7.52 }, address: '12 Sample Close, Trans Ekulu, Enugu', placeNames: ['Trans Ekulu', 'Enugu', 'Enugu North'] })
  })
})
