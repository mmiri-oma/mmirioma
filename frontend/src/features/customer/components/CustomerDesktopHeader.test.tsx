// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppProviders } from '../../../app/providers'
import { resetMockDb } from '../../../mocks/db'
import { CustomerDesktopHeader } from './CustomerChrome'

beforeEach(() => resetMockDb())

function renderAt(path: string) {
  render(
    <AppProviders>
      <MemoryRouter initialEntries={[path]}>
        <CustomerDesktopHeader />
      </MemoryRouter>
    </AppProviders>,
  )
  return within(screen.getByRole('navigation', { name: 'Customer app' }))
}

describe('CustomerDesktopHeader', () => {
  it('links every main section and marks the order flow as current on any order step', () => {
    const nav = renderAt('/order/keke')
    expect(nav.getByRole('link', { name: 'Order water' })).toHaveAttribute('aria-current', 'page')
    expect(nav.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
    for (const name of ['Home', 'My orders', 'Addresses', 'Profile']) expect(nav.getByRole('link', { name })).toBeInTheDocument()
  })

  it('marks My orders on an order detail page', () => {
    const nav = renderAt('/orders/MO-1')
    expect(nav.getByRole('link', { name: 'My orders' })).toHaveAttribute('aria-current', 'page')
  })
})
