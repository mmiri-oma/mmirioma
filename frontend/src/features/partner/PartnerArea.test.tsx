// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../../app/queryClient'
import { ApiError } from '../../lib/api/client'
import { mockLogin } from '../../mocks/authMock'
import { resetMockDb } from '../../mocks/db'
import { DEMO_PASSWORD } from '../../mocks/seed'
import { PartnerArea } from './PartnerArea'
import * as partnerApi from './partnerApi'
import { partnerKeys } from './queries'

// Pages render slowly on a busy machine or CI runner; the default 1 second wait is not enough.
const WAIT = 10_000
const network = () => new ApiError({ kind: 'network', status: null, code: 'network_error', message: 'Failed to fetch', details: null })

function renderArea() {
  const client = createQueryClient()
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/partner/rider']}>
        <Routes>
          <Route path="/partner/rider" element={<PartnerArea vehicle="keke" />}>
            <Route index element={<p>Rider home</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return client
}

beforeEach(async () => {
  resetMockDb()
  await mockLogin({ phone: '0800 000 0101', password: DEMO_PASSWORD })
})
afterEach(() => vi.restoreAllMocks())

describe('the partner app shell when the profile cannot be refreshed', () => {
  it('keeps the screen the partner is on, so a step can say its request was not sent', async () => {
    // The spy goes in before the first render, which is when the query reads its function:
    // the first read of the profile works, every later one fails.
    const real = partnerApi.getPartnerProfile
    vi.spyOn(partnerApi, 'getPartnerProfile').mockImplementationOnce(real).mockRejectedValue(network())
    const client = renderArea()
    expect(await screen.findByText('Rider home', {}, { timeout: WAIT })).toBeInTheDocument()
    // What every step action does when it ends: refresh all the partner queries.
    await act(async () => {
      await client.invalidateQueries({ queryKey: partnerKeys.all })
      // React Query tells the screen about the failure a tick later.
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(screen.getByText('Rider home')).toBeInTheDocument()
    expect(screen.queryByText(/We cannot reach Waterline/)).not.toBeInTheDocument()
  }, 20_000)

  it('still shows the full-screen error when the profile never loaded', async () => {
    vi.spyOn(partnerApi, 'getPartnerProfile').mockRejectedValue(new ApiError({ kind: 'http', status: 403, code: 'forbidden', message: 'No', details: null }))
    renderArea()
    expect(await screen.findByRole('button', { name: 'Try again' }, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.queryByText('Rider home')).not.toBeInTheDocument()
  })
})
