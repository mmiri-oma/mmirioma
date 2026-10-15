// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api/client'
import { createMockAdminOrdersSource } from './mockAdminOrders'
import type { AdminOrdersSource } from './source'
import { renderAdminOrders } from './testUtils'

afterEach(cleanup)

// jsdom applies no CSS, so both the desktop table and the phone cards render;
// assertions scope to the table.
async function findTable() {
  return screen.findByRole('table', { name: /orders, newest first/i })
}

describe('AdminOrdersPage', () => {
  it('shows a loading state, then the first page of orders newest first', async () => {
    renderAdminOrders('/admin/orders')
    expect(screen.getByText(/loading orders/i)).toBeTruthy()

    const rows = within(await findTable()).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(10)
    expect(within(rows[0]).getByRole('link', { name: 'MO-7KQ2M9XH4T' })).toBeTruthy()
    expect(screen.getByText(/showing/i).textContent).toMatch(/1–10\s*of\s*22/)
  })

  it('labels mock data as simulated (BR-09)', async () => {
    renderAdminOrders('/admin/orders')
    await findTable()
    expect(screen.getByRole('note').textContent).toMatch(/sample data/i)
  })

  it('filters by status through the URL and resets to page 1', async () => {
    const user = userEvent.setup()
    const { currentUrl } = renderAdminOrders('/admin/orders?page=2')
    await findTable()

    const failed = screen.getByRole('button', { name: 'Failed' })
    await user.click(failed)

    expect(failed.getAttribute('aria-pressed')).toBe('true')
    expect(currentUrl()).toBe('/admin/orders?status=failed')
    await waitFor(async () => {
      const rows = within(await findTable()).getAllByRole('row').slice(1)
      expect(rows).toHaveLength(1)
      expect(within(rows[0]).getByText('Failed')).toBeTruthy()
    })
  })

  it('restores filters from the URL', async () => {
    renderAdminOrders('/admin/orders?status=delivered&created_from=2026-10-12')
    const rows = within(await findTable()).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Delivered' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByLabelText('Created from') as HTMLInputElement).value).toBe('2026-10-12')
  })

  it('shows an empty state with a way to clear filters', async () => {
    const user = userEvent.setup()
    const { currentUrl } = renderAdminOrders('/admin/orders?status=failed&created_from=2026-10-14')
    expect(await screen.findByText('No orders match these filters')).toBeTruthy()

    const clearButtons = screen.getAllByRole('button', { name: /clear filters/i })
    await user.click(clearButtons[clearButtons.length - 1])
    expect(currentUrl()).toBe('/admin/orders')
    expect(await findTable()).toBeTruthy()
  })

  it('shows "No orders yet" when there are no orders at all', async () => {
    renderAdminOrders('/admin/orders', createMockAdminOrdersSource({ latencyMs: 0, orders: [] }))
    expect(await screen.findByText('No orders yet')).toBeTruthy()
  })

  it('rejects an inverted date range without requesting data', async () => {
    const source: AdminOrdersSource = { ...createMockAdminOrdersSource({ latencyMs: 0 }), listOrders: vi.fn() }
    renderAdminOrders('/admin/orders?created_from=2026-10-14&created_to=2026-10-01', source)
    expect(screen.getByRole('alert').textContent).toMatch(/must be on or before/i)
    expect(source.listOrders).not.toHaveBeenCalled()
  })

  it('shows the API error and retries on request', async () => {
    const user = userEvent.setup()
    const working = createMockAdminOrdersSource({ latencyMs: 0 })
    const listOrders = vi
      .fn<AdminOrdersSource['listOrders']>()
      .mockRejectedValueOnce(
        new ApiError({ kind: 'network', status: null, code: 'network_error', message: 'Unable to reach the server.' }),
      )
      .mockImplementation(working.listOrders)
    renderAdminOrders('/admin/orders', { ...working, listOrders })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/could not be loaded/i)
    expect(alert.textContent).toMatch(/unable to reach the server/i)

    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(await findTable()).toBeTruthy()
    expect(listOrders).toHaveBeenCalledTimes(2)
  })

  it('moves between pages', async () => {
    const user = userEvent.setup()
    const { currentUrl } = renderAdminOrders('/admin/orders')
    await findTable()

    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(currentUrl()).toBe('/admin/orders?page=2')
    await waitFor(() => expect(screen.getByText(/showing/i).textContent).toMatch(/11–20/))
    expect((screen.getByRole('button', { name: /previous/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('opens an order from the reference search, accepting a lowercase reference', async () => {
    const user = userEvent.setup()
    const { currentUrl } = renderAdminOrders('/admin/orders')
    await findTable()

    await user.type(screen.getByRole('searchbox', { name: /find order by reference/i }), '3hv8rz1n6d{Enter}')
    expect(currentUrl()).toBe('/admin/orders/MO-3HV8RZ1N6D')
  })

  it('explains an invalid reference instead of navigating', async () => {
    const user = userEvent.setup()
    const { currentUrl } = renderAdminOrders('/admin/orders')
    await findTable()

    await user.type(screen.getByRole('searchbox', { name: /find order by reference/i }), 'abc{Enter}')
    expect(screen.getByRole('alert').textContent).toMatch(/MO- followed by 10/)
    expect(currentUrl()).toBe('/admin/orders')
  })
})
