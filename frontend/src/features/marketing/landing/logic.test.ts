import { describe, expect, it } from 'vitest'
import { drumsLabel, matchAreas } from './logic'

describe('drumsLabel', () => {
  it('writes litres as 200 L drums with quarters as fractions', () => {
    expect(drumsLabel(300)).toBe('1½') // 12 cans × 25 L
    expect(drumsLabel(600)).toBe('3')
    expect(drumsLabel(750)).toBe('3¾')
    expect(drumsLabel(50)).toBe('¼')
    expect(drumsLabel(330)).toBe('1.6')
  })
})

describe('matchAreas', () => {
  const areas = ['GRA', 'Trans-Ekulu', 'New Haven', 'Independence Layout']

  it('ignores case, spaces and dashes', () => {
    expect(matchAreas(areas, 'trans ekulu')).toEqual(['Trans-Ekulu'])
    expect(matchAreas(areas, 'NEWHAVEN')).toEqual(['New Haven'])
  })

  it('finds an area inside a longer search, like a street plus the area', () => {
    expect(matchAreas(areas, 'GRA Enugu')).toEqual(['GRA'])
  })

  it('matches nothing for an empty or unknown search', () => {
    expect(matchAreas(areas, '   ')).toEqual([])
    expect(matchAreas(areas, 'Nsukka')).toEqual([])
  })
})
