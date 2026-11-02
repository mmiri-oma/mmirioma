import { describe, expect, it } from 'vitest'
import { areaForPlaces } from './locationArea'

const ZONES = [
  { id: 'zone-1', name: 'GRA' },
  { id: 'zone-2', name: 'Trans-Ekulu' },
]

describe('areaForPlaces', () => {
  it('picks the listed area that matches the most specific place name', () => {
    expect(areaForPlaces(ZONES, ['Trans Ekulu', 'Enugu'])).toEqual({ id: 'zone-2', name: 'Trans-Ekulu' })
  })

  it('suggests nothing when no place is a listed area', () => {
    expect(areaForPlaces(ZONES, ['Nsukka', 'Enugu North'])).toBeNull()
    expect(areaForPlaces([], ['GRA'])).toBeNull()
  })
})
