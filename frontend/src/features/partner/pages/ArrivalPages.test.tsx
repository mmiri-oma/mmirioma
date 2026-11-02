// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../../../app/queryClient'
import { mockLogin } from '../../../mocks/authMock'
import { read, resetMockDb } from '../../../mocks/db'
import { DEMO_PASSWORD } from '../../../mocks/seed'
import { ApiError } from '../../../lib/api/client'
import * as partnerApi from '../partnerApi'
import { PARTNER_APPS, PartnerAppContext } from '../partnerContext'
import { ArrivedStep, JobFailed, UnreachableStep } from './ArrivalPages'
import { CodeStep } from './CodeStep'
import { PartnerHistory } from './PartnerShared'
import { CustomerStep } from './RiderTrip'

// Pages render slowly on a busy machine or CI runner; the default 1 second wait is not enough.
const WAIT = 10_000
// Chinedu's active delivery in the seed: loaded, on the way to the customer.
const REF = 'MO-7KQ2M9XH4T'
const BASE = '/partner/rider'
const ARRIVED_AT = '2026-10-29T09:42:00Z'
const PAST = '2026-10-29T09:52:00Z'

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <PartnerAppContext.Provider value={PARTNER_APPS.keke}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={`${BASE}/jobs/:reference/customer`} element={<CustomerStep />} />
            <Route path={`${BASE}/jobs/:reference/arrived`} element={<ArrivedStep />} />
            <Route path={`${BASE}/jobs/:reference/unreachable`} element={<UnreachableStep />} />
            <Route path={`${BASE}/jobs/:reference/code`} element={<CodeStep />} />
            <Route path={`${BASE}/jobs/:reference/failed`} element={<JobFailed />} />
            <Route path={`${BASE}/history`} element={<PartnerHistory />} />
            <Route path={BASE} element={<p>Dashboard</p>} />
          </Routes>
        </MemoryRouter>
      </PartnerAppContext.Provider>
    </QueryClientProvider>,
  )
}

const job = () => read().jobs.find((j) => j.reference === REF)!
const arrive = (extra: Record<string, unknown> = {}) =>
  Object.assign(job(), { arrived_at: ARRIVED_AT, contact_attempts: [], unreachable_allowed_at: PAST, ...extra })

beforeEach(async () => {
  resetMockDb()
  await mockLogin({ phone: '0800 000 0101', password: DEMO_PASSWORD })
})
afterEach(() => vi.restoreAllMocks())

describe('I have arrived (U1)', () => {
  it('records the arrival on its own and opens the arrived screen', async () => {
    const user = userEvent.setup()
    renderAt(`${BASE}/jobs/${REF}/customer`)
    await user.click(await screen.findByRole('button', { name: 'I have arrived' }, { timeout: WAIT }))
    expect(await screen.findByRole('heading', { name: 'You have arrived' }, { timeout: WAIT })).toBeInTheDocument()
    expect(job().arrived_at).toBeTruthy()
  })
})

describe('the arrived screen (U2)', () => {
  it('names the arrival time and offers both actions', async () => {
    arrive()
    renderAt(`${BASE}/jobs/${REF}/arrived`)
    expect(await screen.findByRole('heading', { name: 'You have arrived' }, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.getByText(/^Arrived at /)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Customer not reachable' })).toHaveAttribute('href', `${BASE}/jobs/${REF}/unreachable`)
  })

  it('starts unloading and opens the code screen', async () => {
    const user = userEvent.setup()
    arrive()
    renderAt(`${BASE}/jobs/${REF}/arrived`)
    await user.click(await screen.findByRole('button', { name: 'Start unloading' }, { timeout: WAIT }))
    expect(await screen.findByRole('heading', { name: 'Enter delivery code' }, { timeout: WAIT })).toBeInTheDocument()
    expect(job().mock_unloading_started).toBe(true)
  })

  it('sends a job that has not arrived back to the customer step', async () => {
    renderAt(`${BASE}/jobs/${REF}/arrived`)
    expect(await screen.findByRole('button', { name: 'I have arrived' }, { timeout: WAIT })).toBeInTheDocument()
  })
})

describe('the code screen before unloading', () => {
  it('sends a job that has not started unloading back to its step', async () => {
    arrive({ code_tries_left: null })
    renderAt(`${BASE}/jobs/${REF}/code`)
    expect(await screen.findByRole('heading', { name: 'You have arrived' }, { timeout: WAIT })).toBeInTheDocument()
  })
})

describe('Customer not reachable (U3)', () => {
  it('keeps the end button off until two attempts are recorded, and counts them', async () => {
    const user = userEvent.setup()
    arrive()
    renderAt(`${BASE}/jobs/${REF}/unreachable`)
    const end = await screen.findByRole('button', { name: 'Customer not reachable, fail the job' }, { timeout: WAIT })
    expect(end).toBeDisabled()
    expect(screen.getByText('No attempts recorded yet.')).toBeInTheDocument()
    expect(screen.getByText('0 of 2 attempts recorded')).toBeInTheDocument()
    expect(screen.getByText('Record two attempts first. 2 more needed.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'I tried to reach the customer' }))
    expect(await screen.findByText('Attempt 1', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(await screen.findByText('Record two attempts first. 1 more needed.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'I tried to reach the customer' }))
    expect(await screen.findByText('2 of 2 attempts recorded', {}, { timeout: WAIT })).toBeInTheDocument()
    // The wait is over (the time is in the past), so the server now offers the end action.
    expect(screen.getByRole('button', { name: 'Customer not reachable, fail the job' })).toBeEnabled()
  })

  it('keeps the end button off after two attempts while the wait is running', async () => {
    arrive({ unreachable_allowed_at: new Date(Date.now() + 600_000).toISOString(), contact_attempts: [ARRIVED_AT, ARRIVED_AT] })
    renderAt(`${BASE}/jobs/${REF}/unreachable`)
    expect(await screen.findByRole('button', { name: 'Customer not reachable, fail the job' }, { timeout: WAIT })).toBeDisabled()
    expect(screen.getByText(/^You can end this job from /)).toBeInTheDocument()
  })

  it('asks before failing, then ends the job on the failed screen', async () => {
    const user = userEvent.setup()
    arrive({ contact_attempts: [ARRIVED_AT, ARRIVED_AT] })
    renderAt(`${BASE}/jobs/${REF}/unreachable`)
    await user.click(await screen.findByRole('button', { name: 'Customer not reachable, fail the job' }, { timeout: WAIT }))
    const sheet = await screen.findByRole('alertdialog')
    expect(within(sheet).getByText('End this delivery?')).toBeInTheDocument()
    expect(job().stage).toBe('collected')
    await user.click(within(sheet).getByRole('button', { name: 'Fail the delivery' }))
    expect(await screen.findByRole('heading', { name: 'Delivery failed' }, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.getByText('The dispatcher will contact you.')).toBeInTheDocument()
    expect(screen.getByText('Customer not reachable')).toBeInTheDocument()
    expect(job().stage).toBe('failed')
  })

  it('goes back from the sheet without failing the job', async () => {
    const user = userEvent.setup()
    arrive({ contact_attempts: [ARRIVED_AT, ARRIVED_AT] })
    renderAt(`${BASE}/jobs/${REF}/unreachable`)
    await user.click(await screen.findByRole('button', { name: 'Customer not reachable, fail the job' }, { timeout: WAIT }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Back' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(job().stage).toBe('collected')
  })

  it('switches the attempt and end buttons off while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    arrive({ contact_attempts: [ARRIVED_AT, ARRIVED_AT] })
    renderAt(`${BASE}/jobs/${REF}/unreachable`)
    expect(await screen.findByText('You are offline. Connect to record an attempt.', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'I tried to reach the customer' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Customer not reachable, fail the job' })).toBeDisabled()
  })
})

describe('a failed delivery in the history (U4)', () => {
  it('shows the failed job with its reason and time, and does not hide it', async () => {
    const at = new Date().toISOString()
    Object.assign(job(), { stage: 'failed', ended: { kind: 'failed', reason_code: 'customer_unreachable', note: null, by: 'Chinedu', at } })
    renderAt(`${BASE}/history`)
    expect(await screen.findByText('Delivery failed', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.getByText('Reason: Customer not reachable')).toBeInTheDocument()
    expect(screen.getAllByText(/^Today, /).length).toBeGreaterThan(0)
  })
})

describe('a step that fails after the job has loaded', () => {
  const failure = (kind: 'http' | 'network', status: number | null, code: string) => new ApiError({ kind, status, code, message: 'Server words', details: null })

  /** The first read of the job works; every later one (the refresh after the failed step) fails. */
  function failRefreshes(error: ApiError) {
    const real = partnerApi.getJob
    vi.spyOn(partnerApi, 'getJob').mockImplementationOnce(real).mockRejectedValue(error)
  }

  it('keeps the screen and says the request was not sent when the connection is lost', async () => {
    const user = userEvent.setup()
    arrive()
    const network = failure('network', null, 'network_error')
    failRefreshes(network)
    vi.spyOn(partnerApi, 'startUnloading').mockRejectedValue(network)
    renderAt(`${BASE}/jobs/${REF}/arrived`)
    await user.click(await screen.findByRole('button', { name: 'Start unloading' }, { timeout: WAIT }))
    expect(await screen.findByText('Not sent. Check your connection and try again. Nothing changed.', {}, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'You have arrived' })).toBeInTheDocument()
    expect(screen.queryByText(/We cannot reach Waterline/)).not.toBeInTheDocument()
  }, 20_000)

  it('keeps the screen and offers the way home when the job was reassigned', async () => {
    const user = userEvent.setup()
    arrive({ contact_attempts: [ARRIVED_AT] })
    const gone = failure('http', 404, 'order_not_found')
    failRefreshes(gone)
    vi.spyOn(partnerApi, 'recordContactAttempt').mockRejectedValue(gone)
    renderAt(`${BASE}/jobs/${REF}/unreachable`)
    await user.click(await screen.findByRole('button', { name: 'I tried to reach the customer' }, { timeout: WAIT }))
    expect(await screen.findByText(/This job was reassigned\. It is no longer on your list\./, {}, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', BASE)
    expect(screen.getByRole('heading', { name: 'Customer not reachable' })).toBeInTheDocument()
  })

  it('still shows the full-screen error for a job that never loaded', async () => {
    vi.spyOn(partnerApi, 'getJob').mockRejectedValue(failure('http', 404, 'order_not_found'))
    renderAt(`${BASE}/jobs/${REF}/arrived`)
    expect(await screen.findByRole('button', { name: 'Try again' }, { timeout: WAIT })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'You have arrived' })).not.toBeInTheDocument()
  })
})
