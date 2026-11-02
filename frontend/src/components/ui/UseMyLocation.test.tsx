// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMapsForTests } from '../../lib/maps'
import { UseMyLocation } from './UseMyLocation'

const RESULT = {
  formatted_address: '12 Sample Close, GRA, Enugu',
  address_components: [{ long_name: 'GRA', short_name: 'GRA', types: ['neighborhood'] }],
}

beforeEach(() => {
  resetMapsForTests()
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-browser-key')
  window.google = {
    maps: {
      Geocoder: vi.fn().mockImplementation(function () {
        return { geocode: vi.fn().mockResolvedValue({ results: [RESULT] }) }
      }),
      Map: vi.fn(),
      Marker: vi.fn(),
    } as never,
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
  delete window.google
})

function allowLocation() {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 6.45, longitude: 7.51 } } as GeolocationPosition) },
  })
}

describe('UseMyLocation', () => {
  it('is hidden when Google Maps is not configured', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
    render(<UseMyLocation place="test" onFound={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Use my location' })).not.toBeInTheDocument()
  })

  it('shows what it found on a map and fills it in only when asked', async () => {
    allowLocation()
    const onFound = vi.fn()
    const user = userEvent.setup()
    render(<UseMyLocation place="test" actionLabel="Use this address" onFound={onFound} />)
    await user.click(screen.getByRole('button', { name: 'Use my location' }))
    expect(await screen.findByText('12 Sample Close, GRA, Enugu')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Map of 12 Sample Close, GRA, Enugu' })).toBeInTheDocument()
    expect(onFound).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Use this address' }))
    expect(onFound).toHaveBeenCalledWith(expect.objectContaining({ address: '12 Sample Close, GRA, Enugu', placeNames: ['GRA'] }))
  })

  it('explains a refused permission and offers to try again', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) => fail({ code: 1 } as GeolocationPositionError) },
    })
    const user = userEvent.setup()
    render(<UseMyLocation place="test" onFound={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Use my location' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Location is off for this site/)
    expect(screen.getByRole('button', { name: 'Try my location again' })).toBeInTheDocument()
  })
})
