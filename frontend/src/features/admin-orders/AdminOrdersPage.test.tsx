// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api/client'
import { createMockAdminOrdersSource, MOCK_ADMIN_ORDERS } from './mockAdminOrders'
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
    expect(rows).toHaveLength(22)
    expect(within(rows[0]).getByRole('link', { name: 'MO-7KQ2M9XH4T' })).toBeTruthy()
    expect(screen.getByText(/showing/i).textContent).toMatch(/1–22\s*of\s*22/)
    // Total in the title (admin design fix 5).
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Orders · 22')
  })

  it('shows the customer account, phone state and created time in their own columns', async () => {
    renderAdminOrders('/admin/orders')
    const table = await findTable()
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent)
    expect(headers).toEqual([
      'Order',
      'Status',
      'Customer',
      'Quantity',
      'Delivery address',
      'Preferred date',
      'Created',
      'Open',
    ])
    // The account holder, not the receiver, for an order received by someone else.
    const row = within(table).getByRole('link', { name: 'MO-9TPW4C7M2A' }).closest('tr')
    if (!row) throw new Error('row not found')
    expect(within(row).getByText('Obiageli Nwosu')).toBeTruthy()
    expect(within(row).queryByText('Ngozi Nwosu')).toBeNull()
    expect(within(row).getByText('Phone confirmed')).toBeTruthy()
    expect(within(row).getByText('Wed 14 Oct 2026, 8:42 am')).toBeTruthy()
    expect(screen.queryByText('Verified')).toBeNull()
  })

  it('uses the approved staff status labels (Decision 9)', async () => {
    renderAdminOrders('/admin/orders')
    await findTable()
    for (const label of ['Request received', 'Assigned - awaiting driver', 'On the way', 'Delivery failed']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
    for (const old of ['Quote requested', 'Assigned, not accepted', 'En route']) {
      expect(screen.queryByRole('button', { name: old })).toBeNull()
    }
  })

  it('filters simulated records with is_simulated (Decision 12)', async () => {
    const user = userEvent.setup()
    const { currentUrl } = renderAdminOrders('/admin/orders')
    await findTable()

    await user.selectOptions(screen.getByLabelText('Records'), 'real')
    expect(currentUrl()).toBe('/admin/orders?is_simulated=false')
    // Every mock order is simulated, so no real orders match.
    expect(await screen.findByText('No orders match these filters')).toBeTruthy()

    await user.selectOptions(screen.getByLabelText('Records'), 'simulated')
    expect(currentUrl()).toBe('/admin/orders?is_simulated=true')
    expect(await findTable()).toBeTruthy()
  })

  it('labels mock data as simulated (BR-09)', async () => {
    renderAdminOrders('/admin/orders')
    await findTable()
    expect(screen.getByRole('note').textContent).toMatch(/sample data/i)
  })

  it('filters by status through the URL and resets to page 1', async () => {
    const user = userEvent.setup()
    const { currentUrl } = renderAdminOrders('/admin/orders?page=2')
    // 22 orders fit on page 1, so page 2 is empty until the filter resets it.
    expect(await screen.findByText('This page has no orders')).toBeTruthy()

    const failed = screen.getByRole('button', { name: 'Delivery failed' })
    await user.click(failed)

    expect(failed.getAttribute('aria-pressed')).toBe('true')
    expect(currentUrl()).toBe('/admin/orders?status=failed')
    await waitFor(async () => {
      const rows = within(await findTable()).getAllByRole('row').slice(1)
      expect(rows).toHaveLength(1)
      expect(within(rows[0]).getByText('Delivery failed')).toBeTruthy()
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

    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await findTable()).toBeTruthy()
    expect(listOrders).toHaveBeenCalledTimes(2)
  })

  it('moves between pages of 50 (Decision 13)', async () => {
    const user = userEvent.setup()
    // 60 orders: two pages of 50.
    const orders = Array.from({ length: 60 }, (_, index) => ({
      ...MOCK_ADMIN_ORDERS[0],
      id: `id-${index}`,
      reference: `MO-${String(index).padStart(10, '0')}`,
      created_at: new Date(Date.UTC(2026, 9, 14, 12) - index * 60_000).toISOString(),
    }))
    const { currentUrl } = renderAdminOrders(
      '/admin/orders',
      createMockAdminOrdersSource({ latencyMs: 0, orders }),
    )
    const rows = within(await findTable()).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(50)

    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(currentUrl()).toBe('/admin/orders?page=2')
    await waitFor(() => expect(screen.getByText(/showing/i).textContent).toMatch(/51–60/))
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
