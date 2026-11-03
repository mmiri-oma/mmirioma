// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AddressMapArt, DetailsMapArt, TrackMapArt } from './Art'

/** Honesty rule "no invented places": a map must never name a place the customer did not give. */
describe('customer map illustrations', () => {
  it.each([
    ['DetailsMapArt', DetailsMapArt],
    ['AddressMapArt', AddressMapArt],
    ['TrackMapArt', TrackMapArt],
  ])('%s carries no place text', (_name, Map) => {
    const { container } = render(<Map />)
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.querySelectorAll('text')).toHaveLength(0)
    expect(container.textContent).toBe('')
  })

  /** No live tracking exists (PRD §9, FR-037): a moving dashed line reads as a vehicle in motion. */
  it('TrackMapArt draws a still route', () => {
    const { container } = render(<TrackMapArt />)
    expect(container.querySelector('.route-flow')).toBeNull()
    expect(container.querySelectorAll('path[stroke="#11708C"]')).toHaveLength(1)
  })
})
