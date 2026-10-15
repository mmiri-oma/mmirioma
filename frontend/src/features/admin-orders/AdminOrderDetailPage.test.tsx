// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { renderAdminOrders } from './testUtils'

afterEach(cleanup)

describe('AdminOrderDetailPage', () => {
  it('shows the order details in Lagos time with no price', async () => {
    renderAdminOrders('/admin/orders/MO-7KQ2M9XH4T')

    expect(await screen.findByRole('heading', { level: 1, name: 'MO-7KQ2M9XH4T' })).toBeTruthy()
    expect(screen.getByText('200 litres')).toBeTruthy()
    expect(screen.getByText(/12 Palm Close, Independence Layout, Enugu/)).toBeTruthy()
    expect(screen.getByText(/Wed 14 Oct 2026, 10:30 am/)).toBeTruthy()
    expect(screen.getByText('Fri 16 Oct 2026')).toBeTruthy()
    expect(screen.getByText(/not a booked slot/i)).toBeTruthy()
    expect(screen.getByText(/no price yet/i)).toBeTruthy()
    expect(screen.queryByText(/₦/)).toBeNull()
  })

  it('flags an unverified phone (FR-003)', async () => {
    renderAdminOrders('/admin/orders/MO-7KQ2M9XH4T')
    expect(await screen.findByText('Phone unverified')).toBeTruthy()
    expect(screen.getByText(/must be verified before this order can be confirmed/i)).toBeTruthy()
  })

  it('marks the current lifecycle step', async () => {
    renderAdminOrders('/admin/orders/MO-1ZN9QE6K4V')
    const current = await screen.findByText((_, element) => element?.getAttribute('aria-current') === 'step')
    expect(current.textContent).toMatch(/en route/i)
  })

  it('explains cancelled orders instead of showing the progression', async () => {
    renderAdminOrders('/admin/orders/MO-9JA4RC7X5D')
    expect(await screen.findByText(/cancelled with a recorded reason/i)).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('shows a not-found state for an unknown reference', async () => {
    renderAdminOrders('/admin/orders/MO-0000000000')
    expect(await screen.findByText('Order not found')).toBeTruthy()
  })

  it('returns to the directory with the filters it came from', async () => {
    const user = userEvent.setup()
    const { currentUrl } = renderAdminOrders('/admin/orders?status=en_route')

    const [link] = await screen.findAllByRole('link', { name: /MO-1ZN9QE6K4V/ })
    await user.click(link)
    await user.click(await screen.findByRole('link', { name: /back to orders/i }))
    expect(currentUrl()).toBe('/admin/orders?status=en_route')
  })
})
