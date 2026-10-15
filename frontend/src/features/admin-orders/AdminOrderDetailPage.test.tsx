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

  it('flags a phone that is not confirmed yet (FR-003)', async () => {
    renderAdminOrders('/admin/orders/MO-7KQ2M9XH4T')
    expect(await screen.findByText('Not confirmed')).toBeTruthy()
    expect(screen.getByText(/must be confirmed before this order can be confirmed/i)).toBeTruthy()
    expect(screen.queryByText(/verified/i)).toBeNull()
  })

  it('shows request, receiver and customer account separately, phones as 0800 000 0001', async () => {
    renderAdminOrders('/admin/orders/MO-9TPW4C7M2A')
    expect(await screen.findByRole('heading', { name: 'Request' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Delivery' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Customer account' })).toBeTruthy()
    // Receiver (Delivery) and account holder (Customer account) differ here.
    expect(screen.getByText('Ngozi Nwosu')).toBeTruthy()
    expect(screen.getByText('Obiageli Nwosu')).toBeTruthy()
    expect(screen.getByText('0800 000 0003')).toBeTruthy()
    expect(screen.getByText('0800 000 0099')).toBeTruthy()
    expect(screen.queryByText(/\+234/)).toBeNull()
    expect(screen.getByText('No price yet - this is a quote request.')).toBeTruthy()
  })

  it('says "No preference" when no date was given, and has no lifecycle (Decision 11)', async () => {
    renderAdminOrders('/admin/orders/MO-3HV8RZ1N6D')
    expect(await screen.findByText('No preference')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Lifecycle' })).toBeNull()
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
