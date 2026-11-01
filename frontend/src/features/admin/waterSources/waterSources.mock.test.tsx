// @vitest-environment jsdom
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppProviders } from '../../../app/providers'
import { routes } from '../../../app/router'
import { mockLogin } from '../../../mocks/authMock'
import { resetMockDb } from '../../../mocks/db'
import { DEMO_PASSWORD } from '../../../mocks/seed'
import { resetWaterSourceMock } from '../../../mocks/waterSourceMock'

// The Water sources screen in mock mode (VITE_USE_MOCKS=true): the demo still works, and every figure is tagged SAMPLE DATA.
const WAIT = 10_000
const SLOW = 20_000

beforeEach(() => {
  resetMockDb()
  resetWaterSourceMock()
})

function renderPage() {
  render(
    <AppProviders>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/admin/water-sources'] })} />
    </AppProviders>,
  )
}

describe('the Water sources screen on the mock demo', () => {
  it('tags the sample data and lists the sample sources, one of them close to expiry', async () => {
    await mockLogin({ phone: '0800 000 0100', password: DEMO_PASSWORD })
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Sample Borehole A' }, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.getByText('SAMPLE DATA')).toBeInTheDocument()
    expect(screen.getByText('Expires in 19 days')).toBeInTheDocument()
    expect(screen.getAllByText('SIMULATED').length).toBeGreaterThan(0)
  }, SLOW)

  it('activates a source for a category and shows it', async () => {
    const user = userEvent.setup()
    await mockLogin({ phone: '0800 000 0100', password: DEMO_PASSWORD })
    renderPage()
    await screen.findByRole('heading', { name: 'Sample Borehole B' }, { timeout: WAIT })
    // Sample Borehole B has never been activated: both categories offer Activate.
    const card = within((await screen.findByRole('heading', { name: 'Sample Borehole B' })).closest('div[class*="flex-col"]') as HTMLElement)
    await user.click(card.getAllByRole('button', { name: 'Activate' })[0])
    const dialog = await screen.findByRole('alertdialog')
    await user.type(within(dialog).getByLabelText('Report reference'), 'SAMPLE-LR-0100')
    const until = new Date(Date.now() + 60 * 60 * 1000 + 90 * 86_400_000).toISOString().slice(0, 10)
    fireEvent.change(within(dialog).getByLabelText('Approved until'), { target: { value: until } })
    await user.type(within(dialog).getByLabelText('Cost per litre (₦)'), '1.25')
    await user.click(within(dialog).getByRole('button', { name: 'Activate' }))
    expect(await screen.findByText(/^Activated for /, {}, { timeout: WAIT })).toBeInTheDocument()
    expect(await screen.findByText('SAMPLE-LR-0100', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.getByText('₦1.25')).toBeInTheDocument()
  }, SLOW)
})
