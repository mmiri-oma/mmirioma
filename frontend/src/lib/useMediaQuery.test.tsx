// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMediaQuery } from './useMediaQuery'

function Probe() {
  return <p>{useMediaQuery('(min-width: 1024px)') ? 'desktop' : 'phone'}</p>
}

afterEach(() => vi.unstubAllGlobals())

describe('useMediaQuery', () => {
  it('defaults to false where matchMedia does not exist (phone layout)', () => {
    vi.stubGlobal('matchMedia', undefined)
    render(<Probe />)
    expect(screen.getByText('phone')).toBeInTheDocument()
  })

  it('follows the query as it changes', () => {
    let matches = true
    const listeners = new Set<() => void>()
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return matches
      },
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    }))
    render(<Probe />)
    expect(screen.getByText('desktop')).toBeInTheDocument()
    matches = false
    act(() => listeners.forEach((l) => l()))
    expect(screen.getByText('phone')).toBeInTheDocument()
  })
})
